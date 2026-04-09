import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { api } from '../../../src/utils/api';
import { Colors, Fonts, Spacing, Radius, STATUS_COLORS, STATUS_LABELS } from '../../../src/utils/theme';

const NEXT_TAILOR_STATUS: Record<string, string> = {
  delivered_to_tailor: 'in_stitching',
  in_stitching: 'completed',
  completed: 'ready',
  ready: 'ready',
};

const NEXT_TAILOR_LABEL: Record<string, string> = {
  delivered_to_tailor: 'Start Stitching',
  in_stitching: 'Mark Completed',
  completed: 'Assign Delivery',
  ready: 'Retry Delivery Assignment',
};

const PICKUP_MEASUREMENT_LABELS: Record<string, string> = {
  shoulder_cm: 'Shoulder',
  chest_cm: 'Chest/Bust',
  waist_cm: 'Waist',
  hip_cm: 'Hip',
  sleeve_cm: 'Sleeve',
  inseam_cm: 'Inseam',
  neck_cm: 'Neck',
};

function measurementTypeLabel(type?: string) {
  if (type === 'ai') return 'AI Measurement';
  if (type === 'expert') return 'Expert Measurement';
  return 'Self Measurement';
}

function formatPickupMeasurements(measurements?: Record<string, number>) {
  if (!measurements || typeof measurements !== 'object') {
    return '';
  }
  return Object.entries(measurements)
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([key, value]) => `${PICKUP_MEASUREMENT_LABELS[key] || key}: ${value} cm`)
    .join(' | ');
}

export default function TailorOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      const data = await api.get('/orders/tailor');
      setOrders(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchOrders();
      const interval = setInterval(fetchOrders, 15000);
      return () => clearInterval(interval);
    }, [fetchOrders])
  );

  const handleAccept = useCallback(async (orderId: string) => {
    try {
      const updated = await api.put(`/orders/${orderId}/accept`, {});
      await fetchOrders();
      Alert.alert('Success', updated.status === 'pickup_assigned' ? 'Pickup partner assigned' : 'Order accepted');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Unable to accept this order');
    }
  }, [fetchOrders]);

  const handleReject = useCallback((orderId: string) => {
    Alert.alert('Reject Order', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.put(`/orders/${orderId}/reject`, {});
            await fetchOrders();
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Unable to reject this order');
          }
        },
      },
    ]);
  }, [fetchOrders]);

  const handleStatusUpdate = useCallback(async (orderId: string, currentStatus: string) => {
    const nextStatus = NEXT_TAILOR_STATUS[currentStatus];
    if (!nextStatus) {
      return;
    }
    try {
      const updated = await api.put(`/orders/${orderId}/status`, { status: nextStatus });
      await fetchOrders();
      Alert.alert('Success', STATUS_LABELS[updated.status] || 'Order updated');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Unable to update order status');
    }
  }, [fetchOrders]);

  const renderOrder = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <Text style={styles.serviceType}>{item.service_type}</Text>
          <Text style={styles.customerName}>{item.customer_name}</Text>
          <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
          <Text style={styles.measurementInfo}>Measurement: {measurementTypeLabel(item.measurement_type)}</Text>
        </View>
        <View>
          <Text style={styles.price}>{'\u20B9'}{item.price}</Text>
          <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[item.status] || Colors.textMuted) + '18' }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] || Colors.textMuted }]}>
              {STATUS_LABELS[item.status] || item.status}
            </Text>
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
      {NEXT_TAILOR_STATUS[item.status] && (
        <TouchableOpacity testID={`update-status-${item.id}`} style={styles.updateBtn} onPress={() => handleStatusUpdate(item.id, item.status)} activeOpacity={0.7}>
          <Feather name="arrow-right" size={18} color={Colors.primary} />
          <Text style={styles.updateText}>{NEXT_TAILOR_LABEL[item.status]}</Text>
        </TouchableOpacity>
      )}
      {item.status === 'accepted' && (
        <Text style={styles.infoText}>Waiting for a nearby delivery partner to accept pickup.</Text>
      )}
      {item.delivery_partner_name && ['pickup_assigned', 'delivery_assigned', 'delivery_accepted'].includes(item.status) && (
        <Text style={styles.infoText}>Delivery Partner: {item.delivery_partner_name}</Text>
      )}
      {item.pickup_measurement_received ? (
        <Text style={styles.detailText}>Pickup measurements received by delivery partner.</Text>
      ) : null}
      {item.pickup_measurement_note ? (
        <Text style={styles.detailText}>Measurement Note: {item.pickup_measurement_note}</Text>
      ) : null}
      {formatPickupMeasurements(item.pickup_measurements) ? (
        <Text style={styles.detailText}>Measurements: {formatPickupMeasurements(item.pickup_measurements)}</Text>
      ) : null}
      {item.send_reference_cloth ? (
        <Text style={styles.detailText}>Reference cloth requested by customer.</Text>
      ) : null}
      {item.pickup_reference_cloth_received ? (
        <Text style={styles.detailText}>Reference cloth received by delivery partner.</Text>
      ) : null}
      {item.pickup_reference_cloth_note ? (
        <Text style={styles.detailText}>Reference Cloth Note: {item.pickup_reference_cloth_note}</Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}><Text style={styles.headerTitle}>Orders</Text></View>
      {loading ? <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View> : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
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
  measurementInfo: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.info, marginTop: 8 },
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
  infoText: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.info, marginTop: 10 },
  detailText: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted, marginTop: 8, lineHeight: 18 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text, marginTop: 16 },
});
