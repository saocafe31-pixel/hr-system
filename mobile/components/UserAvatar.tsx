import { Image, StyleSheet, Text, View } from 'react-native';

import { NatureTheme } from '@/constants/Theme';

type Props = {
  uri?: string | null;
  /** ใช้สร้างตัวอักษรย่อเมื่อไม่มีรูป */
  label?: string | null;
  size?: number;
};

export function UserAvatar({ uri, label, size = 44 }: Props) {
  const initial = (label?.trim() || '?').slice(0, 1).toUpperCase();
  const r = size / 2;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.img, { width: size, height: size, borderRadius: r }]}
        accessibilityLabel="รูปโปรไฟล์"
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: r },
      ]}>
      <Text style={[styles.initial, { fontSize: Math.max(12, size * 0.38) }]}>
        {initial}
      </Text>
    </View>
  );
}

const c = NatureTheme.colors;

const styles = StyleSheet.create({
  img: { backgroundColor: c.borderSoft },
  fallback: {
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontWeight: '700', color: c.primaryDark },
});
