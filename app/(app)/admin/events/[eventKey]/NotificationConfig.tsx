"use client";

// =====================================================================
// Notification config (client island) — the OPT-IN master switch.
//
// Notifications are DISABLED by default (owner decision 2026-07-03). This
// wraps the per-role routing grid behind a single "Enabled" toggle:
//   - OFF (default) → the routing controls are hidden; the event notifies
//     no one. The checkbox is `notify_enabled`; unchecked ⇒ the browser
//     omits it ⇒ the save action writes NO notification rows.
//   - ON → the existing NotificationRouting grid (recipients, bell/feed)
//     is revealed and behaves exactly as before.
//
// Collapsing the routing for disabled events is what keeps the page clean:
// inactive events expose nothing but the switch.
// =====================================================================

import { useState } from "react";
import NotificationRouting from "./NotificationRouting";

type RoleOpt = { role: string; label: string };
type Channel = { value: string; label: string };

export default function NotificationConfig({
  roles,
  channels,
  values,
  isCritical,
  defaultChannel,
  initialEnabled,
}: {
  roles: RoleOpt[];
  channels: Channel[];
  values: Record<string, string>;
  isCritical: boolean;
  defaultChannel: "bell" | "feed" | "off";
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);

  return (
    <div className="evt-notif-config">
      {/* Master switch — the single control for a disabled event. */}
      <label className={`evt-master${enabled ? " on" : ""}`}>
        <input
          type="checkbox"
          name="notify_enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="evt-master-text">
          <span className="evt-master-title">
            Notifications
            <span className={`evt-master-state${enabled ? " on" : ""}`}>
              {enabled ? "Enabled" : "Disabled"}
            </span>
          </span>
          <span className="evt-master-note">
            {enabled
              ? "This event notifies the recipients below. Untick to silence it completely."
              : "This event notifies no one. Tick to enable and choose who is notified."}
          </span>
        </span>
      </label>

      {enabled ? (
        <div className="evt-master-body">
          <div className="evt-callout">
            <span className="evt-callout-ic" aria-hidden>
              ⓘ
            </span>
            <div>
              <b>Super admin</b> and <b>Admin</b> are separate channels.
              Configuring Admin does <b>not</b> include Super admin.
            </div>
          </div>
          <NotificationRouting
            roles={roles}
            channels={channels}
            values={values}
            isCritical={isCritical}
            defaultChannel={defaultChannel}
          />
        </div>
      ) : (
        <div className="evt-master-collapsed" role="note">
          Routing is hidden while notifications are disabled. Enable to
          configure recipients, bell and feed.
        </div>
      )}
    </div>
  );
}
