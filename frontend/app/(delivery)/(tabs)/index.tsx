import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import MapView, { Marker, Polyline, UrlTile, PROVIDER_DEFAULT } from 'react-native-maps';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { api } from '../../../src/utils/api';
import { useAuth } from '../../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius, STATUS_COLORS, STATUS_LABELS } from '../../../src/utils/theme';

type GeoPoint = { type: 'Point'; coordinates: [number, number] };
type RoutePoint = { latitude: number; longitude: number };
type DeliveryOrder = {
  id: string;
  status: string;
  delivery_phase?: 'pickup' | 'return' | '';
  service_type: string;
  customer_name: string;
  tailor_name: string;
  pickup_address: string;
  delivery_address: string;
  customer_address?: string;
  tailor_address?: string;
  customer_geo_location?: GeoPoint | null;
  tailor_geo_location?: GeoPoint | null;
  delivery_partner_geo_location?: GeoPoint | null;
};

type RouteSummary = {
  coordinates: RoutePoint[];
  distanceKm: number;
  durationMinutes: number;
};

const REFRESH_INTERVAL_MS = 15000;
const LOCATION_UPDATE_INTERVAL_MS = 30000;

function getPoint(geoLocation?: GeoPoint | null): RoutePoint | null {
  if (!geoLocation || geoLocation.type !== 'Point' || geoLocation.coordinates.length !== 2) {
    return null;
  }
  return {
    latitude: geoLocation.coordinates[1],
    longitude: geoLocation.coordinates[0],
  };
}

function getNextAction(order: DeliveryOrder) {
  if (order.status === 'pickup_assigned' || order.status === 'delivery_assigned') {
    return { label: 'Review Assignment', type: 'review' as const };
  }
  if (order.status === 'delivery_accepted') {
    return {
      label: order.delivery_phase === 'return' ? 'Out for Delivery' : 'Mark Picked Up',
      type: 'advance' as const,
      nextStatus: order.delivery_phase === 'return' ? 'out_for_delivery' : 'picked_up',
    };
  }
  if (order.status === 'picked_up') {
    return { label: 'Delivered to Tailor', type: 'advance' as const, nextStatus: 'delivered_to_tailor' };
  }
  if (order.status === 'out_for_delivery') {
    return { label: 'Mark Delivered', type: 'advance' as const, nextStatus: 'delivered' };
  }
  return null;
}

async function fetchRoute(order: DeliveryOrder): Promise<RouteSummary | null> {
  const driverPoint = getPoint(order.delivery_partner_geo_location);
  const customerPoint = getPoint(order.customer_geo_location);
  const tailorPoint = getPoint(order.tailor_geo_location);
  if (!driverPoint || !customerPoint || !tailorPoint) {
    return null;
  }

  const waypoints = order.delivery_phase === 'return'
    ? [driverPoint, tailorPoint, customerPoint]
    : [driverPoint, customerPoint, tailorPoint];

  const coordinatesParam = waypoints
    .map((point) => `${point.longitude},${point.latitude}`)
    .join(';');
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordinatesParam}?overview=full&geometries=geojson`
  );
  const data = await response.json();
  const route = data?.routes?.[0];
  if (!route) {
    return null;
  }

  return {
    coordinates: route.geometry.coordinates.map((coordinate: [number, number]) => ({
      latitude: coordinate[1],
      longitude: coordinate[0],
    })),
    distanceKm: route.distance / 1000,
    durationMinutes: route.duration / 60,
  };
}

function buildRouteMapHtml(
  driverPoint: RoutePoint | null,
  customerPoint: RoutePoint | null,
  tailorPoint: RoutePoint | null,
  routeCoordinates: RoutePoint[]
) {
  const markers = [
    driverPoint ? { label: 'Driver', color: '#0F766E', point: driverPoint } : null,
    customerPoint ? { label: 'Customer', color: '#D97706', point: customerPoint } : null,
    tailorPoint ? { label: 'Tailor', color: '#15803D', point: tailorPoint } : null,
  ].filter(Boolean) as Array<{ label: string; color: string; point: RoutePoint }>;

  const routeLatLng = routeCoordinates.map((point) => [point.latitude, point.longitude]);
  const boundsLatLng = routeLatLng.length > 1
    ? routeLatLng
    : markers.map((marker) => [marker.point.latitude, marker.point.longitude]);

  const markerScript = markers
    .map(
      (marker) =>
        `L.circleMarker([${marker.point.latitude}, ${marker.point.longitude}], { radius: 7, color: '${marker.color}', fillColor: '${marker.color}', fillOpacity: 1 }).addTo(map).bindTooltip(${JSON.stringify(marker.label)});`
    )
    .join('\n');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; }
      .leaflet-control-attribution { font-size: 10px; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      (function () {
        var map = L.map('map').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

        ${markerScript}

        var routeCoords = ${JSON.stringify(routeLatLng)};
        if (routeCoords.length > 1) {
          L.polyline(routeCoords, { color: '#0F766E', weight: 4 }).addTo(map);
        }

        var boundsCoords = ${JSON.stringify(boundsLatLng)};
        if (boundsCoords.length > 0) {
          map.fitBounds(boundsCoords, { padding: [30, 30] });
        }
      })();
    </script>
  </body>
</html>`;
}

export default function DeliveryDashboard() {
  const { user, refreshUser } = useAuth();
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<DeliveryOrder | null>(null);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);
  const mapRef = useRef<MapView | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const data = await api.get('/delivery/assignments');
      setOrders(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const sendDriverLocation = useCallback(async () => {
  try {
    // Check if location services are enabled
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      console.log("Location services disabled");
      return;
    }

    // Ask permission
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      console.log("Location permission denied");
      return;
    }

    // Try to get last known location first (works better in emulator)
    let location = await Location.getLastKnownPositionAsync();

    if (!location) {
      location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
    }

    if (!location) {
      console.log("No location available yet");
      return;
    }

    await api.put("/delivery/location", {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    });

  } catch (error) {
    console.log("Location error:", error);
  }
}, []);

  useFocusEffect(
  useCallback(() => {
    let isActive = true;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    let locationTimer: ReturnType<typeof setInterval> | null = null;

    const activateDashboard = async () => {
      try {
        await api.put('/delivery/availability', { is_available: true });
      } catch (err) {
        console.error(err);
      }

      if (!isActive) return;

      await sendDriverLocation();
      await fetchOrders();

      refreshTimer = setInterval(fetchOrders, REFRESH_INTERVAL_MS);
      locationTimer = setInterval(sendDriverLocation, LOCATION_UPDATE_INTERVAL_MS);
    };

    activateDashboard();

    return () => {
      isActive = false;

      if (refreshTimer) clearInterval(refreshTimer);
      if (locationTimer) clearInterval(locationTimer);

      api.put('/delivery/availability', { is_available: false })
        .catch(console.error);
    };
  }, [fetchOrders, sendDriverLocation])
);

  const openAssignmentReview = useCallback(async (order: DeliveryOrder) => {
    setSelectedOrder(order);
    setReviewVisible(true);
    setRouteLoading(true);
    setRouteSummary(null);
    try {
      const summary = await fetchRoute(order);
      setRouteSummary(summary);
      const points = [
        getPoint(order.delivery_partner_geo_location),
        getPoint(order.customer_geo_location),
        getPoint(order.tailor_geo_location),
      ].filter(Boolean) as RoutePoint[];
      if (Platform.OS !== 'android' && points.length > 1 && mapRef.current) {
        setTimeout(() => {
          mapRef.current?.fitToCoordinates(points, {
            edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
            animated: true,
          });
        }, 250);
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Route Error', 'Unable to load the route preview right now.');
    } finally {
      setRouteLoading(false);
    }
  }, []);

  const closeReview = useCallback(() => {
    setReviewVisible(false);
    setSelectedOrder(null);
    setRouteSummary(null);
  }, []);

  const handleConfirmOrder = useCallback(async () => {
    if (!selectedOrder) {
      return;
    }
    try {
      await api.put(`/delivery/${selectedOrder.id}/accept`, {});
      closeReview();
      await fetchOrders();
      Alert.alert('Success', 'Delivery assigned successfully');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Unable to accept this order');
    }
  }, [closeReview, fetchOrders, selectedOrder]);

  const handleRejectOrder = useCallback(async () => {
    if (!selectedOrder) {
      return;
    }
    try {
      await api.put(`/delivery/${selectedOrder.id}/decline`, {});
      closeReview();
      await fetchOrders();
      Alert.alert('Updated', 'Assignment declined');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Unable to decline this order');
    }
  }, [closeReview, fetchOrders, selectedOrder]);

  const handleAdvance = useCallback(async (order: DeliveryOrder, nextStatus: string) => {
    try {
      await api.put(`/delivery/${order.id}/update`, { status: nextStatus });
      await fetchOrders();
      Alert.alert('Success', `Status updated to ${STATUS_LABELS[nextStatus] || nextStatus}`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Unable to update delivery status');
    }
  }, [fetchOrders]);

  const renderOrder = ({ item }: { item: DeliveryOrder }) => {
    const action = getNextAction(item);
    const fromAddress = item.delivery_phase === 'return' ? (item.tailor_address || item.tailor_name) : item.pickup_address;
    const toAddress = item.delivery_phase === 'return' ? item.delivery_address : (item.tailor_address || item.tailor_name);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardInfo}>
            <Text style={styles.serviceType}>{item.service_type}</Text>
            <Text style={styles.names}>{item.customer_name} {'->'} {item.tailor_name}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[item.status] || Colors.textMuted) + '18' }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] || Colors.textMuted }]}>
              {STATUS_LABELS[item.status] || item.status}
            </Text>
          </View>
        </View>
        <View style={styles.addressSection}>
          <View style={styles.addressRow}>
            <Feather name="map-pin" size={14} color={Colors.info} />
            <Text style={styles.addressText}>From: {fromAddress}</Text>
          </View>
          <View style={styles.addressRow}>
            <Feather name="navigation" size={14} color={Colors.success} />
            <Text style={styles.addressText}>To: {toAddress}</Text>
          </View>
        </View>
        {action && (
          <TouchableOpacity
            testID={`delivery-action-${item.id}`}
            style={styles.updateBtn}
            onPress={() => action.type === 'review' ? openAssignmentReview(item) : handleAdvance(item, action.nextStatus)}
            activeOpacity={0.7}
          >
            <Feather name={action.type === 'review' ? 'map' : 'arrow-right-circle'} size={18} color={Colors.textInverted} />
            <Text style={styles.updateText}>{action.label}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const driverPoint = getPoint(selectedOrder?.delivery_partner_geo_location);
  const customerPoint = getPoint(selectedOrder?.customer_geo_location);
  const tailorPoint = getPoint(selectedOrder?.tailor_geo_location);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerSection}>
        <Text style={styles.greeting}>Hello, {user?.name}</Text>
        <Text style={styles.headerTitle}>Active Deliveries</Text>
      </View>
      {loading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                fetchOrders();
              }}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="truck" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No active deliveries</Text>
            </View>
          }
        />
      )}

      <Modal visible={reviewVisible} animationType="slide" transparent onRequestClose={closeReview}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Delivery Route</Text>
              <TouchableOpacity onPress={closeReview} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="x" size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.mapContainer}>
              {selectedOrder ? (
                Platform.OS === 'android' ? (
                  <WebView
                    originWhitelist={['*']}
                    source={{ html: buildRouteMapHtml(driverPoint, customerPoint, tailorPoint, routeSummary?.coordinates || []) }}
                    javaScriptEnabled
                    domStorageEnabled
                    mixedContentMode="always"
                    style={styles.map}
                  />
                ) : (
                  <MapView
                    ref={mapRef}
                    provider={PROVIDER_DEFAULT}
                    mapType="none"
                    style={styles.map}
                    initialRegion={{ latitude: 20.5937, longitude: 78.9629, latitudeDelta: 8, longitudeDelta: 8 }}
                  >
                    <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} />
                    {driverPoint ? <Marker coordinate={driverPoint} title="Driver" pinColor={Colors.primary} /> : null}
                    {customerPoint ? <Marker coordinate={customerPoint} title="Customer" pinColor={Colors.secondary} /> : null}
                    {tailorPoint ? <Marker coordinate={tailorPoint} title="Tailor" pinColor={Colors.success} /> : null}
                    {routeSummary?.coordinates?.length ? (
                      <Polyline coordinates={routeSummary.coordinates} strokeColor={Colors.primary} strokeWidth={4} />
                    ) : null}
                  </MapView>
                )
              ) : null}
              {routeLoading ? (
                <View style={styles.routeLoadingOverlay}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={styles.routeLoadingText}>Loading route...</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.routeSummaryRow}>
              <View style={styles.routeMetric}>
                <Text style={styles.routeMetricLabel}>Distance</Text>
                <Text style={styles.routeMetricValue}>{routeSummary ? `${routeSummary.distanceKm.toFixed(1)} km` : 'Unavailable'}</Text>
              </View>
              <View style={styles.routeMetric}>
                <Text style={styles.routeMetricLabel}>ETA</Text>
                <Text style={styles.routeMetricValue}>{routeSummary ? `${Math.ceil(routeSummary.durationMinutes)} min` : 'Unavailable'}</Text>
              </View>
            </View>
            <View style={styles.modalActionRow}>
              <TouchableOpacity style={styles.modalRejectBtn} onPress={handleRejectOrder} activeOpacity={0.7}>
                <Text style={styles.modalRejectText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={handleConfirmOrder} activeOpacity={0.7}>
                <Text style={styles.modalConfirmText}>Confirm Order</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerSection: { paddingHorizontal: Spacing.containerPadding, paddingTop: 16, paddingBottom: 8 },
  greeting: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginTop: 2 },
  list: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 20 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardInfo: { flex: 1 },
  serviceType: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  names: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  statusBadge: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 },
  statusText: { fontFamily: Fonts.bodyBold, fontSize: 12 },
  addressSection: { marginTop: 12, backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 12 },
  addressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  addressText: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.text, marginLeft: 8, flex: 1 },
  updateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 14, marginTop: 14 },
  updateText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.textInverted, marginLeft: 8 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text, marginTop: 16 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(28, 25, 23, 0.45)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text },
  mapContainer: { height: 260, backgroundColor: Colors.subtle },
  map: { flex: 1 },
  routeLoadingOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.85)' },
  routeLoadingText: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 8 },
  routeSummaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  routeMetric: { flex: 1, backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 12 },
  routeMetricLabel: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  routeMetricValue: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text, marginTop: 4 },
  modalActionRow: { flexDirection: 'row', padding: 16, gap: 12 },
  modalRejectBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full, paddingVertical: 14, borderWidth: 1, borderColor: Colors.error + '30', backgroundColor: Colors.error + '08' },
  modalRejectText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.error },
  modalConfirmBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full, paddingVertical: 14, backgroundColor: Colors.primary },
  modalConfirmText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.textInverted },
});
