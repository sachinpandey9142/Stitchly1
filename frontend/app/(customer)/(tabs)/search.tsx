import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '../../../src/context/AuthContext';
import { useCustomerDiscovery } from '../../../src/context/CustomerDiscoveryContext';
import { api } from '../../../src/utils/api';
import { Colors, Fonts, Radius, Spacing } from '../../../src/utils/theme';
import {
  getAllDesigns,
  getTailorSpecialty,
  sortTailorsByDistance,
  TailorRecord,
} from '../../../src/utils/customerDiscovery';

export default function CustomerSearch() {
  const router = useRouter();
  const { category } = useLocalSearchParams<{ category?: string }>();
  const { user } = useAuth();
  const { selectedCategory, setSelectedCategory, setSelectedDesign } = useCustomerDiscovery();

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [tailors, setTailors] = useState<TailorRecord[]>([]);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);

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

  const designMatches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    return getAllDesigns().filter((item) => item.design.toLowerCase().includes(normalized)).slice(0, 20);
  }, [query]);

  useEffect(() => {
    if (typeof category !== 'string' || !category) return;
    if (category !== selectedCategory) {
      setSelectedCategory(category);
    }
  }, [category, selectedCategory, setSelectedCategory]);

  useEffect(() => {
    let mounted = true;

    const fetchTailors = async () => {
      const normalized = query.trim();
      if (!normalized && !selectedCategory) {
        setTailors([]);
        return;
      }

      setLoading(true);
      try {
        let endpoint = '/tailors?';
        if (user?.city) {
          endpoint += `city=${encodeURIComponent(user.city)}&`;
        }

        const specialty = getTailorSpecialty(selectedCategory, normalized || null);
        if (specialty) {
          endpoint += `specialty=${encodeURIComponent(specialty)}&`;
        }

        if (normalized) {
          endpoint += `search=${encodeURIComponent(normalized)}&`;
        }

        const data = await api.get(endpoint);
        if (!mounted) return;

        setTailors(sortTailorsByDistance(Array.isArray(data) ? data : [], userCoords, 50));
      } catch {
        if (mounted) setTailors([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void fetchTailors();
    return () => {
      mounted = false;
    };
  }, [query, selectedCategory, user?.city, userCoords]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <Text style={styles.subtitle}>Find tailors or designs quickly</Text>
      </View>

      <View style={styles.searchBox}>
        <Feather name="search" size={18} color={Colors.textMuted} />
        <TextInput
          testID="customer-search-input"
          style={styles.searchInput}
          placeholder="Search tailors or designs"
          placeholderTextColor={Colors.textMuted}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {selectedCategory ? (
        <View style={styles.activeFilterRow}>
          <Text style={styles.activeFilterText}>Category: {selectedCategory}</Text>
          <TouchableOpacity onPress={() => setSelectedCategory(null)}>
            <Text style={styles.clearFilter}>Clear</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {designMatches.length > 0 ? (
        <View style={styles.designSection}>
          <Text style={styles.sectionTitle}>Matching Designs</Text>
          <FlatList
            data={designMatches}
            horizontal
            keyExtractor={(item) => `${item.category}-${item.design}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.designList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.designChip}
                onPress={() => {
                  setSelectedCategory(item.category);
                  setSelectedDesign(item.design);
                  router.push('/(customer)/(tabs)/nearby-tailors');
                }}
              >
                <Text style={styles.designChipText}>{item.design}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      ) : null}

      <View style={styles.resultsHeader}>
        <Text style={styles.sectionTitle}>Tailor Results</Text>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={tailors}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.resultsList}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.tailorCard} onPress={() => router.push(`/tailor/${item.id}`)}>
              <Text style={styles.tailorName}>{item.name}</Text>
              <Text style={styles.tailorMeta}>
                {item.city || 'Unknown city'}
                {item.distanceKm != null ? ` • ${item.distanceKm.toFixed(1)} km away` : ''}
              </Text>
              <Text style={styles.tailorSpecialty}>{(item.specialities || []).join(', ') || 'General tailoring'}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="search" size={36} color={Colors.border} />
              <Text style={styles.emptyTitle}>No results yet</Text>
              <Text style={styles.emptySub}>Try another keyword or category.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.containerPadding, paddingTop: 16, paddingBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text },
  subtitle: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginTop: 4 },
  searchBox: {
    marginHorizontal: Spacing.containerPadding,
    marginTop: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, marginLeft: 10, fontFamily: Fonts.body, fontSize: 15, color: Colors.text },
  activeFilterRow: {
    marginHorizontal: Spacing.containerPadding,
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activeFilterText: { fontFamily: Fonts.bodyBold, color: Colors.primary, fontSize: 13 },
  clearFilter: { fontFamily: Fonts.bodyBold, color: Colors.textMuted, fontSize: 13 },
  designSection: { marginTop: 14 },
  sectionTitle: {
    marginHorizontal: Spacing.containerPadding,
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.text,
  },
  designList: { paddingHorizontal: Spacing.containerPadding, paddingVertical: 10, gap: 8 },
  designChip: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary + '50',
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  designChipText: { fontFamily: Fonts.body, color: Colors.primary, fontSize: 13 },
  resultsHeader: { marginTop: 4 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  resultsList: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 20, paddingTop: 10 },
  tailorCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
  },
  tailorName: { fontFamily: Fonts.bodyBold, color: Colors.text, fontSize: 16 },
  tailorMeta: { marginTop: 2, fontFamily: Fonts.ui, color: Colors.textMuted, fontSize: 13 },
  tailorSpecialty: { marginTop: 6, fontFamily: Fonts.body, color: Colors.text, fontSize: 13 },
  empty: {
    marginTop: 24,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
  },
  emptyTitle: { marginTop: 10, fontFamily: Fonts.bodyBold, color: Colors.text, fontSize: 16 },
  emptySub: { marginTop: 4, fontFamily: Fonts.ui, color: Colors.textMuted, fontSize: 13 },
});
