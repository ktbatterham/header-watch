import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';
import type { DriftEvent } from '../types';

interface Props {
  event: DriftEvent;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DriftEventRow({ event }: Props) {
  const isRegression = event.driftSeverity === 'regression';
  const isImprovement = event.driftSeverity === 'improvement';

  const iconName = isRegression
    ? 'warning-outline'
    : isImprovement
    ? 'trending-up-outline'
    : 'swap-horizontal-outline';

  const iconColor = isRegression
    ? colors.warning
    : isImprovement
    ? colors.good
    : colors.info;

  const bgColor = isRegression
    ? colors.warningBg
    : isImprovement
    ? colors.goodBg
    : colors.infoBg;

  const changes: string[] = [];
  if (event.removedHeaders.length > 0) {
    changes.push(`Removed: ${event.removedHeaders.join(', ')}`);
  }
  if (event.addedHeaders.length > 0) {
    changes.push(`Added: ${event.addedHeaders.join(', ')}`);
  }
  if (event.changedHeaders.length > 0) {
    changes.push(`Changed: ${event.changedHeaders.map((h) => h.name).join(', ')}`);
  }

  const gradeChanged = event.previousGrade !== event.currentGrade;

  return (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: bgColor }]}>
        <Ionicons name={iconName as any} size={18} color={iconColor} />
      </View>

      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.host} numberOfLines={1}>{event.host}</Text>
          <Text style={styles.time}>{relativeTime(event.detectedAt)}</Text>
        </View>

        {gradeChanged && (
          <Text style={styles.gradeChange}>
            Grade {event.previousGrade} → {event.currentGrade}
            {event.scoreDelta !== 0 && ` (${event.scoreDelta > 0 ? '+' : ''}${event.scoreDelta})`}
          </Text>
        )}

        {changes.map((c, i) => (
          <Text key={i} style={styles.change} numberOfLines={1}>{c}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  content: {
    flex: 1,
    gap: 3,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  host: {
    color: colors.textPrimary,
    fontSize: typography.sm,
    fontWeight: '600',
    flex: 1,
  },
  time: {
    color: colors.textMuted,
    fontSize: typography.xs,
  },
  gradeChange: {
    color: colors.textSecondary,
    fontSize: typography.sm,
    fontWeight: '500',
  },
  change: {
    color: colors.textMuted,
    fontSize: typography.xs,
  },
});
