import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

const ROLES = [
  { key: 'customer', label: 'Customer', icon: 'shopping-bag' as const, desc: 'Find tailors near you' },
  { key: 'tailor', label: 'Tailor', icon: 'scissors' as const, desc: 'Offer your services' },
  { key: 'delivery', label: 'Delivery', icon: 'truck' as const, desc: 'Deliver orders' },
];

export default function Register() {
  const router = useRouter();
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [address, setAddress] = useState('');
  const [role, setRole] = useState('customer');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !phone.trim() || !password) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }
    if (!city.trim()) {
      Alert.alert('Error', 'City is required for location-based services');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const user = await register({
        name: name.trim(), email: email.trim().toLowerCase(),
        phone: phone.trim(), password, role,
        city: city.trim(), pincode: pincode.trim(), address: address.trim(),
      } as any);
      if (user.role === 'customer') router.replace('/(customer)');
      else if (user.role === 'tailor') router.replace('/(tailor)');
      else if (user.role === 'delivery') router.replace('/(delivery)');
    } catch (err: any) {
      Alert.alert('Registration Failed', err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="register-back-btn" activeOpacity={0.7}>
            <Feather name="arrow-left" size={24} color={Colors.text} />
          </TouchableOpacity>

          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.desc}>Join Stitchly today</Text>

          <Text style={styles.sectionLabel}>I am a</Text>
          <View style={styles.roleRow}>
            {ROLES.map((r) => (
              <TouchableOpacity
                key={r.key}
                testID={`role-${r.key}-btn`}
                style={[styles.roleCard, role === r.key && styles.roleCardActive]}
                onPress={() => setRole(r.key)}
                activeOpacity={0.7}
              >
                <Feather name={r.icon} size={24} color={role === r.key ? Colors.primary : Colors.textMuted} />
                <Text style={[styles.roleLabel, role === r.key && styles.roleLabelActive]}>{r.label}</Text>
                <Text style={styles.roleDesc}>{r.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name *</Text>
            <View style={styles.inputContainer}>
              <Feather name="user" size={20} color={Colors.textMuted} />
              <TextInput testID="register-name-input" style={styles.input} placeholder="Your full name" placeholderTextColor={Colors.textMuted} value={name} onChangeText={setName} />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email *</Text>
            <View style={styles.inputContainer}>
              <Feather name="mail" size={20} color={Colors.textMuted} />
              <TextInput testID="register-email-input" style={styles.input} placeholder="your@email.com" placeholderTextColor={Colors.textMuted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone Number *</Text>
            <View style={styles.inputContainer}>
              <Feather name="phone" size={20} color={Colors.textMuted} />
              <TextInput testID="register-phone-input" style={styles.input} placeholder="9876543210" placeholderTextColor={Colors.textMuted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            </View>
          </View>

          <View style={styles.locationSection}>
            <Text style={styles.sectionLabel}>
              <Feather name="map-pin" size={15} color={Colors.primary} />
              {'  '}Your Location
            </Text>
            <View style={styles.locationRow}>
              <View style={[styles.inputGroup, { flex: 2, marginRight: 8 }]}>
                <Text style={styles.label}>City *</Text>
                <View style={styles.inputContainer}>
                  <TextInput testID="register-city-input" style={styles.inputNoPad} placeholder="e.g. Mumbai" placeholderTextColor={Colors.textMuted} value={city} onChangeText={setCity} />
                </View>
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.label}>Pincode</Text>
                <View style={styles.inputContainer}>
                  <TextInput testID="register-pincode-input" style={styles.inputNoPad} placeholder="400001" placeholderTextColor={Colors.textMuted} value={pincode} onChangeText={setPincode} keyboardType="numeric" maxLength={6} />
                </View>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Address</Text>
              <View style={styles.inputContainer}>
                <Feather name="map" size={20} color={Colors.textMuted} />
                <TextInput testID="register-address-input" style={styles.input} placeholder="Street, area, landmark" placeholderTextColor={Colors.textMuted} value={address} onChangeText={setAddress} />
              </View>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password *</Text>
            <View style={styles.inputContainer}>
              <Feather name="lock" size={20} color={Colors.textMuted} />
              <TextInput testID="register-password-input" style={styles.input} placeholder="Min 6 characters" placeholderTextColor={Colors.textMuted} value={password} onChangeText={setPassword} secureTextEntry={!showPassword} />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity testID="register-submit-btn" style={[styles.button, loading && styles.buttonDisabled]} onPress={handleRegister} activeOpacity={0.7} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Creating Account...' : 'Create Account'}</Text>
          </TouchableOpacity>

          <TouchableOpacity testID="go-to-login-btn" style={styles.linkButton} onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={styles.linkText}>Already have an account? <Text style={styles.linkBold}>Sign In</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: Spacing.containerPadding, paddingTop: 20, paddingBottom: 40 },
  backBtn: { width: 44, height: 44, justifyContent: 'center', marginBottom: 16 },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginBottom: 4 },
  desc: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted, marginBottom: 24 },
  sectionLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 12 },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  roleCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1.5,
    borderColor: Colors.border, padding: 14, alignItems: 'center',
  },
  roleCardActive: { borderColor: Colors.primary, backgroundColor: '#F0FDFA' },
  roleLabel: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.textMuted, marginTop: 8 },
  roleLabelActive: { color: Colors.primary },
  roleDesc: { fontFamily: Fonts.ui, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 4 },
  locationSection: { backgroundColor: Colors.subtle, borderRadius: Radius.lg, padding: 16, marginBottom: 4, borderWidth: 1, borderColor: Colors.primary + '20' },
  locationRow: { flexDirection: 'row' },
  inputGroup: { marginBottom: 18 },
  label: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 8 },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 16, height: 52,
  },
  input: { flex: 1, fontFamily: Fonts.ui, fontSize: 16, color: Colors.text, marginLeft: 12 },
  inputNoPad: { flex: 1, fontFamily: Fonts.ui, fontSize: 16, color: Colors.text },
  button: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.textInverted },
  linkButton: { alignItems: 'center', marginTop: 20, paddingVertical: 8 },
  linkText: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  linkBold: { fontFamily: Fonts.bodyBold, color: Colors.primary },
});
