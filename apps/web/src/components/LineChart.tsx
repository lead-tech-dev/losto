import { useEffect, useRef, useState } from 'react';

// Petite courbe en SVG, sans bibliothèque : une ou deux séries sur un axe de dates.
// Le dessin prend la largeur réelle de l'écran, pour que le texte garde sa taille sur téléphone.

export interface Series {
  name: string;
  color: string;
  points: { date: string; value: number }[];
}

interface Props {
  series: Series[];
  unit: string;
  height?: number;
}

const PAD = { top: 12, right: 12, bottom: 28, left: 44 };

// Graduations "rondes" (pas de 1, 2 ou 5 × 10^n) qui couvrent [min, max]
function niceTicks(min: number, max: number, target = 4): number[] {
  const raw = (max - min || Math.abs(max) || 1) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export default function LineChart({ series, unit, height = 220 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const all = series.flatMap((s) => s.points);
  if (all.length === 0) {
    return <p className="muted small chart-empty">Aucun relevé sur la période.</p>;
  }

  const times = all.map((p) => new Date(p.date).getTime());
  const values = all.map((p) => p.value);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const vMin = ticks[0];
  const vMax = ticks[ticks.length - 1];
  // Décimales seulement si une graduation n'est pas entière (glycémie 1,20 ; pas « 4,00 parents »)
  const decimals = ticks.every((t) => Number.isInteger(t)) ? 0 : vMax - vMin < 5 ? 2 : 0;

  const x = (t: number) => PAD.left + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - vMin) / (vMax - vMin || 1)) * (height - PAD.top - PAD.bottom);
  const dateLabel = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const dateTicks = tMax === tMin ? [tMin] : [tMin, (tMin + tMax) / 2, tMax];

  return (
    <figure className="chart" ref={ref}>
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`Courbe ${series.map((s) => s.name).join(' et ')}, ${all.length} relevés, en ${unit}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">
              {t.toFixed(decimals).replace('.', ',')}
            </text>
          </g>
        ))}
        {dateTicks.map((t, i) => (
          <text
            key={t}
            x={x(t)}
            y={height - 8}
            fontSize="12"
            fill="var(--muted)"
            textAnchor={i === 0 ? 'start' : i === dateTicks.length - 1 ? 'end' : 'middle'}
          >
            {dateLabel(t)}
          </text>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              points={s.points.map((p) => `${x(new Date(p.date).getTime())},${y(p.value)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {s.points.map((p) => (
              <circle key={p.date} cx={x(new Date(p.date).getTime())} cy={y(p.value)} r="3.5" fill={s.color}>
                <title>
                  {new Date(p.date).toLocaleDateString('fr-FR')} : {String(p.value).replace('.', ',')} {unit}
                </title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="legend">
        {series.length > 1 &&
          series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} /> {s.name}
            </span>
          ))}
        <span className="muted">en {unit}</span>
      </figcaption>
    </figure>
  );
}
