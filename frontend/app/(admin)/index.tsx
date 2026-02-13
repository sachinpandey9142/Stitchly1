import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

export default function AdminDashboard() {
  const { logout } = useAuth();
  const router = useRouter();
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAnalytics = async () => {
    try { const data = await api.get('/admin/analytics'); setAnalytics(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { fetchAnalytics(); }, []);

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAnalytics(); }} tintColor={Colors.primary} />}>
        <View style={styles.headerRow}>
          <View><Text style={styles.greeting}>Admin Panel</Text><Text style={styles.headerTitle}>Dashboard</Text></View>
          <TouchableOpacity testID="admin-logout-btn" onPress={() => Alert.alert('Logout', 'Are you sure?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Logout', style: 'destructive', onPress: async () => { await logout(); router.replace('/(auth)/login'); } }])} activeOpacity={0.7}>
            <Feather name="log-out" size={22} color={Colors.error} />
          </TouchableOpacity>
        </View>

        <View style={styles.revenueCard}>
          <Text style={styles.revenueLabel}>Total Revenue</Text>
          <Text style={styles.revenueValue}>{'\u20B9'}{analytics?.total_revenue || 0}</Text>
          <Text style={styles.commissionText}>Commission Earned: {'\u20B9'}{analytics?.total_commission || 0}</Text>
        </View>

        <View style={styles.statsGrid}>
          {[
            { label: 'Users', value: analytics?.total_users, icon: 'users' as const, color: Colors.info },
            { label: 'Customers', value: analytics?.total_customers, icon: 'shopping-bag' as const, color: Colors.primary },
            { label: 'Tailors', value: analytics?.total_tailors, icon: 'scissors' as const, color: Colors.secondary },
            { label: 'Delivery', value: analytics?.total_delivery, icon: 'truck' as const, color: Colors.success },
            { label: 'Orders', value: analytics?.total_orders, icon: 'package' as const, color: Colors.warning },
            { label: 'Delivered', value: analytics?.delivered_orders, icon: 'check-circle' as const, color: Colors.success },
          ].map((stat) => (
            <View key={stat.label} style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: stat.color + '18' }]}><Feather name={stat.icon} size={20} color={stat.color} /></View>
              <Text style={styles.statValue}>{stat.value || 0}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {(analytics?.pending_tailors > 0 || analytics?.pending_withdrawals > 0) && (
          <View style={styles.alertSection}>
            <Text style={styles.alertTitle}>Action Required</Text>
            {analytics.pending_tailors > 0 && (
              <View style={styles.alertRow}><Feather name="alert-circle" size={18} color={Colors.warning} /><Text style={styles.alertText}>{analytics.pending_tailors} tailors pending approval</Text></View>
            )}
            {analytics.pending_withdrawals > 0 && (
              <View style={styles.alertRow}><Feather name="alert-circle" size={18} color={Colors.warning} /><Text style={styles.alertText}>{analytics.pending_withdrawals} withdrawal requests pending</Text></View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.containerPadding, paddingTop: 16 },
  greeting: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginTop: 2 },
  revenueCard: { marginHorizontal: Spacing.containerPadding, marginTop: 20, backgroundColor: Colors.primaryDark, borderRadius: Radius.lg, padding: 24, alignItems: 'center' },
  revenueLabel: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textInverted + 'CC' },
  revenueValue: { fontFamily: Fonts.heading, fontSize: 40, color: Colors.textInverted, marginVertical: 8 },
  commissionText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textInverted + 'AA' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.containerPadding, gap: 10, marginTop: 20 },
  statCard: { width: '31%', backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 14, alignItems: 'center' },
  statIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  statValue: { fontFamily: Fonts.bodyBold, fontSize: 22, color: Colors.text },
  statLabel: { fontFamily: Fonts.ui, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  alertSection: { margin: Spacing.containerPadding, marginTop: 20, backgroundColor: Colors.warning + '10', borderRadius: Radius.lg, padding: 16, borderWidth: 1, borderColor: Colors.warning + '30', marginBottom: 20 },
  alertTitle: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.warning, marginBottom: 10 },
  alertRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  alertText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text, marginLeft: 8 },
});
