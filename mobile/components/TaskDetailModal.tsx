import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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
import {
  FriendlyConfirmModal,
  FriendlyNoticeModal,
} from '@/components/FriendlyNoticeModal';
import type { FriendlyNoticeVariant } from '@/components/FriendlyNoticeModal';
import { NatureTheme } from '@/constants/Theme';
import { emitTaskStatusChanged } from '@/lib/appSignals';
import {
  checklistAllDone,
  dateToBangkokYmd,
  dateYmdToIsoBangkokEnd,
  notifyTaskStakeholders,
  priorityColor,
  priorityLabel,
  taskCompletedAtMs,
  taskHasDeliverableAttachment,
  taskParticipantUserIds,
  TASK_STATUS_TH,
} from '@/lib/taskHelpers';
import { humanizeSupabaseError, supabase } from '@/lib/supabase';
import type {
  TaskAttachmentRow,
  TaskChecklistItemRow,
  TaskPriority,
  TaskRow,
} from '@/lib/types';
import { pickAndUploadTaskImage } from '@/lib/uploadTaskFile';

type Props = {
  visible: boolean;
  taskId: string | null;
  userId: string;
  onClose: () => void;
  onChanged: () => void;
  manager: boolean;
  admin: boolean;
};

const c = NatureTheme.colors;
const r = NatureTheme.radius;
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

const STATUSES = ['pending', 'in_progress', 'done', 'cancelled'] as const;

export function TaskDetailModal({
  visible,
  taskId,
  userId,
  onClose,
  onChanged,
  manager,
  admin,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [newCheckLabel, setNewCheckLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    variant: FriendlyNoticeVariant;
    title: string;
    message?: string;
    autoDismissMs?: number;
  } | null>(null);
  const [confirmAttach, setConfirmAttach] = useState<TaskAttachmentRow | null>(
    null
  );
  const [confirmCheck, setConfirmCheck] =
    useState<TaskChecklistItemRow | null>(null);
  const [confirmDoneChecklist, setConfirmDoneChecklist] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [completedWorkDate, setCompletedWorkDate] = useState(() => new Date());

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select(
          `
          *,
          task_assignees (*),
          task_checklist_items (*),
          task_attachments (*)
        `
        )
        .eq('id', taskId)
        .single();

      if (error) throw new Error(error.message);
      const t = data as TaskRow;
      const items = (t.task_checklist_items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
      const atts = t.task_attachments ?? [];
      setTask({ ...t, task_checklist_items: items, task_attachments: atts });
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'โหลดงานไม่สำเร็จ',
        message: e instanceof Error ? e.message : '',
      });
      setTask(null);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (visible && taskId) {
      load();
      setLinkUrl('');
      setLinkTitle('');
      setNewCheckLabel('');
    }
    if (!visible) {
      setConfirmDeleteOpen(false);
      setDeleteBusy(false);
    }
  }, [visible, taskId, load]);

  useEffect(() => {
    if (!task) return;
    if (task.status === 'done') {
      const ms = taskCompletedAtMs(task);
      setCompletedWorkDate(ms != null ? new Date(ms) : new Date());
    } else {
      setCompletedWorkDate(new Date());
    }
  }, [task?.id, task?.status, task?.completed_at, task?.updated_at]);

  const pri = (task?.priority ?? 'normal') as TaskPriority;
  const mine =
    task != null &&
    taskParticipantUserIds(task).includes(String(userId));
  const canEdit =
    mine ||
    task?.assigned_by === userId ||
    manager ||
    admin;

  async function deleteTaskPermanently() {
    if (deleteBusy || !task || !admin) return;
    setDeleteBusy(true);
    const id = task.id;
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    setDeleteBusy(false);
    setConfirmDeleteOpen(false);
    if (error) {
      setNotice({
        variant: 'error',
        title: 'ลบงานไม่สำเร็จ',
        message: humanizeSupabaseError(error.message),
      });
      return;
    }
    onChanged();
    onClose();
  }

  async function pushNotify(message: string) {
    if (!task) return;
    try {
      await notifyTaskStakeholders(supabase, {
        taskId: task.id,
        assignedTo: task.assigned_to,
        assignedBy: task.assigned_by,
        title: task.title,
        message,
        notifyAssigneeIds: taskParticipantUserIds(task),
      });
    } catch {
      /* แจ้งเตือนพลาดไม่บล็อก UX */
    }
  }

  async function toggleCheck(item: TaskChecklistItemRow) {
    if (!task || !canEdit) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('task_checklist_items')
        .update({ done: !item.done })
        .eq('id', item.id);
      if (error) throw new Error(error.message);
      await pushNotify(
        !item.done
          ? `ติ๊กหัวข้อแล้ว: ${item.label}`
          : `ยกเลิกติ๊กหัวข้อ: ${item.label}`
      );
      await load();
      onChanged();
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'อัปเดตเช็คลิสต์ไม่สำเร็จ',
        message: e instanceof Error ? e.message : '',
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteChecklistItem(item: TaskChecklistItemRow) {
    if (!task || !canEdit) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('task_checklist_items')
        .delete()
        .eq('id', item.id);
      if (error) throw new Error(error.message);
      await pushNotify(`ลบหัวข้อ: ${item.label}`);
      await load();
      onChanged();
      setNotice({
        variant: 'success',
        title: 'ลบหัวข้อแล้ว',
        message: 'อัปเดตไปยังหัวหน้าเรียบร้อย',
        autoDismissMs: 2200,
      });
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'ลบไม่สำเร็จ',
        message: e instanceof Error ? e.message : '',
      });
    } finally {
      setBusy(false);
    }
  }

  async function addChecklist() {
    const label = newCheckLabel.trim();
    if (!task || !label || !canEdit) return;
    setBusy(true);
    try {
      const maxOrder = Math.max(
        0,
        ...(task.task_checklist_items ?? []).map((x) => x.sort_order)
      );
      const { error } = await supabase.from('task_checklist_items').insert({
        task_id: task.id,
        label,
        done: false,
        sort_order: maxOrder + 1,
      });
      if (error) throw new Error(error.message);
      await pushNotify(`เพิ่มหัวข้อย่อย: ${label}`);
      setNewCheckLabel('');
      await load();
      onChanged();
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'เพิ่มหัวข้อไม่สำเร็จ',
        message: e instanceof Error ? e.message : '',
      });
    } finally {
      setBusy(false);
    }
  }

  async function performStatusUpdate(status: string) {
    if (!task || !canEdit) return;
    setBusy(true);
    try {
      const patch: { status: string; completed_at?: string | null } = { status };
      if (status === 'done') {
        const ymd = dateToBangkokYmd(completedWorkDate);
        const iso = dateYmdToIsoBangkokEnd(ymd);
        patch.completed_at = iso ?? new Date().toISOString();
      } else {
        patch.completed_at = null;
      }
      const { error } = await supabase.from('tasks').update(patch).eq('id', task.id);
      if (error) throw new Error(error.message);
      emitTaskStatusChanged({
        taskId: task.id,
        status,
        source: 'task_detail',
      });
      await pushNotify(`เปลี่ยนสถานะเป็น ${TASK_STATUS_TH[status] ?? status}`);
      await load();
      onChanged();
      setNotice({
        variant: 'status',
        title: 'อัปเดตสถานะแล้ว',
        message: `ตอนนี้อยู่ในขั้น «${TASK_STATUS_TH[status] ?? status}» แล้วนะ`,
        autoDismissMs: 2400,
      });
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'อัปเดตสถานะไม่สำเร็จ',
        message: e instanceof Error ? e.message : '',
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveCompletedAtOnly() {
    if (!task || !canEdit || task.status !== 'done') return;
    setBusy(true);
    try {
      const ymd = dateToBangkokYmd(completedWorkDate);
      const iso = dateYmdToIsoBangkokEnd(ymd);
      if (!iso) throw new Error('วันที่ไม่ถูกต้อง');
      const { error } = await supabase
        .from('tasks')
        .update({ completed_at: iso })
        .eq('id', task.id);
      if (error) throw new Error(error.message);
      await pushNotify('แก้ไขวันที่ทำงานเสร็จ');
      await load();
      onChanged();
      setNotice({
        variant: 'success',
        title: 'บันทึกวันที่เสร็จแล้ว',
        message: 'ใช้คำนวณทันกำหนดและปิดงานล่าช้าในแดชบอร์ด',
        autoDismissMs: 2400,
      });
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'บันทึกไม่สำเร็จ',
        message: e instanceof Error ? e.message : '',
      });
    } finally {
      setBusy(false);
    }
  }

  async function requestStatusChange(next: string) {
    if (!task || !canEdit || busy) return;
    if (task.status === 'done' && next !== 'done') {
      setNotice({
        variant: 'error',
        title: 'งานปิดสำเร็จแล้ว',
        message: 'ไม่สามารถเปลี่ยนสถานะกลับไปดำเนินการได้',
      });
      return;
    }
    if (next === 'done') {
      if (!taskHasDeliverableAttachment(task)) {
        setNotice({
          variant: 'error',
          title: 'ยังแนบหลักฐานไม่ครบ',
          message: 'กรุณาแนบรูป ไฟล์ หรือลิงก์อย่างน้อย 1 รายการก่อนปิดงาน',
        });
        return;
      }
      if (!checklistAllDone(task)) {
        setConfirmDoneChecklist(true);
        return;
      }
    }
    await performStatusUpdate(next);
  }

  async function confirmFinishAndTickAll() {
    if (!task) return;
    setConfirmDoneChecklist(false);
    setBusy(true);
    try {
      const ids = (task.task_checklist_items ?? []).filter((i) => !i.done).map((i) => i.id);
      if (ids.length) {
        const { error } = await supabase
          .from('task_checklist_items')
          .update({ done: true })
          .in('id', ids);
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'อัปเดตเช็คลิสต์ไม่สำเร็จ',
        message: e instanceof Error ? e.message : '',
      });
      setBusy(false);
      return;
    }
    setBusy(false);
    await performStatusUpdate('done');
  }

  async function addLink() {
    const url = linkUrl.trim();
    if (!task || !url || !canEdit) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('task_attachments').insert({
        task_id: task.id,
        kind: 'link',
        url,
        title: linkTitle.trim() || null,
        created_by: userId,
      });
      if (error) throw new Error(error.message);
      await pushNotify(`เพิ่มลิงก์: ${linkTitle.trim() || url}`);
      setLinkUrl('');
      setLinkTitle('');
      await load();
      onChanged();
      setNotice({
        variant: 'success',
        title: 'เพิ่มลิงก์แล้ว',
        message: 'ทีมและหัวหน้าจะได้รับแจ้งเตือน',
        autoDismissMs: 2200,
      });
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'เพิ่มลิงก์ไม่สำเร็จ',
        message: e instanceof Error ? e.message : '',
      });
    } finally {
      setBusy(false);
    }
  }

  async function addImage() {
    if (!task || !canEdit) return;
    setBusy(true);
    try {
      const url = await pickAndUploadTaskImage(userId);
      const { error } = await supabase.from('task_attachments').insert({
        task_id: task.id,
        kind: 'image',
        url,
        title: 'รูปแนบ',
        created_by: userId,
      });
      if (error) throw new Error(error.message);
      await pushNotify('แนบรูปภาพงาน');
      await load();
      onChanged();
      setNotice({
        variant: 'success',
        title: 'แนบรูปแล้ว',
        message: 'รูปถูกอัปโหลดและแจ้งทีมแล้ว',
        autoDismissMs: 2200,
      });
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'อัปโหลดไม่สำเร็จ',
        message: e instanceof Error ? e.message : '',
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoveAttachment() {
    const a = confirmAttach;
    if (!a) return;
    setConfirmAttach(null);
    setBusy(true);
    try {
      const { error } = await supabase
        .from('task_attachments')
        .delete()
        .eq('id', a.id);
      if (error) throw new Error(error.message);
      await pushNotify('ลบไฟล์/ลิงก์แนบ');
      await load();
      onChanged();
      setNotice({
        variant: 'info',
        title: 'ลบรายการแนบแล้ว',
        autoDismissMs: 2000,
      });
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'ลบไม่สำเร็จ',
        message: e instanceof Error ? e.message : '',
      });
    } finally {
      setBusy(false);
    }
  }

  function openAttachmentUrl(url: string) {
    Linking.openURL(url)
      .then(() => {
        setNotice({
          variant: 'link',
          title: 'เปิดลิงก์แล้ว',
          message: 'ถ้าไม่เห็นหน้าต่าง ลองดูแท็บเบราว์เซอร์นะ',
          autoDismissMs: 2600,
        });
      })
      .catch(() => {
        setNotice({
          variant: 'error',
          title: 'เปิดลิงก์ไม่ได้',
          message: 'ลองคัดลอก URL ไปเปิดในเบราว์เซอร์ดูนะ',
        });
      });
  }

  return (
    <>
      <Modal
        visible={
          visible &&
          !notice &&
          !confirmAttach &&
          !confirmCheck &&
          !confirmDoneChecklist
        }
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => !busy && onClose()}>
        <Pressable style={[styles.back, WEB_MODAL_BACKDROP]} onPress={() => !busy && onClose()}>
          <Pressable style={styles.card} onPress={() => {}}>
            {loading || !task ? (
              <View style={styles.centerPad}>
                <Text style={styles.loadEmoji}>🌿</Text>
                <ActivityIndicator
                  color={c.primary}
                  style={{ marginTop: 14 }}
                />
                <Text style={styles.loadHint}>กำลังโหลดงานให้นะ…</Text>
              </View>
            ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={[styles.priBar, { backgroundColor: priorityColor(pri) }]} />
              <Text style={styles.h1}>{task.title}</Text>
              <Text style={styles.meta}>
                {priorityLabel(pri)} · สถานะ:{' '}
                {TASK_STATUS_TH[task.status] ?? task.status}
              </Text>
              {task.description ? (
                <Text style={styles.desc}>{task.description}</Text>
              ) : null}
              {task.start_at ? (
                <Text style={styles.dateLine}>
                  เริ่ม:{' '}
                  {new Date(task.start_at).toLocaleString('th-TH')}
                </Text>
              ) : null}
              {task.due_at ? (
                <Text style={styles.dateLine}>
                  ครบกำหนด:{' '}
                  {new Date(task.due_at).toLocaleString('th-TH')}
                </Text>
              ) : null}

              {task.status !== 'cancelled' ? (
                canEdit ? (
                  <View style={styles.completionBlock}>
                    <Text style={styles.sec}>วันที่ทำงานเสร็จ</Text>
                    <Text style={styles.completionHint}>
                      ใช้คำนวณทันกำหนดและปิดงานล่าช้าในแดชบอร์ด ไม่ใช่เวลาแก้ไขรายละเอียดงาน
                    </Text>
                    <DatePickerField
                      label={
                        task.status === 'done'
                          ? 'แก้ไขวันที่เสร็จ'
                          : 'เลือกก่อนกดเสร็จสิ้น'
                      }
                      value={completedWorkDate}
                      onChange={(d) => setCompletedWorkDate(d ?? new Date())}
                      disabled={busy}
                    />
                    {task.status === 'done' ? (
                      <Pressable
                        style={[styles.secondaryBtn, styles.completionSaveBtn]}
                        onPress={() => void saveCompletedAtOnly()}
                        disabled={busy}>
                        <Text style={styles.secondaryBtnText}>
                          บันทึกวันที่เสร็จ
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : task.status === 'done' ? (
                  <Text style={styles.dateLine}>
                    วันที่ทำงานเสร็จ:{' '}
                    {(() => {
                      const ms = taskCompletedAtMs(task);
                      if (ms == null) return '—';
                      return new Date(ms).toLocaleDateString('th-TH', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      });
                    })()}
                  </Text>
                ) : null
              ) : null}

              {canEdit ? (
                task.status === 'done' ? (
                  <Text style={styles.doneHint}>
                    งานปิดสำเร็จแล้ว — ไม่สามารถเปลี่ยนสถานะกลับได้
                  </Text>
                ) : (
                  <View style={styles.statusRow}>
                    {STATUSES.map((s) => (
                      <Pressable
                        key={s}
                        style={[
                          styles.chip,
                          task.status === s && styles.chipOn,
                        ]}
                        onPress={() => requestStatusChange(s)}
                        disabled={busy}>
                        <Text
                          style={[
                            styles.chipText,
                            task.status === s && styles.chipTextOn,
                          ]}>
                          {TASK_STATUS_TH[s] ?? s}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )
              ) : null}

              <Text style={styles.sec}>เช็คลิสต์</Text>
              {(task.task_checklist_items ?? []).map((item) => (
                <View key={item.id} style={styles.checkRow}>
                  <Pressable
                    style={styles.checkTap}
                    onPress={() => canEdit && toggleCheck(item)}
                    disabled={busy || !canEdit}>
                    <Text style={styles.checkBox}>
                      {item.done ? '☑' : '☐'}
                    </Text>
                    <Text
                      style={[
                        styles.checkLabel,
                        item.done && styles.checkDone,
                      ]}>
                      {item.label}
                    </Text>
                  </Pressable>
                  {canEdit ? (
                    <Pressable
                      style={styles.checkDel}
                      onPress={() => setConfirmCheck(item)}
                      disabled={busy}>
                      <Text style={styles.checkDelText}>ลบ</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {canEdit ? (
                <View style={styles.addCheckRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={newCheckLabel}
                    onChangeText={setNewCheckLabel}
                    placeholder="หัวข้อใหม่"
                    editable={!busy}
                  />
                  <Pressable
                    style={styles.smallBtn}
                    onPress={addChecklist}
                    disabled={busy}>
                    <Text style={styles.smallBtnText}>เพิ่ม</Text>
                  </Pressable>
                </View>
              ) : null}

              <Text style={styles.sec}>แนบลิงก์ / รูป</Text>
              {(task.task_attachments ?? []).map((a) => (
                <View key={a.id} style={styles.attRow}>
                  <Pressable
                    onPress={() => openAttachmentUrl(a.url)}
                    style={{ flex: 1 }}>
                    <Text style={styles.attKind}>
                      [{a.kind}] {a.title || a.url}
                    </Text>
                    <Text style={styles.attUrl} numberOfLines={2}>
                      {a.url}
                    </Text>
                  </Pressable>
                  {canEdit ? (
                    <Pressable onPress={() => setConfirmAttach(a)}>
                      <Text style={styles.del}>ลบ</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {canEdit ? (
                <>
                  <TextInput
                    style={styles.input}
                    value={linkTitle}
                    onChangeText={setLinkTitle}
                    placeholder="ชื่อลิงก์ (ถ้ามี)"
                    editable={!busy}
                  />
                  <TextInput
                    style={styles.input}
                    value={linkUrl}
                    onChangeText={setLinkUrl}
                    placeholder="https://..."
                    autoCapitalize="none"
                    editable={!busy}
                  />
                  <View style={styles.linkActions}>
                    <Pressable
                      style={styles.secondaryBtn}
                      onPress={addLink}
                      disabled={busy}>
                      <Text style={styles.secondaryBtnText}>เพิ่มลิงก์</Text>
                    </Pressable>
                    <Pressable
                      style={styles.secondaryBtn}
                      onPress={addImage}
                      disabled={busy}>
                      <Text style={styles.secondaryBtnText}>แนบรูป</Text>
                    </Pressable>
                  </View>
                </>
              ) : null}

              {admin ? (
                <Pressable
                  style={styles.deleteTaskBtn}
                  onPress={() => setConfirmDeleteOpen(true)}
                  disabled={busy || deleteBusy}>
                  <Text style={styles.deleteTaskBtnText}>ลบงานจากระบบ</Text>
                </Pressable>
              ) : null}

              <Pressable style={styles.closeBig} onPress={onClose}>
                <Text style={styles.closeBigText}>ปิด</Text>
              </Pressable>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
      <FriendlyNoticeModal
        visible={!!notice}
        variant={notice?.variant ?? 'info'}
        title={notice?.title ?? ''}
        message={notice?.message}
        autoDismissMs={notice?.autoDismissMs}
        onClose={() => setNotice(null)}
      />
      <FriendlyConfirmModal
        visible={!!confirmAttach}
        title="ลบไฟล์หรือลิงก์นี้?"
        message="ทีมจะได้รับแจ้งเตือนเมื่อคุณลบรายการแนบ"
        confirmLabel="ลบเลย"
        cancelLabel="ไว้ก่อน"
        danger
        onCancel={() => setConfirmAttach(null)}
        onConfirm={confirmRemoveAttachment}
      />
      <FriendlyConfirmModal
        visible={!!confirmCheck}
        title="ลบหัวข้อนี้ออกจากเช็คลิสต์?"
        message={confirmCheck ? `「${confirmCheck.label}」` : undefined}
        confirmLabel="ลบหัวข้อ"
        cancelLabel="ยกเลิก"
        danger
        onCancel={() => setConfirmCheck(null)}
        onConfirm={() => {
          const item = confirmCheck;
          if (!item) return;
          setConfirmCheck(null);
          void deleteChecklistItem(item);
        }}
      />
      <FriendlyConfirmModal
        visible={confirmDoneChecklist}
        title="ยืนยันปิดงานสำเร็จ?"
        message="ยังมีหัวข้อเช็คลิสต์ที่ยังไม่เสร็จ ต้องการให้ติ๊กครบทุกข้อแล้วปิดงานหรือไม่?"
        confirmLabel="ติ๊กครบและปิดงาน"
        cancelLabel="ยกเลิก"
        onCancel={() => setConfirmDoneChecklist(false)}
        onConfirm={() => void confirmFinishAndTickAll()}
      />
      <FriendlyConfirmModal
        visible={confirmDeleteOpen}
        title="ลบงานจากระบบ?"
        message="งาน เช็คลิสต์ และไฟล์แนบที่เกี่ยวข้องจะถูกลบถาวร ไม่สามารถกู้คืนได้"
        confirmLabel={deleteBusy ? 'กำลังลบ…' : 'ลบถาวร'}
        cancelLabel="ยกเลิก"
        danger
        onCancel={() => {
          if (!deleteBusy) setConfirmDeleteOpen(false);
        }}
        onConfirm={() => void deleteTaskPermanently()}
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
    padding: 16,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  centerPad: { padding: 40, alignItems: 'center' },
  loadEmoji: { fontSize: 40 },
  loadHint: {
    marginTop: 12,
    fontSize: 15,
    color: c.textSecondary,
    fontWeight: '600',
  },
  priBar: { height: 5, borderRadius: 3, marginBottom: 12 },
  h1: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
  },
  meta: { fontSize: 13, color: c.textMuted, marginTop: 6 },
  desc: {
    marginTop: 12,
    fontSize: 15,
    color: c.textSecondary,
    lineHeight: 22,
  },
  dateLine: { fontSize: 13, color: c.textSecondary, marginTop: 6 },
  completionBlock: { marginTop: 4 },
  completionHint: {
    fontSize: 12,
    color: c.textMuted,
    marginBottom: 8,
    lineHeight: 18,
  },
  completionSaveBtn: { marginTop: 10 },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: r.sm,
    backgroundColor: c.chip,
  },
  chipOn: { backgroundColor: c.chipActive },
  chipText: { fontSize: 12, color: c.chipText },
  chipTextOn: { fontWeight: '700', color: c.chipTextActive },
  doneHint: {
    marginTop: 12,
    marginBottom: 8,
    fontSize: 13,
    color: c.textMuted,
    fontStyle: 'italic',
  },
  sec: {
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
    color: c.text,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: c.borderSoft,
  },
  checkTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkBox: { fontSize: 18, color: c.text },
  checkLabel: { flex: 1, fontSize: 15, color: c.text },
  checkDel: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: r.sm,
    backgroundColor: c.errorBg,
  },
  checkDelText: { color: c.error, fontWeight: '700', fontSize: 12 },
  checkDone: { textDecorationLine: 'line-through', color: c.textMuted },
  addCheckRow: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 10,
    marginBottom: 8,
    backgroundColor: c.surface,
    color: c.text,
  },
  smallBtn: {
    backgroundColor: c.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: r.sm,
  },
  smallBtnText: { fontWeight: '700', color: c.primaryDark },
  attRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 8,
  },
  attKind: { fontSize: 14, fontWeight: '600', color: c.text },
  attUrl: { fontSize: 12, color: c.link, marginTop: 2 },
  del: { color: c.error, fontWeight: '600' },
  linkActions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    backgroundColor: c.surface,
  },
  secondaryBtnText: { fontWeight: '700', color: c.primaryDark },
  deleteTaskBtn: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: c.errorBg,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.error,
  },
  deleteTaskBtnText: { color: c.error, fontWeight: '700', fontSize: 15 },
  closeBig: {
    marginTop: 20,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: c.checkIn,
    borderRadius: r.md,
  },
  closeBigText: { color: c.onAccent, fontWeight: '700', fontSize: 16 },
});
