import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, typography } from '../theme';
import { gradeColor } from '../theme';

interface Props {
  grade: string;
  size?: 'sm' | 'md' | 'lg';
}

export function GradeBadge({ grade, size = 'md' }: Props) {
  const color = gradeColor(grade);
  const fontSize =
    size === 'sm' ? typography.xs : size === 'lg' ? typography.xl : typography.base;
  const dim =
    size === 'sm' ? 28 : size === 'lg' ? 52 : 38;

  return (
    <View
      style={[
        styles.badge,
        {
          width: dim,
          height: dim,
          borderRadius: radius.sm,
          borderColor: color,
          backgroundColor: `${color}1a`,
        },
      ]}
    >
      <Text style={[styles.text, { color, fontSize }]}>{grade}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  text: {
    fontWeight: '700',
    letterSpacing: -0.5,
  },
});
