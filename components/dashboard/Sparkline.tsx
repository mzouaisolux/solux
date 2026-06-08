/**
 * Tiny inline-SVG sparkline. Server-renderable, zero dependencies.
 * Pass a list of numeric values; the component normalizes them to fit
 * the given width/height. Smooth + curve-less for that "premium SaaS"
 * micro-chart look.
 */
export default function Sparkline({
  values,
  width = 100,
  height = 32,
  stroke = "currentColor",
  strokeWidth = 1.5,
  fill,
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  /** If set, paints a soft area fill below the line. */
  fill?: string;
}) {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={stroke}
          strokeWidth={1}
          opacity={0.3}
        />
      </svg>
    );
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => {
    const x = i * step;
    // Inset 1px from top and bottom so stroke doesn't get clipped.
    const y =
      height -
      1 -
      ((v - min) / range) * (height - 2);
    return [x, y] as const;
  });
  const polyline = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = fill
    ? `M ${pts[0][0]},${height} L ${polyline.split(" ").join(" L ")} L ${pts[pts.length - 1][0]},${height} Z`
    : null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {areaPath && (
        <path d={areaPath} fill={fill} opacity={0.18} />
      )}
      <polyline
        points={polyline}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
