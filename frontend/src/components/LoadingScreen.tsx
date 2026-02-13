import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors } from '../utils/theme';

export default function LoadingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Stitchly</Text>
      <Text style={styles.tagline}>Your Tailoring Marketplace</Text>
      <ActivityIndicator size="large" color={Colors.primary} style={styles.loader} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  logo: {
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 42,
    color: Colors.primary,
    marginBottom: 8,
  },
  tagline: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 16,
    color: Colors.textMuted,
    marginBottom: 32,
  },
  loader: {
    marginTop: 10,
  },
});
