import React, { useState, useEffect, useCallback } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { api } from "../../../src/utils/api";
import { useAuth } from "../../../src/context/AuthContext";
import * as Location from "expo-location";
import {
  Colors,
  Fonts,
  Spacing,
  Radius,
  STATUS_COLORS,
  STATUS_LABELS,
} from "../../../src/utils/theme";
import { getDistance } from "geolib";
import MapView, { Marker, Polyline } from "react-native-maps";

const NEXT_STATUS: Record<string, string> = {
  pickup_assigned: "picked_up",
  picked_up: "delivered_to_tailor",

  delivery_assigned: "delivery_accepted",
  delivery_accepted: "out_for_delivery",
  out_for_delivery: "delivered",
};

const NEXT_LABEL: Record<string, string> = {
  pickup_assigned: "Pick From Customer",
  picked_up: "Deliver To Tailor",

  delivery_assigned: "Accept Delivery",
  delivery_accepted: "Start Delivery",
  out_for_delivery: "Mark Delivered",
};

export default function DeliveryDashboard() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(true);
  const [mapVisible, setMapVisible] = useState(false);
  const [routeInfo, setRouteInfo] = useState({
    distance: 0,
    duration: 0,
  });
  const distanceKm = (routeInfo.distance / 1000).toFixed(2);
  const durationMin = Math.ceil(routeInfo.duration / 60);
  const [routeCoords, setRouteCoords] = useState<
    { latitude: number; longitude: number }[]
  >([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // Split orders for better UX
  const newRequests = orders.filter(
    (o) => o.status === "pickup_assigned" || o.status === "delivery_assigned",
  );

  const activeOrders = orders.filter((o) =>
    [
      "picked_up",
      "delivered_to_tailor",
      "delivery_accepted",
      "out_for_delivery",
    ].includes(o.status),
  );

  const toggleAvailability = async () => {
    try {
      const newStatus = !isAvailable;
      await api.put("/delivery/availability", {
        is_available: newStatus,
      });
      setIsAvailable(newStatus);
    } catch (e) {
      Alert.alert("Error", "Could not update availability");
    }
  };

  const fetchOrders = async () => {
    try {
      const data = await api.get("/delivery/orders");
      setOrders(data || []);
    } catch (err: any) {
      console.log("DELIVERY ERROR:", err);
      Alert.alert("Error", err.message);
    
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  const fetchRoute = useCallback(
    async (order: any) => {
      try {
        if (!currentLocation || !order?.pickup_location) return;

        const driverLat = currentLocation.latitude;
        const driverLng = currentLocation.longitude;

        const pickupLat = order.pickup_location.coordinates[1];
        const pickupLng = order.pickup_location.coordinates[0];

        const tailorLat = order?.tailor_location?.coordinates?.[1];
        const tailorLng = order?.tailor_location?.coordinates?.[0];

        let url = "";

        if (tailorLat && tailorLng) {
          url = `https://router.project-osrm.org/route/v1/driving/${driverLng},${driverLat};${pickupLng},${pickupLat};${tailorLng},${tailorLat}?overview=full&geometries=geojson`;
        } else {
          url = `https://router.project-osrm.org/route/v1/driving/${driverLng},${driverLat};${pickupLng},${pickupLat}?overview=full&geometries=geojson`;
        }

        const res = await fetch(url);
        const data = await res.json();

        if (data.routes?.length) {
          const route = data.routes[0];

          const coords = route.geometry.coordinates.map((c: number[]) => ({
            latitude: c[1],
            longitude: c[0],
          }));

          setRouteCoords(coords);

          setRouteInfo({
            distance: route.distance,
            duration: route.duration,
          });
        }
      } catch (err) {
        console.log("Failed to fetch route");
      }
    },
    [currentLocation],
  );

  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | null = null;

    const initDashboard = async () => {
      try {
        setLoading(true);

        // 1️⃣ Fetch orders
        await fetchOrders();

        // 2️⃣ If offline → don't track
        if (!isAvailable) return;

        // 3️⃣ Ask location permission
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          console.log("Location permission denied");
          return;
        }

        // 4️⃣ Start live tracking
        locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          async (loc) => {
            try {
              const newLocation = {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              };

              setCurrentLocation(newLocation);

              await api.put("/delivery/location", {
                latitude: newLocation.latitude,
                longitude: newLocation.longitude,
              });
            } catch (err) {
              console.log("Failed to update location");
            }
          },
        );
      } catch (err) {
        console.log("Dashboard init failed");
        Alert.alert("Error", "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    };

    initDashboard();

    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, [isAvailable]);

  useEffect(() => {
    if (selectedOrder && mapVisible) {
      fetchRoute(selectedOrder);
    }
  }, [currentLocation, selectedOrder, mapVisible]);

  const handleUpdate = async (orderId: string, status: string) => {
    try {
      setProcessing(orderId);

      if (status === "delivery_assigned") {
        await api.put(`/delivery/${orderId}/accept`);
        Alert.alert("Success", "Delivery Accepted");
      } else {
        const next = NEXT_STATUS[status];
        if (!next) return;
        await api.put(`/delivery/${orderId}/update`, { status: next });
        Alert.alert(
          "Success",
          `Status updated to ${STATUS_LABELS[next] || next}`,
        );
      }

      fetchOrders();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setProcessing(null);
    }
  };
  const handleReject = async (orderId: string) => {
    try {
      await api.put(`/delivery/${orderId}/reject`);
      Alert.alert("Rejected", "Delivery rejected");
      fetchOrders();
    } catch (err) {
      Alert.alert("Error", "Could not reject order");
    }
  };

  const renderOrder = ({ item }: { item: any }) => {
    let distanceKm: string | null = null;

    if (currentLocation && item.pickup_location?.coordinates) {
      const deliveryLat = currentLocation.latitude;
      const deliveryLng = currentLocation.longitude;

      const pickupLat = item.pickup_location.coordinates[1];
      const pickupLng = item.pickup_location.coordinates[0];

      const distanceToPickup = getDistance(
        { latitude: deliveryLat, longitude: deliveryLng },
        { latitude: pickupLat, longitude: pickupLng },
      );

      distanceKm = (distanceToPickup / 1000).toFixed(2);
    }
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardInfo}>
            <Text style={styles.serviceType}>{item.service_type}</Text>
            <Text style={styles.names}>
              {item.customer_name} → {item.tailor_name}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  (STATUS_COLORS[item.status] || Colors.textMuted) + "18",
              },
            ]}
          >
            <Text
              style={[
                styles.statusText,
                { color: STATUS_COLORS[item.status] || Colors.textMuted },
              ]}
            >
              {STATUS_LABELS[item.status] || item.status}
            </Text>
          </View>
        </View>
        <View style={styles.addressSection}>
          {/* Pickup */}
          <View style={styles.addressRow}>
            <Feather name="map-pin" size={14} color={Colors.info} />
            <Text style={styles.addressText}>From: {item.pickup_address}</Text>
          </View>

          {/* 🔥 Distance Badge */}
          {distanceKm && (
            <View style={styles.distanceBadge}>
              <Feather name="clock" size={12} color={Colors.primary} />
              <Text style={styles.distanceText}>{distanceKm} km away</Text>
            </View>
          )}

          {/* Drop */}
          <View style={styles.addressRow}>
            <Feather name="navigation" size={14} color={Colors.success} />
            <Text style={styles.addressText}>To: {item.delivery_address}</Text>
          </View>
          <TouchableOpacity
            style={styles.mapBtn}
            onPress={() => {
              setSelectedOrder(item);
              setMapVisible(true);
              fetchRoute(item);
            }}
          >
            <Feather name="map" size={18} color="#fff" />
            <Text style={styles.mapBtnText}>View Map</Text>
          </TouchableOpacity>
        </View>
        {item.status === "pickup_assigned" ? (
          <View style={{ flexDirection: "row", marginTop: 14 }}>
            <TouchableOpacity
              style={[styles.updateBtn, { flex: 1, marginRight: 6 }]}
              onPress={() => handleUpdate(item.id, item.status)}
            >
              <Feather
                name="check-circle"
                size={18}
                color={Colors.textInverted}
              />
              <Text style={styles.updateText}>Accept</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.rejectBtn, { flex: 1 }]}
              onPress={() => handleReject(item.id)}
            >
              <Feather name="x-circle" size={18} color="#fff" />
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
          </View>
        ) : (
          [
            "picked_up",
            "delivery_assigned",
            "delivery_accepted",
            "out_for_delivery",
          ].includes(item.status) && (
            <TouchableOpacity
              style={styles.updateBtn}
              onPress={() => handleUpdate(item.id, item.status)}
            >
              <Feather
                name={
                  item.status === "picked_up"
                    ? "navigation"
                    : item.status === "delivery_assigned"
                      ? "check-circle"
                      : item.status === "delivery_accepted"
                        ? "truck"
                        : "package"
                }
                size={18}
                color={Colors.textInverted}
              />

              <Text style={styles.updateText}>
                {processing === item.id
                  ? "Processing..."
                  : NEXT_LABEL[item.status] || "Update"}
              </Text>
            </TouchableOpacity>
          )
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.headerSection}>
        <Text style={styles.greeting}>Hello, {user?.name}</Text>
        <Text style={styles.headerTitle}>Active Deliveries</Text>
        <TouchableOpacity
          style={[
            styles.availabilityBtn,
            { backgroundColor: isAvailable ? Colors.success : Colors.error },
          ]}
          onPress={toggleAvailability}
        >
          <Text style={styles.availabilityText}>
            {isAvailable ? "🟢 Online" : "🔴 Offline"}
          </Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={[...newRequests, ...activeOrders]}
          keyExtractor={(i) => i.id}
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
      <Modal visible={mapVisible} animationType="slide">
        <View style={{ flex: 1 }}>
          {selectedOrder && currentLocation && (
            <MapView
              style={{ flex: 1 }}
              region={{
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
            >
              {/* Driver */}
              <Marker
                coordinate={{
                  latitude: currentLocation.latitude,
                  longitude: currentLocation.longitude,
                }}
                title="Driver"
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View
                  style={{
                    backgroundColor: "#fff",
                    padding: 6,
                    borderRadius: 20,
                    borderWidth: 2,
                    borderColor: Colors.primary,
                  }}
                >
                  <Feather name="truck" size={20} color={Colors.primary} />
                </View>
              </Marker>

              {/* Customer */}
              <Marker
                coordinate={{
                  latitude: selectedOrder.pickup_location.coordinates[1],
                  longitude: selectedOrder.pickup_location.coordinates[0],
                }}
                title="Customer"
              />

              {/* Tailor */}
              {selectedOrder?.tailor_location && (
                <Marker
                  coordinate={{
                    latitude: selectedOrder.tailor_location.coordinates[1],
                    longitude: selectedOrder.tailor_location.coordinates[0],
                  }}
                  title="Tailor"
                  pinColor="green"
                />
              )}
              {routeCoords.length > 0 && (
                <Polyline
                  coordinates={routeCoords}
                  strokeWidth={4}
                  strokeColor={Colors.primary}
                />
              )}
            </MapView>
          )}
          {routeInfo.distance > 0 && (
            <View
              style={{
                position: "absolute",
                top: 60,
                left: 20,
                right: 20,
                backgroundColor: "#fff",
                padding: 14,
                borderRadius: 12,
                elevation: 5,
                flexDirection: "row",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ fontWeight: "600" }}>📏 {distanceKm} km</Text>

              <Text style={{ fontWeight: "600" }}>⏱ {durationMin} min</Text>
            </View>
          )}

          {/* Close Button */}
          <TouchableOpacity
            style={{
              position: "absolute",
              bottom: 40,
              left: 20,
              right: 20,
              backgroundColor: "#000",
              padding: 16,
              borderRadius: 30,
              alignItems: "center",
            }}
            onPress={() => {
              setMapVisible(false);
              setRouteCoords([]);
            }}
          >
            <Text style={{ color: "#fff" }}>Close Map</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerSection: {
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: 16,
    paddingBottom: 8,
  },
  greeting: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  headerTitle: {
    fontFamily: Fonts.heading,
    fontSize: 28,
    color: Colors.text,
    marginTop: 2,
  },
  list: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 20 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardInfo: { flex: 1 },
  serviceType: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  names: {
    fontFamily: Fonts.ui,
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 8,
  },
  statusText: { fontFamily: Fonts.bodyBold, fontSize: 12 },
  addressSection: {
    marginTop: 12,
    backgroundColor: Colors.subtle,
    borderRadius: Radius.md,
    padding: 12,
  },
  addressRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  addressText: {
    fontFamily: Fonts.ui,
    fontSize: 13,
    color: Colors.text,
    marginLeft: 8,
    flex: 1,
  },
  updateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 14,
    marginTop: 14,
  },
  updateText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.textInverted,
    marginLeft: 8,
  },
  loader: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { alignItems: "center", paddingTop: 80 },
  emptyText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.text,
    marginTop: 16,
  },
  availabilityBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.full,
    marginTop: 8,
  },
  availabilityText: {
    color: Colors.textInverted,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
  },
  distanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: Colors.primary + "15",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 6,
    marginBottom: 6,
  },

  distanceText: {
    fontSize: 12,
    fontFamily: Fonts.bodyBold,
    color: Colors.primary,
    marginLeft: 4,
  },
  mapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    paddingVertical: 12,
    borderRadius: 30,
    marginTop: 10,
  },
  mapBtnText: {
    color: "#fff",
    marginLeft: 6,
    fontWeight: "600",
  },
  rejectBtn: {
    backgroundColor: "#EF4444",
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: "center",
  },

  rejectText: {
    color: "#fff",
    fontWeight: "600",
  },
});
