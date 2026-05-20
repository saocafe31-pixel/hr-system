import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
import { NatureTheme } from '@/constants/Theme';
import { useAuth } from '@/contexts/AuthContext';
import { emitMentionRead } from '@/lib/appSignals';
import { supabase } from '@/lib/supabase';
import type {
  AttendanceChatMentionNotificationRow,
  FinanceClaimNotificationRow,
  TaskNotificationRow,
} from '@/lib/types';

const c = NatureTheme.colors;
const r = NatureTheme.radius;
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
  kind: 'task' | 'mention' | 'finance' | 'post_comment' | 'note_reply';
  id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  task_id: string | null;
  message_id: string | null;
  claim_kind: 'salary' | 'expense' | null;
  claim_id: string | null;
  event_type: 'submitted' | 'status_updated' | null;
  status: 'pending' | 'approved' | 'rejected' | 'paid' | null;
};

export function TaskNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  /** พนักงานทุกคนใช้กระดิ่งได้ — รวมแจ้งเตือนงาน + การถูกกล่าวถึงในแชท */
  const enabled = !!uid;
  const [notifs, setNotifs] = useState<UnifiedNotif[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [confirmReadAllOpen, setConfirmReadAllOpen] = useState(false);
  const [pendingOpenTaskId, setPendingOpenTaskId] = useState<string | null>(null);
  const [communitySeenAt, setCommunitySeenAt] = useState<string | null>(null);

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
      .map((row) => {
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, uid, loadNotifs]);

  const unreadNotifs = useMemo(
    () =>
      notifs.filter((n) =>
        n.kind === 'task' || n.kind === 'mention' || n.kind === 'finance' ? !n.row.read_at : true
      ),
    [notifs]
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
      } else if (uid) {
        const created = item.row.created_at;
        await writeCommunitySeen(uid, created);
        setCommunitySeenAt(created);
      }
      await loadNotifs();
    },
    [loadNotifs, uid]
  );

  const markAllNotifsRead = useCallback(async () => {
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
    if (taskIds.length) {
      await supabase
        .from('task_notifications')
        .update({ read_at: now })
        .in('id', taskIds);
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
      }
    }
    setConfirmReadAllOpen(false);
    await loadNotifs();
  }, [unreadNotifs, loadNotifs, uid]);

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
                        item.kind === 'finance'
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

const styles = StyleSheet.create({
  mgrBack: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
  },
  mgrCard: {
    backgroundColor: c.surfaceElevated,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    padding: 18,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: c.borderSoft,
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
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  notifReadAllBtnText: { fontSize: 11, color: c.primaryDark, fontWeight: '700' },
  notifRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: c.warningBorder,
  },
  notifRowUnread: {
    backgroundColor: c.primaryLight,
  },
  notifKind: {
    fontSize: 11,
    fontWeight: '800',
    color: c.primaryDark,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  notifBody: { fontSize: 13, color: c.warningBody },
  notifTime: { fontSize: 11, color: c.warningHint, marginTop: 4 },
  empty: { textAlign: 'center', color: c.textMuted, marginTop: 24 },
  sheetSecondaryBtn: {
    marginTop: 10,
    backgroundColor: c.surface,
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
