import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { useAuth } from '../../../src/context/AuthContext';
import { useCustomerDiscovery } from '../../../src/context/CustomerDiscoveryContext';
import { api } from '../../../src/utils/api';
import { Colors, Fonts, Radius, Spacing } from '../../../src/utils/theme';
import {
  getTailorSpecialty,
  sortTailorsByDistance,
  TailorRecord,
} from '../../../src/utils/customerDiscovery';

export default function NearbyTailorsTab() {
  const router = useRouter();
  const { user } = useAuth();
  const { selectedCategory, selectedDesign, setSelectedDesign } = useCustomerDiscovery();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tailors, setTailors] = useState<TailorRecord[]>([]);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);

  const headerSubtitle = useMemo(() => {
    if (selectedDesign && selectedCategory) return `${selectedDesign} specialists near you`;
    if (selectedCategory) return `${selectedCategory} specialists near you`;
    return 'Tailors sorted by your distance';
  }, [selectedCategory, selectedDesign]);

  const requestLocation = useCallback(async (): Promise<{ latitude: number; longitude: number } | null> => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationWarning('Location access denied. Showing city-based results instead.');
        return null;
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocationWarning(null);
      return {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      };
    } catch {
      setLocationWarning('Unable to read your location. Showing city-based results instead.');
      return null;
    }
  }, []);

  const loadTailors = useCallback(async (userCoords: { latitude: number; longitude: number } | null) => {
    const specialty = getTailorSpecialty(selectedCategory, selectedDesign);

    try {
      let endpoint = '/tailors?';
      if (user?.city) endpoint += `city=${encodeURIComponent(user.city)}&`;
      if (specialty) endpoint += `specialty=${encodeURIComponent(specialty)}&`;

      const response = await api.get(endpoint);
      const list = Array.isArray(response) ? response : [];
      setTailors(sortTailorsByDistance(list, userCoords, 100));
    } catch {
      setTailors([]);
    }
  }, [selectedCategory, selectedDesign, user?.city]);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      setLoading(true);
      const coords = await requestLocation();
      if (!mounted) return;

      await loadTailors(coords);
      if (mounted) {
        setLoading(false);
      }
    };

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [requestLocation, loadTailors]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const coords = await requestLocation();
        await loadTailors(coords);
      })();
    }, [requestLocation, loadTailors])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const coords = await requestLocation();
    await loadTailors(coords);
    setRefreshing(false);
  }, [requestLocation, loadTailors]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Nearby Tailors</Text>
        <Text style={styles.subtitle}>{headerSubtitle}</Text>
      </View>

      {selectedDesign ? (
        <View style={styles.filterPillRow}>
          <View style={styles.filterPill}>
            <Text style={styles.filterPillText}>Design: {selectedDesign}</Text>
            <TouchableOpacity onPress={() => setSelectedDesign(null)}>
              <Feather name="x" size={14} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {locationWarning ? (
        <View style={styles.warningBox}>
          <Feather name="alert-circle" size={16} color={Colors.warning} />
          <Text style={styles.warningText}>{locationWarning}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={tailors}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/tailor/${item.id}`)}>
              <View style={styles.cardTop}>
                <Text style={styles.name}>{item.name}</Text>
                {item.distanceKm != null ? <Text style={styles.distance}>{item.distanceKm.toFixed(1)} km</Text> : null}
              </View>
              <Text style={styles.meta}>{item.city || 'Unknown city'}</Text>
              <Text style={styles.specialty}>{(item.specialities || []).join(', ') || 'General tailoring'}</Text>
              {item.rating ? <Text style={styles.rating}>Rating {item.rating.toFixed(1)} / 5</Text> : null}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="map-pin" size={34} color={Colors.border} />
              <Text style={styles.emptyTitle}>No nearby specialists</Text>
              <Text style={styles.emptySubtitle}>Try another design or refresh your location.</Text>
              <TouchableOpacity style={styles.searchButton} onPress={() => router.push('/(customer)/(tabs)/search')}>
                <Text style={styles.searchButtonText}>Go To Search</Text>
              </TouchableOpacity>
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
  subtitle: { marginTop: 4, fontFamily: Fonts.ui, color: Colors.textMuted, fontSize: 14 },
  filterPillRow: { paddingHorizontal: Spacing.containerPadding, marginTop: 8, marginBottom: 4 },
  filterPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary + '45',
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterPillText: { fontFamily: Fonts.body, color: Colors.primary, fontSize: 13 },
  warningBox: {
    marginHorizontal: Spacing.containerPadding,
    marginTop: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
    backgroundColor: Colors.warning + '14',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  warningText: { flex: 1, fontFamily: Fonts.ui, color: Colors.warning, fontSize: 12 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: Spacing.containerPadding, paddingTop: 12, paddingBottom: 22 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontFamily: Fonts.bodyBold, color: Colors.text, fontSize: 16, flex: 1, marginRight: 8 },
  distance: { fontFamily: Fonts.bodyBold, color: Colors.primary, fontSize: 13 },
  meta: { marginTop: 2, fontFamily: Fonts.ui, color: Colors.textMuted, fontSize: 13 },
  specialty: { marginTop: 8, fontFamily: Fonts.body, color: Colors.text, fontSize: 13 },
  rating: { marginTop: 8, fontFamily: Fonts.ui, color: Colors.textMuted, fontSize: 12 },
  emptyState: {
    marginTop: 24,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderColor: Colors.border,
    borderWidth: 1,
    alignItems: 'center',
    padding: 20,
  },
  emptyTitle: { marginTop: 10, fontFamily: Fonts.bodyBold, color: Colors.text, fontSize: 16 },
  emptySubtitle: { marginTop: 4, fontFamily: Fonts.ui, color: Colors.textMuted, fontSize: 13, textAlign: 'center' },
  searchButton: {
    marginTop: 14,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  searchButtonText: { fontFamily: Fonts.bodyBold, color: '#fff', fontSize: 13 },
});
