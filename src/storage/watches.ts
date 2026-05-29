import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WatchTarget } from '../types';

const KEY = 'hw:watches_v1';

export async function loadWatches(): Promise<WatchTarget[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as WatchTarget[];
  } catch {
    return [];
  }
}

export async function saveWatches(watches: WatchTarget[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(watches));
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
