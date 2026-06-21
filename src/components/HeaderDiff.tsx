import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';
import type { SecurityHeaderResult } from '../types';

interface Props {
  baseline: SecurityHeaderResult[];
  current: SecurityHeaderResult[];
}

type HeaderState = 'added' | 'removed' | 'changed' | 'unchanged';

interface RowData {
  name: string;
  state: HeaderState;
  baseStatus?: SecurityHeaderResult['status'];
  currStatus?: SecurityHeaderResult['status'];
  baseValue?: string | null;
  currValue?: string | null;
}

const STATUS_PRIORITY: Record<SecurityHeaderResult['status'], number> = {
  present: 3,
  weak: 2,
  informational: 1,
  missing: 0,
};

function statusLabel(status: SecurityHeaderResult['status']): string {
  switch (status) {
    case 'present': return 'present';
    case 'missing': return 'missing';
    case 'weak': return 'weak';
    case 'informational': return 'info';
  }
}

function statusColor(status: SecurityHeaderResult['status']): string {
  switch (status) {
    case 'present': return colors.good;
    case 'missing': return colors.critical;
    case 'weak': return colors.warning;
    case 'informational': return colors.info;
  }
}

export function HeaderDiff({ baseline, current }: Props) {
  // Resolve a key/display safely — headers may be normalized (name) or in raw
  // engine shape (label/key) from older stored snapshots.
  const hkey = (h: SecurityHeaderResult) => (h.name ?? h.label ?? h.key ?? '').toLowerCase();
  const baseMap = new Map(baseline.filter((h) => hkey(h)).map((h) => [hkey(h), h]));
  const currMap = new Map(current.filter((h) => hkey(h)).map((h) => [hkey(h), h]));

  const allNames = new Set([...baseMap.keys(), ...currMap.keys()]);
  const rows: RowData[] = [];

  for (const name of allNames) {
    const base = baseMap.get(name);
    const curr = currMap.get(name);
    const displayName = curr?.name ?? curr?.label ?? curr?.key ?? base?.name ?? base?.label ?? base?.key ?? name;

    if (!base && curr) {
      rows.push({ name: displayName, state: 'added', currStatus: curr.status, currValue: curr.value });
    } else if (base && !curr) {
      rows.push({ name: displayName, state: 'removed', baseStatus: base.status, baseValue: base.value });
    } else if (base && curr && base.status !== curr.status) {
      rows.push({
        name: displayName,
        state: 'changed',
        baseStatus: base.status,
        currStatus: curr.status,
        baseValue: base.value,
        currValue: curr.value,
      });
    } else if (base && curr) {
      rows.push({
        name: displayName,
        state: 'unchanged',
        baseStatus: base.status,
        currStatus: curr.status,
      });
    }
  }

  // Sort: changed/removed/added first, then unchanged
  rows.sort((a, b) => {
    const priority = { removed: 3, changed: 2, added: 1, unchanged: 0 };
    return priority[b.state] - priority[a.state];
  });

  return (
    <View style={styles.container}>
      {rows.map((row) => (
        <View key={row.name} style={styles.row}>
          <View style={styles.indicator}>
            {row.state === 'added' && <Ionicons name="add-circle" size={14} color={colors.good} />}
            {row.state === 'removed' && <Ionicons name="remove-circle" size={14} color={colors.critical} />}
            {row.state === 'changed' && <Ionicons name="swap-horizontal" size={14} color={colors.warning} />}
            {row.state === 'unchanged' && <View style={styles.dot} />}
          </View>

          <View style={styles.content}>
            <Text
              style={[
                styles.name,
                row.state === 'unchanged' && styles.nameMuted,
              ]}
            >
              {row.name}
            </Text>

            {row.state === 'changed' && row.baseStatus && row.currStatus && (
              <View style={styles.diffPill}>
                <Text style={[styles.statusText, { color: statusColor(row.baseStatus) }]}>
                  {statusLabel(row.baseStatus)}
                </Text>
                <Ionicons name="arrow-forward" size={10} color={colors.textMuted} />
                <Text style={[styles.statusText, { color: statusColor(row.currStatus) }]}>
                  {statusLabel(row.currStatus)}
                </Text>
              </View>
            )}

            {(row.state === 'added' || row.state === 'removed') && (
              <Text style={[
                styles.statusText,
                { color: statusColor(row.state === 'added' ? (row.currStatus ?? 'present') : (row.baseStatus ?? 'missing')) }
              ]}>
                {row.state === 'added' ? statusLabel(row.currStatus ?? 'present') : statusLabel(row.baseStatus ?? 'missing')}
              </Text>
            )}

            {row.state === 'unchanged' && row.baseStatus && (
              <Text style={[styles.statusText, { color: statusColor(row.baseStatus) }]}>
                {statusLabel(row.baseStatus)}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    gap: spacing.sm,
  },
  indicator: {
    width: 16,
    alignItems: 'center',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.textMuted,
    opacity: 0.4,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  name: {
    color: colors.textPrimary,
    fontSize: typography.sm,
    fontWeight: '500',
    flex: 1,
  },
  nameMuted: {
    color: colors.textSecondary,
    fontWeight: '400',
  },
  diffPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusText: {
    fontSize: typography.xs,
    fontWeight: '500',
  },
});
