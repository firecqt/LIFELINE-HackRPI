import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, BatteryLow, Bell, CheckCircle2, Info, Radar, ShieldAlert, X } from 'lucide-react';
import { useAppStore, type AlertItem } from '../../store/appStore';
import { relativeTime } from '../../lib/format';

export const SEVERITY_COLOR: Record<AlertItem['severity'], string> = {
  critical: '#E5364B',
  warning: '#C88A04',
  info: '#2556E8',
  success: '#0E9F6E',
};

export function AlertIcon({ a, size = 15 }: { a: AlertItem; size?: number }) {
  const c = SEVERITY_COLOR[a.severity];
  if (a.kind === 'detection') return <Radar size={size} color={c} />;
  if (a.kind === 'low_battery') return <BatteryLow size={size} color={c} />;
  if (a.kind === 'priority') return <ShieldAlert size={size} color={c} />;
  if (a.severity === 'success') return <CheckCircle2 size={size} color={c} />;
  if (a.severity === 'warning') return <AlertTriangle size={size} color={c} />;
  return <Info size={size} color={c} />;
}

export function useOpenAlert() {
  const navigate = useNavigate();
  const focusMap = useAppStore((s) => s.focusMap);
  const markRead = useAppStore((s) => s.markAlertRead);
  const setCurrent = useAppStore((s) => s.setCurrentMission);
  return (a: AlertItem) => {
    markRead(a.id);
    setCurrent(a.missionId);
    if (a.kind === 'ground_on_scene' && a.signalId) return navigate(`/ground?mission=${a.missionId}&signal=${a.signalId}`);
    if (a.kind === 'located') return navigate(`/recovery/${a.missionId}`);
    navigate(`/map/${a.missionId}`);
    if (a.x !== undefined && a.y !== undefined) setTimeout(() => focusMap(a.missionId, a.x!, a.y!, 6), 60);
  };
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const alerts = useAppStore((s) => s.alerts);
  const markAll = useAppStore((s) => s.markAllRead);
  const clear = useAppStore((s) => s.clearAlerts);
  const openAlert = useOpenAlert();
  const ref = useRef<HTMLDivElement>(null);
  const unread = alerts.filter((a) => !a.read).length;
  const critical = alerts.some((a) => !a.read && a.severity === 'critical');

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx('relative rounded-lg border p-2 transition-colors', open ? 'border-accent/50 bg-elevated text-accent' : 'border-line text-muted hover:text-ink')}
        title="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className={clsx('absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full px-1 text-center font-mono text-[10px] font-bold leading-[18px] text-white', critical ? 'bg-crit' : 'bg-warn')}>
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[380px] animate-slideIn overflow-hidden rounded-lg border border-line bg-panel shadow-float">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="text-[13px] font-semibold">Notifications</div>
            <div className="flex gap-3 text-[11px]">
              <button className="text-muted hover:text-accent" onClick={markAll}>
                Mark all read
              </button>
              <button className="text-muted hover:text-crit" onClick={clear}>
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {alerts.length === 0 && <div className="px-4 py-8 text-center text-xs text-muted">No alerts yet. Start a search simulation to generate operational events.</div>}
            {alerts.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  openAlert(a);
                  setOpen(false);
                }}
                className={clsx('flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left transition-colors hover:bg-elevated', !a.read && 'bg-elevated/40')}
              >
                <div className="mt-0.5">
                  <AlertIcon a={a} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12.5px] font-semibold" style={{ color: SEVERITY_COLOR[a.severity] }}>
                      {a.title}
                    </span>
                    {!a.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{a.message}</div>
                  <div className="mt-1 font-mono text-[10px] text-muted/70">
                    {a.missionId} · {relativeTime(a.at)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ToastStack() {
  const toasts = useAppStore((s) => s.toasts);
  const alerts = useAppStore((s) => s.alerts);
  const dismiss = useAppStore((s) => s.dismissToast);
  const openAlert = useOpenAlert();
  const loc = useLocation();
  // On a mission's search map the right panel already shows its sightings; don't cover it.
  // Likewise the Ground team page shows sightings/arrivals, and Recovery shows the find.
  const seg = loc.pathname.split('/');
  const hidden = (a: AlertItem) =>
    (seg[1] === 'map' && seg[2] === a.missionId && a.kind === 'detection') ||
    (seg[1] === 'ground' && (a.kind === 'detection' || a.kind === 'ground_on_scene')) ||
    (seg[1] === 'recovery' && seg[2] === a.missionId && a.kind === 'located');
  const items = (toasts.map((id) => alerts.find((a) => a.id === id)).filter(Boolean) as AlertItem[]).filter((a) => !hidden(a));

  useEffect(() => {
    const timers = items.map((a) => window.setTimeout(() => dismiss(a.id), a.severity === 'critical' ? 14000 : a.severity === 'warning' ? 6000 : 4500));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts.join(',')]);

  return (
    <div className="pointer-events-none fixed right-4 top-[68px] z-[60] flex w-[340px] flex-col gap-2">
      {items.map((a) => (
        <div
          key={a.id}
          className="pointer-events-auto animate-slideIn cursor-pointer overflow-hidden rounded-lg border bg-panel/95 shadow-float backdrop-blur"
          style={{ borderColor: `${SEVERITY_COLOR[a.severity]}66` }}
          onClick={() => {
            openAlert(a);
            dismiss(a.id);
          }}
        >
          <div className="h-0.5" style={{ background: SEVERITY_COLOR[a.severity] }} />
          <div className="flex gap-3 p-3">
            <AlertIcon a={a} size={17} />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold" style={{ color: SEVERITY_COLOR[a.severity] }}>
                {a.title}
              </div>
              <div className="mt-0.5 line-clamp-3 text-[11.5px] text-muted">{a.message}</div>
              <div className="mt-1 text-[10px] text-muted/80">{a.x !== undefined ? 'Click to focus map on location' : `Mission ${a.missionId}`}</div>
            </div>
            <button
              className="self-start text-muted hover:text-ink"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(a.id);
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
