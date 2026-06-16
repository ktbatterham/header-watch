import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ScanResult } from '../types';

const BASE_URL = 'https://securl-app-production.up.railway.app';
const POLL_INTERVAL_MS = 1_500;
const POLL_MAX_ATTEMPTS = 80; // ~2 min
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

interface CreateScanPayload {
  scan: { id: string; status: string };
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
  const scanId = created.scan.id;

  // If server returned a cached completed scan
  if (created.scan.status === 'completed') {
    const directRes = await apiFetch(`/api/scans/${encodeURIComponent(scanId)}`);
    const payload = await readJson<PollScanPayload>(directRes);
    if (payload.scan.result) return payload.scan.result;
  }

  // Poll until completed or failed
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await apiFetch(`/api/scans/${encodeURIComponent(scanId)}`);
    const payload = await readJson<PollScanPayload>(pollRes);
    if (payload.scan.status === 'completed' && payload.scan.result) {
      return payload.scan.result;
    }
    if (payload.scan.status === 'failed') {
      throw new ApiError(400, payload.scan.error || 'Scan failed on the server.');
    }
  }

  throw new NetworkError('Scan is taking too long. Try again later.');
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
