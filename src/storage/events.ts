import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DriftEvent } from '../types';
import { createLock } from './lock';

const STORAGE_NAMESPACE = 'hw:events_v1';
const MAX_EVENTS = 200;
const withLock = createLock();

export async function loadEvents(): Promise<DriftEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_NAMESPACE);
    if (!raw) return [];
    return JSON.parse(raw) as DriftEvent[];
  } catch {
    return [];
  }
}

async function saveEvents(events: DriftEvent[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_NAMESPACE, JSON.stringify(events));
}

export function addEvent(event: DriftEvent): Promise<void> {
  return withLock(async () => {
    const existing = await loadEvents();
    const trimmed = [event, ...existing].slice(0, MAX_EVENTS);
    await saveEvents(trimmed);
  });
}

export async function getEventsForWatch(watchId: string): Promise<DriftEvent[]> {
  const all = await loadEvents();
  return all.filter((e) => e.watchId === watchId);
}

export function removeEventsForWatch(watchId: string): Promise<void> {
  return withLock(async () => {
    const all = await loadEvents();
    await saveEvents(all.filter((e) => e.watchId !== watchId));
  });
}
