import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import { api } from "@/src/utils/api";
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

export default function EditProfile() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [city, setCity] = useState(user?.city || "");
  const [pincode, setPincode] = useState(user?.pincode || "");
  const [address, setAddress] = useState(user?.address || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [profilePhoto, setProfilePhoto] = useState(user?.profile_photo || "");

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

    //  Refresh user from backend
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
      <TouchableOpacity
  onPress={pickImage}
  style={{ alignItems: 'center', marginBottom: 20 }}
>
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
        backgroundColor: '#E5E7EB',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Text>Upload Photo</Text>
    </View>
  )}
</TouchableOpacity>

      <TextInput placeholder="City" value={city} onChangeText={setCity} style={styles.input} />
      <TextInput placeholder="Pincode" value={pincode} onChangeText={setPincode} style={styles.input} />
      <TextInput placeholder="Address" value={address} onChangeText={setAddress} style={styles.input} />
      <TextInput placeholder="Phone" value={phone} onChangeText={setPhone} style={styles.input} />

      <TouchableOpacity style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Save Changes</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 20 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
  },
  button: {
    backgroundColor: "#1E7F6A",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "white", fontWeight: "bold" },
});
