import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "../../../src/context/AuthContext";
import { Colors, Fonts, Spacing, Radius } from "../../../src/utils/theme";

export default function CustomerProfile() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
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

  const renderInfoRow = (
    icon: any,
    label: string,
    value?: string
  ) => (
    <View style={styles.infoRow}>
      <Feather name={icon} size={18} color={Colors.primary} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || "Not set"}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.headerTitle}>Profile</Text>

        {/* PROFILE CARD */}
        <View style={styles.profileCard}>

          {/* Stroked Circular Edit Badge */}
        <View style={styles.editContainer}>
        <TouchableOpacity
          style={styles.editCircle}
          onPress={() => router.push("/(customer)/edit-profile")}
          activeOpacity={0.6}
        >
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>

        </View>

          {/* Avatar */}
          <View style={styles.avatar}>
            {user?.profile_photo ? (
              <Image
                source={{ uri: user.profile_photo }}
                style={styles.avatarImage}
              />
            ) : (
              <Text style={styles.avatarText}>
                {user?.name?.charAt(0) || "U"}
              </Text>
            )}
          </View>

          {/* Name & Email */}
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>

          {/* Role Badge */}
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>Customer</Text>
          </View>
        </View>

        {/* ACCOUNT DETAILS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Details</Text>

          {renderInfoRow("map-pin", "City", user?.city)}
          {renderInfoRow("hash", "Pincode", user?.pincode)}
          {renderInfoRow("home", "Address", user?.address)}
          {renderInfoRow("phone", "Phone", user?.phone)}
        </View>

        {/* Manage Address */}
        <TouchableOpacity
          style={styles.addressBtn}
          onPress={() => router.push("/(customer)/addresses")}
          activeOpacity={0.8}
        >
          <Feather name="map-pin" size={18} color={Colors.textInverted} />
          <Text style={styles.addressBtnText}>Manage Addresses</Text>
        </TouchableOpacity>

        {/* Logout */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Feather name="log-out" size={20} color={Colors.error} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  scroll: {
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: 16,
    paddingBottom: 40,
  },

  headerTitle: {
    fontFamily: Fonts.heading,
    fontSize: 28,
    color: Colors.text,
    marginBottom: 24,
  },

  profileCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    position: "relative",
  },

  editBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 60,
    height: 60,
    borderRadius: 36,
    borderWidth: 1.1,
    borderColor: Colors.border, // gray stroke
    justifyContent: "center",
    alignItems: "center",
  },

 editContainer: {
  position: "absolute",
  top: 16,
  right: 16,
  alignItems: "center",
},

editCircle: {
  width: 50
  ,
  height: 30,
  borderRadius: 22,
  borderWidth: 1.1,
  borderColor: Colors.border,
  justifyContent: "center",
  alignItems: "center",
  // padding:4,
},

editText: {
  marginTop: 0,
  fontSize: 14,
  fontFamily: Fonts.body,
  color: Colors.textMuted,
},

  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },

  avatarImage: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },

  avatarText: {
    fontFamily: Fonts.heading,
    fontSize: 34,
    color: Colors.textInverted,
  },

  userName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    fontWeight: "600",
    color: Colors.text,
  },

  userEmail: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.textMuted,
    marginTop: 4,
  },

  roleBadge: {
    backgroundColor: Colors.primary + "18",
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 12,
  },

  roleText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.primary,
  },

  section: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    marginBottom: 24,
  },

  sectionTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.text,
    marginBottom: 16,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.subtle,
  },

  infoLabel: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.textMuted,
    marginLeft: 12,
    flex: 1,
  },

  infoValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.text,
  },

  addressBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth:1,
    borderColor:"#E5E7EB",
    marginBottom: 18,
    gap: 8,
  },

  addressBtnText: {
    color: Colors.primary,
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
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