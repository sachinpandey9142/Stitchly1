import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Radius, Spacing } from '../../src/utils/theme';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

export default function DeliveryEditProfile() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [city, setCity] = useState(user?.city || '');
  const [pincode, setPincode] = useState(user?.pincode || '');
  const [address, setAddress] = useState(user?.address || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [profilePhoto, setProfilePhoto] = useState(user?.profile_photo || null);
  
  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      alert("Permission required");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled) {
     const manipulatedImage = await manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: 300 } }],
    {
      compress: 0.6,
      format: SaveFormat.JPEG,
      base64: true,
    }
  );

      setProfilePhoto(
        `data:image/jpeg;base64,${manipulatedImage.base64}`
      );
    }
  };

  const handleSave = async () => {
    try {
      await api.put('/auth/profile', {
        city,
        pincode,
        address,
        phone,
        profile_photo: profilePhoto,
      });

      await refreshUser();
      Alert.alert('Success', 'Profile updated successfully');
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Update failed');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Edit Profile</Text>
      
      <View style={{ alignItems: "center", marginBottom: 20 }}>
  <TouchableOpacity onPress={pickImage}>
    {profilePhoto ? (
      <Image
        source={{ uri: profilePhoto }}
        style={{ width: 120, height: 120, borderRadius: 60 }}
      />
    ) : (
      <View
        style={{
          width: 120,
          height: 120,
          borderRadius: 60,
          backgroundColor: "#E5E7EB",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text>Select Photo</Text>
      </View>
    )}
  </TouchableOpacity>
</View>

      <TextInput
        placeholder="City"
        value={city}
        onChangeText={setCity}
        style={styles.input}
      />

      <TextInput
        placeholder="Pincode"
        value={pincode}
        onChangeText={setPincode}
        style={styles.input}
      />

      <TextInput
        placeholder="Address"
        value={address}
        onChangeText={setAddress}
        style={styles.input}
      />

      <TextInput
        placeholder="Phone"
        value={phone}
        onChangeText={setPhone}
        style={styles.input}
      />

      <TouchableOpacity style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Save Changes</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.containerPadding,
    backgroundColor: Colors.background,
  },
  header: {
    fontSize: 22,
    fontFamily: Fonts.heading,
    marginBottom: 20,
  },
  input: {
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: Radius.md,
    marginBottom: 12,
  },
  button: {
    backgroundColor: Colors.primary,
    padding: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontFamily: Fonts.bodyBold,
  },
});