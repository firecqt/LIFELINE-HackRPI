/**
 * HTTP + WebSocket client for the LIFELINE backend. Everything goes through the Vite proxy at
 * /_backend (see vite.config.ts), which forwards to the Node server on :3000.
 */
import { isSimFrame, type CreateSimRequest, type CreateSimResponse, type SimFrame, type StartStreamResponse, type SignalAction, type StopStreamResponse } from './contract';

export const BACKEND_BASE = '/_backend';
const DOWN_MSG = 'Cannot reach the backend. Is the server running (cd server && npm run dev)?';

export class BackendError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BACKEND_BASE + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new BackendError(DOWN_MSG, 0);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    // The Vite proxy answers 500/502/504 with an empty body when the server is down.
    if (res.status >= 500 && !text) throw new BackendError(DOWN_MSG, res.status);
    const msg = (body as { error?: string } | null)?.error ?? (text && text.length < 200 ? text : res.statusText);
    throw new BackendError(msg || `HTTP ${res.status}`, res.status);
  }
  return body as T;
}

/** Health check: the Node server serves its own test page at "/", so any 2xx means it is up. */
export async function pingServer(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${BACKEND_BASE}/`, { method: 'HEAD' });
    if (res.ok) return { ok: true, message: 'Server responding' };
    return { ok: false, message: res.status >= 500 ? DOWN_MSG : `Server answered HTTP ${res.status}` };
  } catch {
    return { ok: false, message: DOWN_MSG };
  }
}

export const createSim = (req: CreateSimRequest) => request<CreateSimResponse>('/api/sim', { method: 'POST', body: JSON.stringify(req) });

export const startStream = (simID: string, tickRate?: number) =>
  request<StartStreamResponse>('/api/sim/stream', { method: 'POST', body: JSON.stringify(tickRate ? { simID, tickRate } : { simID }) });

export const stopStream = () => request<StopStreamResponse>('/api/sim/stream', { method: 'DELETE' });

/** A ranger's decision on an engine detection signal. */
export const resolveSignal = (simID: string, signalId: string, action: SignalAction) =>
  request<{ status: string }>('/api/sim/stream/signal', { method: 'POST', body: JSON.stringify({ simID, signalId, action }) });

// ---- WebSocket ------------------------------------------------------------------------------

export type SocketState = 'closed' | 'connecting' | 'open';

/**
 * One shared connection to /ws/sim/stream (the server serves a single client). Reconnects while
 * `keepAlive` is true; a 4409 close means another tab took over and is not retried.
 */
export class FrameSocket {
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: number | null = null;
  keepAlive = false;
  state: SocketState = 'closed';
  lastError: string | null = null;

  constructor(
    private onFrame: (f: SimFrame) => void,
    private onState: (s: SocketState, error: string | null) => void,
  ) {}

  private url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${BACKEND_BASE}/ws/sim/stream`;
  }

  private setState(s: SocketState, error: string | null = this.lastError) {
    this.state = s;
    this.lastError = error;
    this.onState(s, error);
  }

  /** Resolves once the socket is open (or after `timeoutMs`, whichever is first). */
  open(timeoutMs = 2500): Promise<void> {
    this.keepAlive = true;
    if (this.ws && this.state === 'open') return Promise.resolve();
    if (!this.ws) this.connect();
    return new Promise((resolve) => {
      const t = window.setTimeout(resolve, timeoutMs);
      const ws = this.ws;
      ws?.addEventListener('open', () => {
        window.clearTimeout(t);
        resolve();
      });
    });
  }

  close() {
    this.keepAlive = false;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close(1000);
    this.ws = null;
    this.setState('closed', null);
  }

  private connect() {
    this.setState('connecting');
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setState('open', null);
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        if (isSimFrame(data)) this.onFrame(data);
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (ev.code === 4409) {
        this.keepAlive = false;
        this.setState('closed', 'Another browser tab took over the engine stream');
        return;
      }
      if (!this.keepAlive) return this.setState('closed', null);
      this.setState('connecting', 'Stream connection lost, reconnecting…');
      const delay = Math.min(5000, 400 * 2 ** this.retry++);
      this.timer = window.setTimeout(() => {
        this.timer = null;
        if (this.keepAlive) this.connect();
      }, delay);
    };
  }
}
