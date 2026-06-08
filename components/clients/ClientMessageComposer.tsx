"use client";

// =====================================================================
// Client Hub "Messages" tab composer. Posts to the canonical client-level
// conversation (entity_messages, entity_type='client') via postEntityComment,
// then router.refresh() so the server-rendered thread above updates. The
// global ConversationLauncher + the bell (H8) keep handling unread state.
// =====================================================================

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postEntityComment } from "@/app/(app)/_actions/entity-messages";

export function ClientMessageComposer({ clientId }: { clientId: string }) {
  const router = useRouter();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function action(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await postEntityComment(formData);
        if (ref.current) ref.current.value = "";
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Could not post the note.");
      }
    });
  }

  return (
    <form action={action} className="space-y-1">
      <div className="flex items-start gap-2">
        <input type="hidden" name="entity_type" value="client" />
        <input type="hidden" name="entity_id" value={clientId} />
        <textarea
          ref={ref}
          name="message"
          required
          maxLength={4000}
          rows={2}
          placeholder="Add a note to this client's conversation — “Called, awaiting PO”, “Sent reminder”…"
          className="flex-1 rounded-md border border-neutral-200 px-3 py-2 text-sm focus:border-solux focus:outline-none focus:ring-1 focus:ring-solux/30"
        />
        <button
          type="submit"
          disabled={pending}
          className="btn-primary shrink-0 disabled:opacity-60"
        >
          {pending ? "Posting…" : "Post"}
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </form>
  );
}
