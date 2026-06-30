"use client";

// =====================================================================
// Notification routing grid (client island) — the ONLY live consumer.
//
// Controlled <select>s keep the exact same field names the server action
// reads (`notification__<role>`), so save semantics are unchanged. On top
// we add a live "Who will be notified" preview and an inline warning when
// a CRITICAL event is muted ("off") for Super admin / Admin.
// =====================================================================

import { useState } from "react";

type RoleOpt = { role: string; label: string };
type Channel = { value: string; label: string };

const PREVIEW: Record<string, { label: string; cls: string }> = {
  default: { label: "inherit", cls: "evt-pv-inherit" },
  bell: { label: "bell", cls: "evt-pv-bell" },
  feed: { label: "feed", cls: "evt-pv-feed" },
  off: { label: "off", cls: "evt-pv-off" },
};

// Clean, capitalised option labels (no emoji) — the lib's NOTIFICATION_CHANNELS
// keep their emoji labels; we present them plainly here for a calmer select.
const CH_OPT: Record<string, string> = {
  default: "— Default (inherit)",
  bell: "Bell",
  feed: "Feed",
  off: "Off — muted",
};

const isAdminish = (role: string) => role === "super_admin" || role === "admin";

export default function NotificationRouting({
  roles,
  channels,
  values,
  isCritical,
  defaultChannel,
}: {
  roles: RoleOpt[];
  channels: Channel[];
  values: Record<string, string>;
  isCritical: boolean;
  /** What "inherit" resolves to today (from the event's code severity).
   *  defaultChannel() only ever returns bell/feed, but it's typed as the
   *  full NotificationChannel union — accept it without a cast at the call. */
  defaultChannel: "bell" | "feed" | "off";
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const r of roles) v[r.role] = values[r.role] ?? "default";
    return v;
  });
  const set = (role: string, val: string) =>
    setVals((prev) => ({ ...prev, [role]: val }));

  const cap = (c: string) =>
    c === "bell" ? "Bell" : c === "feed" ? "Feed" : c === "off" ? "Off" : c;
  const defLabel = cap(defaultChannel);

  return (
    <div>
      <div className="evt-notif-grid">
        {roles.map((r) => {
          const dangerous =
            isCritical && isAdminish(r.role) && vals[r.role] === "off";
          return (
            <label
              key={r.role}
              className={`evt-notif-cell${dangerous ? " danger" : ""}`}
            >
              <span className="evt-notif-role">{r.label}</span>
              <select
                name={`notification__${r.role}`}
                value={vals[r.role]}
                onChange={(e) => set(r.role, e.target.value)}
                className="sx-input"
              >
                {channels.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.value === "default"
                      ? `— Default · ${defLabel}`
                      : (CH_OPT[c.value] ?? c.label)}
                  </option>
                ))}
              </select>
              {dangerous && (
                <span className="evt-notif-warn">
                  {r.label} won’t be alerted
                </span>
              )}
            </label>
          );
        })}
      </div>

      {/* Live "Who gets notified" impact summary — resolves what each role
          ACTUALLY gets today: an override if set, otherwise the event's
          built-in default channel (so "inherit" is never a dead end). */}
      {(() => {
        const baseMeta = PREVIEW[defaultChannel] ?? PREVIEW.feed;
        const overrides = roles.filter(
          (r) => (vals[r.role] ?? "default") !== "default"
        );
        const inheritCount = roles.length - overrides.length;
        return (
          <div className="evt-preview">
            <div className="evt-preview-h">
              Who gets notified
              <span className="evt-ovr-ct">
                {overrides.length > 0
                  ? `${overrides.length} override${overrides.length > 1 ? "s" : ""}`
                  : "all default"}
              </span>
            </div>
            <div className="evt-preview-row">
              {overrides.map((r) => {
                const m = PREVIEW[vals[r.role]] ?? baseMeta;
                return (
                  <span key={r.role} className={`evt-pv ${m.cls}`}>
                    <b>{r.label}</b>
                    <span className="evt-pv-ch">{cap(vals[r.role])}</span>
                  </span>
                );
              })}
              {inheritCount > 0 && (
                <span className={`evt-pv ${baseMeta.cls} is-default`}>
                  <b>{overrides.length > 0 ? "Everyone else" : "All roles"}</b>
                  <span className="evt-pv-ch">{defLabel} · default</span>
                </span>
              )}
            </div>
            <div className="evt-preview-note">
              <b>Default</b> is the event’s built-in channel (set by its
              severity). Whether a role actually receives it also depends on
              what that role can see.
            </div>
          </div>
        );
      })()}
    </div>
  );
}
