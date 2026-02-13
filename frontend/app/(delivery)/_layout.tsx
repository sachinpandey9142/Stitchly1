import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Fonts } from '../../src/utils/theme';

export default function DeliveryLayout() {
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: Colors.primary, tabBarInactiveTintColor: Colors.textMuted,
      tabBarStyle: { backgroundColor: Colors.surface, borderTopColor: Colors.border, borderTopWidth: 1, paddingBottom: Platform.OS === 'ios' ? 20 : 8, paddingTop: 8, height: Platform.OS === 'ios' ? 88 : 64 },
      tabBarLabelStyle: { fontFamily: Fonts.body, fontSize: 12 }, headerShown: false,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Deliveries', tabBarIcon: ({ color, size }) => <Feather name="truck" size={size} color={color} /> }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings', tabBarIcon: ({ color, size }) => <Feather name="dollar-sign" size={size} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} /> }} />
    </Tabs>
  );
}
