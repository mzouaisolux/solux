"use client";

// =====================================================================
// Integrations Phase 1 — "My channels" (self-scoped rep handles).
// Powers the click-to-chat buttons on client pages. Only the signed-in
// user can edit their own handles (RLS on user_channels). Blank = cleared.
// =====================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import { saveMyChannel, type UserChannelRow } from "@/features/Intergration/actions/user-channels";
import { USER_CHANNELS, type UserChannel } from "@/features/Intergration/lib/integrations";

const LABEL: Record<UserChannel, string> = { zalo: "Zalo", whatsapp: "WhatsApp", telegram: "Telegram" };
const PLACEHOLDER: Record<UserChannel, string> = {
  zalo: "+84 90 xxx xxxx",
  whatsapp: "+84 90 xxx xxxx",
  telegram: "@handle (optional)",
};

export function MyChannelsForm({ initial }: { initial: UserChannelRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const seed: Record<UserChannel, string> = { zalo: "", whatsapp: "", telegram: "" };
  for (const r of initial) seed[r.channel] = r.handle;
  const [vals, setVals] = useState<Record<UserChannel, string>>(seed);

  function save() {
    startTransition(async () => {
      try {
        for (const ch of USER_CHANNELS) await saveMyChannel(ch, vals[ch]);
        toast.success("Channels saved");
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not save channels");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {USER_CHANNELS.map((ch) => (
          <label key={ch} className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">{LABEL[ch]}</span>
            <input
              className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200"
              placeholder={PLACEHOLDER[ch]}
              value={vals[ch]}
              onChange={(e) => setVals((v) => ({ ...v, [ch]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        disabled={pending}
        onClick={save}
      >
        {pending ? "Saving…" : "Save my channels"}
      </button>
    </div>
  );
}

export default MyChannelsForm;
