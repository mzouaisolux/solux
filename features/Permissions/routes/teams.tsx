import { createClient } from "@/lib/supabase/server";
import { listAssignableOwners } from "@/lib/owner";
import {
  ACCESS_TYPES,
  LENS_INFO,
  grantChipLabel,
  visibilitySummary,
  type AccessTypeKey,
} from "@/features/Permissions/lib/access-labels";
import { GrantForm } from "@/features/Permissions/components/GrantForm";
import {
  createTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  addGrant,
  removeGrant,
} from "@/features/Permissions/actions/teams";

/** Map a grant's scope_type → the mockup's grant-chip variant. */
function chipVariant(scopeType: string): string {
  return scopeType === "all"
    ? "everyone"
    : scopeType === "region"
      ? "region"
      : scopeType === "team"
        ? "team"
        : "";
}

const CHECK_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

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
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        {/* HEADER + HOW VISIBILITY WORKS */}
        <section className="card sec ad-section">
          <div className="eyebrow">Permissions · Visibility</div>
          <h2 className="ad-doc-title">Teams &amp; access</h2>
          <p className="ad-lead">
            Decide who can <b>see</b> what (kept separate from who can <b>do</b> what). Each person&apos;s
            visibility is the <b>sum</b> of the access rules you give them. Until someone has a rule, they
            keep the default — management sees everything, salespeople see their own — so you can roll this
            out one person at a time.
          </p>

          {m067Missing && (
            <div className="ad-callout warn">
              Visibility tables not found — apply migration <b>m067 (067_visibility_scopes.sql)</b> in
              Supabase, then reload.
            </div>
          )}
          {users.length === 0 && !m067Missing && (
            <div className="ad-callout">
              No users returned by <code>list_assignable_owners()</code> — apply migration <b>m066</b> (and
              ensure you&apos;re on a management role).
            </div>
          )}

          <div className="sx-micro" style={{ margin: "18px 0 8px" }}>
            How visibility works
          </div>
          <div className="ad-lens-grid">
            {typeKeys.map((k) => {
              const info = ACCESS_TYPES[k];
              return (
                <div key={k} className={`ad-lens ${k === "all" ? "broad" : "mid"}`}>
                  <div className="ll">{info.label}</div>
                  <div className="lh">{info.help}</div>
                  <div className="le">e.g. {info.example}</div>
                </div>
              );
            })}
          </div>

          <div className="card ad-sub-block" style={{ marginTop: 14 }}>
            <div className="ad-mini-h">What each department sees</div>
            <div style={{ marginTop: 8, display: "grid", gap: 6, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              {(Object.keys(LENS_INFO) as (keyof typeof LENS_INFO)[]).map((k) => (
                <div key={k} style={{ fontSize: 12, color: "var(--sx-mute)" }}>
                  <b style={{ color: "var(--sx-ink-soft)" }}>{LENS_INFO[k].label}</b>: {LENS_INFO[k].sees.join(", ")}.
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TEAMS & REGIONS */}
        <section className="card sec ad-section">
          <div className="sechead">
            <div>
              <div className="sx-micro">Teams &amp; regions</div>
              <p className="ad-lead">
                Group people so you can grant access to a whole team at once. A <b>region</b> bundles
                accounts by geography; a <b>team</b> bundles salespeople under a manager; a{" "}
                <b>department</b> is a back-office function (Production, Finance, Logistics).
              </p>
            </div>
            <span className="right ad-mono">{teams.length} total</span>
          </div>

          {/* Create team */}
          <form
            action={createTeam}
            className="card ad-subform"
            style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 10, marginTop: 12 }}
          >
            <div className="ad-field" style={{ margin: 0 }}>
              <label className="ad-fl">Name</label>
              <input name="name" type="text" required placeholder="Africa / TLM-North / Finance" style={{ width: 224 }} />
            </div>
            <div className="ad-field" style={{ margin: 0 }}>
              <label className="ad-fl">Kind</label>
              <select name="kind" defaultValue="team" style={{ width: "auto" }}>
                <option value="team">Team</option>
                <option value="region">Region</option>
                <option value="department">Department</option>
              </select>
            </div>
            <div className="ad-field" style={{ margin: 0 }}>
              <label className="ad-fl">Parent region (optional)</label>
              <select name="parent_team_id" defaultValue="__none__" style={{ width: "auto" }}>
                <option value="__none__">— none —</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="sx-btn sx-btn-ink" disabled={m067Missing}>
              + Create team
            </button>
          </form>

          {/* Team list */}
          <div style={{ marginTop: 12 }}>
            {teams.length === 0 ? (
              <p className="ad-lead">No teams yet.</p>
            ) : (
              teams.map((t) => {
                const members = membersByTeam.get(t.id) ?? [];
                return (
                  <div key={t.id} className="ad-cond-card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div className="ad-bank-top">
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</span>
                        <span className="ad-tag">{t.kind}</span>
                        {t.parent_team_id && (
                          <span style={{ fontSize: 11, color: "var(--sx-mute-2)" }}>in {teamName(t.parent_team_id)}</span>
                        )}
                      </div>
                      <form action={deleteTeam}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="sx-btn sx-btn-danger sx-btn-sm">Delete team</button>
                      </form>
                    </div>

                    {/* Members */}
                    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {members.length === 0 ? (
                        <span style={{ fontSize: 11, color: "var(--sx-mute-2)" }}>No members.</span>
                      ) : (
                        members.map((m) => (
                          <span key={m.user_id} className="ad-grant-chip">
                            {userName(m.user_id)}
                            {m.member_role === "manager" && (
                              <span style={{ fontSize: 9, textTransform: "uppercase", color: "var(--sx-green-deep)", fontWeight: 700 }}>
                                mgr
                              </span>
                            )}
                            <form action={removeTeamMember} style={{ display: "inline" }}>
                              <input type="hidden" name="team_id" value={t.id} />
                              <input type="hidden" name="user_id" value={m.user_id} />
                              <button className="x" aria-label="Remove">
                                ✕
                              </button>
                            </form>
                          </span>
                        ))
                      )}
                    </div>

                    {/* Add member */}
                    <form action={addTeamMember} className="ad-inline-form" style={{ marginTop: 10 }}>
                      <input type="hidden" name="team_id" value={t.id} />
                      <select name="user_id" required defaultValue="">
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
                      <select name="member_role" defaultValue="member">
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                      </select>
                      <button className="sx-btn sx-btn-sm">Add</button>
                    </form>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* VISIBILITY ACCESS (per person) */}
        <section className="card sec ad-section">
          <div className="sx-micro">Per-person access rules</div>
          <p className="ad-lead">
            For each person, the <b>Can currently see</b> line shows — in plain English — exactly what their
            rules add up to. Add a rule below; remove one with the ✕ on its chip.
          </p>

          <div style={{ marginTop: 12 }}>
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
                <div key={u.id} className="ad-access-card">
                  <div className="ad-access-head">
                    <div>
                      <span className="who">{u.name}</span>
                      {u.role && <span className="role-k">{u.role}</span>}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                      {isDefault ? (
                        <span className="ad-grant-chip">Role default</span>
                      ) : (
                        grants.map((g) => (
                          <span key={g.id} className={`ad-grant-chip ${chipVariant(g.scope_type)}`}>
                            {grantChipLabel(g.scope_type, teamName(g.team_id), g.lens_key)}
                            <form action={removeGrant} style={{ display: "inline" }}>
                              <input type="hidden" name="id" value={g.id} />
                              <button className="x" aria-label="Remove access rule">
                                ✕
                              </button>
                            </form>
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Live "can currently see" summary */}
                  <div className="ad-cansee">
                    <div className="lbl">Can currently see</div>
                    <ul>
                      {seeBullets.map((b, i) => (
                        <li key={i}>
                          <span className="ok">{CHECK_SVG}</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Add an access rule (conditional, self-explaining form). */}
                  {!m067Missing && (
                    <div style={{ marginTop: 11 }}>
                      <GrantForm userId={u.id} teams={teams} action={addGrant} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
