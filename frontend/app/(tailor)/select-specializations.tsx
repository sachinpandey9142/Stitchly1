import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { Colors, Fonts, Spacing, Radius } from "../../src/utils/theme";
import {
  CATEGORY_CAROUSEL,
  CATEGORY_SPECIALITY_MAP,
  getCategoryPreviewImage,
} from "../../src/utils/customerDiscovery";
import { api } from "../../src/utils/api";
import { useAuth } from "../../src/context/AuthContext";

export default function SelectSpecializations() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [selectedCategoryKeys, setSelectedCategoryKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const womenCategories = useMemo(
    () => CATEGORY_CAROUSEL.filter((item) => item.group === "women"),
    []
  );
  const menCategories = useMemo(
    () => CATEGORY_CAROUSEL.filter((item) => item.group === "men"),
    []
  );

  useEffect(() => {
    const savedSpecialities = user?.specialities || [];
    if (savedSpecialities.length === 0) {
      setSelectedCategoryKeys([]);
      return;
    }

    const normalized = new Set(savedSpecialities.map((item) => item.toLowerCase()));

    const matched = CATEGORY_CAROUSEL.filter((category) => {
      const mapped = CATEGORY_SPECIALITY_MAP[category.key] || "";
      return (
        normalized.has(category.key.toLowerCase()) ||
        normalized.has(category.label.toLowerCase()) ||
        (mapped ? normalized.has(mapped.toLowerCase()) : false)
      );
    }).map((category) => category.key);

    setSelectedCategoryKeys(matched);
  }, [user?.specialities]);

  const toggleCategory = (categoryKey: string) => {
    if (selectedCategoryKeys.includes(categoryKey)) {
      setSelectedCategoryKeys((prev) => prev.filter((item) => item !== categoryKey));
      return;
    }

    setSelectedCategoryKeys((prev) => [...prev, categoryKey]);
  };

  const handleSave = async () => {
    if (selectedCategoryKeys.length === 0) {
      Alert.alert("Select at least one category", "Choose the categories you stitch.");
      return;
    }

    const specialities = Array.from(
      new Set(
        selectedCategoryKeys
          .map((categoryKey) => CATEGORY_SPECIALITY_MAP[categoryKey])
          .filter(Boolean)
      )
    );

    if (specialities.length === 0) {
      Alert.alert("Error", "Could not map selected categories to specialities.");
      return;
    }

    try {
      setSaving(true);
      await api.put("/tailor/specialities", { specialities });
      await refreshUser();

      Alert.alert("Saved", "Your category specializations are updated.");
      router.back();
    } catch {
      Alert.alert("Error", "Could not save specializations");
    } finally {
      setSaving(false);
    }
  };

  const renderCategoryCard = (category: (typeof CATEGORY_CAROUSEL)[number]) => {
    const isSelected = selectedCategoryKeys.includes(category.key);
    const previewImage = getCategoryPreviewImage(category.key);

    return (
      <TouchableOpacity
        key={category.key}
        style={[styles.categoryCard, isSelected && styles.categoryCardSelected]}
        onPress={() => toggleCategory(category.key)}
        activeOpacity={0.85}
      >
        {previewImage ? (
          <Image source={previewImage} style={styles.categoryImage} resizeMode="contain" />
        ) : (
          <View style={styles.imageFallback}>
            <Feather name="image" size={18} color={Colors.textMuted} />
          </View>
        )}

        <View style={styles.cardFooter}>
          <Text style={[styles.cardLabel, isSelected && styles.cardLabelSelected]}>{category.label}</Text>
          {isSelected ? <Feather name="check-circle" size={16} color={Colors.primary} /> : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Select Category Specializations</Text>
        <Text style={styles.subtitle}>
          These categories decide where customers can discover your profile.
        </Text>

        <Text style={styles.sectionTitle}>Women</Text>
        <View style={styles.categoryGrid}>{womenCategories.map(renderCategoryCard)}</View>

        <Text style={styles.sectionTitle}>Men</Text>
        <View style={styles.categoryGrid}>{menCategories.map(renderCategoryCard)}</View>

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" size="small" style={styles.saveLoader} /> : null}
          <Text style={styles.saveText}>{saving ? "Saving..." : "Save Specializations"}</Text>
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

  title: {
    fontFamily: Fonts.heading,
    fontSize: 24,
    color: Colors.text,
    marginBottom: 6,
  },

  subtitle: {
    fontFamily: Fonts.ui,
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: 18,
  },

  sectionTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.text,
    marginTop: 12,
    marginBottom: 10,
  },

  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 10,
  },

  categoryCard: {
    width: "48%",
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 10,
  },

  categoryCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + "10",
  },

  categoryImage: {
    width: "100%",
    height: 88,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },

  imageFallback: {
    width: "100%",
    height: 88,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  cardFooter: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },

  cardLabel: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.text,
  },

  cardLabelSelected: {
    fontFamily: Fonts.bodyBold,
    color: Colors.primary,
  },

  saveButton: {
    marginTop: 24,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },

  saveButtonDisabled: {
    opacity: 0.75,
  },

  saveLoader: {
    marginRight: 8,
  },

  saveText: {
    fontFamily: Fonts.bodyBold,
    color: "white",
    fontSize: 16,
  },
});