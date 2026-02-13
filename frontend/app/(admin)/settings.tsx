import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

export default function AdminSettings() {
  const [commission, setCommission] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [settings, wds] = await Promise.all([api.get('/admin/settings'), api.get('/admin/withdrawals')]);
      setCommission(String(settings.commission_percentage || 10));
      setWithdrawals(wds);
    } catch {} finally { setLoading(false); }
  };

  const handleSave = async () => {
    const val = parseFloat(commission);
    if (isNaN(val) || val < 0 || val > 100) { Alert.alert('Error', 'Enter a valid percentage (0-100)'); return; }
    setSaving(true);
    try { await api.put('/admin/settings', { commission_percentage: val }); Alert.alert('Success', 'Commission updated'); }
    catch (err: any) { Alert.alert('Error', err.message); }
    finally { setSaving(false); }
  };

  const approveWithdrawal = async (id: string) => {
    try { await api.put(`/admin/withdrawals/${id}/approve`, {}); fetchData(); Alert.alert('Success', 'Withdrawal approved'); }
    catch (err: any) { Alert.alert('Error', err.message); }
  };

  if (loading) return <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.headerTitle}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Platform Commission</Text>
          <Text style={styles.sectionDesc}>Set the commission percentage charged on each order</Text>
          <View style={styles.commissionRow}>
            <TextInput testID="commission-input" style={styles.commissionInput} value={commission} onChangeText={setCommission} keyboardType="numeric" placeholder="10" placeholderTextColor={Colors.textMuted} />
            <Text style={styles.percentSign}>%</Text>
            <TouchableOpacity testID="save-commission-btn" style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={handleSave} disabled={saving} activeOpacity={0.7}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Withdrawal Requests</Text>
          {withdrawals.length === 0 ? <Text style={styles.emptyText}>No pending withdrawals</Text> : (
            withdrawals.map((w) => (
              <View key={w.id} style={styles.withdrawalRow}>
                <View style={styles.wInfo}>
                  <Text style={styles.wName}>{w.tailor_name}</Text>
                  <Text style={styles.wAmount}>{'\u20B9'}{w.amount}</Text>
                  <Text style={styles.wDate}>{new Date(w.created_at).toLocaleDateString('en-IN')}</Text>
                </View>
                {w.status === 'pending' ? (
                  <TouchableOpacity testID={`approve-withdrawal-${w.id}`} style={styles.approveBtn} onPress={() => approveWithdrawal(w.id)} activeOpacity={0.7}>
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.approvedBadge}><Text style={styles.approvedText}>Approved</Text></View>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingTop: 16, paddingBottom: 40 },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginBottom: 24 },
  section: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: 20, marginBottom: 20 },
  sectionTitle: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.text },
  sectionDesc: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, marginTop: 4, marginBottom: 16 },
  commissionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  commissionInput: { flex: 1, backgroundColor: Colors.subtle, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 14, fontFamily: Fonts.bodyBold, fontSize: 24, color: Colors.text, textAlign: 'center' },
  percentSign: { fontFamily: Fonts.bodyBold, fontSize: 24, color: Colors.textMuted },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 24, paddingVertical: 14 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.textInverted },
  emptyText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, textAlign: 'center', paddingVertical: 16 },
  withdrawalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.subtle },
  wInfo: {},
  wName: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  wAmount: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.primary, marginTop: 2 },
  wDate: { fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  approveBtn: { backgroundColor: Colors.success, borderRadius: Radius.full, paddingHorizontal: 16, paddingVertical: 10 },
  approveBtnText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.textInverted },
  approvedBadge: { backgroundColor: Colors.success + '18', borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  approvedText: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.success },
});
