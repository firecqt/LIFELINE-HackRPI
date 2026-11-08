/**
 * AuctionVisualizer — SIMULATED market-based allocation view. Shows the auctioned cell, the
 * candidate pool, every drone's bid breakdown, the winner and a chronological auction log.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Gavel, Trophy } from 'lucide-react';
import type { MissionEnvironment, SimState } from '../../types/simulation';
import { Badge } from '../ui';

export default function AuctionVisualizer({ sim, env, open, onToggle, onFocusBlock }: { sim: SimState; env: MissionEnvironment; open: boolean; onToggle: () => void; onFocusBlock: (x: number, y: number) => void }) {
  const [sel, setSel] = useState<number | null>(null); // auction id (null = follow live)
  const rounds = sim.auctions;
  // In live mode, advance the featured round at most every ~1.4 s so each one stays readable
  // even at 10× simulation speed.
  const latestId = rounds[rounds.length - 1]?.id ?? -1;
  const [liveId, setLiveId] = useState(latestId);
  const lastSwitch = useRef(0);
  useEffect(() => {
    if (latestId === liveId) return;
    const wait = Math.max(0, 1400 - (performance.now() - lastSwitch.current));
    const t = window.setTimeout(() => {
      lastSwitch.current = performance.now();
      setLiveId(latestId);
    }, wait);
    return () => clearTimeout(t);
  }, [latestId, liveId]);
  const round = useMemo(() => {
    const id = sel ?? liveId;
    return rounds.find((r) => r.id === id) ?? rounds[rounds.length - 1];
  }, [rounds, sel, liveId]);
  const idx = round ? rounds.findIndex((r) => r.id === round.id) : -1;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [sim.auctionLog.length, open]);
  const maxScore = round ? Math.max(1e-6, ...round.bids.map((b) => b.score)) : 1;
  const maxCand = round ? Math.max(1e-9, ...round.candidates.map((c) => c.value)) : 1;
  const totalRounds = sim.auctionSeq;

  return (
    <div className="shrink-0 border-t border-line bg-base2">
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-panel/60">
        <Gavel size={15} className="text-accent" />
        <span className="text-[12.5px] font-semibold text-ink">How drones pick search areas</span>
        <span className="text-[10px] text-info">simulated auction</span>
        {round && (
          <span className="ml-3 hidden truncate font-mono text-[11px] text-muted md:inline">
            Latest: <span className="text-ink">{round.blockId}</span> → <span style={{ color: round.bids.find((b) => b.droneId === round.winnerId)?.color }}>{round.winnerId ?? 'no award'}</span> · {round.bids.length} bids · {totalRounds} rounds total
          </span>
        )}
        <span className="ml-auto text-muted">{open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</span>
      </button>
      {open && (
        <div className="grid h-[228px] grid-cols-[200px_minmax(0,1fr)_minmax(0,300px)] gap-3 border-t border-line/70 px-4 pb-3 pt-2.5">
          {!round ? (
            <div className="col-span-3 flex items-center justify-center text-xs text-muted">No bids yet. Once drones launch, they bid for the most valuable unsearched squares; the best-placed drone wins each one.</div>
          ) : (
            <>
              {/* Candidate pool */}
              <div className="flex min-h-0 flex-col">
                <div className="mb-1.5 text-[10px] font-semibold text-muted">Available search cells</div>
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                  {round.candidates.map((c, i) => (
                    <button
                      key={c.blockId}
                      onClick={() => {
                        const b = env.blocks[c.blockIndex];
                        onFocusBlock(b.center.x, b.center.y);
                      }}
                      className={clsx('w-full rounded-md border px-2 py-1 text-left transition-colors hover:border-accent/50', i === 0 ? 'border-warn/50 bg-warn/5' : 'border-line bg-panel')}
                    >
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className={i === 0 ? 'text-warn' : 'text-ink'}>{c.blockId}</span>
                        <span className="text-muted">EDV {(c.value * 1e4).toFixed(1)}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-base">
                        <div className="h-full rounded-full bg-gradient-to-r from-info to-warn" style={{ width: `${(c.value / maxCand) * 100}%` }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              {/* Bids */}
              <div className="flex min-h-0 flex-col">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-muted">Round #{round.id}</span>
                  <button
                    className="rounded border border-warn/40 bg-warn/10 px-1.5 font-mono text-[11px] font-semibold text-warn hover:bg-warn/20"
                    onClick={() => onFocusBlock(round.center.x, round.center.y)}
                    title="Focus map on this cell"
                  >
                    {round.blockId}
                  </button>
                  <span className="font-mono text-[10.5px] text-muted">{round.clock} · sector {env.blocks[round.blockIndex]?.sector}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button disabled={idx <= 0} onClick={() => setSel(rounds[idx - 1].id)} className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-30">
                      <ChevronLeft size={14} />
                    </button>
                    <button disabled={idx < 0 || idx >= rounds.length - 1} onClick={() => setSel(rounds[idx + 1].id)} className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-30">
                      <ChevronRight size={14} />
                    </button>
                    <button
                      onClick={() => setSel(null)}
                      className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold', sel === null ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink')}
                    >
                      LIVE
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-panel text-[9.5px] uppercase tracking-wider text-muted">
                      <tr>
                        <th className="px-2 py-1 text-left font-semibold">Drone</th>
                        <th className="px-2 py-1 text-right font-semibold">Horiz.</th>
                        <th className="px-2 py-1 text-right font-semibold">Vert.</th>
                        <th className="px-2 py-1 text-right font-semibold">Battery</th>
                        <th className="px-2 py-1 text-right font-semibold">Load</th>
                        <th className="px-2 py-1 text-right font-semibold">EDV</th>
                        <th className="w-[28%] px-2 py-1 text-left font-semibold">Bid score</th>
                      </tr>
                    </thead>
                    <tbody key={round.id}>
                      {round.bids.map((b, i) => {
                        const won = b.droneId === round.winnerId;
                        return (
                          <tr key={b.droneId} className={clsx('animate-slideIn whitespace-nowrap border-t border-line/60 font-mono', won && 'bg-accent/10')} style={{ animationDelay: `${i * 70}ms`, animationFillMode: 'backwards' }}>
                            <td className="px-2 py-1">
                              <span className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full" style={{ background: b.color }} />
                                <span style={{ color: b.color }}>{b.droneId}</span>
                                {won && <Trophy size={11} className="text-accent" />}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-right text-ink">{(b.horizontalM / 1000).toFixed(2)} km</td>
                            <td className="px-2 py-1 text-right text-ink">{Math.round(b.verticalM)} m</td>
                            <td className="px-2 py-1 text-right text-ink">{b.batteryPct.toFixed(1)}%</td>
                            <td className="px-2 py-1 text-right text-muted">{b.load}</td>
                            <td className="px-2 py-1 text-right text-muted">{b.expectedValue.toFixed(1)}</td>
                            <td className="px-2 py-1">
                              <div className="flex items-center gap-1.5">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-base">
                                  <div className="h-full rounded-full" style={{ width: `${(b.score / maxScore) * 100}%`, background: won ? '#0E9F6E' : b.score === 0 ? '#E5364B' : '#2556E8' }} />
                                </div>
                                <span className={clsx('w-10 text-right', won ? 'text-accent' : 'text-ink')}>{b.score === 0 ? 'n/a' : b.score.toFixed(1)}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
                  <span>score = EDV ÷ (1 + d/600 m + Δh/250 m) ÷ (1 + 0.9·load) · infeasible if battery reserve &lt; 20%</span>
                  {round.winnerId && (
                    <Badge color="#0E9F6E" className="!py-0">
                      Awarded → {round.winnerId}
                    </Badge>
                  )}
                </div>
              </div>
              {/* Log */}
              <div className="flex min-h-0 flex-col">
                <div className="mb-1.5 text-[10px] font-semibold text-muted">Auction log</div>
                <div ref={logRef} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-base/60 p-2 font-mono text-[10.5px]">
                  {sim.auctionLog.slice(-80).map((e) => (
                    <div key={e.id} className="flex gap-2">
                      <span className="shrink-0 text-muted/70">{e.clock}</span>
                      <span className={clsx(e.kind === 'win' ? 'font-semibold text-accent' : e.kind === 'update' ? 'text-info' : 'text-ink/85')}>{e.message}</span>
                    </div>
                  ))}
                  {!sim.auctionLog.length && <div className="text-muted">Awaiting first auction round…</div>}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
