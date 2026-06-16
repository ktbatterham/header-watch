import { useState, useEffect, useCallback } from 'react';
import {
  loadWatches,
  addWatch,
  updateWatch,
  removeWatch,
} from '../storage/watches';
import { removeSnapshotsForWatch } from '../storage/snapshots';
import { removeEventsForWatch } from '../storage/events';
import { createMonitoringTarget, deleteMonitoringTarget } from '../api/client';
import type { WatchTarget } from '../types';

const APP_ID = 'com.ktbatterham.headerwatch';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

export function useWatches() {
  const [watches, setWatches] = useState<WatchTarget[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    let data = await loadWatches();
    setWatches(data);
    setLoading(false);
    // Backfill server monitoring for watches added before Phase 2 (best-effort,
    // once each — undefined means never attempted).
    const missing = data.filter((w) => w.serverTargetId === undefined);
    if (missing.length > 0) {
      for (const w of missing) {
        const serverTargetId = await createMonitoringTarget(w.url, 'daily', APP_ID);
        await updateWatch({ ...w, serverTargetId: serverTargetId ?? null });
      }
      data = await loadWatches();
      setWatches(data);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (url: string, baselineSnapshotId: string): Promise<WatchTarget> => {
      const normalized = url.startsWith('http') ? url : `https://${url}`;
      const watch: WatchTarget = {
        id: makeId(),
        url: normalized,
        host: hostFromUrl(normalized),
        addedAt: new Date().toISOString(),
        lastCheckedAt: null,
        lastGrade: null,
        lastScore: null,
        baselineSnapshotId,
        hasAlert: false,
        checkIntervalHours: 24,
      };
      await addWatch(watch);
      // Register server-side monitoring so the backend scans daily + pushes drift
      // even when the app is closed. Best-effort — the local checker still runs.
      const serverTargetId = await createMonitoringTarget(normalized, 'daily', APP_ID);
      const stored: WatchTarget = { ...watch, serverTargetId: serverTargetId ?? null };
      await updateWatch(stored);
      await refresh();
      return stored;
    },
    [refresh],
  );

  const update = useCallback(
    async (watch: WatchTarget) => {
      await updateWatch(watch);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const existing = (await loadWatches()).find((w) => w.id === id);
      if (existing?.serverTargetId) await deleteMonitoringTarget(existing.serverTargetId);
      await removeWatch(id);
      await removeSnapshotsForWatch(id);
      await removeEventsForWatch(id);
      await refresh();
    },
    [refresh],
  );

  const clearAlert = useCallback(
    async (id: string) => {
      const w = watches.find((x) => x.id === id);
      if (w && w.hasAlert) {
        await updateWatch({ ...w, hasAlert: false });
        await refresh();
      }
    },
    [watches, refresh],
  );

  return { watches, loading, refresh, add, update, remove, clearAlert };
}
