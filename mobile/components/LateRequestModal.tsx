import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DatePickerField } from '@/components/DatePickerField';
import { NatureTheme, type AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { buildLateAttendanceChatBody } from '@/lib/leaveAttendanceChat';
import {
  LATE_MAX_MINUTES,
  LATE_MAX_PER_MONTH,
  lateQuotaPeriodBoundsFromWorkYmd,
} from '@/lib/leaveLateRules';
import { supabase } from '@/lib/supabase';
import { dateToBangkokYmd } from '@/lib/taskHelpers';

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;
const WEB_MODAL_BACKDROP = Platform.select({
  web: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1_000_000,
  },
  default: {},
});

type LateQuotaUsage = {
  count: number;
  minutes: number;
};

function parseBangkokYmdToLocalDate(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

type Props = {
  visible: boolean;
  onClose: () => void;
  userId: string;
  /** ชื่อที่แสดงในแชทเข้า-ออก */
  applicantDisplayName: string;
  /** วันที่ทำงานที่ขอสาย (YYYY-MM-DD) เริ่มต้น = วันนี้โซนกรุงเทพ */
  defaultWorkDateYmd: string;
  onSubmitted?: () => void;
};

export function LateRequestModal({
  visible,
  onClose,
  userId,
  applicantDisplayName,
  defaultWorkDateYmd,
  onSubmitted,
}: Props) {
  const toast = useCuteToast();
  const { theme } = useAppTheme();
  const tc = theme.colors;
  const themed = useMemo(() => createLateModalThemeStyles(tc), [tc]);
  const [workDate, setWorkDate] = useState<Date | null>(() =>
    parseBangkokYmdToLocalDate(defaultWorkDateYmd)
  );
  const [minutes, setMinutes] = useState('15');
  const [note, setNote] = useState('');
  const [countThisCycle, setCountThisCycle] = useState(0);
  const [minutesThisCycle, setMinutesThisCycle] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const quotaToastShownRef = useRef(false);

  const remainingMinutes = Math.max(0, LATE_MAX_MINUTES - minutesThisCycle);
  const quotaFull =
    countThisCycle >= LATE_MAX_PER_MONTH || minutesThisCycle >= LATE_MAX_MINUTES;

  useEffect(() => {
    if (!quotaFull) quotaToastShownRef.current = false;
  }, [quotaFull]);

  useEffect(() => {
    if (!visible) {
      quotaToastShownRef.current = false;
      return;
    }
    if (loading || !quotaFull || quotaToastShownRef.current) return;
    quotaToastShownRef.current = true;
    toast.info(
      'ใช้สิทธิขอเข้าสายครบแล้ว',
      `รอบ 26–25 ของวันที่เลือกใช้ครบ ${LATE_MAX_PER_MONTH} ครั้งหรือ ${LATE_MAX_MINUTES} นาทีแล้ว — ไม่สามารถบันทึกเพิ่มได้`
    );
  }, [visible, loading, quotaFull, toast]);

  const fetchQuotaUsage = useCallback(
    async (ymd: string): Promise<LateQuotaUsage | null> => {
      const { lo, hi } = lateQuotaPeriodBoundsFromWorkYmd(ymd);
      const { data, count, error } = await supabase
        .from('late_requests')
        .select('minutes_late', { count: 'exact' })
        .eq('user_id', userId)
        .gte('work_date', lo)
        .lte('work_date', hi);
      if (error) return null;
      const rows = (data as { minutes_late: number }[]) ?? [];
      const usedMinutes = rows.reduce((sum, r) => {
        const n = Number(r.minutes_late);
        return Number.isFinite(n) && n > 0 ? sum + n : sum;
      }, 0);
      return { count: count ?? rows.length, minutes: usedMinutes };
    },
    [userId]
  );

  const refreshCount = useCallback(async () => {
    const ymd = workDate
      ? dateToBangkokYmd(workDate)
      : defaultWorkDateYmd.trim();
    const usage = await fetchQuotaUsage(ymd);
    if (!usage) {
      setCountThisCycle(0);
      setMinutesThisCycle(0);
      return;
    }
    setCountThisCycle(usage.count);
    setMinutesThisCycle(usage.minutes);
  }, [workDate, defaultWorkDateYmd, fetchQuotaUsage]);

  useEffect(() => {
    if (visible) setWorkDate(parseBangkokYmdToLocalDate(defaultWorkDateYmd));
  }, [visible, defaultWorkDateYmd]);

  useLayoutEffect(() => {
    if (visible) setLoading(true);
  }, [visible]);

  useEffect(() => {
    if (!visible || !userId) return;
    setLoading(true);
    void (async () => {
      await refreshCount();
      setLoading(false);
    })();
  }, [visible, userId, refreshCount]);

  useEffect(() => {
    if (!visible || !userId) return;
    void refreshCount();
  }, [visible, userId, workDate, refreshCount]);

  async function submit() {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m < 1 || m > LATE_MAX_MINUTES) {
      toast.info(
        'นาทีสาย',
        `ต้องเป็นตัวเลข 1–${LATE_MAX_MINUTES} (ไม่เกิน 30 นาทีต่อครั้ง)`
      );
      return;
    }
    if (!workDate) {
      toast.info('วันที่', 'เลือกวันที่ทำงานจากปฏิทิน');
      return;
    }
    const workYmd = dateToBangkokYmd(workDate);
    const usage = await fetchQuotaUsage(workYmd);
    const usedCount = usage?.count ?? countThisCycle;
    const usedMinutes = usage?.minutes ?? minutesThisCycle;
    const remaining = Math.max(0, LATE_MAX_MINUTES - usedMinutes);
    if (usedCount >= LATE_MAX_PER_MONTH || usedMinutes >= LATE_MAX_MINUTES) {
      toast.info(
        'ใช้สิทธิครบแล้ว',
        `ขอเข้าสายได้ไม่เกิน ${LATE_MAX_PER_MONTH} ครั้งหรือรวม ${LATE_MAX_MINUTES} นาทีต่อรอบ 26–25`
      );
      return;
    }
    if (m > remaining) {
      toast.info(
        'นาทีเกินสิทธิ์คงเหลือ',
        `รอบนี้เหลือสิทธิ์ขอเข้าสายอีก ${remaining} นาที`
      );
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('late_requests').insert({
        user_id: userId,
        work_date: workYmd,
        minutes_late: m,
        note: note.trim() || null,
      });
      if (error) throw new Error(error.message);
      const chatBody = buildLateAttendanceChatBody({
        applicantName: applicantDisplayName.trim() || 'พนักงาน',
        workDateYmd: workYmd,
        minutesLate: m,
        note: note.trim() || null,
      });
      const { error: chatErr } = await supabase
        .from('attendance_chat_messages')
        .insert({ user_id: userId, body: chatBody });
      if (chatErr) {
        toast.info(
          'แจ้งทีมไม่สำเร็จ',
          'บันทึกขอเข้าสายแล้ว แต่ส่งแชทเข้า-ออกไม่ได้ — ลองแจ้งทีมด้วยตนเอง'
        );
      }
      onClose();
      onSubmitted?.();
      setNote('');
      setMinutes('15');
      void refreshCount();
      queueMicrotask(() => {
        toast.success('บันทึกขอเข้าสายแล้ว', 'ขอให้ทันเวลามากขึ้นนะ ⏱️');
      });
    } catch (e) {
      toast.error(
        'บันทึกไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent>
      <View style={[styles.backdrop, themed.backdrop, WEB_MODAL_BACKDROP]}>
        <View style={[styles.card, themed.card]}>
          <Text style={[styles.title, themed.title]}>ขอเข้าสาย</Text>
          <Text style={[styles.sub, themed.sub]}>
            ใช้ได้ไม่เกิน {LATE_MAX_PER_MONTH} ครั้งหรือรวม {LATE_MAX_MINUTES}{' '}
            นาทีต่อรอบ 26–25 (ยึดอย่างใดอย่างหนึ่งถึงก่อน)
          </Text>
          {loading ? (
            <ActivityIndicator color={tc.primary} style={{ marginVertical: 20 }} />
          ) : quotaFull ? (
            <View>
              <Text style={[styles.meta, themed.meta]}>
                รอบ 26–25 ของวันที่เลือก: ใช้ไปแล้ว {countThisCycle} /{' '}
                {LATE_MAX_PER_MONTH} ครั้ง · {minutesThisCycle} / {LATE_MAX_MINUTES}{' '}
                นาที
              </Text>
              <Text style={[styles.quotaBanner, themed.quotaBanner]}>
                ใช้สิทธิขอเข้าสายครบแล้ว — ไม่สามารถบันทึกเพิ่มในรอบนี้ได้
              </Text>
              <Pressable style={[styles.btnCloseFull, themed.btnCloseFull]} onPress={onClose}>
                <Text style={[styles.btnCloseFullText, themed.btnCloseFullText]}>ปิด</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[styles.meta, themed.meta]}>
                รอบ 26–25 ของวันที่เลือก: ใช้ไปแล้ว {countThisCycle} /{' '}
                {LATE_MAX_PER_MONTH} ครั้ง · {minutesThisCycle} / {LATE_MAX_MINUTES}{' '}
                นาที · เหลือ {remainingMinutes} นาที
              </Text>
              <DatePickerField
                label="วันที่ทำงาน"
                value={workDate}
                onChange={(d) => setWorkDate(d ?? parseBangkokYmdToLocalDate(defaultWorkDateYmd))}
                disabled={saving}
              />
              <Text style={[styles.label, themed.label]}>นาทีที่ขอ (1–{remainingMinutes})</Text>
              <TextInput
                style={[styles.input, themed.input]}
                value={minutes}
                onChangeText={setMinutes}
                keyboardType="number-pad"
                placeholder="15"
                placeholderTextColor={tc.textMuted}
              />
              <Text style={[styles.label, themed.label]}>หมายเหตุ (ถ้ามี)</Text>
              <TextInput
                style={[styles.input, themed.input, styles.tall]}
                value={note}
                onChangeText={setNote}
                placeholder="เช่น รถติด / ฝนตก"
                placeholderTextColor={tc.textMuted}
                multiline
              />
              <View style={styles.actions}>
                <Pressable style={[styles.btnGhost, themed.btnGhost]} onPress={onClose}>
                  <Text style={[styles.btnGhostText, themed.btnGhostText]}>ปิด</Text>
                </Pressable>
                <Pressable
                  style={[styles.btnPrimary, themed.btnPrimary, saving && styles.disabled]}
                  disabled={saving}
                  onPress={() => void submit()}>
                  <Text style={styles.btnPrimaryText}>
                    {saving ? 'กำลังบันทึก…' : 'บันทึก'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function createLateModalThemeStyles(colors: AppTheme['colors']) {
  return StyleSheet.create({
    backdrop: { backgroundColor: colors.overlay },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1.5,
    },
    title: { color: colors.text },
    sub: { color: colors.textMuted },
    meta: { color: colors.primaryDark },
    quotaBanner: {
      backgroundColor: colors.warningBg,
      borderColor: colors.warningBorder,
      color: colors.warningTitle,
    },
    btnCloseFull: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderWidth: 1.5,
    },
    btnCloseFullText: { color: colors.text },
    label: { color: colors.textSecondary },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      color: colors.text,
    },
    btnGhost: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderWidth: 1.5,
    },
    btnGhostText: { color: colors.text },
    btnPrimary: { backgroundColor: colors.primaryDark },
  });
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: c.surfaceElevated,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    paddingHorizontal: s.screen + 4,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
    textAlign: 'center',
  },
  sub: {
    fontSize: 11,
    color: c.textMuted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 10,
    lineHeight: 16,
  },
  meta: { fontSize: 12, color: c.primaryDark, marginBottom: 8 },
  quotaBanner: {
    fontSize: 14,
    fontWeight: '600',
    color: c.warningTitle,
    lineHeight: 20,
    marginBottom: 16,
    padding: 12,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.warningBorder,
    backgroundColor: c.warningBg,
  },
  btnCloseFull: {
    paddingVertical: 14,
    borderRadius: r.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  btnCloseFullText: { color: c.text, fontWeight: '700', fontSize: 15 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: c.textSecondary,
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 10,
    color: c.text,
    backgroundColor: c.surface,
  },
  tall: { minHeight: 56, textAlignVertical: 'top' },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  btnGhost: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: r.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
  },
  btnGhostText: { color: c.text, fontWeight: '600' },
  btnPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: r.md,
    alignItems: 'center',
    backgroundColor: c.checkIn,
  },
  btnPrimaryText: { color: c.onAccent, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
