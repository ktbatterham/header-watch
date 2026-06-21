/**
 * Standalone check logic — safe to call from both the React hook and the
 * background fetch task (no React dependency).
 */
import { scanUrl } from '../api/client';
import { addSnapshot, getSnapshotById, setBaseline } from '../storage/snapshots';
import { addEvent } from '../storage/events';
import { updateWatch } from '../storage/watches';
import type {
  WatchTarget,
  HeaderSnapshot,
  DriftEvent,
  SecurityHeaderResult,
  ChangedHeader,
} from '../types';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Header diff ───────────────────────────────────────────────────────────────

function diffHeaders(
  baseline: SecurityHeaderResult[],
  current: SecurityHeaderResult[],
): { added: string[]; removed: string[]; changed: ChangedHeader[] } {
  // Headers can arrive normalized (name) or in raw engine shape (label/key) —
  // older stored snapshots predate normalization. Resolve a key/display safely.
  const hkey = (h: SecurityHeaderResult) => (h.name ?? h.label ?? h.key ?? '').toLowerCase();
  const hdisp = (h: SecurityHeaderResult) => h.name ?? h.label ?? h.key ?? '';
  const baseMap = new Map(baseline.filter((h) => hkey(h)).map((h) => [hkey(h), h]));
  const currMap = new Map(current.filter((h) => hkey(h)).map((h) => [hkey(h), h]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: ChangedHeader[] = [];

  for (const [name, curr] of currMap) {
    const base = baseMap.get(name);
    if (!base) {
      if (curr.status === 'present') added.push(hdisp(curr));
    } else if (base.status !== curr.status) {
      changed.push({
        name: hdisp(curr),
        previousStatus: base.status,
        currentStatus: curr.status,
        previousValue: base.value ?? null,
        currentValue: curr.value ?? null,
      });
    }
  }

  for (const [name, base] of baseMap) {
    if (!currMap.has(name) && base.status === 'present') {
      removed.push(hdisp(base));
    }
  }

  return { added, removed, changed };
}

function driftSeverity(
  scoreDelta: number,
  removedCount: number,
): DriftEvent['driftSeverity'] {
  if (scoreDelta < -5 || removedCount > 0) return 'regression';
  if (scoreDelta > 5) return 'improvement';
  return 'neutral';
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CheckResult {
  snapshot: HeaderSnapshot;
  driftEvent: DriftEvent | null;
}

/**
 * Scan a watch target, diff against its baseline, persist results.
 * Returns the new snapshot and any drift event detected.
 */
export async function checkWatch(watch: WatchTarget): Promise<CheckResult> {
  const result = await scanUrl(watch.url);

  const snapshot: HeaderSnapshot = {
    id: makeId(),
    watchId: watch.id,
    capturedAt: new Date().toISOString(),
    grade: result.grade,
    score: result.score,
    headers: result.headers ?? [],
    isBaseline: false,
  };

  await addSnapshot(snapshot);

  const updatedWatch: WatchTarget = {
    ...watch,
    lastCheckedAt: snapshot.capturedAt,
    lastGrade: snapshot.grade,
    lastScore: snapshot.score,
  };

  let driftEvent: DriftEvent | null = null;

  if (watch.baselineSnapshotId) {
    const baseline = await getSnapshotById(watch.baselineSnapshotId);
    if (baseline && baseline.headers.length > 0) {
      const { added, removed, changed } = diffHeaders(baseline.headers, snapshot.headers);
      const scoreDelta = snapshot.score - baseline.score;
      const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0;

      if (hasChanges) {
        driftEvent = {
          id: makeId(),
          watchId: watch.id,
          host: watch.host,
          detectedAt: new Date().toISOString(),
          baselineSnapshotId: baseline.id,
          currentSnapshotId: snapshot.id,
          previousGrade: baseline.grade,
          currentGrade: snapshot.grade,
          scoreDelta,
          driftSeverity: driftSeverity(scoreDelta, removed.length),
          addedHeaders: added,
          removedHeaders: removed,
          changedHeaders: changed,
        };

        await addEvent(driftEvent);
        updatedWatch.hasAlert = true;
      }
    }
  }

  await updateWatch(updatedWatch);
  return { snapshot, driftEvent };
}

/**
 * Returns true if a watch is due for its next check based on its interval.
 */
export function isDue(watch: WatchTarget): boolean {
  if (!watch.lastCheckedAt) return true;
  const intervalMs = watch.checkIntervalHours * 60 * 60 * 1000;
  return Date.now() - new Date(watch.lastCheckedAt).getTime() >= intervalMs;
}

/**
 * Set a snapshot as the new baseline and clear the alert flag.
 */
export async function rebaselineWatch(watch: WatchTarget, snapshotId: string): Promise<void> {
  await setBaseline(watch.id, snapshotId);
  await updateWatch({ ...watch, baselineSnapshotId: snapshotId, hasAlert: false });
}
