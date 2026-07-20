import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import { colors, spacing, radius, typography } from '../../src/theme';
import { gradeColor, policyVerdictColor, policyVerdictBg } from '../../src/theme';
import { loadWatches } from '../../src/storage/watches';
import { getSnapshotsForWatch, getSnapshotById } from '../../src/storage/snapshots';
import { getEventsForWatch } from '../../src/storage/events';
import { useChecker } from '../../src/hooks/useChecker';
import { useWatches } from '../../src/hooks/useWatches';
import { haptics } from '../../src/haptics';
import { openScanHandoff, shareWatchUrl } from '../../src/lib/webHandoff';
import { scheduleDriftNotification } from '../../src/notifications';
import { updateWatch } from '../../src/storage/watches';
import { SectionCard } from '../../src/components/SectionCard';
import { GradeBadge } from '../../src/components/GradeBadge';
import { HeaderDiff } from '../../src/components/HeaderDiff';
import { DriftEventRow } from '../../src/components/DriftEventRow';
import { ServerEventCard } from '../../src/components/ServerEventCard';
import { TimelineEventCard } from '../../src/components/TimelineEventCard';
import { Sparkline } from '../../src/components/Sparkline';
import { fetchMonitoringTimeline, type TimelineEvent } from '../../src/api/client';
import type { WatchTarget, HeaderSnapshot, DriftEvent } from '../../src/types';

export default function WatchDetailScreen() {
  const { id, eventId } = useLocalSearchParams<{ id: string; eventId?: string }>();
  const router = useRouter();
  const { remove, clearAlert, serverStatus } = useWatches();
  const { checkTarget, rebaseline } = useChecker();

  const [watch, setWatch] = useState<WatchTarget | null>(null);
  const [baseline, setBaseline] = useState<HeaderSnapshot | null>(null);
  const [latest, setLatest] = useState<HeaderSnapshot | null>(null);
  const [events, setEvents] = useState<DriftEvent[]>([]);
  const [snapshots, setSnapshots] = useState<HeaderSnapshot[]>([]);
  const [checking, setChecking] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    const watches = await loadWatches();
    const w = watches.find((x) => x.id === id);
    if (!w) return;
    setWatch(w);

    const snapshots = await getSnapshotsForWatch(id);
    setSnapshots(snapshots);
    const base = w.baselineSnapshotId
      ? await getSnapshotById(w.baselineSnapshotId)
      : null;
    setBaseline(base);
    setLatest(snapshots[0] ?? null);

    const evts = await getEventsForWatch(id);
    setEvents(evts.sort((a, b) =>
      new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
    ));

    // Full per-target history (monitoring-timeline-v1), best-effort. null/empty
    // (capability absent, no server target, fetch failed, zero events) leaves
    // `timeline` empty and the screen falls back to the single-event section.
    setTimeline(w.serverTargetId ? (await fetchMonitoringTimeline(w.serverTargetId)) ?? [] : []);

    // Clear the alert when the user views the detail
    if (w.hasAlert) await clearAlert(id);
  }, [id, clearAlert]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleCheckNow = async () => {
    if (!watch) return;
    haptics.light();
    setChecking(true);
    try {
      const { driftEvent } = await checkTarget(watch);
      if (driftEvent) {
        haptics.warning();
        await scheduleDriftNotification(driftEvent);
      }
      await load();
    } catch (e: any) {
      haptics.error();
      Alert.alert('Check failed', e.message ?? 'Could not reach the server.');
    } finally {
      setChecking(false);
    }
  };

  const handleRebaseline = () => {
    if (!watch || !latest) return;
    haptics.medium();
    Alert.alert(
      'Update baseline',
      'Set the current headers as the new baseline? This will clear any pending alerts.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update baseline',
          onPress: async () => {
            await rebaseline(watch, latest.id);
            await load();
          },
        },
      ],
    );
  };

  const handleDelete = () => {
    if (!watch) return;
    haptics.medium();
    Alert.alert(
      'Remove watch',
      `Stop watching ${watch.host}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await remove(watch.id);
            router.back();
          },
        },
      ],
    );
  };

  const handleShare = async () => {
    if (!watch) return;
    haptics.light();
    const gradeSummary = watch.lastGrade ? `Grade ${watch.lastGrade}` : 'not yet checked';
    const verdictSummary =
      showPolicyFit && policyFit ? `, policy ${policyFit.verdict}` : '';
    const message =
      `${watch.host} security headers: ${gradeSummary}${verdictSummary} — ` +
      `I'm watching it with Header Watch. Full report: ${shareWatchUrl(watch.url)}`;
    try {
      const result = await Share.share({ message });
      const outcome = result.action === Share.dismissedAction ? 'dismissed' : 'completed';
      if (__DEV__) console.log(`[share] watch_share ${outcome}`);
      Sentry.addBreadcrumb({ category: 'share', message: `watch_share ${outcome}`, level: 'info' });
    } catch {
      // Non-fatal — mirror openScanHandoff's best-effort posture.
    }
  };

  const serverEvents = watch ? serverStatus.get(watch.id)?.events ?? [] : [];
  // Server-authored policy verdict (backend `monitoring-policy-fit-v1`,
  // request #9). Missing block or verdict "unknown" both mean "not yet
  // evaluated" — render nothing extra and leave the rest of the screen exactly
  // as it is today. The client never recomputes verdict/headline/violations
  // locally; everything below is display of server-sent fields only.
  const policyFit = watch ? serverStatus.get(watch.id)?.policyFit ?? null : null;
  const showPolicyFit = policyFit !== null && policyFit.verdict !== 'unknown';

  if (!watch) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentLight} />
      </View>
    );
  }

  const showDiff =
    baseline && latest && baseline.id !== latest.id && baseline.headers.length > 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Hero */}
      <SectionCard style={styles.hero}>
        <View style={styles.heroTop}>
          {watch.lastGrade ? (
            <GradeBadge grade={watch.lastGrade} size="lg" />
          ) : (
            <View style={styles.pendingBadge}>
              <Ionicons name="time-outline" size={24} color={colors.textMuted} />
            </View>
          )}
          <View style={styles.heroMeta}>
            <Text style={styles.heroHost}>{watch.host}</Text>
            <Text style={styles.heroUrl} numberOfLines={1}>{watch.url}</Text>
            {watch.lastCheckedAt && (
              <Text style={styles.heroTime}>
                Last checked {formatDate(watch.lastCheckedAt)}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.heroActions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.primaryBtn]}
            onPress={handleCheckNow}
            disabled={checking}
            activeOpacity={0.8}
          >
            {checking ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Ionicons name="refresh-outline" size={16} color={colors.textPrimary} />
            )}
            <Text style={styles.actionBtnText}>
              {checking ? 'Checking…' : 'Check now'}
            </Text>
          </TouchableOpacity>

          {latest && latest.id !== watch.baselineSnapshotId && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.secondaryBtn]}
              onPress={handleRebaseline}
              activeOpacity={0.8}
            >
              <Ionicons name="flag-outline" size={16} color={colors.accentLight} />
              <Text style={styles.secondaryBtnText}>Set as baseline</Text>
            </TouchableOpacity>
          )}
        </View>
      </SectionCard>

      {/* Mobile → web handoff: Header Watch covers headers; the web app runs a
          full posture scan of the same target (contract MOBILE-WEB-GROWTH). */}
      <View style={styles.secondaryActionsRow}>
        <TouchableOpacity
          style={[styles.webHandoffBtn, styles.secondaryActionBtn]}
          onPress={() => { haptics.light(); openScanHandoff(watch.url); }}
          activeOpacity={0.8}
          accessibilityLabel="Run a full SecURL scan on the web"
        >
          <Ionicons name="open-outline" size={16} color={colors.accentLight} />
          <Text style={styles.webHandoffText}>Run full SecURL scan</Text>
        </TouchableOpacity>

        {/* Share this watch's current status via the native share sheet — distinct
            from the web handoff above, which is a self-directed scanner handoff. */}
        <TouchableOpacity
          style={[styles.webHandoffBtn, styles.secondaryActionBtn]}
          onPress={handleShare}
          activeOpacity={0.8}
          accessibilityLabel={`Share ${watch.host}'s security header status`}
        >
          <Ionicons name="share-outline" size={16} color={colors.accentLight} />
          <Text style={styles.webHandoffText}>Share status</Text>
        </TouchableOpacity>
      </View>

      {snapshots.length >= 2 && (
        <SectionCard>
          <Text style={styles.trendLabel}>Score trend</Text>
          <Sparkline
            data={[...snapshots].reverse().map((s) => ({ score: s.score, grade: s.grade }))}
          />
          <View style={styles.trendMeta}>
            <Text style={styles.trendMetaText}>{snapshots.length} checks</Text>
            <Text style={styles.trendMetaText}>now {snapshots[0].score}/100</Text>
          </View>
        </SectionCard>
      )}

      {/* Header diff */}
      {showDiff && baseline && latest && (
        <View>
          <Text style={styles.sectionLabel}>Header comparison</Text>
          <SectionCard>
            <View style={styles.diffLegend}>
              <Text style={styles.diffLegendLabel}>Baseline</Text>
              <Text style={styles.diffLegendArrow}>→</Text>
              <Text style={styles.diffLegendLabel}>Current</Text>
            </View>
            <HeaderDiff
              baseline={baseline.headers}
              current={latest.headers}
            />
          </SectionCard>
        </View>
      )}

      {baseline && latest && baseline.id === latest.id && (
        <View>
          <Text style={styles.sectionLabel}>Baseline headers</Text>
          <SectionCard>
            <HeaderDiff
              baseline={baseline.headers}
              current={baseline.headers}
            />
          </SectionCard>
        </View>
      )}

      {/* Server-authored policy verdict — monitoring-policy-fit-v1. Renders the
          backend's headline/verdict/summary/topViolations exactly as sent; no
          local policy evaluation. Only shown when the capability is live and
          this target has a policyFit block with a resolved (non-"unknown")
          verdict — otherwise the screen looks exactly as it does today. */}
      {showPolicyFit && policyFit && (
        <View>
          <Text style={styles.sectionLabel}>Policy fit</Text>
          <SectionCard>
            <View style={styles.policyHeader}>
              <View
                style={[styles.policyBadge, { backgroundColor: policyVerdictBg(policyFit.verdict) }]}
              >
                <Ionicons
                  name={
                    policyFit.verdict === 'pass'
                      ? 'checkmark-circle-outline'
                      : policyFit.verdict === 'drift'
                      ? 'alert-circle-outline'
                      : 'close-circle-outline'
                  }
                  size={14}
                  color={policyVerdictColor(policyFit.verdict)}
                />
                <Text style={[styles.policyBadgeText, { color: policyVerdictColor(policyFit.verdict) }]}>
                  {policyFit.verdict.toUpperCase()}
                </Text>
              </View>
              {policyFit.policyName && (
                <Text style={styles.policyName} numberOfLines={1}>
                  {policyFit.policyName}
                  {policyFit.policyVersion ? ` v${policyFit.policyVersion}` : ''}
                </Text>
              )}
            </View>

            {policyFit.headline && <Text style={styles.policyHeadline}>{policyFit.headline}</Text>}
            {policyFit.summary && policyFit.summary.violations > 0 && (
              <Text style={styles.policySummary}>
                {policyFit.summary.violations} of {policyFit.summary.rulesEvaluated} rule
                {policyFit.summary.rulesEvaluated === 1 ? '' : 's'} violated
              </Text>
            )}

            {policyFit.topViolations.length > 0 && (
              <View style={styles.violationsList}>
                {policyFit.topViolations.map((v, i) => (
                  <View key={v.id ?? i} style={styles.violationRow}>
                    <Ionicons name="ellipse" size={4} color={colors.textMuted} style={styles.violationBullet} />
                    <Text style={styles.violationText} numberOfLines={2}>
                      {v.title ?? v.subject ?? 'Policy violation'}
                      {v.summary ? `: ${v.summary}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {policyFit.evaluatedAt && (
              <Text style={styles.policyEvaluated}>
                Evaluated {formatDate(policyFit.evaluatedAt)}
              </Text>
            )}
          </SectionCard>
        </View>
      )}

      {/* Full per-target history — monitoring-timeline-v1. Supersedes the
          single-event "What changed" section below when present and non-empty
          (same join key, so a push tap still highlights the right entry).
          Renders backend explanation/title/body directly; no locally-composed
          copy or severity computation. */}
      {timeline.length > 0 ? (
        <View>
          <Text style={styles.sectionLabel}>Timeline</Text>
          <SectionCard style={{ padding: 0 }}>
            {timeline.map((event) => (
              <TimelineEventCard
                key={event.eventId}
                event={event}
                highlighted={event.eventId === eventId}
              />
            ))}
          </SectionCard>
        </View>
      ) : (
        /* Server-authored explanation for the most recent monitored check —
           mobile-monitoring-explanations-v1. Renders backend title/message/
           changedEvidence/severity/nextAction directly; no locally-composed
           copy. Fallback when the timeline endpoint has no data for this
           target (capability absent, no server target, fetch failed, or
           genuinely zero events). */
        serverEvents.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>What changed (server-monitored)</Text>
            <SectionCard style={{ padding: 0 }}>
              {serverEvents.map((event) => (
                <ServerEventCard
                  key={event.eventId}
                  event={event}
                  highlighted={event.eventId === eventId}
                />
              ))}
            </SectionCard>
          </View>
        )
      )}

      {/* On-device check history — the local drift fallback. Always shown when
          present so nothing is lost if server monitoring is absent/disabled for
          this target; independent of the server section above. */}
      {events.length > 0 && (
        <View>
          <Text style={styles.sectionLabel}>
            Local check history ({events.length})
          </Text>
          <SectionCard style={{ padding: 0 }}>
            {events.map((event) => (
              <DriftEventRow key={event.id} event={event} />
            ))}
          </SectionCard>
        </View>
      )}

      {/* Check interval */}
      <View>
        <Text style={styles.sectionLabel}>Check interval</Text>
        <SectionCard>
          <View style={styles.intervalRow}>
            {([1, 6, 24] as const).map((hrs) => (
              <TouchableOpacity
                key={hrs}
                style={[
                  styles.intervalBtn,
                  watch.checkIntervalHours === hrs && styles.intervalBtnActive,
                ]}
                onPress={async () => {
                  const updated = { ...watch, checkIntervalHours: hrs };
                  await updateWatch(updated);
                  setWatch(updated);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: watch.checkIntervalHours === hrs }}
              >
                <Text
                  style={[
                    styles.intervalBtnText,
                    watch.checkIntervalHours === hrs && styles.intervalBtnTextActive,
                  ]}
                >
                  {hrs === 1 ? '1h' : hrs === 6 ? '6h' : '24h'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.intervalNote}>
            Background checks run automatically at this cadence. iOS controls
            the exact timing based on battery and usage patterns.
          </Text>
        </SectionCard>
      </View>

      {/* Danger zone */}
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={handleDelete}
        activeOpacity={0.8}
      >
        <Ionicons name="trash-outline" size={16} color={colors.critical} />
        <Text style={styles.deleteBtnText}>Remove watch</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  trendLabel: {
    fontSize: typography.xs,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  trendMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  trendMetaText: {
    fontSize: typography.xs,
    color: colors.textMuted,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  hero: {
    gap: spacing.md,
  },
  heroTop: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  heroMeta: {
    flex: 1,
    gap: 2,
  },
  heroHost: {
    color: colors.textPrimary,
    fontSize: typography.md,
    fontWeight: '700',
  },
  heroUrl: {
    color: colors.textMuted,
    fontSize: typography.xs,
  },
  heroTime: {
    color: colors.textMuted,
    fontSize: typography.xs,
  },
  pendingBadge: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  heroActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    flex: 1,
    justifyContent: 'center',
  },
  primaryBtn: {
    backgroundColor: colors.accent,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnText: {
    color: colors.textPrimary,
    fontSize: typography.sm,
    fontWeight: '600',
  },
  secondaryBtnText: {
    color: colors.accentLight,
    fontSize: typography.sm,
    fontWeight: '600',
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: typography.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  diffLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  diffLegendLabel: {
    color: colors.textMuted,
    fontSize: typography.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  diffLegendArrow: {
    color: colors.textMuted,
    fontSize: typography.xs,
  },
  intervalRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  intervalBtn: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  intervalBtnActive: {
    backgroundColor: colors.accentBg,
    borderColor: colors.accent,
  },
  intervalBtnText: {
    color: colors.textSecondary,
    fontSize: typography.sm,
    fontWeight: '600',
  },
  intervalBtnTextActive: {
    color: colors.accentLight,
  },
  intervalNote: {
    color: colors.textMuted,
    fontSize: typography.xs,
    lineHeight: 17,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.criticalBg,
    marginTop: spacing.lg,
  },
  deleteBtnText: {
    color: colors.critical,
    fontSize: typography.base,
    fontWeight: '600',
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryActionBtn: {
    flex: 1,
  },
  webHandoffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  webHandoffText: {
    color: colors.accentLight,
    fontSize: typography.sm,
    fontWeight: '600',
  },
  policyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  policyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  policyBadgeText: {
    fontSize: typography.xs,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  policyName: {
    color: colors.textMuted,
    fontSize: typography.xs,
    flexShrink: 1,
  },
  policyHeadline: {
    color: colors.textPrimary,
    fontSize: typography.sm,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  policySummary: {
    color: colors.textSecondary,
    fontSize: typography.sm,
    marginTop: 4,
  },
  violationsList: {
    marginTop: spacing.sm,
    gap: 6,
  },
  violationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  violationBullet: {
    marginTop: 6,
  },
  violationText: {
    color: colors.textMuted,
    fontSize: typography.xs,
    flex: 1,
  },
  policyEvaluated: {
    color: colors.textMuted,
    fontSize: typography.xs,
    marginTop: spacing.sm,
  },
});
