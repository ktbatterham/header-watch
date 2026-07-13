import AsyncStorage from '@react-native-async-storage/async-storage';
import EventSource from 'react-native-sse';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

import type { ScanResult } from '../types';
import { parseScanResult, parseMonitoringHealth, type MonitoringHealth } from './schemas';

const BASE_URL = 'https://securl-app-production.up.railway.app';
const POLL_INTERVAL_MS = 1_500;
const POLL_MAX_ATTEMPTS = 80; // ~2 min
const SSE_TIMEOUT_MS = 120_000; // give SSE the same ~2 min budget as polling
const OWNER_TOKEN_KEY = 'header_watch_scan_owner_token';        // SecureStore key (no ':')
const LEGACY_OWNER_TOKEN_KEY = 'header-watch:scan-owner-token'; // old AsyncStorage key — migrated once

// Product-telemetry headers sent on every backend call so the engine can attribute
// usage by app/release (never by device or install). Additive: the backend ignores
// them if absent or malformed. version+build comes from the installed binary.
const APP_ID = 'com.ktbatterham.headerwatch'; // bundle id, identifies the device's app registration
const CLIENT_ID = 'header-watch-ios';
export const CLIENT_HEADERS: Record<string, string> = {
  'X-SecURL-Client': CLIENT_ID,
  'X-SecURL-Client-Version': `${Application.nativeApplicationVersion ?? '0'}+${Application.nativeBuildVersion ?? '0'}`,
  // Release channel for telemetry splits. __DEV__ covers dev/simulator builds;
  // everything else is a store install. (TestFlight is not reliably
  // distinguishable from the App Store on-device, so it reports as app-store.)
  'X-SecURL-Client-Channel': __DEV__ ? 'development' : 'app-store',
};

// ── Scan-owner token ──────────────────────────────────────────────────────────
// The SecURL backend scopes every scan to a per-client "owner" token and rejects
// scan requests without one (HTTP 401). This is NOT an auth secret — it is a
// stable random identifier generated once per install and persisted, so this
// device can read back the scans it created. Must be 24–256 chars with decent
// entropy (the server requires >= 8 distinct characters).

let cachedOwnerToken: string | null = null;

// Crypto-secure owner token: 24 CSPRNG bytes → 48 hex chars (within the backend's
// 24–256 char / >=8-distinct requirement). expo-crypto, not Math.random.
async function cryptoToken(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(24);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getOwnerToken(): Promise<string> {
  if (cachedOwnerToken) return cachedOwnerToken;
  // 1 — secure storage (iOS Keychain / Android Keystore)
  try {
    const secure = await SecureStore.getItemAsync(OWNER_TOKEN_KEY);
    if (secure) { cachedOwnerToken = secure; return secure; }
  } catch {
    // SecureStore unavailable — fall through.
  }
  // 2 — migrate a pre-existing AsyncStorage token so existing installs keep their
  //     server-side registration (scans / notification device / monitoring targets).
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_OWNER_TOKEN_KEY);
    if (legacy) {
      cachedOwnerToken = legacy;
      await SecureStore.setItemAsync(OWNER_TOKEN_KEY, legacy).catch(() => {});
      await AsyncStorage.removeItem(LEGACY_OWNER_TOKEN_KEY).catch(() => {});
      return legacy;
    }
  } catch {
    // Fall through and mint a fresh token.
  }
  // 3 — fresh install: mint a crypto-random token
  const token = await cryptoToken();
  cachedOwnerToken = token;
  try {
    await SecureStore.setItemAsync(OWNER_TOKEN_KEY, token);
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
        ...CLIENT_HEADERS,
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
    if (res.status === 429) throw new ApiError(429, 'Rate limit reached. Try again in a moment.');
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
    // Raw, unvalidated engine payload — parseScanResult() in ./schemas is the
    // boundary that turns this into a trusted ScanResult.
    result?: unknown;
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
// scan failed, or null while it is still in progress. apiFetch attaches the
// owner. Validation + shaping of the raw engine payload happens in ./schemas
// (`parseScanResult`) — the runtime boundary that replaced the old ad hoc
// `normalizeResult()` shim (see that file for field-name verification notes).
async function fetchScanResult(detailPath: string): Promise<ScanResult | null> {
  const res = await apiFetch(detailPath);
  const payload = await readJson<PollScanPayload>(res);
  if (payload.scan.status === 'completed' && payload.scan.result) {
    return parseScanResult(payload.scan.result);
  }
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
      headers: { ...CLIENT_HEADERS, 'X-Scan-Owner': ownerToken },
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

export interface TestNotificationResult {
  ok: boolean;
  message: string;
}

interface DeviceListResponse {
  devices?: Array<{ id?: string; appId?: string }>;
}

/**
 * Ask the backend to send a test push to this device, so the user can confirm the
 * push pipeline on demand rather than waiting for real drift. Per BACKEND-API.md
 * the test endpoint is keyed by the registration id
 * (POST /api/notification-devices/:id/test, owner-scoped), so we first look up
 * this app's registration via the list (raw token never echoed; match on appId,
 * falling back to the owner's only device). apiFetch attaches the owner + client
 * headers.
 */
export async function sendTestNotification(): Promise<TestNotificationResult> {
  try {
    const listRes = await apiFetch('/api/notification-devices');
    if (!listRes.ok) {
      return { ok: false, message: 'Could not check your device registration. Try again shortly.' };
    }
    const { devices = [] } = (await listRes.json()) as DeviceListResponse;
    const device = devices.find((d) => d.appId === APP_ID) ?? devices[0];
    if (!device?.id) {
      return { ok: false, message: "This device isn't registered for notifications yet. Allow notifications, reopen the app, then try again." };
    }

    const res = await apiFetch(`/api/notification-devices/${encodeURIComponent(device.id)}/test`, {
      method: 'POST',
    });
    if (res.ok) {
      return { ok: true, message: 'Test notification sent. It should arrive on your device shortly.' };
    }
    if (res.status === 503) {
      return { ok: false, message: "The server couldn't deliver the test push right now. Try again shortly." };
    }
    if (res.status === 404) {
      return { ok: false, message: 'Your registration was not found. Reopen the app to re-register, then try again.' };
    }
    return { ok: false, message: `Couldn't send a test notification (server ${res.status}).` };
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection.' };
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

// ── Capabilities + server-computed watch-list status ─────────────────────────
// Discover additive backend features via GET /api/capabilities rather than
// assuming endpoints exist. Cached per session; a failed fetch disables the
// gated enrichment. Mirrors the SecURL / Cert Watch adoption.

let cachedMonitoringFeatures: string[] | null | undefined;

async function getMonitoringFeatures(): Promise<string[] | null> {
  if (cachedMonitoringFeatures !== undefined) return cachedMonitoringFeatures;
  try {
    const res = await apiFetch('/api/capabilities');
    // Only cache a SUCCESSFUL read. A transient failure/malformed response must
    // NOT be cached, or a single network blip at launch would disable the gated
    // enrichment for the whole session; leaving it uncached lets it retry.
    if (!res.ok) return null;
    const data = (await res.json()) as { monitoring?: { features?: unknown } };
    const f = data.monitoring?.features;
    if (!Array.isArray(f)) return null;
    cachedMonitoringFeatures = f.filter((x): x is string => typeof x === 'string');
    return cachedMonitoringFeatures;
  } catch {
    return null;
  }
}

// Server-authored, per-event explanation copy from /api/monitoring-mobile-summary
// `targets[].events[]` (backend capability `mobile-monitoring-explanations-v1`,
// engine PR #374, 2026-07-11). Render this text directly instead of composing
// local "Removed: X, Added: Y" copy — the backend already knows what changed and
// why it matters. `targetId`/`eventId`/`deepLink` let a push tap or an in-app
// selection route straight to (and highlight) the event that triggered it.
export interface ServerChangedEvidence {
  label: string;
  previous: unknown;
  current: unknown;
}

export interface ServerDeepLink {
  route: string;
  targetId: string;
  eventId: string;
}

export interface ServerMonitoringEvent {
  eventId: string;
  targetId: string;
  title: string | null;
  message: string | null;
  severity: string | null;
  nextAction: string | null;
  changedEvidence: ServerChangedEvidence[];
  deepLink: ServerDeepLink | null;
}

function coerceDeepLink(raw: unknown): ServerDeepLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const dl = raw as Record<string, unknown>;
  if (
    typeof dl.route === 'string' &&
    typeof dl.targetId === 'string' &&
    typeof dl.eventId === 'string'
  ) {
    return { route: dl.route, targetId: dl.targetId, eventId: dl.eventId };
  }
  return null;
}

function coerceChangedEvidence(raw: unknown): ServerChangedEvidence[] {
  if (!Array.isArray(raw)) return [];
  const out: ServerChangedEvidence[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const e = item as Record<string, unknown>;
      if (typeof e.label === 'string') {
        out.push({ label: e.label, previous: e.previous ?? null, current: e.current ?? null });
      }
    }
  }
  return out;
}

function coerceServerEvent(raw: unknown): ServerMonitoringEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  // targetId/eventId are the identity contract — without both, this event can't
  // be routed to or highlighted, so treat it as absent rather than partial.
  if (typeof e.targetId !== 'string' || typeof e.eventId !== 'string') return null;
  return {
    eventId: e.eventId,
    targetId: e.targetId,
    title: typeof e.title === 'string' ? e.title : null,
    message: typeof e.message === 'string' ? e.message : null,
    severity: typeof e.severity === 'string' ? e.severity : null,
    nextAction: typeof e.nextAction === 'string' ? e.nextAction : null,
    changedEvidence: coerceChangedEvidence(e.changedEvidence),
    deepLink: coerceDeepLink(e.deepLink),
  };
}

// Server-authored per-target watch-list state from /api/monitoring-mobile-summary
// (backend monitoring-events). Consume only the compact status + change copy the
// watch row renders, keyed by server target id. Defensively coerced.
export interface ServerTargetStatus {
  state: string | null;
  severity: string | null;
  changeTitle: string | null;
  nextCheckAt: string | null;
  // Full server-authored explanation(s) for the most recent check, gated on
  // `mobile-monitoring-explanations-v1`. Empty when the capability is absent or
  // the target has no recent events — callers fall back to local drift copy.
  events: ServerMonitoringEvent[];
}

function coerceTargetStatus(t: Record<string, unknown>, includeEvents: boolean): ServerTargetStatus {
  const status = (t.status ?? {}) as Record<string, unknown>;
  const change = (t.change ?? {}) as Record<string, unknown>;
  const nextCheck = (t.nextCheck ?? {}) as Record<string, unknown>;
  const events =
    includeEvents && Array.isArray(t.events)
      ? t.events.map(coerceServerEvent).filter((e): e is ServerMonitoringEvent => e !== null)
      : [];
  return {
    state: typeof status.state === 'string' ? status.state : null,
    severity: typeof status.severity === 'string' ? status.severity : null,
    changeTitle:
      change.changed === true && typeof change.title === 'string' ? change.title : null,
    nextCheckAt: typeof nextCheck.scheduledAt === 'string' ? nextCheck.scheduledAt : null,
    events,
  };
}

export async function fetchMonitoringStatus(): Promise<Map<string, ServerTargetStatus> | null> {
  try {
    const features = await getMonitoringFeatures();
    if (!features?.includes('mobile-monitoring-status-v1')) return null;
    // Additive: only read the new explanation fields once the backend advertises
    // the capability. Older servers still populate state/severity/changeTitle.
    const includeEvents = features.includes('mobile-monitoring-explanations-v1');
    const res = await apiFetch('/api/monitoring-mobile-summary');
    if (!res.ok) return null;
    const data = (await res.json()) as { targets?: unknown };
    if (!Array.isArray(data.targets)) return null;
    const map = new Map<string, ServerTargetStatus>();
    for (const raw of data.targets) {
      if (raw && typeof raw === 'object') {
        const t = raw as Record<string, unknown>;
        if (typeof t.id === 'string') map.set(t.id, coerceTargetStatus(t, includeEvents));
      }
    }
    return map;
  } catch {
    return null;
  }
}

// ── Monitoring health ─────────────────────────────────────────────────────────
// GET /api/monitoring-health — server-side "is monitoring actually working"
// signal for the watch-list footer. Live since backend 1.15.0, so no capability
// gate. Best-effort: any failure (network, non-2xx, unparseable body) returns
// null and the footer simply doesn't render. apiFetch attaches the X-Scan-Owner
// token + client headers like every other call.

export async function fetchMonitoringHealth(): Promise<MonitoringHealth | null> {
  try {
    const res = await apiFetch('/api/monitoring-health');
    if (!res.ok) return null;
    return parseMonitoringHealth(await res.json());
  } catch {
    return null;
  }
}
