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

// ── Monitoring health (GET /api/monitoring-health) ────────────────────────
//
// Compact "is server monitoring working" signal for the watch-list footer.
// Only the fields the caption renders are extracted; a missing or malformed
// sub-section degrades to healthy defaults so shape drift never falsely
// alarms users — a fully unparseable payload returns null and the caption
// simply doesn't render.
//
// Field names verified against a live production response (2026-07-13,
// securl-app-production.up.railway.app).

export interface MonitoringHealth {
  schedulerEnabled: boolean;
  lastSweepHealthy: boolean;
  notificationsEnabled: boolean;
  credentialsConfigured: boolean;
  pushDevicesNeedingRegistration: number;
}

const RawMonitoringHealthSchema = z
  .object({
    summary: z
      .object({ pushDevicesNeedingRegistration: z.number().catch(0) })
      .catch({ pushDevicesNeedingRegistration: 0 }),
    scheduler: z
      .object({
        enabled: z.boolean().catch(true),
        lastSweepHealthy: z.boolean().catch(true),
      })
      .catch({ enabled: true, lastSweepHealthy: true }),
    notifications: z
      .object({
        enabled: z.boolean().catch(true),
        credentialsConfigured: z.boolean().catch(true),
      })
      .catch({ enabled: true, credentialsConfigured: true }),
  })
  .passthrough();

export function parseMonitoringHealth(raw: unknown): MonitoringHealth | null {
  const parsed = RawMonitoringHealthSchema.safeParse(raw);
  if (!parsed.success) {
    logShapeDrift('monitoring-health', parsed.error.issues);
    return null;
  }
  const { summary, scheduler, notifications } = parsed.data;
  return {
    schedulerEnabled: scheduler.enabled,
    lastSweepHealthy: scheduler.lastSweepHealthy,
    notificationsEnabled: notifications.enabled,
    credentialsConfigured: notifications.credentialsConfigured,
    pushDevicesNeedingRegistration: summary.pushDevicesNeedingRegistration,
  };
}

// ── Monitoring attention rollup (GET /api/monitoring-attention) ───────────
//
// Server-authored "what needs attention right now" rollup, backend capability
// `monitoring-attention-v1`. Supersedes the app's local `deriveAttention`
// ranking: the server owns the summary counts/state and the attention ordering,
// the client just maps rows onto its local watches. Only the fields the watch
// list consumes are extracted — summary counts/state for the rollup bar, and
// per-row { targetId, host, severity } for matching + ordering. Tolerant per the
// repo's zod-boundary convention: a malformed sub-section degrades to a safe
// default and a fully unparseable payload returns null (caller falls back to the
// local derivation).
//
// Response shapes verified against production 2026-07-16
// (securl-app-production.up.railway.app).

export interface ParsedAttentionSummary {
  state: string;
  highestSeverity: string | null;
  targetsTotal: number;
  targetsNeedingAttention: number;
  targetsUnhealthy: number;
  monitoringEnabled: boolean;
}

export interface ParsedAttentionRow {
  targetId: string;
  host: string;
  severity: string | null;
  state: string | null;
}

export interface ParsedAttention {
  summary: ParsedAttentionSummary;
  attention: ParsedAttentionRow[];
}

const AttentionSummaryDefaults: ParsedAttentionSummary = {
  state: 'unknown',
  highestSeverity: null,
  targetsTotal: 0,
  targetsNeedingAttention: 0,
  targetsUnhealthy: 0,
  monitoringEnabled: false,
};

const RawAttentionSummarySchema = z
  .object({
    state: z.string().catch('unknown'),
    highestSeverity: z.string().nullable().catch(null),
    targetsTotal: z.number().catch(0),
    targetsNeedingAttention: z.number().catch(0),
    targetsUnhealthy: z.number().catch(0),
    monitoringEnabled: z.boolean().catch(false),
  })
  .passthrough()
  .catch(AttentionSummaryDefaults);

// targetId is the identity contract used to match a row to a local watch;
// without it the row can't be routed, so treat it as absent (dropped).
const RawAttentionRowSchema = z
  .object({
    targetId: z.string(),
    host: z.string().catch(''),
    severity: z.string().nullable().catch(null),
    state: z.string().nullable().catch(null),
  })
  .passthrough();

export function parseMonitoringAttention(raw: unknown): ParsedAttention | null {
  if (!raw || typeof raw !== 'object') {
    logShapeDrift('monitoring-attention', raw);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const summary = RawAttentionSummarySchema.parse(r.summary ?? {});
  const attention: ParsedAttentionRow[] = [];
  if (Array.isArray(r.attention)) {
    r.attention.forEach((item, i) => {
      const parsed = RawAttentionRowSchema.safeParse(item);
      if (!parsed.success) {
        logShapeDrift(`monitoring-attention[${i}]`, parsed.error.issues);
        return;
      }
      const row = parsed.data;
      attention.push({
        targetId: row.targetId,
        host: row.host,
        severity: row.severity,
        state: row.state,
      });
    });
  }
  return { summary, attention };
}

// ── Monitoring policy fit (GET /api/monitoring-mobile-summary, target detail,
//    GET /api/monitoring-attention, target timeline) ───────────────────────
//
// Server-authored policy verdict for posture-carrying monitoring targets,
// backend capability `monitoring-policy-fit-v1` (BACKEND_READY 2026-07-19,
// request #9). The backend policy evaluator is authoritative — this app must
// never parse manifests or (re)compute verdict/violations locally; it only
// ever displays what's already here. Additive: posture targets with an
// `observationPolicy` MAY carry this block; certificate targets keep their
// existing certificate policy/profile fields and must not be assumed to
// carry `policyFit`. A missing/null block or `verdict: "unknown"` both mean
// "not yet evaluated" — callers must render no policy claim and keep
// existing watch-list/summary state unchanged (see WatchRow / watch/[id]).
//
// Field shape confirmed by reading the backend's generating code directly
// (securl/server/scanDtos.mjs: buildMonitoringPolicyFit / buildMobileTargetSummary
// / buildAttentionItemFromTarget, sibling repo, read-only, 2026-07-19) rather
// than relying solely on the channel doc's prose — that cross-check caught
// that `summary` is an aggregate-counts OBJECT (not free text) and
// `topViolations` items are full violation objects (not `{label, detail}`).
// `policyFit` sits at the top level of each target entry in
// `GET /api/monitoring-mobile-summary` (`targets[].policyFit`),
// `GET /api/monitoring-attention` (`attention[].policyFit`), and the target
// timeline payload; it is `null` whenever the target has no `observationPolicy`
// attached, which is the common case today. Every field here is
// tolerant/optional so an unanticipated shape degrades to nulls/empty rather
// than dropping the surrounding target status.

export type PolicyFitVerdict = 'pass' | 'drift' | 'fail' | 'unknown';

const KNOWN_POLICY_FIT_VERDICTS = new Set<PolicyFitVerdict>(['pass', 'drift', 'fail', 'unknown']);

export interface PolicyFitViolation {
  id: string | null;
  ruleId: string | null;
  title: string | null;
  severity: string | null;
  scope: string | null;
  kind: string | null;
  subject: string | null;
  summary: string | null;
}

export interface PolicyFitSummary {
  rulesEvaluated: number;
  violations: number;
  bySeverity: { critical: number; warning: number; info: number };
  highestSeverity: string | null;
}

export interface PolicyFit {
  verdict: PolicyFitVerdict;
  policy: string | null;
  policyName: string | null;
  policyVersion: string | null;
  changedSince: string | null;
  evaluatedAt: string | null;
  headline: string | null;
  // Aggregate counts, not free text — bounded explanatory detail only, never
  // used to compute a verdict client-side.
  summary: PolicyFitSummary | null;
  // Bounded (server caps at 3) server-authored violation detail.
  topViolations: PolicyFitViolation[];
}

const PolicyFitViolationSchema = z
  .object({
    id: z.string().nullable().catch(null),
    ruleId: z.string().nullable().catch(null),
    title: z.string().nullable().catch(null),
    severity: z.string().nullable().catch(null),
    scope: z.string().nullable().catch(null),
    kind: z.string().nullable().catch(null),
    subject: z.string().nullable().catch(null),
    summary: z.string().nullable().catch(null),
  })
  .passthrough();

const PolicyFitSummarySchema = z
  .object({
    rulesEvaluated: z.number().catch(0),
    violations: z.number().catch(0),
    bySeverity: z
      .object({
        critical: z.number().catch(0),
        warning: z.number().catch(0),
        info: z.number().catch(0),
      })
      .passthrough()
      .catch({ critical: 0, warning: 0, info: 0 }),
    highestSeverity: z.string().nullable().catch(null),
  })
  .passthrough();

const PolicyFitSchema = z
  .object({
    verdict: z.string().nullable().catch(null),
    policy: z.string().nullable().catch(null),
    policyName: z.string().nullable().catch(null),
    policyVersion: z.string().nullable().catch(null),
    changedSince: z.string().nullable().catch(null),
    evaluatedAt: z.string().nullable().catch(null),
    headline: z.string().nullable().catch(null),
    summary: PolicyFitSummarySchema.nullable().optional(),
    topViolations: z.array(z.unknown()).catch([]),
  })
  .passthrough();

function coercePolicyViolation(raw: unknown): PolicyFitViolation | null {
  const parsed = PolicyFitViolationSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Parse an optional `policyFit` block. Absent/null/malformed all return
 * `null` — treat identically to "not yet evaluated". A successfully parsed
 * block with `verdict: "unknown"` is still returned (not collapsed to null)
 * so a caller could in principle tell "no block" from "server said unknown",
 * but every UI gate in this app treats the two the same (no policy claim
 * rendered).
 */
export function parsePolicyFit(raw: unknown): PolicyFit | null {
  if (raw === null || raw === undefined) return null;
  const parsed = PolicyFitSchema.safeParse(raw);
  if (!parsed.success) {
    logShapeDrift('policyFit', parsed.error.issues);
    return null;
  }
  const p = parsed.data;
  const verdict: PolicyFitVerdict = KNOWN_POLICY_FIT_VERDICTS.has(p.verdict as PolicyFitVerdict)
    ? (p.verdict as PolicyFitVerdict)
    : 'unknown';
  return {
    verdict,
    policy: p.policy,
    policyName: p.policyName,
    policyVersion: p.policyVersion,
    changedSince: p.changedSince,
    evaluatedAt: p.evaluatedAt,
    headline: p.headline,
    summary: p.summary ?? null,
    topViolations: p.topViolations
      .map(coercePolicyViolation)
      .filter((v): v is PolicyFitViolation => v !== null)
      .slice(0, 3),
  };
}

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
