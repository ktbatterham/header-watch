import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HeaderSnapshot } from '../types';

const KEY = 'hw:snapshots_v1';
const MAX_PER_WATCH = 20;

export async function loadSnapshots(): Promise<HeaderSnapshot[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HeaderSnapshot[];
  } catch {
    return [];
  }
}

async function saveSnapshots(snapshots: HeaderSnapshot[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(snapshots));
}

export async function addSnapshot(snapshot: HeaderSnapshot): Promise<void> {
  const existing = await loadSnapshots();
  const forWatch = existing.filter((s) => s.watchId === snapshot.watchId);
  const others = existing.filter((s) => s.watchId !== snapshot.watchId);
  // Keep only most recent MAX_PER_WATCH per watch
  const trimmed = [snapshot, ...forWatch].slice(0, MAX_PER_WATCH);
  await saveSnapshots([...trimmed, ...others]);
}

export async function getSnapshotsForWatch(watchId: string): Promise<HeaderSnapshot[]> {
  const all = await loadSnapshots();
  return all
    .filter((s) => s.watchId === watchId)
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
}

export async function getSnapshotById(id: string): Promise<HeaderSnapshot | null> {
  const all = await loadSnapshots();
  return all.find((s) => s.id === id) ?? null;
}

export async function removeSnapshotsForWatch(watchId: string): Promise<void> {
  const all = await loadSnapshots();
  await saveSnapshots(all.filter((s) => s.watchId !== watchId));
}

export async function setBaseline(watchId: string, snapshotId: string): Promise<void> {
  const all = await loadSnapshots();
  const updated = all.map((s) => {
    if (s.watchId !== watchId) return s;
    return { ...s, isBaseline: s.id === snapshotId };
  });
  await saveSnapshots(updated);
}
