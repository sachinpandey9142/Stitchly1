import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';
import { CATEGORY_CAROUSEL, CATEGORY_SPECIALITY_MAP } from '../../src/utils/customerDiscovery';

const formatPriceRangeLabel = (service: any): string => {
  const minPrice = Number(service?.price_min ?? service?.price ?? 0);
  const maxPrice = Number(service?.price_max ?? service?.price ?? minPrice);

  if (!Number.isFinite(minPrice) || minPrice <= 0) return '₹0';
  if (!Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice === minPrice) {
    return `₹${Math.round(minPrice)}`;
  }

  return `₹${Math.round(minPrice)} - ₹${Math.round(maxPrice)}`;
};

const formatComplexityLabel = (value: unknown): string => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

export default function TailorDetail() {
  const { id, category } = useLocalSearchParams<{ id: string; category?: string }>();
  const router = useRouter();
  const [tailor, setTailor] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const selectedCategoryKey = typeof category === 'string' ? category : '';

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get(`/tailors/${id}`);
        setTailor(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const categoryMatcherSet = useMemo(() => {
    if (!selectedCategoryKey) return new Set<string>();

    const categoryItem = CATEGORY_CAROUSEL.find((item) => item.key === selectedCategoryKey);
    const mappedSpeciality = CATEGORY_SPECIALITY_MAP[selectedCategoryKey] || '';

    return new Set(
      [selectedCategoryKey, categoryItem?.label || '', mappedSpeciality]
        .filter(Boolean)
        .map((item) => String(item).toLowerCase())
    );
  }, [selectedCategoryKey]);

  const visibleServices = useMemo(() => {
    const allServices = tailor?.services || [];
    if (categoryMatcherSet.size === 0) return allServices;

    const filtered = allServices.filter((service: any) => {
      const serviceCategory = String(service?.category || '').toLowerCase();
      return categoryMatcherSet.has(serviceCategory);
    });

    return filtered.length > 0 ? filtered : allServices;
  }, [tailor?.services, categoryMatcherSet]);

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!tailor) return <View style={styles.loader}><Text style={styles.errorText}>Tailor not found</Text></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <TouchableOpacity testID="back-btn" style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="arrow-left" size={24} color={Colors.text} />
        </TouchableOpacity>

        <View style={styles.profileSection}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{tailor.name.charAt(0)}</Text></View>
          <Text style={styles.tailorName}>{tailor.name}</Text>
          <View style={styles.ratingRow}>
            <Feather name="star" size={16} color={Colors.secondary} />
            <Text style={styles.ratingText}>{tailor.rating.toFixed(1)}</Text>
            <Text style={styles.ratingCount}>({tailor.rating_count} reviews)</Text>
          </View>
          <View style={styles.metaRow}>
            <Feather name="map-pin" size={14} color={Colors.primary} /><Text style={styles.metaTextBold}>{tailor.city}{tailor.pincode ? `, ${tailor.pincode}` : ''}</Text>
          </View>
          {tailor.address ? <View style={styles.metaRow}><Feather name="home" size={14} color={Colors.textMuted} /><Text style={styles.metaText}>{tailor.address}</Text></View> : null}
          <View style={styles.metaRow}>
            <Feather name="clock" size={14} color={Colors.textMuted} /><Text style={styles.metaText}>{tailor.experience || 'Experience not listed'}</Text>
          </View>
          <View style={styles.tagRow}>
            {tailor.specialities?.map((s: string) => (
              <View key={s} style={styles.tag}><Text style={styles.tagText}>{s}</Text></View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Services & Pricing</Text>
          {visibleServices.map((s: any) => {
            const query = `service=${encodeURIComponent(s.service_name)}&serviceId=${encodeURIComponent(s.id)}`;
            const categoryQuery = selectedCategoryKey ? `&category=${encodeURIComponent(selectedCategoryKey)}` : '';

            return (
              <TouchableOpacity
                key={s.id}
                testID={`service-${s.id}`}
                style={styles.serviceRow}
                activeOpacity={0.7}
                onPress={() => router.push(`/place-order/${id}?${query}${categoryQuery}`)}
              >
                <View style={styles.serviceInfo}>
                  <Text style={styles.serviceName}>{s.service_name}</Text>
                  <Text style={styles.serviceCategory}>
                    {s.category}
                    {formatComplexityLabel(s.complexity) ? ` • ${formatComplexityLabel(s.complexity)}` : ''}
                  </Text>
                </View>
                <Text style={styles.servicePrice}>{formatPriceRangeLabel(s)}</Text>
                <Feather name="chevron-right" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            );
          })}
          {visibleServices.length === 0 && <Text style={styles.emptyText}>No services listed</Text>}
        </View>

        {tailor.reviews?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reviews</Text>
            {tailor.reviews.map((r: any) => (
              <View key={r.id} style={styles.reviewRow}>
                <View style={styles.reviewHeader}>
                  <Text style={styles.reviewName}>{r.customer_name}</Text>
                  <View style={styles.starsRow}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Feather key={i} name="star" size={14} color={i < r.rating ? Colors.secondary : Colors.border} />
                    ))}
                  </View>
                </View>
                <Text style={styles.reviewComment}>{r.comment}</Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity testID="place-order-btn" style={styles.orderBtn} onPress={() => router.push(`/place-order/${id}`)} activeOpacity={0.7}>
          <Feather name="plus-circle" size={20} color={Colors.textInverted} />
          <Text style={styles.orderBtnText}>Place Order</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  errorText: { fontFamily: Fonts.body, fontSize: 16, color: Colors.error },
  backBtn: { width: 44, height: 44, justifyContent: 'center', paddingLeft: Spacing.containerPadding, marginTop: 8 },
  profileSection: { alignItems: 'center', paddingHorizontal: Spacing.containerPadding, paddingTop: 8 },
  avatar: { width: 90, height: 90, borderRadius: 45, backgroundColor: Colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  avatarText: { fontFamily: Fonts.heading, fontSize: 36, color: Colors.textInverted },
  tailorName: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  ratingText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text, marginLeft: 6 },
  ratingCount: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginLeft: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  metaText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginLeft: 6 },
  metaTextBold: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.primary, marginLeft: 6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  tag: { backgroundColor: Colors.primary + '15', borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 5 },
  tagText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.primary },
  section: { marginHorizontal: Spacing.containerPadding, marginTop: 24, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16 },
  sectionTitle: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text, marginBottom: 14 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.subtle },
  serviceInfo: { flex: 1 },
  serviceName: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  serviceCategory: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted },
  servicePrice: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.primary, marginRight: 8 },
  reviewRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.subtle },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewName: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  starsRow: { flexDirection: 'row', gap: 2 },
  reviewComment: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginTop: 6 },
  emptyText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, textAlign: 'center', paddingVertical: 16 },
  orderBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16, marginHorizontal: Spacing.containerPadding, marginTop: 24, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  orderBtnText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.textInverted, marginLeft: 8 },
});
