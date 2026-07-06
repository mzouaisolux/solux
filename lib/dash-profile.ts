// =====================================================================
// TEMPORARY perf instrumentation (dashboard load profiling).
//
// Monkey-patches the Supabase/PostgREST query builder's terminal `.then`
// ONCE to log, per query: duration (ms), rows returned, embedded joins,
// table, and filters. Pure logging — ZERO behavior change. Every line is
// emitted ONLY when process.env.DASH_PROFILE is set, so importing this in
// prod code is a no-op until the flag is on.
//
// Remove this file (and its imports in the dashboard) once the perf pass
// is done — it is not meant to ship.
// =====================================================================
import { PostgrestBuilder } from "@supabase/postgrest-js";

export const PROF_TAG = "⟦DASHPROF⟧";

/**
 * Patch the query builder so every awaited query self-logs. Idempotent
 * PER PROTOTYPE: HMR can swap in a fresh postgrest-js module (new prototype),
 * so we mark the patched `then` itself and re-patch whenever the current
 * prototype isn't ours — a module-global flag would wrongly skip the new one.
 */
export function enableQueryProfiling(): void {
  const proto: any = (PostgrestBuilder as any).prototype;
  const originalThen: (...a: any[]) => any = proto.then;
  if ((originalThen as any).__dashPatched) return;

  function patchedThen(this: any, onFulfilled: any, onRejected: any) {
    if (!process.env.DASH_PROFILE) {
      return originalThen.call(this, onFulfilled, onRejected);
    }
    const start = process.hrtime.bigint();

    let table = "?";
    let filters = "";
    let embeds = 0;
    try {
      table = this.url.pathname.split("/").pop() || "?";
      const search = decodeURIComponent(this.url.search || "");
      const sel = /[?&]select=([^&]*)/.exec(search);
      embeds = sel ? (sel[1].match(/\(/g) || []).length : 0;
      filters = search
        .replace(/[?&]select=[^&]*/, "")
        .replace(/^[?&]+/, "")
        .replace(/&+/g, " ")
        .slice(0, 160);
    } catch {
      /* best-effort labelling only */
    }

    const tap = (res: any) => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const rows = Array.isArray(res?.data)
        ? res.data.length
        : res?.data
          ? 1
          : 0;
      const err = res?.error
        ? ` ERR=${res.error.code || res.error.message}`
        : "";
      // tab-separated: TAG  ms  rows  embeds  method  table  filters
      // eslint-disable-next-line no-console
      console.log(
        `${PROF_TAG}\t${ms.toFixed(1)}\t${rows}\t${embeds}\t${this.method}\t${table}\t${filters}${err}`
      );
      return res;
    };

    return originalThen.call(
      this,
      (res: any) => (onFulfilled ? onFulfilled(tap(res)) : tap(res)),
      onRejected
    );
  }
  (patchedThen as any).__dashPatched = true;
  proto.then = patchedThen;
}

/** Time a synchronous or async JS block and log it under the same tag. */
export async function profStep<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  if (!process.env.DASH_PROFILE) return fn();
  const start = process.hrtime.bigint();
  const out = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const n = Array.isArray(out) ? ` rows=${out.length}` : "";
  // eslint-disable-next-line no-console
  console.log(`${PROF_TAG}\tJS\t${ms.toFixed(1)}\t${label}${n}`);
  return out;
}

/** Marker so a single dashboard load can be isolated in the log stream. */
export function profMark(msg: string): void {
  if (!process.env.DASH_PROFILE) return;
  // eslint-disable-next-line no-console
  console.log(`${PROF_TAG}\tMARK\t${msg}\t${process.hrtime.bigint()}`);
}
