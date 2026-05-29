import { View, Text, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import { colors, typography, spacing } from '../src/theme';

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Page not found</Text>
      <Link href="/" style={styles.link}>
        Go home
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.lg,
  },
  link: {
    color: colors.accentLight,
    fontSize: typography.base,
  },
});
