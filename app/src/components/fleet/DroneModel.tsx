import type { DroneSpec } from '../../types/drone';

/** Stylized top-down render of an airframe (quad / hex / VTOL fixed-wing). */
export default function DroneModel({ spec, color, size = 120, spinning = false }: { spec: DroneSpec; color: string; size?: number; spinning?: boolean }) {
  const id = `dm-${spec.model.replace(/\W/g, '')}-${color.replace('#', '')}`;
  const rotor = (cx: number, cy: number, r: number, k: number) => (
    <g key={k}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(11,17,24,0.6)" stroke={color} strokeOpacity="0.55" strokeWidth="1" />
      <g style={spinning ? { transformOrigin: `${cx}px ${cy}px`, animation: `spin ${0.25 + (k % 2) * 0.05}s linear infinite` } : undefined}>
        <ellipse cx={cx} cy={cy} rx={r * 0.92} ry={r * 0.16} fill={color} fillOpacity="0.35" />
        <ellipse cx={cx} cy={cy} rx={r * 0.16} ry={r * 0.92} fill={color} fillOpacity="0.2" />
      </g>
      <circle cx={cx} cy={cy} r={2.4} fill="#cfd8e0" />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <defs>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a4a58" />
          <stop offset="1" stopColor="#1a252f" />
        </linearGradient>
        <radialGradient id={`${id}-g`}>
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <circle cx="60" cy="60" r="56" fill={`url(#${id}-g)`} />
      {spec.airframe === 'VTOL fixed-wing' ? (
        <g>
          <path d="M8 58 L112 58 L112 66 L8 66 Z" fill={`url(#${id}-b)`} stroke="#4a5b6a" />
          <path d="M54 14 L66 14 L68 104 L52 104 Z" fill={`url(#${id}-b)`} stroke="#4a5b6a" />
          <path d="M40 98 L80 98 L80 104 L40 104 Z" fill="#2a3742" stroke="#4a5b6a" />
          <path d="M30 40 L30 84 M90 40 L90 84" stroke="#4a5b6a" strokeWidth="3" />
          {rotor(30, 40, 11, 0)}
          {rotor(90, 40, 11, 1)}
          {rotor(30, 84, 11, 2)}
          {rotor(90, 84, 11, 3)}
          <path d="M56 10 L64 10 L62 20 L58 20 Z" fill={color} />
          <circle cx="60" cy="56" r="5" fill="#0b1118" stroke={color} />
        </g>
      ) : (
        <g>
          {(spec.airframe === 'Hexacopter' ? [0, 60, 120, 180, 240, 300] : [45, 135, 225, 315]).map((a, k) => {
            const r = spec.airframe === 'Hexacopter' ? 40 : 38;
            const x = 60 + Math.cos(((a - 90) * Math.PI) / 180) * r;
            const y = 60 + Math.sin(((a - 90) * Math.PI) / 180) * r;
            return (
              <g key={a}>
                <line x1="60" y1="60" x2={x} y2={y} stroke="#4a5b6a" strokeWidth="5" strokeLinecap="round" />
                <line x1="60" y1="60" x2={x} y2={y} stroke="#2a3742" strokeWidth="3" strokeLinecap="round" />
                {rotor(x, y, spec.airframe === 'Hexacopter' ? 13 : 16, k)}
              </g>
            );
          })}
          <rect x="44" y="40" width="32" height="40" rx="10" fill={`url(#${id}-b)`} stroke="#5a6b7a" />
          <rect x="50" y="46" width="20" height="10" rx="3" fill="#0b1118" stroke={color} strokeOpacity="0.6" />
          <circle cx="60" cy="86" r="6" fill="#0b1118" stroke={color} />
          <circle cx="60" cy="86" r="2.5" fill={color} />
          <path d="M56 36 L64 36 L60 30 Z" fill={color} />
        </g>
      )}
    </svg>
  );
}
