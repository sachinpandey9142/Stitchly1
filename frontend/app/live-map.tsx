import MapView, { Marker } from "react-native-maps";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet, ViewStyle } from "react-native";

type Coordinates = {
  latitude: number;
  longitude: number;
};

type LiveMapProps = {
  initialLocation?: Coordinates | null;
  onLocationChange?: (coords: Coordinates) => void;
  style?: ViewStyle;
};

export default function LiveMap({
  initialLocation = null,
  onLocationChange,
  style,
}: LiveMapProps) {
  const [selectedLocation, setSelectedLocation] = useState<Coordinates | null>(
    initialLocation
  );

  useEffect(() => {
    if (initialLocation) {
      setSelectedLocation(initialLocation);
    }
  }, [initialLocation?.latitude, initialLocation?.longitude]);

  useEffect(() => {
    if (selectedLocation) return;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") return;

      const loc = await Location.getCurrentPositionAsync({});
      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setSelectedLocation(coords);
      onLocationChange?.(coords);
    })();
  }, [selectedLocation, onLocationChange]);

  const handleLocationChange = (coords: Coordinates) => {
    setSelectedLocation(coords);
    onLocationChange?.(coords);
  };

  if (!selectedLocation) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <MapView
      style={[styles.map, style]}
      initialRegion={{
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }}
      onPress={(e) => {
        const { latitude, longitude } = e.nativeEvent.coordinate;
        handleLocationChange({ latitude, longitude });
      }}
    >
      <Marker
        coordinate={selectedLocation}
        draggable
        onDragEnd={(e) =>
          handleLocationChange(e.nativeEvent.coordinate as Coordinates)
        }
        title="Selected Location"
      />
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { width: "100%", height: "100%" },
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});