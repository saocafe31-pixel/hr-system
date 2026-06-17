/**
 * FOLIAGE — โทนธีมหลักของแอป
 * อ้างอิงจากแบรนด์แอป / สแปลชจอ
 */
export const ClassicDarkTheme = {
  colors: {
    /** พื้นหลังหลัก */
    canvas: '#121212',
    /** การ์ด / พื้นผิว */
    surface: '#252525',
    surfaceElevated: '#2C2C2C',
    surfaceMuted: '#1A1A1A',
    border: 'rgba(255,255,255,0.14)',
    borderSoft: 'rgba(255,255,255,0.08)',
    /** ข้อความ */
    text: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.78)',
    textMuted: 'rgba(255,255,255,0.52)',
    /** แบรนด์ / ปุ่มหลัก */
    primary: '#A6B874',
    primaryMuted: '#8FA663',
    primaryLight: 'rgba(166, 184, 116, 0.18)',
    primaryDark: '#C5D4A0',
    /** ทองนวล — ขอบ / ไฮไลต์ */
    accentWarm: '#C2A86B',
    accentWarmLight: 'rgba(194, 168, 107, 0.16)',
    /** เข้างาน */
    checkIn: '#9BAD6E',
    /** แชท / โทนน้ำ */
    river: '#6E908A',
    riverLight: 'rgba(110, 144, 138, 0.18)',
    /** ลาป่วย — แถบเน้นแชทเข้า-ออก */
    leaveSickBar: '#9B86C4',
    leaveSickBg: 'rgba(155, 134, 196, 0.2)',
    /** ขอเข้าสาย — แชทเข้า-ออก (แถบส้ม) */
    lateNoticeBar: '#E08A4F',
    lateNoticeBg: 'rgba(224, 138, 79, 0.18)',
    lateNoticeHeaderBg: 'rgba(224, 138, 79, 0.32)',
    /** แท็บบาร์ */
    tabBar: '#1A1A1A',
    tabBarBorder: 'rgba(255,255,255,0.08)',
    tint: '#A6B874',
    /** ข้อผิดพลาด */
    error: '#E57373',
    errorBg: 'rgba(229, 115, 115, 0.14)',
    /** การ์ดเตือน */
    warningBg: 'rgba(194, 168, 107, 0.12)',
    warningBorder: 'rgba(194, 168, 107, 0.38)',
    warningTitle: '#E8D4B0',
    warningBody: 'rgba(255,255,255,0.75)',
    warningHint: 'rgba(255,255,255,0.48)',
    overlay: 'rgba(0, 0, 0, 0.75)',
    shadow: '#000000',
    /** ชิป / แท็ก */
    chip: '#2F2F2F',
    chipActive: 'rgba(166, 184, 116, 0.24)',
    chipText: 'rgba(255,255,255,0.65)',
    chipTextActive: '#D4E4B8',
    /** ลิงก์ / แอดมิน */
    link: '#9BB8D6',
    linkLight: 'rgba(155, 184, 214, 0.14)',
    /** ข้อความบนปุ่มสี accent */
    onAccent: '#FFFFFF',
  },
  radius: {
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
  },
  spacing: {
    screen: 12,
    section: 8,
    card: 10,
    gap: 7,
    gapRow: 8,
    scrollBottom: 28,
  },
} as const;

export type AppThemeId = 'classicDark' | 'foliageLight';

export const FoliageLightTheme = {
  colors: {
    /** พื้นหลังหลัก — โทนขาวสะอาดตามภาพแบรนด์ */
    canvas: '#F8FAF1',
    /** การ์ด / พื้นผิว */
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceMuted: '#F1F5DF',
    border: 'rgba(143, 164, 59, 0.48)',
    borderSoft: 'rgba(143, 164, 59, 0.28)',
    /** ข้อความ */
    text: '#25311F',
    textSecondary: 'rgba(37, 49, 31, 0.74)',
    textMuted: 'rgba(37, 49, 31, 0.48)',
    /** แบรนด์ / ปุ่มหลัก */
    primary: '#A9BB4F',
    primaryMuted: '#8FA43B',
    primaryLight: 'rgba(169, 187, 79, 0.24)',
    primaryDark: '#6F842E',
    /** ทองนวล — ขอบ / ไฮไลต์ */
    accentWarm: '#D0AD61',
    accentWarmLight: 'rgba(208, 173, 97, 0.18)',
    /** เข้างาน */
    checkIn: '#9FB348',
    /** แชท / โทนน้ำ */
    river: '#5E9E91',
    riverLight: 'rgba(94, 158, 145, 0.14)',
    /** ลาป่วย — แถบเน้นแชทเข้า-ออก */
    leaveSickBar: '#9277C9',
    leaveSickBg: 'rgba(146, 119, 201, 0.14)',
    /** ขอเข้าสาย — แชทเข้า-ออก (แถบส้ม) */
    lateNoticeBar: '#E49353',
    lateNoticeBg: 'rgba(228, 147, 83, 0.14)',
    lateNoticeHeaderBg: 'rgba(228, 147, 83, 0.24)',
    /** แท็บบาร์ */
    tabBar: '#FFFFFF',
    tabBarBorder: 'rgba(143, 164, 59, 0.3)',
    tint: '#8FA43B',
    /** ข้อผิดพลาด */
    error: '#C95C5C',
    errorBg: 'rgba(201, 92, 92, 0.12)',
    /** การ์ดเตือน */
    warningBg: 'rgba(208, 173, 97, 0.14)',
    warningBorder: 'rgba(208, 173, 97, 0.34)',
    warningTitle: '#9A7430',
    warningBody: 'rgba(37, 49, 31, 0.7)',
    warningHint: 'rgba(37, 49, 31, 0.46)',
    overlay: 'rgba(37, 49, 31, 0.42)',
    shadow: '#7B8742',
    /** ชิป / แท็ก */
    chip: '#EEF3D8',
    chipActive: 'rgba(175, 194, 90, 0.24)',
    chipText: 'rgba(37, 49, 31, 0.62)',
    chipTextActive: '#6F842E',
    /** ลิงก์ / แอดมิน */
    link: '#517DA8',
    linkLight: 'rgba(81, 125, 168, 0.12)',
    /** ข้อความบนปุ่มสี accent */
    onAccent: '#FFFFFF',
  },
  radius: ClassicDarkTheme.radius,
  spacing: ClassicDarkTheme.spacing,
} as const;

/**
 * Theme base เดิมสำหรับไฟล์ที่ยังใช้ StyleSheet แบบ static อยู่
 * ต้องคงเป็น Premium Dark เพื่อให้ตัวเลือก "ธีมเดิม" กลับไปโทนดำเดิมจริง
 */
export const NatureTheme = ClassicDarkTheme;

export const AppThemes = {
  classicDark: ClassicDarkTheme,
  foliageLight: FoliageLightTheme,
} as const;

export type AppTheme = (typeof AppThemes)[AppThemeId];
