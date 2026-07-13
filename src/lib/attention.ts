import type { WatchTarget } from '../types';
import type { ServerTargetStatus } from '../api/client';

// TEMPORARY client-side derivation. Backend request #7 (`monitoring-attention-v1`
// rollup) will ship a server-authored attention summary; when it lands, swap the
// internals of this module for the rollup and delete the local ranking. Keep ALL
// attention derivation logic in this file so that swap stays single-file.

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
