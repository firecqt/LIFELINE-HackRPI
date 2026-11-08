import { useEffect, useState } from 'react';
import { BarChart3, Gavel, Info, Radar, Rocket, ShieldAlert, UserCheck } from 'lucide-react';
import type { ActivityItem, ActivityKind } from '../../data/mockActivity';
import { relativeTime } from '../../lib/format';

const KIND: Record<ActivityKind, { icon: JSX.Element; color: string; label: string }> = {
  deploy: { icon: <Rocket size={13} />, color: '#2556E8', label: 'Deployment' },
  assignment: { icon: <Gavel size={13} />, color: '#475569', label: 'Assignment' },
  probability: { icon: <BarChart3 size={13} />, color: '#7C3AED', label: 'Probability' },
  detection: { icon: <Radar size={13} />, color: '#E5364B', label: 'Detection' },
  ranger: { icon: <UserCheck size={13} />, color: '#0891B2', label: 'Ranger' },
  warning: { icon: <ShieldAlert size={13} />, color: '#C88A04', label: 'Warning' },
  system: { icon: <Info size={13} />, color: '#5F6B7D', label: 'System' },
};

export default function ActivityFeed({ items, limit = 14, onOpen }: { items: ActivityItem[]; limit?: number; onOpen?: (missionId: string) => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="divide-y divide-line/60">
      {items.slice(0, limit).map((a) => {
        const k = KIND[a.kind];
        return (
          <button key={a.id} onClick={() => a.missionId && onOpen?.(a.missionId)} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-elevated/60">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: k.color }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] leading-snug text-ink">{a.message}</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                {k.label}
                {a.missionId && ` · ${a.missionId}`} · {relativeTime(a.at)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
