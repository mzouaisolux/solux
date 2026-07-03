// Lightweight dependency-free SVG charts for the Sales-Intelligence page.
// Responsive via viewBox + width:100%. Neutral premium palette.

const INK = "#171717", MID = "#a3a3a3", LIGHT = "#ededed", GRID = "#f0f0f0";
export const C = { ink: INK, mid: MID, up: "#059669", down: "#e11d48", blue: "#2563eb", amber: "#d97706" };

export function fmtShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (a >= 1_000) return Math.round(n / 1_000) + "k";
  return String(Math.round(n));
}

/** Vertical bars with labels. */
export function Bars({ data, color = INK, height = 130 }: { data: { label: string; value: number }[]; color?: string; height?: number }) {
  const W = Math.max(320, data.length * 56);
  const H = height, pad = 26, bw = (W - pad) / data.length;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.value / max) * (H - 34);
        const x = i * bw + bw * 0.18, w = bw * 0.64, y = H - 20 - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={Math.max(0, h)} rx={3} fill={color} />
            <text x={x + w / 2} y={y - 4} textAnchor="middle" fontSize="10" fill={MID}>{d.value ? fmtShort(d.value) : ""}</text>
            <text x={x + w / 2} y={H - 6} textAnchor="middle" fontSize="10" fill={MID}>{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Two grouped bars per label (e.g. N-1 vs N). Optional onBar(i) for drill. */
export function GroupedBars({ labels, a, b, aName, bName, height = 150, onBar, active }: { labels: string[]; a: number[]; b: number[]; aName: string; bName: string; height?: number; onBar?: (i: number) => void; active?: number | null }) {
  const W = Math.max(360, labels.length * 46), H = height, pad = 24;
  const gw = (W - pad) / labels.length;
  const max = Math.max(1, ...a, ...b);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} preserveAspectRatio="none">
        {labels.map((l, i) => {
          const ha = (a[i] / max) * (H - 26), hb = (b[i] / max) * (H - 26);
          const x = i * gw + gw * 0.12, bw = gw * 0.34;
          return (
            <g key={i} onClick={onBar ? () => onBar(i) : undefined} style={onBar ? { cursor: "pointer" } : undefined}>
              {onBar && <rect x={i * gw} y={0} width={gw} height={H} fill={active === i ? "#00000010" : "transparent"} />}
              <rect x={x} y={H - 16 - ha} width={bw} height={Math.max(0, ha)} rx={2.5} fill={MID} />
              <rect x={x + bw + 2} y={H - 16 - hb} width={bw} height={Math.max(0, hb)} rx={2.5} fill={INK} />
              <text x={x + bw + 1} y={H - 4} textAnchor="middle" fontSize="9.5" fill={active === i ? INK : MID} fontWeight={active === i ? 700 : 400}>{l}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-3 text-[10px] text-neutral-400">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded" style={{ background: MID }} />{aName}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded" style={{ background: INK }} />{bName}</span>
      </div>
    </div>
  );
}

/** Multi-line chart (nulls break the line). */
export function Lines({ labels, series, height = 170 }: { labels: string[]; series: { name: string; points: (number | null)[]; color: string }[]; height?: number }) {
  const W = 640, H = height, padL = 8, padB = 18, padT = 10;
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p ?? 0)));
  const x = (i: number) => padL + (i / Math.max(1, labels.length - 1)) * (W - padL - 8);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {[0.25, 0.5, 0.75, 1].map((f, i) => (<line key={i} x1={padL} x2={W - 8} y1={y(max * f)} y2={y(max * f)} stroke={GRID} strokeWidth="1" />))}
        {series.map((s, si) => {
          const segs: string[] = []; let cur = "";
          s.points.forEach((p, i) => { if (p == null) { cur = ""; } else { cur += `${cur ? "L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)} `; segs.push(cur); } });
          const d = s.points.map((p, i) => (p == null ? "" : `${i === 0 || s.points[i - 1] == null ? "M" : "L"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`)).join(" ");
          return <path key={si} d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
        })}
        {labels.map((l, i) => (i % Math.ceil(labels.length / 12) === 0 ? <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9.5" fill={MID}>{l}</text> : null))}
      </svg>
      <div className="mt-1 flex gap-3 text-[10px] text-neutral-400">
        {series.map((s) => (<span key={s.name} className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded" style={{ background: s.color }} />{s.name}</span>))}
      </div>
    </div>
  );
}

/** Tiny inline bar sparkline for cards. */
export function Spark({ values, color = INK, width = 90, height = 26 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (!values.length) return null;
  const max = Math.max(1, ...values), bw = width / values.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block" }}>
      {values.map((v, i) => { const h = (v / max) * (height - 3); return <rect key={i} x={i * bw + 0.6} y={height - h} width={bw - 1.2} height={h} rx={1} fill={color} opacity={0.35 + 0.65 * (v / max)} />; })}
    </svg>
  );
}
