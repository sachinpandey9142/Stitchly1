import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Fonts } from '../../src/utils/theme';

export default function AdminLayout() {
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: Colors.primary, tabBarInactiveTintColor: Colors.textMuted,
      tabBarStyle: { backgroundColor: Colors.surface, borderTopColor: Colors.border, borderTopWidth: 1, paddingBottom: Platform.OS === 'ios' ? 20 : 8, paddingTop: 8, height: Platform.OS === 'ios' ? 88 : 64 },
      tabBarLabelStyle: { fontFamily: Fonts.body, fontSize: 12 }, headerShown: false,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ color, size }) => <Feather name="bar-chart-2" size={size} color={color} /> }} />
      <Tabs.Screen name="users" options={{ title: 'Users', tabBarIcon: ({ color, size }) => <Feather name="users" size={size} color={color} /> }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: ({ color, size }) => <Feather name="package" size={size} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Feather name="settings" size={size} color={color} /> }} />
    </Tabs>
  );
}
