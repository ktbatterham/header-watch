import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';
import { gradeColor } from '../theme';
import { GradeBadge } from './GradeBadge';
import type { WatchTarget } from '../types';

interface Props {
  watch: WatchTarget;
  onPress: () => void;
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function WatchRow({ watch, onPress }: Props) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.left}>
        {watch.lastGrade ? (
          <GradeBadge grade={watch.lastGrade} size="md" />
        ) : (
          <View style={styles.pendingBadge}>
            <Ionicons name="time-outline" size={18} color={colors.textMuted} />
          </View>
        )}
      </View>

      <View style={styles.middle}>
        <View style={styles.hostRow}>
          <Text style={styles.host} numberOfLines={1}>{watch.host}</Text>
          {watch.hasAlert && (
            <View style={styles.alertDot} />
          )}
        </View>
        <Text style={styles.meta}>
          Checked {relativeTime(watch.lastCheckedAt)}
          {watch.lastScore != null ? ` · Score ${watch.lastScore}` : ''}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    gap: spacing.md,
  },
  left: {},
  middle: {
    flex: 1,
    gap: 2,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  host: {
    color: colors.textPrimary,
    fontSize: typography.base,
    fontWeight: '600',
    flex: 1,
  },
  alertDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.warning,
  },
  meta: {
    color: colors.textMuted,
    fontSize: typography.xs,
  },
  pendingBadge: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
});
