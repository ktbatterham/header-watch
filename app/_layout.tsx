import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import {
  configureNotificationHandler,
  requestNotificationPermissions,
  registerForRemotePush,
} from '../src/notifications';
import { registerBackgroundFetch } from '../src/tasks/background';
import { loadWatches } from '../src/storage/watches';
import { colors } from '../src/theme';

// Background task must be imported here so it's defined before any render.
import '../src/tasks/background';

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    configureNotificationHandler();

    // Ask for notification permission then register background task.
    // Both are best-effort — the app works fine without them.
    requestNotificationPermissions().then((granted) => {
      if (granted) {
        registerBackgroundFetch().catch(() => {});
        // Register this device's APNs token so the backend can push drift alerts.
        registerForRemotePush().catch(() => {});
      }
    });
  }, []);

  // Tapping a drift push opens the matching watch (best-effort; falls back to the
  // watch list). The backend includes host/targetId in the notification data.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data = response.notification.request.content.data as Record<string, unknown>;
        const host = typeof data?.host === 'string' ? data.host : null;
        const targetId = typeof data?.targetId === 'string' ? data.targetId : null;
        loadWatches()
          .then((ws) => {
            const match = ws.find(
              (w) => (targetId && w.serverTargetId === targetId) || (host && w.host === host),
            );
            router.push(match ? `/watch/${match.id}` : '/');
          })
          .catch(() => {});
      } catch {
        // ignore malformed payloads
      }
    });
    return () => sub.remove();
  }, [router]);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontWeight: '700', color: colors.textPrimary },
          contentStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="watch/[id]"
          options={{ title: 'Watch Detail', presentation: 'card' }}
        />
        <Stack.Screen
          name="add"
          options={{ title: 'Add Watch', presentation: 'modal' }}
        />
      </Stack>
    </>
  );
}
