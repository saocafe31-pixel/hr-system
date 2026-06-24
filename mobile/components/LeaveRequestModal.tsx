import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DatePickerField } from '@/components/DatePickerField';
import { NatureTheme, type AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import {
  inclusiveCalendarDays,
  personalNeedsExtraReasonAndDoc,
  sickNeedsMedicalCertificate,
  sumLeaveDaysInYear,
  PERSONAL_ANNUAL_DAYS,
  SICK_ANNUAL_DAYS,
  supplementaryNoteOk,
  type LeaveType,
} from '@/lib/leaveLateRules';
import {
  buildLeaveBroadcastFollowUpBody,
  buildLeavePendingChatBody,
} from '@/lib/leaveAttendanceChat';
import { supabase } from '@/lib/supabase';
import { dateToBangkokYmd } from '@/lib/taskHelpers';
import { pickAndUploadLeaveAttachment } from '@/lib/uploadLeaveAttachment';
import type { LeaveRequestRow, LeaveRequestType, VacationGrantRow } from '@/lib/types';

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

const WEB_LEAVE_MODAL = Platform.select({
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

type Props = {
  visible: boolean;
  onClose: () => void;
  userId: string;
  /** ปีปฏิทิน (เช่น 2026) สำหรับโควตา */
  quotaYear: number;
  onSubmitted?: () => void;
};

export function LeaveRequestModal({
  visible,
  onClose,
  userId,
  quotaYear,
  onSubmitted,
}: Props) {
  const { theme } = useAppTheme();
  const tc = theme.colors;
  const themed = useMemo(() => createLeaveModalThemeStyles(tc), [tc]);
  const toast = useCuteToast();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<LeaveRequestRow[]>([]);
  const [grant, setGrant] = useState<VacationGrantRow | null>(null);

  const [leaveType, setLeaveType] = useState<LeaveRequestType>('personal');
  const [startsOnDate, setStartsOnDate] = useState<Date | null>(null);
  const [endsOnDate, setEndsOnDate] = useState<Date | null>(null);
  const [reason, setReason] = useState('');
  const [medicalUrl, setMedicalUrl] = useState<string | null>(null);
  const [suppNote, setSuppNote] = useState('');
  const [suppDocUrl, setSuppDocUrl] = useState<string | null>(null);
  const [uploadingMed, setUploadingMed] = useState(false);
  const [uploadingSupp, setUploadingSupp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const yStart = `${quotaYear}-01-01`;
      const yEnd = `${quotaYear}-12-31`;
      const { data, error } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('user_id', userId)
        .lte('starts_on', yEnd)
        .gte('ends_on', yStart)
        .order('starts_on', { ascending: true });
      if (error) throw new Error(error.message);
      setRows((data as LeaveRequestRow[]) ?? []);

      const { data: g, error: ge } = await supabase
        .from('vacation_grants')
        .select('*')
        .eq('user_id', userId)
        .eq('year', quotaYear)
        .maybeSingle();
      if (ge) throw new Error(ge.message);
      setGrant((g as VacationGrantRow) ?? null);
    } catch (e) {
      toast.error(
        'โหลดข้อมูลลาไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setLoading(false);
    }
  }, [quotaYear, toast, userId]);

  useEffect(() => {
    if (!visible || !userId) return;
    void load();
  }, [visible, userId, load]);

  const quotaYearMin = useMemo(
    () => new Date(quotaYear, 0, 1, 12, 0, 0, 0),
    [quotaYear]
  );
  const quotaYearMax = useMemo(
    () => new Date(quotaYear, 11, 31, 12, 0, 0, 0),
    [quotaYear]
  );

  const startsOn = useMemo(
    () => (startsOnDate ? dateToBangkokYmd(startsOnDate) : ''),
    [startsOnDate]
  );
  const endsOn = useMemo(
    () => (endsOnDate ? dateToBangkokYmd(endsOnDate) : ''),
    [endsOnDate]
  );

  const approvedPersonalIntervals = useMemo(() => {
    return rows
      .filter((r) => r.leave_type === 'personal' && r.status === 'approved')
      .map((r) => ({ starts_on: r.starts_on, ends_on: r.ends_on }));
  }, [rows]);

  const sickUsed = useMemo(
    () => sumLeaveDaysInYear(rows, quotaYear, 'sick'),
    [rows, quotaYear]
  );
  const personalUsed = useMemo(
    () => sumLeaveDaysInYear(rows, quotaYear, 'personal'),
    [rows, quotaYear]
  );
  const vacationUsed = useMemo(
    () => sumLeaveDaysInYear(rows, quotaYear, 'vacation'),
    [rows, quotaYear]
  );
  const vacationGrantDays = grant?.days_granted ?? 0;
  const vacationLeft = Math.max(0, vacationGrantDays - vacationUsed);
  const sickRemaining = Math.max(0, SICK_ANNUAL_DAYS - sickUsed);
  const personalRemaining = Math.max(0, PERSONAL_ANNUAL_DAYS - personalUsed);

  const newDays =
    startsOn && endsOn ? inclusiveCalendarDays(startsOn, endsOn) : 0;

  const needSickCert =
    leaveType === 'sick' && startsOn && endsOn
      ? sickNeedsMedicalCertificate(startsOn, endsOn)
      : false;
  const needPersonalExtra =
    leaveType === 'personal' && startsOn && endsOn
      ? personalNeedsExtraReasonAndDoc(
          approvedPersonalIntervals,
          startsOn,
          endsOn
        )
      : false;

  async function submit() {
    if (!startsOnDate || !endsOnDate || !startsOn || !endsOn) {
      toast.info('กรอกวันที่', 'เลือกวันเริ่มและวันสิ้นสุดจากปฏิทิน');
      return;
    }
    if (startsOn > endsOn) {
      toast.info('วันที่ไม่ถูกต้อง', 'วันเริ่มต้องไม่เกินวันสิ้นสุด');
      return;
    }
    if (!reason.trim()) {
      toast.info('เหตุผล', 'กรุณากรอกเหตุผลการลา');
      return;
    }

    if (newDays < 1) {
      toast.info('วันที่', 'เลือกช่วงลาอย่างน้อย 1 วันปฏิทิน');
      return;
    }

    const sickRem = Math.max(0, SICK_ANNUAL_DAYS - sickUsed);
    const personalRem = Math.max(0, PERSONAL_ANNUAL_DAYS - personalUsed);

    if (leaveType === 'sick') {
      if (newDays > sickRem) {
        toast.info(
          'วันลาไม่พอ',
          `ลาป่วยคงเหลือ ${sickRem} วัน แต่ขอ ${newDays} วัน`
        );
        return;
      }
      if (needSickCert && !medicalUrl) {
        toast.info(
          'ใบรับรองแพทย์',
          'ลาป่วยติดกันเกิน 2 วัน ต้องแนบใบรับรองแพทย์ (PDF หรือรูปภาพ)'
        );
        return;
      }
    }

    if (leaveType === 'personal') {
      if (newDays > personalRem) {
        toast.info(
          'วันลาไม่พอ',
          `ลากิจคงเหลือ ${personalRem} วัน แต่ขอ ${newDays} วัน`
        );
        return;
      }
      if (needPersonalExtra) {
        if (!supplementaryNoteOk(suppNote)) {
          toast.info(
            'ลากิจติดกันเกิน 2 วัน',
            'ต้องระบุเหตุผล/รายละเอียดเพิ่มอย่างน้อย 10 ตัวอักษร (แนวธุรกิจ B)'
          );
          return;
        }
        if (!suppDocUrl) {
          toast.info(
            'เอกสารเพิ่มเติม',
            'กรณีนี้ต้องแนบเอกสารประกอบ (PDF หรือรูปภาพ)'
          );
          return;
        }
      }
    }

    if (leaveType === 'vacation') {
      if (newDays > vacationLeft) {
        toast.info(
          'วันลาพักร้อนไม่พอ',
          `คงเหลือ ${vacationLeft.toFixed(1)} วัน แต่ขอ ${newDays} วัน — ติดต่อ HR`
        );
        return;
      }
    }

    const applicantName =
      (profile?.full_name ?? '').trim() ||
      (profile?.email ?? '').trim() ||
      'พนักงาน';

    setSaving(true);
    try {
      const { data: inserted, error } = await supabase
        .from('leave_requests')
        .insert({
          user_id: userId,
          leave_type: leaveType as LeaveType,
          starts_on: startsOn,
          ends_on: endsOn,
          reason: reason.trim(),
          medical_certificate_url: leaveType === 'sick' ? medicalUrl : null,
          supplementary_note: needPersonalExtra ? suppNote.trim() : null,
          supplementary_document_url: leaveType === 'personal' ? suppDocUrl : null,
          status: 'pending',
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      const leaveId = inserted?.id as string | undefined;
      if (!leaveId) throw new Error('ไม่ได้รับรหัสคำขอลา');

      const body1 = buildLeavePendingChatBody({
        applicantName,
        leaveType,
        startsOn: startsOn,
        endsOn: endsOn,
        newDays,
        reason: reason.trim(),
        leaveId,
      });
      const body2 = buildLeaveBroadcastFollowUpBody({
        applicantName,
        leaveType,
        startsOn: startsOn,
        endsOn: endsOn,
        newDays,
      });

      const { error: c1 } = await supabase.from('attendance_chat_messages').insert({
        user_id: userId,
        body: body1,
      });
      const { error: c2 } = await supabase.from('attendance_chat_messages').insert({
        user_id: userId,
        body: body2,
      });
      if (c1 || c2) {
        toast.info(
          'แจ้งทีมบางส่วนไม่สำเร็จ',
          (c1?.message ?? c2?.message) ??
            'บันทึกคำขอลาแล้ว แต่ส่งแชทเข้า-ออกไม่ครบ — แจ้ง HR ทราบ'
        );
      }

      onClose();
      onSubmitted?.();
      setReason('');
      setStartsOnDate(null);
      setEndsOnDate(null);
      setMedicalUrl(null);
      setSuppNote('');
      setSuppDocUrl(null);
      void load();
      queueMicrotask(() => {
        toast.success(
          'ส่งคำขอลาแล้ว',
          'รอหัวหน้า/HR อนุมัติในแชทเข้า-ออก — โควตาจะหักเมื่ออนุมัติแล้ว'
        );
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

  const sheetPad = { paddingBottom: Math.max(insets.bottom, 14) + 8 };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}>
      <View style={[styles.backdrop, themed.backdrop, WEB_LEAVE_MODAL]}>
        <Pressable
          style={styles.backdropHit}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="ปิด"
        />
        <View style={[styles.card, themed.card, sheetPad]}>
          <Text style={[styles.title, themed.title]}>ลางาน</Text>
          <Text style={[styles.sub, themed.sub]}>
            ลาป่วยสูงสุด {SICK_ANNUAL_DAYS} วัน/ปี · ลากิจ {PERSONAL_ANNUAL_DAYS}{' '}
            วัน/ปี · พักร้อนตามที่ HR กำหนด — ส่งคำขอแล้วรออนุมัติ (โควตาหักเมื่ออนุมัติ)
          </Text>
          {loading ? (
            <ActivityIndicator color={tc.primary} style={{ marginVertical: 20 }} />
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.scroll}>
              <Text style={[styles.label, themed.label]}>ประเภท</Text>
              <View style={styles.rowChips}>
                {(
                  [
                    ['personal', 'ลากิจ'],
                    ['sick', 'ลาป่วย'],
                    ['vacation', 'ลาพักร้อน'],
                    ['unpaid', 'ลาไม่รับเงิน'],
                  ] as const
                ).map(([t, lab]) => (
                  <Pressable
                    key={t}
                    style={[
                      styles.chip,
                      themed.chip,
                      leaveType === t && styles.chipOn,
                      leaveType === t && themed.chipOn,
                    ]}
                    onPress={() => setLeaveType(t)}>
                    <Text
                      style={[
                        styles.chipText,
                        themed.chipText,
                        leaveType === t && styles.chipTextOn,
                        leaveType === t && themed.chipTextOn,
                      ]}>
                      {lab}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.meta, themed.meta]}>
                ปี {quotaYear} (นับเฉพาะที่อนุมัติแล้ว): ลาป่วยเหลือ {sickRemaining} วัน ·
                ลากิจเหลือ {personalRemaining} วัน · พักร้อนเหลือ{' '}
                {vacationLeft.toFixed(1)} วัน
              </Text>
              {leaveType === 'unpaid' ? (
                <Text style={[styles.warnBox, themed.warnBox]}>
                  ลาไม่รับเงินจะไม่ใช้โควต้าลา แต่จะถูกนำไปหักในสลิปเงินเดือนหลังอนุมัติ
                </Text>
              ) : null}

              <DatePickerField
                label={`วันเริ่ม (ปี ${quotaYear})`}
                value={startsOnDate}
                onChange={setStartsOnDate}
                disabled={saving}
                minimumDate={quotaYearMin}
                maximumDate={
                  endsOnDate && endsOnDate < quotaYearMax
                    ? endsOnDate
                    : quotaYearMax
                }
              />
              <DatePickerField
                label={`วันสิ้นสุด (ปี ${quotaYear})`}
                value={endsOnDate}
                onChange={setEndsOnDate}
                disabled={saving}
                minimumDate={
                  startsOnDate && startsOnDate > quotaYearMin
                    ? startsOnDate
                    : quotaYearMin
                }
                maximumDate={quotaYearMax}
              />
              {newDays > 0 ? (
                <Text style={[styles.hint, themed.hint]}>รวม {newDays} วันปฏิทิน</Text>
              ) : null}

              {leaveType === 'personal' && needPersonalExtra ? (
                <Text style={[styles.warnBox, themed.warnBox]}>
                  ลากิจแนว B: ช่วงนี้ติดกันกับลากิจที่มีแล้วเกิน 2 วัน — ต้องกรอกเหตุผลเพิ่มและแนบเอกสาร
                </Text>
              ) : null}
              {leaveType === 'sick' && needSickCert ? (
                <Text style={[styles.warnBox, themed.warnBox]}>
                  ลาป่วยติดกันเกิน 2 วัน — ต้องแนบใบรับรองแพทย์
                </Text>
              ) : null}

              <Text style={[styles.label, themed.label]}>เหตุผล</Text>
              <TextInput
                style={[styles.input, themed.input, styles.tall]}
                value={reason}
                onChangeText={setReason}
                placeholder="ระบุเหตุผล"
                placeholderTextColor={tc.textMuted}
                multiline
              />

              {leaveType === 'sick' ? (
                <>
                  <Text style={[styles.label, themed.label]}>
                    หลักฐานการลาป่วย (PDF หรือรูปภาพ)
                    {needSickCert ? ' *' : ''}
                  </Text>
                  <Pressable
                    style={[styles.uploadBtn, themed.uploadBtn]}
                    disabled={uploadingMed}
                    onPress={async () => {
                      setUploadingMed(true);
                      try {
                        const uploaded = await pickAndUploadLeaveAttachment(userId);
                        setMedicalUrl(uploaded.url);
                        toast.success('อัปโหลดแล้ว', 'แนบหลักฐานเรียบร้อย');
                      } catch (e) {
                        toast.error(
                          'อัปโหลดไม่สำเร็จ',
                          e instanceof Error ? e.message : String(e)
                        );
                      } finally {
                        setUploadingMed(false);
                      }
                    }}>
                    <Text style={[styles.uploadBtnText, themed.uploadBtnText]}>
                      {uploadingMed
                        ? 'กำลังอัปโหลด…'
                        : medicalUrl
                          ? 'เปลี่ยนไฟล์หลักฐาน'
                          : 'เลือกไฟล์ PDF / รูปภาพ'}
                    </Text>
                  </Pressable>
                </>
              ) : null}

              {leaveType === 'personal' && needPersonalExtra ? (
                <>
                  <Text style={[styles.label, themed.label]}>เหตุผล / รายละเอียดเพิ่ม (อย่างน้อย 10 ตัวอักษร)</Text>
                  <TextInput
                    style={[styles.input, themed.input, styles.tall]}
                    value={suppNote}
                    onChangeText={setSuppNote}
                    placeholder="เช่น ประชุมต่างจังหวัด / ธุระครอบครัวเร่งด่วน"
                    placeholderTextColor={tc.textMuted}
                    multiline
                  />
                </>
              ) : null}

              {leaveType === 'personal' ? (
                <>
                  <Text style={[styles.label, themed.label]}>
                    หลักฐานการลากิจ (PDF หรือรูปภาพ)
                    {needPersonalExtra ? ' *' : ''}
                  </Text>
                  <Pressable
                    style={[styles.uploadBtn, themed.uploadBtn]}
                    disabled={uploadingSupp}
                    onPress={async () => {
                      setUploadingSupp(true);
                      try {
                        const uploaded = await pickAndUploadLeaveAttachment(userId);
                        setSuppDocUrl(uploaded.url);
                        toast.success('อัปโหลดแล้ว', 'แนบหลักฐานเรียบร้อย');
                      } catch (e) {
                        toast.error(
                          'อัปโหลดไม่สำเร็จ',
                          e instanceof Error ? e.message : String(e)
                        );
                      } finally {
                        setUploadingSupp(false);
                      }
                    }}>
                    <Text style={[styles.uploadBtnText, themed.uploadBtnText]}>
                      {uploadingSupp
                        ? 'กำลังอัปโหลด…'
                        : suppDocUrl
                          ? 'เปลี่ยนไฟล์หลักฐาน'
                          : 'เลือกไฟล์ PDF / รูปภาพ'}
                    </Text>
                  </Pressable>
                </>
              ) : null}

              <View style={styles.actions}>
                <Pressable style={[styles.btnGhost, themed.btnGhost]} onPress={onClose}>
                  <Text style={[styles.btnGhostText, themed.btnGhostText]}>ปิด</Text>
                </Pressable>
                <Pressable
                  style={[styles.btnPrimary, themed.btnPrimary, saving && styles.disabled]}
                  disabled={saving}
                  onPress={() => void submit()}>
                  <Text style={styles.btnPrimaryText}>
                    {saving ? 'กำลังส่ง…' : 'ส่งคำขอลา'}
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

function createLeaveModalThemeStyles(colors: AppTheme['colors']) {
  return StyleSheet.create({
    backdrop: { backgroundColor: colors.overlay },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1.5,
    },
    title: { color: colors.text },
    sub: { color: colors.textMuted },
    label: { color: colors.textSecondary },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      color: colors.text,
    },
    meta: { color: colors.textMuted },
    hint: { color: colors.primaryDark },
    warnBox: {
      backgroundColor: colors.warningBg,
      borderColor: colors.warningBorder,
      color: colors.warningTitle,
    },
    uploadBtn: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primaryMuted,
      borderWidth: 1.3,
    },
    uploadBtnText: { color: colors.primaryDark },
    btnGhost: {
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1.5,
    },
    btnGhostText: { color: colors.text },
    btnPrimary: { backgroundColor: colors.primaryDark },
    chip: {
      backgroundColor: colors.chip,
      borderColor: colors.borderSoft,
      borderWidth: 1,
    },
    chipOn: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primaryMuted,
    },
    chipText: { color: colors.chipText },
    chipTextOn: { color: colors.primaryDark },
  });
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
    position: 'relative',
  },
  backdropHit: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    backgroundColor: c.surfaceElevated,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    paddingHorizontal: s.screen + 4,
    paddingTop: 16,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  scroll: { maxHeight: 520 },
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
  tall: { minHeight: 72, textAlignVertical: 'top' },
  rowChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: r.sm,
    backgroundColor: c.chip,
  },
  chipOn: { backgroundColor: c.chipActive },
  chipText: { fontSize: 13, color: c.chipText },
  chipTextOn: { color: c.chipTextActive, fontWeight: '700' },
  meta: { fontSize: 11, color: c.textMuted, marginBottom: 4, lineHeight: 16 },
  hint: { fontSize: 12, color: c.primaryDark, marginTop: 4 },
  warnBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: r.sm,
    backgroundColor: c.warningBg,
    borderWidth: 1,
    borderColor: c.warningBorder,
    color: c.warningTitle,
    fontSize: 12,
    lineHeight: 18,
  },
  uploadBtn: {
    backgroundColor: c.primaryLight,
    padding: 12,
    borderRadius: r.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.primaryMuted,
  },
  uploadBtnText: { color: c.primaryDark, fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    marginBottom: 8,
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
