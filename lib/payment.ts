import {
  LC_DAYS_OPTIONS,
  type LCDays,
  type PaymentMode,
  type PaymentTerms,
} from "./types";

/**
 * Normalizes a terms payload to only the fields relevant for the chosen mode.
 * Prevents persisting stale fields left over from a mode switch.
 */
export function normalizePaymentTerms(
  mode: PaymentMode,
  terms: PaymentTerms
): PaymentTerms {
  if (mode === "deposit_balance") {
    return {
      deposit_percent: terms.deposit_percent,
      balance_condition: terms.balance_condition,
    };
  }
  if (mode === "lc") {
    const out: PaymentTerms = { lc_type: terms.lc_type };
    if (terms.lc_type === "usance") out.lc_days = terms.lc_days;
    return out;
  }
  // hybrid
  return {
    deposit_percent: terms.deposit_percent,
    lc_days: terms.lc_days,
  };
}

export function validatePaymentTerms(
  mode: PaymentMode,
  terms: PaymentTerms
): string | null {
  if (mode === "deposit_balance") {
    const pct = terms.deposit_percent;
    if (pct === undefined || pct < 0 || pct > 100) {
      return "Deposit % must be between 0 and 100";
    }
    if (!terms.balance_condition) return "Balance condition is required";
    return null;
  }
  if (mode === "lc") {
    if (!terms.lc_type) return "LC type is required";
    if (terms.lc_type === "usance") {
      if (!terms.lc_days || !(LC_DAYS_OPTIONS as readonly number[]).includes(terms.lc_days)) {
        return "LC days is required for usance (30, 60, 90 or 120)";
      }
    }
    return null;
  }
  if (mode === "hybrid") {
    const pct = terms.deposit_percent;
    if (pct === undefined || pct < 0 || pct > 100) {
      return "Deposit % must be between 0 and 100";
    }
    if (!terms.lc_days || !(LC_DAYS_OPTIONS as readonly number[]).includes(terms.lc_days)) {
      return "LC days is required (30, 60, 90 or 120)";
    }
    return null;
  }
  return "Unknown payment mode";
}

export function formatPaymentTerms(
  mode: PaymentMode | null | undefined,
  terms: PaymentTerms | null | undefined
): string {
  if (!mode || !terms) return "—";
  if (mode === "deposit_balance") {
    const deposit = Number(terms.deposit_percent ?? 0);
    const balance = Math.max(0, 100 - deposit);
    const cond =
      terms.balance_condition === "before_shipment"
        ? "before shipment"
        : "against documents";
    return `${deposit}% deposit, ${balance}% ${cond}`;
  }
  if (mode === "lc") {
    if (terms.lc_type === "at_sight") {
      return "Irrevocable Letter of Credit at sight";
    }
    return `Irrevocable Letter of Credit at ${terms.lc_days ?? "—"} days`;
  }
  if (mode === "hybrid") {
    return `${terms.deposit_percent ?? 0}% deposit, balance via L/C at ${
      terms.lc_days ?? "—"
    } days`;
  }
  return "—";
}

export function isLCDays(n: number | undefined): n is LCDays {
  return typeof n === "number" && (LC_DAYS_OPTIONS as readonly number[]).includes(n);
}
