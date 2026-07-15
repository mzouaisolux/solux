// =====================================================================
// /packing/calculator — pick products + quantities → run the engine.
// =====================================================================
import { createClient } from "@/lib/supabase/server";
import CalculatorClient from "@/components/packing/CalculatorClient";

export const dynamic = "force-dynamic";

export default async function CalculatorPage() {
  const sb = createClient();
  const { data } = await sb
    .from("packing_item")
    .select("id, reference, family, is_lamp_pole")
    .order("reference");
  return <CalculatorClient items={(data ?? []) as any} />;
}
