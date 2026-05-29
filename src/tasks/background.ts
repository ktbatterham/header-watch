import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { loadWatches } from '../storage/watches';
import { scheduleDriftNotification } from '../notifications';
import { checkWatch, isDue } from './checkWatch';

export const BACKGROUND_FETCH_TASK = 'hw-header-check';

// ── Task definition ───────────────────────────────────────────────────────────
// Must be defined at the module's top level — called before any React renders.

TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    const watches = await loadWatches();
    const due = watches.filter(isDue);

    if (due.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    let foundNew = false;

    for (const watch of due) {
      try {
        const { driftEvent } = await checkWatch(watch);
        if (driftEvent) {
          await scheduleDriftNotification(driftEvent);
          foundNew = true;
        }
      } catch {
        // Don't let one failing watch abort the whole task
      }
    }

    return foundNew
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register the background fetch task.
 * Safe to call multiple times — no-ops if already registered.
 *
 * iOS: minimum interval is ~15 min regardless of what you pass.
 * The OS decides the actual cadence based on battery, usage patterns, etc.
 */
export async function registerBackgroundFetch(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();

  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    // Background fetch is disabled in device settings — nothing we can do
    return;
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
  if (isRegistered) return;

  await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
    minimumInterval: 60 * 60, // 1 hour in seconds (iOS may run less frequently)
    stopOnTerminate: false,   // continue after app is closed
    startOnBoot: true,        // Android: restart after device reboot
  });
}

export async function unregisterBackgroundFetch(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
  if (isRegistered) {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
  }
}

export async function getBackgroundFetchStatus(): Promise<{
  available: boolean;
  registered: boolean;
}> {
  const status = await BackgroundFetch.getStatusAsync();
  const available =
    status !== BackgroundFetch.BackgroundFetchStatus.Restricted &&
    status !== BackgroundFetch.BackgroundFetchStatus.Denied;
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
  return { available, registered };
}
