"use server";

/**
 * Integrations — reusable message templates (m170).
 * Reads are open to any authenticated user (every rep can pick a template);
 * writes are gated by integration.manage (RLS also restricts to admins).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { TEMPLATE_KINDS, type TemplateKind } from "@/features/Intergration/lib/integrations";

export type TemplateRow = {
  id: string;
  name: string;
  kind: TemplateKind;
  body: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

/** All templates (admin manager). */
export async function listTemplates(): Promise<TemplateRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("message_templates")
    .select("id, name, kind, body, is_active, created_at, updated_at")
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as TemplateRow[];
}

/** Active templates only — for the send composers' picker. */
export async function listActiveTemplates(): Promise<TemplateRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("message_templates")
    .select("id, name, kind, body, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as TemplateRow[];
}

export async function upsertTemplate(input: {
  id?: string | null;
  name: string;
  kind: string;
  body: string;
  is_active?: boolean;
}): Promise<void> {
  await requireCapability("integration.manage");
  const name = (input.name ?? "").trim();
  const body = (input.body ?? "").trim();
  if (!name) throw new Error("A template name is required.");
  if (!body) throw new Error("Template body cannot be empty.");
  const kind = (TEMPLATE_KINDS as readonly string[]).includes(input.kind) ? input.kind : "general";

  const supabase = createClient();
  const row: Record<string, any> = {
    name,
    kind,
    body,
    is_active: input.is_active ?? true,
    updated_at: new Date().toISOString(),
  };
  if (input.id) row.id = input.id;

  const { error } = await supabase.from("message_templates").upsert(row);
  if (error) throw new Error(`Could not save template: ${error.message}`);
  revalidatePath("/settings/integrations");
}

export async function deleteTemplate(id: string): Promise<void> {
  await requireCapability("integration.manage");
  const supabase = createClient();
  const { error } = await supabase.from("message_templates").delete().eq("id", id);
  if (error) throw new Error(`Could not delete template: ${error.message}`);
  revalidatePath("/settings/integrations");
}
