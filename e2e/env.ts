// =====================================================================
// E2E env loader — reads + validates credentials from process.env
// (populated via `node --env-file=.env.e2e`). Fails fast & loud if a
// required variable is missing. See docs/PLAN_E2E_HARNESS.md.
// =====================================================================

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `[e2e] Missing env var ${name}. Run with --env-file=.env.e2e and make ` +
        `sure .env.e2e exists (see docs/PLAN_E2E_HARNESS.md).`,
    );
  }
  return v.trim();
}

export const env = {
  baseUrl: process.env.E2E_BASE_URL?.trim() || "http://localhost:3000",
  password: required("E2E_PASSWORD"),
  emails: {
    sales: required("E2E_SALES_EMAIL"),
    director: required("E2E_DIR_EMAIL"),
    finance: required("E2E_FINANCE_EMAIL"),
    tlm: required("E2E_TLM_EMAIL"),
    operation: required("E2E_OPERATION_EMAIL"),
    admin: required("E2E_ADMIN_EMAIL"),
  },
};
