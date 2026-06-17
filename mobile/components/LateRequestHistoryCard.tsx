import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { currentYearBangkok } from '@/lib/leaveLateRules';
import { supabase } from '@/lib/supabase';

type LateRequestHistoryRow = {
  id: string;
  user_id: string;
  work_date: string;
  minutes_late: number;
  note: string | null;
  created_at: string;
};

type Props = {
  userId: string | null | undefined;
  canManage?: boolean;
  onChanged?: () => void;
};

function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
  const [yy, mo, dd] = value.trim().split('-').map(Number);
  const dt = new Date(Date.UTC(yy, mo - 1, dd));
  return (
    dt.getUTCFullYear() === yy &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === dd
  );
}

function formatWorkDateTh(ymd: string): string {
  const p = ymd.trim().split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return ymd;
  const [yy, mo, dd] = p;
  const dt = new Date(Date.UTC(yy, mo - 1, dd));
  try {
    return new Intl.DateTimeFormat('th-TH', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    }).format(dt);
  } catch {
    return ymd;
  }
}

function formatCreatedAtTh(iso: string): string {
  try {
    return new Intl.DateTimeFormat('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function LateRequestHistoryCard({ userId, canManage = false, onChanged }: Props) {
  const toast = useCuteToast();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const styles = useMemo(() => createLateRequestHistoryStyles(theme), [theme]);
  const [rows, setRows] = useState<LateRequestHistoryRow[]>([]);
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<LateRequestHistoryRow | null>(null);
  const [editWorkDate, setEditWorkDate] = useState('');
  const [editMinutes, setEditMinutes] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const year = currentYearBangkok();
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;

  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      return;
    }
    const { data } = await supabase
      .from('late_requests')
      .select('id,user_id,work_date,minutes_late,note,created_at')
      .eq('user_id', userId)
      .gte('work_date', yStart)
      .lte('work_date', yEnd)
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false });
    setRows((data as LateRequestHistoryRow[]) ?? []);
  }, [userId, yEnd, yStart]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`late_request_history_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'late_requests' }, () => {
        void load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, userId]);

  const previewRows = rows.slice(0, 4);
  const totalMinutes = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.minutes_late) || 0), 0),
    [rows]
  );

  function openEditor(row: LateRequestHistoryRow) {
    if (!canManage) return;
    setEditRow(row);
    setEditWorkDate(row.work_date.trim().slice(0, 10));
    setEditMinutes(String(row.minutes_late));
    setEditNote(row.note?.trim() || '');
  }

  async function saveEdit() {
    if (!canManage || !editRow) return;
    const workDate = editWorkDate.trim();
    const minutes = Number(editMinutes);
    if (!isValidYmd(workDate)) {
      toast.error('วันที่ไม่ถูกต้อง', 'กรุณากรอกวันที่รูปแบบ YYYY-MM-DD เช่น 2026-06-08');
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
      toast.error('จำนวนนาทีไม่ถูกต้อง', 'ขอเข้าสายต้องอยู่ระหว่าง 1-30 นาที');
      return;
    }
    setEditBusy(true);
    try {
      const { error } = await supabase.rpc('admin_update_late_request', {
        p_request_id: editRow.id,
        p_work_date: workDate,
        p_minutes_late: minutes,
        p_note: editNote.trim() || null,
      });
      if (error) throw error;
      toast.success('แก้ไขสิทธิ์เข้าสายแล้ว', 'โควต้า 26–25 จะคำนวณจากข้อมูลล่าสุด');
      setEditRow(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error('แก้ไขสิทธิ์เข้าสายไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteEdit() {
    if (!canManage || !editRow) return;
    setEditBusy(true);
    try {
      const { error } = await supabase.rpc('admin_delete_late_request', {
        p_request_id: editRow.id,
      });
      if (error) throw error;
      toast.success('ลบสิทธิ์เข้าสายแล้ว', 'สิทธิ์ขอเข้าสายถูกคืนตามรายการที่ลบ');
      setEditRow(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error('ลบสิทธิ์เข้าสายไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <>
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>ประวัติการใช้สิทธิ์ขอเข้าสาย</Text>
            <Text style={styles.sub}>
              ปี {year} · รวม {rows.length} ครั้ง · {totalMinutes} นาที
            </Text>
          </View>
          <Pressable
            style={[styles.openBtn, rows.length === 0 && styles.disabled]}
            disabled={rows.length === 0}
            onPress={() => setOpen(true)}>
            <Text style={styles.openBtnText}>ดูทั้งหมด</Text>
          </Pressable>
        </View>
        {rows.length === 0 ? (
          <Text style={styles.empty}>ยังไม่มีประวัติการใช้สิทธิ์ขอเข้าสายในปีนี้</Text>
        ) : (
          previewRows.map((row) => (
            <LateRequestRow
              key={row.id}
              row={row}
              styles={styles}
              canManage={canManage}
              onManage={openEditor}
            />
          ))
        )}
        {rows.length > previewRows.length ? (
          <Text style={styles.more}>
            และอีก {rows.length - previewRows.length} รายการ กดดูทั้งหมดเพื่อดูประวัติครบ
          </Text>
        ) : null}
      </View>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>ประวัติการใช้สิทธิ์ขอเข้าสาย ปี {year}</Text>
            <Text style={styles.modalSub}>
              รวมคำขอเข้าสายที่บันทึกในปีนี้ เรียงตามวันที่ทำงานล่าสุด
            </Text>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator>
              {rows.length === 0 ? (
                <Text style={styles.empty}>ยังไม่มีประวัติการใช้สิทธิ์ขอเข้าสายในปีนี้</Text>
              ) : (
                rows.map((row) => (
                  <LateRequestRow
                    key={`modal-${row.id}`}
                    row={row}
                    styles={styles}
                    canManage={canManage}
                    onManage={openEditor}
                  />
                ))
              )}
            </ScrollView>
            <Pressable style={styles.modalClose} onPress={() => setOpen(false)}>
              <Text style={styles.modalCloseText}>ปิด</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={editRow != null}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!editBusy) setEditRow(null);
        }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>แก้ไข/ลบสิทธิ์ขอเข้าสาย</Text>
            <Text style={styles.modalSub}>
              สำหรับ Admin เท่านั้น · การลบรายการจะคืนโควต้าขอเข้าสายในรอบ 26–25
            </Text>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator>
              <Text style={styles.formLabel}>วันที่ทำงาน (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.formInput}
                value={editWorkDate}
                onChangeText={setEditWorkDate}
                editable={!editBusy}
                placeholder="2026-06-08"
                placeholderTextColor={c.textMuted}
              />
              <Text style={styles.formLabel}>จำนวนนาที</Text>
              <TextInput
                style={styles.formInput}
                value={editMinutes}
                onChangeText={setEditMinutes}
                editable={!editBusy}
                keyboardType="number-pad"
                placeholder="15"
                placeholderTextColor={c.textMuted}
              />
              <Text style={styles.formLabel}>เหตุผล / หมายเหตุ</Text>
              <TextInput
                style={[styles.formInput, styles.formTextarea]}
                value={editNote}
                onChangeText={setEditNote}
                editable={!editBusy}
                multiline
                placeholder="ระบุเหตุผล"
                placeholderTextColor={c.textMuted}
              />
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.dangerBtn, editBusy && styles.disabled]}
                disabled={editBusy}
                onPress={deleteEdit}>
                <Text style={styles.dangerBtnText}>ลบรายการ</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, editBusy && styles.disabled]}
                disabled={editBusy}
                onPress={() => setEditRow(null)}>
                <Text style={styles.secondaryBtnText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, editBusy && styles.disabled]}
                disabled={editBusy}
                onPress={saveEdit}>
                <Text style={styles.saveBtnText}>{editBusy ? 'กำลังบันทึก...' : 'บันทึก'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function LateRequestRow({
  row,
  styles,
  canManage = false,
  onManage,
}: {
  row: LateRequestHistoryRow;
  styles: ReturnType<typeof createLateRequestHistoryStyles>;
  canManage?: boolean;
  onManage?: (row: LateRequestHistoryRow) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.accent} />
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={styles.rowTitle}>{formatWorkDateTh(row.work_date)}</Text>
          <Text style={styles.minutes}>{row.minutes_late} นาที</Text>
        </View>
        <Text style={styles.reason}>{row.note?.trim() || 'ไม่ระบุเหตุผล'}</Text>
        <Text style={styles.created}>ส่งคำขอ {formatCreatedAtTh(row.created_at)}</Text>
        {canManage ? (
          <Pressable style={styles.inlineBtn} onPress={() => onManage?.(row)}>
            <Text style={styles.inlineBtnText}>แก้ไข/ลบรายการ</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function createLateRequestHistoryStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;
  const sectionAccent =
    c.canvas === '#F8FAF1'
      ? { borderLeftWidth: 4, borderLeftColor: c.primaryMuted, paddingLeft: 10 }
      : {};

  return StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 12,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '800', color: c.text, ...sectionAccent },
  sub: { marginTop: 3, fontSize: 12, color: c.textMuted, lineHeight: 17 },
  openBtn: {
    borderRadius: r.sm,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  openBtnText: { color: c.primaryDark, fontSize: 12, fontWeight: '800' },
  empty: {
    padding: 12,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    color: c.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  accent: { width: 4, borderRadius: 2, backgroundColor: c.lateNoticeBar },
  body: { flex: 1, minWidth: 0 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowTitle: { color: c.text, fontSize: 14, fontWeight: '800', flex: 1, minWidth: 0 },
  minutes: { color: c.lateNoticeBar, fontSize: 13, fontWeight: '900' },
  reason: { marginTop: 5, color: c.text, fontSize: 12, lineHeight: 18 },
  created: { marginTop: 5, color: c.textMuted, fontSize: 11 },
  more: { marginTop: 10, color: c.textMuted, fontSize: 12, fontStyle: 'italic' },
  inlineBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: r.sm,
    backgroundColor: c.linkLight,
    borderWidth: 1,
    borderColor: c.link,
  },
  inlineBtnText: { color: c.link, fontSize: 12, fontWeight: '800' },
  formLabel: {
    marginTop: 12,
    marginBottom: 6,
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  formInput: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    color: c.text,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  formTextarea: {
    minHeight: 86,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  dangerBtn: {
    flexGrow: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: r.sm,
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error,
    alignItems: 'center',
  },
  dangerBtnText: { color: c.error, fontSize: 13, fontWeight: '900' },
  secondaryBtn: {
    flexGrow: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    alignItems: 'center',
  },
  secondaryBtnText: { color: c.textSecondary, fontSize: 13, fontWeight: '800' },
  saveBtn: {
    flexGrow: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: r.sm,
    backgroundColor: c.primary,
    alignItems: 'center',
  },
  saveBtnText: { color: c.canvas, fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.6 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: c.surface,
    borderRadius: r.xl,
    maxHeight: '85%',
    padding: 16,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, color: c.text },
  modalSub: { marginBottom: 10, color: c.textMuted, fontSize: 12 },
  modalScroll: { maxHeight: 400 },
  modalClose: {
    marginTop: 12,
    backgroundColor: c.surfaceMuted,
    padding: 12,
    borderRadius: r.sm,
    alignItems: 'center',
  },
  modalCloseText: { fontWeight: '700', color: c.textSecondary },
  });
}
