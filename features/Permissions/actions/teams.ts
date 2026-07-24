"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserRole } from "@/lib/auth";
import { isTechnicalRole } from "@/lib/types";

/**
 * Server actions for the Teams & Access (visibility) admin — m067.
 * All management-gated on the REAL role. Defensive: a clear error if m067
 * isn't applied yet. The visibility engine (lib/visibility.ts) reads what
 * these write.
 */

async function requireManagement() {
  const { role } = await getCurrentUserRole();
  if (!isTechnicalRole(role)) {
    throw new Error("Only management roles can manage teams & access scopes.");
  }
}

function missingTable(msg: string): boolean {
  return /teams|team_members|access_grants|relation .* does not exist/i.test(
    msg ?? ""
  );
}

export async function createTeam(formData: FormData) {
  await requireManagement();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "team");
  const parentRaw = String(formData.get("parent_team_id") ?? "");
  const parent_team_id = parentRaw && parentRaw !== "__none__" ? parentRaw : null;
  if (!name) throw new Error("Team name is required.");
  if (!["team", "region", "department"].includes(kind)) {
    throw new Error("Invalid team kind.");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("teams")
    .insert({ name, kind, parent_team_id });
  if (error) {
    if (missingTable(error.message))
      throw new Error("teams table missing — apply migration m067.");
    throw new Error(error.message);
  }
  revalidatePath("/permissions/teams");
}

export async function deleteTeam(formData: FormData) {
  await requireManagement();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing team id");
  const supabase = createClient();
  const { error } = await supabase.from("teams").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/permissions/teams");
}

export async function addTeamMember(formData: FormData) {
  await requireManagement();
  const team_id = String(formData.get("team_id") ?? "");
  const user_id = String(formData.get("user_id") ?? "");
  const member_role = String(formData.get("member_role") ?? "member");
  if (!team_id || !user_id) throw new Error("Missing team or user");
  if (!["member", "manager"].includes(member_role))
    throw new Error("Invalid member role.");

  const supabase = createClient();
  const { error } = await supabase
    .from("team_members")
    .upsert({ team_id, user_id, member_role }, { onConflict: "team_id,user_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/permissions/teams");
}

export async function removeTeamMember(formData: FormData) {
  await requireManagement();
  const team_id = String(formData.get("team_id") ?? "");
  const user_id = String(formData.get("user_id") ?? "");
  if (!team_id || !user_id) throw new Error("Missing team or user");
  const supabase = createClient();
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("team_id", team_id)
    .eq("user_id", user_id);
  if (error) throw new Error(error.message);
  revalidatePath("/permissions/teams");
}

export async function addGrant(formData: FormData) {
  await requireManagement();
  const user_id = String(formData.get("user_id") ?? "");
  const scope_type = String(formData.get("scope_type") ?? "");
  if (!user_id) throw new Error("Missing user");
  if (!["self", "team", "region", "lens", "all"].includes(scope_type))
    throw new Error("Invalid scope type.");

  const teamRaw = String(formData.get("team_id") ?? "");
  const lensRaw = String(formData.get("lens_key") ?? "");
  const team_id =
    (scope_type === "team" || scope_type === "region") && teamRaw && teamRaw !== "__none__"
      ? teamRaw
      : null;
  const lens_key = scope_type === "lens" && lensRaw ? lensRaw : null;

  if ((scope_type === "team" || scope_type === "region") && !team_id)
    throw new Error("Pick a team/region for this scope.");
  if (scope_type === "lens" && !lens_key)
    throw new Error("Pick a lens (production / finance / logistics).");

  const { userId: grantedBy } = await getCurrentUserRole();
  const supabase = createClient();
  const { error } = await supabase.from("access_grants").insert({
    user_id,
    scope_type,
    team_id,
    lens_key,
    granted_by: grantedBy,
  });
  if (error) {
    if (missingTable(error.message))
      throw new Error("access_grants table missing — apply migration m067.");
    throw new Error(error.message);
  }
  revalidatePath("/permissions/teams");
}

export async function removeGrant(formData: FormData) {
  await requireManagement();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing grant id");
  const supabase = createClient();
  const { error } = await supabase.from("access_grants").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/permissions/teams");
}
