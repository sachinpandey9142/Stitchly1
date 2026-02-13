import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

const SPECIALITIES = ['All', 'Blouse', 'Lehenga', 'Men\'s Suit', 'Kurta', 'Alteration', 'Dress', 'Sherwani'];

export default function CustomerHome() {
  const router = useRouter();
  const { user } = useAuth();
  const [tailors, setTailors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('All');

  const fetchTailors = useCallback(async () => {
    try {
      let endpoint = '/tailors?';
      if (selectedSpecialty !== 'All') endpoint += `specialty=${encodeURIComponent(selectedSpecialty)}&`;
      if (search.trim()) endpoint += `search=${encodeURIComponent(search.trim())}&`;
      const data = await api.get(endpoint);
      setTailors(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedSpecialty, search]);

  useEffect(() => { fetchTailors(); }, [fetchTailors]);

  const onRefresh = () => { setRefreshing(true); fetchTailors(); };

  const renderTailor = ({ item }: { item: any }) => (
    <TouchableOpacity testID={`tailor-card-${item.id}`} style={styles.card} activeOpacity={0.7} onPress={() => router.push(`/tailor/${item.id}`)}>
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.tailorName}>{item.name}</Text>
          <View style={styles.ratingRow}>
            <Feather name="star" size={14} color={Colors.secondary} />
            <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
            <Text style={styles.ratingCount}>({item.rating_count})</Text>
          </View>
        </View>
        <View style={styles.priceTag}>
          <Text style={styles.priceFrom}>from</Text>
          <Text style={styles.priceValue}>{'\u20B9'}{item.min_price}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.locationRow}>
          <Feather name="map-pin" size={14} color={Colors.textMuted} />
          <Text style={styles.locationText}>{item.location || 'Location not set'}</Text>
        </View>
        <View style={styles.tagRow}>
          {item.specialities?.slice(0, 3).map((s: string) => (
            <View key={s} style={styles.tag}><Text style={styles.tagText}>{s}</Text></View>
          ))}
        </View>
        <Text style={styles.expText}>{item.experience ? `${item.experience} experience` : ''}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerSection}>
        <View>
          <Text style={styles.greeting}>Hello, {user?.name?.split(' ')[0]}</Text>
          <Text style={styles.headerTitle}>Find Your Tailor</Text>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <Feather name="search" size={20} color={Colors.textMuted} />
        <TextInput
          testID="search-input"
          style={styles.searchInput}
          placeholder="Search tailors..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={fetchTailors}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => { setSearch(''); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        horizontal
        data={SPECIALITIES}
        keyExtractor={(i) => i}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterList}
        renderItem={({ item }) => (
          <TouchableOpacity
            testID={`filter-${item}`}
            style={[styles.filterChip, selectedSpecialty === item && styles.filterChipActive]}
            onPress={() => setSelectedSpecialty(item)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterText, selectedSpecialty === item && styles.filterTextActive]}>{item}</Text>
          </TouchableOpacity>
        )}
      />

      {loading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={tailors}
          keyExtractor={(item) => item.id}
          renderItem={renderTailor}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="scissors" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No tailors found</Text>
              <Text style={styles.emptySubText}>Try adjusting your filters</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerSection: { paddingHorizontal: Spacing.containerPadding, paddingTop: 16, paddingBottom: 8 },
  greeting: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginTop: 2 },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    marginHorizontal: Spacing.containerPadding, paddingHorizontal: 16, height: 48, marginTop: 12,
  },
  searchInput: { flex: 1, fontFamily: Fonts.ui, fontSize: 16, color: Colors.text, marginLeft: 12 },
  filterList: { paddingHorizontal: Spacing.containerPadding, paddingVertical: 14, gap: 8 },
  filterChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  filterTextActive: { color: Colors.textInverted },
  list: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 20 },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.border, padding: 16, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontFamily: Fonts.bodyBold, fontSize: 22, color: Colors.textInverted },
  cardInfo: { flex: 1, marginLeft: 14 },
  tailorName: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.text },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  ratingText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginLeft: 4 },
  ratingCount: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginLeft: 2 },
  priceTag: { alignItems: 'flex-end' },
  priceFrom: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  priceValue: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.primary },
  cardBody: { marginTop: 14 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  locationText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginLeft: 6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  tag: { backgroundColor: Colors.subtle, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.text },
  expText: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 4 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text, marginTop: 16 },
  emptySubText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginTop: 4 },
});
