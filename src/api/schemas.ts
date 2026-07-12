// ── Runtime boundary validation ────────────────────────────────────────────
//
// Replaces the old `normalizeResult()` shim in api/client.ts with a validated
// boundary. The engine's header objects are shaped
// `{ key, label, value, status, summary, severity, description, recommendation }`
// — there is no `name` field, which is what the app's UI and drift-diffing
// (tasks/checkWatch.ts) key on. A mismatch here degrades a watch's header list
// to empty rather than crashing the add/check flow, and logs in dev so a
// backend reshape is visible immediately instead of showing up as "every
// header vanished" days later.
//
// Field names verified against a live production scan (2026-07-12,
// securl-app-production.up.railway.app, example.com).
import { z } from 'zod';
import type { ScanResult, SecurityHeaderResult, Severity } from '../types';

function logShapeDrift(context: string, detail: unknown): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn(`[schemas] ${context} did not match the expected shape`, detail);
  }
}

const SeveritySchema = z.enum(['good', 'info', 'warning', 'critical']).catch('info' as Severity);
const HeaderStatusSchema = z.enum(['present', 'missing', 'weak', 'informational']).catch('missing');

const RawHeaderSchema = z
  .object({
    key: z.string().optional(),
    label: z.string().optional(),
    name: z.string().optional(),
    value: z.string().nullable().optional(),
    status: HeaderStatusSchema,
    severity: SeveritySchema,
    summary: z.string().optional(),
    description: z.string().optional(),
    recommendation: z.string().optional(),
  })
  .passthrough();

export function parseHeaders(raw: unknown): SecurityHeaderResult[] {
  if (!Array.isArray(raw)) return [];
  const out: SecurityHeaderResult[] = [];
  raw.forEach((item, i) => {
    const parsed = RawHeaderSchema.safeParse(item);
    if (!parsed.success) {
      logShapeDrift(`headers[${i}]`, parsed.error.issues);
      return;
    }
    const h = parsed.data;
    out.push({
      ...h,
      name: h.name ?? h.label ?? h.key ?? '',
    });
  });
  return out;
}

const RawIssueSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().catch('Finding'),
    severity: SeveritySchema,
    detail: z.string().optional(),
    description: z.string().optional(),
    remediation: z.string().optional(),
  })
  .passthrough();

function parseIssues(raw: unknown): ScanResult['issues'] {
  if (!Array.isArray(raw)) return [];
  const out: ScanResult['issues'] = [];
  raw.forEach((item, i) => {
    const parsed = RawIssueSchema.safeParse(item);
    if (!parsed.success) {
      logShapeDrift(`issues[${i}]`, parsed.error.issues);
      return;
    }
    const it = parsed.data;
    out.push({
      id: it.id ?? `issue-${i}`,
      title: it.title,
      severity: it.severity,
      description: it.description ?? it.detail,
      remediation: it.remediation,
    });
  });
  return out;
}

const RawTopLevelSchema = z
  .object({
    host: z.string().catch(''),
    finalUrl: z.string().catch(''),
    scannedAt: z.string().catch(new Date().toISOString()),
    score: z.number().catch(0),
    grade: z.string().catch('U'),
    summary: z.string().catch(''),
    strengths: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * Validate + shape a raw engine scan result into the app's `ScanResult`.
 * Replaces `normalizeResult()`. Never throws — a malformed sub-section
 * degrades to an empty/absent value and logs in dev.
 */
export function parseScanResult(raw: unknown): ScanResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const topParsed = RawTopLevelSchema.safeParse(r);
  if (!topParsed.success) logShapeDrift('result (top-level)', topParsed.error.issues);
  const top = topParsed.success ? topParsed.data : ({} as z.infer<typeof RawTopLevelSchema>);

  return {
    ...top,
    strengths: top.strengths ?? [],
    headers: parseHeaders(r.headers),
    issues: parseIssues(r.issues),
  };
}
