import { createClient } from "@/lib/supabase/server";
import { listAssignableOwners } from "@/lib/owner";
import {
  ACCESS_TYPES,
  LENS_INFO,
  TONE_BADGE,
  grantChipLabel,
  grantTone,
  visibilitySummary,
  type AccessTypeKey,
} from "@/lib/access-labels";
import { GrantForm } from "@/components/permissions/GrantForm";
import {
  createTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  addGrant,
  removeGrant,
} from "./actions";

/**
 * Teams & Access — the visibility (who-can-SEE-what) admin (m067, Phase 2a).
 *
 * Two blocks:
 *   1. Teams — create teams / regions / departments, add members
 *      (member|manager), nest a team under a region.
 *   2. Visibility access — give each person one or more "access rules"
 *      (own records / team / region / department / everything). The form
 *      shows ONE control at a time and explains in plain English what each
 *      rule grants, and each person shows a live "can currently see" summary.
 *
 * The engine (lib/visibility.ts) reads these rows. Until a user has grants,
 * they keep today's behavior (technical = all, sales = own), so this admin
 * is safe to use incrementally. All business wording lives in
 * lib/access-labels.ts so the page stays declarative.
 */

const LABEL = "text-[10px] font-semibold uppercase tracking-wider text-neutral-500";
const INPUT =
  "rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:border-solux focus:outline-none focus:ring-1 focus:ring-solux/40";
const BTN =
  "rounded-md bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-800";

export default async function TeamsAccessPage() {
  const supabase = createClient();

  // Users (management directory, via list_assignable_owners RPC — m066).
  const users = await listAssignableOwners(); // {id, name, role}[]
  const userName = (id: string | null) =>
    (id && users.find((u) => u.id === id)?.name) || (id ? `user·${id.slice(0, 6)}` : "—");

  // Visibility tables (m067). Soft-fail → show the "apply m067" notice.
  const teamsRes = await supabase
    .from("teams")
    .select("id, name, kind, parent_team_id")
    .order("kind")
    .order("name");
  const m067Missing = !!teamsRes.error;
  const teams = (teamsRes.data ?? []) as Array<{
    id: string;
    name: string;
    kind: string;
    parent_team_id: string | null;
  }>;
  const teamName = (id: string | null) =>
    (id && teams.find((t) => t.id === id)?.name) || "—";
  const regions = teams.filter((t) => t.kind === "region");

  const { data: membersRaw } = m067Missing
    ? { data: [] }
    : await supabase.from("team_members").select("team_id, user_id, member_role");
  const membersByTeam = new Map<
    string,
    Array<{ user_id: string; member_role: string }>
  >();
  for (const m of (membersRaw ?? []) as any[]) {
    if (!membersByTeam.has(m.team_id)) membersByTeam.set(m.team_id, []);
    membersByTeam.get(m.team_id)!.push({
      user_id: m.user_id,
      member_role: m.member_role,
    });
  }

  const { data: grantsRaw } = m067Missing
    ? { data: [] }
    : await supabase
        .from("access_grants")
        .select("id, user_id, scope_type, team_id, lens_key, expires_at");
  const grantsByUser = new Map<string, any[]>();
  for (const g of (grantsRaw ?? []) as any[]) {
    if (!grantsByUser.has(g.user_id)) grantsByUser.set(g.user_id, []);
    grantsByUser.get(g.user_id)!.push(g);
  }

  // Ordered access-type keys for the legend (broad → narrow).
  const typeKeys = Object.keys(ACCESS_TYPES) as AccessTypeKey[];

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div>
        <div className="eyebrow">Permissions · Visibility</div>
        <h1 className="doc-title mt-1">Teams &amp; access</h1>
        <p className="text-xs text-neutral-500 mt-2 max-w-2xl leading-relaxed">
          Decide who can <b>see</b> what (kept separate from who can <b>do</b>{" "}
          what). Each person&apos;s visibility is the <b>sum</b> of the access
          rules you give them. Until someone has a rule, they keep the default —
          management sees everything, salespeople see their own — so you can roll
          this out one person at a time.
        </p>
      </div>

      {m067Missing && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Visibility tables not found — apply migration{" "}
          <b>m067 (067_visibility_scopes.sql)</b> in Supabase, then reload.
        </div>
      )}

      {users.length === 0 && !m067Missing && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
          No users returned by <code>list_assignable_owners()</code> — apply
          migration <b>m066</b> (and ensure you&apos;re on a management role).
        </div>
      )}

      {/* ---------------- HOW VISIBILITY WORKS (legend) ---------------- */}
      <section className="panel p-5 space-y-3">
        <div className="eyebrow">How visibility works</div>
        <p className="text-xs text-neutral-500 -mt-1 max-w-2xl">
          The five kinds of access, from the widest to the narrowest. Give a
          person whichever ones match their job — you can combine several.
        </p>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {typeKeys.map((k) => {
            const info = ACCESS_TYPES[k];
            return (
              <div
                key={k}
                className={`rounded-md border p-3 ${TONE_BADGE[info.tone]}`}
              >
                <div className="text-sm font-semibold">{info.label}</div>
                <p className="mt-1 text-[12px] leading-relaxed opacity-90">
                  {info.help}
                </p>
                <p className="mt-1.5 text-[11px] italic opacity-70">
                  e.g. {info.example}
                </p>
              </div>
            );
          })}
        </div>
        <div className="rounded-md border border-neutral-200 bg-neutral-50/60 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            What each department sees
          </div>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
            {(Object.keys(LENS_INFO) as (keyof typeof LENS_INFO)[]).map((k) => (
              <div key={k} className="text-[12px] text-neutral-600">
                <b className="text-neutral-800">{LENS_INFO[k].label}</b>:{" "}
                {LENS_INFO[k].sees.join(", ")}.
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- TEAMS ---------------- */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="eyebrow">Teams &amp; regions</div>
            <p className="text-xs text-neutral-500 mt-1 max-w-xl">
              Group people so you can grant access to a whole team at once. A{" "}
              <b>region</b> bundles accounts by geography; a <b>team</b> bundles
              salespeople under a manager; a <b>department</b> is a back-office
              function (Production, Finance, Logistics).
            </p>
          </div>
          <span className="text-[11px] text-neutral-400 tabular-nums whitespace-nowrap">
            {teams.length} total
          </span>
        </div>

        {/* Create team */}
        <form
          action={createTeam}
          className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 bg-neutral-50/60 p-3"
        >
          <label className="block">
            <span className={LABEL}>Name</span>
            <input name="name" required placeholder="Africa / TLM-North / Finance" className={`${INPUT} mt-1 w-56`} />
          </label>
          <label className="block">
            <span className={LABEL}>Kind</span>
            <select name="kind" className={`${INPUT} mt-1`} defaultValue="team">
              <option value="team">Team</option>
              <option value="region">Region</option>
              <option value="department">Department</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Parent region (optional)</span>
            <select name="parent_team_id" className={`${INPUT} mt-1`} defaultValue="__none__">
              <option value="__none__">— none —</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <button className={BTN} disabled={m067Missing}>
            + Create team
          </button>
        </form>

        {/* Team list */}
        <div className="space-y-3">
          {teams.length === 0 ? (
            <p className="text-xs text-neutral-400">No teams yet.</p>
          ) : (
            teams.map((t) => {
              const members = membersByTeam.get(t.id) ?? [];
              return (
                <div key={t.id} className="rounded-md border border-neutral-200 p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-neutral-900">{t.name}</span>
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-600">
                        {t.kind}
                      </span>
                      {t.parent_team_id && (
                        <span className="text-[11px] text-neutral-400">
                          in {teamName(t.parent_team_id)}
                        </span>
                      )}
                    </div>
                    <form action={deleteTeam}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="text-[11px] text-neutral-400 hover:text-rose-600">
                        Delete team
                      </button>
                    </form>
                  </div>

                  {/* Members */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {members.length === 0 ? (
                      <span className="text-[11px] text-neutral-400">No members.</span>
                    ) : (
                      members.map((m) => (
                        <span
                          key={m.user_id}
                          className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px]"
                        >
                          {userName(m.user_id)}
                          {m.member_role === "manager" && (
                            <span className="text-[9px] uppercase text-solux font-semibold">
                              mgr
                            </span>
                          )}
                          <form action={removeTeamMember} className="inline">
                            <input type="hidden" name="team_id" value={t.id} />
                            <input type="hidden" name="user_id" value={m.user_id} />
                            <button className="text-neutral-300 hover:text-rose-600" aria-label="Remove">
                              ✕
                            </button>
                          </form>
                        </span>
                      ))
                    )}
                  </div>

                  {/* Add member */}
                  <form action={addTeamMember} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="team_id" value={t.id} />
                    <select name="user_id" className={INPUT} required defaultValue="">
                      <option value="" disabled>
                        Add member…
                      </option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                          {u.role ? ` · ${u.role}` : ""}
                        </option>
                      ))}
                    </select>
                    <select name="member_role" className={INPUT} defaultValue="member">
                      <option value="member">Member</option>
                      <option value="manager">Manager</option>
                    </select>
                    <button className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50">
                      Add
                    </button>
                  </form>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ---------------- VISIBILITY ACCESS (per person) ---------------- */}
      <section className="panel p-5 space-y-4">
        <div className="eyebrow">Visibility access (per person)</div>
        <p className="text-xs text-neutral-500 -mt-1 max-w-2xl">
          For each person, the <b>Can currently see</b> line shows — in plain
          English — exactly what their rules add up to. Add a rule below; remove
          one with the ✕ on its chip.
        </p>

        <div className="space-y-2.5">
          {users.map((u) => {
            const grants = grantsByUser.get(u.id) ?? [];
            const seeBullets = visibilitySummary(
              grants.map((g) => ({
                scope_type: g.scope_type,
                team_id: g.team_id,
                lens_key: g.lens_key,
              })),
              teamName
            );
            const isDefault = grants.length === 0;
            return (
              <div key={u.id} className="rounded-md border border-neutral-200 p-3">
                {/* Person header + their access-rule chips */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-neutral-900">
                      {u.name}
                    </span>
                    {u.role && (
                      <span className="ml-2 text-[11px] text-neutral-400 uppercase tracking-wider">
                        {u.role}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 justify-end">
                    {isDefault ? (
                      <span className="rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
                        Role default
                      </span>
                    ) : (
                      grants.map((g) => (
                        <span
                          key={g.id}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                            TONE_BADGE[grantTone(g.scope_type)]
                          }`}
                        >
                          {grantChipLabel(g.scope_type, teamName(g.team_id), g.lens_key)}
                          <form action={removeGrant} className="inline">
                            <input type="hidden" name="id" value={g.id} />
                            <button
                              className="opacity-50 hover:opacity-100 hover:text-rose-700"
                              aria-label="Remove access rule"
                            >
                              ✕
                            </button>
                          </form>
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* Live "can currently see" summary */}
                <div className="mt-2 rounded-md bg-neutral-50 border border-neutral-100 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Can currently see
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {seeBullets.map((b, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5 text-[12px] text-neutral-700"
                      >
                        <span className="text-emerald-600 mt-px">✓</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Add an access rule (conditional, self-explaining form). */}
                {!m067Missing && (
                  <GrantForm userId={u.id} teams={teams} action={addGrant} />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
