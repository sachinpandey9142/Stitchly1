import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import { useAuth } from '../../../src/context/AuthContext';
import { useCustomerDiscovery } from '../../../src/context/CustomerDiscoveryContext';
import { api } from '../../../src/utils/api';
import { Colors, Fonts, Radius, Spacing } from '../../../src/utils/theme';
import {
  CATEGORY_CAROUSEL,
  getAllDesigns,
  getCategoryPreviewImage,
  getDesignImage,
  getDesignsForCategory,
  getTailorSpecialty,
  sortTailorsByDistance,
  TailorRecord,
} from '../../../src/utils/customerDiscovery';

type CategoryFilterKey = 'all' | 'men' | 'women';

const CATEGORY_FILTER_OPTIONS: Array<{ key: CategoryFilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'men', label: 'Men' },
  { key: 'women', label: 'Women' },
];

const CATEGORIES_BY_FILTER: Record<CategoryFilterKey, typeof CATEGORY_CAROUSEL> = {
  all: CATEGORY_CAROUSEL,
  men: CATEGORY_CAROUSEL.filter((item) => item.group === 'men'),
  women: CATEGORY_CAROUSEL.filter((item) => item.group === 'women'),
};

export default function CustomerHome() {
  const router = useRouter();
  const { user } = useAuth();
  const { selectedCategory, selectedDesign, setSelectedCategory, setSelectedDesign } = useCustomerDiscovery();

  const [tailors, setTailors] = useState<TailorRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cities, setCities] = useState<string[]>([]);
  const [selectedCity, setSelectedCity] = useState(user?.city || '');
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<CategoryFilterKey>('all');

  const displayedCategories = CATEGORIES_BY_FILTER[selectedCategoryFilter];

  useEffect(() => {
    const firstCategory = displayedCategories[0];
    if (!firstCategory) return;

    const isCurrentCategoryVisible = selectedCategory
      ? displayedCategories.some((item) => item.key === selectedCategory)
      : false;

    if (!isCurrentCategoryVisible) {
      setSelectedCategory(firstCategory.key);
      setSelectedDesign(null);
    }
  }, [displayedCategories, selectedCategory, setSelectedCategory, setSelectedDesign]);

  useEffect(() => {
    let mounted = true;

    const loadCities = async () => {
      try {
        const data = await api.get('/cities');
        if (mounted && Array.isArray(data)) {
          setCities(data);
        }
      } catch {}
    };

    void loadCities();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (user?.city && !selectedCity) {
      setSelectedCity(user.city);
    }
  }, [user, selectedCity]);

  useEffect(() => {
    let mounted = true;

    const getLocation = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') return;

        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!mounted) return;

        setUserCoords({
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        });
      } catch {}
    };

    void getLocation();
    return () => {
      mounted = false;
    };
  }, []);

  const categoryDesigns = useMemo(
    () => {
      if (selectedCategoryFilter === 'all') {
        return getAllDesigns();
      }

      if (!selectedCategory) {
        return [];
      }

      return getDesignsForCategory(selectedCategory).map((design) => ({
        category: selectedCategory,
        design,
      }));
    },
    [selectedCategoryFilter, selectedCategory]
  );

  const specialty = useMemo(
    () => getTailorSpecialty(selectedCategory, selectedDesign),
    [selectedCategory, selectedDesign]
  );

  const selectedCategoryLabel = useMemo(
    () => displayedCategories.find((item) => item.key === selectedCategory)?.label || selectedCategory || '',
    [displayedCategories, selectedCategory]
  );

  const fetchTailors = useCallback(async () => {
    if (!selectedCategory && !selectedDesign) {
      setTailors([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setLoading(true);
    try {
      let endpoint = '/tailors?';
      if (specialty) {
        endpoint += `specialty=${encodeURIComponent(specialty)}&`;
      }
      if (selectedCity) {
        endpoint += `city=${encodeURIComponent(selectedCity)}&`;
      }

      const designKeyword = selectedDesign ? selectedDesign.split(' ')[0] : '';
      if (designKeyword) {
        endpoint += `search=${encodeURIComponent(designKeyword)}&`;
      }

      const data = await api.get(endpoint);
      const sortedTailors = sortTailorsByDistance(Array.isArray(data) ? data : [], userCoords, 40);
      setTailors(sortedTailors);
    } catch {
      setTailors([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCategory, selectedDesign, specialty, selectedCity, userCoords]);

  useEffect(() => {
    void fetchTailors();
  }, [fetchTailors]);

  const onRefresh = () => {
    setRefreshing(true);
    void fetchTailors();
  };

  const renderTailor = ({ item }: { item: TailorRecord }) => (
    <TouchableOpacity
      testID={`home-tailor-${item.id}`}
      style={styles.tailorCard}
      activeOpacity={0.85}
      onPress={() => {
        const categoryQuery = selectedCategory ? `?category=${encodeURIComponent(selectedCategory)}` : '';
        router.push(`/tailor/${item.id}${categoryQuery}`);
      }}
    >
      <View style={styles.tailorCardHeader}>
        <View style={styles.tailorAvatar}>
          <Text style={styles.tailorAvatarText}>{item.name?.charAt(0) || 'T'}</Text>
        </View>

        <View style={styles.tailorInfo}>
          <Text style={styles.tailorName}>{item.name}</Text>
          <Text style={styles.tailorMeta}>
            {item.city || 'Unknown city'}
            {item.distanceKm != null ? ` • ${item.distanceKm.toFixed(1)} km away` : ''}
          </Text>
        </View>

        <View style={styles.priceBadge}>
          <Text style={styles.priceLabel}>from</Text>
          <Text style={styles.priceValue}>{`\u20B9${item.min_price || 0}`}</Text>
        </View>
      </View>

      <View style={styles.tagRow}>
        {(item.specialities || []).slice(0, 3).map((tag) => (
          <View key={`${item.id}-${tag}`} style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );

  const header = (
    <View>
      <View style={styles.headerSection}>
        <Text style={styles.greeting}>Hello, {user?.name?.split(' ')[0] || 'Customer'}</Text>
        <Text style={styles.headerTitle}>Discover Tailors & Designs</Text>
      </View>

      <TouchableOpacity
        testID="home-city-selector"
        style={styles.locationBar}
        onPress={() => setShowCityPicker(true)}
        activeOpacity={0.8}
      >
        <View style={styles.locationLeft}>
          <Feather name="map-pin" size={18} color={Colors.primary} />
          <View style={styles.locationTextWrap}>
            <Text style={styles.locationLabel}>Selected City</Text>
            <Text style={styles.locationValue}>{selectedCity || 'All Cities'}</Text>
          </View>
        </View>
        <Feather name="chevron-down" size={18} color={Colors.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity
        testID="home-ai-tryon-button"
        style={styles.tryOnCard}
        activeOpacity={0.85}
        onPress={() => router.push('/ai-tryon')}
      >
        <View style={styles.tryOnCardLeft}>
          <View style={styles.tryOnBadge}>
            <Feather name="camera" size={18} color={Colors.textInverted} />
          </View>
          <View>
            <Text style={styles.tryOnTitle}>✨ AI Try-On</Text>
            <Text style={styles.tryOnSubtitle}>Live outfit preview with guided framing</Text>
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={Colors.primary} />
      </TouchableOpacity>

      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>Categories</Text>
        <View style={styles.categoryFilterRow}>
          {CATEGORY_FILTER_OPTIONS.map((filter) => {
            const isActive = selectedCategoryFilter === filter.key;

            return (
              <TouchableOpacity
                key={filter.key}
                testID={`home-category-filter-${filter.key}`}
                style={[styles.categoryFilterButton, isActive && styles.categoryFilterButtonActive]}
                activeOpacity={0.85}
                onPress={() => setSelectedCategoryFilter(filter.key)}
              >
                <Text style={[styles.categoryFilterText, isActive && styles.categoryFilterTextActive]}>
                  {filter.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <FlatList
          horizontal
          data={displayedCategories}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.categoryList}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => {
            const previewImage = getCategoryPreviewImage(item.key);
            const isActive = selectedCategory === item.key;

            return (
              <TouchableOpacity
                testID={`home-category-${item.key}`}
                style={[styles.categoryCard, isActive && styles.categoryCardActive]}
                onPress={() => {
                  setSelectedCategory(item.key);
                  setSelectedDesign(null);
                  router.push({
                    pathname: '/(customer)/(tabs)/search',
                    params: { category: item.key },
                  });
                }}
                activeOpacity={0.85}
              >
                {previewImage ? (
                  <Image source={previewImage} style={styles.categoryImage} resizeMode="contain" />
                ) : (
                  <View style={styles.categoryImageFallback}>
                    <Feather name="image" size={18} color={Colors.textMuted} />
                  </View>
                )}
                <Text style={[styles.categoryLabel, isActive && styles.categoryLabelActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>Design Gallery</Text>
        <FlatList
          horizontal
          data={categoryDesigns}
          keyExtractor={(item) => `${item.category}-${item.design}`}
          contentContainerStyle={styles.designList}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => {
            const designImage = getDesignImage(item.category, item.design);
            const isActive = selectedDesign === item.design && selectedCategory === item.category;

            return (
              <TouchableOpacity
                testID={`home-design-${item.category}-${item.design}`}
                style={[styles.designCard, isActive && styles.designCardActive]}
                activeOpacity={0.85}
                onPress={() => {
                  setSelectedCategory(item.category);
                  setSelectedDesign(item.design);
                }}
              >
                {designImage ? (
                  <Image source={designImage} style={styles.designImage} resizeMode="contain" />
                ) : (
                  <View style={styles.designImageFallback}>
                    <Feather name="image" size={18} color={Colors.textMuted} />
                  </View>
                )}
                <Text style={styles.designLabel} numberOfLines={2}>
                  {item.design}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <View style={styles.tailorHeaderRow}>
        <Text style={styles.sectionTitle}>
          {selectedDesign
            ? `Nearby Tailors for ${selectedDesign}`
            : selectedCategory
              ? `Nearby Tailors for ${selectedCategoryLabel}`
              : 'Select a Category to See Nearby Tailors'}
        </Text>
        {selectedCategory ? (
          <TouchableOpacity onPress={() => router.push('/(customer)/(tabs)/nearby-tailors')}>
            <Text style={styles.viewAllLink}>View All</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={selectedCategory ? tailors : []}
        keyExtractor={(item) => item.id}
        renderItem={renderTailor}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : selectedCategory ? (
            <View style={styles.emptyState}>
              <Feather name="scissors" size={40} color={Colors.border} />
              <Text style={styles.emptyTitle}>No matching tailors nearby</Text>
              <Text style={styles.emptySub}>Try another category, design, or city.</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Feather name="image" size={40} color={Colors.border} />
              <Text style={styles.emptyTitle}>Pick a category to continue</Text>
              <Text style={styles.emptySub}>We will show nearby specialist tailors instantly.</Text>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
      />

      <Modal visible={showCityPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose City</Text>
              <TouchableOpacity onPress={() => setShowCityPicker(false)}>
                <Feather name="x" size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.cityOption, !selectedCity && styles.cityOptionActive]}
              onPress={() => {
                setSelectedCity('');
                setShowCityPicker(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.cityText, !selectedCity && styles.cityTextActive]}>All Cities</Text>
              {!selectedCity ? <Feather name="check" size={16} color={Colors.primary} /> : null}
            </TouchableOpacity>

            {cities.map((city) => (
              <TouchableOpacity
                key={city}
                style={[styles.cityOption, selectedCity === city && styles.cityOptionActive]}
                onPress={() => {
                  setSelectedCity(city);
                  setShowCityPicker(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.cityText, selectedCity === city && styles.cityTextActive]}>{city}</Text>
                {selectedCity === city ? <Feather name="check" size={16} color={Colors.primary} /> : null}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  listContent: { paddingBottom: 24 },
  headerSection: {
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: 16,
    paddingBottom: 8,
  },
  greeting: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginTop: 2 },
  locationBar: {
    marginHorizontal: Spacing.containerPadding,
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  locationLeft: { flexDirection: 'row', alignItems: 'center' },
  locationTextWrap: { marginLeft: 10 },
  locationLabel: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  locationValue: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  tryOnCard: {
    marginHorizontal: Spacing.containerPadding,
    marginTop: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tryOnCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tryOnBadge: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tryOnTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  tryOnSubtitle: { marginTop: 1, fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  sectionBlock: { marginTop: 16 },
  sectionTitle: {
    marginHorizontal: Spacing.containerPadding,
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.text,
  },
  categoryFilterRow: {
    marginTop: 10,
    marginHorizontal: Spacing.containerPadding,
    flexDirection: 'row',
    gap: 8,
  },
  categoryFilterButton: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryFilterButtonActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  categoryFilterText: {
    fontFamily: Fonts.body,
    color: Colors.textMuted,
    fontSize: 13,
  },
  categoryFilterTextActive: {
    fontFamily: Fonts.bodyBold,
    color: Colors.textInverted,
  },
  categoryList: {
    paddingHorizontal: Spacing.containerPadding,
    paddingVertical: 12,
    gap: 10,
  },
  categoryCard: {
    width: 138,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 10,
  },
  categoryCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  categoryImage: {
    width: '100%',
    height: 98,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  categoryImageFallback: {
    width: '100%',
    height: 98,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryLabel: {
    marginTop: 8,
    fontFamily: Fonts.body,
    color: Colors.textMuted,
    fontSize: 13,
    width: '100%',
    textAlign: 'center',
  },
  categoryLabelActive: {
    color: Colors.primary,
    fontFamily: Fonts.bodyBold,
  },
  designList: {
    paddingHorizontal: Spacing.containerPadding,
    paddingVertical: 12,
    gap: 10,
  },
  designCard: {
    width: 158,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 10,
  },
  designCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  designImage: {
    width: '100%',
    height: 132,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  designImageFallback: {
    width: '100%',
    height: 132,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  designLabel: {
    marginTop: 8,
    fontFamily: Fonts.body,
    color: Colors.text,
    fontSize: 13,
    width: '100%',
    textAlign: 'center',
  },
  tailorHeaderRow: {
    marginTop: 8,
    marginBottom: 6,
    paddingHorizontal: Spacing.containerPadding,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewAllLink: {
    fontFamily: Fonts.bodyBold,
    color: Colors.primary,
    fontSize: 13,
  },
  tailorCard: {
    marginHorizontal: Spacing.containerPadding,
    marginBottom: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 14,
  },
  tailorCardHeader: { flexDirection: 'row', alignItems: 'center' },
  tailorAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tailorAvatarText: { color: Colors.textInverted, fontFamily: Fonts.bodyBold, fontSize: 18 },
  tailorInfo: { flex: 1, marginLeft: 10 },
  tailorName: { fontFamily: Fonts.bodyBold, color: Colors.text, fontSize: 16 },
  tailorMeta: { fontFamily: Fonts.ui, color: Colors.textMuted, fontSize: 13, marginTop: 2 },
  priceBadge: { alignItems: 'flex-end' },
  priceLabel: { fontFamily: Fonts.ui, fontSize: 11, color: Colors.textMuted },
  priceValue: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.primary },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.subtle,
  },
  tagText: { fontFamily: Fonts.body, color: Colors.text, fontSize: 12 },
  emptyState: {
    marginTop: 18,
    marginHorizontal: Spacing.containerPadding,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: { marginTop: 12, fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.text },
  emptySub: { marginTop: 4, fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: Spacing.containerPadding,
    paddingBottom: 36,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontFamily: Fonts.bodyBold, fontSize: 19, color: Colors.text },
  cityOption: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.subtle,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cityOptionActive: { backgroundColor: Colors.primary + '10' },
  cityText: { fontFamily: Fonts.body, fontSize: 16, color: Colors.text },
  cityTextActive: { fontFamily: Fonts.bodyBold, color: Colors.primary },
});
