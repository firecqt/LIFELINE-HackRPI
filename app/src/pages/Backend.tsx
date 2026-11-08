/**
 * Backend link — create searches from the LIFELINE engine (/server + /engine), launch their
 * stream, and watch frames arrive. Wire types: src/api/contract.ts. Mapping: src/api/backendAdapter.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Rocket, Square } from 'lucide-react';
import { Button, Panel, ProgressBar, Segmented } from '../components/ui';
import { pingServer } from '../api/backendClient';
import { createEngineSearch, stopEngineSearch, tickRateFor, useEngineLinks, type EngineLink, type LinkStatus } from '../api/backendLink';
import { useAppStore } from '../store/appStore';
import { TICK_SEC } from '../services/simulationService';

const STATUS_META: Record<LinkStatus, { label: string; color: string }> = {
  ready: { label: 'Ready to launch', color: '#5F6B7D' },
  starting: { label: 'Starting stream', color: '#C88A04' },
  streaming: { label: 'Streaming', color: '#0E9F6E' },
  finished: { label: 'Run finished', color: '#5F6B7D' },
  stopped: { label: 'Stopped', color: '#5F6B7D' },
  replaced: { label: 'Replaced', color: '#5F6B7D' },
  error: { label: 'Error', color: '#E5364B' },
};

export default function Backend() {
  const [server, setServer] = useState<{ ok: boolean; message: string } | null>(null);
  const check = useCallback(async () => {
    setServer(null);
    setServer(await pingServer());
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  const links = useEngineLinks((s) => s.links);
  const list = Object.values(links).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="mx-auto max-w-[1180px] space-y-5 px-6 py-6">
      <div>
        <h1 className="text-[20px] font-semibold text-ink">Backend link</h1>
        <p className="mt-1 max-w-[780px] text-[13px] text-muted">
          Run a search on the LIFELINE engine and watch it on the search map. The engine sends the terrain, foliage, hiker and drone positions. The browser still
          computes the probability map, sightings and ground-team flow from those positions until the engine sends them too.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <ConnectionPanel server={server} onCheck={check} />
        <CreatePanel disabled={server !== null && !server.ok} />
      </div>

      <Panel title="Engine searches" subtitle={list.length ? 'The server streams one search at a time; launching one stops the others.' : undefined} bodyClass="p-0">
        {list.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] text-muted">
                  <th className="px-4 py-2 font-medium">Search</th>
                  <th className="px-3 py-2 font-medium">Simulation</th>
                  <th className="px-3 py-2 font-medium">Stream</th>
                  <th className="px-3 py-2 font-medium">Engine tick</th>
                  <th className="px-3 py-2 font-medium">Hiker (row, col)</th>
                  <th className="px-3 py-2 font-medium">Drones</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.map((l) => (
                  <LinkRow key={l.missionId} link={l} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-[13px] text-muted">No engine searches yet. Create one above.</div>
        )}
      </Panel>

      <ContractPanel />
    </div>
  );
}

function ConnectionPanel({ server, onCheck }: { server: { ok: boolean; message: string } | null; onCheck: () => void }) {
  const socket = useEngineLinks((s) => s.socket);
  const socketError = useEngineLinks((s) => s.socketError);
  const row = (label: string, ok: boolean | null, detail: string) => (
    <div className="flex items-center gap-3 py-2">
      <span className={clsx('h-2 w-2 shrink-0 rounded-full', ok === null ? 'bg-line' : ok ? 'bg-ok' : 'bg-crit')} />
      <span className="w-[120px] shrink-0 text-[13px] text-ink">{label}</span>
      <span className="min-w-0 truncate text-[12.5px] text-muted">{detail}</span>
    </div>
  );
  return (
    <Panel
      title="Connection"
      subtitle="Browser → /_backend (Vite proxy) → Node server :3000 → Python engine"
      actions={
        <Button size="sm" variant="ghost" onClick={onCheck} disabled={server === null}>
          {server === null ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check
        </Button>
      }
    >
      {row('Node server', server ? server.ok : null, server ? server.message : 'Checking…')}
      {row('Frame stream', socket === 'open' ? true : socketError ? false : null, socket === 'open' ? 'WebSocket open' : socket === 'connecting' ? 'Connecting…' : socketError ?? 'Opens when a search launches')}
      {server && !server.ok && (
        <div className="mt-3 rounded-md border border-line bg-base px-3 py-2.5 text-[12px] leading-relaxed text-muted">
          <div className="mb-1 font-medium text-ink">Start the backend</div>
          <div>
            1. <code className="text-ink">cd engine</code>, activate <code className="text-ink">.venv</code>, run <code className="text-ink">python api.py</code>
          </div>
          <div>
            2. <code className="text-ink">cd server</code>, add <code className="text-ink">MONGO_CONN</code> to <code className="text-ink">server/.env</code>, run <code className="text-ink">npm run dev</code>
          </div>
          <div className="mt-1">
            On Windows, ZeroMQ cannot use <code className="text-ink">ipc://</code>. Set <code className="text-ink">LIFELINE_IPC=tcp://127.0.0.1:5555</code> and{' '}
            <code className="text-ink">LIFELINE_IPC_EVENTS=tcp://127.0.0.1:5556</code> for both the engine and the server.
          </div>
        </div>
      )}
    </Panel>
  );
}

function NumberField({ label, value, onChange, min, max, step, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; min?: number; max?: number; step?: number; placeholder?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[12px] text-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] tabular-nums text-ink outline-none focus:border-accent"
      />
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function CreatePanel({ disabled }: { disabled: boolean }) {
  const navigate = useNavigate();
  const [isReal, setIsReal] = useState(false);
  const [N, setN] = useState('128');
  const [seed, setSeed] = useState('');
  const [offset, setOffset] = useState('1000');
  const [maxT, setMaxT] = useState('300');
  const [cell, setCell] = useState('60');
  const [hours, setHours] = useState('3');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(N) || 0;
  const km = (n * (Number(cell) || 0)) / 1000;
  const maxTn = Math.round(Number(maxT)) || 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createEngineSearch({
        isReal,
        N: Math.round(n),
        offset: Number(offset) || 0,
        seed: seed.trim() === '' ? null : Math.round(Number(seed)),
        maxTimestep: maxTn || 100,
        cellSizeM: Number(cell) || 60,
        hoursMissing: Number(hours) || 3,
        droneCount: 4,
      });
      navigate(`/map/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="New engine search" subtitle="POST /api/sim">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-[12px] text-muted">Data</span>
        <Segmented
          size="sm"
          value={isReal ? 'real' : 'fake'}
          onChange={(v) => setIsReal(v === 'real')}
          options={[
            { value: 'fake', label: 'Generated' },
            { value: 'real', label: 'Real' },
          ]}
        />
        {isReal && <span className="text-[11.5px] text-muted">Sends isReal: true. Today's server still generates fake terrain.</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <NumberField label="Grid size N" value={N} onChange={setN} min={16} max={1024} hint={n > 256 ? 'Large grids are slow in the browser' : `${n}×${n} cells`} />
        <NumberField label="Cell size (m)" value={cell} onChange={setCell} min={5} step={5} hint={`${km.toFixed(1)} km across`} />
        <NumberField label="Seed" value={seed} onChange={setSeed} min={0} placeholder="random" />
        <NumberField label="Base elevation (m)" value={offset} onChange={setOffset} step={50} />
        <NumberField label="Engine timesteps" value={maxT} onChange={setMaxT} min={1} hint={`≈ ${Math.round((maxTn * TICK_SEC) / 60)} min of search time`} />
        <NumberField label="Hours missing" value={hours} onChange={setHours} min={0.5} step={0.5} />
      </div>
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-crit/30 bg-crit/5 px-3 py-2 text-[12.5px] text-crit">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" onClick={submit} disabled={busy || disabled || n < 16 || n > 1024}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? 'Building search…' : 'Create and open on map'}
        </Button>
        {disabled && <span className="text-[12px] text-muted">Start the backend first.</span>}
      </div>
    </Panel>
  );
}

function LinkRow({ link }: { link: EngineLink }) {
  const navigate = useNavigate();
  const sess = useAppStore((s) => s.sessions[link.missionId]);
  const start = useAppStore((s) => s.start);
  const meta = STATUS_META[link.status];
  const live = link.status === 'streaming' || link.status === 'starting';
  const cur = link.hikerCurrent;
  return (
    <tr className="border-b border-line/70 align-top last:border-0">
      <td className="px-4 py-3">
        <div className="font-semibold text-ink">{link.missionId}</div>
        <div className="text-[11.5px] text-muted">{sess ? `${sess.env.grid.width}×${sess.env.grid.height} @ ${sess.env.grid.cellSizeM} m` : 'removed'}</div>
      </td>
      <td className="px-3 py-3">
        <div className="font-mono text-[11.5px] text-ink" title={link.simID}>
          {link.simID.slice(0, 13)}…
        </div>
        <div className="text-[11.5px] text-muted">
          {link.isReal ? 'real' : 'generated'} · seed {link.params.seed}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5 text-ink">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
          {meta.label}
        </div>
        <div className="text-[11.5px] text-muted">
          {link.frames} frame{link.frames === 1 ? '' : 's'}
          {link.tickRate ? ` · ${link.tickRate} ticks/s` : ''}
        </div>
        {link.error && <div className="max-w-[260px] text-[11.5px] text-crit">{link.error}</div>}
      </td>
      <td className="px-3 py-3">
        <div className="tabular-nums text-ink">
          {link.tick} / {link.params.maxTimestep}
        </div>
        <ProgressBar value={link.tick / Math.max(1, link.params.maxTimestep)} className="mt-1 w-24" height={4} />
      </td>
      <td className="px-3 py-3 tabular-nums">
        <div className="text-ink">{cur ? `${cur.y}, ${cur.x}` : '—'}</div>
        <div className="text-[11.5px] text-muted">
          from {link.hikerStart ? `${link.hikerStart.y}, ${link.hikerStart.x}` : '—'} to {link.hikerEnd ? `${link.hikerEnd.y}, ${link.hikerEnd.x}` : '—'}
        </div>
      </td>
      <td className="px-3 py-3 text-ink">{link.droneIds.length ? link.droneIds.join(', ') : '—'}</td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1.5">
          {live ? (
            <Button size="sm" onClick={() => stopEngineSearch(link.missionId)} title="DELETE /api/sim/stream">
              <Square size={12} /> Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => start(link.missionId)} disabled={!sess} title={`POST /api/sim/stream at ${tickRateFor(sess?.sim.speed ?? 1)} ticks/s`}>
              <Rocket size={13} /> {link.status === 'ready' ? 'Launch' : 'Run again'}
            </Button>
          )}
          <Button size="sm" onClick={() => navigate(`/map/${link.missionId}`)} disabled={!sess}>
            <ExternalLink size={13} /> Map
          </Button>
        </div>
      </td>
    </tr>
  );
}

function ContractPanel() {
  const rows: [string, string, string][] = [
    ['POST /api/sim', '{ N, offset?, seed?, maxTimestep?, isReal }', 'Terrain (elevation, canopy), perimeter and the hiker start/end. Start becomes the last known point.'],
    ['POST /api/sim/stream', '{ simID, tickRate }', 'Starts the engine clock. tickRate follows the map speed (1× ≈ 1.7 ticks/s).'],
    ['DELETE /api/sim/stream', '—', 'Stop, or restart from the map.'],
    ['WS /ws/sim/stream', '{ simID, tick, status, hiker: { current }, drones: [{ id, pos, laps }] }', 'Moves drones and the hidden hiker; drone passes update the probability map; a pass over the hiker raises a sighting.'],
  ];
  return (
    <Panel title="What the frontend uses" subtitle="One engine tick = 20 s of search time on the map" bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <tbody>
            {rows.map(([ep, body, use]) => (
              <tr key={ep} className="border-b border-line/70 last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11.5px] text-ink">{ep}</td>
                <td className="px-3 py-2.5 font-mono text-[11.5px] text-muted">{body}</td>
                <td className="px-4 py-2.5 text-muted">{use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
