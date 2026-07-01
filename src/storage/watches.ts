import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WatchTarget } from '../types';
import { createLock } from './lock';

const STORAGE_NAMESPACE = 'hw:watches_v1';
const withLock = createLock();

export async function loadWatches(): Promise<WatchTarget[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_NAMESPACE);
    if (!raw) return [];
    return JSON.parse(raw) as WatchTarget[];
  } catch {
    return [];
  }
}

export async function saveWatches(watches: WatchTarget[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_NAMESPACE, JSON.stringify(watches));
}

export function addWatch(watch: WatchTarget): Promise<void> {
  return withLock(async () => {
    const existing = await loadWatches();
    await saveWatches([watch, ...existing]);
  });
}

export function updateWatch(updated: WatchTarget): Promise<void> {
  return withLock(async () => {
    const existing = await loadWatches();
    await saveWatches(existing.map((w) => (w.id === updated.id ? updated : w)));
  });
}

export function removeWatch(id: string): Promise<void> {
  return withLock(async () => {
    const existing = await loadWatches();
    await saveWatches(existing.filter((w) => w.id !== id));
  });
}
