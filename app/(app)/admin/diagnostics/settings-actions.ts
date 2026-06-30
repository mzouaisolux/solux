"use server";

// m120 — tunable product thresholds (locked dashboard spec: the
// preventive window is an ADMIN SETTING, default 7 days).

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { PREVENTIVE_DAYS_KEY, setNumberSetting } from "@/lib/app-settings";

export async function savePreventiveDays(formData: FormData): Promise<void> {
  await requireCapability("admin.diagnostics");
  const raw = Number(formData.get("days"));
  if (!Number.isFinite(raw)) return;
  const days = Math.min(60, Math.max(1, Math.round(raw)));
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await setNumberSetting(supabase, PREVENTIVE_DAYS_KEY, days, user?.id ?? null);
  revalidatePath("/dashboard");
  revalidatePath("/admin/diagnostics");
}
