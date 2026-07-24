// Thin route stub — all logic lives in the transferable module.
// Node runtime: storage writes (spec-sheet PDF uploads) run server-side.
export { default } from "@/features/product-knowledge-hub/routes/import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
