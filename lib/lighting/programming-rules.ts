/**
 * PROGRAMMING-APPLICABILITY RULES (m180) — pure resolver, owner spec 2026-07-22.
 *
 * Not every product needs factory programming. Which task-list lines require
 * a Lighting Setup is decided by CONFIGURABLE rules (Admin → Programming
 * rules), never hardcoded in the UI — and this resolver is the ONE source of
 * truth shared by the line UI, the Pre-Validation board, the release gate,
 * exports and AI population.
 *
 * A rule matches on any combination of: product family (category), product,
 * SKU pattern, controller, and config values; every populated matcher must
 * hold (AND). The winning rule is the highest-priority match; ties break by
 * specificity (more populated matchers win). Outcome: required / optional /
 * not_applicable.
 *
 * DEFAULT WHEN NOTHING MATCHES: **optional** (owner question dismissed
 * 2026-07-22 — decision taken and documented here): an unmatched line CAN
 * carry a setup but never requires one, so nothing regresses or blocks on
 * day one; admins then tighten with explicit rules. Change DEFAULT_OUTCOME
 * to change the policy — nowhere else.
 *
 * Client + server safe (no DB access).
 */

import type { ProgrammingRequirement } from "./line-setup.ts";

export const DEFAULT_OUTCOME: ProgrammingRequirement = "optional";

export const RULE_OUTCOMES: ProgrammingRequirement[] = [
  "required",
  "optional",
  "not_applicable",
];

export const RULE_OUTCOME_LABELS: Record<ProgrammingRequirement, string> = {
  required: "Required",
  optional: "Optional",
  not_applicable: "Not applicable",
};

export type ProgrammingRule = {
  id: string;
  outcome: ProgrammingRequirement;
  /** Higher wins. */
  priority: number;
  /** Matchers — every populated one must hold (AND). */
  category_id: string | null;
  product_id: string | null;
  /** Case-insensitive substring/glob: "SSLX*" or plain "SSLX". */
  sku_pattern: string | null;
  /** Case-insensitive substring on the line's controller/driver text. */
  controller: string | null;
  /** Exact-match predicates on config_values, e.g. {"Battery":"100Ah"}. */
  config_match: Record<string, string> | null;
  active: boolean;
  notes: string | null;
};

/** What the resolver needs to know about a line. */
export type RuleSubject = {
  category_id: string | null;
  product_id: string | null;
  sku: string | null;
  controller: string | null;
  config_values: Record<string, unknown> | null;
};

function cleanStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export function normalizeRule(raw: unknown): ProgrammingRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = cleanStr(r.id);
  if (!id) return null;
  const outcome = (RULE_OUTCOMES as string[]).includes(String(r.outcome))
    ? (r.outcome as ProgrammingRequirement)
    : "optional";
  let config_match: Record<string, string> | null = null;
  if (r.config_match && typeof r.config_match === "object") {
    config_match = {};
    for (const [k, v] of Object.entries(r.config_match as Record<string, unknown>)) {
      if (typeof v === "string" && v !== "") config_match[k] = v;
    }
    if (Object.keys(config_match).length === 0) config_match = null;
  }
  const priority = Number(r.priority);
  return {
    id,
    outcome,
    priority: Number.isFinite(priority) ? priority : 0,
    category_id: cleanStr(r.category_id),
    product_id: cleanStr(r.product_id),
    sku_pattern: cleanStr(r.sku_pattern),
    controller: cleanStr(r.controller),
    config_match,
    active: r.active !== false,
    notes: cleanStr(r.notes),
  };
}

function skuMatches(pattern: string, sku: string | null): boolean {
  if (!sku) return false;
  const p = pattern.toLowerCase();
  const s = sku.toLowerCase();
  if (p.includes("*")) {
    const rx = new RegExp(
      "^" + p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"
    );
    return rx.test(s);
  }
  return s.includes(p);
}

function ruleMatches(rule: ProgrammingRule, line: RuleSubject): boolean {
  if (rule.category_id && rule.category_id !== line.category_id) return false;
  if (rule.product_id && rule.product_id !== line.product_id) return false;
  if (rule.sku_pattern && !skuMatches(rule.sku_pattern, line.sku)) return false;
  if (rule.controller) {
    const c = (line.controller ?? "").toLowerCase();
    if (!c.includes(rule.controller.toLowerCase())) return false;
  }
  if (rule.config_match) {
    const cfg = line.config_values ?? {};
    for (const [k, v] of Object.entries(rule.config_match)) {
      if (String((cfg as Record<string, unknown>)[k] ?? "") !== v) return false;
    }
  }
  // A rule with NO matchers at all is a catch-all — legal (e.g. a global
  // "everything optional unless said otherwise" baseline).
  return true;
}

function specificity(rule: ProgrammingRule): number {
  return (
    (rule.product_id ? 8 : 0) +
    (rule.sku_pattern ? 4 : 0) +
    (rule.category_id ? 2 : 0) +
    (rule.controller ? 1 : 0) +
    (rule.config_match ? 1 : 0)
  );
}

/**
 * THE resolver — one source of truth for "does this line need programming?".
 * Highest priority wins; ties break by specificity, then required >
 * not_applicable > optional (the stricter outcome when genuinely tied).
 */
export function resolveProgrammingRequirement(
  line: RuleSubject,
  rules: readonly ProgrammingRule[]
): { requirement: ProgrammingRequirement; rule: ProgrammingRule | null } {
  const strictness: Record<ProgrammingRequirement, number> = {
    required: 2,
    not_applicable: 1,
    optional: 0,
  };
  let best: ProgrammingRule | null = null;
  for (const rule of rules) {
    if (!rule.active || !ruleMatches(rule, line)) continue;
    if (
      !best ||
      rule.priority > best.priority ||
      (rule.priority === best.priority && specificity(rule) > specificity(best)) ||
      (rule.priority === best.priority &&
        specificity(rule) === specificity(best) &&
        strictness[rule.outcome] > strictness[best.outcome])
    ) {
      best = rule;
    }
  }
  return best
    ? { requirement: best.outcome, rule: best }
    : { requirement: DEFAULT_OUTCOME, rule: null };
}

/**
 * Build the resolver subject from a task-list line row. The controller/driver
 * signal is derived from config_values keys named like one — matching how
 * sales actually capture it — so rules can target controller types without a
 * dedicated column.
 */
export function ruleSubjectFromLine(line: {
  product_id?: unknown;
  category_id?: unknown;
  product_sku?: unknown;
  config_values?: unknown;
}): RuleSubject {
  const cfg =
    line.config_values && typeof line.config_values === "object"
      ? (line.config_values as Record<string, unknown>)
      : {};
  let controller: string | null = null;
  for (const [k, v] of Object.entries(cfg)) {
    if (/controller|driver/i.test(k) && typeof v === "string" && v.trim() !== "") {
      controller = v.trim();
      break;
    }
  }
  return {
    category_id: cleanStr(line.category_id),
    product_id: cleanStr(line.product_id),
    sku: cleanStr(line.product_sku),
    controller,
    config_values: cfg,
  };
}
