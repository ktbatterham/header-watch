import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  configureNotificationHandler,
  requestNotificationPermissions,
  registerForRemotePush,
} from '../src/notifications';
import { registerBackgroundFetch } from '../src/tasks/background';
import { colors } from '../src/theme';

// Background task must be imported here so it's defined before any render.
import '../src/tasks/background';

export default function RootLayout() {
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
