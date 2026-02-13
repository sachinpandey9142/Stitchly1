import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius, STATUS_COLORS, STATUS_LABELS } from '../../src/utils/theme';

const DELIVERY_FLOW = ['accepted', 'picked_up', 'delivered_to_tailor', 'collected_from_tailor', 'out_for_delivery', 'delivered'];
const NEXT_STATUS: Record<string, string> = { accepted: 'picked_up', picked_up: 'delivered_to_tailor', delivered_to_tailor: 'collected_from_tailor', collected_from_tailor: 'out_for_delivery', out_for_delivery: 'delivered' };
const NEXT_LABEL: Record<string, string> = { accepted: 'Mark Picked Up', picked_up: 'Delivered to Tailor', delivered_to_tailor: 'Collected from Tailor', collected_from_tailor: 'Out for Delivery', out_for_delivery: 'Mark Delivered' };

export default function DeliveryDashboard() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = async () => {
    try { const data = await api.get('/delivery/assignments'); setOrders(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchOrders(); }, []);

  const handleUpdate = async (orderId: string, status: string) => {
    const next = NEXT_STATUS[status];
    if (!next) return;
    try { await api.put(`/delivery/${orderId}/update`, { status: next }); fetchOrders(); Alert.alert('Success', `Status updated to ${STATUS_LABELS[next] || next}`); }
    catch (err: any) { Alert.alert('Error', err.message); }
  };

  const renderOrder = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardInfo}>
          <Text style={styles.serviceType}>{item.service_type}</Text>
          <Text style={styles.names}>{item.customer_name} → {item.tailor_name}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[item.status] || Colors.textMuted) + '18' }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] || Colors.textMuted }]}>{STATUS_LABELS[item.status] || item.status}</Text>
        </View>
      </View>
      <View style={styles.addressSection}>
        <View style={styles.addressRow}><Feather name="map-pin" size={14} color={Colors.info} /><Text style={styles.addressText}>From: {item.pickup_address}</Text></View>
        <View style={styles.addressRow}><Feather name="navigation" size={14} color={Colors.success} /><Text style={styles.addressText}>To: {item.delivery_address}</Text></View>
      </View>
      {NEXT_STATUS[item.status] && (
        <TouchableOpacity testID={`delivery-update-${item.id}`} style={styles.updateBtn} onPress={() => handleUpdate(item.id, item.status)} activeOpacity={0.7}>
          <Feather name="arrow-right-circle" size={18} color={Colors.textInverted} />
          <Text style={styles.updateText}>{NEXT_LABEL[item.status]}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerSection}>
        <Text style={styles.greeting}>Hello, {user?.name}</Text>
        <Text style={styles.headerTitle}>Active Deliveries</Text>
      </View>
      {loading ? <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View> : (
        <FlatList data={orders} keyExtractor={(i) => i.id} renderItem={renderOrder} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchOrders(); }} tintColor={Colors.primary} />}
          ListEmptyComponent={<View style={styles.empty}><Feather name="truck" size={48} color={Colors.border} /><Text style={styles.emptyText}>No active deliveries</Text></View>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerSection: { paddingHorizontal: Spacing.containerPadding, paddingTop: 16, paddingBottom: 8 },
  greeting: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginTop: 2 },
  list: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 20 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardInfo: { flex: 1 },
  serviceType: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  names: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  statusBadge: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 },
  statusText: { fontFamily: Fonts.bodyBold, fontSize: 12 },
  addressSection: { marginTop: 12, backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 12 },
  addressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  addressText: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.text, marginLeft: 8, flex: 1 },
  updateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 14, marginTop: 14 },
  updateText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.textInverted, marginLeft: 8 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text, marginTop: 16 },
});
