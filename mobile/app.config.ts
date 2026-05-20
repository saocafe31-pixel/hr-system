import type { ExpoConfig } from 'expo/config';

export default ({ config }: { config: ExpoConfig }): ExpoConfig => ({
  ...config,
  name: 'FOLIAGE',
  slug: 'foliage',
  ios: {
    ...config.ios,
    bundleIdentifier: config.ios?.bundleIdentifier ?? 'com.chaijunla.foliage',
    infoPlist: {
      ...(config.ios?.infoPlist ?? {}),
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  /** PWA / “เพิ่มไปหน้าโฮม”: บังคับเปิดที่ / เสมอ ไม่ผูกกับ URL deployment แบบ preview */
  web: {
    ...config.web,
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/app-brand-icon.png',
    name: 'FOLIAGE',
    shortName: 'FOLIAGE',
    lang: 'th',
    startUrl: '/',
    scope: '/',
    display: 'standalone',
    themeColor: '#121212',
    backgroundColor: '#121212',
    orientation: 'portrait',
    barStyle: 'light',
    preferRelatedApplications: false,
  },
  extra: {
    ...config.extra,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    webPushVapidPublicKey: process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY,
    eas: {
      projectId:
        process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
        process.env.EAS_PROJECT_ID ??
        'e37e3bf4-f3d4-4e04-a195-2da8cb861203',
    },
  },
  plugins: [
    ...(config.plugins ?? []),
    'react-native-compressor',
    '@react-native-community/datetimepicker',
    [
      'expo-notifications',
      {
        icon: './assets/images/app-brand-icon.png',
        color: '#2E7D32',
        sounds: [],
        defaultChannel: 'default',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'แอปใช้ตำแหน่งเพื่อบันทึกเวลาเข้า-ออกงานในพื้นที่สาขา',
      },
    ],
  ],
});
