import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import {
  configureNotificationHandler,
  requestNotificationPermissions,
  registerForRemotePush,
} from '../src/notifications';
import { registerBackgroundFetch } from '../src/tasks/background';
import { loadWatches } from '../src/storage/watches';
import { colors } from '../src/theme';
import { View } from 'react-native';
import { useOnboarding } from '../src/onboarding/useOnboarding';
import { Onboarding } from '../src/components/Onboarding';

// Background task must be imported here so it's defined before any render.
import '../src/tasks/background';

// Privacy-safe crash reporting: crashes only, no PII, no tracing, no user or
// hostname context. Disabled entirely in development.
Sentry.init({
  dsn: 'https://03cc11a2da01c85673383fd29b6d0e81@o4511729899601920.ingest.de.sentry.io/4511729999478864',
  enabled: !__DEV__,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  environment: __DEV__ ? 'development' : 'production',
});

function RootLayout() {
  const router = useRouter();
  const { seen, dismiss } = useOnboarding();

  useEffect(() => {
    configureNotificationHandler();
  }, []);

  // Ask for notification permission + register background/push only AFTER
  // onboarding — don't prompt before the app has explained what it does.
  useEffect(() => {
    if (seen !== true) return;
    requestNotificationPermissions().then((granted) => {
      if (granted) {
        registerBackgroundFetch().catch(() => {});
        registerForRemotePush().catch(() => {});
      }
    });
  }, [seen]);

  // Tapping a drift push opens the matching watch (best-effort; falls back to the
  // watch list). The backend includes host/targetId in the notification data,
  // and now (mobile-monitoring-explanations-v1) an eventId that lets the detail
  // screen highlight the exact event that fired the push. Route by targetId
  // first — host stays as the fallback for older pushes or absent identity.
  // Android note: FCM delivers nested `data` objects JSON-string encoded. This
  // listener only reads top-level string fields (host/targetId/eventId), which
  // arrive identically on both platforms — if it ever reads an object-valued
  // field (e.g. deepLink), add a JSON.parse fallback for the Android encoding.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data = response.notification.request.content.data as Record<string, unknown>;
        const host = typeof data?.host === 'string' ? data.host : null;
        const targetId = typeof data?.targetId === 'string' ? data.targetId : null;
        const eventId = typeof data?.eventId === 'string' ? data.eventId : null;
        loadWatches()
          .then((ws) => {
            const match = ws.find(
              (w) => (targetId && w.serverTargetId === targetId) || (host && w.host === host),
            );
            if (match) {
              router.push({
                pathname: '/watch/[id]',
                params: eventId ? { id: match.id, eventId } : { id: match.id },
              });
            } else {
              router.push('/');
            }
          })
          .catch(() => {});
      } catch {
        // ignore malformed payloads
      }
    });
    return () => sub.remove();
  }, [router]);

  if (seen === null) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  if (seen === false) {
    return (
      <>
        <StatusBar style="light" />
        <Onboarding onDone={dismiss} />
      </>
    );
  }

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

export default Sentry.wrap(RootLayout);
