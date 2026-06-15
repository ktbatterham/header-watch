import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WatchTarget } from '../types';

const STORAGE_NAMESPACE = 'hw:watches_v1';

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

export async function addWatch(watch: WatchTarget): Promise<void> {
  const existing = await loadWatches();
  await saveWatches([watch, ...existing]);
}

export async function updateWatch(updated: WatchTarget): Promise<void> {
  const existing = await loadWatches();
  await saveWatches(existing.map((w) => (w.id === updated.id ? updated : w)));
}

export async function removeWatch(id: string): Promise<void> {
  const existing = await loadWatches();
  await saveWatches(existing.filter((w) => w.id !== id));
}
