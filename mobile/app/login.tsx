import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { NatureTheme } from '@/constants/Theme';
import { supabaseConfigured } from '@/lib/supabase';

export default function LoginScreen() {
  const toast = useCuteToast();
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function onSubmit() {
    setFormError('');
    if (!supabaseConfigured) {
      toast.info('คอนฟิก', 'ยังไม่ได้ตั้งค่า Supabase');
      return;
    }
    if (!email.trim() || !password) {
      toast.info('กรอกข้อมูล', 'กรุณากรอกอีเมลและรหัสผ่าน');
      return;
    }
    setBusy(true);
    try {
      const { error } = await signIn(email, password);
      if (error) {
        setFormError(error.message);
        toast.error('เข้าสู่ระบบไม่สำเร็จ', error.message);
        return;
      }
      router.replace('/attendance');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        <View style={styles.card}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/images/app-brand-icon.png')}
              style={styles.logo}
              accessibilityLabel="โลโก้ FOLIAGE"
            />
          </View>
          <Text style={styles.title}>FOLIAGE</Text>
          <Text style={styles.tagline}>HR Enterprise</Text>
          {formError ? <Text style={styles.formError}>{formError}</Text> : null}
          <TextInput
            style={styles.input}
            placeholder="อีเมล"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (formError) setFormError('');
            }}
          />
          <TextInput
            style={styles.input}
            placeholder="รหัสผ่าน"
            secureTextEntry
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (formError) setFormError('');
            }}
          />
          <Pressable
            style={[styles.btn, busy && styles.btnDisabled]}
            onPress={onSubmit}
            disabled={busy}>
            {busy ? (
              <ActivityIndicator color={NatureTheme.colors.onAccent} />
            ) : (
              <Text style={styles.btnText}>เข้าสู่ระบบ</Text>
            )}
          </Pressable>
        </View>
        <Text style={styles.sub}>บัญชีถูกสร้างโดยผู้ดูแลระบบเท่านั้น</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: c.canvas },
  inner: { width: '100%', alignSelf: 'center', maxWidth: 420 },
  card: {
    backgroundColor: c.surface,
    borderRadius: r.lg,
    padding: 16,
    gap: 7,
    elevation: 3,
    shadowColor: c.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  logoWrap: { alignItems: 'center' },
  logo: { width: 84, height: 84, resizeMode: 'contain' },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', color: c.primaryDark },
  tagline: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    color: c.textSecondary,
    letterSpacing: 0.3,
  },
  sub: {
    fontSize: 13,
    color: c.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  formError: {
    fontSize: 13,
    color: c.error,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: c.surfaceElevated,
    color: c.text,
  },
  btn: {
    backgroundColor: c.primary,
    paddingVertical: 13,
    borderRadius: r.md,
    alignItems: 'center',
    marginTop: 2,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 2,
  },
  btnDisabled: { opacity: 0.65 },
  btnText: { color: c.onAccent, fontWeight: '700', fontSize: 16 },
});
