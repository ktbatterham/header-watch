import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';
import type { TimelineEvent } from '../api/client';

interface Props {
  event: TimelineEvent;
  highlighted?: boolean;
}

function severityVisual(severity: string | null): {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  bg: string;
} {
  switch (severity) {
    case 'critical':
    case 'warning':
      return { icon: 'warning-outline', color: colors.warning, bg: colors.warningBg };
    case 'good':
      return { icon: 'checkmark-circle-outline', color: colors.good, bg: colors.goodBg };
    default:
      return { icon: 'information-circle-outline', color: colors.info, bg: colors.infoBg };
  }
}

function formatEvidenceValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

// Renders a single server-authored timeline entry (monitoring-timeline-v1).
// Prefers explanation.headline/detail/action; falls back to title/body when
// explanation is absent. `type` is treated as opaque per the contract — never
// switched on, only used as a stable identity, so unknown future values still
// render correctly. No locally-composed copy or severity computation.
export function TimelineEventCard({ event, highlighted }: Props) {
  const visual = severityVisual(event.severity);
  const headline = event.explanation?.headline ?? event.title;
  const detail = event.explanation?.detail ?? event.body;
  const action = event.explanation?.action ?? null;

  return (
    <View style={[styles.card, highlighted && styles.cardHighlighted]}>
      <View style={[styles.iconWrap, { backgroundColor: visual.bg }]}>
        <Ionicons name={visual.icon} size={18} color={visual.color} />
      </View>

      <View style={styles.content}>
        {headline && <Text style={styles.title}>{headline}</Text>}
        {detail && <Text style={styles.message}>{detail}</Text>}

        {event.evidence.map((ev, i) => (
          <Text key={i} style={styles.evidence} numberOfLines={1}>
            {ev.name ?? ev.kind}: {formatEvidenceValue(ev.previous)} → {formatEvidenceValue(ev.current)}
          </Text>
        ))}

        {action && (
          <Text style={styles.nextAction} numberOfLines={2}>
            Next: {action}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  cardHighlighted: {
    backgroundColor: colors.accentBg,
    borderRadius: radius.md,
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
  title: {
    color: colors.textPrimary,
    fontSize: typography.sm,
    fontWeight: '600',
  },
  message: {
    color: colors.textSecondary,
    fontSize: typography.sm,
  },
  evidence: {
    color: colors.textMuted,
    fontSize: typography.xs,
  },
  nextAction: {
    color: colors.accentLight,
    fontSize: typography.xs,
    marginTop: 2,
  },
});
