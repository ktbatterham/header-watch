import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../src/theme';
import { scanUrl } from '../src/api/client';
import { addSnapshot } from '../src/storage/snapshots';
import { useWatches } from '../src/hooks/useWatches';
import { haptics } from '../src/haptics';
import { GradeBadge } from '../src/components/GradeBadge';
import { EcosystemCard } from '../src/components/EcosystemCard';
import type { ScanResult, HeaderSnapshot } from '../src/types';

type Step = 'input' | 'scanning' | 'confirm';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function AddScreen() {
  const router = useRouter();
  const { add } = useWatches();

  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [pendingSnapshotId, setPendingSnapshotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setStep('scanning');
    try {
      const result = await scanUrl(trimmed);
      setScanResult(result);

      // Save the initial snapshot (will become the baseline)
      const snapshotId = makeId();
      const snapshot: HeaderSnapshot = {
        id: snapshotId,
        watchId: '__pending__', // will be updated when watch is created
        capturedAt: new Date().toISOString(),
        grade: result.grade,
        score: result.score,
        headers: result.headers ?? [],
        isBaseline: true,
      };
      await addSnapshot(snapshot);
      setPendingSnapshotId(snapshotId);
      setStep('confirm');
      haptics.light();
    } catch (e: any) {
      haptics.error();
      setError(e.message ?? 'Scan failed. Check the URL and try again.');
      setStep('input');
    }
  };

  const handleConfirm = async () => {
    if (!scanResult || !pendingSnapshotId) return;
    const normalized = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`;
    await add(normalized, pendingSnapshotId);
    haptics.success();
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'input' && (
          <>
            <View style={styles.iconWrap}>
              <Ionicons name="eye-outline" size={36} color={colors.accentLight} />
            </View>
            <Text style={styles.heading}>Add a URL to watch</Text>
            <Text style={styles.subheading}>
              We'll scan it now to capture a baseline, then alert you if headers change.
            </Text>

            <TextInput
              style={[styles.input, error ? styles.inputError : null]}
              value={url}
              onChangeText={setUrl}
              placeholder="github.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleScan}
              autoFocus
            />

            {error && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color={colors.critical} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.btn, !url.trim() && styles.btnDisabled]}
              onPress={handleScan}
              disabled={!url.trim()}
              activeOpacity={0.8}
            >
              <Text style={styles.btnText}>Scan & baseline</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'scanning' && (
          <View style={styles.scanning}>
            <ActivityIndicator size="large" color={colors.accentLight} />
            <Text style={styles.scanningText}>Scanning {url}…</Text>
            <Text style={styles.scanningMeta}>Capturing baseline headers</Text>
          </View>
        )}

        {step === 'confirm' && scanResult && (
          <>
            <View style={styles.resultHeader}>
              <GradeBadge grade={scanResult.grade} size="lg" />
              <View style={styles.resultMeta}>
                <Text style={styles.resultHost}>{scanResult.host}</Text>
                <Text style={styles.resultScore}>Score {scanResult.score} · {scanResult.grade}</Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>Baseline captured</Text>
            <View style={styles.headerList}>
              {(scanResult.headers ?? []).slice(0, 8).map((h) => (
                <View key={h.name} style={styles.headerRow}>
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor:
                          h.status === 'present'
                            ? colors.good
                            : h.status === 'missing'
                            ? colors.critical
                            : colors.warning,
                      },
                    ]}
                  />
                  <Text style={styles.headerName} numberOfLines={1}>{h.name}</Text>
                  <Text style={styles.headerStatus}>{h.status}</Text>
                </View>
              ))}
              {(scanResult.headers?.length ?? 0) > 8 && (
                <Text style={styles.moreHeaders}>
                  +{(scanResult.headers?.length ?? 0) - 8} more headers
                </Text>
              )}
            </View>

            <Text style={styles.confirmNote}>
              Any change to these headers will trigger an alert.
            </Text>

            <View style={styles.confirmBtns}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  setStep('input');
                  setScanResult(null);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryBtnText}>Change URL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.confirmBtn]}
                onPress={handleConfirm}
                activeOpacity={0.8}
              >
                <Text style={styles.btnText}>Start watching</Text>
              </TouchableOpacity>
            </View>

            <EcosystemCard />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: typography.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  subheading: {
    color: colors.textSecondary,
    fontSize: typography.base,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: typography.base,
  },
  inputError: {
    borderColor: colors.critical,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: -spacing.sm,
  },
  errorText: {
    color: colors.critical,
    fontSize: typography.sm,
    flex: 1,
  },
  btn: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnText: {
    color: colors.textPrimary,
    fontSize: typography.base,
    fontWeight: '600',
  },
  scanning: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl * 2,
  },
  scanningText: {
    color: colors.textPrimary,
    fontSize: typography.md,
    fontWeight: '600',
  },
  scanningMeta: {
    color: colors.textMuted,
    fontSize: typography.sm,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  resultMeta: {
    flex: 1,
    gap: 3,
  },
  resultHost: {
    color: colors.textPrimary,
    fontSize: typography.md,
    fontWeight: '700',
  },
  resultScore: {
    color: colors.textSecondary,
    fontSize: typography.sm,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: typography.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  headerList: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    gap: spacing.sm,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
  },
  headerName: {
    color: colors.textPrimary,
    fontSize: typography.sm,
    flex: 1,
  },
  headerStatus: {
    color: colors.textMuted,
    fontSize: typography.xs,
  },
  moreHeaders: {
    color: colors.textMuted,
    fontSize: typography.xs,
    paddingVertical: spacing.sm,
    textAlign: 'center',
  },
  confirmNote: {
    color: colors.textSecondary,
    fontSize: typography.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  confirmBtns: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: {
    color: colors.textSecondary,
    fontSize: typography.base,
    fontWeight: '500',
  },
  confirmBtn: {
    flex: 2,
    marginTop: 0,
  },
});
