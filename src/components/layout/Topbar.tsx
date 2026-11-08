import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, BellOff, Clock } from 'lucide-react';
import NotificationCenter from '../alerts/NotificationCenter';
import { useAppStore } from '../../store/appStore';
import { formatClock } from '../../lib/format';
import { simClockMs } from '../../services/simulationService';
import { playDetectionAlert } from '../../services/audioService';

const TITLES: [string, string][] = [
  ['/map', 'Search map'],
  ['/drones', 'Drones'],
  ['/people', 'Missing persons'],
  ['/ground', 'Ground team'],
  ['/recovery', 'Recovery'],
  ['/', 'Overview'],
];

export default function Topbar() {
  const loc = useLocation();
  const title = TITLES.find(([p]) => (p === '/' ? loc.pathname === '/' : loc.pathname.startsWith(p)))?.[1] ?? 'LIFELINE';
  const onMap = loc.pathname.startsWith('/map');
  const missionId = useAppStore((s) => s.currentMissionId);
  const sess = useAppStore((s) => (missionId ? s.sessions[missionId] : undefined));
  const sound = useAppStore((s) => s.settings.sound);
  const update = useAppStore((s) => s.updateSettings);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const showSim = onMap && !!sess;
  const time = showSim ? simClockMs(sess!.sim) : now;

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-6">
      <h1 className="text-[16px] font-semibold text-ink">{title}</h1>
      <div className="flex-1" />
      <div className="flex items-center gap-2 rounded-lg bg-base px-3 py-1.5" title={showSim ? 'Simulated mission clock' : 'Local time'}>
        <Clock size={14} className="text-muted" />
        <span className="text-[11px] font-medium text-muted">{showSim ? 'Mission clock' : 'Local'}</span>
        <span className="font-mono text-[12px] tabular-nums text-ink">{formatClock(time)}</span>
      </div>
      <button
        onClick={() => {
          const next = !sound;
          update({ sound: next });
          if (next) playDetectionAlert(null);
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted hover:text-ink"
        title={sound ? 'Detection sound is on. Click to mute.' : 'Detection sound is muted. Click to turn on.'}
      >
        {sound ? <Bell size={15} className="text-ink" /> : <BellOff size={15} />}
        <span className="hidden md:inline">{sound ? 'Sighting alerts on' : 'Sighting alerts muted'}</span>
      </button>
      <NotificationCenter />
    </header>
  );
}
