"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";

/**
 * Execute the destructive development reset.
 *
 * Flow
 * ----
 *   1. Server-side capability gate — must hold `admin.diagnostics`.
 *      Defense in depth: the RPC also checks super_admin internally.
 *   2. Read the confirmation phrase from the form. Must be the
 *      literal string "RESET" (uppercase). Anything else aborts so
 *      a misclick can't wipe the DB.
 *   3. Call the SECURITY DEFINER RPC `admin_reset_execute()` which
 *      runs the wipe inside a single transaction.
 *   4. Revalidate every (app) surface that reads business data so the
 *      next render reflects the empty state. Also revalidate the
 *      diagnostics page so the result banner shows.
 *   5. Redirect back to the reset page with ?result= in the query
 *      so the page can render the success summary without keeping
 *      anything in memory.
 */
export async function runDevResetAction(formData: FormData) {
  await requireCapability("admin.diagnostics");

  const confirmation = String(formData.get("confirmation") ?? "").trim();
  if (confirmation !== "RESET") {
    throw new Error(
      'Confirmation phrase incorrect. Type exactly "RESET" (uppercase) to enable the wipe.'
    );
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_reset_execute");
  if (error) {
    // RPC missing? Surface a clear remediation message.
    if (error.code === "42883") {
      throw new Error(
        "admin_reset_execute RPC is not deployed. Apply migration 035_dev_reset_rpcs.sql in Supabase and try again."
      );
    }
    throw new Error(error.message);
  }

  // Force a fresh read of every business surface — they all derived
  // their content from tables we just emptied.
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  revalidatePath("/task-lists");
  revalidatePath("/production/queue");
  revalidatePath("/operations");
  revalidatePath("/business");
  revalidatePath("/order-follow-up");
  revalidatePath("/admin/diagnostics");
  revalidatePath("/admin/diagnostics/reset");

  // Pass the RPC result back as a base64 blob in the URL so the page
  // can render the summary without us having to thread it through a
  // server component prop. The blob is small (~10 keys) so URL length
  // isn't a concern.
  const payload = Buffer.from(JSON.stringify(data ?? {})).toString("base64url");
  redirect(`/admin/diagnostics/reset?result=${payload}`);
}
