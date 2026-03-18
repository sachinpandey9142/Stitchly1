import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";

import { useAuth } from "../../../src/context/AuthContext";
import { api } from "../../../src/utils/api";
import { Colors, Fonts, Spacing, Radius } from "../../../src/utils/theme";

export default function TailorProfile() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [newService, setNewService] = useState({
    service_name: "",
    price: "",
    category: "",
  });

  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    fetchServices();
  }, []);

  const fetchServices = async () => {
    try {
      const data = await api.get("/tailor/services");
      setServices(data);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  const handleAddService = async () => {
    if (!newService.service_name || !newService.price || !newService.category) {
      Alert.alert("Error", "Fill all fields");
      return;
    }

    try {
      await api.post("/tailor/services", {
        ...newService,
        price: parseFloat(newService.price),
      });

      setNewService({
        service_name: "",
        price: "",
        category: "",
      });

      setShowAdd(false);
      fetchServices();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  const handleDeleteService = async (id: string) => {
    Alert.alert("Delete", "Remove this service?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/tailor/services/${id}`);
            fetchServices();
          } catch {}
        },
      },
    ]);
  };

  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.headerTitle}>Profile</Text>

        {/* PROFILE CARD */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            {user?.profile_photo ? (
              <Image
                source={{ uri: user.profile_photo }}
                style={styles.avatarImage}
              />
            ) : (
              <Text style={styles.avatarText}>{user?.name?.[0]}</Text>
            )}
          </View>

          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>

          <View style={styles.infoRow}>
            <Feather name="map-pin" size={14} color={Colors.primary} />
            <Text style={styles.infoText}>
              {user?.city}
              {user?.pincode ? `, ${user?.pincode}` : ""}
              {!user?.city && "Location not set"}
            </Text>
          </View>

          {user?.address ? (
            <View style={styles.infoRow}>
              <Feather name="home" size={14} color={Colors.textMuted} />
              <Text style={styles.infoText}>{user?.address}</Text>
            </View>
          ) : null}

          <View style={styles.infoRow}>
            <MaterialCommunityIcons
              name="gender-male-female"
              size={18}
              color={Colors.textMuted}
            />
            <Text style={styles.infoLabel}>Gender</Text>
            <Text style={styles.infoValue}>{user?.gender || "Not set"}</Text>
          </View>

          {/* SPECIALITIES */}
          <View style={styles.tagRow}>
            {user?.specialities?.map((s: string) => (
              <View key={s} style={styles.tag}>
                <Text style={styles.tagText}>{s}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* SERVICES SECTION */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Services</Text>

            <TouchableOpacity
              style={styles.specializationBtn}
              onPress={() => router.push("/(tailor)/select-specializations")}
            >
              <Text style={styles.specializationText}>
                Select Stitching Designs
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="add-service-btn"
              onPress={() => setShowAdd(!showAdd)}
            >
              <Feather
                name={showAdd ? "x" : "plus"}
                size={22}
                color={Colors.primary}
              />
            </TouchableOpacity>
          </View>

          {showAdd && (
            <View style={styles.addForm}>
              <TextInput
                style={styles.formInput}
                placeholder="Service name"
                placeholderTextColor={Colors.textMuted}
                value={newService.service_name}
                onChangeText={(t) =>
                  setNewService({ ...newService, service_name: t })
                }
              />

              <TextInput
                style={styles.formInput}
                placeholder="Price (INR)"
                placeholderTextColor={Colors.textMuted}
                value={newService.price}
                keyboardType="numeric"
                onChangeText={(t) =>
                  setNewService({ ...newService, price: t })
                }
              />

              <TextInput
                style={styles.formInput}
                placeholder="Category"
                placeholderTextColor={Colors.textMuted}
                value={newService.category}
                onChangeText={(t) =>
                  setNewService({ ...newService, category: t })
                }
              />

              <TouchableOpacity style={styles.saveBtn} onPress={handleAddService}>
                <Text style={styles.saveBtnText}>Add Service</Text>
              </TouchableOpacity>
            </View>
          )}

          {loading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            services.map((s) => (
              <View key={s.id} style={styles.serviceRow}>
                <View style={styles.serviceInfo}>
                  <Text style={styles.serviceName}>{s.service_name}</Text>
                  <Text style={styles.serviceCategory}>{s.category}</Text>
                </View>

                <Text style={styles.servicePrice}>₹{s.price}</Text>

                <TouchableOpacity onPress={() => handleDeleteService(s.id)}>
                  <Feather name="trash-2" size={18} color={Colors.error} />
                </TouchableOpacity>
              </View>
            ))
          )}

          {!loading && services.length === 0 && (
            <Text style={styles.emptyText}>No services added yet</Text>
          )}
        </View>

        {/* EDIT PROFILE */}
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => router.push("/(tailor)/edit-profile")}
        >
          <Text style={styles.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>

        {/* LOGOUT */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Feather name="log-out" size={20} color={Colors.error} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  scroll: {
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: 16,
    paddingBottom: 40,
  },

  headerTitle: {
    fontFamily: Fonts.heading,
    fontSize: 28,
    color: Colors.text,
    marginBottom: 20,
  },

  profileCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    alignItems: "center",
    marginBottom: 20,
  },

  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },

  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },

  avatarText: {
    fontFamily: Fonts.heading,
    fontSize: 36,
    color: Colors.textInverted,
  },

  userName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.text,
  },

  userEmail: {
    fontFamily: Fonts.ui,
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 2,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
  },

  infoText: {
    fontFamily: Fonts.ui,
    fontSize: 14,
    color: Colors.textMuted,
    marginLeft: 6,
  },

  infoLabel: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.textMuted,
    marginLeft: 10,
    flex: 1,
  },

  infoValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.text,
  },

  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
  },

  tag: {
    backgroundColor: Colors.primary + "15",
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },

  tagText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.primary,
  },

  section: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 20,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },

  sectionTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.text,
  },

  specializationBtn: {
    backgroundColor: "#6C4CF1",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },

  specializationText: {
    color: "white",
    fontWeight: "600",
    fontSize: 12,
  },

  addForm: {
    backgroundColor: Colors.subtle,
    borderRadius: Radius.md,
    padding: 14,
    marginBottom: 14,
  },

  formInput: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 10,
  },

  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 12,
    alignItems: "center",
  },

  saveBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.textInverted,
  },

  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.subtle,
  },

  serviceInfo: { flex: 1 },

  serviceName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.text,
  },

  serviceCategory: {
    fontFamily: Fonts.ui,
    fontSize: 13,
    color: Colors.textMuted,
  },

  servicePrice: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.primary,
    marginRight: 14,
  },

  emptyText: {
    textAlign: "center",
    paddingVertical: 16,
    color: Colors.textMuted,
  },

  editBtn: {
    backgroundColor: "#0f766e",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 16,
  },

  editBtnText: {
    color: "white",
    fontWeight: "bold",
  },

  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.error + "30",
  },

  logoutText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.error,
    marginLeft: 10,
  },
});