import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert,} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';
import * as Location from 'expo-location';
import { useRef } from 'react';
import { ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Animated } from 'react-native';
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Modal } from "react-native";
import MapView, { Marker, Circle } from "react-native-maps";


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
  const [locationSuccess, setLocationSuccess] = useState(false);
  const dropdownOpacity = useRef(new Animated.Value(0)).current;
  const mapOpacity = useRef(new Animated.Value(0)).current;
  const markerAnim = useRef(new Animated.Value(0)).current;
  const [recentLocations, setRecentLocations] = useState<any[]>([]);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const markerScale = useRef(new Animated.Value(0)).current;
  const DELIVERY_RADIUS = 3000; // meters (3km example)
  const [liveAddress, setLiveAddress] = useState("");
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
  const loadRecent = async () => {
    const stored = await AsyncStorage.getItem("recent_locations");
    if (stored) {
      setRecentLocations(JSON.parse(stored));
    }
  };

  loadRecent();
}, []);
useEffect(() => {
  if (latitude && longitude) {
    markerScale.setValue(0);
    Animated.spring(markerScale, {
      toValue: 1,
      friction: 5,
      useNativeDriver: true,
    }).start();
  }
}, [latitude, longitude]);
  
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
useEffect(() => {
  if (suggestions.length > 0) {
    Animated.timing(dropdownOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  } else {
    dropdownOpacity.setValue(0);
  }
}, [suggestions]);

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

    setMapModalVisible(true);

    // 🔥 Success feedback
setLocationSuccess(true);
Haptics.notificationAsync(
  Haptics.NotificationFeedbackType.Success
);

// Hide tick after 2 sec
setTimeout(() => {
  setLocationSuccess(false);
}, 2000);
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
const fetchAddressSuggestions = async (text: string) => {
  setAddress(text);

  if (text.length < 4) {
    setSuggestions([]);
    return;
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${text}&countrycodes=in&format=json&addressdetails=1&limit=5`,
      {
        headers: { "User-Agent": "Stitchly-App" }
      }
    );

    const data = await res.json();
    setSuggestions(data);
  } catch (err) {
    console.log("Address search error:", err);
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
             <TouchableOpacity
  onPress={fetchCurrentLocation}
  disabled={loadingLocation}
  style={{
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    opacity: loadingLocation ? 0.7 : 1,
  }}
>
  {loadingLocation ? (
  <ActivityIndicator
    size="small"
    color={Colors.primary}
    style={{ marginRight: 6 }}
  />
) : locationSuccess ? (
  <Feather
    name="check-circle"
    size={16}
    color="green"
    style={{ marginRight: 6 }}
  />
) : (
  <Feather
    name="map-pin"
    size={14}
    color={Colors.primary}
    style={{ marginRight: 6 }}
  />
)}

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
{recentLocations.length > 0 && (
  <View style={{ marginTop: 10 }}>
    <Text style={{ fontSize: 13, color: Colors.textMuted }}>
      Recent Locations
    </Text>

    {recentLocations.map((loc, index) => (
      <TouchableOpacity
        key={index}
        onPress={() => {
          setAddress(loc.address);
          setLatitude(parseFloat(loc.lat));
          setLongitude(parseFloat(loc.lon));
        }}
        style={{ paddingVertical: 8 }}
      >
        <Text>{loc.address}</Text>
      </TouchableOpacity>
    ))}
  </View>
)}
            <View style={styles.locationRow}>
             <View style={[styles.inputGroup, { flex: 2, marginRight: 8, position: 'relative' }]}>
                <Text style={styles.label}>City *</Text>
                <View style={styles.inputContainer}>
                  <TextInput testID="register-city-input" style={styles.inputNoPad} placeholder="e.g. Mumbai" placeholderTextColor={Colors.textMuted} value={city} onChangeText={fetchCitySuggestions} />
                </View>
               
                {suggestions.length > 0 && (
  <Animated.View
    style={{
      position: "absolute",
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
      opacity: dropdownOpacity,   // 👈 ADD THIS
    }}
  >
    <ScrollView keyboardShouldPersistTaps="handled">
      {suggestions.map((item) => (
        <TouchableOpacity
  key={item.place_id}
  style={{ padding: 10 }}
  onPress={async () => {
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

    const newLocation = {
      address: item.display_name,
      lat: item.lat,
      lon: item.lon,
    };

    const updated = [newLocation, ...recentLocations]
      .slice(0, 5);

    setRecentLocations(updated);

    await AsyncStorage.setItem(
      "recent_locations",
      JSON.stringify(updated)
    );

    setSuggestions([]);
  }}>

 
  
         
 <Text style={styles.dropdownText}>
  {item.address.city || item.address.town || item.address.state}
</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  </Animated.View>
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
                <TextInput ref={addressInputRef}testID="register-address-input" style={styles.input} placeholder="Street, area, landmark" placeholderTextColor={Colors.textMuted} value={address} onChangeText={fetchAddressSuggestions} />
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
     <Modal
  visible={mapModalVisible}
  animationType="slide"
  onRequestClose={() => setMapModalVisible(false)}
>
  <View style={{ flex: 1 }}>

    {latitude !== null && longitude !== null && (
      <>
        <MapView
          style={{ flex: 1 }}
          initialRegion={{
            latitude: latitude!,
            longitude: longitude!,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          onRegionChange={() => {
            setIsMoving(true);
          }}
          onRegionChangeComplete={async (region) => {
            setLatitude(region.latitude);
            setLongitude(region.longitude);
            setIsMoving(false);

            // Marker bounce
            Animated.sequence([
              Animated.timing(markerAnim, {
                toValue: 1,
                duration: 120,
                useNativeDriver: true,
              }),
              Animated.timing(markerAnim, {
                toValue: 0,
                duration: 120,
                useNativeDriver: true,
              }),
            ]).start();

            // 🔥 LIVE ADDRESS UPDATE
            try {
              const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${region.latitude}&lon=${region.longitude}&format=json&addressdetails=1`,
                { headers: { "User-Agent": "Stitchly-App" } }
              );
              const data = await res.json();
              setLiveAddress(data.display_name || "");
            } catch {}
          }}
        >
          <Circle
            center={{ latitude, longitude }}
            radius={DELIVERY_RADIUS}
            strokeColor="rgba(0,150,255,0.8)"
            fillColor="rgba(0,150,255,0.15)"
          />
        </MapView>

        {/* Address Preview Card */}
        <View
          style={{
            position: "absolute",
            top: 60,
            left: 20,
            right: 20,
            backgroundColor: "#fff",
            padding: 14,
            borderRadius: 12,
            elevation: 5,
          }}
        >
          <Text style={{ fontWeight: "600", marginBottom: 4 }}>
            Selected Location
          </Text>
          <Text numberOfLines={2} style={{ fontSize: 13 }}>
            {liveAddress || "Move map to adjust location"}
          </Text>
        </View>

        {/* Marker Shadow */}
        <Animated.View
  pointerEvents="none"
  style={{
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -8,
    marginTop: 2, // 👈 closer to marker
    width: 15,
    height: 5,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.15)",
shadowColor: "#000",
shadowOpacity: 0.3,
shadowRadius: 6,
    transform: [
      {
        scale: isMoving ? 0.8 : 1, // shadow shrinks when marker lifts
      },
    ],
  }}
/>

        {/* Fixed Center Marker */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            marginLeft: -18,
            marginTop: -36,
            transform: [
              {
                translateY: isMoving ? -15 : 0,
              },
              {
                scale: markerAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.1],
                }),
              },
            ],
          }}
        >
          <Feather name="map-pin" size={36} color={Colors.primary} />
        </Animated.View>

        {/* Confirm Button */}
        <TouchableOpacity
          onPress={() => {
            setAddress(liveAddress);
            setMapModalVisible(false);
          }}
          style={{
            position: "absolute",
            bottom: 40,
            left: 20,
            right: 20,
            backgroundColor: Colors.primary,
            padding: 16,
            borderRadius: 40,
            alignItems: "center",
            elevation: 6,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>
            Confirm Location
          </Text>
        </TouchableOpacity>
      </>
    )}
  </View>
</Modal>
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
