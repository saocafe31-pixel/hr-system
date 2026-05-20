import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, Theme as NavigationTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import Head from 'expo-router/head';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { AuthProvider } from '@/contexts/AuthContext';
import { CuteToastProvider } from '@/contexts/CuteToastContext';
import { NatureTheme } from '@/constants/Theme';

const nc = NatureTheme.colors;

const FoliageNavigationTheme: NavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: nc.primary,
    background: nc.canvas,
    card: nc.surface,
    text: nc.text,
    border: nc.borderSoft,
    notification: nc.checkIn,
  },
};

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <CuteToastProvider>
          <RootLayoutNav />
        </CuteToastProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  return (
    <ThemeProvider value={FoliageNavigationTheme}>
      <StatusBar style="light" />
      {Platform.OS === 'web' ? (
        <Head>
          <link rel="manifest" href="/manifest.json" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          <link rel="icon" type="image/png" href="/apple-touch-icon.png" />
          <meta name="theme-color" content="#121212" />
          <meta name="apple-mobile-web-app-title" content="FOLIAGE" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
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
