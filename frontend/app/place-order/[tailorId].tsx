import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';
import { CATEGORY_CAROUSEL, CATEGORY_SPECIALITY_MAP } from '../../src/utils/customerDiscovery';

const EXPERT_MEASUREMENT_FEE = 49;
const MEASUREMENT_TUTORIAL_URL = 'https://www.youtube.com/results?search_query=how+to+take+body+measurement+for+stitching';

const formatComplexityLabel = (value: unknown): string => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

const formatPriceRangeLabel = (service: any): string => {
  const minPrice = Number(service?.price_min ?? service?.price ?? 0);
  const maxPrice = Number(service?.price_max ?? service?.price ?? minPrice);

  if (!Number.isFinite(minPrice) || minPrice <= 0) return '₹0';
  if (!Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice === minPrice) {
    return `₹${Math.round(minPrice)}`;
  }

  return `₹${Math.round(minPrice)} - ₹${Math.round(maxPrice)}`;
};

const serviceBasePrice = (service: any): number => {
  const value = Number(service?.price ?? service?.price_min ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export default function PlaceOrder() {
  const { tailorId, service, serviceId, category } = useLocalSearchParams<{
    tailorId: string;
    service?: string;
    serviceId?: string;
    category?: string;
  }>();
  const router = useRouter();
  const { user } = useAuth();
  const [tailor, setTailor] = useState<any>(null);
  const [serviceType, setServiceType] = useState(service ? decodeURIComponent(service) : '');
  const [selectedServiceId, setSelectedServiceId] = useState(serviceId ? decodeURIComponent(serviceId) : '');
  const [description, setDescription] = useState('');
  const [pickupAddress, setPickupAddress] = useState(user?.address || '');
  const [paymentMethod, setPaymentMethod] = useState('online');
  const [measurementType, setMeasurementType] = useState<'ai' | 'manual' | 'expert'>('manual');
  const [sendReferenceCloth, setSendReferenceCloth] = useState(false);
  const [referenceClothNote, setReferenceClothNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => { try { const data = await api.get(`/tailors/${tailorId}`); setTailor(data); } catch {} })();
  }, [tailorId]);

  const selectedCategoryKey = typeof category === 'string' ? category : '';

  const categoryMatcherSet = useMemo(() => {
    if (!selectedCategoryKey) return new Set<string>();

    const categoryItem = CATEGORY_CAROUSEL.find((item) => item.key === selectedCategoryKey);
    const mappedSpeciality = CATEGORY_SPECIALITY_MAP[selectedCategoryKey] || '';

    return new Set(
      [selectedCategoryKey, categoryItem?.label || '', mappedSpeciality]
        .filter(Boolean)
        .map((item) => String(item).toLowerCase())
    );
  }, [selectedCategoryKey]);

  const visibleServices = useMemo(() => {
    const allServices = tailor?.services || [];
    if (categoryMatcherSet.size === 0) return allServices;

    const filtered = allServices.filter((item: any) => {
      const serviceCategory = String(item?.category || '').toLowerCase();
      return categoryMatcherSet.has(serviceCategory);
    });

    return filtered.length > 0 ? filtered : allServices;
  }, [tailor?.services, categoryMatcherSet]);

  useEffect(() => {
    if (!tailor?.services?.length) return;

    if (selectedServiceId) {
      const matchedById = tailor.services.find((item: any) => item.id === selectedServiceId);
      if (matchedById && serviceType !== matchedById.service_name) {
        setServiceType(matchedById.service_name);
      }
      return;
    }

    if (serviceType) {
      const matchedByName = tailor.services.find((item: any) => item.service_name === serviceType);
      if (matchedByName) {
        setSelectedServiceId(matchedByName.id);
        return;
      }
    }

    const preferred = visibleServices[0] || tailor.services[0];
    if (preferred) {
      setSelectedServiceId(preferred.id);
      setServiceType(preferred.service_name);
    }
  }, [tailor?.services, visibleServices, selectedServiceId, serviceType]);

  const selectedService = useMemo(() => {
    const allServices = tailor?.services || [];
    if (selectedServiceId) {
      const byId = allServices.find((item: any) => item.id === selectedServiceId);
      if (byId) return byId;
    }
    if (serviceType) {
      return allServices.find((item: any) => item.service_name === serviceType) || null;
    }
    return null;
  }, [tailor?.services, selectedServiceId, serviceType]);

  const basePrice = selectedService ? serviceBasePrice(selectedService) : 0;
  const measurementFee = measurementType === 'expert' ? EXPERT_MEASUREMENT_FEE : 0;
  const totalPrice = basePrice + measurementFee;

  const openMeasurementTutorial = async () => {
    try {
      await Linking.openURL(MEASUREMENT_TUTORIAL_URL);
    } catch {
      Alert.alert('Unable to open tutorial', 'Please try again later.');
    }
  };

  const handleOrder = async () => {
    const normalizedServiceType = selectedService?.service_name || serviceType;
    if (!normalizedServiceType || !description.trim() || !pickupAddress.trim()) { Alert.alert('Error', 'Fill in all required fields'); return; }

    setLoading(true);
    try {
      const order = await api.post('/orders', {
        tailor_id: tailorId,
        service_id: selectedService?.id || selectedServiceId || undefined,
        service_type: normalizedServiceType,
        description: description.trim(),
        pickup_address: pickupAddress.trim(),
        payment_method: paymentMethod,
        measurement_type: measurementType,
        send_reference_cloth: sendReferenceCloth,
        reference_cloth_note: referenceClothNote.trim() || undefined,
      });

      if (paymentMethod === 'online') {
        try {
          await api.post('/payment/create-order', { order_id: order.id });
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
              {visibleServices.map((s: any) => {
                const isActive = selectedServiceId ? selectedServiceId === s.id : serviceType === s.service_name;

                return (
                <TouchableOpacity
                  key={s.id}
                  testID={`select-service-${s.id}`}
                  style={[styles.serviceChip, isActive && styles.serviceChipActive]}
                  onPress={() => {
                    setSelectedServiceId(s.id);
                    setServiceType(s.service_name);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.serviceChipText, isActive && styles.serviceChipTextActive]}>{s.service_name}</Text>
                  <Text style={[styles.serviceChipMeta, isActive && styles.serviceChipTextActive]}>
                    {s.category}
                    {formatComplexityLabel(s.complexity) ? ` • ${formatComplexityLabel(s.complexity)}` : ''}
                  </Text>
                  <Text style={[styles.serviceChipPrice, isActive && styles.serviceChipTextActive]}>{formatPriceRangeLabel(s)}</Text>
                </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Measurement Type *</Text>
            <View style={styles.measurementGrid}>
              {[
                { key: 'ai', title: 'AI Measurement', subtitle: 'Fast auto scan', fee: 0 },
                { key: 'manual', title: 'Self Measurement', subtitle: 'Use tutorial video', fee: 0 },
                { key: 'expert', title: 'Expert Measurement', subtitle: 'Home expert visit', fee: EXPERT_MEASUREMENT_FEE },
              ].map((option) => {
                const isActive = measurementType === option.key;

                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.measurementCard, isActive && styles.measurementCardActive]}
                    onPress={() => setMeasurementType(option.key as 'ai' | 'manual' | 'expert')}
                  >
                    <Text style={[styles.measurementTitle, isActive && styles.measurementTitleActive]}>{option.title}</Text>
                    <Text style={[styles.measurementSubtitle, isActive && styles.measurementSubtitleActive]}>{option.subtitle}</Text>
                    <Text style={[styles.measurementFee, isActive && styles.measurementFeeActive]}>
                      {option.fee > 0 ? `+ ₹${option.fee}` : 'No Extra Charge'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {measurementType === 'ai' ? (
              <TouchableOpacity style={styles.helperBtn} onPress={() => router.push('/scan-body')}>
                <Feather name="camera" size={16} color={Colors.primary} />
                <Text style={styles.helperBtnText}>Start AI Measurement Scan</Text>
              </TouchableOpacity>
            ) : null}

            {measurementType === 'manual' ? (
              <TouchableOpacity style={styles.helperBtn} onPress={openMeasurementTutorial}>
                <Feather name="play-circle" size={16} color={Colors.primary} />
                <Text style={styles.helperBtnText}>Watch Measurement Tutorial Video</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.label}>Reference Cloth (Optional)</Text>
            <TouchableOpacity
              style={[styles.referenceCard, sendReferenceCloth && styles.referenceCardActive]}
              onPress={() => setSendReferenceCloth((prev) => !prev)}
              activeOpacity={0.8}
            >
              <View style={[styles.checkbox, sendReferenceCloth && styles.checkboxActive]}>
                {sendReferenceCloth ? <Feather name="check" size={14} color={Colors.textInverted} /> : null}
              </View>
              <View style={styles.referenceTextWrap}>
                <Text style={styles.referenceTitle}>I will send a reference cloth</Text>
                <Text style={styles.referenceSubtitle}>Optional: helps tailor match fitting and finishing style.</Text>
              </View>
            </TouchableOpacity>

            {sendReferenceCloth ? (
              <TextInput
                testID="reference-cloth-note-input"
                style={[styles.input, styles.textArea]}
                placeholder="Add optional note about reference cloth"
                placeholderTextColor={Colors.textMuted}
                value={referenceClothNote}
                onChangeText={setReferenceClothNote}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            ) : null}

            <Text style={styles.label}>Description *</Text>
            <TextInput testID="order-desc-input" style={[styles.input, styles.textArea]} placeholder="Describe what you need (fabric type, design, etc.)" placeholderTextColor={Colors.textMuted} value={description} onChangeText={setDescription} multiline numberOfLines={4} textAlignVertical="top" />

            <Text style={styles.label}>Pickup Address *</Text>
            <TextInput testID="order-address-input" style={styles.input} placeholder="Enter your address" placeholderTextColor={Colors.textMuted} value={pickupAddress} onChangeText={setPickupAddress} />

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
              <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{selectedService.service_name}</Text><Text style={styles.summaryValue}>{`₹${Math.round(basePrice)}`}</Text></View>
              <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Measurement ({measurementType === 'ai' ? 'AI' : measurementType === 'manual' ? 'Self' : 'Expert'})</Text><Text style={styles.summaryValue}>{measurementFee > 0 ? `₹${measurementFee}` : '₹0'}</Text></View>
              <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Payment</Text><Text style={styles.summaryValue}>{paymentMethod === 'cod' ? 'COD' : 'Online'}</Text></View>
              <View style={[styles.summaryRow, styles.summaryRowLast]}><Text style={styles.summaryTotalLabel}>Total</Text><Text style={styles.summaryTotalValue}>{`₹${Math.round(totalPrice)}`}</Text></View>
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
  serviceChipMeta: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  serviceChipPrice: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.primary, marginTop: 2 },
  serviceChipTextActive: { color: Colors.primary },
  measurementGrid: { gap: 8 },
  measurementCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 12,
  },
  measurementCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  measurementTitle: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  measurementTitleActive: { color: Colors.primary },
  measurementSubtitle: { marginTop: 2, fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  measurementSubtitleActive: { color: Colors.primary },
  measurementFee: { marginTop: 6, fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.textMuted },
  measurementFeeActive: { color: Colors.primary },
  helperBtn: {
    marginTop: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary + '50',
    backgroundColor: Colors.primary + '10',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  helperBtnText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.primary },
  referenceCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  referenceCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: Colors.surface,
  },
  checkboxActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  referenceTextWrap: { flex: 1 },
  referenceTitle: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  referenceSubtitle: { marginTop: 2, fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
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
  summaryRowLast: { borderTopWidth: 1, borderTopColor: Colors.subtle, marginTop: 4, paddingTop: 12 },
  summaryLabel: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  summaryValue: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  summaryTotalLabel: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  summaryTotalValue: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.primary },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16, alignItems: 'center', marginHorizontal: Spacing.containerPadding, marginTop: 24, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.textInverted },
});
