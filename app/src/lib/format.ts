export const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0');

export function formatDuration(hours: number): string {
  const totalMin = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${pad2(m)}m` : `${m}m`;
}

export function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${pad2(s / 3600)}:${pad2((s % 3600) / 60)}:${pad2(s % 60)}`;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatProb(p: number): string {
  if (p === 0) return '0';
  if (p >= 0.01) return `${(p * 100).toFixed(2)}%`;
  return `${(p * 100).toFixed(3)}%`;
}

export function formatLatLon(lat: number, lon: number, digits = 4): string {
  return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`;
}

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function usd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
