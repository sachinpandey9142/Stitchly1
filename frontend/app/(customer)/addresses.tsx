import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

type Address = {
  id: string;
  label: string;
  flat_no: string;
  area: string;
  landmark?: string;
  city: string;
  pincode: string;
  is_default: boolean;
};

export default function AddressList() {
  const router = useRouter();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAddresses = useCallback(async () => {
    try {
      const data: Address[] = await api.get('/addresses');
      setAddresses(data);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load addresses');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAddresses();
  }, [loadAddresses]);

  const handleSetDefault = async (id: string) => {
    try {
      await api.put(`/addresses/${id}/set-default`, {});
      await loadAddresses();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to set default');
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('Delete address', 'Are you sure you want to delete this address?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/addresses/${id}`);
            await loadAddresses();
          } catch (e: any) {
            Alert.alert('Error', e.message || 'Failed to delete address');
          }
        },
      },
    ]);
  };

  const renderAddress = ({ item }: { item: Address }) => {
    const fullAddress = [
      item.flat_no,
      item.area,
      item.landmark,
      `${item.city} - ${item.pincode}`,
    ]
      .filter(Boolean)
      .join(', ');

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.labelBadge}>
            <Feather
              name={item.label === 'Work' ? 'briefcase' : item.label === 'Home' ? 'home' : 'map-pin'}
              size={14}
              color={Colors.primary}
            />
            <Text style={styles.labelText}>{item.label}</Text>
          </View>
          {item.is_default && (
            <View style={styles.defaultBadge}>
              <Text style={styles.defaultText}>Default</Text>
            </View>
          )}
        </View>
        <Text style={styles.addressText}>{fullAddress}</Text>

        <View style={styles.actionsRow}>
          {!item.is_default && (
            <TouchableOpacity
              style={styles.actionChip}
              onPress={() => handleSetDefault(item.id)}
              activeOpacity={0.7}
            >
              <Feather name="star" size={14} color={Colors.primary} />
              <Text style={styles.actionText}>Set Default</Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={styles.secondaryChip}
            onPress={() => router.push(`/(customer)/add-address?id=${item.id}`)}
            activeOpacity={0.7}
          >
            <Feather name="edit-2" size={14} color={Colors.text} />
            <Text style={styles.secondaryText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryChip}
            onPress={() => handleDelete(item.id)}
            activeOpacity={0.7}
          >
            <Feather name="trash-2" size={14} color={Colors.error} />
            <Text style={[styles.secondaryText, { color: Colors.error }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>My Addresses</Text>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={addresses}
          keyExtractor={(item) => item.id}
          renderItem={renderAddress}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadAddresses();
              }}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="map-pin" size={40} color={Colors.border} />
              <Text style={styles.emptyTitle}>No addresses saved</Text>
              <Text style={styles.emptySubtitle}>
                Add your home or work address to quickly place orders.
              </Text>
            </View>
          }
        />
      )}

      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => router.push('/(customer)/add-address')}
        activeOpacity={0.8}
      >
        <Feather name="plus" size={18} color={Colors.textInverted} />
        <Text style={styles.addBtnText}>Add New Address</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: { paddingRight: 12, paddingVertical: 4 },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 24,
    color: Colors.text,
  },
  list: {
    paddingHorizontal: Spacing.containerPadding,
    paddingBottom: 110,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  labelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary + '10',
  },
  labelText: {
    marginLeft: 6,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.primary,
  },
  defaultBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.secondary + '14',
  },
  defaultText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.secondaryDark,
  },
  addressText: {
    fontFamily: Fonts.ui,
    fontSize: 14,
    color: Colors.text,
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary + '10',
  },
  actionText: {
    marginLeft: 6,
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.primary,
  },
  secondaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.subtle,
    marginLeft: 8,
  },
  secondaryText: {
    marginLeft: 4,
    fontFamily: Fonts.ui,
    fontSize: 12,
    color: Colors.textMuted,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: Spacing.containerPadding,
  },
  emptyTitle: {
    marginTop: 14,
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.text,
  },
  emptySubtitle: {
    marginTop: 6,
    fontFamily: Fonts.ui,
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  addBtn: {
    position: 'absolute',
    left: Spacing.containerPadding,
    right: Spacing.containerPadding,
    bottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 14,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  addBtnText: {
    marginLeft: 8,
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.textInverted,
  },
});

