interface Props {
  values: number[];
  width?: number;
  height?: number;
}

/** Mini-courbe SVG (sparkline) — verte si en hausse sur la fenêtre, rouge sinon. */
export function Sparkline({ values, width = 64, height = 18 }: Props) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const stroke = last >= first ? '#4ade80' : '#f87171';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
