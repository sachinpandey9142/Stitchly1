import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Fonts, Spacing, Radius } from '../../src/utils/theme';
import { api } from '../../src/utils/api';

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      const user = await login(email.trim().toLowerCase(), password);
      if (user.role === 'customer') router.replace("/(customer)/(tabs)");
      else if (user.role === 'tailor') router.replace('/(tailor)/(tabs)');
      else if (user.role === 'delivery') router.replace('/(delivery)');
      else if (user.role === 'admin') router.replace('/(admin)');
    } catch (err: any) {
      Alert.alert('Login Failed', err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const result = await api.post('/seed', {});
      if (result.seeded) {
        Alert.alert('Success', 'Sample data created! Use anita@test.com / customer123 to login as customer');
      } else {
        Alert.alert('Info', 'Data already seeded');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.logo}>Stitchly</Text>
            <Text style={styles.subtitle}>Your trusted tailoring marketplace</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.desc}>Sign in to continue</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputContainer}>
                <Feather name="mail" size={20} color={Colors.textMuted} />
                <TextInput
                  testID="login-email-input"
                  style={styles.input}
                  placeholder="Enter your email"
                  placeholderTextColor={Colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputContainer}>
                <Feather name="lock" size={20} color={Colors.textMuted} />
                <TextInput
                  testID="login-password-input"
                  style={styles.input}
                  placeholder="Enter your password"
                  placeholderTextColor={Colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} testID="toggle-password-btn" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name={showPassword ? 'eye-off' : 'eye'} size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              testID="login-submit-btn"
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              activeOpacity={0.7}
              disabled={loading}
            >
              <Text style={styles.buttonText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="go-to-register-btn"
              style={styles.linkButton}
              onPress={() => router.push('/(auth)/register')}
              activeOpacity={0.7}
            >
              <Text style={styles.linkText}>
                Don't have an account? <Text style={styles.linkBold}>Sign Up</Text>
              </Text>
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              testID="seed-data-btn"
              style={styles.seedButton}
              onPress={handleSeed}
              activeOpacity={0.7}
              disabled={seeding}
            >
              <Feather name="database" size={18} color={Colors.primary} />
              <Text style={styles.seedText}>{seeding ? 'Loading...' : 'Load Sample Data'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: Spacing.containerPadding, paddingTop: 60, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 48 },
  logo: { fontFamily: Fonts.heading, fontSize: 42, color: Colors.primary },
  subtitle: { fontFamily: Fonts.ui, fontSize: 16, color: Colors.textMuted, marginTop: 8 },
  form: {},
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginBottom: 4 },
  desc: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted, marginBottom: 28 },
  inputGroup: { marginBottom: 20 },
  label: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 8 },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.subtle,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 16, height: 52,
  },
  input: { flex: 1, fontFamily: Fonts.ui, fontSize: 16, color: Colors.text, marginLeft: 12 },
  button: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.textInverted },
  linkButton: { alignItems: 'center', marginTop: 20, paddingVertical: 8 },
  linkText: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textMuted },
  linkBold: { fontFamily: Fonts.bodyBold, color: Colors.primary },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontFamily: Fonts.ui, fontSize: 14, color: Colors.textMuted, paddingHorizontal: 16 },
  seedButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.full,
    paddingVertical: 14, backgroundColor: Colors.surface,
  },
  seedText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.primary, marginLeft: 8 },
});
