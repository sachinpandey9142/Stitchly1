import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

export default function PlaceOrder() {
  const { tailorId, service } = useLocalSearchParams<{ tailorId: string; service?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [tailor, setTailor] = useState<any>(null);
  const [serviceType, setServiceType] = useState(service ? decodeURIComponent(service) : '');
  const [description, setDescription] = useState('');
  const [pickupAddress, setPickupAddress] = useState(user?.address || '');
  const [paymentMethod, setPaymentMethod] = useState('online');
  const [loading, setLoading] = useState(false);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  useEffect(() => {
    (async () => { try { const data = await api.get(`/tailors/${tailorId}`); setTailor(data); } catch {} })();
  }, [tailorId]);

  useEffect(() => {
    (async () => {
      setAddressesLoading(true);
      try {
        const list = await api.get('/addresses');
        setAddresses(list);
        if (list.length > 0) {
          const def = list.find((a: any) => a.is_default) || list[0];
          setSelectedAddressId(def.id);
          const addressLine = [
            def.flat_no,
            def.area,
            def.landmark,
            `${def.city} - ${def.pincode}`,
          ]
            .filter(Boolean)
            .join(', ');
          setPickupAddress(addressLine);
        }
      } catch (e) {
        // ignore silently here, user can still type address
      } finally {
        setAddressesLoading(false);
      }
    })();
  }, []);

  const handleOrder = async () => {
    if (!serviceType || !description.trim() || !pickupAddress.trim()) {
      Alert.alert('Error', 'Fill in all required fields');
      return;
    }

    if (!selectedAddressId) {
      Alert.alert(
        'Add address',
        'Please add and select a delivery address before placing an order.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add Address',
            onPress: () => router.push('/(customer)/add-address'),
          },
        ]
      );
      return;
    }
    setLoading(true);
    try {
      const order = await api.post('/orders', { tailor_id: tailorId, service_type: serviceType, description: description.trim(), pickup_address: pickupAddress.trim(), payment_method: paymentMethod });
      if (paymentMethod === 'online') {
        try {
          // Create Razorpay order first
          const paymentData = await api.post('/payment/create-order', { order_id: order.id });
          // Navigate to Razorpay checkout WebView
          setLoading(false);
          router.push(`/checkout?orderId=${order.id}`);
          return;
        } catch (err: any) {
          Alert.alert('Order Placed', 'Order created but payment initiation failed. You can pay from Orders tab.', [{ text: 'OK', onPress: () => router.replace('/(customer)/orders') }]);
        }
      } else {
        Alert.alert('Success', 'Order placed with Cash on Delivery', [{ text: 'OK', onPress: () => router.replace('/(customer)/orders') }]);
      }
    } catch (err: any) { Alert.alert('Error', err.message); }
    finally { setLoading(false); }
  };

  const selectedService = tailor?.services?.find((s: any) => s.service_name === serviceType);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TouchableOpacity testID="back-btn" style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Feather name="arrow-left" size={24} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerSection}>
            <Text style={styles.title}>Place Order</Text>
            {tailor && <Text style={styles.subtitle}>with {tailor.name}</Text>}
          </View>

          <View style={styles.formSection}>
            <Text style={styles.label}>Select Service *</Text>
            <View style={styles.serviceGrid}>
              {tailor?.services?.map((s: any) => (
                <TouchableOpacity key={s.id} testID={`select-service-${s.id}`} style={[styles.serviceChip, serviceType === s.service_name && styles.serviceChipActive]} onPress={() => setServiceType(s.service_name)} activeOpacity={0.7}>
                  <Text style={[styles.serviceChipText, serviceType === s.service_name && styles.serviceChipTextActive]}>{s.service_name}</Text>
                  <Text style={[styles.serviceChipPrice, serviceType === s.service_name && styles.serviceChipTextActive]}>{'\u20B9'}{s.price}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Description *</Text>
            <TextInput testID="order-desc-input" style={[styles.input, styles.textArea]} placeholder="Describe what you need (fabric type, design, etc.)" placeholderTextColor={Colors.textMuted} value={description} onChangeText={setDescription} multiline numberOfLines={4} textAlignVertical="top" />

            <Text style={styles.label}>Pickup Address *</Text>
            {addressesLoading ? (
              <View style={styles.addressLoader}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : addresses.length > 0 ? (
              <>
                <View style={styles.addressList}>
                  {addresses.map((addr: any) => {
                    const isSelected = addr.id === selectedAddressId;
                    const line = [
                      addr.flat_no,
                      addr.area,
                      addr.landmark,
                      `${addr.city} - ${addr.pincode}`,
                    ]
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <TouchableOpacity
                        key={addr.id}
                        style={[
                          styles.addressCard,
                          isSelected && styles.addressCardActive,
                        ]}
                        onPress={() => {
                          setSelectedAddressId(addr.id);
                          setPickupAddress(line);
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={styles.addressCardHeader}>
                          <View style={styles.addressLabelBadge}>
                            <Feather
                              name={
                                addr.label === 'Work'
                                  ? 'briefcase'
                                  : addr.label === 'Home'
                                  ? 'home'
                                  : 'map-pin'
                              }
                              size={14}
                              color={
                                isSelected ? Colors.textInverted : Colors.primary
                              }
                            />
                            <Text
                              style={[
                                styles.addressLabelText,
                                isSelected && styles.addressLabelTextActive,
                              ]}
                            >
                              {addr.label}
                            </Text>
                          </View>
                          {addr.is_default && (
                            <Text style={styles.defaultPill}>Default</Text>
                          )}
                        </View>
                        <Text
                          style={[
                            styles.addressLine,
                            isSelected && styles.addressLineActive,
                          ]}
                          numberOfLines={2}
                        >
                          {line}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  style={styles.manageAddressesBtn}
                  onPress={() => router.push('/(customer)/addresses')}
                  activeOpacity={0.7}
                >
                  <Feather name="settings" size={14} color={Colors.primary} />
                  <Text style={styles.manageAddressesText}>Manage addresses</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.noAddressText}>
                  You don&apos;t have any saved addresses yet.
                </Text>
                <TouchableOpacity
                  style={styles.addAddressInlineBtn}
                  onPress={() => router.push('/(customer)/add-address')}
                  activeOpacity={0.8}
                >
                  <Feather name="map-pin" size={16} color={Colors.textInverted} />
                  <Text style={styles.addAddressInlineText}>Add Address</Text>
                </TouchableOpacity>
                <TextInput
                  testID="order-address-input"
                  style={[styles.input, { marginTop: 12 }]}
                  placeholder="Enter your address"
                  placeholderTextColor={Colors.textMuted}
                  value={pickupAddress}
                  onChangeText={setPickupAddress}
                />
              </>
            )}

            <Text style={styles.label}>Payment Method</Text>
            <View style={styles.paymentRow}>
              {[{ key: 'online', label: 'Online (Mock)', icon: 'credit-card' as const }, { key: 'cod', label: 'Cash on Delivery', icon: 'dollar-sign' as const }].map((p) => (
                <TouchableOpacity key={p.key} testID={`payment-${p.key}`} style={[styles.paymentChip, paymentMethod === p.key && styles.paymentChipActive]} onPress={() => setPaymentMethod(p.key)} activeOpacity={0.7}>
                  <Feather name={p.icon} size={18} color={paymentMethod === p.key ? Colors.primary : Colors.textMuted} />
                  <Text style={[styles.paymentText, paymentMethod === p.key && styles.paymentTextActive]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {selectedService && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Order Summary</Text>
              <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{selectedService.service_name}</Text><Text style={styles.summaryValue}>{'\u20B9'}{selectedService.price}</Text></View>
              <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Payment</Text><Text style={styles.summaryValue}>{paymentMethod === 'cod' ? 'COD' : 'Online'}</Text></View>
            </View>
          )}

          <TouchableOpacity testID="submit-order-btn" style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleOrder} disabled={loading} activeOpacity={0.7}>
            <Text style={styles.submitBtnText}>{loading ? 'Placing Order...' : 'Confirm Order'}</Text>
          </TouchableOpacity>
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  backBtn: { width: 44, height: 44, justifyContent: 'center', paddingLeft: Spacing.containerPadding, marginTop: 8 },
  headerSection: { paddingHorizontal: Spacing.containerPadding, marginBottom: 20 },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text },
  subtitle: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted, marginTop: 4 },
  formSection: { paddingHorizontal: Spacing.containerPadding },
  label: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 10, marginTop: 16 },
  serviceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  serviceChip: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 10 },
  serviceChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '10' },
  serviceChipText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text },
  serviceChipPrice: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.primary, marginTop: 2 },
  serviceChipTextActive: { color: Colors.primary },
  input: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 14, fontFamily: Fonts.ui, fontSize: 16, color: Colors.text },
  textArea: { height: 100 },
  paymentRow: { flexDirection: 'row', gap: 10 },
  paymentChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, paddingVertical: 14, gap: 6 },
  paymentChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '10' },
  paymentText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  paymentTextActive: { color: Colors.primary },
  summaryCard: { marginHorizontal: Spacing.containerPadding, marginTop: 24, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16 },
  summaryTitle: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  summaryLabel: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  summaryValue: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16, alignItems: 'center', marginHorizontal: Spacing.containerPadding, marginTop: 24, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.textInverted },
  addressLoader: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addressList: {
    marginTop: 4,
    gap: 8,
  },
  addressCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 10,
  },
  addressCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  addressCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  addressLabelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary + '10',
  },
  addressLabelText: {
    marginLeft: 6,
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.primary,
  },
  addressLabelTextActive: {
    color: Colors.textInverted,
  },
  defaultPill: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.secondaryDark,
    backgroundColor: Colors.secondary + '16',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  addressLine: {
    fontFamily: Fonts.ui,
    fontSize: 13,
    color: Colors.text,
  },
  addressLineActive: {
    color: Colors.text,
  },
  manageAddressesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  manageAddressesText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.primary,
  },
  noAddressText: {
    fontFamily: Fonts.ui,
    fontSize: 13,
    color: Colors.textMuted,
    marginBottom: 8,
  },
  addAddressInlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  addAddressInlineText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.textInverted,
  },
});
