/**
 * PlaybackBar — one strip under the map: run/pause the (simulated) search, change speed, and
 * scrub back through how the probability map changed. "Live" always means the current state.
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Gavel, History, Pause, RotateCcw, Rocket } from 'lucide-react';
import type { SimState } from '../../types/simulation';
import { useAppStore } from '../../store/appStore';
import { Segmented } from '../ui';
import { formatElapsed } from '../../lib/format';

interface Props {
  sim: SimState;
  missionId: string;
  index: number | null; // null = live
  onIndex: (i: number | null) => void;
  auctionOpen: boolean;
  onAuction: () => void;
}

export default function PlaybackBar({ sim, missionId, index, onIndex, auctionOpen, onAuction }: Props) {
  const start = useAppStore((s) => s.start);
  const reset = useAppStore((s) => s.reset);
  const setSpeed = useAppStore((s) => s.setSpeed);
  const [replaying, setReplaying] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const snaps = sim.snapshots;
  const n = snaps.length;

  // Replay animation through recorded snapshots.
  useEffect(() => {
    if (!replaying) return;
    const id = window.setInterval(() => {
      if (index === null) return onIndex(0);
      if (index >= n - 1) {
        setReplaying(false);
        onIndex(null);
      } else onIndex(index + 1);
    }, 420);
    return () => clearInterval(id);
  }, [replaying, index, n, onIndex]);

  const live = index === null;
  const shownMin = live ? sim.elapsedSec / 60 : snaps[index]?.minutes ?? 0;

  const primary =
    sim.status === 'ready' ? (
      <button onClick={() => start(missionId)} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110">
        <Rocket size={15} /> Launch drones
      </button>
    ) : sim.status !== 'complete' ? (
      <span className="inline-flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-[13px] font-semibold text-accent">
        <span className="h-2 w-2 rounded-full bg-accent" />
        Searching
      </span>
    ) : (
      <span className="rounded-lg bg-base px-3 py-2 text-[12.5px] text-muted">{sim.outcome === 'located' ? 'Search complete' : 'Search closed'}</span>
    );

  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-line bg-panel px-4 py-2.5">
      {primary}
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] text-muted">Speed</span>
        <Segmented size="sm" value={sim.speed} onChange={(v) => setSpeed(missionId, v)} options={[1, 2, 5, 10].map((v) => ({ value: v, label: `${v}×` }))} />
      </div>

      <div className="flex min-w-[260px] flex-1 items-center gap-3">
        <button
          onClick={() => setReplaying((v) => !v)}
          disabled={n < 2}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base2 text-ink hover:bg-line disabled:opacity-40"
          title={replaying ? 'Stop replay' : 'Replay how the search map changed'}
        >
          {replaying ? <Pause size={13} /> : <History size={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={n}
          step={1}
          value={live ? n : index}
          onChange={(e) => {
            const v = Number(e.target.value);
            setReplaying(false);
            onIndex(v >= n ? null : v);
          }}
          className="flex-1"
          aria-label="Replay position"
        />
        <button
          onClick={() => {
            setReplaying(false);
            onIndex(null);
          }}
          className={clsx('w-[112px] shrink-0 rounded-full px-2.5 py-1 text-center text-[11.5px] font-semibold', live ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')}
          title="Jump back to live"
        >
          {live ? 'Live' : `Replaying ${Math.round(shownMin)} min`}
        </button>
      </div>

      <div className="text-[12px] text-muted">
        Search time <span className="font-semibold tabular-nums text-ink">{formatElapsed(sim.elapsedSec)}</span>
      </div>

      <button onClick={onAuction} className={clsx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium', auctionOpen ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-elevated hover:text-ink')} title="See how drones bid for search areas">
        <Gavel size={14} /> How drones pick areas
      </button>

      <div className="relative">
        <button onClick={() => setConfirmReset((v) => !v)} className="rounded-lg p-2 text-muted hover:bg-elevated hover:text-ink" title="Restart this simulation from the beginning">
          <RotateCcw size={15} />
        </button>
        {confirmReset && (
          <div className="absolute bottom-11 right-0 z-40 w-60 animate-slideIn rounded-lg border border-line bg-panel p-3 shadow-float">
            <div className="text-[12.5px] font-medium text-ink">Restart this simulation?</div>
            <div className="mt-1 text-[11.5px] text-muted">Drones return to base and the search starts over.</div>
            <div className="mt-2.5 flex gap-2">
              <button
                className="flex-1 rounded-md bg-crit px-2 py-1.5 text-xs font-semibold text-white"
                onClick={() => {
                  reset(missionId);
                  onIndex(null);
                  setConfirmReset(false);
                }}
              >
                Restart
              </button>
              <button className="flex-1 rounded-md border border-line px-2 py-1.5 text-xs text-muted" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
