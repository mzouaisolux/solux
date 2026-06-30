// =====================================================================
// E2E harness — static config: the 6 role accounts + paths.
// Paths are resolved from process.cwd() (npm runs scripts from the
// package root) so this works under both CJS and ESM module modes.
// See docs/PLAN_E2E_HARNESS.md.
// =====================================================================

import path from "node:path";
import { env } from "./env.ts";

export type E2ERole =
  | "sales"
  | "tlm"
  | "operation"
  | "finance"
  | "director"
  | "admin";

export interface RoleAccount {
  role: E2ERole;
  email: string;
  /** Value stored in user_roles.role for this account. */
  appRole: string;
  /** true = workflow actor; false = setup/cleanup only (admin). */
  actor: boolean;
  /** Human label for logs/reports. */
  label: string;
}

// Order = natural workflow order (Sales → TLM → Operations → Finance →
// Director), with Admin last (utility session, never a workflow actor).
export const ROLES: RoleAccount[] = [
  { role: "sales",     email: env.emails.sales,     appRole: "sales",             actor: true,  label: "Sales" },
  { role: "tlm",       email: env.emails.tlm,       appRole: "task_list_manager", actor: true,  label: "Task List Manager" },
  { role: "operation", email: env.emails.operation, appRole: "operations",        actor: true,  label: "Operations" },
  { role: "finance",   email: env.emails.finance,   appRole: "finance",           actor: true,  label: "Finance" },
  { role: "director",  email: env.emails.director,  appRole: "sales_director",    actor: true,  label: "Director" },
  { role: "admin",     email: env.emails.admin,     appRole: "admin",             actor: false, label: "Admin (setup/cleanup)" },
];

export const BASE_URL = env.baseUrl;

export const AUTH_DIR = path.join(process.cwd(), "e2e", ".auth");
export const RUNS_DIR = path.join(process.cwd(), "e2e", ".runs");

export function storageStatePath(role: E2ERole): string {
  return path.join(AUTH_DIR, `${role}.json`);
}
