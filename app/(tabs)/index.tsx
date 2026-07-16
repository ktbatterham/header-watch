import React, { useCallback, useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { colors, spacing, typography, radius } from '../../src/theme';
import { useWatches } from '../../src/hooks/useWatches';
import { sendTestNotification, fetchMonitoringHealth, fetchMonitoringAttention } from '../../src/api/client';
import type { MonitoringHealth, ParsedAttention } from '../../src/api/schemas';
import { haptics } from '../../src/haptics';
import { WatchRow } from '../../src/components/WatchRow';
import { getBackgroundFetchStatus } from '../../src/tasks/background';
import { deriveAttention, attentionFromServer } from '../../src/lib/attention';

export default function WatchesScreen() {
  const router = useRouter();
  const { watches, loading, serverStatus, refresh, remove } = useWatches();
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [bgStatus, setBgStatus] = useState<{ available: boolean; registered: boolean } | null>(null);
  const [health, setHealth] = useState<MonitoringHealth | null>(null);
  // Server-authored attention rollup (`monitoring-attention-v1`). null when the
  // capability is absent or the fetch fails → fall back to local deriveAttention.
  const [attentionServer, setAttentionServer] = useState<ParsedAttention | null>(null);

  const handleTestNotification = () => {
    Alert.alert(
      'Send test notification',
      'Send a test push to this device to confirm notifications are working?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            haptics.light();
            setTesting(true);
            const result = await sendTestNotification();
            setTesting(false);
            if (result.ok) haptics.success();
            else haptics.warning();
            Alert.alert(result.ok ? 'Sent' : 'Not sent', result.message);
          },
        },
      ],
    );
  };

  useEffect(() => {
    getBackgroundFetchStatus().then(setBgStatus).catch(() => {});
    // Best-effort: fetchMonitoringHealth() resolves null on any failure, and a
    // null health simply hides the server-monitoring caption.
    fetchMonitoringHealth().then(setHealth);
    // Non-blocking: fetchMonitoringAttention() resolves null when the
    // `monitoring-attention-v1` flag is absent or the fetch fails, keeping the
    // local deriveAttention path (byte-identical to today).
    fetchMonitoringAttention().then(setAttentionServer).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    fetchMonitoringHealth().then(setHealth); // fire-and-forget alongside the list refresh
    fetchMonitoringAttention().then(setAttentionServer).catch(() => {}); // ditto
    await refresh();
    setRefreshing(false);
  };

  // Server monitoring confidence caption. Degraded when the scheduler is off,
  // the last sweep failed, or push delivery isn't configured server-side; a
  // pushDevicesNeedingRegistration count means this owner's device(s) need
  // notifications re-enabled before alerts can arrive.
  const monitoringDegraded =
    health !== null &&
    (!health.schedulerEnabled ||
      !health.lastSweepHealthy ||
      !health.notificationsEnabled ||
      !health.credentialsConfigured);
  // Attention-first ordering + rollup counts. Prefer the server-authored
  // `monitoring-attention-v1` rollup when the flag is present AND the fetch
  // returned data (attentionServer non-null); otherwise fall back to the local
  // per-target derivation. With no data on either path this is a no-op: original
  // order, zero counts, no attention line.
  const attention = useMemo(
    () =>
      attentionServer
        ? attentionFromServer(attentionServer, watches)
        : deriveAttention(watches, serverStatus),
    [attentionServer, watches, serverStatus],
  );
  const attentionCount = attention.counts.attention + attention.counts.critical;

  const monitoringCaption =
    health === null
      ? null
      : (monitoringDegraded
          ? 'Monitoring degraded: checks may be delayed'
          : 'Server monitoring active · last sweep healthy') +
        (health.pushDevicesNeedingRegistration > 0
          ? ' · re-enable notifications to get alerts'
          : '');

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Header Watch</Text>
          <Text style={styles.subtitle}>
            {watches.length === 0
              ? 'No URLs watched yet'
              : `${watches.length} URL${watches.length === 1 ? '' : 's'} monitored`}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={handleTestNotification}
            disabled={testing}
            activeOpacity={0.8}
            accessibilityLabel="Send a test notification"
          >
            {testing ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => { haptics.light(); router.push('/add'); }}
            activeOpacity={0.8}
            accessibilityLabel="Add a URL to watch"
          >
            <Ionicons name="add" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {attentionCount > 0 && (
        <View style={styles.attentionBar}>
          <View
            style={[
              styles.attentionDot,
              attention.state === 'critical' && styles.attentionDotCritical,
            ]}
          />
          <Text style={styles.attentionText}>
            {attentionCount === 1 ? '1 needs attention' : `${attentionCount} need attention`}
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.list}
        contentContainerStyle={watches.length === 0 && styles.emptyContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accentLight}
          />
        }
      >
        {watches.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="eye-off-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No watches yet</Text>
            <Text style={styles.emptyText}>
              Add a URL to start monitoring its security headers for changes.
            </Text>
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => { haptics.light(); router.push('/add'); }}
              activeOpacity={0.8}
            >
              <Text style={styles.emptyBtnText}>Add your first URL</Text>
            </TouchableOpacity>
          </View>
        ) : (
          attention.orderedWatches.map((watch) => (
            <WatchRow
              key={watch.id}
              watch={watch}
              serverStatus={serverStatus.get(watch.id)}
              onPress={() => {
                haptics.light();
                router.push({
                  pathname: '/watch/[id]',
                  params: { id: watch.id },
                });
              }}
            />
          ))
        )}
      </ScrollView>

      {monitoringCaption !== null && watches.length > 0 && (
        <View style={styles.monitoringStatus}>
          <Ionicons
            name={monitoringDegraded ? 'cloud-offline-outline' : 'cloud-done-outline'}
            size={12}
            color={monitoringDegraded ? colors.warning : colors.good}
          />
          <Text
            style={[styles.monitoringStatusText, monitoringDegraded && styles.monitoringStatusDegraded]}
            numberOfLines={1}
          >
            {monitoringCaption}
          </Text>
        </View>
      )}

      {bgStatus && watches.length > 0 && (
        <View style={styles.bgStatus}>
          <Ionicons
            name={bgStatus.registered ? 'radio-outline' : 'radio-button-off-outline'}
            size={12}
            color={bgStatus.registered ? colors.good : colors.textMuted}
          />
          <Text style={[styles.bgStatusText, bgStatus.registered && styles.bgStatusActive]}>
            {bgStatus.registered
              ? 'Background checks active'
              : bgStatus.available
              ? 'Background checks pending'
              : 'Background checks unavailable'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.xl,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.sm,
    marginTop: 2,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  attentionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  attentionDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.warning,
  },
  attentionDotCritical: {
    backgroundColor: colors.critical,
  },
  attentionText: {
    color: colors.warning,
    fontSize: typography.sm,
    fontWeight: '600',
  },
  monitoringStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  monitoringStatusText: {
    color: colors.textMuted,
    fontSize: typography.xs,
  },
  monitoringStatusDegraded: {
    color: colors.warning,
  },
  bgStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  bgStatusText: {
    color: colors.textMuted,
    fontSize: typography.xs,
  },
  bgStatusActive: {
    color: colors.good,
  },
  emptyContainer: {
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: typography.lg,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: typography.base,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    marginTop: spacing.sm,
  },
  emptyBtnText: {
    color: colors.textPrimary,
    fontSize: typography.base,
    fontWeight: '600',
  },
});
