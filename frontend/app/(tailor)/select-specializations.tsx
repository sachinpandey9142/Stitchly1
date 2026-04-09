import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Image,
  ActivityIndicator,
  TextInput,
} from "react-native";
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

type ServiceDraft = {
  id?: string;
  service_name: string;
  price_min: string;
  price_max: string;
};

const createEmptyServiceDraft = (): ServiceDraft => ({
  service_name: "",
  price_min: "",
  price_max: "",
});

export default function SelectSpecializations() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [selectedCategoryKeys, setSelectedCategoryKeys] = useState<string[]>([]);
  const [expandedCategoryKey, setExpandedCategoryKey] = useState<string | null>(null);
  const [categoryServices, setCategoryServices] = useState<Record<string, ServiceDraft[]>>({});
  const [existingServices, setExistingServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const womenCategories = useMemo(
    () => CATEGORY_CAROUSEL.filter((item) => item.group === "women"),
    []
  );
  const menCategories = useMemo(
    () => CATEGORY_CAROUSEL.filter((item) => item.group === "men"),
    []
  );

  const categoryLabelByKey = useMemo(() => {
    const map: Record<string, string> = {};
    CATEGORY_CAROUSEL.forEach((item) => {
      map[item.key] = item.label;
    });
    return map;
  }, []);

  const labelToCategoryKey = useMemo(() => {
    const map: Record<string, string> = {};
    CATEGORY_CAROUSEL.forEach((item) => {
      map[item.label.toLowerCase()] = item.key;
    });
    return map;
  }, []);

  const specialityToCategoryKey = useMemo(() => {
    const map: Record<string, string> = {};
    Object.entries(CATEGORY_SPECIALITY_MAP).forEach(([key, value]) => {
      const normalized = String(value || "").toLowerCase();
      if (normalized && !map[normalized]) {
        map[normalized] = key;
      }
    });
    return map;
  }, []);

  const resolveCategoryKey = useCallback(
    (value: string | null | undefined): string | null => {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized) return null;

      if (CATEGORY_CAROUSEL.some((item) => item.key === normalized)) {
        return normalized;
      }

      if (labelToCategoryKey[normalized]) {
        return labelToCategoryKey[normalized];
      }

      if (specialityToCategoryKey[normalized]) {
        return specialityToCategoryKey[normalized];
      }

      return null;
    },
    [labelToCategoryKey, specialityToCategoryKey]
  );

  useEffect(() => {
    let mounted = true;

    const loadInitialSetup = async () => {
      setLoading(true);
      try {
        const data = await api.get("/tailor/services");
        if (!mounted) return;

        const fetchedServices = Array.isArray(data) ? data : [];
        setExistingServices(fetchedServices);

        const serviceMap: Record<string, ServiceDraft[]> = {};
        fetchedServices.forEach((service) => {
          const categoryKey = resolveCategoryKey(service.category);
          if (!categoryKey) return;

          const minPrice = Number(service.price_min ?? service.price ?? 0);
          const maxPrice = Number(service.price_max ?? service.price ?? minPrice);

          if (!serviceMap[categoryKey]) {
            serviceMap[categoryKey] = [];
          }

          serviceMap[categoryKey].push({
            id: service.id,
            service_name: String(service.service_name || ""),
            price_min: Number.isFinite(minPrice) && minPrice > 0 ? String(Math.round(minPrice)) : "",
            price_max: Number.isFinite(maxPrice) && maxPrice > 0 ? String(Math.round(maxPrice)) : "",
          });
        });

        const savedSpecialities = user?.specialities || [];
        const normalizedSpecialities = new Set(savedSpecialities.map((item: string) => item.toLowerCase()));

        const matchedFromSpecialities = CATEGORY_CAROUSEL.filter((category) => {
          const mapped = CATEGORY_SPECIALITY_MAP[category.key] || "";
          return (
            normalizedSpecialities.has(category.key.toLowerCase()) ||
            normalizedSpecialities.has(category.label.toLowerCase()) ||
            (mapped ? normalizedSpecialities.has(mapped.toLowerCase()) : false)
          );
        }).map((category) => category.key);

        const mergedKeys = Array.from(new Set([...matchedFromSpecialities, ...Object.keys(serviceMap)]));

        const nextCategoryServices: Record<string, ServiceDraft[]> = { ...serviceMap };
        mergedKeys.forEach((key) => {
          if (!nextCategoryServices[key] || nextCategoryServices[key].length === 0) {
            nextCategoryServices[key] = [createEmptyServiceDraft()];
          }
        });

        setSelectedCategoryKeys(mergedKeys);
        setCategoryServices(nextCategoryServices);
        setExpandedCategoryKey(mergedKeys[0] || null);
      } catch {
        if (!mounted) return;
        setSelectedCategoryKeys([]);
        setCategoryServices({});
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadInitialSetup();

    return () => {
      mounted = false;
    };
  }, [resolveCategoryKey, user?.specialities]);

  const handleCategoryPress = (categoryKey: string) => {
    const isSelected = selectedCategoryKeys.includes(categoryKey);

    if (!isSelected) {
      setSelectedCategoryKeys((prev) => [...prev, categoryKey]);
      setCategoryServices((prev) => ({
        ...prev,
        [categoryKey]: prev[categoryKey]?.length ? prev[categoryKey] : [createEmptyServiceDraft()],
      }));
      setExpandedCategoryKey(categoryKey);
      return;
    }

    setExpandedCategoryKey((prev) => (prev === categoryKey ? null : categoryKey));
  };

  const removeCategory = (categoryKey: string) => {
    setSelectedCategoryKeys((prev) => prev.filter((item) => item !== categoryKey));
    setExpandedCategoryKey((prev) => (prev === categoryKey ? null : prev));
  };

  const updateServiceDraft = (
    categoryKey: string,
    index: number,
    field: keyof ServiceDraft,
    value: string
  ) => {
    setCategoryServices((prev) => {
      const rows = [...(prev[categoryKey] || [createEmptyServiceDraft()])];
      const current = rows[index] || createEmptyServiceDraft();
      rows[index] = { ...current, [field]: value };
      return { ...prev, [categoryKey]: rows };
    });
  };

  const addServiceRow = (categoryKey: string) => {
    setCategoryServices((prev) => ({
      ...prev,
      [categoryKey]: [...(prev[categoryKey] || [createEmptyServiceDraft()]), createEmptyServiceDraft()],
    }));
  };

  const removeServiceRow = (categoryKey: string, index: number) => {
    setCategoryServices((prev) => {
      const rows = [...(prev[categoryKey] || [createEmptyServiceDraft()])];
      rows.splice(index, 1);
      return {
        ...prev,
        [categoryKey]: rows.length > 0 ? rows : [createEmptyServiceDraft()],
      };
    });
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

    const desiredServices: Array<{
      id?: string;
      service_name: string;
      category: string;
      price: number;
      price_min: number;
      price_max: number;
    }> = [];

    for (const categoryKey of selectedCategoryKeys) {
      const categoryLabel = categoryLabelByKey[categoryKey] || categoryKey;
      const drafts = categoryServices[categoryKey] || [];

      const parsedRows: Array<{
        id?: string;
        service_name: string;
        category: string;
        price: number;
        price_min: number;
        price_max: number;
      }> = [];

      for (const draft of drafts) {
        const serviceName = draft.service_name.trim();
        const minText = draft.price_min.trim();
        const maxText = draft.price_max.trim();
        const hasAnyValue = Boolean(serviceName || minText || maxText);

        if (!hasAnyValue) {
          continue;
        }

        if (!serviceName || !minText || !maxText) {
          Alert.alert(
            "Missing details",
            `Fill service name and complete price range for ${categoryLabel}.`
          );
          return;
        }

        const minPrice = Number(minText);
        const maxPrice = Number(maxText);
        if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0 || maxPrice <= 0) {
          Alert.alert("Invalid price", `Enter valid price range for ${categoryLabel}.`);
          return;
        }

        const normalizedMin = Math.min(minPrice, maxPrice);
        const normalizedMax = Math.max(minPrice, maxPrice);

        parsedRows.push({
          id: draft.id,
          service_name: serviceName,
          category: categoryLabel,
          price: normalizedMin,
          price_min: normalizedMin,
          price_max: normalizedMax,
        });
      }

      if (parsedRows.length === 0) {
        Alert.alert(
          "Add services",
          `Add at least one service and price range for ${categoryLabel}.`
        );
        return;
      }

      desiredServices.push(...parsedRows);
    }

    try {
      setSaving(true);
      await api.put("/tailor/specialities", { specialities });

      const selectedCategorySet = new Set(selectedCategoryKeys);
      const desiredIds = new Set(
        desiredServices.filter((item) => item.id).map((item) => String(item.id))
      );

      const managedExistingServices = existingServices.filter((service) =>
        Boolean(resolveCategoryKey(service.category))
      );

      for (const service of managedExistingServices) {
        const categoryKey = resolveCategoryKey(service.category);
        if (!categoryKey) continue;

        const shouldDelete =
          !selectedCategorySet.has(categoryKey) || !desiredIds.has(String(service.id));

        if (shouldDelete) {
          await api.delete(`/tailor/services/${service.id}`);
        }
      }

      for (const service of desiredServices) {
        const payload = {
          service_name: service.service_name,
          category: service.category,
          price: service.price,
          price_min: service.price_min,
          price_max: service.price_max,
        };

        if (service.id) {
          await api.put(`/tailor/services/${service.id}`, payload);
        } else {
          await api.post("/tailor/services", payload);
        }
      }

      const refreshedServices = await api.get("/tailor/services");
      setExistingServices(Array.isArray(refreshedServices) ? refreshedServices : []);
      await refreshUser();

      Alert.alert("Saved", "Specializations and pricing are updated.");
      router.back();
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not save specializations and pricing.");
    } finally {
      setSaving(false);
    }
  };

  const renderCategoryCard = (category: (typeof CATEGORY_CAROUSEL)[number]) => {
    const isSelected = selectedCategoryKeys.includes(category.key);
    const isExpanded = isSelected && expandedCategoryKey === category.key;
    const previewImage = getCategoryPreviewImage(category.key);
    const drafts = categoryServices[category.key] || [createEmptyServiceDraft()];

    return (
      <View key={category.key}>
        <TouchableOpacity
          style={[styles.categoryCard, isSelected && styles.categoryCardSelected]}
          onPress={() => handleCategoryPress(category.key)}
          activeOpacity={0.85}
        >
          {previewImage ? (
            <Image source={previewImage} style={styles.categoryImage} resizeMode="contain" />
          ) : (
            <View style={styles.imageFallback}>
              <Feather name="image" size={18} color={Colors.textMuted} />
            </View>
          )}

          <View style={styles.cardTextWrap}>
            <Text style={[styles.cardLabel, isSelected && styles.cardLabelSelected]}>{category.label}</Text>
            <Text style={styles.cardHint}>
              {isSelected ? "Selected • Tap to open pricing dropdown" : "Tap to select category"}
            </Text>
          </View>

          <Feather
            name={isSelected ? (isExpanded ? "chevron-up" : "check-circle") : "plus-circle"}
            size={18}
            color={isSelected ? Colors.primary : Colors.textMuted}
          />
        </TouchableOpacity>

        {isExpanded ? (
          <View style={styles.dropdownPanel}>
            <Text style={styles.dropdownTitle}>Service Name & Price Range</Text>

            {drafts.map((draft, index) => (
              <View key={`${category.key}-${draft.id || "new"}-${index}`} style={styles.serviceBlock}>
                <TextInput
                  style={styles.serviceInput}
                  placeholder="Service name"
                  placeholderTextColor={Colors.textMuted}
                  value={draft.service_name}
                  onChangeText={(value) => updateServiceDraft(category.key, index, "service_name", value)}
                />

                <View style={styles.priceRow}>
                  <TextInput
                    style={[styles.serviceInput, styles.priceInput]}
                    placeholder="Min price"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    value={draft.price_min}
                    onChangeText={(value) => updateServiceDraft(category.key, index, "price_min", value)}
                  />
                  <TextInput
                    style={[styles.serviceInput, styles.priceInput]}
                    placeholder="Max price"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    value={draft.price_max}
                    onChangeText={(value) => updateServiceDraft(category.key, index, "price_max", value)}
                  />
                </View>

                <TouchableOpacity
                  style={styles.removeServiceBtn}
                  onPress={() => removeServiceRow(category.key, index)}
                >
                  <Feather name="trash-2" size={14} color={Colors.error} />
                  <Text style={styles.removeServiceText}>Remove Service</Text>
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity style={styles.addServiceBtn} onPress={() => addServiceRow(category.key)}>
              <Feather name="plus" size={14} color={Colors.primary} />
              <Text style={styles.addServiceText}>Add Another Service</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.removeCategoryBtn} onPress={() => removeCategory(category.key)}>
              <Text style={styles.removeCategoryText}>Remove This Category</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Select Specializations</Text>
        <Text style={styles.subtitle}>
          Choose category, then tap selected category to open dropdown and add service name with price range.
        </Text>

        <Text style={styles.sectionTitle}>Women</Text>
        <View style={styles.categoryList}>{womenCategories.map(renderCategoryCard)}</View>

        <Text style={styles.sectionTitle}>Men</Text>
        <View style={styles.categoryList}>{menCategories.map(renderCategoryCard)}</View>

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

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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

  categoryList: {
    gap: 10,
  },

  categoryCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
  },

  categoryCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + "10",
  },

  categoryImage: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
  },

  imageFallback: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  cardTextWrap: {
    flex: 1,
    marginHorizontal: 10,
  },

  cardLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.text,
  },

  cardLabelSelected: {
    color: Colors.primary,
  },

  cardHint: {
    marginTop: 2,
    fontFamily: Fonts.ui,
    fontSize: 12,
    color: Colors.textMuted,
  },

  dropdownPanel: {
    marginTop: -2,
    marginBottom: 2,
    borderBottomLeftRadius: Radius.lg,
    borderBottomRightRadius: Radius.lg,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: Colors.primary + "45",
    backgroundColor: Colors.surface,
    padding: 12,
  },

  dropdownTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.text,
    marginBottom: 10,
  },

  serviceBlock: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    padding: 10,
    marginBottom: 10,
  },

  serviceInput: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontFamily: Fonts.body,
    color: Colors.text,
    fontSize: 14,
  },

  priceRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },

  priceInput: {
    flex: 1,
  },

  removeServiceBtn: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  removeServiceText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.error,
  },

  addServiceBtn: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary + "50",
    backgroundColor: Colors.primary + "10",
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  addServiceText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.primary,
  },

  removeCategoryBtn: {
    marginTop: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },

  removeCategoryText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.error,
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