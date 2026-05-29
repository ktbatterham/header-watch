// ── Shared with SecURL backend ──────────────────────────────────────────────

export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F' | 'U';
export type Severity = 'good' | 'info' | 'warning' | 'critical';

export interface SecurityHeaderResult {
  name: string;
  status: 'present' | 'missing' | 'weak' | 'informational';
  value?: string | null;
  severity: Severity;
  recommendation?: string;
}

export interface ScanIssue {
  id: string;
  title: string;
  severity: Severity;
  description?: string;
  remediation?: string;
}

// Minimal slice of AnalysisResult we need from the SecURL API
export interface ScanResult {
  host: string;
  finalUrl: string;
  scannedAt: string;
  score: number;
  grade: string;
  summary: string;
  headers?: SecurityHeaderResult[];
  issues: ScanIssue[];
  strengths: string[];
}

// ── Header Watch domain types ────────────────────────────────────────────────

export type DriftSeverity = 'regression' | 'improvement' | 'neutral';

// A URL being monitored
export interface WatchTarget {
  id: string;
  url: string;
  host: string;
  addedAt: string;
  lastCheckedAt: string | null;
  lastGrade: string | null;
  lastScore: number | null;
  baselineSnapshotId: string | null;
  hasAlert: boolean; // unread drift event present
  checkIntervalHours: 1 | 6 | 24;
}

// A point-in-time capture of headers + grade for a watch target
export interface HeaderSnapshot {
  id: string;
  watchId: string;
  capturedAt: string;
  grade: string;
  score: number;
  headers: SecurityHeaderResult[];
  isBaseline: boolean;
}

// A header that changed between two snapshots
export interface ChangedHeader {
  name: string;
  previousStatus: SecurityHeaderResult['status'];
  currentStatus: SecurityHeaderResult['status'];
  previousValue: string | null;
  currentValue: string | null;
}

// A detected drift event between baseline and a new snapshot
export interface DriftEvent {
  id: string;
  watchId: string;
  host: string;
  detectedAt: string;
  baselineSnapshotId: string;
  currentSnapshotId: string;
  previousGrade: string;
  currentGrade: string;
  scoreDelta: number; // positive = improved
  driftSeverity: DriftSeverity;
  addedHeaders: string[];    // header names newly present
  removedHeaders: string[];  // header names now missing
  changedHeaders: ChangedHeader[];
}
