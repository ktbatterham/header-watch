import type { WatchTarget } from '../types';
import type { ServerTargetStatus } from '../api/client';
import type { ParsedAttention } from '../api/schemas';

// Two attention derivations live here, sharing one output shape (AttentionSummary)
// so the watch list can swap between them transparently:
//   • attentionFromServer() — PREFERRED. Consumes the server-authored
//     `monitoring-attention-v1` rollup (summary counts/state + ordered rows).
//     This is now live in production.
//   • deriveAttention() — FALLBACK. The original client-side ranking off the
//     per-target monitoring summary, used when the `monitoring-attention-v1`
//     capability is absent or the rollup fetch fails.
// Keep ALL attention derivation logic in this file so the two paths stay aligned.

export type AttentionState = 'ok' | 'attention' | 'critical';

export interface AttentionSummary {
  state: AttentionState;
  counts: { attention: number; critical: number };
  orderedWatches: WatchTarget[];
}

// Rank server-authored severities for ordering within the needs-attention group.
// Unknown/absent severities sort last within the group.
const SEVERITY_RANK: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

function severityRank(severity: string | null): number {
  return (severity && SEVERITY_RANK[severity]) || 0;
}

// Derive "what needs attention?" from the /api/monitoring-mobile-summary-backed
// per-watch statuses. Needs-attention watches come first (severity descending,
// stable within a severity), everything else keeps its existing order. When no
// summary data exists (offline / older server), the input order is returned
// untouched and counts are zero, so callers render no attention UI.
export function deriveAttention(
  watches: WatchTarget[],
  serverStatus: Map<string, ServerTargetStatus>,
): AttentionSummary {
  let attention = 0;
  let critical = 0;

  const flagged: { watch: WatchTarget; rank: number; index: number }[] = [];
  const rest: WatchTarget[] = [];

  watches.forEach((watch, index) => {
    const status = serverStatus.get(watch.id);
    if (status?.state === 'needs_attention') {
      if (status.severity === 'critical') critical += 1;
      else attention += 1;
      flagged.push({ watch, rank: severityRank(status.severity), index });
    } else {
      rest.push(watch);
    }
  });

  // Explicit index tiebreak keeps the sort stable regardless of engine.
  flagged.sort((a, b) => b.rank - a.rank || a.index - b.index);

  return {
    state: critical > 0 ? 'critical' : flagged.length > 0 ? 'attention' : 'ok',
    counts: { attention, critical },
    orderedWatches:
      flagged.length === 0 ? watches : [...flagged.map((f) => f.watch), ...rest],
  };
}

// Server-preferred attention: build the SAME AttentionSummary from the backend
// `monitoring-attention-v1` rollup. Ordering follows the server's `attention[]`
// row order, each row matched to a local watch by serverTargetId (the row's
// `targetId`) then by host; unmatched watches keep their existing order (stable).
// counts + state come from the server `summary` — it is authoritative for the
// rollup bar even when a row has no local counterpart (e.g. cross-app targets).
export function attentionFromServer(
  server: ParsedAttention,
  watches: WatchTarget[],
): AttentionSummary {
  const placed = new Set<string>(); // local watch ids already ordered
  const ordered: WatchTarget[] = [];

  for (const row of server.attention) {
    const match = watches.find(
      (w) =>
        !placed.has(w.id) &&
        ((w.serverTargetId != null && w.serverTargetId === row.targetId) ||
          (row.host !== '' && w.host === row.host)),
    );
    if (match) {
      placed.add(match.id);
      ordered.push(match);
    }
  }

  const rest = watches.filter((w) => !placed.has(w.id));

  const critical = server.attention.filter((r) => r.severity === 'critical').length;
  const needingAttention = server.summary.targetsNeedingAttention;
  const attention = Math.max(0, needingAttention - critical);

  return {
    state: critical > 0 ? 'critical' : needingAttention > 0 ? 'attention' : 'ok',
    counts: { attention, critical },
    orderedWatches: ordered.length === 0 ? watches : [...ordered, ...rest],
  };
}
