import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerDevice, registerAndroidDevice, getNotificationFeatures } from '../api/client';
import type { DriftEvent } from '../types';

const APP_ID = 'com.ktbatterham.headerwatch';
const REGISTERED_TOKEN_KEY = 'hw:registered-apns-token';
const REGISTERED_FCM_TOKEN_KEY = 'hw:registered-fcm-token';
const ANDROID_FCM_CAPABILITY = 'android-fcm-push-v1';

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function scheduleDriftNotification(event: DriftEvent): Promise<void> {
  const isRegression = event.driftSeverity === 'regression';
  const title = isRegression
    ? `⚠️ Header change detected: ${event.host}`
    : `✓ Headers improved: ${event.host}`;

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

// ── Remote push registration ────────────────────────────────────────────────
// Fetch this device's native APNs token and register it with the backend so the
// server can send drift pushes directly. Best-effort and idempotent: it skips
// the network call when the token is unchanged. Requires the push entitlement
// (provided by the expo-notifications config plugin) and granted permissions.
export async function registerForRemotePush(): Promise<void> {
  if (Platform.OS === 'android') {
    await registerForAndroidRemotePush();
    return;
  }
  if (Platform.OS !== 'ios') return; // web etc. — no remote push
  try {
    const tokenResult = await Notifications.getDevicePushTokenAsync();
    const apnsToken = typeof tokenResult.data === 'string' ? tokenResult.data : '';
    if (!apnsToken) return;

    const prior = await AsyncStorage.getItem(REGISTERED_TOKEN_KEY).catch(() => null);
    if (prior === apnsToken) return; // already registered with this exact token

    // aps-environment is 'development' (sandbox) for dev builds, 'production' for
    // TestFlight + App Store builds.
    const environment = __DEV__ ? 'sandbox' : 'production';
    await registerDevice(apnsToken, APP_ID, environment);
    await AsyncStorage.setItem(REGISTERED_TOKEN_KEY, apnsToken).catch(() => {});
  } catch {
    // Non-fatal — the app works without remote push (on-device checks still run).
  }
}

// Android mirror of the APNs path (backend `android-fcm-push-v1`, live 2026-07-14).
// Gated on the capability being advertised, then registers the native FCM token via
// the same owner-scoped endpoint. Deliberately best-effort end to end: until a
// google-services.json / Firebase config ships in the app binary,
// getDevicePushTokenAsync() rejects on Android — the catch below swallows that so
// today's builds behave exactly as before (on-device background fetch fallback).
async function registerForAndroidRemotePush(): Promise<void> {
  try {
    const features = await getNotificationFeatures();
    if (!features?.includes(ANDROID_FCM_CAPABILITY)) return;

    const tokenResult = await Notifications.getDevicePushTokenAsync();
    const fcmToken = typeof tokenResult.data === 'string' ? tokenResult.data : '';
    if (!fcmToken) return;

    const prior = await AsyncStorage.getItem(REGISTERED_FCM_TOKEN_KEY).catch(() => null);
    if (prior === fcmToken) return; // already registered with this exact token

    // environment is APNs semantics; the backend accepts and ignores it for FCM.
    // Sent so the Android body carries the same shared fields as the iOS one.
    const environment = __DEV__ ? 'sandbox' : 'production';
    await registerAndroidDevice(fcmToken, APP_ID, environment);
    await AsyncStorage.setItem(REGISTERED_FCM_TOKEN_KEY, fcmToken).catch(() => {});
  } catch {
    // Non-fatal — no Firebase config yet, or transient failure. The app works
    // without remote push (on-device checks still run).
  }
}
