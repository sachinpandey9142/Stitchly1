import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
  ScrollView,
} from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import LiveMap from '../live-map';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

type Coordinates = {
  latitude: number;
  longitude: number;
};

type Address = {
  id: string;
  label: string;
  flat_no: string;
  area: string;
  landmark?: string;
  city: string;
  pincode: string;
  location: { type: 'Point'; coordinates: [number, number] };
  is_default: boolean;
};

export default function AddAddress() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = typeof params.id === 'string' ? params.id : undefined;

  const [label, setLabel] = useState<'Home' | 'Work' | 'Other'>('Home');
  const [flatNo, setFlatNo] = useState('');
  const [area, setArea] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [makeDefault, setMakeDefault] = useState(true);
  const [loading, setLoading] = useState(false);
  const [pincodeError, setPincodeError] = useState('');
  const [cityTouched, setCityTouched] = useState(false);
  const [areaTouched, setAreaTouched] = useState(false);
  const [pincodeTouched, setPincodeTouched] = useState(false);

  useEffect(() => {
    if (!editingId) return;

    let isActive = true;
    (async () => {
      try {
        const list: Address[] = await api.get('/addresses');
        if (!isActive) return;
        const existing = list.find((a) => a.id === editingId);
        if (!existing) {
          Alert.alert('Not found', 'Address not found');
          router.back();
          return;
        }
        setLabel(
          (['Home', 'Work', 'Other'].includes(existing.label)
            ? existing.label
            : 'Other') as 'Home' | 'Work' | 'Other'
        );
        setFlatNo(existing.flat_no);
        setArea(existing.area);
        setLandmark(existing.landmark || '');
        setCity(existing.city);
        setPincode(existing.pincode);
        if (
          existing.location &&
          existing.location.type === 'Point' &&
          Array.isArray(existing.location.coordinates) &&
          existing.location.coordinates.length === 2
        ) {
          const [lng, lat] = existing.location.coordinates;
          setCoords({ latitude: lat, longitude: lng });
        }
        setMakeDefault(existing.is_default);
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Failed to load address');
      }
    })();

    return () => {
      isActive = false;
    };
  }, [editingId, router]);

  const handleReverseGeocode = async (nextCoords: Coordinates) => {
    try {
      const results = await Location.reverseGeocodeAsync({
        latitude: nextCoords.latitude,
        longitude: nextCoords.longitude,
      });
      const first = results[0];
      if (!first) return;

      if (!cityTouched && first.city && !city) {
        setCity(first.city);
      }

      if (!areaTouched) {
        const candidate =
          first.subLocality ||
          first.district ||
          first.name ||
          first.street ||
          '';
        if (candidate && !area) {
          setArea(candidate);
        }
      }

      if (!pincodeTouched && first.postalCode && !pincode) {
        setPincode(first.postalCode);
      }
    } catch {
      // best-effort only
    }
  };

  const handleMapLocationChange = (c: Coordinates) => {
    setCoords(c);
    void handleReverseGeocode(c);
  };

  const fetchCityFromPincode = async (code: string) => {
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${code}`);
      const json = await res.json();
      if (Array.isArray(json) && json[0]?.Status === 'Success') {
        const po = json[0].PostOffice?.[0];
        if (po) {
          if (!cityTouched && po.District && !city) {
            setCity(po.District);
          }
          setPincodeError('');
          return;
        }
      }
      setPincodeError('Invalid pincode');
    } catch {
      setPincodeError('Unable to verify pincode');
    }
  };

  useEffect(() => {
    if (!pincodeTouched) return;

    if (!pincode) {
      setPincodeError('');
      return;
    }

    if (!/^\d+$/.test(pincode)) {
      setPincodeError('Pincode must be numeric');
      return;
    }

    if (pincode.length !== 6) {
      setPincodeError('Pincode must be 6 digits');
      return;
    }

    const timeout = setTimeout(() => {
      void fetchCityFromPincode(pincode);
    }, 500);

    return () => clearTimeout(timeout);
  }, [pincode, pincodeTouched, city, cityTouched]);

  const handleSave = async () => {
    if (!flatNo.trim() || !area.trim() || !city.trim() || !pincode.trim()) {
      Alert.alert('Missing info', 'Please fill all required fields.');
      return;
    }
    if (!coords) {
      Alert.alert('Select location', 'Please pick a location on the map.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        label,
        flat_no: flatNo.trim(),
        area: area.trim(),
        landmark: landmark.trim(),
        city: city.trim(),
        pincode: pincode.trim(),
        location: {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude] as [number, number],
        },
        is_default: makeDefault,
      };

      if (editingId) {
        // For update, keep default management via dedicated endpoint
        const { is_default: _ignored, ...updatePayload } = payload;
        await api.put(`/addresses/${editingId}`, updatePayload);
        if (makeDefault) {
          await api.put(`/addresses/${editingId}/set-default`, {});
        }
      } else {
        await api.post('/addresses', payload);
      }

      Alert.alert('Success', `Address ${editingId ? 'updated' : 'saved'} successfully`);
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save address');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backBtn}
              activeOpacity={0.7}
            >
              <Feather name="arrow-left" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.title}>{editingId ? 'Edit Address' : 'Add Address'}</Text>
          </View>

          <View style={styles.content}>
            <View style={styles.mapCard}>
              <Text style={styles.sectionTitle}>Pin Location</Text>
              <Text style={styles.sectionSubtitle}>
                Move the pin to your exact pickup location.
              </Text>
              <View style={styles.mapWrapper}>
                <LiveMap
                  initialLocation={coords || undefined}
                  onLocationChange={(c) => setCoords(c)}
                />
              </View>
            </View>

            <View style={styles.formCard}>
              <Text style={styles.sectionTitle}>Address Details</Text>

              <Text style={styles.label}>Label</Text>
              <View style={styles.labelRow}>
                {(['Home', 'Work', 'Other'] as const).map((l) => (
                  <TouchableOpacity
                    key={l}
                    style={[
                      styles.labelChip,
                      label === l && styles.labelChipActive,
                    ]}
                    onPress={() => setLabel(l)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.labelChipText,
                        label === l && styles.labelChipTextActive,
                      ]}
                    >
                      {l}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Flat / House No *</Text>
              <TextInput
                style={styles.input}
                placeholder="Flat / House No"
                placeholderTextColor={Colors.textMuted}
                value={flatNo}
                onChangeText={setFlatNo}
              />

              <Text style={styles.label}>Area / Street *</Text>
              <TextInput
                style={styles.input}
                placeholder="Area, street, locality"
                placeholderTextColor={Colors.textMuted}
                value={area}
                onChangeText={(val) => {
                  setArea(val);
                  setAreaTouched(true);
                }}
              />

              <Text style={styles.label}>Landmark</Text>
              <TextInput
                style={styles.input}
                placeholder="Nearby landmark (optional)"
                placeholderTextColor={Colors.textMuted}
                value={landmark}
                onChangeText={setLandmark}
              />

              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.label}>City *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="City"
                    placeholderTextColor={Colors.textMuted}
                    value={city}
                    onChangeText={(val) => {
                      setCity(val);
                      setCityTouched(true);
                    }}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.label}>Pincode *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Pincode"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    value={pincode}
                    onChangeText={(val) => {
                      setPincode(val);
                      setPincodeTouched(true);
                    }}
                    maxLength={6}
                  />
                </View>
              </View>

              {pincodeError ? (
                <Text style={styles.errorText}>{pincodeError}</Text>
              ) : null}

              <View style={styles.defaultRow}>
                <View>
                  <Text style={styles.defaultTitle}>Set as default address</Text>
                  <Text style={styles.defaultSubtitle}>
                    This will be used automatically for future orders.
                  </Text>
                </View>
                <Switch
                  value={makeDefault}
                  onValueChange={setMakeDefault}
                  thumbColor={makeDefault ? Colors.primaryLight : '#f4f3f4'}
                  trackColor={{ false: '#d4d4d4', true: Colors.primary + '55' }}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, loading && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}>
                {loading ? 'Saving...' : editingId ? 'Save Changes' : 'Save Address'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: { paddingRight: 12, paddingVertical: 4 },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 24,
    color: Colors.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.containerPadding,
    paddingBottom: 24,
  },
  mapCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 16,
  },
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  sectionTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontFamily: Fonts.ui,
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 10,
  },
  mapWrapper: {
    height: 260,
    borderRadius: Radius.md,
    overflow: 'hidden',
    marginTop: 4,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.text,
    marginTop: 14,
    marginBottom: 6,
  },
  errorText: {
    fontFamily: Fonts.ui,
    fontSize: 12,
    color: Colors.error,
    marginTop: 4,
  },
  input: {
    backgroundColor: Colors.subtle,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.ui,
    fontSize: 15,
    color: Colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  labelRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  labelChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  labelChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  labelChipText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textMuted,
  },
  labelChipTextActive: {
    color: Colors.primary,
  },
  defaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  defaultTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.text,
  },
  defaultSubtitle: {
    fontFamily: Fonts.ui,
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
    maxWidth: 220,
  },
  saveBtn: {
    marginTop: 20,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.textInverted,
  },
});

