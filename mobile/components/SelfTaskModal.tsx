import { useCallback, useState } from 'react';
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
import { FriendlyNoticeModal } from '@/components/FriendlyNoticeModal';
import { NatureTheme } from '@/constants/Theme';
import {
  dateToBangkokYmd,
  dateYmdToIsoBangkokEnd,
  dateYmdToIsoBangkokStart,
  notifyTaskStakeholders,
  TASK_PRIORITY_OPTIONS,
} from '@/lib/taskHelpers';
import { supabase } from '@/lib/supabase';
import type { TaskPriority } from '@/lib/types';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type SubLine = { id: string; text: string };
type InitialTaskStatus = 'pending' | 'in_progress';

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const INITIAL_STATUS_OPTIONS: { key: InitialTaskStatus; label: string; sub: string }[] = [
  { key: 'in_progress', label: 'กำลังทำ', sub: 'แสดงให้ทีมเห็นว่ากำลังทำงานนี้อยู่' },
  { key: 'pending', label: 'รอดำเนินการ', sub: 'บันทึกไว้ทำภายหลัง' },
];
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

let lineId = 0;
function newLineId() {
  lineId += 1;
  return `ln-${lineId}-${Date.now()}`;
}

export function SelfTaskModal({ visible, onClose, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [initialStatus, setInitialStatus] = useState<InitialTaskStatus>('in_progress');
  const [subLines, setSubLines] = useState<SubLine[]>([
    { id: newLineId(), text: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [errorNotice, setErrorNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const reset = useCallback(() => {
    setTitle('');
    setDesc('');
    setStartDate(null);
    setDueDate(null);
    setPriority('normal');
    setInitialStatus('in_progress');
    setSubLines([{ id: newLineId(), text: '' }]);
  }, []);

  function removeLine(id: string) {
    setSubLines((prev) => {
      const next = prev.filter((l) => l.id !== id);
      return next.length ? next : [{ id: newLineId(), text: '' }];
    });
  }

  function updateLine(id: string, text: string) {
    setSubLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, text } : l))
    );
  }

  async function submit() {
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      const actorId = authData.user?.id;
      if (authErr || !actorId) {
        throw new Error('เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ ลองออกแล้วเข้าใหม่');
      }

      const startIso = startDate
        ? dateYmdToIsoBangkokStart(dateToBangkokYmd(startDate))
        : null;
      const dueIso = dueDate
        ? dateYmdToIsoBangkokEnd(dateToBangkokYmd(dueDate))
        : null;
      if (startDate && !startIso) {
        throw new Error('วันที่เริ่มไม่ถูกต้อง');
      }
      if (dueDate && !dueIso) {
        throw new Error('วันครบกำหนดไม่ถูกต้อง');
      }

      const { data: taskIdRaw, error: e1 } = await supabase.rpc(
        'create_self_task',
        {
          p_title: t,
          p_description: desc.trim() || null,
          p_priority: priority,
          p_start_at: startIso,
          p_due_at: dueIso,
        }
      );

      if (e1 || taskIdRaw == null || String(taskIdRaw).trim() === '') {
        throw new Error(e1?.message ?? 'บันทึกงานไม่สำเร็จ');
      }

      const taskId = String(taskIdRaw);
      const taskTitle = t;
      if (initialStatus !== 'pending') {
        const { error: statusErr } = await supabase
          .from('tasks')
          .update({ status: initialStatus })
          .eq('id', taskId);
        if (statusErr) throw new Error(statusErr.message);
      }

      const labels = subLines.map((s) => s.text.trim()).filter(Boolean);
      if (labels.length) {
        const rows = labels.map((label, i) => ({
          task_id: taskId,
          label,
          sort_order: i,
          done: false,
        }));
        const { error: e2 } = await supabase
          .from('task_checklist_items')
          .insert(rows);
        if (e2) throw new Error(e2.message);
      }

      await notifyTaskStakeholders(supabase, {
        taskId,
        assignedTo: actorId,
        assignedBy: actorId,
        title: taskTitle,
        message: 'พนักงานสร้างงานใหม่ให้ตัวเอง',
        notifyAssigneeIds: [actorId],
      });

      reset();
      onSaved();
      setSuccessOpen(true);
    } catch (e) {
      setErrorNotice({
        title: 'อุ๊ปส์ ยังบันทึกไม่ได้',
        message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด',
      });
    } finally {
      setSaving(false);
    }
  }

  function handleSuccessClose() {
    setSuccessOpen(false);
    onClose();
  }

  return (
    <>
      <Modal
        visible={visible && !successOpen && !errorNotice}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => !saving && onClose()}>
        <Pressable style={[styles.back, WEB_MODAL_BACKDROP]} onPress={() => !saving && onClose()}>
          <Pressable style={styles.card} onPress={() => {}}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.h1}>เพิ่มงานของฉัน / งานรูทีน</Text>

              <Text style={styles.label}>ชื่องาน *</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="เช่น งานเปิดร้านประจำวัน / นัดลูกค้า บริษัท …"
                editable={!saving}
              />

              <Text style={styles.label}>รายละเอียด</Text>
              <TextInput
                style={[styles.input, styles.tall]}
                value={desc}
                onChangeText={setDesc}
                placeholder="รายละเอียดงานทั่วไป รูทีนประจำวัน หรือการประสานกับทีม"
                multiline
                editable={!saving}
              />

              <DatePickerField
                label="วันที่เริ่ม"
                value={startDate}
                onChange={setStartDate}
                disabled={saving}
                maximumDate={dueDate ?? undefined}
              />

              <DatePickerField
                label="วันที่ต้องทำเสร็จ"
                value={dueDate}
                onChange={setDueDate}
                disabled={saving}
                minimumDate={startDate ?? undefined}
              />

              <Text style={styles.label}>ระดับความสำคัญ</Text>
              <View style={styles.priRow}>
                {TASK_PRIORITY_OPTIONS.map((p) => (
                  <Pressable
                    key={p.key}
                    style={[
                      styles.priChip,
                      { borderColor: p.color },
                      priority === p.key && { backgroundColor: p.color + '33' },
                    ]}
                    onPress={() => setPriority(p.key)}>
                    <View
                      style={[styles.priDot, { backgroundColor: p.color }]}
                    />
                    <Text style={styles.priText} numberOfLines={2}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>สถานะเริ่มต้น</Text>
              <View style={styles.statusRow}>
                {INITIAL_STATUS_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.key}
                    style={[
                      styles.statusChip,
                      initialStatus === opt.key && styles.statusChipOn,
                    ]}
                    onPress={() => setInitialStatus(opt.key)}
                    disabled={saving}>
                    <Text
                      style={[
                        styles.statusChipText,
                        initialStatus === opt.key && styles.statusChipTextOn,
                      ]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.statusChipSub}>{opt.sub}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>หัวข้อย่อย (ทำเป็นเช็คลิสต์)</Text>
              {subLines.map((line) => (
                <View key={line.id} style={styles.lineRow}>
                  <TextInput
                    style={[styles.input, styles.lineInput]}
                    value={line.text}
                    onChangeText={(v) => updateLine(line.id, v)}
                    placeholder="หัวข้อย่อย"
                    editable={!saving}
                  />
                  <Pressable
                    style={[
                      styles.removeBtn,
                      subLines.length <= 1 && styles.removeBtnDisabled,
                    ]}
                    onPress={() => removeLine(line.id)}
                    disabled={saving || subLines.length <= 1}
                    accessibilityLabel="ลบหัวข้อ">
                    <Text style={styles.removeBtnText}>ลบ</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                style={styles.addLine}
                onPress={() =>
                  setSubLines((prev) => [
                    ...prev,
                    { id: newLineId(), text: '' },
                  ])
                }
                disabled={saving}>
                <Text style={styles.addLineText}>+ เพิ่มหัวข้อ</Text>
              </Pressable>
            </ScrollView>

            <View style={styles.actions}>
              <Pressable
                style={styles.cancel}
                onPress={() => !saving && onClose()}
                disabled={saving}>
                <Text style={styles.cancelText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.save, saving && styles.saveDisabled]}
                onPress={submit}
                disabled={saving || !title.trim()}>
                {saving ? (
                  <ActivityIndicator color={NatureTheme.colors.onAccent} />
                ) : (
                  <Text style={styles.saveText}>บันทึกงาน</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <FriendlyNoticeModal
        visible={successOpen}
        variant="success"
        title="บันทึกงานเรียบร้อยแล้ว"
        message="ขอให้ทำงานราบรื่นนะ มีอะไรให้อัปเดตทีมได้จากหน้ารายละเอียดงานเลย"
        onClose={handleSuccessClose}
      />
      <FriendlyNoticeModal
        visible={!!errorNotice}
        variant="error"
        title={errorNotice?.title ?? ''}
        message={errorNotice?.message}
        onClose={() => setErrorNotice(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  back: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: c.surfaceElevated,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    padding: 18,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  h1: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
    marginBottom: 14,
  },
  label: {
    fontWeight: '600',
    fontSize: 13,
    color: c.textSecondary,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 12,
    backgroundColor: c.surface,
    color: c.text,
  },
  tall: { minHeight: 88, textAlignVertical: 'top' },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  lineInput: { flex: 1, marginBottom: 0 },
  removeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: r.sm,
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error + '55',
  },
  removeBtnDisabled: { opacity: 0.35 },
  removeBtnText: { color: c.error, fontWeight: '700', fontSize: 13 },
  priRow: { gap: 8, marginBottom: 8 },
  priChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: r.sm,
    borderWidth: 1.5,
    backgroundColor: c.surfaceMuted,
  },
  priDot: { width: 12, height: 12, borderRadius: 6 },
  priText: { flex: 1, fontSize: 12, color: c.text },
  statusRow: { gap: 8, marginBottom: 8 },
  statusChip: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    padding: 10,
    backgroundColor: c.surfaceMuted,
  },
  statusChipOn: {
    borderColor: c.primaryMuted,
    backgroundColor: c.primaryLight,
  },
  statusChipText: { color: c.text, fontWeight: '800', fontSize: 14 },
  statusChipTextOn: { color: c.primaryDark },
  statusChipSub: { color: c.textMuted, fontSize: 11, marginTop: 3, lineHeight: 15 },
  addLine: { paddingVertical: 8 },
  addLineText: { color: c.link, fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: c.borderSoft,
  },
  cancel: { padding: 12 },
  cancelText: { color: c.textMuted, fontWeight: '600' },
  save: {
    backgroundColor: c.primary,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: r.md,
    minWidth: 120,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.7 },
  saveText: { color: c.onAccent, fontWeight: '700' },
});
