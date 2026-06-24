import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSegments } from 'expo-router';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import {
  presentBackgroundAwareNotification,
  setHomeIconBadgeCount,
} from '@/lib/appNotifications';
import {
  emitCommunitySeen,
  emitMentionRead,
  emitTaskNotificationsRead,
  onCommunitySeen,
  onLeaveStatusChanged,
  onMentionRead,
  onTaskNotificationsRead,
  onTaskStatusChanged,
} from '@/lib/appSignals';
import { supabase, supabaseConfigured } from '@/lib/supabase';

const STORAGE_PREFIX = '@foliage/tab_seen_v1';

function seenKey(kind: 'chat' | 'community', userId: string) {
  return `${STORAGE_PREFIX}/${kind}/${userId}`;
}

async function readSeen(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function writeSeen(key: string, iso: string) {
  try {
    await AsyncStorage.setItem(key, iso);
  } catch {
    /* ignore */
  }
}

type TabUnreadBadgesContextValue = {
  chatBadge: number | string | undefined;
  communityBadge: number | string | undefined;
  /** แจ้งเตือนงาน (ยังไม่อ่าน) — แท็บงาน */
  taskNotifBadge: number | string | undefined;
  /** รวมทุกประเภทสำหรับไอคอนแอปบนโฮมสกรีน (แบบ Facebook) */
  totalHomeBadge: number;
  markChatSeen: () => Promise<void>;
  markCommunitySeen: () => Promise<void>;
  refresh: () => Promise<void>;
};

const TabUnreadBadgesContext =
  createContext<TabUnreadBadgesContextValue | null>(null);

function formatBadge(n: number): number | string | undefined {
  if (n <= 0) return undefined;
  if (n > 99) return '99+';
  return n;
}

type BadgeSnapshot = {
  chat: number;
  community: number;
  task_unread: number;
  mention_unread: number;
  finance_unread: number;
  status_unread: number;
  payroll_unread: number;
};

export function TabUnreadBadgesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const segments = useSegments();
  const leaf = segments[segments.length - 1] ?? '';
  const onChatTab = leaf === 'chat';
  const onCommunityTab = leaf === 'community';
  const onTasksTab = leaf === 'tasks';

  const [lastChatSeen, setLastChatSeen] = useState<string | null>(null);
  const [lastCommunitySeen, setLastCommunitySeen] = useState<string | null>(
    null
  );
  const [hydrated, setHydrated] = useState(false);
  const [chatRaw, setChatRaw] = useState(0);
  const [communityRaw, setCommunityRaw] = useState(0);
  const [taskNotifRaw, setTaskNotifRaw] = useState(0);
  const [mentionRaw, setMentionRaw] = useState(0);
  const [financeNotifRaw, setFinanceNotifRaw] = useState(0);
  const [statusNotifRaw, setStatusNotifRaw] = useState(0);
  const [payrollNotifRaw, setPayrollNotifRaw] = useState(0);
  const [notifPrefs, setNotifPrefs] = useState({
    task_enabled: true,
    mention_enabled: true,
    checkout_enabled: true,
  });

  const prevChatTab = useRef(false);
  const prevCommTab = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markChatSeen = useCallback(async () => {
    if (!uid) return;
    const now = new Date().toISOString();
    await writeSeen(seenKey('chat', uid), now);
    setLastChatSeen(now);
    setChatRaw(0);
  }, [uid]);

  const markCommunitySeen = useCallback(async () => {
    if (!uid) return;
    const now = new Date().toISOString();
    await writeSeen(seenKey('community', uid), now);
    setLastCommunitySeen(now);
    setCommunityRaw(0);
    emitCommunitySeen({ seenAt: now, source: 'tab' });
  }, [uid]);

  const markTaskNotificationsSeen = useCallback(async () => {
    if (!uid) return;
    setTaskNotifRaw(0);
    await supabase
      .from('task_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', uid)
      .is('read_at', null);
    emitTaskNotificationsRead({ source: 'tasks_tab' });
  }, [uid]);

  const markMentionNotificationsSeen = useCallback(async () => {
    if (!uid) return;
    setMentionRaw(0);
    await supabase
      .from('attendance_chat_mention_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', uid)
      .is('read_at', null);
    emitMentionRead({ source: 'chat' });
  }, [uid]);

  const fetchBadgeSnapshot = useCallback(
    async (chatSeenIso: string, communitySeenIso: string): Promise<BadgeSnapshot> => {
      if (!supabaseConfigured) {
        return {
          chat: 0,
          community: 0,
          task_unread: 0,
          mention_unread: 0,
          finance_unread: 0,
          status_unread: 0,
          payroll_unread: 0,
        };
      }
      const { data } = await supabase.rpc('app_badge_notif_snapshot', {
        p_chat_seen: chatSeenIso,
        p_community_seen: communitySeenIso,
        p_limit: 1,
      });
      const payload = (data as { counts?: Partial<BadgeSnapshot> } | null)?.counts;
      return {
        chat: Number(payload?.chat ?? 0),
        community: Number(payload?.community ?? 0),
        task_unread: Number(payload?.task_unread ?? 0),
        mention_unread: Number(payload?.mention_unread ?? 0),
        finance_unread: Number(payload?.finance_unread ?? 0),
        status_unread: Number(payload?.status_unread ?? 0),
        payroll_unread: Number(payload?.payroll_unread ?? 0),
      };
    },
    []
  );

  const runRefresh = useCallback(async () => {
    if (!uid || !lastChatSeen || !lastCommunitySeen) return;
    const snapshot = await fetchBadgeSnapshot(lastChatSeen, lastCommunitySeen);
    if (!onChatTab) setChatRaw(snapshot.chat);
    if (!onCommunityTab) setCommunityRaw(snapshot.community);
    setTaskNotifRaw(snapshot.task_unread);
    setMentionRaw(snapshot.mention_unread);
    setFinanceNotifRaw(snapshot.finance_unread);
    setStatusNotifRaw(snapshot.status_unread);
    setPayrollNotifRaw(snapshot.payroll_unread);
  }, [
    lastChatSeen,
    lastCommunitySeen,
    fetchBadgeSnapshot,
    onChatTab,
    onCommunityTab,
    uid,
  ]);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void runRefresh();
    }, 350);
  }, [runRefresh]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !uid) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') scheduleRefresh();
    });
    return () => sub.remove();
  }, [hydrated, uid, scheduleRefresh]);

  useEffect(() => {
    // cross-screen optimistic signal (team/chat approve leave) -> refresh badges right away
    const off = onLeaveStatusChanged(() => {
      scheduleRefresh();
    });
    return off;
  }, [scheduleRefresh]);

  useEffect(() => {
    const offTask = onTaskStatusChanged(() => {
      scheduleRefresh();
    });
    const offMention = onMentionRead(() => {
      setMentionRaw(0);
      scheduleRefresh();
    });
    const offCommunity = onCommunitySeen((payload) => {
      setLastCommunitySeen(payload.seenAt);
      setCommunityRaw(0);
      if (uid) void writeSeen(seenKey('community', uid), payload.seenAt);
      scheduleRefresh();
    });
    const offTaskNotifs = onTaskNotificationsRead(() => {
      setTaskNotifRaw(0);
      scheduleRefresh();
    });
    return () => {
      offTask();
      offMention();
      offCommunity();
      offTaskNotifs();
    };
  }, [scheduleRefresh, uid]);

  useEffect(() => {
    let cancelled = false;
    prevChatTab.current = false;
    prevCommTab.current = false;
    (async () => {
      if (!uid) {
        setLastChatSeen(null);
        setLastCommunitySeen(null);
        setHydrated(false);
        setChatRaw(0);
        setCommunityRaw(0);
        setTaskNotifRaw(0);
        setMentionRaw(0);
        setFinanceNotifRaw(0);
        setStatusNotifRaw(0);
        return;
      }
      setHydrated(false);
      const kChat = seenKey('chat', uid);
      const kComm = seenKey('community', uid);
      let chat = await readSeen(kChat);
      let comm = await readSeen(kComm);
      const now = new Date().toISOString();
      if (!chat) {
        chat = now;
        await writeSeen(kChat, chat);
      }
      if (!comm) {
        comm = now;
        await writeSeen(kComm, comm);
      }
      if (cancelled) return;
      setLastChatSeen(chat);
      setLastCommunitySeen(comm);
      const snapshot = await fetchBadgeSnapshot(chat, comm);
      const { data: prefRow } = await supabase
        .from('notification_preferences')
        .select('task_enabled,mention_enabled,checkout_enabled')
        .eq('user_id', uid)
        .maybeSingle();
      if (cancelled) return;
      setChatRaw(snapshot.chat);
      setCommunityRaw(snapshot.community);
      setTaskNotifRaw(snapshot.task_unread);
      setMentionRaw(snapshot.mention_unread);
      setFinanceNotifRaw(snapshot.finance_unread);
      setStatusNotifRaw(snapshot.status_unread);
      setPayrollNotifRaw(snapshot.payroll_unread);
      setNotifPrefs({
        task_enabled: (prefRow as { task_enabled?: boolean } | null)?.task_enabled ?? true,
        mention_enabled: (prefRow as { mention_enabled?: boolean } | null)?.mention_enabled ?? true,
        checkout_enabled:
          (prefRow as { checkout_enabled?: boolean } | null)?.checkout_enabled ?? true,
      });
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, fetchBadgeSnapshot]);

  useEffect(() => {
    if (!hydrated || !uid) return;
    if (onChatTab && !prevChatTab.current) {
      void markChatSeen();
      void markMentionNotificationsSeen();
    }
    prevChatTab.current = onChatTab;
  }, [onChatTab, hydrated, uid, markChatSeen, markMentionNotificationsSeen]);

  useEffect(() => {
    if (!hydrated || !uid) return;
    if (onCommunityTab && !prevCommTab.current) void markCommunitySeen();
    prevCommTab.current = onCommunityTab;
  }, [onCommunityTab, hydrated, uid, markCommunitySeen]);

  useEffect(() => {
    if (!hydrated || !uid || !onTasksTab) return;
    void markTaskNotificationsSeen();
  }, [onTasksTab, hydrated, uid, markTaskNotificationsSeen]);

  useEffect(() => {
    if (!supabaseConfigured || !uid || !hydrated) return;

    const ch = supabase
      .channel(`tab_badges_${uid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_chat_messages' },
        (payload) => {
          scheduleRefresh();
          const row = payload.new as { user_id?: string };
          if (row?.user_id && row.user_id !== uid) {
            void presentBackgroundAwareNotification(
              'แชทเข้า-ออก',
              'มีข้อความใหม่',
              { kind: 'chat' }
            );
          }
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
        (payload) => {
          scheduleRefresh();
          if (payload.eventType === 'INSERT') {
            const row = payload.new as { body?: string; entity_kind?: string };
            void presentBackgroundAwareNotification(
              row?.entity_kind === 'overtime' ? 'โอที' : 'สถานะคำขอ',
              row?.body ?? 'มีอัปเดตสถานะคำขอ',
              { kind: 'status_notification' }
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'task_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        (payload) => {
          scheduleRefresh();
          const row = payload.new as { body?: string };
          if (notifPrefs.task_enabled) {
            void presentBackgroundAwareNotification(
              'งาน',
              row?.body ?? 'มีการแจ้งเตือนงาน',
              { kind: 'task_notification' }
            );
          }
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
        (payload) => {
          scheduleRefresh();
          if (payload.eventType === 'INSERT') {
            const row = payload.new as { body?: string };
            void presentBackgroundAwareNotification(
              'การเงิน',
              row?.body ?? 'มีอัปเดตคำขอเบิกเงิน',
              { kind: 'finance_claim' }
            );
          }
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
        (payload) => {
          scheduleRefresh();
          if (payload.eventType === 'INSERT') {
            const row = payload.new as { body?: string };
            void presentBackgroundAwareNotification(
              'Payroll',
              row?.body ?? 'พนักงานแจ้งแก้ไขสลิปเงินเดือน',
              { kind: 'payroll_correction' }
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'task_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        () => scheduleRefresh()
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance_chat_mention_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        (payload) => {
          scheduleRefresh();
          const row = payload.new as { body?: string };
          if (notifPrefs.mention_enabled) {
            void presentBackgroundAwareNotification(
              'กล่าวถึงคุณ',
              row?.body ?? 'มีคนกล่าวถึงคุณในแชท',
              { kind: 'mention' }
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'attendance_chat_mention_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        () => scheduleRefresh()
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notification_preferences',
          filter: `user_id=eq.${uid}`,
        },
        (payload) => {
          const row = payload.new as {
            task_enabled?: boolean;
            mention_enabled?: boolean;
            checkout_enabled?: boolean;
          };
          setNotifPrefs({
            task_enabled: row.task_enabled ?? true,
            mention_enabled: row.mention_enabled ?? true,
            checkout_enabled: row.checkout_enabled ?? true,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid, hydrated, scheduleRefresh, notifPrefs.mention_enabled, notifPrefs.task_enabled]);

  const totalHomeBadge = useMemo(
    () => chatRaw + communityRaw + taskNotifRaw + mentionRaw + financeNotifRaw + statusNotifRaw + payrollNotifRaw,
    [chatRaw, communityRaw, taskNotifRaw, mentionRaw, financeNotifRaw, statusNotifRaw, payrollNotifRaw]
  );

  const chatBadge = useMemo(() => {
    if (!hydrated || onChatTab) return undefined;
    return formatBadge(chatRaw + mentionRaw);
  }, [hydrated, onChatTab, chatRaw, mentionRaw]);

  const communityBadge = useMemo(() => {
    if (!hydrated || onCommunityTab) return undefined;
    return formatBadge(communityRaw);
  }, [hydrated, onCommunityTab, communityRaw]);

  const taskNotifBadge = useMemo(() => {
    if (!hydrated || onTasksTab) return undefined;
    return formatBadge(taskNotifRaw);
  }, [hydrated, onTasksTab, taskNotifRaw]);

  useEffect(() => {
    if (!hydrated) return;
    void setHomeIconBadgeCount(totalHomeBadge);
  }, [totalHomeBadge, hydrated]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!uid) void setHomeIconBadgeCount(0);
  }, [uid]);

  const value = useMemo<TabUnreadBadgesContextValue>(
    () => ({
      chatBadge,
      communityBadge,
      taskNotifBadge,
      totalHomeBadge,
      markChatSeen,
      markCommunitySeen,
      refresh: runRefresh,
    }),
    [
      chatBadge,
      communityBadge,
      taskNotifBadge,
      totalHomeBadge,
      markChatSeen,
      markCommunitySeen,
      runRefresh,
    ]
  );

  return (
    <TabUnreadBadgesContext.Provider value={value}>
      {children}
    </TabUnreadBadgesContext.Provider>
  );
}

export function useTabUnreadBadges() {
  const ctx = useContext(TabUnreadBadgesContext);
  if (!ctx) {
    throw new Error('useTabUnreadBadges must be used within TabUnreadBadgesProvider');
  }
  return ctx;
}
