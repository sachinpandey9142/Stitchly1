import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { api } from '../../../src/utils/api';
import { Colors, Fonts, Spacing, Radius, STATUS_COLORS, STATUS_LABELS } from '../../../src/utils/theme';

const TAILOR_STATUSES = ['in_stitching', 'completed', 'ready'];

export default function TailorOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = async () => {
    try { const data = await api.get('/orders/tailor'); setOrders(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchOrders(); }, []);

  const handleAccept = async (orderId: string) => {
    try { await api.put(`/orders/${orderId}/accept`, {}); fetchOrders(); Alert.alert('Success', 'Order accepted'); }
    catch (err: any) { Alert.alert('Error', err.message); }
  };

  const handleReject = async (orderId: string) => {
    Alert.alert('Reject Order', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: async () => {
        try { await api.put(`/orders/${orderId}/reject`, {}); fetchOrders(); }
        catch (err: any) { Alert.alert('Error', err.message); }
      }}
    ]);
  };

  const handleStatusUpdate = async (orderId: string, currentStatus: string) => {
    const currentIdx = TAILOR_STATUSES.indexOf(currentStatus);
    const nextStatus = TAILOR_STATUSES[currentIdx + 1] || TAILOR_STATUSES[0];
    try { await api.put(`/orders/${orderId}/status`, { status: nextStatus }); fetchOrders(); }
    catch (err: any) { Alert.alert('Error', err.message); }
  };

  const renderOrder = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <Text style={styles.serviceType}>{item.service_type}</Text>
          <Text style={styles.customerName}>{item.customer_name}</Text>
          <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
        </View>
        <View>
          <Text style={styles.price}>{'\u20B9'}{item.price}</Text>
          <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[item.status] || Colors.textMuted) + '18' }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] || Colors.textMuted }]}>{STATUS_LABELS[item.status] || item.status}</Text>
          </View>
        </View>
      </View>
      {item.status === 'placed' && (
        <View style={styles.actionRow}>
          <TouchableOpacity testID={`accept-order-${item.id}`} style={styles.acceptBtn} onPress={() => handleAccept(item.id)} activeOpacity={0.7}>
            <Feather name="check" size={18} color={Colors.textInverted} />
            <Text style={styles.acceptText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity testID={`reject-order-${item.id}`} style={styles.rejectBtn} onPress={() => handleReject(item.id)} activeOpacity={0.7}>
            <Feather name="x" size={18} color={Colors.error} />
            <Text style={styles.rejectText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}
      {['accepted', 'in_stitching', 'completed'].includes(item.status) && item.status !== 'ready' && (
        <TouchableOpacity testID={`update-status-${item.id}`} style={styles.updateBtn} onPress={() => handleStatusUpdate(item.id, item.status)} activeOpacity={0.7}>
          <Feather name="arrow-right" size={18} color={Colors.primary} />
          <Text style={styles.updateText}>
            {item.status === 'accepted' ? 'Start Stitching' : item.status === 'in_stitching' ? 'Mark Completed' : 'Mark Ready'}
          </Text>
        </TouchableOpacity>
      )}
      {item.status === 'accepted' && item.customer_phone && (
        <Text style={styles.phoneText}>Customer: {item.customer_phone}</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}><Text style={styles.headerTitle}>Orders</Text></View>
      {loading ? <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View> : (
        <FlatList data={orders} keyExtractor={(i) => i.id} renderItem={renderOrder} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchOrders(); }} tintColor={Colors.primary} />}
          ListEmptyComponent={<View style={styles.empty}><Feather name="clipboard" size={48} color={Colors.border} /><Text style={styles.emptyText}>No orders yet</Text></View>}
        />
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
  cardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  cardLeft: { flex: 1, marginRight: 12 },
  serviceType: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  customerName: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginTop: 2 },
  desc: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 6 },
  price: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.primary, textAlign: 'right' },
  statusBadge: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6, alignSelf: 'flex-end' },
  statusText: { fontFamily: Fonts.bodyBold, fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: Colors.subtle },
  acceptBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.success, borderRadius: Radius.full, paddingVertical: 12 },
  acceptText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.textInverted, marginLeft: 6 },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.error + '10', borderRadius: Radius.full, paddingVertical: 12, borderWidth: 1, borderColor: Colors.error + '30' },
  rejectText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.error, marginLeft: 6 },
  updateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '10', borderRadius: Radius.full, paddingVertical: 12, marginTop: 14, borderWidth: 1, borderColor: Colors.primary + '30' },
  updateText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.primary, marginLeft: 6 },
  phoneText: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.info, marginTop: 10 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text, marginTop: 16 },
});
