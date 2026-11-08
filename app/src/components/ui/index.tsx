import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

export function Panel({ title, icon, actions, children, className, bodyClass, subtitle }: { title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; subtitle?: ReactNode }) {
  return (
    <section className={clsx('flex min-h-0 flex-col rounded-lg border border-line bg-panel', className)}>
      {title && (
        <header className="flex items-center gap-2 border-b border-line/80 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[13.5px] font-semibold text-ink">{title}</h3>
            {subtitle && <p className="truncate text-2xs text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={clsx('min-h-0 flex-1', bodyClass ?? 'p-4')}>{children}</div>
    </section>
  );
}

export function StatusDot({ color, pulse, size = 8 }: { color: string; pulse?: boolean; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {pulse && <span className="absolute inset-0 animate-pulseRing rounded-full" style={{ background: color }} />}
      <span className="relative inline-block rounded-full" style={{ width: size, height: size, background: color, boxShadow: 'none' }} />
    </span>
  );
}

export function Badge({ color, children, pulse, className, solid }: { color: string; children: ReactNode; pulse?: boolean; className?: string; solid?: boolean }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-px text-[11px] font-medium', className)}
      style={{ color: solid ? '#FFFFFF' : color, background: solid ? color : `${color}14` }}
    >
      {/* Only urgent (rose) states animate; everything else is a static dot. */}
      {pulse !== undefined && <StatusDot color={solid ? '#FFFFFF' : color} pulse={pulse && color.toUpperCase() === '#E5364B'} size={6} />}
      {children}
    </span>
  );
}

export function ProgressBar({ value, color = '#2556E8', className, height = 6, track = '#E8EDF4' }: { value: number; color?: string; className?: string; height?: number; track?: string }) {
  return (
    <div className={clsx('w-full overflow-hidden rounded-full', className)} style={{ height, background: track }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('flex cursor-pointer items-center gap-3', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-[18px] w-8 shrink-0 rounded-full border transition-colors', checked ? 'border-accent/60 bg-accent/30' : 'border-line bg-base2')}
      >
        <span className={clsx('absolute top-[2px] h-3 w-3 rounded-full transition-all', checked ? 'left-[15px] bg-accent' : 'left-[2px] bg-muted')} />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-[12.5px] text-ink">{label}</span>}
          {description && <span className="block text-2xs text-muted">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, size = 'md', className }: { value: T; options: { value: T; label: ReactNode; icon?: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div className={clsx('inline-flex rounded-lg bg-base2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
            value === o.value ? 'bg-panel text-ink shadow-[0_0_0_1px_#E1E6EE]' : 'text-muted hover:text-ink',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; icon?: ReactNode; badge?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors',
            value === t.value ? 'text-accent' : 'text-muted hover:text-ink',
          )}
        >
          {t.icon}
          {t.label}
          {t.badge}
          {value === t.value && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  className,
  disabled,
  title,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'warn';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' && 'px-2.5 py-1.5 text-xs',
        size === 'md' && 'px-3.5 py-2 text-[13px]',
        size === 'lg' && 'px-5 py-2.5 text-sm',
        variant === 'primary' && 'bg-accent text-white shadow-sm hover:brightness-110',
        variant === 'secondary' && 'border border-line bg-elevated text-ink hover:border-accent/50 hover:text-accent',
        variant === 'ghost' && 'text-muted hover:bg-elevated hover:text-ink',
        variant === 'danger' && 'bg-crit text-white hover:brightness-110',
        variant === 'warn' && 'border border-warn/50 bg-warn/10 text-warn hover:bg-warn/20',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function KV({ k, v, mono, className }: { k: ReactNode; v: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3 py-1', className)}>
      <span className="shrink-0 text-xs text-muted">{k}</span>
      <span className={clsx('min-w-0 truncate text-right text-[12.5px] text-ink', mono && 'font-mono')}>{v}</span>
    </div>
  );
}

export function SimulatedTag({ className }: { className?: string }) {
  return (
    <span title="All values are generated by a local mock simulation" className={clsx('text-[11px] font-normal text-muted', className)}>
      Simulated
    </span>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('mb-2 text-[12px] font-semibold text-ink', className)}>{children}</div>;
}

/** Initials in a neutral circle; `color` draws a thin identifying ring (orange = missing person). */
export function Avatar({ name, size = 44, color = '#F26B1D' }: { name: string; size?: number; color?: string }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-base2 font-semibold text-ink"
      style={{ width: size, height: size, fontSize: size * 0.36, boxShadow: `inset 0 0 0 2px ${color}` }}
    >
      {initials}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children && <div className="max-w-sm text-xs text-muted">{children}</div>}
    </div>
  );
}

/** Plan → Search → Verify → Found. `step` is the index of the current stage. */
export function Stepper({ step, done, compact }: { step: number; done?: boolean; compact?: boolean }) {
  const steps = ['Plan', 'Search', 'Verify', 'Found'];
  return (
    <div className="flex items-start">
      {steps.map((label, i) => {
        const complete = i < step || (done && i === step);
        const current = i === step && !done;
        return (
          <div key={label} className="flex flex-1 items-start last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={clsx(
                  'flex items-center justify-center rounded-full font-semibold transition-colors',
                  compact ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-[11px]',
                  complete ? 'bg-ok text-white' : current ? 'bg-accent text-white' : 'bg-base2 text-muted',
                )}
              >
                {complete ? <Check size={compact ? 11 : 13} strokeWidth={3} /> : i + 1}
              </span>
              {!compact && <span className={clsx('text-[10.5px] font-medium', current ? 'text-ink' : 'text-muted')}>{label}</span>}
            </div>
            {i < steps.length - 1 && <span className={clsx('mx-1 h-0.5 flex-1 rounded-full', compact ? 'mt-2.5' : 'mt-3', i < step || (done && i + 1 === step) ? 'bg-ok' : 'bg-base2')} />}
          </div>
        );
      })}
    </div>
  );
}
