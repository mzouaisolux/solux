"use client";

// Integrations — manage reusable message templates (admin). Body supports
// {{tokens}} like {{company}}, {{contact}}, {{product}}, {{version}}, {{sku}}.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import { upsertTemplate, deleteTemplate, type TemplateRow } from "@/features/Intergration/actions/templates";
import { TEMPLATE_KINDS, TEMPLATE_KIND_LABELS } from "@/features/Intergration/lib/integrations";

const btn =
  "inline-flex items-center rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm font-medium hover:border-neutral-900 disabled:opacity-40";

const blank = { id: null as string | null, name: "", kind: "general", body: "", is_active: true };

export function TemplatesManager({ initial }: { initial: TemplateRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<typeof blank | null>(null);

  function save() {
    if (!form) return;
    startTransition(async () => {
      try {
        await upsertTemplate(form);
        toast.success("Template saved");
        setForm(null);
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not save template");
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        await deleteTemplate(id);
        toast.success("Template deleted");
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not delete template");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-neutral-500">
                  No templates yet.
                </td>
              </tr>
            ) : (
              initial.map((t) => (
                <tr key={t.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2 text-neutral-500">{TEMPLATE_KIND_LABELS[t.kind] ?? t.kind}</td>
                  <td className="px-3 py-2">{t.is_active ? "On" : "Off"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className={btn}
                      disabled={pending}
                      onClick={() =>
                        setForm({ id: t.id, name: t.name, kind: t.kind, body: t.body, is_active: t.is_active })
                      }
                    >
                      Edit
                    </button>{" "}
                    <button type="button" className={btn} disabled={pending} onClick={() => remove(t.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {form ? (
        <div className="space-y-2 rounded-md border border-neutral-200 p-3">
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-[200px] flex-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
              placeholder="Template name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select
              className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              {TEMPLATE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TEMPLATE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Active
            </label>
          </div>
          <textarea
            className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
            rows={3}
            placeholder="Hi {{contact}}, attached is the {{product}} spec sheet ({{version}}) from {{company}}."
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
          <p className="text-xs text-neutral-400">
            Tokens: {"{{company}} {{contact}} {{product}} {{version}} {{sku}}"} — filled from context when applied.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={pending || !form.name.trim() || !form.body.trim()}
              onClick={save}
            >
              {pending ? "Saving…" : "Save template"}
            </button>
            <button type="button" className={btn} disabled={pending} onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={btn} onClick={() => setForm({ ...blank })}>
          New template
        </button>
      )}
    </div>
  );
}

export default TemplatesManager;
