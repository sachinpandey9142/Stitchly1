import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator, Animated, Modal, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Circle, UrlTile, PROVIDER_DEFAULT } from "react-native-maps";
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import MaleSlim from '../../assets/body/male_slim.png';
import MaleFit from '../../assets/body/male_fit.png';
import MaleBulk from '../../assets/body/male_bulk.png';

import FemaleSlim from '../../assets/body/female_slim.png';
import FemaleFit from '../../assets/body/female_fit.png';
import FemaleBulk from '../../assets/body/female_bulk.png';

const ROLES = [
  { key: 'customer', label: 'Customer', icon: 'shopping-bag' as const, desc: 'Find tailors near you' },
  { key: 'tailor', label: 'Tailor', icon: 'scissors' as const, desc: 'Offer your services' },
  { key: 'delivery', label: 'Delivery', icon: 'truck' as const, desc: 'Deliver orders' },
];

const SCAN_RESULT_STORAGE_KEY = 'stitchly_latest_scan_measurements';

export default function Register() {
  const router = useRouter();
  const params = useLocalSearchParams<{ measurements?: string; height_cm?: string; warnings?: string; quality_score?: string }>();
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
  const mapRef = useRef<MapView | null>(null);
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
  const liftAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const [recentLocations, setRecentLocations] = useState<any[]>([]);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [mapRecenterLoading, setMapRecenterLoading] = useState(false);
  const [androidMapSeed, setAndroidMapSeed] = useState<{ latitude: number; longitude: number } | null>(null);
  const [androidMapRevision, setAndroidMapRevision] = useState(0);
  const markerScale = useRef(new Animated.Value(0)).current;
  const DELIVERY_RADIUS = 3000; // meters (3km example)
  const [liveAddress, setLiveAddress] = useState("");
  const [liveCity, setLiveCity] = useState('');
  const [livePincode, setLivePincode] = useState('');
  const [isMoving, setIsMoving] = useState(false);
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [bodyType, setBodyType] = useState<'slim' | 'fit' | 'bulk' | ''>('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [shoulder, setShoulder] = useState('');
  const [chest, setChest] = useState('');
  const [waist, setWaist] = useState('');
  const [hip, setHip] = useState('');
  const [armLength, setArmLength] = useState('');
  const [legLength, setLegLength] = useState('');
  const [neck, setNeck] = useState('');
  const [scanConfidence, setScanConfidence] = useState<number | null>(null);
  const [scanWarningMessage, setScanWarningMessage] = useState<string | null>(null);
  const [legacyMeasurements, setLegacyMeasurements] = useState<Record<string, number>>({});
  const BODY_TYPES: ('slim' | 'fit' | 'bulk')[] = ['slim', 'fit', 'bulk'];

  const applyScannedMeasurements = useCallback((payload: any) => {
    if (!payload || typeof payload !== 'object') return false;

    const scanned = payload?.measurements && typeof payload.measurements === 'object'
      ? payload.measurements
      : {};

    let didApply = false;

    if (typeof payload?.height_cm === 'number' && Number.isFinite(payload.height_cm)) {
      setHeight(String(payload.height_cm));
      didApply = true;
    }

    if (typeof scanned.shoulder === 'number') {
      setShoulder(String(scanned.shoulder));
      didApply = true;
    }
    if (typeof scanned.chest === 'number') {
      setChest(String(scanned.chest));
      didApply = true;
    }
    if (typeof scanned.waist === 'number') {
      setWaist(String(scanned.waist));
      didApply = true;
    }
    if (typeof scanned.hip === 'number') {
      setHip(String(scanned.hip));
      didApply = true;
    }
    if (typeof scanned.arm === 'number') {
      setArmLength(String(scanned.arm));
      didApply = true;
    }
    if (typeof scanned.leg === 'number') {
      setLegLength(String(scanned.leg));
      didApply = true;
    }
    if (typeof scanned.neck === 'number') {
      setNeck(String(scanned.neck));
      didApply = true;
    }

    if (payload?.quality && typeof payload.quality.overall_confidence === 'number') {
      setScanConfidence(payload.quality.overall_confidence);
      didApply = true;
    } else if (typeof payload?.quality_score === 'number' && Number.isFinite(payload.quality_score)) {
      setScanConfidence(payload.quality_score);
      didApply = true;
    }

    if (payload?.legacy_measurements && typeof payload.legacy_measurements === 'object') {
      setLegacyMeasurements(payload.legacy_measurements);
      didApply = true;
    }

    const payloadWarnings = Array.isArray(payload?.warnings)
      ? payload.warnings.filter((warning: unknown): warning is string => typeof warning === 'string' && warning.trim().length > 0)
      : [];

    const confidenceCandidate =
      typeof payload?.quality?.overall_confidence === 'number'
        ? payload.quality.overall_confidence
        : typeof payload?.quality_score === 'number'
          ? payload.quality_score
          : null;

    if (payloadWarnings.length > 0 || (typeof confidenceCandidate === 'number' && confidenceCandidate < 0.6)) {
      setScanWarningMessage('Measurements may be slightly inaccurate');
    } else {
      setScanWarningMessage(null);
    }

    return didApply;
  }, []);

  useEffect(() => {
    if (typeof params.measurements !== 'string' || !params.measurements.trim()) return;

    try {
      const parsedMeasurements = JSON.parse(params.measurements);
      const parsedHeight = typeof params.height_cm === 'string' ? Number(params.height_cm) : NaN;
      let parsedWarnings: string[] = [];
      if (typeof params.warnings === 'string' && params.warnings.trim()) {
        try {
          const warningsPayload = JSON.parse(params.warnings);
          if (Array.isArray(warningsPayload)) {
            parsedWarnings = warningsPayload.filter(
              (warning): warning is string => typeof warning === 'string' && warning.trim().length > 0
            );
          }
        } catch {
          parsedWarnings = [];
        }
      }

      const parsedQuality = typeof params.quality_score === 'string' ? Number(params.quality_score) : NaN;
      const didApply = applyScannedMeasurements({
        measurements: parsedMeasurements,
        height_cm: Number.isFinite(parsedHeight) ? parsedHeight : undefined,
        warnings: parsedWarnings,
        quality_score: Number.isFinite(parsedQuality) ? parsedQuality : undefined,
      });

      if (didApply) {
        Alert.alert('AI measurements imported', 'Review and edit values before creating account.');
      }

      void AsyncStorage.removeItem(SCAN_RESULT_STORAGE_KEY);
    } catch (error) {
      console.log('scan params parse error', error);
    }
  }, [params.measurements, params.height_cm, params.warnings, params.quality_score, applyScannedMeasurements]);

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
  setBodyType('');
}, [gender]);
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

useFocusEffect(
  useCallback(() => {
    if (typeof params.measurements === 'string' && params.measurements.trim()) {
      return;
    }

    let isMounted = true;

    const hydrateScanResult = async () => {
      try {
        const raw = await AsyncStorage.getItem(SCAN_RESULT_STORAGE_KEY);
        if (!raw || !isMounted) return;

        const parsed = JSON.parse(raw);
        const didApply = applyScannedMeasurements(parsed);

        await AsyncStorage.removeItem(SCAN_RESULT_STORAGE_KEY);
        if (didApply) {
          Alert.alert('AI measurements imported', 'Review and edit values before creating account.');
        }
      } catch (error) {
        console.log('scan hydration error', error);
      }
    };

    hydrateScanResult();

    return () => {
      isMounted = false;
    };
  }, [params.measurements, applyScannedMeasurements])
);

const toPositiveNumber = (value: string): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const buildBodyMeasurementsPayload = () => {
  if (role !== 'customer') return undefined;

  const shoulderCm = toPositiveNumber(shoulder);
  const chestCm = toPositiveNumber(chest);
  const waistCm = toPositiveNumber(waist);
  const hipCm = toPositiveNumber(hip);
  const armCm = toPositiveNumber(armLength);
  const legCm = toPositiveNumber(legLength);
  const neckCm = toPositiveNumber(neck);
  const legacyHipWidth = Number(legacyMeasurements.hip_width_cm);
  const hipWidthCm = Number.isFinite(legacyHipWidth) && legacyHipWidth > 0 ? legacyHipWidth : hipCm;

  const payload: Record<string, number> = {};

  if (shoulderCm) payload.shoulder_width_cm = Number(shoulderCm.toFixed(2));
  if (chestCm) payload.chest_cm = Number(chestCm.toFixed(2));
  if (waistCm) payload.waist_cm = Number(waistCm.toFixed(2));
  if (hipWidthCm) payload.hip_width_cm = Number(hipWidthCm.toFixed(2));
  if (hipCm) payload.hip_cm = Number(hipCm.toFixed(2));
  if (armCm) payload.arm_length_cm = Number(armCm.toFixed(2));
  if (legCm) payload.leg_length_cm = Number(legCm.toFixed(2));
  if (neckCm) payload.neck_cm = Number(neckCm.toFixed(2));

  if (Object.keys(payload).length === 0) return undefined;
  return payload;
};
  
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
      const bodyMeasurements = buildBodyMeasurementsPayload();
      const user = await register({
  name: name.trim(),
  email: email.trim().toLowerCase(),
  phone: phone.trim(),
  password,
  role,
  city: city.trim(),
  pincode: pincode.trim(),
  address: address.trim(),
  latitude: latitude ?? undefined,
  longitude: longitude ?? undefined,
  gender,
  ...(role === "customer" && {
  height,
  weight,
  body_measurements: bodyMeasurements,
  bodyType,
  })
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

useEffect(() => {
  if (Platform.OS !== 'android') return;

  if (!mapModalVisible) {
    setAndroidMapSeed(null);
    return;
  }

  if (!androidMapSeed && latitude != null && longitude != null) {
    setAndroidMapSeed({ latitude, longitude });
  }
}, [androidMapSeed, latitude, longitude, mapModalVisible]);

const getCurrentCoords = useCallback(async () => {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      permission = await Location.requestForegroundPermissionsAsync();
    }

    if (permission.status !== 'granted') {
      Alert.alert('Permission denied', 'Enable location access');
      return null;
    }

    const attempts: Array<() => Promise<Location.LocationObject | Location.LocationObject | null>> = [
      () => Location.getLastKnownPositionAsync({ maxAge: 120000, requiredAccuracy: 500 }),
      () =>
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          mayShowUserSettingsDialog: true,
        }),
      () =>
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Low,
          mayShowUserSettingsDialog: true,
        }),
    ];

    for (const attempt of attempts) {
      try {
        const location = await attempt();
        if (!location?.coords) continue;

        const { latitude: nextLatitude, longitude: nextLongitude } = location.coords;
        if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) continue;

        return { latitude: nextLatitude, longitude: nextLongitude };
      } catch (error) {
        console.log('Location attempt failed:', error);
      }
    }

    Alert.alert('Error', 'Unable to fetch location');
    return null;
  } catch (error) {
    console.log('Location permission/location error:', error);
    Alert.alert('Error', 'Unable to fetch location');
    return null;
  }
}, []);

const handleMapMoveStart = useCallback(() => {
  setIsMoving(true);

  Animated.timing(liftAnim, {
    toValue: 1,
    duration: 150,
    useNativeDriver: true,
  }).start();

  Animated.loop(
    Animated.sequence([
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ])
  ).start();
}, [glowAnim, liftAnim]);

const handleMapMoveComplete = useCallback(async (nextLatitude: number, nextLongitude: number) => {
  setLatitude(nextLatitude);
  setLongitude(nextLongitude);
  setIsMoving(false);

  Animated.spring(liftAnim, {
    toValue: 0,
    friction: 4,
    useNativeDriver: true,
  }).start();

  glowAnim.stopAnimation();
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${nextLatitude}&lon=${nextLongitude}&format=json&addressdetails=1`,
      { headers: { "User-Agent": "Stitchly-App" } }
    );
    const data = res.ok ? await res.json() : null;
    const reverseAddress = data?.address || {};
    const parsedDisplayName =
      typeof data?.display_name === 'string'
        ? data.display_name
            .split(',')
            .map((piece: string) => piece.trim())
            .filter(Boolean)
        : [];

    const resolvedCity =
      reverseAddress.city ||
      reverseAddress.town ||
      reverseAddress.village ||
      reverseAddress.municipality ||
      reverseAddress.county ||
      reverseAddress.state ||
      parsedDisplayName.find((piece: string) => /[A-Za-z]/.test(piece)) ||
      '';
    const pincodeMatch =
      typeof data?.display_name === 'string' ? data.display_name.match(/\b\d{6}\b/) : null;
    const resolvedPincode = reverseAddress.postcode || (pincodeMatch ? pincodeMatch[0] : '');
    const resolvedAddress =
      (typeof data?.display_name === 'string' && data.display_name.trim()) ||
      `${nextLatitude.toFixed(4)}, ${nextLongitude.toFixed(4)}`;

    setLiveCity((prev) => resolvedCity || prev || city);
    setLivePincode((prev) => resolvedPincode || prev || pincode);
    setLiveAddress(resolvedAddress);
  } catch {
    const fallbackAddress = `${nextLatitude.toFixed(4)}, ${nextLongitude.toFixed(4)}`;
    setLiveAddress(fallbackAddress);
    setLiveCity((prev) => prev || city);
    setLivePincode((prev) => prev || pincode);
  }
}, [city, glowAnim, liftAnim, pincode]);

const handleAndroidMapMessage = useCallback((event: WebViewMessageEvent) => {
  try {
    const payload = JSON.parse(event.nativeEvent.data || '{}');

    if (payload?.type === 'moving') {
      handleMapMoveStart();
      return;
    }

    if (
      payload?.type === 'region' &&
      Number.isFinite(payload.latitude) &&
      Number.isFinite(payload.longitude)
    ) {
      void handleMapMoveComplete(Number(payload.latitude), Number(payload.longitude));
    }
  } catch {}
}, [handleMapMoveComplete, handleMapMoveStart]);

const buildPickerMapHtml = useCallback((lat: number, lon: number) => {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; }
      .leaflet-control-attribution { font-size: 10px; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      (function () {
        var map = L.map('map', { zoomControl: true }).setView([${lat}, ${lon}], 16);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

        var circle = L.circle([${lat}, ${lon}], {
          radius: ${DELIVERY_RADIUS},
          color: 'rgba(0,150,255,0.8)',
          fillColor: 'rgba(0,150,255,0.15)',
          fillOpacity: 0.5,
          weight: 2
        }).addTo(map);

        function send(payload) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          }
        }

        map.on('movestart', function () {
          send({ type: 'moving' });
        });

        map.on('moveend', function () {
          var center = map.getCenter();
          circle.setLatLng(center);
          send({ type: 'region', latitude: center.lat, longitude: center.lng });
        });
      })();
    </script>
  </body>
</html>`;
}, [DELIVERY_RADIUS]);

const recenterToCurrentLocation = useCallback(async () => {
  try {
    setMapRecenterLoading(true);

    const coords = await getCurrentCoords();
    if (!coords) return;

    handleMapMoveStart();

    if (Platform.OS === 'android') {
      setAndroidMapSeed(coords);
      setAndroidMapRevision((value) => value + 1);
    } else {
      requestAnimationFrame(() => {
        mapRef.current?.animateToRegion(
          {
            latitude: coords.latitude,
            longitude: coords.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          350
        );
      });
    }

    await handleMapMoveComplete(coords.latitude, coords.longitude);
  } catch (error) {
    console.log('Recenter error:', error);
    Alert.alert('Error', 'Unable to fetch location');
  } finally {
    setMapRecenterLoading(false);
  }
}, [getCurrentCoords, handleMapMoveComplete, handleMapMoveStart]);

const fetchCurrentLocation = async () => {
  const reverseGeocodeWithNominatim = async (lat: number, lon: number) => {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
        String(lat)
      )}&lon=${encodeURIComponent(String(lon))}&addressdetails=1`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Stitchly-App',
        },
      }
    );

    if (!res.ok) {
      throw new Error(`Reverse geocode failed (${res.status})`);
    }

    return res.json();
  };

  try {
    setLoadingLocation(true);

    const coords = await getCurrentCoords();
    if (!coords) {
      return;
    }

    const { latitude, longitude } = coords;

    setLatitude(latitude);
    setLongitude(longitude);

    let data: any = null;
    try {
      data = await reverseGeocodeWithNominatim(latitude, longitude);
    } catch (reverseError) {
      console.log('Reverse geocode error:', reverseError);
    }

    const reverseAddress = data?.address || {};
    const parsedDisplayName =
      typeof data?.display_name === 'string'
        ? data.display_name
            .split(',')
            .map((piece: string) => piece.trim())
            .filter(Boolean)
        : [];
    const resolvedAddress =
      (typeof data?.display_name === 'string' && data.display_name.trim()) ||
      `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

    const resolvedCity =
      reverseAddress.city ||
      reverseAddress.town ||
      reverseAddress.village ||
      reverseAddress.municipality ||
      reverseAddress.county ||
      reverseAddress.state ||
      parsedDisplayName.find((piece: string) => /[A-Za-z]/.test(piece)) ||
      "";
    const pincodeMatch =
      typeof data?.display_name === 'string' ? data.display_name.match(/\b\d{6}\b/) : null;
    const resolvedPincode = reverseAddress.postcode || (pincodeMatch ? pincodeMatch[0] : "");

    setCity((prev) => resolvedCity || prev);
    setPincode((prev) => resolvedPincode || prev);
    setLiveCity((prev) => resolvedCity || prev);
    setLivePincode((prev) => resolvedPincode || prev);
    setAddress(resolvedAddress);
    setLiveAddress(resolvedAddress);

    setMapModalVisible(true);
    if (Platform.OS === 'android') {
      setAndroidMapSeed({ latitude, longitude });
      setAndroidMapRevision((value) => value + 1);
    } else {
      requestAnimationFrame(() => {
        mapRef.current?.animateToRegion(
          {
            latitude,
            longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          350
        );
      });
    }

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

  } catch (err) {
    console.log("Location error:", err);
    Alert.alert('Error', 'Unable to fetch location');
  } finally {
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
const getBodyImage = (type: 'slim' | 'fit' | 'bulk') => {
  if (gender === 'male') {
    return {
      slim: MaleSlim,
      fit: MaleFit,
      bulk: MaleBulk,
    }[type];
  } else {
    return {
      slim: FemaleSlim,
      fit: FemaleFit,
      bulk: FemaleBulk,
    }[type];
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
          <View style={{ marginBottom: 14 }}>
  <Text style={styles.label}>Gender</Text>

  <View style={styles.genderRow}>
    {['male', 'female'].map((g) => (
      <TouchableOpacity
        key={g}
        onPress={() => setGender(g as any)}
        style={[
          styles.genderCard,
          gender === g && styles.genderCardActive,
        ]}
      >
        <Text
          style={[
            styles.genderText,
            gender === g && { color: Colors.primary },
          ]}
        >
          {g === 'male' ? 'Male' : 'Female'}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
</View>

          {role === 'customer' && (
          <View style={styles.bodySection}>
  <Text style={styles.sectionLabel}>
    <Feather name="user" size={15} color={Colors.primary} />
    {'  '}Body Details
  </Text>

  <Pressable style={styles.scanButton} onPress={() => router.push('/scan-body')}>
    <Feather name="camera" size={16} color={Colors.textInverted} />
    <Text style={styles.scanButtonText}>Start AI Body Scan</Text>
  </Pressable>

  {scanConfidence !== null && (
    <Text style={styles.scanMeta}>
      Last scan confidence: {(scanConfidence * 100).toFixed(0)}%
    </Text>
  )}

  {scanWarningMessage ? (
    <Text style={styles.scanMeta}>{scanWarningMessage}</Text>
  ) : null}
 
  {/* Height & Weight Row */}
  <View style={{ flexDirection: 'row', gap: 10 }}>
    <View style={[styles.inputGroup, { flex: 1 }]}>
      <Text style={styles.label}>Height (cm)</Text>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.inputNoPad}
          placeholder="e.g. 170"
          placeholderTextColor={Colors.textMuted}
          value={height}
          onChangeText={setHeight}
          keyboardType="numeric"
        />
      </View>
    </View>
  
    <View style={[styles.inputGroup, { flex: 1 }]}>
      <Text style={styles.label}>Weight (kg)</Text>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.inputNoPad}
          placeholder="e.g. 65"
          placeholderTextColor={Colors.textMuted}
          value={weight}
          onChangeText={setWeight}
          keyboardType="numeric"
        />
      </View>
    </View>
  </View>

  <View style={styles.measurementGrid}>
    <View style={styles.measurementTile}>
      <Text style={styles.label}>Shoulder</Text>
      <View style={styles.inputContainer}>
        <TextInput value={shoulder} placeholder="Shoulder" placeholderTextColor={Colors.textMuted} onChangeText={setShoulder} keyboardType="numeric" style={styles.inputNoPad} />
      </View>
    </View>

    <View style={styles.measurementTile}>
      <Text style={styles.label}>Chest</Text>
      <View style={styles.inputContainer}>
        <TextInput value={chest} placeholder="Chest" placeholderTextColor={Colors.textMuted} onChangeText={setChest} keyboardType="numeric" style={styles.inputNoPad} />
      </View>
    </View>

    <View style={styles.measurementTile}>
      <Text style={styles.label}>Waist</Text>
      <View style={styles.inputContainer}>
        <TextInput value={waist} placeholder="Waist" placeholderTextColor={Colors.textMuted} onChangeText={setWaist} keyboardType="numeric" style={styles.inputNoPad} />
      </View>
    </View>

    <View style={styles.measurementTile}>
      <Text style={styles.label}>Hip</Text>
      <View style={styles.inputContainer}>
        <TextInput value={hip} placeholder="Hip" placeholderTextColor={Colors.textMuted} onChangeText={setHip} keyboardType="numeric" style={styles.inputNoPad} />
      </View>
    </View>

    <View style={styles.measurementTile}>
      <Text style={styles.label}>Arm Length</Text>
      <View style={styles.inputContainer}>
        <TextInput value={armLength} placeholder="Arm Length" placeholderTextColor={Colors.textMuted} onChangeText={setArmLength} keyboardType="numeric" style={styles.inputNoPad} />
      </View>
    </View>

    <View style={styles.measurementTile}>
      <Text style={styles.label}>Leg Length</Text>
      <View style={styles.inputContainer}>
        <TextInput value={legLength} placeholder="Leg Length" placeholderTextColor={Colors.textMuted} onChangeText={setLegLength} keyboardType="numeric" style={styles.inputNoPad} />
      </View>
    </View>

    <View style={[styles.measurementTile, { width: '100%' }]}>
      <Text style={styles.label}>Neck</Text>
      <View style={styles.inputContainer}>
        <TextInput value={neck} placeholder="Neck" placeholderTextColor={Colors.textMuted} onChangeText={setNeck} keyboardType="numeric" style={styles.inputNoPad} />
      </View>
    </View>
  </View>
  


  {/* Body Type Selection */}
  {/* Body Type Selection */}
<View style={styles.bodyTypeRow}>
  {['slim', 'fit', 'bulk'].map((type) => (
    <TouchableOpacity
      key={type}
      onPress={() => setBodyType(type as any)}
      style={[
        styles.bodyTypeCard,
        bodyType === type && styles.bodyTypeCardActive,
      ]}
      activeOpacity={0.8}
    >
      <Image
        source={getBodyImage(type as any)}
        style={{ width: 50, height: 90 }}
        resizeMode="contain"
      />

      <Text
        style={[
          styles.bodyTypeText,
          bodyType === type && { color: Colors.primary },
        ]}
      >
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </Text>
    </TouchableOpacity>
  ))}
</View>
</View>
)}
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
        {Platform.OS === 'android' && androidMapSeed ? (
          <WebView
            key={`picker-map-${androidMapRevision}`}
            style={{ flex: 1 }}
            originWhitelist={['*']}
            source={{ html: buildPickerMapHtml(androidMapSeed.latitude, androidMapSeed.longitude) }}
            onMessage={handleAndroidMapMessage}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
          />
        ) : (
          <MapView
            ref={mapRef}
            provider={PROVIDER_DEFAULT}
            mapType="none"
            style={{ flex: 1 }}
            initialRegion={{
              latitude,
              longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
            onRegionChange={handleMapMoveStart}
            onRegionChangeComplete={(region) => {
              void handleMapMoveComplete(region.latitude, region.longitude);
            }}
          >
            <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} />
            <Circle
              center={{ latitude, longitude }}
              radius={DELIVERY_RADIUS}
              strokeColor="rgba(0,150,255,0.8)"
              fillColor="rgba(0,150,255,0.15)"
            />
          </MapView>
        )}

        <TouchableOpacity
          onPress={() => {
            void recenterToCurrentLocation();
          }}
          disabled={mapRecenterLoading}
          style={{
            position: 'absolute',
            top: 132,
            right: 20,
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: '#fff',
            alignItems: 'center',
            justifyContent: 'center',
            elevation: 6,
            opacity: mapRecenterLoading ? 0.7 : 1,
          }}
        >
          {mapRecenterLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Feather name="crosshair" size={18} color={Colors.primary} />
          )}
        </TouchableOpacity>

        {/* Address Card */}
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

        {/* Glow */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            marginLeft: -25,
            marginTop: 0,
            width: 50,
            height: 50,
            borderRadius: 25,
            backgroundColor: Colors.primary,
            opacity: glowAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.05, 0.15],
            }),
          }}
        />

        {/* Shadow */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            marginLeft: -8,
            marginTop: 2,
            width: 15,
            height: 5,
            borderRadius: 20,
            backgroundColor: "rgba(0,0,0,0.28)",
            transform: [
              {
                scale: liftAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0.7],
                }),
              },
            ],
          }}
        />

        {/* Fixed Marker */}
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
                translateY: liftAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -18],
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
            setAddress((prev) => liveAddress || prev);
            setCity((prev) => liveCity || prev);
            setPincode((prev) => livePincode || prev);
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
bodySection: {
  backgroundColor: Colors.subtle,
  borderRadius: Radius.lg,
  padding: 16,
  marginTop: 20,
  borderWidth: 1,
  borderColor: Colors.primary + '20',
},

scanButton: {
  marginBottom: 10,
  paddingVertical: 12,
  borderRadius: Radius.full,
  backgroundColor: Colors.primary,
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'row',
  gap: 8,
},

scanButtonText: {
  fontFamily: Fonts.bodyBold,
  fontSize: 14,
  color: Colors.textInverted,
},

scanMeta: {
  marginBottom: 12,
  fontFamily: Fonts.ui,
  fontSize: 12,
  color: Colors.primaryDark,
},

measurementGrid: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  marginTop: 6,
},

measurementTile: {
  width: '48%',
  marginBottom: 4,
},

bodyTypeRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  marginTop: 8,
},

bodyTypeCard: {
  flex: 1,
  marginHorizontal: 4,
  paddingVertical: 14,
  borderRadius: Radius.md,
  borderWidth: 1.5,
  borderColor: Colors.border,
  alignItems: 'center',
  backgroundColor: Colors.surface,
},

bodyTypeCardActive: {
  borderColor: Colors.primary,
  backgroundColor: '#F0FDFA',
},

bodyTypeText: {
  fontFamily: Fonts.bodyBold,
  fontSize: 13,
  marginTop: 6,
  color: Colors.textMuted,
},
genderRow: {
  flexDirection: 'row',
  gap: 10,
},

genderCard: {
  flex: 1,
  paddingVertical: 10,
  borderRadius: Radius.md,
  borderWidth: 1.5,
  borderColor: Colors.border,
  backgroundColor: Colors.surface,
  alignItems: 'center',
},

genderCardActive: {
  borderColor: Colors.primary,
  backgroundColor: '#F0FDFA',
},

genderText: {
  fontFamily: Fonts.bodyBold,
  fontSize: 14,
  color: Colors.textMuted,
},

bodyImage: {
  width: 40,
  height: 60,
  marginBottom: 6,
},
});
