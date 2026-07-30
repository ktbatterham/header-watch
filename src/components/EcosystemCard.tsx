/**
 * EcosystemCard — cross-promotes the other two apps in the SecURL suite
 * (SecURL and Cert Watch). Rendered on the home screen and on the
 * add-watch confirm screen. Platform-aware links: App Store on iOS,
 * securl.online/downloads on Android.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Image,
  Platform,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';

interface SuiteApp {
  icon: ImageSourcePropType;
  name: string;
  tagline: string;
  iosUrl: string;
}

const APPS: SuiteApp[] = [
  {
    icon: require('../../assets/suite/securl.png'),
    name: 'SecURL',
    tagline: 'A to F security posture grade for any URL',
    iosUrl: 'https://apps.apple.com/us/app/securl/id6774322464',
  },
  {
    icon: require('../../assets/suite/cert-watch.png'),
    name: 'Cert Watch',
    tagline: 'Track TLS certificate expiry and changes',
    iosUrl: 'https://apps.apple.com/us/app/cert-watch/id6774979236',
  },
];

const ANDROID_URL = 'https://securl.online/downloads';

// Free web tools in the suite. The CSP Builder is the natural companion to header
// monitoring: this app tells you a policy changed, the Builder helps you write the
// replacement. Attributed so the app -> web direction is measurable alongside the
// backend's csp_builder:header_watch traffic going the other way.
const CSP_BUILDER_URL =
  'https://securl.online/tools/csp-builder?utm_source=header_watch&utm_medium=app&utm_campaign=suite_cross_link';

function AppRow({ app }: { app: SuiteApp }) {
  const url = Platform.OS === 'android' ? ANDROID_URL : app.iosUrl;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => Linking.openURL(url)}
      activeOpacity={0.7}
      accessibilityRole="link"
      accessibilityLabel={`${app.name} — ${app.tagline}`}
    >
      <Image source={app.icon} style={styles.icon} />
      <View style={styles.rowText}>
        <Text style={styles.appName}>{app.name}</Text>
        <Text style={styles.tagline}>{app.tagline}</Text>
      </View>
      <Ionicons name="open-outline" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

export function EcosystemCard() {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>More from the SecURL suite</Text>
      {APPS.map((app, i) => (
        <React.Fragment key={app.name}>
          {i > 0 && <View style={styles.divider} />}
          <AppRow app={app} />
        </React.Fragment>
      ))}
      <View style={styles.divider} />
      <TouchableOpacity
        style={styles.row}
        onPress={() => Linking.openURL(CSP_BUILDER_URL)}
        activeOpacity={0.7}
        accessibilityRole="link"
        accessibilityLabel="CSP Builder — build a Content-Security-Policy in your browser, free"
      >
        <View style={styles.toolIcon}>
          <Ionicons name="construct-outline" size={20} color={colors.accentLight} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.appName}>CSP Builder</Text>
          <Text style={styles.tagline}>Write a Content-Security-Policy in your browser, free</Text>
        </View>
        <Ionicons name="open-outline" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  heading: {
    color: colors.textSecondary,
    fontSize: typography.sm,
    fontWeight: '700',
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
  },
  toolIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  appName: {
    color: colors.textPrimary,
    fontSize: typography.base,
    fontWeight: '700',
  },
  tagline: {
    color: colors.textSecondary,
    fontSize: typography.xs,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: 2,
  },
});
