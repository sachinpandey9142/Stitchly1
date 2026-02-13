import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius, STATUS_COLORS, STATUS_LABELS } from '../../src/utils/theme';

const ORDER_STEPS = ['placed', 'accepted', 'picked_up', 'in_stitching', 'completed', 'ready', 'out_for_delivery', 'delivered'];

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const data = await api.get(`/orders/${id}`); setOrder(data); }
      catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!order) return <View style={styles.loader}><Text style={styles.errorText}>Order not found</Text></View>;

  const currentIdx = ORDER_STEPS.indexOf(order.status);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <TouchableOpacity testID="back-btn" style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="arrow-left" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Order Details</Text>
          <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[order.status] || Colors.textMuted) + '18' }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[order.status] || Colors.textMuted }]}>{STATUS_LABELS[order.status] || order.status}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{order.service_type}</Text>
          <Text style={styles.desc}>{order.description}</Text>
          <View style={styles.infoRow}><Feather name="user" size={14} color={Colors.textMuted} /><Text style={styles.infoText}>Customer: {order.customer_name}</Text></View>
          <View style={styles.infoRow}><Feather name="scissors" size={14} color={Colors.textMuted} /><Text style={styles.infoText}>Tailor: {order.tailor_name}</Text></View>
          {order.delivery_partner_name ? <View style={styles.infoRow}><Feather name="truck" size={14} color={Colors.textMuted} /><Text style={styles.infoText}>Delivery: {order.delivery_partner_name}</Text></View> : null}
          <View style={styles.infoRow}><Feather name="map-pin" size={14} color={Colors.textMuted} /><Text style={styles.infoText}>Pickup: {order.pickup_address}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Status</Text>
          {ORDER_STEPS.map((step, idx) => (
            <View key={step} style={styles.stepRow}>
              <View style={[styles.stepDot, idx <= currentIdx ? { backgroundColor: Colors.primary } : { backgroundColor: Colors.border }]} />
              {idx < ORDER_STEPS.length - 1 && <View style={[styles.stepLine, idx < currentIdx ? { backgroundColor: Colors.primary } : { backgroundColor: Colors.border }]} />}
              <Text style={[styles.stepText, idx <= currentIdx && styles.stepTextActive]}>{STATUS_LABELS[step]}</Text>
            </View>
          ))}
        </View>

        <View style={styles.priceSection}>
          <View style={styles.priceRow}><Text style={styles.priceLabel}>Service Price</Text><Text style={styles.priceValue}>{'\u20B9'}{order.price}</Text></View>
          <View style={styles.priceRow}><Text style={styles.priceLabel}>Payment Method</Text><Text style={styles.priceValue}>{order.payment_method === 'cod' ? 'Cash on Delivery' : 'Online'}</Text></View>
          <View style={styles.priceRow}><Text style={styles.priceLabel}>Payment Status</Text><Text style={[styles.priceValue, { color: order.payment_status === 'completed' ? Colors.success : Colors.warning }]}>{order.payment_status}</Text></View>
        </View>

        {user?.role === 'customer' && order.status === 'delivered' && (
          <TouchableOpacity testID="write-review-btn" style={styles.reviewBtn} onPress={() => router.push(`/review/${order.id}`)} activeOpacity={0.7}>
            <Feather name="star" size={20} color={Colors.textInverted} /><Text style={styles.reviewBtnText}>Write Review</Text>
          </TouchableOpacity>
        )}

        {user?.role === 'customer' && order.payment_method === 'online' && order.payment_status !== 'completed' && order.status !== 'rejected' && (
          <TouchableOpacity testID="pay-now-btn" style={styles.payNowBtn} onPress={async () => {
            try {
              await api.post('/payment/create-order', { order_id: order.id });
              router.push(`/checkout?orderId=${order.id}`);
            } catch (err: any) { Alert.alert('Error', err.message); }
          }} activeOpacity={0.7}>
            <Feather name="credit-card" size={20} color={Colors.textInverted} />
            <Text style={styles.payNowBtnText}>Pay Now - {'\u20B9'}{order.price}</Text>
          </TouchableOpacity>
        )}

        {order.razorpay_payment_id && (
          <View style={[styles.section, { marginTop: 0 }]}>
            <Text style={styles.sectionTitle}>Payment Details</Text>
            <View style={styles.priceRow}><Text style={styles.priceLabel}>Payment ID</Text><Text style={[styles.priceValue, { fontSize: 12 }]}>{order.razorpay_payment_id}</Text></View>
            <View style={styles.priceRow}><Text style={styles.priceLabel}>Commission</Text><Text style={styles.priceValue}>{'\u20B9'}{order.commission_amount}</Text></View>
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  errorText: { fontFamily: Fonts.body, fontSize: 16, color: Colors.error },
  backBtn: { width: 44, height: 44, justifyContent: 'center', paddingLeft: Spacing.containerPadding, marginTop: 8 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.containerPadding, marginBottom: 16 },
  title: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.text },
  statusBadge: { borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 5 },
  statusText: { fontFamily: Fonts.bodyBold, fontSize: 13 },
  section: { marginHorizontal: Spacing.containerPadding, marginBottom: 16, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16 },
  sectionTitle: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text, marginBottom: 10 },
  desc: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  infoText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.text, marginLeft: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, position: 'relative' },
  stepDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  stepLine: { position: 'absolute', left: 5, top: 12, width: 2, height: 18 },
  stepText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, paddingVertical: 4 },
  stepTextActive: { fontFamily: Fonts.bodyBold, color: Colors.text },
  priceSection: { marginHorizontal: Spacing.containerPadding, marginBottom: 16, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.subtle },
  priceLabel: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  priceValue: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  reviewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.secondary, borderRadius: Radius.full, paddingVertical: 16, marginHorizontal: Spacing.containerPadding },
  reviewBtnText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.textInverted, marginLeft: 8 },
  payNowBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16, marginHorizontal: Spacing.containerPadding, marginBottom: 12, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  payNowBtnText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.textInverted, marginLeft: 8 },
});
