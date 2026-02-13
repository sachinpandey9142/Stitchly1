import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { api } from '../src/utils/api';
import { Colors, Fonts, Spacing, Radius } from '../src/utils/theme';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function RazorpayCheckout() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);
  const [verifying, setVerifying] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);
  const [error, setError] = useState('');

  const checkoutUrl = `${BACKEND_URL}/api/payment/checkout/${orderId}`;

  const handleMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === 'PAYMENT_SUCCESS') {
        setVerifying(true);
        try {
          const result = await api.post('/payment/verify', {
            order_id: data.order_id,
            razorpay_payment_id: data.razorpay_payment_id,
            razorpay_order_id: data.razorpay_order_id,
            razorpay_signature: data.razorpay_signature,
          });
          setPaymentDone(true);
          setVerifying(false);
          setTimeout(() => {
            Alert.alert(
              'Payment Successful!',
              `₹${result.amount} paid\nPayment ID: ${result.payment_id}\nCommission: ₹${result.commission}\nTailor Earnings: ₹${result.tailor_earnings}`,
              [{ text: 'View Orders', onPress: () => router.replace('/(customer)/orders') }]
            );
          }, 300);
        } catch (err: any) {
          setVerifying(false);
          setError(err.message || 'Verification failed');
          Alert.alert('Verification Failed', err.message || 'Could not verify payment', [
            { text: 'OK', onPress: () => router.back() },
          ]);
        }
      } else if (data.type === 'PAYMENT_CANCELLED') {
        Alert.alert('Payment Cancelled', 'You can pay later from your orders', [
          { text: 'OK', onPress: () => router.replace('/(customer)/orders') },
        ]);
      } else if (data.type === 'PAYMENT_FAILED') {
        setError(data.error || 'Payment failed');
      }
    } catch (e) {
      // Ignore non-JSON messages
    }
  };

  if (paymentDone) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Feather name="check-circle" size={64} color={Colors.success} />
          </View>
          <Text style={styles.successTitle}>Payment Successful!</Text>
          <Text style={styles.successSubtitle}>Your order has been confirmed</Text>
          <TouchableOpacity
            testID="go-to-orders-btn"
            style={styles.goToOrdersBtn}
            onPress={() => router.replace('/(customer)/orders')}
            activeOpacity={0.7}
          >
            <Text style={styles.goToOrdersBtnText}>View My Orders</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (verifying) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.verifyingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.verifyingText}>Verifying payment...</Text>
          <Text style={styles.verifyingSubtext}>Please wait, do not close the app</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="checkout-back-btn"
          style={styles.backBtn}
          onPress={() => {
            Alert.alert('Cancel Payment?', 'You can pay later from your orders', [
              { text: 'Stay', style: 'cancel' },
              { text: 'Cancel', style: 'destructive', onPress: () => router.replace('/(customer)/orders') },
            ]);
          }}
          activeOpacity={0.7}
        >
          <Feather name="x" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Secure Payment</Text>
        <View style={styles.secureIcon}>
          <Feather name="shield" size={20} color={Colors.success} />
        </View>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Feather name="alert-circle" size={18} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {Platform.OS === 'web' ? (
        <iframe
          src={checkoutUrl}
          style={{ flex: 1, border: 'none', width: '100%', height: '100%' } as any}
        />
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: checkoutUrl }}
          onMessage={handleMessage}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>Loading payment gateway...</Text>
            </View>
          )}
          onError={() => {
            setError('Failed to load payment page');
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.text },
  secureIcon: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  webview: { flex: 1 },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background,
  },
  loadingText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textMuted, marginTop: 16 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.error + '10',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.error + '20',
  },
  errorText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.error, marginLeft: 8, flex: 1 },
  verifyingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  verifyingText: { fontFamily: Fonts.bodyBold, fontSize: 20, color: Colors.text, marginTop: 24 },
  verifyingSubtext: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginTop: 8 },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  successIcon: { marginBottom: 24 },
  successTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.success },
  successSubtitle: { fontFamily: Fonts.ui, fontSize: 16, color: Colors.textMuted, marginTop: 8 },
  goToOrdersBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 32, paddingVertical: 16, marginTop: 32,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  goToOrdersBtnText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.textInverted },
});
