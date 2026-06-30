"use client";

// =====================================================================
// Sticky save footer (client island). Two submit buttons in the SAME
// form: Save (the form's action) and Reset (a separate server action via
// formAction). Guards:
//   - Save asks for confirmation if a CRITICAL event is being muted for
//     Super admin / Admin (read live from the form at click time — no
//     shared state needed).
//   - Reset asks for confirmation and is disabled when there is nothing
//     to reset (event already at defaults).
// =====================================================================

import { useFormStatus } from "react-dom";

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function EventConfigFooter({
  resetAction,
  isCritical,
  hasConfig,
}: {
  resetAction: (formData: FormData) => void | Promise<void>;
  isCritical: boolean;
  hasConfig: boolean;
}) {
  const { pending } = useFormStatus();

  const onSave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!isCritical) return;
    const form = e.currentTarget.form;
    if (!form) return;
    const val = (name: string) =>
      (form.elements.namedItem(name) as HTMLSelectElement | null)?.value;
    const muted = [
      val("notification__super_admin") === "off" ? "Super admin" : null,
      val("notification__admin") === "off" ? "Admin" : null,
    ].filter(Boolean) as string[];
    if (muted.length > 0) {
      const ok = window.confirm(
        `This is a CRITICAL event.\n\nYou are muting its notification for ${muted.join(
          " and "
        )} — they will NOT be alerted.\n\nSave anyway?`
      );
      if (!ok) e.preventDefault();
    }
  };

  const onReset = (e: React.MouseEvent<HTMLButtonElement>) => {
    const ok = window.confirm(
      "Reset this event to its default behavior?\n\nThis removes every saved override and routing for this event. Defaults = today's code behavior."
    );
    if (!ok) e.preventDefault();
  };

  return (
    <div className="ad-matrix-savebar evt-savebar">
      <span className="note">
        Only non-default values are stored. Defaults = today’s behavior.
      </span>
      <div className="evt-savebar-actions">
        <button
          type="submit"
          formAction={resetAction}
          onClick={onReset}
          disabled={pending || !hasConfig}
          className="evt-reset-btn"
          title={
            hasConfig
              ? "Remove all overrides for this event"
              : "Nothing to reset — this event is already at its defaults"
          }
        >
          Reset to defaults
        </button>
        <button
          type="submit"
          onClick={onSave}
          disabled={pending}
          aria-busy={pending}
          className="evt-save-btn"
        >
          {pending && <Spinner />}
          <span>{pending ? "Saving…" : "Save event configuration"}</span>
        </button>
      </div>
    </div>
  );
}
