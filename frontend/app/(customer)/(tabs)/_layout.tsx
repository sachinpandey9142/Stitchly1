import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Fonts } from "../../../src/utils/theme";
import { CustomerDiscoveryProvider } from "../../../src/context/CustomerDiscoveryContext";

export default function CustomerLayout() {
  return (
    <CustomerDiscoveryProvider>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textMuted,
          tabBarStyle: {
            backgroundColor: Colors.surface,
            borderTopColor: Colors.border,
            borderTopWidth: 1,
            paddingVertical: 6,
          },
          tabBarLabelStyle: {
            fontFamily: Fonts.body,
            fontSize: 12,
          },
          tabBarHideOnKeyboard: true,
          headerShown: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color, size }) => (
              <Feather name="home" size={size} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="search"
          options={{
            title: "Search",
            tabBarIcon: ({ color, size }) => (
              <Feather name="search" size={size} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="nearby-tailors"
          options={{
            title: "Nearby Tailors",
            tabBarIcon: ({ color, size }) => (
              <Feather name="map-pin" size={size} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, size }) => (
              <Feather name="user" size={size} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="orders"
          options={{
            href: null,
          }}
        />
      </Tabs>
    </CustomerDiscoveryProvider>
  );
}
