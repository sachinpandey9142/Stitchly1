import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

export default function TailorEarnings() {
  const [earnings, setEarnings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEarnings = async () => {
    try { const data = await api.get('/tailor/earnings'); setEarnings(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchEarnings(); }, []);

  const handleWithdraw = async () => {
    if (!earnings || earnings.available_balance <= 0) { Alert.alert('Error', 'No balance to withdraw'); return; }
    try {
      await api.post('/tailor/withdraw', { amount: earnings.available_balance });
      Alert.alert('Success', 'Withdrawal request submitted for admin approval');
      fetchEarnings();
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEarnings(); }} tintColor={Colors.primary} />}>
        <View style={styles.header}><Text style={styles.headerTitle}>Earnings</Text></View>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceValue}>{'\u20B9'}{earnings?.available_balance?.toFixed(0) || 0}</Text>
          <TouchableOpacity testID="withdraw-btn" style={styles.withdrawBtn} onPress={handleWithdraw} activeOpacity={0.7}>
            <Text style={styles.withdrawText}>Withdraw</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.statsRow}>
          {[
            { label: 'Total Earned', value: `\u20B9${earnings?.total_earnings?.toFixed(0) || 0}` },
            { label: 'Pending', value: `\u20B9${earnings?.pending_earnings?.toFixed(0) || 0}` },
            { label: 'Withdrawn', value: `\u20B9${earnings?.total_withdrawn?.toFixed(0) || 0}` },
          ].map((s) => (
            <View key={s.label} style={styles.statItem}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
        {earnings?.withdrawals?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Withdrawal History</Text>
            {earnings.withdrawals.map((w: any) => (
              <View key={w.id} style={styles.wRow}>
                <View><Text style={styles.wAmount}>{'\u20B9'}{w.amount}</Text><Text style={styles.wDate}>{new Date(w.created_at).toLocaleDateString('en-IN')}</Text></View>
                <View style={[styles.wBadge, { backgroundColor: w.status === 'approved' ? Colors.success + '18' : Colors.warning + '18' }]}>
                  <Text style={[styles.wStatus, { color: w.status === 'approved' ? Colors.success : Colors.warning }]}>{w.status}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
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
  withdrawBtn: { backgroundColor: Colors.textInverted, borderRadius: Radius.full, paddingHorizontal: 32, paddingVertical: 12, marginTop: 8 },
  withdrawText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.primary },
  statsRow: { flexDirection: 'row', paddingHorizontal: Spacing.containerPadding, gap: 10, marginTop: 16 },
  statItem: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 14, alignItems: 'center' },
  statValue: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text },
  statLabel: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  section: { margin: Spacing.containerPadding, marginTop: 20, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16 },
  sectionTitle: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text, marginBottom: 12 },
  wRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.subtle },
  wAmount: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  wDate: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  wBadge: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  wStatus: { fontFamily: Fonts.bodyBold, fontSize: 12, textTransform: 'capitalize' },
});
