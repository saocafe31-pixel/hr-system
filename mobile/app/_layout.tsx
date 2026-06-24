import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  DarkTheme,
  DefaultTheme,
  Theme as NavigationTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';
import Head from 'expo-router/head';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { AppLoadingScreen } from '@/components/AppLoadingScreen';
import { AppThemeProvider, useAppTheme } from '@/contexts/AppThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { CuteToastProvider } from '@/contexts/CuteToastContext';
import { PrintDocumentPreviewProvider } from '@/contexts/PrintDocumentPreviewContext';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

if (Platform.OS !== 'web') {
  void SplashScreen.preventAutoHideAsync();
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded && Platform.OS !== 'web') {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return <AppLoadingScreen title="กำลังเปิดเว็บแอป" />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <AuthProvider>
          <CuteToastProvider>
            <PrintDocumentPreviewProvider>
              <RootLayoutNav />
            </PrintDocumentPreviewProvider>
          </CuteToastProvider>
        </AuthProvider>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const { themeId, theme } = useAppTheme();
  const nc = theme.colors;
  const isLightTheme = themeId === 'foliageLight';
  const navigationTheme = useMemo<NavigationTheme>(
    () => ({
      ...(isLightTheme ? DefaultTheme : DarkTheme),
      colors: {
        ...(isLightTheme ? DefaultTheme.colors : DarkTheme.colors),
        primary: nc.primary,
        background: nc.canvas,
        card: nc.surface,
        text: nc.text,
        border: nc.borderSoft,
        notification: nc.checkIn,
      },
    }),
    [isLightTheme, nc]
  );

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={isLightTheme ? 'dark' : 'light'} />
      {Platform.OS === 'web' ? (
        <Head>
          <link rel="manifest" href="/manifest.json" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          <link rel="icon" type="image/png" href="/apple-touch-icon.png" />
          <meta name="theme-color" content={nc.canvas} />
          <meta name="apple-mobile-web-app-title" content="FOLIAGE" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta
            name="apple-mobile-web-app-status-bar-style"
            content={isLightTheme ? 'default' : 'black-translucent'}
          />
          <meta name="mobile-web-app-capable" content="yes" />
        </Head>
      ) : null}
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: nc.surface },
          headerTintColor: nc.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: nc.canvas },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'เข้าสู่ระบบ' }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
