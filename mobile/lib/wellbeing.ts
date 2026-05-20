import { supabase } from '@/lib/supabase';

export type WellbeingMoodKey =
  | 'ready_great'
  | 'relaxed_ready'
  | 'ok_start'
  | 'tired_fight'
  | 'unwell';

export type WellbeingMoodOption = {
  key: WellbeingMoodKey;
  label: string;
  emoji: string;
  /** 1 = ต่ำสุด … 5 = พร้อมมาก — ใช้เฉลี่ยเป็นกราฟ */
  score: number;
};

export const WELLBEING_MOOD_OPTIONS: WellbeingMoodOption[] = [
  {
    key: 'ready_great',
    label: 'สบายดี ฉันพร้อมทำงานมากๆ',
    emoji: '🌟',
    score: 5,
  },
  {
    key: 'relaxed_ready',
    label: 'สบายๆ พร้อมทำงานได้เลย',
    emoji: '😊',
    score: 4,
  },
  {
    key: 'ok_start',
    label: 'โอเค เริ่มงานกันเถอะ',
    emoji: '👍',
    score: 3,
  },
  {
    key: 'tired_fight',
    label: 'เหมือนจะไม่ไหว แต่ก็สู้',
    emoji: '🌿',
    score: 2,
  },
  {
    key: 'unwell',
    label: 'ฉันน่าจะป่วย ไม่ค่อยพร้อมสักเท่าไหร่',
    emoji: '🤒',
    score: 1,
  },
];

/** วันที่ปฏิทินแบบ YYYY-MM-DD ตามเขต Asia/Bangkok */
export function bangkokCalendarDateString(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function bangkokDayUtcRangeISO(dayStr: string): { start: string; end: string } {
  const start = new Date(`${dayStr}T00:00:00+07:00`);
  const end = new Date(`${dayStr}T23:59:59.999+07:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function todayBangkokRangeISO(): { start: string; end: string } {
  return bangkokDayUtcRangeISO(bangkokCalendarDateString());
}

export function nameWithMoodEmoji(
  displayName: string,
  emoji: string | null | undefined
): string {
  const e = emoji?.trim();
  if (!e) return displayName;
  return `${displayName} ${e}`;
}

/** แปลงเวลา UTC เป็นวันที่ Bangkok YYYY-MM-DD */
export function utcToBangkokDayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** อิโมจิล่าสุดของแต่ละ user ในวันนี้ (Bangkok) */
export async function fetchLatestTodayEmojiByUserIds(
  userIds: string[]
): Promise<Record<string, string>> {
  if (!userIds.length) return {};
  const { start, end } = todayBangkokRangeISO();
  const { data, error } = await supabase
    .from('wellbeing_checkins')
    .select('user_id, emoji, created_at')
    .in('user_id', userIds)
    .gte('created_at', start)
    .lte('created_at', end)
    .order('created_at', { ascending: false });

  if (error || !data) return {};

  const map: Record<string, string> = {};
  for (const row of data as { user_id: string; emoji: string }[]) {
    if (map[row.user_id] === undefined) map[row.user_id] = row.emoji;
  }
  return map;
}

export type WellbeingCheckinRow = {
  created_at: string;
  score: number;
};

/** โหลดบันทึกในช่วง ISO สำหรับกราฟของตัวเอง */
export async function fetchMyWellbeingInRange(
  userId: string,
  startISO: string,
  endISO: string
): Promise<WellbeingCheckinRow[]> {
  const { data, error } = await supabase
    .from('wellbeing_checkins')
    .select('created_at, score')
    .eq('user_id', userId)
    .gte('created_at', startISO)
    .lte('created_at', endISO)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data as WellbeingCheckinRow[]) ?? [];
}

/** เฉลี่ยคะแนนต่อวัน (Bangkok) */
export function averageScoreByBangkokDay(
  rows: WellbeingCheckinRow[]
): Record<string, number> {
  const buckets: Record<string, number[]> = {};
  for (const r of rows) {
    const day = utcToBangkokDayKey(r.created_at);
    if (!buckets[day]) buckets[day] = [];
    buckets[day].push(r.score);
  }
  const out: Record<string, number> = {};
  for (const [day, scores] of Object.entries(buckets)) {
    const sum = scores.reduce((a, b) => a + b, 0);
    out[day] = sum / scores.length;
  }
  return out;
}

/** จันทร์ของสัปดาห์ที่มีวัน `dayStr` (YYYY-MM-DD) ใน timezone Bangkok */
export function bangkokWeekMonday(dayStr: string): string {
  const d = new Date(`${dayStr}T12:00:00+07:00`);
  const long = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long',
  }).format(d);
  const daysFromMonday: Record<string, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
  };
  const n = daysFromMonday[long] ?? 0;
  const dayMs = 86400000;
  return bangkokCalendarDateString(new Date(d.getTime() - n * dayMs));
}

/** รายการ YYYY-MM-DD ตั้งแต่ start ถึง end (รวม) */
export function enumerateBangkokDays(startDayStr: string, endDayStr: string): string[] {
  const out: string[] = [];
  let cur = startDayStr;
  const dayMs = 86400000;
  while (cur <= endDayStr) {
    out.push(cur);
    const next = new Date(`${cur}T12:00:00+07:00`);
    cur = bangkokCalendarDateString(new Date(next.getTime() + dayMs));
    if (out.length > 400) break;
  }
  return out;
}

/** วันแรก/วันสุดท้ายของเดือนที่มีวัน `dayStr` (Bangkok) */
export function bangkokMonthBounds(dayStr: string): { first: string; last: string } {
  const [y, m] = dayStr.split('-').map(Number);
  const first = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0, 12, 0, 0)).getUTCDate();
  const last = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { first, last };
}
