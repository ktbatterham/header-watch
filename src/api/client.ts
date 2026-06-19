import AsyncStorage from '@react-native-async-storage/async-storage';
import EventSource from 'react-native-sse';

import type { ScanResult } from '../types';

const BASE_URL = 'https://securl-app-production.up.railway.app';
const POLL_INTERVAL_MS = 1_500;
const POLL_MAX_ATTEMPTS = 80; // ~2 min
const SSE_TIMEOUT_MS = 120_000; // give SSE the same ~2 min budget as polling
const OWNER_TOKEN_KEY = 'header-watch:scan-owner-token';

// ── Scan-owner token ──────────────────────────────────────────────────────────
// The SecURL backend scopes every scan to a per-client "owner" token and rejects
// scan requests without one (HTTP 401). This is NOT an auth secret — it is a
// stable random identifier generated once per install and persisted, so this
// device can read back the scans it created. Must be 24–256 chars with decent
// entropy (the server requires >= 8 distinct characters).

let cachedOwnerToken: string | null = null;

function generateOwnerToken(): string {
  const segments = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2));
  return `hw-${Date.now().toString(36)}-${segments.join('')}`.slice(0, 120);
}

async function getOwnerToken(): Promise<string> {
  if (cachedOwnerToken) return cachedOwnerToken;
  try {
    const stored = await AsyncStorage.getItem(OWNER_TOKEN_KEY);
    if (stored) {
      cachedOwnerToken = stored;
      return stored;
    }
  } catch {
    // Storage read failed — fall through and mint a session-only token.
  }
  const token = generateOwnerToken();
  cachedOwnerToken = token;
  try {
    await AsyncStorage.setItem(OWNER_TOKEN_KEY, token);
  } catch {
    // Non-fatal: token still works for this session, just won't persist.
  }
  return token;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const ownerToken = await getOwnerToken();
  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        'X-Scan-Owner': ownerToken,
      },
    });
  } catch {
    throw new NetworkError('Could not reach the server. Check your connection.');
  }
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429) throw new ApiError(429, 'Rate limit reached — try again in a moment.');
    if (res.status === 400) throw new ApiError(400, body || 'Invalid or unreachable URL.');
    if (res.status === 401) throw new ApiError(401, 'Session expired. Please try again.');
    throw new ApiError(res.status, `Server error (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Scan API ──────────────────────────────────────────────────────────────────

// The backend returns direct paths for every related resource on scan creation
// (detail/events/…); we consume what it hands back rather than constructing
// paths, falling back to construction if an older server omits the block.
interface ScanResources {
  detail?: string;
  events?: string;
  digest?: string;
}

interface CreateScanPayload {
  scan: { id: string; status: string };
  resources?: ScanResources;
  fromCache?: boolean;
}

interface PollScanPayload {
  scan: {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: ScanResult;
    error?: string;
  };
}

export async function scanUrl(url: string): Promise<ScanResult> {
  // Create scan — apiFetch attaches the X-Scan-Owner token the backend requires.
  const createRes = await apiFetch('/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, mode: 'standard' }),
  });

  const created = await readJson<CreateScanPayload>(createRes);
  // Consume the server-provided resource paths; fall back to constructing them
  // for older servers that don't return the resources block.
  const detailPath = created.resources?.detail ?? `/api/scans/${encodeURIComponent(created.scan.id)}`;
  const eventsPath = created.resources?.events;

  // Cache hit — the result is already present.
  if (created.scan.status === 'completed') {
    const cached = await fetchScanResult(detailPath);
    if (cached) return cached;
  }

  // Wait for the server's terminal event over SSE instead of polling every 1.5s.
  // The stream replays history on connect, so there's no race if the scan
  // finishes first. Any SSE problem (older server, dropped connection, timeout)
  // falls back to the poll loop below, so behaviour degrades gracefully.
  if (eventsPath) {
    try {
      const ownerToken = await getOwnerToken();
      const status = await waitForScanTerminalViaSSE(`${BASE_URL}${eventsPath}`, ownerToken);
      if (status === 'failed') throw new ApiError(400, 'Scan failed on the server.');
      const result = await fetchScanResult(detailPath);
      if (result) return result;
      // Terminal says completed but detail isn't ready yet — fall through to poll.
    } catch (err) {
      if (err instanceof ApiError) throw err; // a real scan failure, not an SSE issue
      // Otherwise the SSE attempt failed — fall through to polling.
    }
  }

  // Fallback: poll until completed or failed.
  return pollForScanResult(detailPath);
}

// Fetch a scan's detail, returning its result when completed, throwing when the
// scan failed, or null while it is still in progress. apiFetch attaches the owner.
async function fetchScanResult(detailPath: string): Promise<ScanResult | null> {
  const res = await apiFetch(detailPath);
  const payload = await readJson<PollScanPayload>(res);
  if (payload.scan.status === 'completed' && payload.scan.result) return payload.scan.result;
  if (payload.scan.status === 'failed') {
    throw new ApiError(400, payload.scan.error || 'Scan failed on the server.');
  }
  return null;
}

async function pollForScanResult(detailPath: string): Promise<ScanResult> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const result = await fetchScanResult(detailPath);
    if (result) return result;
  }
  throw new NetworkError('Scan is taking too long. Try again later.');
}

// Open an SSE connection to the scan's event stream and resolve with the terminal
// status. The backend emits a `scan_terminal` event (and a `failed` event on
// failure); we close as soon as one arrives. Rejects on connection error or
// timeout so the caller can fall back to polling.
function waitForScanTerminalViaSSE(
  eventsUrl: string,
  ownerToken: string,
): Promise<'completed' | 'failed'> {
  return new Promise((resolve, reject) => {
    const es = new EventSource<'scan_terminal' | 'failed'>(eventsUrl, {
      headers: { 'X-Scan-Owner': ownerToken },
      pollingInterval: 0, // one-shot: don't auto-reconnect after the stream ends
    });
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      es.removeAllEventListeners();
      es.close();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new NetworkError('Scan event stream timed out.'))),
      SSE_TIMEOUT_MS,
    );

    es.addEventListener('scan_terminal', (event) => {
      try {
        const data = JSON.parse(((event as { data?: string }).data) ?? '{}');
        finish(() => resolve(data.status === 'failed' ? 'failed' : 'completed'));
      } catch {
        finish(() => reject(new NetworkError('Malformed scan event.')));
      }
    });
    es.addEventListener('failed', () => finish(() => resolve('failed')));
    es.addEventListener('error', () => finish(() => reject(new NetworkError('Scan event stream error.'))));
  });
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/health');
    return res.ok;
  } catch {
    return false;
  }
}

// ── Push device registration ───────────────────────────────────────────────────
// Registers this device's raw APNs token with the backend so the server can send
// drift pushes directly via APNs. appId is the bundle id (used as the apns-topic);
// environment must match the build's aps-environment (dev = sandbox, TestFlight /
// App Store = production). apiFetch attaches the X-Scan-Owner token.

export type PushEnvironment = 'sandbox' | 'production';

export async function registerDevice(
  apnsToken: string,
  appId: string,
  environment: PushEnvironment,
): Promise<void> {
  const res = await apiFetch('/api/notification-devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apnsToken, appId, environment }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || `Device registration failed (${res.status}).`);
  }
}

// ── Server-side monitoring targets ─────────────────────────────────────────────
// Registering a watched URL as a monitoring-target makes the backend scan it on a
// schedule (daily) and push drift alerts via APNs — reliable even when the app is
// closed, unlike on-device background fetch. Best-effort: failures fall back to
// the local checker.

export type MonitoringCadence = 'daily' | 'weekly';

export async function createMonitoringTarget(
  url: string,
  cadence: MonitoringCadence,
  appId: string,
): Promise<string | null> {
  try {
    const res = await apiFetch('/api/monitoring-targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cadence, mode: 'standard', appId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { target?: { id?: string } };
    return data.target?.id ?? null;
  } catch {
    return null;
  }
}

export async function deleteMonitoringTarget(id: string): Promise<void> {
  try {
    await apiFetch(`/api/monitoring-targets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    // Best-effort.
  }
}
