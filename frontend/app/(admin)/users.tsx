import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

const ROLE_FILTERS = ['all', 'customer', 'tailor', 'delivery'];

export default function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [roleFilter, setRoleFilter] = useState('all');

  const fetchUsers = async () => {
    try { const endpoint = roleFilter === 'all' ? '/admin/users' : `/admin/users?role=${roleFilter}`; const data = await api.get(endpoint); setUsers(data); }
    catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { setLoading(true); fetchUsers(); }, [roleFilter]);

  const toggleBlock = async (userId: string) => {
    try { await api.put(`/admin/users/${userId}/toggle-block`, {}); fetchUsers(); }
    catch (err: any) { Alert.alert('Error', err.message); }
  };

  const approveTailor = async (tailorId: string) => {
    try { await api.put(`/admin/approve-tailor/${tailorId}`, {}); fetchUsers(); Alert.alert('Success', 'Tailor approved'); }
    catch (err: any) { Alert.alert('Error', err.message); }
  };

  const renderUser = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.avatar, { backgroundColor: item.role === 'tailor' ? Colors.secondary : item.role === 'delivery' ? Colors.info : Colors.primary }]}>
          <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.userName}>{item.name}</Text>
          <Text style={styles.userEmail}>{item.email}</Text>
          <View style={styles.metaRow}>
            <View style={styles.roleBadge}><Text style={styles.roleText}>{item.role}</Text></View>
            <View style={[styles.statusDot, { backgroundColor: item.status === 'active' ? Colors.success : item.status === 'pending' ? Colors.warning : Colors.error }]} />
            <Text style={styles.statusLabel}>{item.status}</Text>
          </View>
        </View>
      </View>
      <View style={styles.actionRow}>
        {item.role === 'tailor' && item.status === 'pending' && (
          <TouchableOpacity testID={`approve-tailor-${item.id}`} style={styles.approveBtn} onPress={() => approveTailor(item.id)} activeOpacity={0.7}>
            <Feather name="check" size={16} color={Colors.textInverted} /><Text style={styles.approveBtnText}>Approve</Text>
          </TouchableOpacity>
        )}
        {item.role !== 'admin' && (
          <TouchableOpacity testID={`toggle-block-${item.id}`} style={[styles.blockBtn, item.status === 'blocked' && styles.unblockBtn]} onPress={() => toggleBlock(item.id)} activeOpacity={0.7}>
            <Feather name={item.status === 'blocked' ? 'unlock' : 'slash'} size={16} color={item.status === 'blocked' ? Colors.success : Colors.error} />
            <Text style={[styles.blockBtnText, item.status === 'blocked' && styles.unblockText]}>{item.status === 'blocked' ? 'Unblock' : 'Block'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}><Text style={styles.headerTitle}>Users</Text></View>
      <FlatList horizontal data={ROLE_FILTERS} keyExtractor={(i) => i} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterList}
        renderItem={({ item }) => (
          <TouchableOpacity testID={`filter-${item}`} style={[styles.filterChip, roleFilter === item && styles.filterActive]} onPress={() => setRoleFilter(item)} activeOpacity={0.7}>
            <Text style={[styles.filterText, roleFilter === item && styles.filterTextActive]}>{item.charAt(0).toUpperCase() + item.slice(1)}</Text>
          </TouchableOpacity>
        )} />
      {loading ? <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View> : (
        <FlatList data={users} keyExtractor={(i) => i.id} renderItem={renderUser} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchUsers(); }} tintColor={Colors.primary} />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>No users found</Text></View>} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.containerPadding, paddingTop: 16, paddingBottom: 8 },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text },
  filterList: { paddingHorizontal: Spacing.containerPadding, paddingVertical: 10, gap: 8 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  filterActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  filterTextActive: { color: Colors.textInverted },
  list: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 20 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row' },
  avatar: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontFamily: Fonts.bodyBold, fontSize: 20, color: Colors.textInverted },
  cardInfo: { flex: 1, marginLeft: 14 },
  userName: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  userEmail: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 },
  roleBadge: { backgroundColor: Colors.primary + '15', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  roleText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.primary, textTransform: 'capitalize' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted, textTransform: 'capitalize' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.subtle },
  approveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.success, borderRadius: Radius.full, paddingVertical: 10 },
  approveBtnText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.textInverted, marginLeft: 4 },
  blockBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.error + '10', borderRadius: Radius.full, paddingVertical: 10, borderWidth: 1, borderColor: Colors.error + '30' },
  unblockBtn: { backgroundColor: Colors.success + '10', borderColor: Colors.success + '30' },
  blockBtnText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.error, marginLeft: 4 },
  unblockText: { color: Colors.success },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.textMuted },
});
