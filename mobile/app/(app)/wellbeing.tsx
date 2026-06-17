import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  averageScoreByBangkokDay,
  bangkokCalendarDateString,
  bangkokDayUtcRangeISO,
  bangkokMonthBounds,
  bangkokWeekMonday,
  enumerateBangkokDays,
  fetchMyWellbeingInRange,
} from '@/lib/wellbeing';

const BAR_H = 112;

export default function WellbeingScreen() {
  const { session } = useAuth();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const styles = useMemo(() => createWellbeingStyles(theme), [theme]);
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [points, setPoints] = useState<
    { key: string; avg: number | null; short: string }[]
  >([]);

  const load = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) {
      setLoading(false);
      setPoints([]);
      setErr(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const today = bangkokCalendarDateString();
      let startDay: string;
      let endDay: string;
      if (mode === 'week') {
        startDay = bangkokWeekMonday(today);
        const mon = new Date(`${startDay}T12:00:00+07:00`);
        endDay = bangkokCalendarDateString(
          new Date(mon.getTime() + 6 * 86400000)
        );
      } else {
        const b = bangkokMonthBounds(today);
        startDay = b.first;
        endDay = b.last;
      }
      const { start } = bangkokDayUtcRangeISO(startDay);
      const { end } = bangkokDayUtcRangeISO(endDay);
      const rows = await fetchMyWellbeingInRange(uid, start, end);
      const avgMap = averageScoreByBangkokDay(rows);
      const keys = enumerateBangkokDays(startDay, endDay);
      setPoints(
        keys.map((key) => {
          const d = new Date(`${key}T12:00:00+07:00`);
          const short = new Intl.DateTimeFormat('th-TH', {
            weekday: 'short',
            day: 'numeric',
          }).format(d);
          const v = avgMap[key];
          return {
            key,
            avg: v === undefined ? null : v,
            short,
          };
        })
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id, mode]);

  useEffect(() => {
    load();
  }, [load]);

  const overallAvg =
    points.length === 0
      ? null
      : (() => {
          const vals = points.map((p) => p.avg).filter((v): v is number => v != null);
          if (!vals.length) return null;
          return vals.reduce((a, b) => a + b, 0) / vals.length;
        })();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.lead}>
        คะแนนเฉลี่ยต่อวัน (1–5) จากการตอบคำถามตอนเข้า-ออกงาน หลายครั้งในวันเดียวกันจะถูกเฉลี่ย
      </Text>

      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggle, mode === 'week' && styles.toggleOn]}
          onPress={() => setMode('week')}>
          <Text style={[styles.toggleText, mode === 'week' && styles.toggleTextOn]}>
            รายสัปดาห์
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggle, mode === 'month' && styles.toggleOn]}
          onPress={() => setMode('month')}>
          <Text style={[styles.toggleText, mode === 'month' && styles.toggleTextOn]}>
            รายเดือน
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerPad}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : err ? (
        <Text style={styles.err}>{err}</Text>
      ) : (
        <>
          {overallAvg != null ? (
            <Text style={styles.summary}>
              เฉลี่ยในช่วงนี้:{' '}
              <Text style={styles.summaryNum}>{overallAvg.toFixed(2)}</Text> / 5
            </Text>
          ) : (
            <Text style={styles.muted}>ยังไม่มีข้อมูลในช่วงนี้</Text>
          )}

          <View
            style={[
              styles.chartRow,
              mode === 'month' && styles.chartRowMonth,
            ]}>
            {points.map((p) => {
              const h =
                p.avg == null ? 4 : Math.max(8, (p.avg / 5) * BAR_H);
              return (
                <View
                  key={p.key}
                  style={[
                    styles.barCol,
                    mode === 'week' ? styles.barColWeek : styles.barColMonth,
                  ]}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          height: h,
                          backgroundColor:
                            p.avg == null ? c.borderSoft : c.primaryMuted,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.barLabel} numberOfLines={2}>
                    {p.short}
                  </Text>
                  <Text style={styles.barVal}>
                    {p.avg == null ? '—' : p.avg.toFixed(1)}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function createWellbeingStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;
  const s = theme.spacing;

  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  content: { padding: s.screen, paddingBottom: s.scrollBottom },
  lead: {
    fontSize: 13,
    color: c.textSecondary,
    lineHeight: 20,
    marginBottom: 10,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: s.gap,
    marginBottom: s.section,
  },
  toggle: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
  },
  toggleOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primary,
  },
  toggleText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  toggleTextOn: { color: c.primaryDark },
  centerPad: { paddingVertical: 28, alignItems: 'center' },
  err: { color: c.error, fontSize: 14 },
  muted: { fontSize: 14, color: c.textMuted, marginBottom: 8 },
  summary: { fontSize: 15, color: c.text, marginBottom: 10 },
  summaryNum: { fontWeight: '800', color: c.primaryDark },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 8,
  },
  chartRowMonth: {
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    rowGap: 10,
  },
  barCol: {
    alignItems: 'center',
  },
  barColWeek: { flex: 1, minWidth: 0 },
  barColMonth: { width: 36, marginBottom: 4 },
  barTrack: {
    width: '100%',
    maxWidth: 40,
    height: BAR_H,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barFill: {
    width: '100%',
    borderRadius: 6,
    minHeight: 4,
  },
  barLabel: {
    fontSize: 10,
    color: c.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
  barVal: {
    fontSize: 10,
    color: c.textSecondary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  });
}
