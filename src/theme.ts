// Header Watch colour system — same copper palette as SecURL
export const colors = {
  // backgrounds
  bg: '#070b14',
  surface: '#111827',
  surfaceElevated: '#1a2438',
  border: '#1f2d45',
  borderSubtle: '#162030',

  // text
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#4b5e7a',

  // brand copper accent
  accent: '#b56a2c',
  accentLight: '#d89a63',
  accentBg: 'rgba(181,106,44,0.14)',

  // grades
  gradeA: '#22c55e',
  gradeB: '#3b82f6',
  gradeC: '#eab308',
  gradeD: '#f97316',
  gradeF: '#ef4444',
  gradeU: '#6b7280',

  // severity / drift
  critical: '#ef4444',
  criticalBg: 'rgba(239,68,68,0.12)',
  warning: '#f97316',
  warningBg: 'rgba(249,115,22,0.12)',
  info: '#3b82f6',
  infoBg: 'rgba(59,130,246,0.10)',
  good: '#22c55e',
  goodBg: 'rgba(34,197,94,0.10)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export const typography = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return colors.gradeA;
  if (grade.startsWith('B')) return colors.gradeB;
  if (grade.startsWith('C')) return colors.gradeC;
  if (grade.startsWith('D')) return colors.gradeD;
  if (grade === 'F') return colors.gradeF;
  return colors.gradeU;
}
