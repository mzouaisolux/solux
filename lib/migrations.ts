// =====================================================================
// Migration-ledger probe (m113). Dormant-feature gate: new UI/write paths
// that depend on a pending migration check its self-inserted ledger row
// (readable by every authenticated user) instead of guessing from errors.
// Any lookup failure → NOT applied (feature stays dormant, never breaks).
// =====================================================================

type AnySupabase = {
  from: (table: string) => any;
};

export async function migrationApplied(
  supabase: AnySupabase,
  filename: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("schema_migrations")
      .select("filename")
      .eq("filename", filename)
      .maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}
