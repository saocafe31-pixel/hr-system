/**
 * FOLIAGE — โทน Premium Dark (พื้นเข้ม เขียวมะกอก #A6B874 ไฮไลต์ทอง #C2A86B)
 * อ้างอิงจากแบรนด์แอป / สแปลชจอ
 */
export const NatureTheme = {
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
