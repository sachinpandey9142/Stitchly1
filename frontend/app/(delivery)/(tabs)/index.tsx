import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  FlatList,
  ScrollView,
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
  pickup_geo_location?: GeoPoint | null;
  customer_geo_location?: GeoPoint | null;
  tailor_geo_location?: GeoPoint | null;
  delivery_partner_geo_location?: GeoPoint | null;
  measurement_type?: 'ai' | 'manual' | 'expert' | string;
  send_reference_cloth?: boolean;
  reference_cloth_note?: string;
  pickup_measurement_received?: boolean;
  pickup_measurement_note?: string;
  pickup_measurements?: Record<string, number>;
  pickup_reference_cloth_received?: boolean;
  pickup_reference_cloth_note?: string;
};

type RouteSummary = {
  coordinates: RoutePoint[];
  distanceKm: number;
  durationMinutes: number;
};

type DeliveryAction =
  | { label: string; type: 'review' }
  | { label: string; type: 'navigate' }
  | { label: string; type: 'advance'; nextStatus: string };

type NavigationTarget = {
  point: RoutePoint | null;
  label: string;
  nextStatus: string;
  buttonLabel: string;
  nearThresholdMeters: number;
};

const REFRESH_INTERVAL_MS = 15000;
const LOCATION_UPDATE_INTERVAL_MS = 30000;
const EXPERT_MEASUREMENT_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'shoulder_cm', label: 'Shoulder', placeholder: 'Shoulder in cm' },
  { key: 'chest_cm', label: 'Chest/Bust', placeholder: 'Chest in cm' },
  { key: 'waist_cm', label: 'Waist', placeholder: 'Waist in cm' },
  { key: 'hip_cm', label: 'Hip', placeholder: 'Hip in cm' },
  { key: 'sleeve_cm', label: 'Sleeve Length', placeholder: 'Sleeve in cm' },
  { key: 'inseam_cm', label: 'Inseam/Leg', placeholder: 'Inseam in cm' },
  { key: 'neck_cm', label: 'Neck', placeholder: 'Neck in cm' },
];

function getPoint(geoLocation?: GeoPoint | null): RoutePoint | null {
  if (!geoLocation || geoLocation.type !== 'Point' || geoLocation.coordinates.length !== 2) {
    return null;
  }
  return {
    latitude: geoLocation.coordinates[1],
    longitude: geoLocation.coordinates[0],
  };
}

function getPickupPoint(order: DeliveryOrder): RoutePoint | null {
  return getPoint(order.pickup_geo_location) || getPoint(order.customer_geo_location);
}

function getNextAction(order: DeliveryOrder): DeliveryAction | null {
  if (order.status === 'pickup_assigned' || order.status === 'delivery_assigned') {
    return { label: 'Review Assignment', type: 'review' };
  }
  if (order.status === 'delivery_accepted') {
    return { label: 'Open Navigation', type: 'navigate' };
  }
  if (order.status === 'picked_up') {
    return { label: 'Navigate to Tailor', type: 'navigate' };
  }
  if (order.status === 'out_for_delivery') {
    return { label: 'Navigate to Customer', type: 'navigate' };
  }
  return null;
}

function getNavigationTarget(order: DeliveryOrder): NavigationTarget | null {
  const pickupPoint = getPickupPoint(order);
  const customerPoint = getPoint(order.customer_geo_location);
  const tailorPoint = getPoint(order.tailor_geo_location);

  if (order.status === 'delivery_accepted' && order.delivery_phase === 'pickup') {
    return {
      point: pickupPoint,
      label: 'Customer Pickup Point',
      nextStatus: 'picked_up',
      buttonLabel: 'Mark as Received',
      nearThresholdMeters: 120,
    };
  }

  if (order.status === 'delivery_accepted' && order.delivery_phase === 'return') {
    return {
      point: tailorPoint,
      label: 'Tailor Pickup Point',
      nextStatus: 'out_for_delivery',
      buttonLabel: 'Mark Picked from Tailor',
      nearThresholdMeters: 120,
    };
  }

  if (order.status === 'out_for_delivery') {
    return {
      point: customerPoint,
      label: 'Customer Drop Point',
      nextStatus: 'delivered',
      buttonLabel: 'Mark Delivered',
      nearThresholdMeters: 120,
    };
  }

  if (order.status === 'picked_up') {
    return {
      point: tailorPoint,
      label: 'Tailor Drop Point',
      nextStatus: 'delivered_to_tailor',
      buttonLabel: 'Mark Received at Tailor',
      nearThresholdMeters: 120,
    };
  }

  return null;
}

function haversineDistanceMeters(first: RoutePoint, second: RoutePoint): number {
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);
  const earthRadius = 6371000;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const latitudeFirst = toRadians(first.latitude);
  const latitudeSecond = toRadians(second.latitude);

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(latitudeFirst) * Math.cos(latitudeSecond) * Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

async function fetchRouteSummary(waypoints: RoutePoint[]): Promise<RouteSummary | null> {
  if (waypoints.length < 2) {
    return null;
  }

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

async function fetchReviewRoute(order: DeliveryOrder, driverOverride?: RoutePoint | null): Promise<RouteSummary | null> {
  const driverPoint = driverOverride || getPoint(order.delivery_partner_geo_location);
  if (!driverPoint) {
    return null;
  }

  if (order.delivery_phase === 'pickup') {
    const pickupPoint = getPickupPoint(order);
    if (!pickupPoint) {
      return null;
    }
    return fetchRouteSummary([driverPoint, pickupPoint]);
  }

  const tailorPoint = getPoint(order.tailor_geo_location);
  if (!tailorPoint) {
    return null;
  }

  return fetchRouteSummary([driverPoint, tailorPoint]);
}

async function fetchNavigationRoute(order: DeliveryOrder, driverOverride?: RoutePoint | null): Promise<RouteSummary | null> {
  const target = getNavigationTarget(order);
  const driverPoint = driverOverride || getPoint(order.delivery_partner_geo_location);
  if (!target?.point || !driverPoint) {
    return null;
  }
  return fetchRouteSummary([driverPoint, target.point]);
}

function measurementTypeLabel(type?: string): string {
  if (type === 'ai') return 'AI Measurement';
  if (type === 'expert') return 'Expert Measurement';
  return 'Self Measurement';
}

function getInitialExpertMeasurements(existing?: Record<string, number>): Record<string, string> {
  const initial: Record<string, string> = {};
  for (const field of EXPERT_MEASUREMENT_FIELDS) {
    const value = existing?.[field.key];
    initial[field.key] = Number.isFinite(value) ? String(value) : '';
  }
  return initial;
}

function buildExpertMeasurementPayload(values: Record<string, string>): Record<string, number> {
  const payload: Record<string, number> = {};
  for (const field of EXPERT_MEASUREMENT_FIELDS) {
    const raw = String(values[field.key] || '').trim();
    if (!raw) continue;
    const numericValue = Number(raw);
    if (!Number.isFinite(numericValue) || numericValue <= 0) continue;
    payload[field.key] = Number(numericValue.toFixed(2));
  }
  return payload;
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
  ].filter(Boolean) as { label: string; color: string; point: RoutePoint }[];

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
  const { user } = useAuth();
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [driverLocation, setDriverLocation] = useState<RoutePoint | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<DeliveryOrder | null>(null);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [navigationVisible, setNavigationVisible] = useState(false);
  const [navigationOrder, setNavigationOrder] = useState<DeliveryOrder | null>(null);
  const [navigationRouteSummary, setNavigationRouteSummary] = useState<RouteSummary | null>(null);
  const [navigationRouteLoading, setNavigationRouteLoading] = useState(false);
  const [savingPickupDetails, setSavingPickupDetails] = useState(false);
  const [pickupMeasurementReceived, setPickupMeasurementReceived] = useState(false);
  const [pickupMeasurementNote, setPickupMeasurementNote] = useState('');
  const [pickupReferenceClothReceived, setPickupReferenceClothReceived] = useState(false);
  const [pickupReferenceClothNote, setPickupReferenceClothNote] = useState('');
  const [expertMeasurements, setExpertMeasurements] = useState<Record<string, string>>(() => getInitialExpertMeasurements());
  const reviewMapRef = useRef<MapView | null>(null);
  const navigationMapRef = useRef<MapView | null>(null);

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

    setDriverLocation({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    });

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
    setPickupMeasurementReceived(Boolean(order.pickup_measurement_received));
    setPickupMeasurementNote(order.pickup_measurement_note || '');
    setPickupReferenceClothReceived(Boolean(order.pickup_reference_cloth_received));
    setPickupReferenceClothNote(order.pickup_reference_cloth_note || '');
    setExpertMeasurements(getInitialExpertMeasurements(order.pickup_measurements));
    try {
      const summary = await fetchReviewRoute(order, driverLocation);
      setRouteSummary(summary);

      const driverPoint = driverLocation || getPoint(order.delivery_partner_geo_location);
      const destinationPoint = order.delivery_phase === 'pickup'
        ? getPickupPoint(order)
        : getPoint(order.tailor_geo_location);
      const points = [
        driverPoint,
        destinationPoint,
      ].filter(Boolean) as RoutePoint[];
      if (Platform.OS !== 'android' && points.length > 1 && reviewMapRef.current) {
        setTimeout(() => {
          reviewMapRef.current?.fitToCoordinates(points, {
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
  }, [driverLocation]);

  const closeReview = useCallback(() => {
    setReviewVisible(false);
    setSelectedOrder(null);
    setRouteSummary(null);
    setPickupMeasurementReceived(false);
    setPickupMeasurementNote('');
    setPickupReferenceClothReceived(false);
    setPickupReferenceClothNote('');
    setExpertMeasurements(getInitialExpertMeasurements());
  }, []);

  const closeNavigation = useCallback(() => {
    setNavigationVisible(false);
    setNavigationOrder(null);
    setNavigationRouteSummary(null);
    setNavigationRouteLoading(false);
  }, []);

  const openNavigation = useCallback(async (order: DeliveryOrder) => {
    const normalizedOrder: DeliveryOrder = driverLocation
      ? {
          ...order,
          delivery_partner_geo_location: {
            type: 'Point',
            coordinates: [driverLocation.longitude, driverLocation.latitude],
          },
        }
      : order;

    const target = getNavigationTarget(normalizedOrder);
    if (!target?.point) {
      Alert.alert('Navigation unavailable', 'No destination is available for this delivery status.');
      return;
    }

    setNavigationOrder(normalizedOrder);
    setNavigationVisible(true);
    setNavigationRouteLoading(true);
    setNavigationRouteSummary(null);

    try {
      const summary = await fetchNavigationRoute(normalizedOrder, driverLocation);
      setNavigationRouteSummary(summary);

      const liveDriverPoint = driverLocation || getPoint(normalizedOrder.delivery_partner_geo_location);
      if (
        Platform.OS !== 'android' &&
        navigationMapRef.current &&
        liveDriverPoint &&
        target.point
      ) {
        setTimeout(() => {
          navigationMapRef.current?.fitToCoordinates([liveDriverPoint, target.point as RoutePoint], {
            edgePadding: { top: 80, right: 60, bottom: 80, left: 60 },
            animated: true,
          });
        }, 250);
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Route Error', 'Unable to load live navigation right now.');
    } finally {
      setNavigationRouteLoading(false);
    }
  }, [driverLocation]);

  useEffect(() => {
    if (!navigationVisible || !navigationOrder) {
      return;
    }

    let isCancelled = false;

    const refreshNavigationRoute = async () => {
      try {
        setNavigationRouteLoading(true);
        const summary = await fetchNavigationRoute(navigationOrder, driverLocation);
        if (!isCancelled) {
          setNavigationRouteSummary(summary);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error(err);
        }
      } finally {
        if (!isCancelled) {
          setNavigationRouteLoading(false);
        }
      }
    };

    refreshNavigationRoute();
    const timer = setInterval(refreshNavigationRoute, 12000);

    return () => {
      isCancelled = true;
      clearInterval(timer);
    };
  }, [driverLocation, navigationOrder, navigationVisible]);

  const onExpertMeasurementChange = useCallback((key: string, value: string) => {
    const sanitizedValue = value.replace(/[^0-9.]/g, '');
    setExpertMeasurements((previous) => ({
      ...previous,
      [key]: sanitizedValue,
    }));
  }, []);

  const savePickupDetails = useCallback(async (order: DeliveryOrder, silent = false) => {
    if (order.delivery_phase === 'return') {
      return true;
    }

    const payload: Record<string, any> = {
      measurement_received: pickupMeasurementReceived,
      measurement_note: pickupMeasurementNote.trim() || undefined,
      reference_cloth_received: pickupReferenceClothReceived,
      reference_cloth_note: pickupReferenceClothNote.trim() || undefined,
    };

    if (order.measurement_type === 'expert') {
      const normalizedMeasurements = buildExpertMeasurementPayload(expertMeasurements);
      payload.measurements = normalizedMeasurements;
      payload.measurement_received = Object.keys(normalizedMeasurements).length > 0 || pickupMeasurementReceived;

      if (!payload.measurement_received) {
        Alert.alert('Measurement Required', 'Add expert measurements or mark that measurements were received.');
        return false;
      }
    }

    setSavingPickupDetails(true);
    try {
      await api.put(`/delivery/${order.id}/pickup-details`, payload);
      await fetchOrders();
      if (!silent) {
        Alert.alert('Saved', 'Pickup details saved and shared with tailor.');
      }
      return true;
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Unable to save pickup details');
      return false;
    } finally {
      setSavingPickupDetails(false);
    }
  }, [expertMeasurements, fetchOrders, pickupMeasurementNote, pickupMeasurementReceived, pickupReferenceClothNote, pickupReferenceClothReceived]);

  const handleConfirmOrder = useCallback(async () => {
    if (!selectedOrder) {
      return;
    }
    try {
      const saved = await savePickupDetails(selectedOrder, true);
      if (!saved) {
        return;
      }
      await api.put(`/delivery/${selectedOrder.id}/accept`, {});
      const acceptedOrder: DeliveryOrder = {
        ...selectedOrder,
        status: 'delivery_accepted',
      };
      closeReview();
      await fetchOrders();
      openNavigation(acceptedOrder);
      Alert.alert('Success', 'Delivery assigned. Live navigation is ready.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Unable to accept this order');
    }
  }, [closeReview, fetchOrders, openNavigation, savePickupDetails, selectedOrder]);

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

  const handleAdvance = useCallback(async (
    order: DeliveryOrder,
    nextStatus: string,
    options?: { suppressSuccessAlert?: boolean }
  ) => {
    try {
      await api.put(`/delivery/${order.id}/update`, { status: nextStatus });
      await fetchOrders();
      if (!options?.suppressSuccessAlert) {
        Alert.alert('Success', `Status updated to ${STATUS_LABELS[nextStatus] || nextStatus}`);
      }
      return true;
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Unable to update delivery status');
      return false;
    }
  }, [fetchOrders]);

  const handleNavigationStatusUpdate = useCallback(async () => {
    if (!navigationOrder) {
      return;
    }

    const target = getNavigationTarget(navigationOrder);
    if (!target) {
      Alert.alert('Navigation unavailable', 'No next delivery step is available.');
      return;
    }

    const updated = await handleAdvance(navigationOrder, target.nextStatus, { suppressSuccessAlert: true });
    if (!updated) {
      return;
    }

    const progressedOrder: DeliveryOrder = {
      ...navigationOrder,
      status: target.nextStatus,
    };
    const nextTarget = getNavigationTarget(progressedOrder);

    if (nextTarget) {
      setNavigationOrder(progressedOrder);
      Alert.alert('Status Updated', `Continue to ${nextTarget.label}.`);
      return;
    }

    closeNavigation();
    Alert.alert('Success', `Status updated to ${STATUS_LABELS[target.nextStatus] || target.nextStatus}`);
  }, [closeNavigation, handleAdvance, navigationOrder]);

  const renderOrder = ({ item }: { item: DeliveryOrder }) => {
    const action = getNextAction(item);
    const fromAddress = item.delivery_phase === 'return' ? (item.tailor_address || item.tailor_name) : item.pickup_address;
    const toAddress = item.delivery_phase === 'return' ? item.delivery_address : (item.tailor_address || item.tailor_name);
    const measurementLabel = measurementTypeLabel(item.measurement_type);

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
          <View style={styles.addressRow}>
            <Feather name="sliders" size={14} color={Colors.textMuted} />
            <Text style={styles.addressText}>Measurement: {measurementLabel}</Text>
          </View>
          {item.send_reference_cloth ? (
            <View style={styles.addressRow}>
              <Feather name="archive" size={14} color={Colors.textMuted} />
              <Text style={styles.addressText}>Reference cloth requested</Text>
            </View>
          ) : null}
        </View>
        {action && (
          <TouchableOpacity
            testID={`delivery-action-${item.id}`}
            style={styles.updateBtn}
            onPress={() => {
              if (action.type === 'review') {
                openAssignmentReview(item);
                return;
              }
              if (action.type === 'navigate') {
                openNavigation(item);
                return;
              }
              handleAdvance(item, action.nextStatus);
            }}
            activeOpacity={0.7}
          >
            <Feather
              name={action.type === 'review' ? 'map' : action.type === 'navigate' ? 'navigation' : 'arrow-right-circle'}
              size={18}
              color={Colors.textInverted}
            />
            <Text style={styles.updateText}>{action.label}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const driverPoint = driverLocation || getPoint(selectedOrder?.delivery_partner_geo_location);
  const customerPoint = selectedOrder ? getPickupPoint(selectedOrder) : null;
  const tailorPoint = getPoint(selectedOrder?.tailor_geo_location);
  const shouldShowPickupChecklist = selectedOrder ? selectedOrder.delivery_phase !== 'return' : false;
  const selectedMeasurementLabel = measurementTypeLabel(selectedOrder?.measurement_type);
  const isExpertPickupMeasurement = selectedOrder?.measurement_type === 'expert';

  const navigationTarget = navigationOrder ? getNavigationTarget(navigationOrder) : null;
  const navigationTargetLabelLower = (navigationTarget?.label || '').toLowerCase();
  const navigationDriverPoint = driverLocation || getPoint(navigationOrder?.delivery_partner_geo_location);
  const navigationDestinationPoint = navigationTarget?.point || null;
  const navigationFallbackDistanceMeters = navigationDriverPoint && navigationDestinationPoint
    ? haversineDistanceMeters(navigationDriverPoint, navigationDestinationPoint)
    : null;
  const navigationDistanceMeters = navigationRouteSummary
    ? navigationRouteSummary.distanceKm * 1000
    : navigationFallbackDistanceMeters;
  const canCompleteNavigation = Boolean(
    navigationTarget &&
    navigationDistanceMeters !== null &&
    navigationDistanceMeters <= navigationTarget.nearThresholdMeters
  );

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
                    source={{
                      html: buildRouteMapHtml(
                        driverPoint,
                        selectedOrder.delivery_phase === 'pickup' ? customerPoint : null,
                        selectedOrder.delivery_phase === 'return' ? tailorPoint : null,
                        routeSummary?.coordinates || []
                      ),
                    }}
                    javaScriptEnabled
                    domStorageEnabled
                    mixedContentMode="always"
                    style={styles.map}
                  />
                ) : (
                  <MapView
                    ref={reviewMapRef}
                    provider={PROVIDER_DEFAULT}
                    mapType="none"
                    style={styles.map}
                    initialRegion={{ latitude: 20.5937, longitude: 78.9629, latitudeDelta: 8, longitudeDelta: 8 }}
                  >
                    <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} />
                    {driverPoint ? <Marker coordinate={driverPoint} title="Driver" pinColor={Colors.primary} /> : null}
                    {selectedOrder.delivery_phase === 'pickup' && customerPoint ? (
                      <Marker coordinate={customerPoint} title="Pickup Point" pinColor={Colors.secondary} />
                    ) : null}
                    {selectedOrder.delivery_phase === 'return' && tailorPoint ? (
                      <Marker coordinate={tailorPoint} title="Tailor Pickup" pinColor={Colors.success} />
                    ) : null}
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
            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
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
              {selectedOrder && shouldShowPickupChecklist ? (
                <View style={styles.pickupDetailsSection}>
                  <Text style={styles.pickupSectionTitle}>Pickup Details</Text>
                  <Text style={styles.pickupSectionHint}>Measurement Type: {selectedMeasurementLabel}</Text>

                  {isExpertPickupMeasurement ? (
                    <View style={styles.expertMeasurementGrid}>
                      {EXPERT_MEASUREMENT_FIELDS.map((field) => (
                        <View key={field.key} style={styles.expertInputGroup}>
                          <Text style={styles.expertInputLabel}>{field.label}</Text>
                          <TextInput
                            style={styles.expertInput}
                            placeholder={field.placeholder}
                            keyboardType="decimal-pad"
                            value={expertMeasurements[field.key] || ''}
                            onChangeText={(value) => onExpertMeasurementChange(field.key, value)}
                          />
                        </View>
                      ))}
                    </View>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.checkRow}
                        onPress={() => setPickupMeasurementReceived((previous) => !previous)}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.checkbox, pickupMeasurementReceived && styles.checkboxActive]}>
                          {pickupMeasurementReceived ? <Feather name="check" size={14} color={Colors.textInverted} /> : null}
                        </View>
                        <Text style={styles.checkLabel}>Customer provided AI/Self measurements</Text>
                      </TouchableOpacity>
                      <TextInput
                        style={styles.noteInput}
                        placeholder="Add notes about measurements shared by customer"
                        value={pickupMeasurementNote}
                        onChangeText={setPickupMeasurementNote}
                        multiline
                      />
                    </>
                  )}

                  {selectedOrder.send_reference_cloth ? (
                    <Text style={styles.referenceHint}>Customer asked to send reference cloth.</Text>
                  ) : null}
                  <TouchableOpacity
                    style={styles.checkRow}
                    onPress={() => setPickupReferenceClothReceived((previous) => !previous)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.checkbox, pickupReferenceClothReceived && styles.checkboxActive]}>
                      {pickupReferenceClothReceived ? <Feather name="check" size={14} color={Colors.textInverted} /> : null}
                    </View>
                    <Text style={styles.checkLabel}>Reference cloth received</Text>
                  </TouchableOpacity>
                  {(selectedOrder.send_reference_cloth || pickupReferenceClothReceived) ? (
                    <TextInput
                      style={styles.noteInput}
                      placeholder="Reference cloth notes (fabric details, count, etc.)"
                      value={pickupReferenceClothNote}
                      onChangeText={setPickupReferenceClothNote}
                      multiline
                    />
                  ) : null}

                  <TouchableOpacity
                    style={[styles.savePickupBtn, savingPickupDetails && styles.savePickupBtnDisabled]}
                    onPress={() => savePickupDetails(selectedOrder)}
                    activeOpacity={0.8}
                    disabled={savingPickupDetails}
                  >
                    {savingPickupDetails ? (
                      <ActivityIndicator size="small" color={Colors.textInverted} />
                    ) : (
                      <Feather name="save" size={16} color={Colors.textInverted} />
                    )}
                    <Text style={styles.savePickupText}>{savingPickupDetails ? 'Saving...' : 'Save Pickup Details'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <View style={styles.modalActionRow}>
                <TouchableOpacity style={styles.modalRejectBtn} onPress={handleRejectOrder} activeOpacity={0.7}>
                  <Text style={styles.modalRejectText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirmBtn, savingPickupDetails && styles.modalConfirmBtnDisabled]}
                  onPress={handleConfirmOrder}
                  activeOpacity={0.7}
                  disabled={savingPickupDetails}
                >
                  <Text style={styles.modalConfirmText}>Confirm Order</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={navigationVisible} animationType="slide" transparent onRequestClose={closeNavigation}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Live Navigation</Text>
              <TouchableOpacity onPress={closeNavigation} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="x" size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.mapContainer}>
              {navigationOrder ? (
                Platform.OS === 'android' ? (
                  <WebView
                    originWhitelist={['*']}
                    source={{
                      html: buildRouteMapHtml(
                        navigationDriverPoint,
                        navigationTargetLabelLower.includes('customer') ? navigationDestinationPoint : null,
                        navigationTargetLabelLower.includes('tailor') ? navigationDestinationPoint : null,
                        navigationRouteSummary?.coordinates || []
                      ),
                    }}
                    javaScriptEnabled
                    domStorageEnabled
                    mixedContentMode="always"
                    style={styles.map}
                  />
                ) : (
                  <MapView
                    ref={navigationMapRef}
                    provider={PROVIDER_DEFAULT}
                    mapType="none"
                    style={styles.map}
                    initialRegion={{ latitude: 20.5937, longitude: 78.9629, latitudeDelta: 8, longitudeDelta: 8 }}
                  >
                    <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} />
                    {navigationDriverPoint ? (
                      <Marker coordinate={navigationDriverPoint} title="Your Location" pinColor={Colors.primary} />
                    ) : null}
                    {navigationDestinationPoint ? (
                      <Marker
                        coordinate={navigationDestinationPoint}
                        title={navigationTarget?.label || 'Destination'}
                        pinColor={Colors.secondary}
                      />
                    ) : null}
                    {navigationRouteSummary?.coordinates?.length ? (
                      <Polyline coordinates={navigationRouteSummary.coordinates} strokeColor={Colors.primary} strokeWidth={4} />
                    ) : null}
                  </MapView>
                )
              ) : null}
              {navigationRouteLoading ? (
                <View style={styles.routeLoadingOverlay}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={styles.routeLoadingText}>Updating live route...</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.navigationSection}>
              <Text style={styles.navigationTargetLabel}>{navigationTarget?.label || 'Destination unavailable'}</Text>
              <View style={styles.routeSummaryRow}>
                <View style={styles.routeMetric}>
                  <Text style={styles.routeMetricLabel}>Remaining</Text>
                  <Text style={styles.routeMetricValue}>
                    {navigationDistanceMeters !== null ? `${(navigationDistanceMeters / 1000).toFixed(2)} km` : 'Unavailable'}
                  </Text>
                </View>
                <View style={styles.routeMetric}>
                  <Text style={styles.routeMetricLabel}>ETA</Text>
                  <Text style={styles.routeMetricValue}>
                    {navigationRouteSummary ? `${Math.ceil(navigationRouteSummary.durationMinutes)} min` : 'Unavailable'}
                  </Text>
                </View>
              </View>
              <Text style={styles.navigationHint}>Route and distance refresh automatically while navigation is open.</Text>
              {!canCompleteNavigation && navigationTarget ? (
                <Text style={styles.navigationWaitText}>
                  Move within {navigationTarget.nearThresholdMeters} m to enable {navigationTarget.buttonLabel}.
                </Text>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.navigationConfirmBtn,
                  (!canCompleteNavigation || navigationRouteLoading || !navigationTarget) && styles.modalConfirmBtnDisabled,
                ]}
                onPress={handleNavigationStatusUpdate}
                activeOpacity={0.7}
                disabled={!canCompleteNavigation || navigationRouteLoading || !navigationTarget}
              >
                <Text style={styles.modalConfirmText}>{navigationTarget?.buttonLabel || 'Update Status'}</Text>
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
  modalCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, overflow: 'hidden', maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text },
  mapContainer: { height: 260, backgroundColor: Colors.subtle },
  map: { flex: 1 },
  modalScroll: { flex: 1 },
  modalScrollContent: { paddingBottom: 8 },
  routeLoadingOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.85)' },
  routeLoadingText: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 8 },
  routeSummaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  routeMetric: { flex: 1, backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 12 },
  routeMetricLabel: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  routeMetricValue: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text, marginTop: 4 },
  pickupDetailsSection: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },
  pickupSectionTitle: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  pickupSectionHint: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  expertMeasurementGrid: { gap: 10 },
  expertInputGroup: { gap: 6 },
  expertInputLabel: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  expertInput: {
    backgroundColor: Colors.subtle,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.ui,
    fontSize: 14,
    color: Colors.text,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  checkboxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkLabel: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.text, marginLeft: 10, flex: 1 },
  noteInput: {
    minHeight: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.subtle,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.ui,
    fontSize: 13,
    color: Colors.text,
    textAlignVertical: 'top',
  },
  referenceHint: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.info },
  savePickupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    marginTop: 4,
  },
  savePickupBtnDisabled: { opacity: 0.6 },
  savePickupText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.textInverted, marginLeft: 8 },
  modalActionRow: { flexDirection: 'row', padding: 16, gap: 12 },
  modalRejectBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full, paddingVertical: 14, borderWidth: 1, borderColor: Colors.error + '30', backgroundColor: Colors.error + '08' },
  modalRejectText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.error },
  modalConfirmBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full, paddingVertical: 14, backgroundColor: Colors.primary },
  modalConfirmBtnDisabled: { opacity: 0.6 },
  modalConfirmText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.textInverted },
  navigationSection: { paddingHorizontal: 16, paddingVertical: 16, gap: 10 },
  navigationConfirmBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full, paddingVertical: 14, backgroundColor: Colors.primary, marginTop: 4 },
  navigationTargetLabel: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  navigationHint: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted },
  navigationWaitText: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.info },
});
