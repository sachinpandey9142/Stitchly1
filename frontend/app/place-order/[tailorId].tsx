import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';


export default function PlaceOrder() {
  const { tailorId, service, address, lat, lng } =
useLocalSearchParams<{
  tailorId: string;
  service?: string;
  address?: string;
  lat?: string;
  lng?: string;
}>();
  const router = useRouter();
  const { user } = useAuth();
  const [tailor, setTailor] = useState<any>(null);
  const [serviceType, setServiceType] = useState(service ? decodeURIComponent(service) : '');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('online');
  const [selectedDeliveryOption, setSelectedDeliveryOption] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupLocation, setPickupLocation] = useState<any>(null);

useEffect(() => {
  if (address && lat && lng) {

    setPickupAddress(String(address));

    setPickupLocation({
      type: "Point",
      coordinates: [Number(lng), Number(lat)]
    });

  }
}, [address, lat, lng]);

  useEffect(() => {
  setSelectedDeliveryOption(null);
}, [serviceType]);


  useEffect(() => {
    (async () => { try {
  const data = await api.get(`/tailors/${tailorId}`);
  setTailor(data);
} catch (err) {
  Alert.alert("Error", "Failed to load tailor");
} })();
  }, [tailorId]);
  useEffect(() => {
  if (user) {
    if (!user.address) {
      Alert.alert(
        "Address Required",
        "Please add your address before placing an order.",
        [
          {
            text: "Add Address",
            onPress: () => router.push("/(customer)/profile")
          }
        ]
      );
      return;
    }

    setPickupAddress(user.address);

    if (user.geo_location) {
      setPickupLocation(user.geo_location);
    }
  }
}, [user]);

  

  const handleOrder = async () => {
    
    console.log("HANDLE ORDER TRIGGERED 🔥");
   
  if (!serviceType || !description.trim() || !pickupAddress.trim() || !selectedDeliveryOption || !pickupLocation)  {
  Alert.alert('Error', 'Fill all required fields and allow location access');
  return;
}
  
  if (selectedService?.delivery_options && !selectedDeliveryOption) {
    Alert.alert('Selection Required', 'Please select delivery timing');
    return;
  }
  setLoading(true);
    try {
      const payload = {
  tailor_id: tailorId,
  service_type: serviceType,
  description: description.trim(),
  pickup_address: pickupAddress.trim(),
  pickup_location: pickupLocation,
  payment_method: paymentMethod,
  delivery_option: selectedDeliveryOption
};

console.log("ORDER PAYLOAD:", JSON.stringify(payload, null, 2));

const order = await api.post('/orders', payload);
      
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
    } catch (err: any) {
  Alert.alert('Error', err?.message || 'Something went wrong');
}
    finally { setLoading(false); }
  };

  const selectedService = tailor?.services?.find((s: any) => s.service_name === serviceType);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <TouchableOpacity
          testID="back-btn"
          style={styles.backBtn}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/(customer)/home");
            }
          }}
          activeOpacity={0.7}
        >
                    
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
            {selectedService?.delivery_options?.length > 0 && (
                <>
                  <Text style={styles.label}>Select Delivery Timing *</Text>
                  <View style={styles.serviceGrid}>
                    {selectedService.delivery_options.map((option: any, index: number) => (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.serviceChip,
                          selectedDeliveryOption?.label === option.label && styles.serviceChipActive
                        ]}
                        onPress={() => setSelectedDeliveryOption(option)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.serviceChipText,
                            selectedDeliveryOption?.label === option.label && styles.serviceChipTextActive
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

            <Text style={styles.label}>Description *</Text>
            <TextInput testID="order-desc-input" style={[styles.input, styles.textArea]} placeholder="Describe what you need (fabric type, design, etc.)" placeholderTextColor={Colors.textMuted} value={description} onChangeText={setDescription} multiline numberOfLines={4} textAlignVertical="top" />

            <Text style={styles.label}>Pickup Address *</Text>
            <TextInput
                testID="order-address-input"
                style={styles.input}
                value={pickupAddress}
                editable={false}
              />
            {/*  */}
            <TouchableOpacity
            style={styles.changeAddressBtn}
            onPress={() => router.push("/select-address")}
          >
            <Feather name="map-pin" size={16} color="#fff" />
            <Text style={styles.changeAddressText}>
              Change Address
            </Text>
          </TouchableOpacity>

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
              {selectedDeliveryOption && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Delivery</Text>
                <Text style={styles.summaryValue}>{selectedDeliveryOption.label}</Text>
              </View>
            )}
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
  
  changeAddressBtn: {
  marginTop: 8,
  backgroundColor: Colors.primary,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: 10,
  borderRadius: Radius.md,
  gap: 6
},

changeAddressText: {
  color: Colors.textInverted,
  fontFamily: Fonts.bodyBold,
  fontSize: 14
},
});
