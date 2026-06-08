/**
 * Circular gauge showing a percentage 0–100. Inline SVG, no client JS.
 * The visible arc rotates from 12 o'clock and fills clockwise.
 */
export default function WinRateDonut({
  percentage,
  size = 140,
  stroke = 10,
}: {
  percentage: number;
  size?: number;
  stroke?: number;
}) {
  const pct = Math.max(0, Math.min(100, percentage));
  const radius = size / 2 - stroke;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (pct / 100) * circ;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Track ring (light gray) */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={stroke}
      />
      {/* Progress arc — rotated -90° so 0% starts at 12 o'clock */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="#22c55e"
        strokeWidth={stroke}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {/* Centered label */}
      <text
        x={cx}
        y={cy + 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.22}
        fontWeight={700}
        fill="#0b0f19"
      >
        {pct.toFixed(1).replace(/\.0$/, "")}
        <tspan fontSize={size * 0.13} fill="#6b7280">
          %
        </tspan>
      </text>
    </svg>
  );
}
