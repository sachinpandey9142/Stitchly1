import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '../../src/utils/api';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';

export default function WriteReview() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!comment.trim()) { Alert.alert('Error', 'Please write a comment'); return; }
    setLoading(true);
    try {
      await api.post('/reviews', { order_id: orderId, rating, comment: comment.trim() });
      Alert.alert('Thank You!', 'Your review has been submitted', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (err: any) { Alert.alert('Error', err.message); }
    finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TouchableOpacity testID="back-btn" style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Feather name="arrow-left" size={24} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerSection}>
            <Text style={styles.title}>Rate Your Experience</Text>
            <Text style={styles.subtitle}>Help others by sharing your feedback</Text>
          </View>

          <View style={styles.ratingSection}>
            <Text style={styles.ratingLabel}>Tap to rate</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} testID={`star-${star}`} onPress={() => setRating(star)} activeOpacity={0.7} style={styles.starBtn}>
                  <Feather name="star" size={40} color={star <= rating ? Colors.secondary : Colors.border} />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.ratingText}>{['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}</Text>
          </View>

          <View style={styles.commentSection}>
            <Text style={styles.label}>Your Review</Text>
            <TextInput testID="review-comment-input" style={styles.textArea} placeholder="Share details about your experience..." placeholderTextColor={Colors.textMuted} value={comment} onChangeText={setComment} multiline numberOfLines={5} textAlignVertical="top" />
          </View>

          <TouchableOpacity testID="submit-review-btn" style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={loading} activeOpacity={0.7}>
            <Text style={styles.submitBtnText}>{loading ? 'Submitting...' : 'Submit Review'}</Text>
          </TouchableOpacity>
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  backBtn: { width: 44, height: 44, justifyContent: 'center', paddingLeft: Spacing.containerPadding, marginTop: 8 },
  headerSection: { paddingHorizontal: Spacing.containerPadding, marginBottom: 24 },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text },
  subtitle: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted, marginTop: 4 },
  ratingSection: { alignItems: 'center', marginBottom: 32 },
  ratingLabel: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textMuted, marginBottom: 16 },
  starsRow: { flexDirection: 'row', gap: 8 },
  starBtn: { padding: 4 },
  ratingText: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.secondary, marginTop: 12 },
  commentSection: { paddingHorizontal: Spacing.containerPadding },
  label: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 10 },
  textArea: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 14, fontFamily: Fonts.ui, fontSize: 16, color: Colors.text, height: 140 },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16, alignItems: 'center', marginHorizontal: Spacing.containerPadding, marginTop: 32, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.textInverted },
});
