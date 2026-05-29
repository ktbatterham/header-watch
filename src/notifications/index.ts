import * as Notifications from 'expo-notifications';
import type { DriftEvent } from '../types';

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function scheduleDriftNotification(event: DriftEvent): Promise<void> {
  const isRegression = event.driftSeverity === 'regression';
  const title = isRegression
    ? `⚠️ Header change detected — ${event.host}`
    : `✓ Headers improved — ${event.host}`;

  const parts: string[] = [];
  if (event.removedHeaders.length > 0) {
    parts.push(`Removed: ${event.removedHeaders.join(', ')}`);
  }
  if (event.addedHeaders.length > 0) {
    parts.push(`Added: ${event.addedHeaders.join(', ')}`);
  }
  if (event.changedHeaders.length > 0) {
    parts.push(`Changed: ${event.changedHeaders.map((h) => h.name).join(', ')}`);
  }

  const gradeChanged = event.previousGrade !== event.currentGrade;
  if (gradeChanged) {
    parts.push(`Grade: ${event.previousGrade} → ${event.currentGrade}`);
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: parts.join(' · ') || 'Security headers have changed.',
      data: { watchId: event.watchId, eventId: event.id },
    },
    trigger: null, // immediate
  });
}

export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
