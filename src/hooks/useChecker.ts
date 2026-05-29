import { useCallback } from 'react';
import { checkWatch, rebaselineWatch } from '../tasks/checkWatch';
import type { WatchTarget, HeaderSnapshot, DriftEvent } from '../types';

export function useChecker() {
  const checkTarget = useCallback(
    (watch: WatchTarget) => checkWatch(watch),
    [],
  );

  const rebaseline = useCallback(
    (watch: WatchTarget, snapshotId: string) => rebaselineWatch(watch, snapshotId),
    [],
  );

  return { checkTarget, rebaseline };
}
