import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { configureNotificationHandler } from '../src/notifications';
import { colors } from '../src/theme';

export default function RootLayout() {
  useEffect(() => {
    configureNotificationHandler();
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
