import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppLoadingScreen } from '@/components/AppLoadingScreen';
import { NatureTheme } from '@/constants/Theme';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseConfigured } from '@/lib/supabase';

export default function Index() {
  const { session, loading } = useAuth();

  if (!supabaseConfigured) {
    return (
      <View style={styles.center}>
        <Text style={styles.warn}>
          ตั้งค่า EXPO_PUBLIC_SUPABASE_URL และ EXPO_PUBLIC_SUPABASE_ANON_KEY ในไฟล์ .env
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <AppLoadingScreen title="กำลังเปิดเว็บแอป" />
    );
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  return <Redirect href="/attendance" />;
}

const c = NatureTheme.colors;

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    backgroundColor: c.canvas,
  },
  warn: { textAlign: 'center', fontSize: 16, color: c.textSecondary },
});
