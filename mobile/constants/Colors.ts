import { NatureTheme } from '@/constants/Theme';

const c = NatureTheme.colors;

/** สำหรับ useColorScheme + ไอคอนแท็บ — โทนเดียวกับธีม FOLIAGE Dark */
export default {
  light: {
    text: c.text,
    background: c.canvas,
    tint: c.tint,
    tabIconDefault: c.textMuted,
    tabIconSelected: c.tint,
  },
  dark: {
    text: c.text,
    background: c.canvas,
    tint: c.tint,
    tabIconDefault: c.textMuted,
    tabIconSelected: c.tint,
  },
};
