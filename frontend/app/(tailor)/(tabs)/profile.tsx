import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
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

const formatPriceValue = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
};

const formatComplexityLabel = (value: unknown): string => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

const formatPriceRangeLabel = (service: any): string => {
  const minPrice =
    formatPriceValue(service?.price_min) ?? formatPriceValue(service?.price) ?? 0;
  const maxPrice =
    formatPriceValue(service?.price_max) ?? formatPriceValue(service?.price) ?? minPrice;

  if (!minPrice) return "₹0";
  if (minPrice === maxPrice) return `₹${Math.round(minPrice)}`;
  return `₹${Math.round(minPrice)} - ₹${Math.round(maxPrice)}`;
};

export default function TailorProfile() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchServices();
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
            <Text style={styles.sectionTitle}>Specializations & Pricing</Text>
          </View>

          <TouchableOpacity
            style={styles.specializationBtn}
            onPress={() => router.push("/(tailor)/select-specializations")}
            activeOpacity={0.85}
          >
            <Feather name="sliders" size={16} color={Colors.textInverted} />
            <Text style={styles.specializationText}>Select Specializations & Pricing</Text>
          </TouchableOpacity>

          <Text style={styles.sectionHint}>
            Choose categories, then tap each selected category to add service name and price range.
          </Text>

          {loading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            services.map((s) => (
              <View key={s.id} style={styles.serviceRow}>
                <View style={styles.serviceInfo}>
                  <Text style={styles.serviceName}>{s.service_name}</Text>
                  <Text style={styles.serviceCategory}>
                    {s.category}
                    {formatComplexityLabel(s.complexity) ? ` • ${formatComplexityLabel(s.complexity)}` : ""}
                  </Text>
                </View>

                <Text style={styles.servicePrice}>{formatPriceRangeLabel(s)}</Text>
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
    marginBottom: 10,
  },

  sectionTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.text,
  },

  specializationBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 10,
  },

  specializationText: {
    color: Colors.textInverted,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
  },

  sectionHint: {
    fontFamily: Fonts.ui,
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 10,
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