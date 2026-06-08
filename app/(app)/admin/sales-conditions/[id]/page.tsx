import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateSalesCondition } from "../actions";

export default async function EditSalesConditionPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const { data: row } = await supabase
    .from("sales_conditions")
    .select("id, title, content, is_default")
    .eq("id", params.id)
    .maybeSingle();

  if (!row) notFound();

  return (
    <div className="mx-auto max-w-3xl p-8 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit sales conditions</h1>
        <Link
          href="/admin/sales-conditions"
          className="text-sm hover:underline"
        >
          ← Back
        </Link>
      </div>

      <form action={updateSalesCondition} className="panel p-5 space-y-3">
        <input type="hidden" name="id" value={row.id} />
        <label className="block">
          <span className="text-sm font-medium">Title</span>
          <input
            name="title"
            defaultValue={row.title}
            required
            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Content</span>
          <textarea
            name="content"
            defaultValue={row.content}
            rows={14}
            required
            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 font-sans"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_default"
            defaultChecked={row.is_default}
          />
          Use as default
        </label>
        <div className="pt-1">
          <button className="rounded bg-solux px-4 py-2 text-white font-medium hover:bg-solux-dark">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
