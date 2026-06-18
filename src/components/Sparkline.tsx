/**
 * Sparkline — a tiny View-based bar chart of score over time (no chart deps).
 * Each bar's height is its 0–100 score; each bar is coloured by its grade, so a
 * regression reads at a glance (greens dipping to ambers/reds).
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { gradeColor } from '../theme';

export interface SparklinePoint {
  score: number;
  grade: string;
}

interface SparklineProps {
  data: SparklinePoint[]; // chronological, oldest → newest
  height?: number;
  maxBars?: number;
}

export function Sparkline({ data, height = 56, maxBars = 30 }: SparklineProps) {
  const points = data.slice(-maxBars); // most recent maxBars
  if (points.length === 0) return null;

  return (
    <View style={[styles.row, { height }]}>
      {points.map((p, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: `${Math.max(6, Math.min(100, p.score))}%`,
              backgroundColor: gradeColor(p.grade),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  bar: {
    flex: 1,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
});
