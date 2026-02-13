import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Spacing, Radius, STATUS_COLORS, STATUS_LABELS } from '../../src/utils/theme';

export default function AdminOrders() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = async () => {
    try { const data = await api.get('/admin/orders'); setOrders(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { fetchOrders(); }, []);

  const renderOrder = ({ item }: { item: any }) => (
    <TouchableOpacity testID={`admin-order-${item.id}`} style={styles.card} activeOpacity={0.7} onPress={() => router.push(`/order/${item.id}`)}>
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <Text style={styles.serviceType}>{item.service_type}</Text>
          <Text style={styles.names}>{item.customer_name} → {item.tailor_name}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[item.status] || Colors.textMuted) + '18' }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] || Colors.textMuted }]}>{STATUS_LABELS[item.status] || item.status}</Text>
        </View>
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.price}>{'\u20B9'}{item.price}</Text>
        <Text style={styles.commission}>Commission: {'\u20B9'}{item.commission_amount}</Text>
        <Text style={styles.date}>{new Date(item.created_at).toLocaleDateString('en-IN')}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}><Text style={styles.headerTitle}>All Orders</Text></View>
      {loading ? <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View> : (
        <FlatList data={orders} keyExtractor={(i) => i.id} renderItem={renderOrder} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchOrders(); }} tintColor={Colors.primary} />}
          ListEmptyComponent={<View style={styles.empty}><Feather name="package" size={48} color={Colors.border} /><Text style={styles.emptyText}>No orders yet</Text></View>} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.containerPadding, paddingTop: 16, paddingBottom: 12 },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text },
  list: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 20 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLeft: { flex: 1 },
  serviceType: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  names: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  statusBadge: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 },
  statusText: { fontFamily: Fonts.bodyBold, fontSize: 12 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.subtle },
  price: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.primary },
  commission: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  date: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text, marginTop: 16 },
});
