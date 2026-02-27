import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';
import * as Location from 'expo-location';
import { useRef } from 'react';

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
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [address, setAddress] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const addressInputRef = useRef<TextInput>(null);
  const [role, setRole] = useState('customer');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [latitude, setLatitude] = useState<number | null>(null); 
  const [longitude, setLongitude] = useState<number | null>(null);
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);


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
  // PINCODE → CITY
const fetchFromPincode = async (pin: string) => {
  if (pin.length !== 6) return;

  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
    const data = await res.json();

    if (data[0].Status === 'Success') {
      const po = data[0].PostOffice[0];
      setCity(po.District);
      setSuggestions([]);
    }
  } catch (err) {
    console.log('Pincode error:', err);
  }
};

// CITY → SUGGESTIONS
const fetchCitySuggestions = (text: string) => {
  setCity(text);

  if (searchTimeout) clearTimeout(searchTimeout);

  if (text.length < 3) {
    setSuggestions([]);
    return;
  }

  const timeout = setTimeout(async () => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${text}&countrycodes=in&format=json&addressdetails=1&limit=5&featuretype=city`,
        {
          headers: {
            "User-Agent": "Stitchly-App"
          }
        }
      );

      const data = await res.json();
      const filtered = data.filter(
  (item: any) =>
    item.address.city ||
    item.address.town ||
    item.address.state
);

setSuggestions(filtered);
    } catch (err) {
      console.log("OSM error:", err);
    }
  }, 400); // 400ms delay

  setSearchTimeout(timeout);
};
const fetchCurrentLocation = async () => {
  try {
    setLoadingLocation(true);

    const { status } =
      await Location.requestForegroundPermissionsAsync();

    if (status !== "granted") {
      Alert.alert("Permission denied");
      setLoadingLocation(false);
      return;
    }

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const { latitude, longitude } = loc.coords;

    setLatitude(latitude);
    setLongitude(longitude);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
      {
        headers: { "User-Agent": "Stitchly-App" },
      }
    );

    const data = await res.json();
    const address = data.address || {};

    setCity(
      address.city ||
      address.town ||
      address.village ||
      address.state ||
      ""
    );

    setPincode(address.postcode || "");
    setAddress(data.display_name || "");
    // Scroll down smoothly
setTimeout(() => {
  scrollRef.current?.scrollToEnd({ animated: true });

  // Focus address input
  addressInputRef.current?.focus();
}, 500);

    setLoadingLocation(false);

  } catch (err) {
    console.log("Location error:", err);
    setLoadingLocation(false);
  }
};
  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
             <View style={[styles.inputGroup, { flex: 2, marginRight: 8, position: 'relative' }]}>
                <Text style={styles.label}>City *</Text>
                <View style={styles.inputContainer}>
                  <TextInput testID="register-city-input" style={styles.inputNoPad} placeholder="e.g. Mumbai" placeholderTextColor={Colors.textMuted} value={city} onChangeText={fetchCitySuggestions} />
                </View>
                <TouchableOpacity
  onPress={fetchCurrentLocation}
  disabled={loadingLocation}
  style={{
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,marginLeft: 5,
    opacity: loadingLocation ? 0.6 : 1,
  }}
>
  <Feather
    name="map-pin"
    size={14}
    color={Colors.primary}
    style={{ marginRight: 6 }}
  />
  <Text
    style={{
      color: Colors.primary,
      fontSize: 14,
      fontFamily: Fonts.bodyBold,
    }}
  >
    {loadingLocation ? "Fetching location..." : "Use Current Location"}
  </Text>
</TouchableOpacity>
                {suggestions.length > 0 && (
  <View style={{
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 8,
    zIndex: 999,
    maxHeight: 180,
  }}>
    <ScrollView keyboardShouldPersistTaps="handled">
      {suggestions.map((item) => (
        <TouchableOpacity
          key={item.place_id}
          style={{ padding: 10 }}
          onPress={() => {
  const address = item.address || {};

  setCity(
    address.city ||
    address.town ||
    address.village ||
    ""
  );

  setPincode(address.postcode || "");
  setAddress(item.display_name || "");

  setLatitude(parseFloat(item.lat));
  setLongitude(parseFloat(item.lon));

  setSuggestions([]);
}}>
  
         
 <Text style={styles.dropdownText}>
  {item.address.city || item.address.town || item.address.state}
</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
)}
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.label}>Pincode</Text>
                <View style={styles.inputContainer}>
                  <TextInput testID="register-pincode-input" style={styles.inputNoPad} placeholder="400001" placeholderTextColor={Colors.textMuted} value={pincode} onChangeText={(text) => {
  setPincode(text);
  fetchFromPincode(text);
}} keyboardType="numeric" maxLength={6} />
                </View>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Address</Text>
              <View style={styles.inputContainer}>
                <Feather name="map" size={20} color={Colors.textMuted} />
                <TextInput ref={addressInputRef}testID="register-address-input" style={styles.input} placeholder="Street, area, landmark" placeholderTextColor={Colors.textMuted} value={address} onChangeText={setAddress} />
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
  dropdownText: {
  fontFamily: Fonts.ui,
  fontSize: 14,
  color: Colors.text,
},
});
