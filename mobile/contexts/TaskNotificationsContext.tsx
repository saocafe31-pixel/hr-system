import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { router } from 'expo-router';

import { FriendlyConfirmModal } from '@/components/FriendlyNoticeModal';
import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  emitCommunitySeen,
  emitMentionRead,
  emitPayrollCorrectionOpen,
  emitTaskNotificationsRead,
  onCommunitySeen,
  onTaskNotificationsRead,
} from '@/lib/appSignals';
import { supabase } from '@/lib/supabase';
import type {
  AttendanceChatMentionNotificationRow,
  FinanceClaimNotificationRow,
  StatusNotificationRow,
  TaskNotificationRow,
} from '@/lib/types';

const COMMUNITY_SEEN_PREFIX = '@foliage/community_notif_seen_v1';

type TaskNotificationsContextValue = {
  enabled: boolean;
  unreadCount: number;
  openNotifModal: () => void;
  pendingOpenTaskId: string | null;
  clearPendingOpenTask: () => void;
};

const TaskNotificationsContext = createContext<TaskNotificationsContextValue | null>(
  null
);

export function useTaskNotifications(): TaskNotificationsContextValue {
  const ctx = useContext(TaskNotificationsContext);
  if (!ctx) {
    return {
      enabled: false,
      unreadCount: 0,
      openNotifModal: () => {},
      pendingOpenTaskId: null,
      clearPendingOpenTask: () => {},
    };
  }
  return ctx;
}

type UnifiedNotif =
  | { kind: 'task'; row: TaskNotificationRow }
  | { kind: 'mention'; row: AttendanceChatMentionNotificationRow }
  | { kind: 'finance'; row: FinanceClaimNotificationRow }
  | { kind: 'status'; row: StatusNotificationRow }
  | {
      kind: 'payroll';
      row: {
        id: string;
        slip_id: string;
        user_id: string;
        cycle_key: string;
        body: string;
        read_at: string | null;
        created_at: string;
      };
    }
  | { kind: 'post_comment'; row: { id: string; body: string; created_at: string } }
  | { kind: 'note_reply'; row: { id: string; body: string; created_at: string } };

function communitySeenKey(uid: string) {
  return `${COMMUNITY_SEEN_PREFIX}/${uid}`;
}

async function readCommunitySeen(uid: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(communitySeenKey(uid));
  } catch {
    return null;
  }
}

async function writeCommunitySeen(uid: string, iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(communitySeenKey(uid), iso);
  } catch {
    /* ignore */
  }
}

function notifCreatedAt(item: UnifiedNotif): string {
  return item.row.created_at;
}

type SnapshotNotifRow = {
  kind: 'task' | 'mention' | 'finance' | 'status' | 'payroll' | 'post_comment' | 'note_reply';
  id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  task_id: string | null;
  message_id: string | null;
  claim_kind: 'salary' | 'expense' | 'payroll' | null;
  claim_id: string | null;
  event_type:
    | 'submitted'
    | 'status_updated'
    | 'leave_status'
    | 'overtime_status'
    | 'correction_requested'
    | null;
  status: 'pending' | 'approved' | 'rejected' | 'paid' | null;
  entity_kind: 'leave' | 'overtime' | 'payroll' | null;
  entity_id: string | null;
  cycle_key: string | null;
};

export function TaskNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createTaskNotificationStyles(theme), [theme]);
  const uid = session?.user?.id ?? null;
  /** พนักงานทุกคนใช้กระดิ่งได้ — รวมแจ้งเตือนงาน + การถูกกล่าวถึงในแชท */
  const enabled = !!uid;
  const [notifs, setNotifs] = useState<UnifiedNotif[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [confirmReadAllOpen, setConfirmReadAllOpen] = useState(false);
  const [pendingOpenTaskId, setPendingOpenTaskId] = useState<string | null>(null);
  const [communitySeenAt, setCommunitySeenAt] = useState<string | null>(null);
  const notifOpenAutoReadRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!uid) {
        setCommunitySeenAt(null);
        return;
      }
      const seen = await readCommunitySeen(uid);
      if (alive) setCommunitySeenAt(seen);
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  const loadNotifs = useCallback(async () => {
    if (!enabled || !uid) {
      setNotifs([]);
      return;
    }
    const { data } = await supabase.rpc('app_badge_notif_snapshot', {
      p_chat_seen: new Date().toISOString(),
      p_community_seen: communitySeenAt ?? new Date().toISOString(),
      p_limit: 80,
    });
    const rows = ((data as { notifications?: SnapshotNotifRow[] } | null)?.notifications ??
      []) as SnapshotNotifRow[];
    const merged: UnifiedNotif[] = rows
      .map((row): UnifiedNotif => {
        if (row.kind === 'task') {
          return {
            kind: 'task',
            row: {
              id: row.id,
              task_id: row.task_id ?? '',
              recipient_id: uid,
              body: row.body,
              read_at: row.read_at,
              created_at: row.created_at,
            } as TaskNotificationRow,
          };
        }
        if (row.kind === 'mention') {
          return {
            kind: 'mention',
            row: {
              id: row.id,
              message_id: row.message_id ?? '',
              recipient_id: uid,
              body: row.body,
              read_at: row.read_at,
              created_at: row.created_at,
            } as AttendanceChatMentionNotificationRow,
          };
        }
        if (row.kind === 'finance') {
          return {
            kind: 'finance',
            row: {
              id: row.id,
              recipient_id: uid,
              actor_id: null,
              claim_kind: row.claim_kind ?? 'salary',
              claim_id: row.claim_id ?? '',
              event_type: row.event_type ?? 'status_updated',
              status: row.status,
              body: row.body,
              read_at: row.read_at,
              created_at: row.created_at,
            } as FinanceClaimNotificationRow,
          };
        }
        if (row.kind === 'status') {
          return {
            kind: 'status',
            row: {
              id: row.id,
              recipient_id: uid,
              actor_id: null,
              event_type:
                row.event_type === 'overtime_status' ? 'overtime_status' : 'leave_status',
              entity_kind: row.entity_kind === 'overtime' ? 'overtime' : 'leave',
              entity_id: row.entity_id ?? '',
              status: row.status ?? '',
              body: row.body,
              read_at: row.read_at,
              created_at: row.created_at,
            } as StatusNotificationRow,
          };
        }
        if (row.kind === 'payroll') {
          return {
            kind: 'payroll',
            row: {
              id: row.id,
              slip_id: row.claim_id ?? '',
              user_id: row.entity_id ?? '',
              cycle_key: row.cycle_key ?? '',
              body: row.body,
              read_at: row.read_at,
              created_at: row.created_at,
            },
          };
        }
        if (row.kind === 'post_comment') {
          return {
            kind: 'post_comment',
            row: { id: row.id, body: row.body, created_at: row.created_at },
          };
        }
        return {
          kind: 'note_reply',
          row: { id: row.id, body: row.body, created_at: row.created_at },
        };
      })
      .sort((a, b) => new Date(notifCreatedAt(b)).getTime() - new Date(notifCreatedAt(a)).getTime());
    setNotifs(merged);
  }, [enabled, uid, communitySeenAt]);

  useEffect(() => {
    void loadNotifs();
  }, [loadNotifs]);

  useEffect(() => {
    if (!enabled || !uid) return;
    const id = setInterval(() => {
      void loadNotifs();
    }, 60_000);
    return () => clearInterval(id);
  }, [enabled, uid, loadNotifs]);

  useEffect(() => {
    if (!enabled || !uid) return;
    const channel = supabase
      .channel(`task_notifications_header_${uid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        () => {
          void loadNotifs();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_chat_mention_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        () => {
          void loadNotifs();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'finance_claim_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        () => {
          void loadNotifs();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'status_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        () => {
          void loadNotifs();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payroll_correction_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        () => {
          void loadNotifs();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, uid, loadNotifs]);

  const unreadNotifs = useMemo(
    () =>
      notifs.filter((n) => {
        if (
          n.kind === 'task' ||
          n.kind === 'mention' ||
          n.kind === 'finance' ||
          n.kind === 'status' ||
          n.kind === 'payroll'
        ) {
          return !n.row.read_at;
        }
        if (!communitySeenAt) return true;
        return new Date(n.row.created_at).getTime() > new Date(communitySeenAt).getTime();
      }),
    [communitySeenAt, notifs]
  );
  const unreadFinanceNotifs = useMemo(
    () =>
      notifs.filter(
        (n): n is UnifiedNotif & { kind: 'finance' } =>
          n.kind === 'finance' && !n.row.read_at
      ),
    [notifs]
  );

  const openNotifModal = useCallback(() => {
    if (!enabled) return;
    notifOpenAutoReadRef.current = false;
    setNotifOpen(true);
  }, [enabled]);

  const clearPendingOpenTask = useCallback(() => {
    setPendingOpenTaskId(null);
  }, []);

  const markNotifRead = useCallback(
    async (item: UnifiedNotif) => {
      const now = new Date().toISOString();
      if (item.kind === 'task') {
        await supabase
          .from('task_notifications')
          .update({ read_at: now })
          .eq('id', item.row.id);
        emitTaskNotificationsRead({ source: 'notif_center' });
      } else if (item.kind === 'mention') {
        await supabase
          .from('attendance_chat_mention_notifications')
          .update({ read_at: now })
          .eq('id', item.row.id);
        emitMentionRead({
          mentionIds: [item.row.id],
          source: 'notif_center',
        });
      } else if (item.kind === 'finance') {
        await supabase
          .from('finance_claim_notifications')
          .update({ read_at: now })
          .eq('id', item.row.id);
      } else if (item.kind === 'status') {
        await supabase
          .from('status_notifications')
          .update({ read_at: now })
          .eq('id', item.row.id);
      } else if (item.kind === 'payroll') {
        await supabase
          .from('payroll_correction_notifications')
          .update({ read_at: now })
          .eq('id', item.row.id);
      } else if (uid) {
        const created = item.row.created_at;
        await writeCommunitySeen(uid, created);
        setCommunitySeenAt(created);
        emitCommunitySeen({ seenAt: created, source: 'notif_center' });
      }
      await loadNotifs();
    },
    [loadNotifs, uid]
  );

  const markAllNotifsRead = useCallback(async (reload = true) => {
    if (unreadNotifs.length === 0) return;
    const now = new Date().toISOString();
    const taskIds = unreadNotifs
      .filter((n): n is UnifiedNotif & { kind: 'task' } => n.kind === 'task')
      .map((n) => n.row.id);
    const mentionIds = unreadNotifs
      .filter(
        (n): n is UnifiedNotif & { kind: 'mention' } => n.kind === 'mention'
      )
      .map((n) => n.row.id);
    const financeIds = unreadNotifs
      .filter((n): n is UnifiedNotif & { kind: 'finance' } => n.kind === 'finance')
      .map((n) => n.row.id);
    const statusIds = unreadNotifs
      .filter((n): n is UnifiedNotif & { kind: 'status' } => n.kind === 'status')
      .map((n) => n.row.id);
    const payrollIds = unreadNotifs
      .filter((n): n is UnifiedNotif & { kind: 'payroll' } => n.kind === 'payroll')
      .map((n) => n.row.id);
    if (taskIds.length) {
      await supabase
        .from('task_notifications')
        .update({ read_at: now })
        .in('id', taskIds);
      emitTaskNotificationsRead({ source: 'notif_center' });
    }
    if (mentionIds.length) {
      await supabase
        .from('attendance_chat_mention_notifications')
        .update({ read_at: now })
        .in('id', mentionIds);
      emitMentionRead({
        mentionIds,
        source: 'notif_center',
      });
    }
    if (financeIds.length) {
      await supabase
        .from('finance_claim_notifications')
        .update({ read_at: now })
        .in('id', financeIds);
    }
    if (statusIds.length) {
      await supabase
        .from('status_notifications')
        .update({ read_at: now })
        .in('id', statusIds);
    }
    if (payrollIds.length) {
      await supabase
        .from('payroll_correction_notifications')
        .update({ read_at: now })
        .in('id', payrollIds);
    }
    const communityRows = unreadNotifs.filter(
      (n) => n.kind === 'post_comment' || n.kind === 'note_reply'
    );
    if (communityRows.length && uid) {
      const latest = communityRows
        .map((n) => n.row.created_at)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
      if (latest) {
        await writeCommunitySeen(uid, latest);
        setCommunitySeenAt(latest);
        emitCommunitySeen({ seenAt: latest, source: 'notif_center' });
      }
    }
    setNotifs((prev) =>
      prev.map((n) => {
        if (n.kind === 'task' && taskIds.includes(n.row.id)) {
          return { ...n, row: { ...n.row, read_at: now } };
        }
        if (n.kind === 'mention' && mentionIds.includes(n.row.id)) {
          return { ...n, row: { ...n.row, read_at: now } };
        }
        if (n.kind === 'finance' && financeIds.includes(n.row.id)) {
          return { ...n, row: { ...n.row, read_at: now } };
        }
        if (n.kind === 'status' && statusIds.includes(n.row.id)) {
          return { ...n, row: { ...n.row, read_at: now } };
        }
        if (n.kind === 'payroll' && payrollIds.includes(n.row.id)) {
          return { ...n, row: { ...n.row, read_at: now } };
        }
        return n;
      })
    );
    setConfirmReadAllOpen(false);
    if (reload) await loadNotifs();
  }, [unreadNotifs, loadNotifs, uid]);

  useEffect(() => {
    if (!notifOpen) {
      notifOpenAutoReadRef.current = false;
      return;
    }
    if (notifOpenAutoReadRef.current || unreadNotifs.length === 0) return;
    notifOpenAutoReadRef.current = true;
    void markAllNotifsRead(false);
  }, [markAllNotifsRead, notifOpen, unreadNotifs.length]);

  useEffect(() => {
    const offCommunity = onCommunitySeen((payload) => {
      if (payload.source !== 'notif_center') {
        setCommunitySeenAt(payload.seenAt);
        if (uid) void writeCommunitySeen(uid, payload.seenAt);
      }
    });
    const offTaskRead = onTaskNotificationsRead(() => {
      const now = new Date().toISOString();
      setNotifs((prev) =>
        prev.map((n) =>
          n.kind === 'task' && !n.row.read_at
            ? { ...n, row: { ...n.row, read_at: now } }
            : n
        )
      );
    });
    return () => {
      offCommunity();
      offTaskRead();
    };
  }, [uid]);

  const markAllFinanceNotifsRead = useCallback(async () => {
    if (unreadFinanceNotifs.length === 0) return;
    const now = new Date().toISOString();
    await supabase
      .from('finance_claim_notifications')
      .update({ read_at: now })
      .in(
        'id',
        unreadFinanceNotifs.map((n) => n.row.id)
      );
    await loadNotifs();
  }, [unreadFinanceNotifs, loadNotifs]);

  const onPressNotifRow = useCallback(
    (item: UnifiedNotif) => {
      void markNotifRead(item);
      setNotifOpen(false);
      if (item.kind === 'task') {
        setPendingOpenTaskId(item.row.task_id);
        router.push('/tasks');
      } else if (item.kind === 'mention') {
        router.push('/chat');
      } else if (item.kind === 'finance') {
        router.push('/profile');
      } else if (item.kind === 'status') {
        router.push(item.row.entity_kind === 'overtime' ? '/attendance' : '/profile');
      } else if (item.kind === 'payroll') {
        emitPayrollCorrectionOpen({
          userId: item.row.user_id,
          cycleKey: item.row.cycle_key,
          slipId: item.row.slip_id,
        });
        router.push('/admin');
      } else {
        router.push('/community');
      }
    },
    [markNotifRead]
  );

  const value = useMemo(
    (): TaskNotificationsContextValue => ({
      enabled,
      unreadCount: unreadNotifs.length,
      openNotifModal,
      pendingOpenTaskId,
      clearPendingOpenTask,
    }),
    [enabled, unreadNotifs.length, openNotifModal, pendingOpenTaskId, clearPendingOpenTask]
  );

  return (
    <TaskNotificationsContext.Provider value={value}>
      {children}
      {enabled ? (
        <>
          <Modal
            visible={notifOpen}
            animationType="slide"
            transparent
            presentationStyle="overFullScreen"
            statusBarTranslucent
            onRequestClose={() => setNotifOpen(false)}>
            <Pressable style={styles.mgrBack} onPress={() => setNotifOpen(false)}>
              <Pressable style={styles.mgrCard} onPress={() => {}}>
                <View style={styles.notifHeaderRow}>
                  <Text style={styles.mgrH1}>การแจ้งเตือน</Text>
                  {unreadNotifs.length > 0 ? (
                    <Pressable
                      style={styles.notifReadAllBtn}
                      onPress={() => setConfirmReadAllOpen(true)}>
                      <Text style={styles.notifReadAllBtnText}>อ่านทั้งหมด</Text>
                    </Pressable>
                  ) : null}
                </View>
                <ScrollView style={{ maxHeight: 420 }}>
                  {notifs.length === 0 ? (
                    <Text style={styles.empty}>ยังไม่มีการแจ้งเตือน</Text>
                  ) : (
                    notifs.map((item) => {
                      const id =
                        item.kind === 'task' ? item.row.id : item.row.id;
                      const body =
                        item.kind === 'task' ? item.row.body : item.row.body;
                      const created =
                        item.kind === 'task'
                          ? item.row.created_at
                          : item.row.created_at;
                      const unread =
                        item.kind === 'task' ||
                        item.kind === 'mention' ||
                        item.kind === 'finance' ||
                        item.kind === 'status' ||
                        item.kind === 'payroll'
                          ? !item.row.read_at
                          : true;
                      return (
                        <Pressable
                          key={`${item.kind}-${id}`}
                          style={[styles.notifRow, unread && styles.notifRowUnread]}
                          onPress={() => onPressNotifRow(item)}>
                          <Text style={styles.notifKind}>
                            {item.kind === 'task'
                              ? 'งาน'
                              : item.kind === 'mention'
                                ? 'แชท · กล่าวถึง'
                                : item.kind === 'finance'
                                  ? 'การเงิน · เบิกเงิน'
                                : item.kind === 'status'
                                  ? item.row.entity_kind === 'overtime'
                                    ? 'ทีม · โอที'
                                    : 'ลา · สถานะคำขอ'
                                  : item.kind === 'payroll'
                                    ? 'Payroll · แจ้งแก้ไขสลิป'
                                : item.kind === 'post_comment'
                                  ? 'คอมมูนิตี้ · โพสต์'
                                  : 'คอมมูนิตี้ · โน้ต'}
                          </Text>
                          <Text style={styles.notifBody} numberOfLines={4}>
                            {body}
                          </Text>
                          <Text style={styles.notifTime}>
                            {new Date(created).toLocaleString('th-TH')}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
                {unreadFinanceNotifs.length > 0 ? (
                  <Pressable
                    style={styles.financeReadAllBtn}
                    onPress={() => void markAllFinanceNotifsRead()}>
                    <Text style={styles.financeReadAllBtnText}>
                      อ่านแจ้งเตือนการเงินทั้งหมด ({unreadFinanceNotifs.length})
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.sheetSecondaryBtn}
                  onPress={() => setNotifOpen(false)}>
                  <Text style={styles.sheetSecondaryBtnText}>ปิด</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>
          <FriendlyConfirmModal
            visible={confirmReadAllOpen}
            title="ทำเครื่องหมายว่าอ่านแล้วทั้งหมด?"
            message={`จำนวนที่ยังไม่อ่าน: ${unreadNotifs.length} รายการ`}
            confirmLabel="อ่านทั้งหมด"
            cancelLabel="ยกเลิก"
            onConfirm={() => void markAllNotifsRead()}
            onCancel={() => setConfirmReadAllOpen(false)}
          />
        </>
      ) : null}
    </TaskNotificationsContext.Provider>
  );
}

function createTaskNotificationStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;
  const isLightTheme = c.canvas === '#F8FAF1';

  return StyleSheet.create({
  mgrBack: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
  },
  mgrCard: {
    backgroundColor: c.surface,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    padding: 18,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: c.borderSoft,
    shadowColor: c.shadow,
    shadowOpacity: isLightTheme ? 0.14 : 0,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: isLightTheme ? 4 : 0,
  },
  mgrH1: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
  },
  notifHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  notifReadAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    backgroundColor: c.primaryLight,
  },
  notifReadAllBtnText: { fontSize: 11, color: c.primaryDark, fontWeight: '700' },
  notifRow: {
    paddingVertical: 10,
    paddingHorizontal: isLightTheme ? 10 : 0,
    borderBottomWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: isLightTheme ? r.sm : 0,
    marginBottom: isLightTheme ? 6 : 0,
    backgroundColor: isLightTheme ? c.surfaceElevated : 'transparent',
  },
  notifRowUnread: {
    backgroundColor: c.primaryLight,
    borderLeftWidth: isLightTheme ? 4 : 0,
    borderLeftColor: c.primaryMuted,
  },
  notifKind: {
    fontSize: 11,
    fontWeight: '800',
    color: c.primaryDark,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  notifBody: { fontSize: 13, color: c.textSecondary, lineHeight: 18 },
  notifTime: { fontSize: 11, color: c.textMuted, marginTop: 4 },
  empty: { textAlign: 'center', color: c.textMuted, marginTop: 24 },
  sheetSecondaryBtn: {
    marginTop: 10,
    backgroundColor: isLightTheme ? c.surfaceMuted : c.surface,
    paddingVertical: 12,
    borderRadius: r.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
  },
  sheetSecondaryBtnText: { color: c.primaryDark, fontWeight: '700', fontSize: 14 },
  financeReadAllBtn: {
    marginTop: 10,
    backgroundColor: c.primaryLight,
    paddingVertical: 11,
    borderRadius: r.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.primaryMuted,
  },
  financeReadAllBtnText: {
    color: c.primaryDark,
    fontWeight: '700',
    fontSize: 13,
  },
  });
}
