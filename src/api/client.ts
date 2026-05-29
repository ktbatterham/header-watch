import type { ScanResult } from '../types';

const BASE_URL = 'https://securl-app-production.up.railway.app';
const POLL_INTERVAL_MS = 1_500;
const POLL_MAX_ATTEMPTS = 80; // ~2 min

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
  try {
    return await fetch(`${BASE_URL}${path}`, options);
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
  // Create scan (no owner token needed for header checking)
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
