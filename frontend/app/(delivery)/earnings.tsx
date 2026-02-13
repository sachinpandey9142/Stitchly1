import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

export default function DeliveryEarnings() {
  const [earnings, setEarnings] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const data = await api.get('/delivery/earnings'); setEarnings(data); } catch {} finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}><Text style={styles.headerTitle}>Earnings</Text></View>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Total Earnings</Text>
          <Text style={styles.balanceValue}>{'\u20B9'}{earnings?.total_earnings || 0}</Text>
          <Text style={styles.balanceSub}>{earnings?.total_deliveries || 0} deliveries @ {'\u20B9'}{earnings?.delivery_fee || 50}/delivery</Text>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statItem}><Feather name="truck" size={24} color={Colors.primary} /><Text style={styles.statValue}>{earnings?.total_deliveries || 0}</Text><Text style={styles.statLabel}>Total Deliveries</Text></View>
          <View style={styles.statItem}><Feather name="dollar-sign" size={24} color={Colors.success} /><Text style={styles.statValue}>{'\u20B9'}{earnings?.delivery_fee || 50}</Text><Text style={styles.statLabel}>Per Delivery</Text></View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.containerPadding, paddingTop: 16, paddingBottom: 12 },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text },
  balanceCard: { marginHorizontal: Spacing.containerPadding, backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: 24, alignItems: 'center' },
  balanceLabel: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textInverted + 'CC' },
  balanceValue: { fontFamily: Fonts.heading, fontSize: 40, color: Colors.textInverted, marginVertical: 8 },
  balanceSub: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textInverted + 'AA' },
  statsRow: { flexDirection: 'row', paddingHorizontal: Spacing.containerPadding, gap: 12, marginTop: 20 },
  statItem: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 20, alignItems: 'center' },
  statValue: { fontFamily: Fonts.bodyBold, fontSize: 24, color: Colors.text, marginTop: 10 },
  statLabel: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 4 },
});
