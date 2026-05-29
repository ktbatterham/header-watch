import { useCallback } from 'react';
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

// Compare two header arrays and return what changed
function diffHeaders(
  baseline: SecurityHeaderResult[],
  current: SecurityHeaderResult[],
): {
  added: string[];
  removed: string[];
  changed: ChangedHeader[];
} {
  const baselineMap = new Map(baseline.map((h) => [h.name.toLowerCase(), h]));
  const currentMap = new Map(current.map((h) => [h.name.toLowerCase(), h]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: ChangedHeader[] = [];

  // Check what's new or changed in current
  for (const [name, curr] of currentMap) {
    const base = baselineMap.get(name);
    if (!base) {
      // Header wasn't in baseline at all — only flag if it's now "present"
      if (curr.status === 'present') added.push(curr.name);
    } else if (base.status !== curr.status) {
      changed.push({
        name: curr.name,
        previousStatus: base.status,
        currentStatus: curr.status,
        previousValue: base.value ?? null,
        currentValue: curr.value ?? null,
      });
    }
  }

  // Check what's gone from baseline
  for (const [name, base] of baselineMap) {
    if (!currentMap.has(name) && base.status === 'present') {
      removed.push(base.name);
    }
  }

  return { added, removed, changed };
}

function scoreDriftSeverity(
  scoreDelta: number,
  removedCount: number,
): DriftEvent['driftSeverity'] {
  if (scoreDelta < -5 || removedCount > 0) return 'regression';
  if (scoreDelta > 5) return 'improvement';
  return 'neutral';
}

export function useChecker() {
  /**
   * Take a fresh snapshot of a watch target.
   * If a baseline exists, diff against it and record a drift event if anything changed.
   * Returns the new snapshot.
   */
  const checkTarget = useCallback(
    async (watch: WatchTarget): Promise<{ snapshot: HeaderSnapshot; driftEvent: DriftEvent | null }> => {
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

      // Update the watch's last-checked metadata
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
              driftSeverity: scoreDriftSeverity(scoreDelta, removed.length),
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
    },
    [],
  );

  /**
   * Set a snapshot as the new baseline for a watch target, clearing the alert flag.
   */
  const rebaseline = useCallback(
    async (watch: WatchTarget, snapshotId: string): Promise<void> => {
      await setBaseline(watch.id, snapshotId);
      await updateWatch({
        ...watch,
        baselineSnapshotId: snapshotId,
        hasAlert: false,
      });
    },
    [],
  );

  return { checkTarget, rebaseline };
}
