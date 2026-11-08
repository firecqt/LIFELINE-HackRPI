export function DroneIcon({ size = 18, className, color = 'currentColor' }: { size?: number; className?: string; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="5" cy="5" r="2.6" />
      <circle cx="19" cy="5" r="2.6" />
      <circle cx="5" cy="19" r="2.6" />
      <circle cx="19" cy="19" r="2.6" />
      <path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" />
    </svg>
  );
}

export function LifelineLogo({ size = 30 }: { size?: number }) {
  return <img src="/logo.png" width={size} height={size} alt="LIFELINE" className="shrink-0 select-none" draggable={false} />;
}
