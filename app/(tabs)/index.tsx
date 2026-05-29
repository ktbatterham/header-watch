import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, typography, radius } from '../../src/theme';
import { useWatches } from '../../src/hooks/useWatches';
import { useChecker } from '../../src/hooks/useChecker';
import { WatchRow } from '../../src/components/WatchRow';
import { scheduleDriftNotification } from '../../src/notifications';

export default function WatchesScreen() {
  const router = useRouter();
  const { watches, loading, refresh, remove } = useWatches();
  const { checkTarget } = useChecker();
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const handleCheckNow = async (watchId: string) => {
    const watch = watches.find((w) => w.id === watchId);
    if (!watch) return;
    setCheckingId(watchId);
    try {
      const { driftEvent } = await checkTarget(watch);
      if (driftEvent) {
        await scheduleDriftNotification(driftEvent);
      }
      await refresh();
    } catch (e: any) {
      Alert.alert('Check failed', e.message ?? 'Could not reach the server.');
    } finally {
      setCheckingId(null);
    }
  };

  const handleDelete = (watchId: string, host: string) => {
    Alert.alert(
      'Remove watch',
      `Stop watching ${host}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => remove(watchId),
        },
      ],
    );
  };

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
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push('/add')}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

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
              onPress={() => router.push('/add')}
              activeOpacity={0.8}
            >
              <Text style={styles.emptyBtnText}>Add your first URL</Text>
            </TouchableOpacity>
          </View>
        ) : (
          watches.map((watch) => (
            <WatchRow
              key={watch.id}
              watch={watch}
              onPress={() =>
                router.push({
                  pathname: '/watch/[id]',
                  params: { id: watch.id },
                })
              }
            />
          ))
        )}
      </ScrollView>
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
