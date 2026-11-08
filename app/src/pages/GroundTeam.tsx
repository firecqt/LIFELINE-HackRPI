/**
 * Ground Team — the field view. Lists every signal a team has been sent to, and lets the team on
 * scene confirm whether they found a person and whether it is the missing subject. Only this
 * confirmation ends a search; the drone detection alone never does.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Check, CheckCircle2, ClipboardCheck, Footprints, HelpCircle, Map as MapIcon, PawPrint, Radio, User, UserX, Users } from 'lucide-react';
import type { MissingPersonReport } from '../types/mission';
import type { DetectionSignal, FieldVerdict, MissionEnvironment, SimState, SubjectCondition } from '../types/simulation';
import { Avatar, Badge, ProgressBar, SectionLabel, SimulatedTag } from '../components/ui';
import ThermalFrame from '../components/operations/ThermalFrame';
import { useAppStore } from '../store/appStore';
import { CONDITION_LABELS, GROUND_TEAM, fieldObservation, identityChecks } from '../services/groundTeamService';
import { cellToLatLon } from '../services/terrainService';
import { tickSecOf } from '../services/simulationService';
import { PRIORITY_META, SIGNAL_STATUS_META } from '../lib/statusMeta';
import { formatLatLon } from '../lib/format';

interface Task {
  missionId: string;
  sig: DetectionSignal;
  sim: SimState;
  env: MissionEnvironment;
}

const ACTIVE = new Set(['verifying', 'on_scene']);
const DONE = new Set(['confirmed', 'not_subject', 'false_positive']);

export default function GroundTeam() {
  const sessions = useAppStore((s) => s.sessions);
  const [params, setParams] = useSearchParams();

  const tasks: Task[] = useMemo(
    () =>
      Object.entries(sessions).flatMap(([missionId, { sim, env }]) =>
        sim.signals.filter((sig) => ACTIVE.has(sig.status) || (DONE.has(sig.status) && sig.fieldReport)).map((sig) => ({ missionId, sig, sim, env })),
      ),
    [sessions],
  );
  const active = tasks.filter((t) => ACTIVE.has(t.sig.status)).sort((a, b) => (a.sig.status === 'on_scene' ? -1 : 1) - (b.sig.status === 'on_scene' ? -1 : 1));
  const done = tasks.filter((t) => DONE.has(t.sig.status));
  const selKey = params.get('mission') && params.get('signal') ? `${params.get('mission')}|${params.get('signal')}` : null;
  const selected = tasks.find((t) => `${t.missionId}|${t.sig.id}` === selKey) ?? active[0] ?? done[0] ?? null;
  const select = (t: Task) => setParams({ mission: t.missionId, signal: t.sig.id }, { replace: true });

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="border-b border-line p-4">
          <div className="flex items-center gap-2">
            <Footprints size={16} className="text-accent" />
            <span className="text-[14px] font-semibold text-ink">{GROUND_TEAM.callsign}</span>
            <SimulatedTag className="ml-auto" />
          </div>
          <div className="mt-1 text-[11.5px] text-muted">{GROUND_TEAM.members.join(' · ')}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <SectionLabel>Active tasks ({active.length})</SectionLabel>
          <div className="space-y-2">
            {active.map((t) => (
              <TaskItem key={`${t.missionId}|${t.sig.id}`} t={t} selected={selected === t} onClick={() => select(t)} />
            ))}
            {!active.length && <div className="rounded-lg bg-base px-3 py-4 text-center text-[12px] text-muted">No team dispatched. When a drone flags a potential person, a ranger sends the team from the Map.</div>}
          </div>
          {done.length > 0 && (
            <>
              <div className="mt-5" />
              <SectionLabel>Completed</SectionLabel>
              <div className="space-y-2">
                {done.map((t) => (
                  <TaskItem key={`${t.missionId}|${t.sig.id}`} t={t} selected={selected === t} onClick={() => select(t)} />
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {selected ? <TaskView key={`${selected.missionId}|${selected.sig.id}`} t={selected} /> : <NoTask />}
      </div>
    </div>
  );
}

function NoTask() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col items-center justify-center p-10 text-center">
      <Footprints size={34} className="text-muted" />
      <h2 className="mt-3 text-lg font-semibold text-ink">No field tasks yet</h2>
      <p className="mt-1 max-w-md text-[13px] text-muted">
        When a drone reports a potential person, dispatch the ground team from the detection alert on the Map. Their confirmation form will appear here.
      </p>
      <button onClick={() => navigate('/map')} className="mt-4 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white">
        Go to the Map
      </button>
    </div>
  );
}

function etaInfo(t: Task) {
  const { sig, sim } = t;
  const total = Math.max(1, (sig.etaTick ?? sim.tick) - (sig.dispatchTick ?? sim.tick));
  const left = Math.max(0, (sig.etaTick ?? sim.tick) - sim.tick);
  return { progress: 1 - left / total, minutes: Math.round((left * tickSecOf(t.env)) / 60) };
}

function TaskItem({ t, selected, onClick }: { t: Task; selected: boolean; onClick: () => void }) {
  const meta = SIGNAL_STATUS_META[t.sig.status];
  const eta = etaInfo(t);
  return (
    <button onClick={onClick} className={clsx('w-full rounded-lg border p-3 text-left transition-colors', selected ? 'border-accent bg-accent/5' : 'border-line hover:bg-elevated')}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] font-semibold text-ink">{t.sig.id}</span>
        <span className="font-mono text-[11px] text-muted">{t.missionId}</span>
        <span className="ml-auto">
          <Badge color={meta.color} pulse={t.sig.status === 'on_scene' ? true : undefined}>
            {meta.label}
          </Badge>
        </span>
      </div>
      <div className="mt-1 text-[12.5px] text-ink">Searching for {t.env.report.name}</div>
      {t.sig.status === 'verifying' && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
          <ProgressBar value={eta.progress} color="#C88A04" height={4} className="flex-1" />
          <span>ETA {eta.minutes} min</span>
        </div>
      )}
      {t.sig.status === 'on_scene' && <div className="mt-1 text-[11.5px] font-medium text-warn">Confirmation needed</div>}
    </button>
  );
}

function TaskView({ t }: { t: Task }) {
  const { sig, env, missionId } = t;
  const r = env.report;
  const ll = cellToLatLon(env.grid, sig.x, sig.y);
  const obs = fieldObservation(sig, r, missionId);
  const onScene = sig.status === 'on_scene';
  const enRoute = sig.status === 'verifying';
  const eta = etaInfo(t);
  const step = enRoute ? 1 : onScene ? 2 : 3;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className="font-mono">{sig.id}</span>·<span className="font-mono">{missionId}</span>·<span>{env.park.name}</span>
          </div>
          <h2 className="mt-0.5 text-[22px] font-semibold tracking-tight text-ink">Verify the signal from drone {sig.droneId}</h2>
          <div className="mt-0.5 font-mono text-[12px] text-info">{formatLatLon(ll.latitude, ll.longitude, 5)}</div>
        </div>
        <Stepper step={step} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SubjectCard r={r} />
        <section className="rounded-lg border border-line bg-panel p-4">
          <SectionLabel>What the team found</SectionLabel>
          {enRoute ? (
            <div>
              <div className="flex items-center gap-2 text-[13px] text-ink">
                <Radio size={15} className="text-warn" /> Team en route, about {eta.minutes} min away (simulated time)
              </div>
              <ProgressBar value={eta.progress} color="#C88A04" height={8} className="mt-3" />
              <div className="mt-4 flex gap-3">
                <ThermalFrame seed={sig.tick * 7 + sig.id.length} humanLike={sig.isTrue} />
                <div className="text-[12px] text-muted">
                  Drone thermal frame at {sig.clock}. Model confidence {(sig.confidence * 100).toFixed(0)}%. The confirmation form unlocks when the team reaches the location.
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start gap-3">
                <span className={clsx('rounded-lg p-2', obs.kind === 'person' ? 'bg-info/10 text-info' : 'bg-base text-muted')}>
                  {obs.kind === 'person' ? <User size={18} /> : obs.kind === 'animal' ? <PawPrint size={18} /> : <HelpCircle size={18} />}
                </span>
                <div>
                  <div className="text-[14px] font-semibold text-ink">{obs.headline}</div>
                  <div className="text-[11px] text-muted">Field observation · {GROUND_TEAM.callsign} (simulated)</div>
                </div>
              </div>
              <ul className="mt-3 space-y-1.5 text-[12.5px] text-ink">
                {obs.details.map((d) => (
                  <li key={d} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" />
                    {d}
                  </li>
                ))}
              </ul>
              {obs.response && <div className="mt-3 rounded-lg bg-base px-3 py-2 text-[12.5px] italic text-ink">“{obs.response}”</div>}
              <div className="mt-3 flex items-center gap-3">
                <ThermalFrame seed={sig.tick * 7 + sig.id.length} humanLike={sig.isTrue} />
                <div className="text-[11.5px] text-muted">Original drone frame from {sig.droneId} at {sig.clock}.</div>
              </div>
            </div>
          )}
        </section>
      </div>

      {onScene && <ConfirmForm t={t} />}
      {sig.fieldReport && <FiledReport t={t} />}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = ['Dispatched', 'En route', 'On scene', 'Confirmed'];
  return (
    <div className="ml-auto flex items-center gap-1.5">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold', i < step ? 'bg-ok text-white' : i === step ? 'border-2 border-accent text-accent' : 'border border-line text-muted')}>
            {i < step ? <Check size={13} /> : i + 1}
          </span>
          <span className={clsx('text-[12px]', i <= step ? 'text-ink' : 'text-muted')}>{s}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-5 bg-line" />}
        </div>
      ))}
    </div>
  );
}

function SubjectCard({ r }: { r: MissingPersonReport }) {
  const pr = PRIORITY_META[r.priority];
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <SectionLabel>Who we are looking for</SectionLabel>
      <div className="flex items-center gap-3">
        <Avatar name={r.name} size={56} color={pr.color} />
        <div>
          <div className="text-[17px] font-semibold text-ink">{r.name}</div>
          <div className="text-[12.5px] text-muted">
            {r.age} yrs · {r.sex === 'F' ? 'Female' : r.sex === 'M' ? 'Male' : '—'} · {r.heightCm} cm
          </div>
        </div>
      </div>
      <dl className="mt-3 space-y-2 text-[12.5px]">
        {[
          ['Description', r.description],
          ['Clothing', r.clothing],
          ['Gear', r.equipment],
          ['Medical', r.medical],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] font-medium text-muted">{k}</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Choice({ selected, onClick, icon, title, desc, tone = 'accent' }: { selected: boolean; onClick: () => void; icon: ReactNode; title: string; desc: string; tone?: 'accent' | 'muted' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex flex-1 items-start gap-3 rounded-lg border-2 p-3.5 text-left transition-colors',
        selected ? (tone === 'accent' ? 'border-accent bg-accent/5' : 'border-ink/60 bg-base') : 'border-line hover:border-muted/50',
      )}
    >
      <span className={clsx('mt-0.5', selected && tone === 'accent' ? 'text-accent' : 'text-muted')}>{icon}</span>
      <span>
        <span className="block text-[13.5px] font-semibold text-ink">{title}</span>
        <span className="block text-[12px] text-muted">{desc}</span>
      </span>
    </button>
  );
}

function ConfirmForm({ t }: { t: Task }) {
  const confirm = useAppStore((s) => s.confirmSignal);
  const navigate = useNavigate();
  const r = t.env.report;
  const first = r.name.split(' ')[0];
  const checks = identityChecks(r);
  const [isPerson, setIsPerson] = useState<boolean | null>(null);
  const [isSubject, setIsSubject] = useState<boolean | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [condition, setCondition] = useState<SubjectCondition | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isPerson) setIsSubject(null);
  }, [isPerson]);

  const verdict: FieldVerdict | null = isPerson === false ? 'not_human' : isPerson && isSubject === false ? 'other_person' : isPerson && isSubject ? 'subject' : null;
  const enoughChecks = ticked.length >= 2;
  const ready = verdict === 'not_human' || verdict === 'other_person' || (verdict === 'subject' && enoughChecks && condition !== null);

  const submit = () => {
    if (!verdict || !ready) return;
    confirm(t.missionId, t.sig.id, { verdict, condition: verdict === 'subject' ? condition : null, checks: verdict === 'subject' ? ticked : [], notes: notes.trim() });
    if (verdict === 'subject') navigate(`/recovery/${t.missionId}`);
  };

  return (
    <section className="rounded-lg border-2 border-warn/50 bg-panel p-5">
      <div className="flex items-center gap-2">
        <ClipboardCheck size={18} className="text-warn" />
        <h3 className="text-[16px] font-semibold text-ink">Field confirmation</h3>
        <span className="text-[12px] text-muted">The search only ends when the team confirms the subject.</span>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[13px] font-medium text-ink">1. Is it a person?</div>
        <div className="flex flex-wrap gap-3">
          <Choice selected={isPerson === true} onClick={() => setIsPerson(true)} icon={<User size={18} />} title="Yes, a person" desc="A human is at the signal location" />
          <Choice selected={isPerson === false} onClick={() => setIsPerson(false)} icon={<PawPrint size={18} />} title="No person" desc="Animal, warm rock or other heat source" tone="muted" />
        </div>
      </div>

      {isPerson && (
        <div className="mt-5">
          <div className="mb-2 text-[13px] font-medium text-ink">2. Is this {r.name}?</div>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            {checks.map((c) => {
              const on = ticked.includes(c);
              return (
                <label key={c} className={clsx('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[12.5px]', on ? 'border-accent/60 bg-accent/5 text-ink' : 'border-line text-ink/90 hover:bg-elevated')}>
                  <input type="checkbox" className="accent-[#0E9F6E]" checked={on} onChange={() => setTicked((v) => (on ? v.filter((x) => x !== c) : [...v, c]))} />
                  {c}
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3">
            <Choice selected={isSubject === true} onClick={() => setIsSubject(true)} icon={<CheckCircle2 size={18} />} title={`Yes, this is ${first}`} desc="Identity checks match the report" />
            <Choice selected={isSubject === false} onClick={() => setIsSubject(false)} icon={<UserX size={18} />} title="No, a different person" desc="Someone else; the search continues" tone="muted" />
          </div>
          {isSubject && !enoughChecks && <div className="mt-2 text-[12px] text-warn">Tick at least two identity checks before confirming.</div>}
        </div>
      )}

      {verdict === 'subject' && (
        <div className="mt-5">
          <div className="mb-2 text-[13px] font-medium text-ink">3. {first}'s condition</div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CONDITION_LABELS) as SubjectCondition[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCondition(c)}
                className={clsx('rounded-lg border-2 px-3 py-2 text-[12.5px] font-medium', condition === c ? (c === 'needs_evacuation' ? 'border-crit bg-crit/5 text-crit' : 'border-accent bg-accent/5 text-accent') : 'border-line text-ink hover:border-muted/50')}
              >
                {CONDITION_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
      )}

      {verdict && (
        <div className="mt-5">
          <div className="mb-2 text-[13px] font-medium text-ink">Notes (optional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={verdict === 'subject' ? 'e.g. Found sheltering under a rock overhang, mild hypothermia, warming with blankets.' : 'e.g. Elk herd bedded down; no human tracks.'}
            className="w-full rounded-lg border border-line bg-base px-3 py-2 text-[12.5px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </div>
      )}

      <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
        <button
          onClick={submit}
          disabled={!ready}
          className={clsx('inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[13.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40', verdict === 'subject' ? 'bg-ok' : 'bg-ink')}
        >
          <ClipboardCheck size={16} />
          {verdict === 'subject' ? `Confirm ${first} found` : verdict ? 'Report: not the subject' : 'Submit confirmation'}
        </button>
        <span className="text-[12px] text-muted">
          {verdict === 'subject' ? 'Ends the search, recalls the drones and opens the recovery map.' : verdict ? 'Clears this area; the drones keep searching.' : 'Answer the questions above.'}
        </span>
      </div>
    </section>
  );
}

function FiledReport({ t }: { t: Task }) {
  const navigate = useNavigate();
  const fr = t.sig.fieldReport!;
  const subject = fr.verdict === 'subject';
  return (
    <section className={clsx('rounded-lg border-2 p-5', subject ? 'border-ok/60 bg-ok/5' : 'border-line bg-panel')}>
      <div className="flex flex-wrap items-center gap-3">
        {subject ? <CheckCircle2 className="text-ok" size={22} /> : <Users className="text-muted" size={20} />}
        <div className="flex-1">
          <div className="text-[15px] font-semibold text-ink">
            {subject ? `${t.env.report.name} confirmed found` : fr.verdict === 'other_person' ? 'A different person, not the subject' : 'No person at this location'}
          </div>
          <div className="text-[12px] text-muted">
            Filed by {GROUND_TEAM.callsign} at {fr.clock}
            {fr.condition && ` · ${CONDITION_LABELS[fr.condition]}`}
          </div>
        </div>
        {subject ? (
          <button onClick={() => navigate(`/recovery/${t.missionId}`)} className="inline-flex items-center gap-1.5 rounded-lg bg-ok px-4 py-2 text-[13px] font-semibold text-white">
            <MapIcon size={14} /> Open recovery map
          </button>
        ) : (
          <button onClick={() => navigate(`/map/${t.missionId}`)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-ink hover:bg-elevated">
            <MapIcon size={14} /> Back to the search map
          </button>
        )}
      </div>
      {(fr.checks.length > 0 || fr.notes) && (
        <div className="mt-3 space-y-1 text-[12.5px] text-ink">
          {fr.checks.map((c) => (
            <div key={c} className="flex items-center gap-2">
              <Check size={13} className="text-ok" /> {c}
            </div>
          ))}
          {fr.notes && <div className="pt-1 italic text-muted">“{fr.notes}”</div>}
        </div>
      )}
    </section>
  );
}
