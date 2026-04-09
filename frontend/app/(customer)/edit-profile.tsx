import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from '@expo/vector-icons';
import { useAuth } from "../../src/context/AuthContext";
import { api } from "@/src/utils/api";
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Location from 'expo-location';

export default function EditProfile() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const initialLatitude = user?.geo_location?.coordinates?.[1];
  const initialLongitude = user?.geo_location?.coordinates?.[0];

  const [city, setCity] = useState(user?.city || "");
  const [pincode, setPincode] = useState(user?.pincode || "");
  const [address, setAddress] = useState(user?.address || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [profilePhoto, setProfilePhoto] = useState(user?.profile_photo || null);
  const [latitude, setLatitude] = useState<number | null>(
    typeof initialLatitude === 'number' ? initialLatitude : null
  );
  const [longitude, setLongitude] = useState<number | null>(
    typeof initialLongitude === 'number' ? initialLongitude : null
  );
  const [loadingLocation, setLoadingLocation] = useState(false);

  const getCurrentCoords = async (): Promise<{ latitude: number; longitude: number } | null> => {
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        permission = await Location.requestForegroundPermissionsAsync();
      }

      if (permission.status !== 'granted') {
        Alert.alert('Permission denied', 'Enable location access to fetch your address.');
        return null;
      }

      const attempts: Array<() => Promise<Location.LocationObject | null>> = [
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
        } catch {}
      }

      Alert.alert('Error', 'Unable to fetch location coordinates.');
      return null;
    } catch {
      Alert.alert('Error', 'Unable to fetch location coordinates.');
      return null;
    }
  };

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

      const { latitude: nextLatitude, longitude: nextLongitude } = coords;
      setLatitude(nextLatitude);
      setLongitude(nextLongitude);

      let resolvedAddress = `${nextLatitude.toFixed(4)}, ${nextLongitude.toFixed(4)}`;
      let resolvedCity = '';
      let resolvedPincode = '';

      try {
        const data = await reverseGeocodeWithNominatim(nextLatitude, nextLongitude);
        const reverseAddress = data?.address || {};
        const parsedDisplayName =
          typeof data?.display_name === 'string'
            ? data.display_name
                .split(',')
                .map((piece: string) => piece.trim())
                .filter(Boolean)
            : [];

        resolvedAddress =
          (typeof data?.display_name === 'string' && data.display_name.trim()) || resolvedAddress;
        resolvedCity =
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
        resolvedPincode = reverseAddress.postcode || (pincodeMatch ? pincodeMatch[0] : '');
      } catch {
        try {
          const reverse = await Location.reverseGeocodeAsync({
            latitude: nextLatitude,
            longitude: nextLongitude,
          });
          const first = reverse[0];

          if (first) {
            resolvedCity = first.city || first.subregion || first.region || '';
            resolvedPincode = first.postalCode || '';
            resolvedAddress =
              [
                first.name,
                first.street,
                first.district,
                first.city,
                first.region,
                first.postalCode,
              ]
                .filter(Boolean)
                .join(', ') || resolvedAddress;
          }
        } catch {}
      }

      setCity((prev) => resolvedCity || prev);
      setPincode((prev) => resolvedPincode || prev);
      setAddress(resolvedAddress);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Unable to fetch location');
    } finally {
      setLoadingLocation(false);
    }
  };

  const applyPickedImage = async (imageUri: string) => {
    const manipulatedImage = await manipulateAsync(
      imageUri,
      [{ resize: { width: 300 } }],
      {
        compress: 0.6,
        format: SaveFormat.JPEG,
        base64: true,
      }
    );

    setProfilePhoto(`data:image/jpeg;base64,${manipulatedImage.base64}`);
  };

  const pickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow gallery access to choose a photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled) {
      await applyPickedImage(result.assets[0].uri);
    }
  };

  const openCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow camera access to take a photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      mediaTypes: ['images'],
    });

    if (!result.canceled) {
      await applyPickedImage(result.assets[0].uri);
    }
  };

  const handlePhotoEditPress = () => {
    Alert.alert('Update Profile Photo', 'Choose image source', [
      { text: 'Open Camera', onPress: () => void openCamera() },
      { text: 'Choose from Gallery', onPress: () => void pickFromGallery() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

const handleSave = async () => {
  try {
    await api.put('/auth/profile', {
      city,
      pincode,
      address,
      phone,
      profile_photo: profilePhoto,
      latitude: latitude ?? undefined,
      longitude: longitude ?? undefined,
    });

    // 🔥 Refresh user from backend
    await refreshUser();

    Alert.alert('Success', 'Profile updated successfully');
    router.back();

  } catch (error: any) {
    Alert.alert('Error', error.message || 'Update failed');
  }
};

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Edit Profile</Text>
      <View style={styles.photoSection}>
        <View style={styles.photoWrapper}>
          {profilePhoto ? (
            <Image source={{ uri: profilePhoto }} style={styles.profileImage} />
          ) : (
            <View style={[styles.profileImage, styles.profileImageFallback]}>
              <Text>Select Photo</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.photoEditButton}
            onPress={handlePhotoEditPress}
            activeOpacity={0.85}
          >
            <Feather name="edit-2" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <TextInput placeholder="City" value={city} onChangeText={setCity} style={styles.input} />
      <TextInput placeholder="Pincode" value={pincode} onChangeText={setPincode} style={styles.input} />
      <TextInput placeholder="Address" value={address} onChangeText={setAddress} style={styles.input} />
      <TextInput placeholder="Phone" value={phone} onChangeText={setPhone} style={styles.input} />

      <TouchableOpacity
        style={[styles.fetchLocationButton, loadingLocation && styles.fetchLocationButtonDisabled]}
        onPress={fetchCurrentLocation}
        disabled={loadingLocation}
      >
        {loadingLocation ? <ActivityIndicator color="#1E7F6A" size="small" style={styles.fetchLoader} /> : null}
        <Text style={styles.fetchLocationButtonText}>
          {loadingLocation ? 'Fetching address...' : 'Use Current Location'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Save Changes</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 20 },
  photoSection: {
    alignItems: "center",
    marginBottom: 20,
  },
  photoWrapper: {
    width: 120,
    height: 120,
    position: "relative",
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  profileImageFallback: {
    backgroundColor: "#E5E7EB",
    justifyContent: "center",
    alignItems: "center",
  },
  photoEditButton: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#1E7F6A",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
  },
  fetchLocationButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#1E7F6A",
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  fetchLocationButtonDisabled: {
    opacity: 0.75,
  },
  fetchLoader: {
    marginRight: 8,
  },
  fetchLocationButtonText: {
    color: "#1E7F6A",
    fontWeight: "600",
  },
  button: {
    backgroundColor: "#1E7F6A",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "white", fontWeight: "bold" },
});
