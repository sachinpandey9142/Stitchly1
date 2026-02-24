import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { api } from '../../../src/utils/api';
import { useAuth } from '../../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius, STATUS_COLORS, STATUS_LABELS } from '../../../src/utils/theme';

export default function TailorDashboard() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try { const data = await api.get('/orders/tailor'); setOrders(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const pending = orders.filter(o => o.status === 'placed').length;
  const active = orders.filter(o => ['accepted', 'in_stitching', 'completed'].includes(o.status)).length;
  const delivered = orders.filter(o => o.status === 'delivered').length;
  const totalEarnings = orders.filter(o => o.status === 'delivered').reduce((sum, o) => sum + (o.price - o.commission_amount), 0);

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={Colors.primary} />}>
        <View style={styles.headerSection}>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.headerTitle}>{user?.name}</Text>
          {user?.status === 'pending' && (
            <View style={styles.pendingBanner}>
              <Feather name="clock" size={18} color={Colors.warning} />
              <Text style={styles.pendingText}>Your account is pending admin approval</Text>
            </View>
          )}
        </View>

        <View style={styles.statsGrid}>
          {[
            { label: 'New Orders', value: pending, icon: 'inbox' as const, color: Colors.info },
            { label: 'Active', value: active, icon: 'activity' as const, color: Colors.secondary },
            { label: 'Completed', value: delivered, icon: 'check-circle' as const, color: Colors.success },
            { label: 'Earnings', value: `\u20B9${totalEarnings}`, icon: 'dollar-sign' as const, color: Colors.primary },
          ].map((stat) => (
            <View key={stat.label} style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: stat.color + '18' }]}>
                <Feather name={stat.icon} size={22} color={stat.color} />
              </View>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Orders</Text>
          {orders.slice(0, 5).map((order) => (
            <View key={order.id} style={styles.orderRow}>
              <View style={styles.orderInfo}>
                <Text style={styles.orderService}>{order.service_type}</Text>
                <Text style={styles.orderCustomer}>{order.customer_name}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[order.status] || Colors.textMuted) + '18' }]}>
                <Text style={[styles.statusText, { color: STATUS_COLORS[order.status] || Colors.textMuted }]}>{STATUS_LABELS[order.status] || order.status}</Text>
              </View>
            </View>
          ))}
          {orders.length === 0 && <Text style={styles.emptyText}>No orders yet</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  headerSection: { paddingHorizontal: Spacing.containerPadding, paddingTop: 16, paddingBottom: 8 },
  greeting: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginTop: 2 },
  pendingBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.warning + '15', borderRadius: Radius.md, padding: 12, marginTop: 12 },
  pendingText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.warning, marginLeft: 8 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.containerPadding, gap: 12, marginTop: 16 },
  statCard: { width: '47%', backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16 },
  statIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  statValue: { fontFamily: Fonts.bodyBold, fontSize: 24, color: Colors.text },
  statLabel: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 4 },
  section: { margin: Spacing.containerPadding, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16, marginTop: 20 },
  sectionTitle: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text, marginBottom: 14 },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.subtle },
  orderInfo: { flex: 1 },
  orderService: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  orderCustomer: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  statusBadge: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontFamily: Fonts.bodyBold, fontSize: 12 },
  emptyText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, textAlign: 'center', paddingVertical: 20 },
});
