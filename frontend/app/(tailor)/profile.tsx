import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

export default function TailorProfile() {
  const router = useRouter();
  const { user, logout, refreshUser } = useAuth();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newService, setNewService] = useState({ service_name: '', price: '', category: '' });
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { fetchServices(); }, []);

  const fetchServices = async () => {
    try { const data = await api.get('/tailor/services'); setServices(data); } catch {} finally { setLoading(false); }
  };

  const handleAddService = async () => {
    if (!newService.service_name || !newService.price || !newService.category) { Alert.alert('Error', 'Fill all fields'); return; }
    try {
      await api.post('/tailor/services', { ...newService, price: parseFloat(newService.price) });
      setNewService({ service_name: '', price: '', category: '' }); setShowAdd(false); fetchServices();
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const handleDeleteService = async (id: string) => {
    Alert.alert('Delete', 'Remove this service?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await api.delete(`/tailor/services/${id}`); fetchServices(); } catch {} } }
    ]);
  };

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: async () => { await logout(); router.replace('/(auth)/login'); } },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.profileCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{user?.name?.charAt(0)}</Text></View>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View style={styles.infoRow}><Feather name="map-pin" size={14} color={Colors.textMuted} /><Text style={styles.infoText}>{user?.location || 'Location not set'}</Text></View>
          <View style={styles.tagRow}>{user?.specialities?.map((s: string) => (<View key={s} style={styles.tag}><Text style={styles.tagText}>{s}</Text></View>))}</View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Services</Text>
            <TouchableOpacity testID="add-service-btn" onPress={() => setShowAdd(!showAdd)} activeOpacity={0.7}>
              <Feather name={showAdd ? 'x' : 'plus'} size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          {showAdd && (
            <View style={styles.addForm}>
              <TextInput testID="service-name-input" style={styles.formInput} placeholder="Service name" placeholderTextColor={Colors.textMuted} value={newService.service_name} onChangeText={(t) => setNewService({ ...newService, service_name: t })} />
              <TextInput testID="service-price-input" style={styles.formInput} placeholder="Price (INR)" placeholderTextColor={Colors.textMuted} value={newService.price} onChangeText={(t) => setNewService({ ...newService, price: t })} keyboardType="numeric" />
              <TextInput testID="service-category-input" style={styles.formInput} placeholder="Category" placeholderTextColor={Colors.textMuted} value={newService.category} onChangeText={(t) => setNewService({ ...newService, category: t })} />
              <TouchableOpacity testID="save-service-btn" style={styles.saveBtn} onPress={handleAddService} activeOpacity={0.7}><Text style={styles.saveBtnText}>Add Service</Text></TouchableOpacity>
            </View>
          )}
          {loading ? <ActivityIndicator color={Colors.primary} /> : services.map((s) => (
            <View key={s.id} style={styles.serviceRow}>
              <View style={styles.serviceInfo}><Text style={styles.serviceName}>{s.service_name}</Text><Text style={styles.serviceCategory}>{s.category}</Text></View>
              <Text style={styles.servicePrice}>{'\u20B9'}{s.price}</Text>
              <TouchableOpacity testID={`delete-service-${s.id}`} onPress={() => handleDeleteService(s.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="trash-2" size={18} color={Colors.error} />
              </TouchableOpacity>
            </View>
          ))}
          {!loading && services.length === 0 && <Text style={styles.emptyText}>No services added yet</Text>}
        </View>

        <TouchableOpacity testID="tailor-logout-btn" style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
          <Feather name="log-out" size={20} color={Colors.error} /><Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingTop: 16, paddingBottom: 40 },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginBottom: 20 },
  profileCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 20, alignItems: 'center', marginBottom: 20 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.textInverted },
  userName: { fontFamily: Fonts.bodyBold, fontSize: 20, color: Colors.text },
  userEmail: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginTop: 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  infoText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginLeft: 6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  tag: { backgroundColor: Colors.primary + '15', borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 4 },
  tagText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.primary },
  section: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text },
  addForm: { backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 14, marginBottom: 14 },
  formInput: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 12, fontFamily: Fonts.ui, fontSize: 15, color: Colors.text, marginBottom: 10 },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 12, alignItems: 'center' },
  saveBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.textInverted },
  serviceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.subtle },
  serviceInfo: { flex: 1 },
  serviceName: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  serviceCategory: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted },
  servicePrice: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.primary, marginRight: 14 },
  emptyText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, textAlign: 'center', paddingVertical: 16 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.error + '30' },
  logoutText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.error, marginLeft: 10 },
});
