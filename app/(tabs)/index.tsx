import React, { useCallback, useState, useEffect } from 'react';
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
import { useFocusEffect } from 'expo-router';
import { colors, spacing, typography, radius } from '../../src/theme';
import { useWatches } from '../../src/hooks/useWatches';
import { WatchRow } from '../../src/components/WatchRow';
import { getBackgroundFetchStatus } from '../../src/tasks/background';

export default function WatchesScreen() {
  const router = useRouter();
  const { watches, loading, refresh, remove } = useWatches();
  const [refreshing, setRefreshing] = useState(false);
  const [bgStatus, setBgStatus] = useState<{ available: boolean; registered: boolean } | null>(null);

  useEffect(() => {
    getBackgroundFetchStatus().then(setBgStatus).catch(() => {});
  }, []);

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
