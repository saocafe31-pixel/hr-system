import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DatePickerField } from '@/components/DatePickerField';
import { EmployeeScheduleCalendarCard } from '@/components/EmployeeScheduleCalendarCard';
import { FriendlyConfirmModal } from '@/components/FriendlyNoticeModal';
import { TaskNotificationsHeaderButton } from '@/components/TaskNotificationsHeaderButton';
import { UserAvatar } from '@/components/UserAvatar';
import { ZoomableImage } from '@/components/ZoomableImage';
import { isAdmin, isManagerOrAdmin, useAuth, useRole } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { NatureTheme } from '@/constants/Theme';
import {
  chatBodyIndicatesSickLeave,
  extractLeaveRequestIdFromChatBody,
  leaveRequestResolvedInThread,
  parseLateAttendanceChatBody,
} from '@/lib/leaveAttendanceChat';
import {
  activeMentionQuery,
  filterMentionables,
  loadMentionableUsers,
  resolveMentionRecipients,
  type MentionableUser,
} from '@/lib/chatMentions';
import { emitLeaveStatusChanged, onLeaveStatusChanged } from '@/lib/appSignals';
import { humanizeSupabaseError, supabase } from '@/lib/supabase';
import type {
  AttendanceChatMentionNotificationRow,
  AttendanceLog,
  Branch,
  ChatMessage,
} from '@/lib/types';
import {
  fetchLatestTodayEmojiByUserIds,
  nameWithMoodEmoji,
} from '@/lib/wellbeing';

type Row = ChatMessage & {
  display_name?: string;
  display_with_mood?: string;
  avatar_url?: string | null;
};

type ProfileLite = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  employee_id: string | null;
  employee_code: string | null;
};

type EmployeeNameLite = {
  id: string;
  name: string | null;
  surname: string | null;
  nickname: string | null;
};

type ChatProfileTask = {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | string;
  priority: string | null;
  due_at: string | null;
};

type ChatProfileCardData = {
  user_id: string;
  app_name: string;
  phone: string | null;
  avatar_url: string | null;
  real_name: string | null;
  nickname: string | null;
  active_tasks: ChatProfileTask[];
};

type LeaveRequestStatus = 'pending' | 'approved' | 'rejected';

function normalizeText(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function ymdFromDateBangkok(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function ymdToDateBangkok(ymd: string): Date {
  return new Date(`${ymd}T12:00:00+07:00`);
}

function listYmdInclusive(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const d = ymdToDateBangkok(startYmd);
  const end = ymdToDateBangkok(endYmd).getTime();
  while (d.getTime() <= end) {
    out.push(ymdFromDateBangkok(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function csvEscape(v: string): string {
  return `"${v.replaceAll('"', '""')}"`;
}

function fmtBangkokDateTimeCsv(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** คอลัมน์วันที่ — รูปแบบ dd/MM/yyyy (ปี ค.ศ.) */
function fmtBangkokDateCsv(ymd: string): string {
  const d = ymdToDateBangkok(ymd);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function employeeDisplayName(e?: EmployeeNameLite): string | null {
  if (!e) return null;
  const nickname = normalizeText(e.nickname);
  if (nickname) return nickname;
  const full = `${normalizeText(e.name)} ${normalizeText(e.surname)}`.trim();
  return full || null;
}

type UserDisplayCache = Map<
  string,
  { display_name: string; avatar_url: string | null }
>;

/** โหลดชื่อ/รูปสำหรับ user_id หนึ่งหรือหลายคน — ใช้ทั้งโหลดเต็มและข้อความใหม่ทีละแถว */
async function fetchChatUserDisplayMaps(userIds: string[]): Promise<{
  nameMap: Record<string, string>;
  avatarMap: Record<string, string | null>;
}> {
  const nameMap: Record<string, string> = {};
  const avatarMap: Record<string, string | null> = {};
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return { nameMap, avatarMap };

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, full_name, email, avatar_url, employee_id, employee_code')
    .in('id', ids);

  const profileRows = (profs as ProfileLite[]) ?? [];
  const employeeIds = profileRows
    .map((p) => p.employee_id)
    .filter((v): v is string => !!v);

  let employeeMap: Record<string, EmployeeNameLite> = {};
  if (employeeIds.length > 0) {
    const { data: employeeRows } = await supabase
      .from('employee_directory')
      .select('id,name,surname,nickname')
      .in('id', employeeIds);
    for (const e of (employeeRows as EmployeeNameLite[]) ?? []) {
      employeeMap[e.id] = e;
    }
  }

  for (const r of profileRows) {
    const emp = r.employee_id ? employeeMap[r.employee_id] : undefined;
    nameMap[r.id] =
      normalizeText(r.full_name) ||
      employeeDisplayName(emp) ||
      normalizeText(r.email) ||
      r.id.slice(0, 6);
    avatarMap[r.id] = r.avatar_url;
  }
  for (const id of ids) {
    if (nameMap[id] === undefined) {
      nameMap[id] = id.slice(0, 6);
      avatarMap[id] = null;
    }
  }
  return { nameMap, avatarMap };
}

async function resolveRowForMessage(
  m: ChatMessage,
  displayCache: UserDisplayCache
): Promise<Row> {
  const cached = displayCache.get(m.user_id);
  if (cached) {
    const moodMap = await fetchLatestTodayEmojiByUserIds([m.user_id]);
    return {
      ...m,
      display_name: cached.display_name,
      display_with_mood: nameWithMoodEmoji(
        cached.display_name,
        moodMap[m.user_id]
      ),
      avatar_url: cached.avatar_url,
    };
  }
  const { nameMap, avatarMap } = await fetchChatUserDisplayMaps([m.user_id]);
  const baseName = nameMap[m.user_id] ?? m.user_id.slice(0, 6);
  const av = avatarMap[m.user_id] ?? null;
  displayCache.set(m.user_id, { display_name: baseName, avatar_url: av });
  const moodMap = await fetchLatestTodayEmojiByUserIds([m.user_id]);
  return {
    ...m,
    display_name: baseName,
    display_with_mood: nameWithMoodEmoji(baseName, moodMap[m.user_id]),
    avatar_url: av,
  };
}

function chatMessageFromRealtimeNew(
  n: Record<string, unknown> | null | undefined
): ChatMessage | null {
  if (!n || typeof n.id !== 'string' || typeof n.user_id !== 'string') return null;
  return {
    id: n.id,
    user_id: n.user_id,
    body: typeof n.body === 'string' ? n.body : String(n.body ?? ''),
    created_at:
      typeof n.created_at === 'string'
        ? n.created_at
        : String(n.created_at ?? ''),
  };
}

const CHAT_PAGE_SIZE = 20;

/** แปลงแถวแชทเป็น Row พร้อมชื่อ/รูป/อิโมจิ — อัปเดต displayCache ตาม user_id */
async function enrichChatMessages(
  base: ChatMessage[],
  displayCache: UserDisplayCache
): Promise<Row[]> {
  if (!base.length) return [];
  const ids = [...new Set(base.map((m) => m.user_id))];
  const { nameMap, avatarMap } = await fetchChatUserDisplayMaps(ids);
  const moodMap = await fetchLatestTodayEmojiByUserIds(ids);
  for (const id of ids) {
    const baseName = nameMap[id] ?? id.slice(0, 6);
    displayCache.set(id, {
      display_name: baseName,
      avatar_url: avatarMap[id] ?? null,
    });
  }
  return base.map((m) => {
    const baseName = nameMap[m.user_id] ?? m.user_id.slice(0, 6);
    return {
      ...m,
      display_name: baseName,
      display_with_mood: nameWithMoodEmoji(
        baseName,
        moodMap[m.user_id]
      ),
      avatar_url: avatarMap[m.user_id] ?? null,
    };
  });
}

/** ข้อความระบบจาก attendance — แยก prefix แจ้งเข้าสาย ก่อน แจ้งเข้างาน (มีคำว่า «แจ้งเข้า» ทั้งคู่) */
function attendanceBubbleKind(body: string): 'check_in' | 'check_out' | 'plain' {
  const t = body.trim();
  if (t.includes('แจ้งออกงาน')) return 'check_out';
  if (t.includes('แจ้งเข้าสาย:')) return 'check_in';
  if (t.includes('แจ้งลา:')) return 'check_in';
  if (t.includes('แจ้งเข้างาน')) return 'check_in';
  return 'plain';
}

function leaveStatusLabelTh(status: LeaveRequestStatus): string {
  if (status === 'approved') return 'อนุมัติแล้ว';
  if (status === 'rejected') return 'ปฏิเสธแล้ว';
  return 'รออนุมัติ';
}

function extractLeaveRequestIds(rows: readonly Row[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const id = extractLeaveRequestIdFromChatBody(row.body);
    if (id) ids.add(id);
  }
  return [...ids];
}

export default function AttendanceChatScreen() {
  const toast = useCuteToast();
  const navigation = useNavigation();
  const { session } = useAuth();
  const role = useRole();
  const admin = isAdmin(role);
  const canApproveLeave = isManagerOrAdmin(role);
  const [items, setItems] = useState<Row[]>([]);
  const [leaveStatusById, setLeaveStatusById] = useState<Record<string, LeaveRequestStatus>>({});
  const [leaveActionId, setLeaveActionId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [mentionables, setMentionables] = useState<MentionableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const displayByUserRef = useRef<UserDisplayCache>(new Map());
  const itemsRef = useRef<Row[]>([]);
  const lastMessageIdRef = useRef<string | null>(null);
  const olderFetchLockRef = useRef(false);
  const loadingOlderRef = useRef(false);
  /** หลังโหลดเก่า — เปิด onStartReached ใหม่หลัง delay เพื่อกัน FlatList ยิงซ้ำขณะอยู่บนสุด */
  const olderResumeStartReachedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** หลังโหลด/รีเฟรช — เลื่อนท้ายเมื่อ FlatList วัดความสูงจริงแล้ว */
  const snapToBottomPendingRef = useRef(false);
  /** กัน onStartReached ตอน mount (อยู่บนสุด) ไปเรียก loadOlder จนเลื่อนท้ายครั้งแรกเสร็จ */
  const allowStartReachedForOlderRef = useRef(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportStart, setExportStart] = useState<Date | null>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [exportEnd, setExportEnd] = useState<Date | null>(() => new Date());
  const [exporting, setExporting] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileImageOpen, setProfileImageOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileData, setProfileData] = useState<ChatProfileCardData | null>(null);
  const [profileLabel, setProfileLabel] = useState('');
  const [pruneChatConfirmOpen, setPruneChatConfirmOpen] = useState(false);
  const [pruneBusy, setPruneBusy] = useState(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const visibleLeaveRequestIds = useMemo(() => extractLeaveRequestIds(items), [items]);

  const refreshLeaveStatuses = useCallback(async (ids: string[] = visibleLeaveRequestIds) => {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (uniqueIds.length === 0) {
      setLeaveStatusById({});
      return;
    }
    const { data, error } = await supabase
      .from('leave_requests')
      .select('id,status')
      .in('id', uniqueIds);
    if (error) return;
    const next: Record<string, LeaveRequestStatus> = {};
    for (const row of (data as { id?: string; status?: LeaveRequestStatus }[]) ?? []) {
      if (row.id && row.status) next[row.id] = row.status;
    }
    setLeaveStatusById((prev) => ({ ...prev, ...next }));
  }, [visibleLeaveRequestIds]);

  useEffect(() => {
    void refreshLeaveStatuses(visibleLeaveRequestIds);
  }, [refreshLeaveStatuses, visibleLeaveRequestIds]);

  useEffect(
    () => () => {
      if (olderResumeStartReachedTimerRef.current) {
        clearTimeout(olderResumeStartReachedTimerRef.current);
        olderResumeStartReachedTimerRef.current = null;
      }
    },
    []
  );

  const load = useCallback(async () => {
    if (olderResumeStartReachedTimerRef.current) {
      clearTimeout(olderResumeStartReachedTimerRef.current);
      olderResumeStartReachedTimerRef.current = null;
    }
    lastMessageIdRef.current = null;
    allowStartReachedForOlderRef.current = false;
    displayByUserRef.current.clear();
    const { data, error } = await supabase
      .from('attendance_chat_messages')
      .select('id, user_id, body, created_at')
      .order('created_at', { ascending: false })
      .limit(CHAT_PAGE_SIZE);
    if (error) {
      toast.error('โหลดแชทไม่สำเร็จ', error.message);
      return;
    }
    const raw = (data as ChatMessage[]) ?? [];
    /** เก่าบน ใหม่ล่าง (เหมือน LINE) — โหลดช่วงล่าสุดแล้วกลับลำดับเป็น ascending */
    const base = [...raw].reverse();
    const rows = await enrichChatMessages(base, displayByUserRef.current);
    snapToBottomPendingRef.current = true;
    setItems(rows);
    setHasMoreOlder(raw.length === CHAT_PAGE_SIZE);
  }, [toast]);

  const scheduleResumeStartReached = useCallback(() => {
    if (olderResumeStartReachedTimerRef.current) {
      clearTimeout(olderResumeStartReachedTimerRef.current);
    }
    olderResumeStartReachedTimerRef.current = setTimeout(() => {
      olderResumeStartReachedTimerRef.current = null;
      allowStartReachedForOlderRef.current = true;
    }, 520);
  }, []);

  const loadOlder = useCallback(async () => {
    if (olderFetchLockRef.current || !hasMoreOlder || loadingOlderRef.current) return;
    const list = itemsRef.current;
    if (!list.length) return;
    const oldest = list[0];
    allowStartReachedForOlderRef.current = false;
    olderFetchLockRef.current = true;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const { data, error } = await supabase
        .from('attendance_chat_messages')
        .select('id, user_id, body, created_at')
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(CHAT_PAGE_SIZE);
      if (error) {
        toast.error('โหลดประวัติไม่สำเร็จ', error.message);
        return;
      }
      const raw = (data as ChatMessage[]) ?? [];
      if (!raw.length) {
        setHasMoreOlder(false);
        return;
      }
      const batch = [...raw].reverse();
      const rows = await enrichChatMessages(batch, displayByUserRef.current);
      const existing = new Set(list.map((r) => r.id));
      const prepend = rows.filter((r) => !existing.has(r.id));
      if (prepend.length) {
        setItems((prev) => [...prepend, ...prev]);
      }
      if (raw.length < CHAT_PAGE_SIZE) setHasMoreOlder(false);
      else if (prepend.length === 0) {
        setHasMoreOlder(false);
      }
    } finally {
      olderFetchLockRef.current = false;
      loadingOlderRef.current = false;
      setLoadingOlder(false);
      scheduleResumeStartReached();
    }
  }, [hasMoreOlder, scheduleResumeStartReached, toast]);

  const mergeIncomingMessage = useCallback(
    async (m: ChatMessage) => {
      try {
        const row = await resolveRowForMessage(m, displayByUserRef.current);
        let appended = false;
        setItems((prev) => {
          if (prev.some((x) => x.id === row.id)) return prev;
          appended = true;
          const next = [...prev, row];
          return next.length > 800 ? next.slice(-800) : next;
        });
        if (appended) snapToBottomPendingRef.current = true;
      } catch {
        await load();
      }
    },
    [load]
  );

  const scrollChatToBottom = useCallback((animated: boolean) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const onChatContentSizeChange = useCallback(() => {
    if (!items.length) return;
    if (loadingOlder) return;
    if (!snapToBottomPendingRef.current) return;
    snapToBottomPendingRef.current = false;
    lastMessageIdRef.current = items[items.length - 1]!.id;
    const scrollEnd = () => scrollChatToBottom(false);
    requestAnimationFrame(scrollEnd);
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollEnd);
    });
    setTimeout(() => {
      scrollEnd();
      allowStartReachedForOlderRef.current = true;
    }, 120);
  }, [items, loadingOlder, scrollChatToBottom]);

  /** โหลดครั้งแรก / เว็บ: onContentSizeChange บางครั้งมาช้า — ซ้ำ scroll ไปท้ายรายการ */
  useEffect(() => {
    if (loading) return;
    if (!items.length) return;
    if (!snapToBottomPendingRef.current) return;
    const scrollEnd = () => scrollChatToBottom(false);
    const timeouts: ReturnType<typeof setTimeout>[] = [
      setTimeout(scrollEnd, 0),
      setTimeout(scrollEnd, 50),
      setTimeout(scrollEnd, 160),
      setTimeout(scrollEnd, 400),
    ];
    const interaction = InteractionManager.runAfterInteractions(() => {
      scrollEnd();
      timeouts.push(setTimeout(scrollEnd, 520));
    });
    return () => {
      timeouts.forEach(clearTimeout);
      interaction.cancel?.();
    };
  }, [loading, items.length, scrollChatToBottom]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  async function runPruneOldAttendanceChat() {
    if (pruneBusy || !admin) return;
    setPruneBusy(true);
    const { data, error } = await supabase.rpc('admin_delete_attendance_chat_messages_older_than', {
      p_days: 90,
    });
    setPruneBusy(false);
    setPruneChatConfirmOpen(false);
    if (error) {
      toast.error('ลบข้อความไม่สำเร็จ', humanizeSupabaseError(error.message));
      return;
    }
    const n = typeof data === 'number' ? data : Number(data ?? 0);
    toast.success(
      'ลบข้อความแล้ว',
      `ลบถาวร ${Number.isFinite(n) ? n : 0} แถว (วันที่ข้อความตามปฏิทินไทยเก่ากว่า 90 วัน) — แจ้งเตือน @ ที่เกี่ยวข้องถูกลบตามไปด้วย`
    );
    await load();
  }

  const mentionPick = useMemo(
    () => activeMentionQuery(body, selection.start),
    [body, selection.start]
  );
  const mentionChoices = useMemo(
    () =>
      mentionPick ? filterMentionables(mentionables, mentionPick.query) : [],
    [mentionPick, mentionables]
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          {canApproveLeave ? (
            <Pressable
              accessibilityLabel="ดาวน์โหลดเวลาเข้า-ออกงาน"
              onPress={() => setExportOpen(true)}
              style={styles.headerIconBtn}
              hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}>
              <FontAwesome name="download" size={18} color={NatureTheme.colors.text} />
            </Pressable>
          ) : null}
          {admin ? (
            <Pressable
              accessibilityLabel="ลบข้อความแชทเก่ากว่า 90 วัน (แอดมิน)"
              onPress={() => setPruneChatConfirmOpen(true)}
              style={[styles.headerIconBtn, styles.headerIconBtnDanger]}
              hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}>
              <FontAwesome name="trash" size={17} color={NatureTheme.colors.error} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="รีเฟรชแชท"
            onPress={() => void onPullRefresh()}
            style={styles.headerIconBtn}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}>
            <FontAwesome
              name="refresh"
              size={18}
              color={NatureTheme.colors.text}
            />
          </Pressable>
          <TaskNotificationsHeaderButton />
        </View>
      ),
    });
  }, [admin, canApproveLeave, navigation, onPullRefresh]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      await load();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await loadMentionableUsers(supabase);
        if (alive) setMentionables(rows);
      } catch (e) {
        if (alive) {
          toast.error(
            'โหลดรายชื่อสำหรับ @ ไม่สำเร็จ',
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    const channel = supabase
      .channel(`attendance_chat_mention_notifications_${uid}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance_chat_mention_notifications',
          filter: `recipient_id=eq.${uid}`,
        },
        (payload) => {
          const row = payload.new as AttendanceChatMentionNotificationRow;
          if (row?.body) {
            toast.info('แชทกล่าวถึงคุณ', row.body);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, toast]);

  useEffect(() => {
    const channel = supabase
      .channel('attendance_chat_messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance_chat_messages',
        },
        (payload) => {
          const m = chatMessageFromRealtimeNew(
            payload.new as Record<string, unknown>
          );
          if (m) void mergeIncomingMessage(m);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leave_requests',
        },
        (payload) => {
          const row = payload.new as { id?: string; status?: LeaveRequestStatus };
          if (!row.id || !row.status) return;
          setLeaveStatusById((prev) => ({ ...prev, [row.id!]: row.status! }));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [mergeIncomingMessage]);

  useEffect(() => {
    const off = onLeaveStatusChanged((payload) => {
      // อนุมัติ/ปฏิเสธจากหน้าอื่น ให้แชทเปลี่ยนสถานะปุ่มทันที
      setLeaveStatusById((prev) => ({
        ...prev,
        [payload.leaveId]: payload.action,
      }));
      void refreshLeaveStatuses([payload.leaveId]);
    });
    return off;
  }, [refreshLeaveStatuses]);

  function applyMentionPick(u: MentionableUser) {
    const aq = activeMentionQuery(body, selection.start);
    if (!aq) return;
    const newBody =
      body.slice(0, aq.atIndex + 1) +
      u.insertLabel +
      ' ' +
      body.slice(aq.caret);
    setBody(newBody);
    const newPos = aq.atIndex + 1 + u.insertLabel.length + 1;
    requestAnimationFrame(() => {
      inputRef.current?.setNativeProps({
        selection: { start: newPos, end: newPos },
      });
      setSelection({ start: newPos, end: newPos });
    });
  }

  async function respondLeave(leaveId: string, approve: boolean) {
    if (!session?.user?.id) return;
    const currentStatus = leaveStatusById[leaveId];
    if (currentStatus && currentStatus !== 'pending') {
      toast.info('คำขอลา', `รายการนี้${leaveStatusLabelTh(currentStatus)}แล้ว`);
      return;
    }
    setLeaveActionId(leaveId);
    try {
      const { data, error } = await supabase.rpc('respond_leave_request', {
        p_leave_id: leaveId,
        p_approve: approve,
      });
      if (error) throw new Error(error.message);
      const row = data as { ok?: boolean; error?: string } | null;
      if (!row?.ok) {
        const err = row?.error ?? 'ไม่สามารถดำเนินการได้';
        if (err === 'not_pending_or_missing') {
          toast.info('คำขอลา', 'รายการนี้อนุมัติ/ปฏิเสธไปแล้ว หรือไม่พบ');
          await refreshLeaveStatuses([leaveId]);
        } else if (err === 'forbidden') {
          toast.info('สิทธิ์', 'เฉพาะ HR / ผู้จัดการเท่านั้น');
        } else {
          toast.error('ไม่สำเร็จ', err);
        }
        return;
      }
      setLeaveStatusById((prev) => ({
        ...prev,
        [leaveId]: approve ? 'approved' : 'rejected',
      }));
      emitLeaveStatusChanged({
        leaveId,
        action: approve ? 'approved' : 'rejected',
        source: 'chat',
      });
      const who =
        approve ? 'อนุมัติคำขอลาแล้ว' : 'ปฏิเสธคำขอลาแล้ว';
      const { data: inserted, error: chErr } = await supabase
        .from('attendance_chat_messages')
        .insert({
          user_id: session.user.id,
          body: `แจ้งลา: ${who} (รหัส ${leaveId.slice(0, 8)}…)`,
        })
        .select('id, user_id, body, created_at')
        .maybeSingle();
      if (chErr || !inserted) {
        toast.info('แจ้งทีม', 'อัปเดตสถานะแล้ว แต่ส่งข้อความติดตามไม่สำเร็จ');
      } else {
        await mergeIncomingMessage(inserted as ChatMessage);
      }
      toast.success(approve ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว', 'รีเฟรชรายการอัตโนมัติ');
    } catch (e) {
      toast.error(
        'ดำเนินการไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setLeaveActionId(null);
    }
  }

  async function send() {
    if (!session?.user?.id || !body.trim()) return;
    const text = body.trim();
    const { data: inserted, error } = await supabase
      .from('attendance_chat_messages')
      .insert({
        user_id: session.user.id,
        body: text,
      })
      .select('id, user_id, body, created_at')
      .maybeSingle();
    if (error) {
      toast.error('ส่งไม่สำเร็จ', error.message);
      return;
    }
    setBody('');
    if (inserted) {
      const msg = inserted as ChatMessage;
      await mergeIncomingMessage(msg);
      const recipients = resolveMentionRecipients(
        text,
        mentionables,
        session.user.id
      );
      if (recipients.length) {
        const senderName =
          displayByUserRef.current.get(session.user.id)?.display_name ??
          'พนักงาน';
        const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
        const rows = recipients.map((recipient_id) => ({
          message_id: msg.id,
          recipient_id,
          body: `${senderName} กล่าวถึงคุณในแชท: ${preview}`,
        }));
        const { error: nErr } = await supabase
          .from('attendance_chat_mention_notifications')
          .insert(rows);
        if (nErr) {
          toast.info(
            'แจ้งเตือน @',
            `ส่งข้อความแล้ว แต่แจ้งผู้ถูกกล่าวถึงไม่สำเร็จ — ${nErr.message}`
          );
        }
      }
    }
  }

  async function exportAttendanceCsv() {
    if (!canApproveLeave) {
      toast.info('สิทธิ์', 'เฉพาะ HR / ผู้จัดการเท่านั้น');
      return;
    }
    if (!exportStart || !exportEnd) {
      toast.info('เลือกช่วงวันที่', 'กรุณาเลือกวันเริ่มและวันสิ้นสุด');
      return;
    }
    const startYmd = ymdFromDateBangkok(exportStart);
    const endYmd = ymdFromDateBangkok(exportEnd);
    if (startYmd > endYmd) {
      toast.info('วันที่ไม่ถูกต้อง', 'วันเริ่มต้องไม่เกินวันสิ้นสุด');
      return;
    }

    setExporting(true);
    try {
      const startIso = new Date(`${startYmd}T00:00:00+07:00`).toISOString();
      const endIso = new Date(`${endYmd}T23:59:59+07:00`).toISOString();

      const [logsRes, branchesRes, idRes] = await Promise.all([
        supabase
          .from('attendance_logs')
          .select('*')
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .in('kind', ['check_in', 'check_out'])
          .order('created_at', { ascending: true }),
        supabase
          .from('branch_information')
          .select('id,branch_name,branch_code')
          .order('branch_name'),
        supabase.rpc('admin_attendance_export_identity_map'),
      ]);

      if (logsRes.error) throw new Error(logsRes.error.message);
      if (branchesRes.error) throw new Error(branchesRes.error.message);
      if (idRes.error) throw new Error(idRes.error.message);

      const logRows = (logsRes.data as AttendanceLog[]) ?? [];
      const branches = (branchesRes.data as Branch[]) ?? [];
      const branchById = new Map(branches.map((b) => [b.id, b]));

      type IdentityRow = {
        profile_id: string;
        employee_code: string | null;
        employee_no: number | null;
        nickname: string | null;
      };
      const identityByProfile = new Map<string, IdentityRow>();
      for (const r of (idRes.data as IdentityRow[]) ?? []) {
        identityByProfile.set(r.profile_id, r);
      }

      const nicknameForUser = (uid: string): string =>
        normalizeText(identityByProfile.get(uid)?.nickname);

      const employeeCodeForUser = (uid: string): string => {
        const r = identityByProfile.get(uid);
        if (!r) return '';
        const fromEmp = r.employee_no != null ? String(r.employee_no) : '';
        return normalizeText(r.employee_code) || fromEmp;
      };

      type DayAgg = {
        checkIn?: AttendanceLog;
        checkOut?: AttendanceLog;
      };
      function checkInLocation(agg: DayAgg | undefined): string {
        const note = agg?.checkIn?.note?.trim();
        if (note) return note;
        const bid = agg?.checkIn?.branch_id;
        if (bid == null) return '';
        const br = branchById.get(bid);
        return br?.branch_name ?? br?.branch_code ?? String(bid);
      }

      const byUserDay = new Map<string, DayAgg>();
      const keyOf = (uid: string, ymd: string) => `${uid}|${ymd}`;

      for (const lg of logRows) {
        const ymd = ymdFromDateBangkok(new Date(lg.created_at));
        const k = keyOf(lg.user_id, ymd);
        const cur = byUserDay.get(k) ?? {};
        if (lg.kind === 'check_in') {
          if (!cur.checkIn) cur.checkIn = lg;
        }
        if (lg.kind === 'check_out') {
          cur.checkOut = lg;
        }
        byUserDay.set(k, cur);
      }

      const userIds = [...new Set(logRows.map((l) => l.user_id))].filter(Boolean);
      const days = listYmdInclusive(startYmd, endYmd);
      if (!userIds.length) {
        toast.info('ไม่มีข้อมูล', 'ไม่พบบันทึกเข้า-ออกในช่วงวันที่ที่เลือก');
        return;
      }

      const header = [
        'วันที่',
        'เวลาเข้างาน',
        'เวลาออกงาน',
        'รหัสพนักงาน',
        'ชื่อเล่น',
        'สถานที่เข้างาน',
      ];
      const lines = [header.map(csvEscape).join(',')];

      for (const uid of userIds) {
        for (const ymd of days) {
          const k = keyOf(uid, ymd);
          const agg = byUserDay.get(k);
          const checkInIso = agg?.checkIn?.created_at;
          const checkOutIso = agg?.checkOut?.created_at;
          const checkInCell = checkInIso ? fmtBangkokDateTimeCsv(checkInIso) : '';
          const checkOutCell = checkOutIso ? fmtBangkokDateTimeCsv(checkOutIso) : '';

          lines.push(
            [
              fmtBangkokDateCsv(ymd),
              checkInCell,
              checkOutCell,
              employeeCodeForUser(uid),
              nicknameForUser(uid),
              checkInLocation(agg),
            ]
              .map(csvEscape)
              .join(',')
          );
        }
      }

      const content = `\uFEFF${lines.join('\n')}`;
      const filename = `attendance-export-${startYmd}-${endYmd}.csv`;

      if (Platform.OS === 'web') {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const uri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(uri, content, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
        } else {
          toast.info('บันทึกไฟล์แล้ว', uri);
        }
      }

      setExportOpen(false);
      toast.success('ดาวน์โหลดแล้ว', 'สร้างไฟล์ CSV เรียบร้อย');
    } catch (e) {
      toast.error('ดาวน์โหลดไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  async function openUserProfile(userId: string, fallbackName: string | undefined) {
    setProfileOpen(true);
    setProfileLabel(fallbackName ?? userId.slice(0, 8));
    setProfileData(null);
    setProfileLoading(true);
    try {
      const { data, error } = await supabase.rpc('chat_user_profile_card', {
        p_user_id: userId,
      });
      if (error) {
        toast.error('โหลดโปรไฟล์ไม่สำเร็จ', error.message);
        return;
      }
      const raw = data as {
        ok?: boolean;
        error?: string;
        data?: ChatProfileCardData;
      } | null;
      if (!raw?.ok || !raw.data) {
        toast.info('โปรไฟล์', raw?.error ?? 'ไม่พบข้อมูล');
        return;
      }
      setProfileData(raw.data);
      setProfileLabel(raw.data.app_name || fallbackName || userId.slice(0, 8));
    } finally {
      setProfileLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={NatureTheme.colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}>
      <Modal
        visible={exportOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setExportOpen(false)}>
        <Pressable style={styles.exportBackdrop} onPress={() => setExportOpen(false)}>
          <Pressable style={styles.exportCard} onPress={() => {}}>
            <Text style={styles.exportTitle}>ดาวน์โหลดเวลาเข้า-ออกงาน</Text>
            <Text style={styles.exportHint}>เลือกช่วงวันที่ (Asia/Bangkok)</Text>
            <DatePickerField
              label="วันเริ่ม"
              value={exportStart}
              onChange={setExportStart}
              disabled={exporting}
              maximumDate={exportEnd ?? undefined}
            />
            <DatePickerField
              label="วันสิ้นสุด"
              value={exportEnd}
              onChange={setExportEnd}
              disabled={exporting}
              minimumDate={exportStart ?? undefined}
            />
            <View style={styles.exportActions}>
              <Pressable onPress={() => setExportOpen(false)}>
                <Text style={styles.exportCancel}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.exportOk, exporting && styles.exportOkDisabled]}
                disabled={exporting}
                onPress={() => void exportAttendanceCsv()}>
                {exporting ? (
                  <ActivityIndicator color={NatureTheme.colors.onAccent} />
                ) : (
                  <Text style={styles.exportOkText}>ดาวน์โหลด CSV</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={profileOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setProfileOpen(false)}>
        <Pressable style={styles.exportBackdrop} onPress={() => setProfileOpen(false)}>
          <Pressable style={styles.profileCard} onPress={() => {}}>
            <ScrollView
              style={styles.profileScroll}
              contentContainerStyle={styles.profileScrollContent}
              showsVerticalScrollIndicator>
              <Text style={styles.profileTitle}>โปรไฟล์ในแชท</Text>
              {profileLoading ? (
                <ActivityIndicator color={NatureTheme.colors.primary} style={{ marginVertical: 16 }} />
              ) : (
                <>
                  <Pressable
                    style={styles.profileAvatarWrap}
                    onPress={() => {
                      if (profileData?.avatar_url) setProfileImageOpen(true);
                    }}>
                    <UserAvatar
                      uri={profileData?.avatar_url}
                      label={profileData?.app_name || profileLabel}
                      size={72}
                    />
                    {profileData?.avatar_url ? (
                      <Text style={styles.profileAvatarHint}>แตะเพื่อดูภาพเต็ม</Text>
                    ) : null}
                  </Pressable>
                  <View style={styles.profileField}>
                    <Text style={styles.profileFieldLabel}>ชื่อในแอป</Text>
                    <Text style={styles.profileFieldValue}>{profileData?.app_name || profileLabel || '-'}</Text>
                  </View>
                  <View style={styles.profileField}>
                    <Text style={styles.profileFieldLabel}>เบอร์โทร</Text>
                    <Text style={styles.profileFieldValue}>{profileData?.phone || '-'}</Text>
                  </View>
                  <View style={styles.profileField}>
                    <Text style={styles.profileFieldLabel}>ชื่อจริง</Text>
                    <Text style={styles.profileFieldValue}>{profileData?.real_name || '-'}</Text>
                  </View>
                  <View style={styles.profileField}>
                    <Text style={styles.profileFieldLabel}>ชื่อเล่น</Text>
                    <Text style={styles.profileFieldValue}>{profileData?.nickname || '-'}</Text>
                  </View>
                  <Text style={[styles.profileFieldLabel, { marginTop: 6 }]}>งานที่กำลังทำ</Text>
                  {profileData?.active_tasks?.length ? (
                    <ScrollView style={styles.profileTasksList}>
                      {profileData.active_tasks.map((t) => (
                        <View key={t.id} style={styles.profileTaskItem}>
                          <Text style={styles.profileTaskTitle}>{t.title}</Text>
                          <Text style={styles.profileTaskMeta}>
                            {t.status === 'in_progress' ? 'กำลังทำ' : 'รอดำเนินการ'}
                            {t.due_at
                              ? ` · ส่ง ${new Date(t.due_at).toLocaleDateString('th-TH')}`
                              : ''}
                          </Text>
                        </View>
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={styles.profileTaskEmpty}>ไม่มีงานที่กำลังดำเนินการ</Text>
                  )}
                  {profileData?.user_id ? (
                    <EmployeeScheduleCalendarCard
                      userId={profileData.user_id}
                      title="ปฏิทินตารางงานของพนักงาน"
                      sub="มุมมองรายเดือน · แตะวันที่ดูตารางและโน้ต — เพื่อนร่วมสาขาเดียวกันอ่านได้ (แก้ไขได้เฉพาะเจ้าของหรือผู้จัดการที่มีสิทธิ์)"
                      autoOpenFirstHighlight
                    />
                  ) : null}
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={profileImageOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileImageOpen(false)}>
        <Pressable style={styles.fullImageBackdrop} onPress={() => setProfileImageOpen(false)}>
          {profileData?.avatar_url ? (
            <View style={styles.fullImageCard}>
              <ZoomableImage
                source={{ uri: profileData.avatar_url }}
                style={styles.fullImage}
                resizeMode="contain"
              />
              <Text style={styles.fullImageHint}>แตะพื้นหลังเพื่อปิด · pinch เพื่อซูม</Text>
            </View>
          ) : null}
        </Pressable>
      </Modal>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        onLayout={() => {
          if (!snapToBottomPendingRef.current || !items.length) return;
          scrollChatToBottom(false);
        }}
        onContentSizeChange={onChatContentSizeChange}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={NatureTheme.colors.primary}
            colors={[NatureTheme.colors.primary]}
            title="ดึงลงเพื่อรีเฟรช"
            titleColor={NatureTheme.colors.textMuted}
          />
        }
        onStartReached={() => {
          if (!allowStartReachedForOlderRef.current) return;
          if (loadingOlderRef.current) return;
          void loadOlder();
        }}
        onStartReachedThreshold={0.08}
        {...(Platform.OS !== 'web'
          ? ({
              maintainVisibleContentPosition: {
                minIndexForVisible: 0,
                autoscrollToTopThreshold: 120,
              },
            } as const)
          : {})}
        ListHeaderComponent={
          loadingOlder ? (
            <View style={styles.listHeaderLoading}>
              <ActivityIndicator
                size="small"
                color={NatureTheme.colors.primary}
              />
            </View>
          ) : null
        }
        renderItem={({ item: m }) => {
          const kind = attendanceBubbleKind(m.body);
          const leaveId = extractLeaveRequestIdFromChatBody(m.body);
          const leaveDbStatus = leaveId ? leaveStatusById[leaveId] : undefined;
          const leaveResolved =
            !!leaveId &&
            (leaveDbStatus === 'approved' ||
              leaveDbStatus === 'rejected' ||
              leaveRequestResolvedInThread(leaveId, m.created_at, items));
          const showLeaveActions =
            Boolean(leaveId) &&
            canApproveLeave &&
            m.body.includes('ขอลารออนุมัติ') &&
            !leaveResolved;
          const sickLeave = chatBodyIndicatesSickLeave(m.body);
          const lateChat = parseLateAttendanceChatBody(m.body);
          const isLeavePendingCard =
            Boolean(leaveId) && m.body.includes('ขอลารออนุมัติ');
          const bubbleAccent = isLeavePendingCard
            ? sickLeave
              ? styles.bubbleLeaveSick
              : styles.bubbleLeavePending
            : lateChat.isLate
              ? styles.bubbleLateNotice
              : sickLeave && kind === 'check_in'
                ? styles.bubbleLeaveSick
                : kind === 'check_in'
                  ? styles.bubbleCheckIn
                  : kind === 'check_out'
                    ? styles.bubbleCheckOut
                    : null;
          return (
          <View style={[styles.bubble, bubbleAccent]}>
            <Pressable
              style={styles.bubbleHead}
              onPress={() => void openUserProfile(m.user_id, m.display_name)}>
              <UserAvatar
                uri={m.avatar_url}
                label={m.display_name}
                size={36}
              />
              <View style={styles.bubbleHeadText}>
                <Text style={styles.who}>
                  {m.display_with_mood ?? m.display_name}
                </Text>
                <Text style={styles.when}>
                  {new Date(m.created_at).toLocaleString('th-TH')}
                </Text>
              </View>
            </Pressable>
            {lateChat.isLate ? (
              <>
                <View style={styles.lateHeaderStrip}>
                  <Text style={styles.lateHeaderStripText}>แจ้งเข้าสาย</Text>
                </View>
                <Text style={styles.msg}>{lateChat.detail}</Text>
              </>
            ) : (
              <Text style={styles.msg}>{m.body}</Text>
            )}
            {showLeaveActions && leaveId ? (
              <View style={styles.leaveActions}>
                <Pressable
                  style={[
                    styles.leaveRejectBtn,
                    leaveActionId === leaveId && styles.leaveBtnBusy,
                  ]}
                  disabled={leaveActionId !== null}
                  onPress={() => void respondLeave(leaveId, false)}>
                  <Text style={styles.leaveRejectText}>ปฏิเสธ</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.leaveApproveBtn,
                    leaveActionId === leaveId && styles.leaveBtnBusy,
                  ]}
                  disabled={leaveActionId !== null}
                  onPress={() => void respondLeave(leaveId, true)}>
                  <Text style={styles.leaveApproveText}>อนุมัติ</Text>
                </Pressable>
              </View>
            ) : null}
            {isLeavePendingCard && leaveDbStatus && leaveDbStatus !== 'pending' ? (
              <View
                style={[
                  styles.leaveStatusPill,
                  leaveDbStatus === 'approved'
                    ? styles.leaveStatusApproved
                    : styles.leaveStatusRejected,
                ]}>
                <Text
                  style={[
                    styles.leaveStatusText,
                    leaveDbStatus === 'approved'
                      ? styles.leaveStatusApprovedText
                      : styles.leaveStatusRejectedText,
                  ]}>
                  สถานะคำขอ: {leaveStatusLabelTh(leaveDbStatus)}
                </Text>
              </View>
            ) : null}
          </View>
          );
        }}
      />
      {mentionPick && mentionChoices.length > 0 ? (
        <ScrollView
          style={styles.mentionSheet}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled>
          {mentionChoices.map((u) => (
            <Pressable
              key={u.userId}
              style={styles.mentionRow}
              onPress={() => applyMentionPick(u)}>
              <Text style={styles.mentionRowText}>@{u.insertLabel}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="ข้อความแจ้งทีม… พิมพ์ @ชื่อ เพื่อกล่าวถึง"
          value={body}
          onChangeText={setBody}
          onSelectionChange={(e) =>
            setSelection({
              start: e.nativeEvent.selection.start,
              end: e.nativeEvent.selection.end,
            })
          }
        />
        <Pressable style={styles.send} onPress={send}>
          <Text style={styles.sendText}>ส่ง</Text>
        </Pressable>
      </View>
      <FriendlyConfirmModal
        visible={pruneChatConfirmOpen}
        title="ลบข้อความแชทเก่ากว่า 90 วัน?"
        message="ลบถาวรจากฐานข้อมูลเฉพาะข้อความที่วันที่ตามเขต Asia/Bangkok ของเวลาสร้าง เก่ากว่า 90 วันนับจากวันนี้ในเขตไทย — รวมแจ้งเตือน @ ที่อ้างข้อความเหล่านั้น ไม่สามารถกู้คืนได้"
        confirmLabel={pruneBusy ? 'กำลังลบ…' : 'ลบถาวร'}
        cancelLabel="ยกเลิก"
        danger
        onConfirm={() => void runPruneOldAttendanceChat()}
        onCancel={() => {
          if (!pruneBusy) setPruneChatConfirmOpen(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.canvas },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  headerIconBtnDanger: {
    borderColor: c.error,
    backgroundColor: c.errorBg,
  },
  listHeaderLoading: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mentionSheet: {
    maxHeight: 200,
    borderTopWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surfaceElevated,
  },
  mentionRow: {
    paddingVertical: 10,
    paddingHorizontal: s.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderSoft,
  },
  mentionRowText: { fontSize: 15, color: c.text, fontWeight: '600' },
  bubble: {
    marginHorizontal: s.screen,
    marginTop: s.gap,
    padding: s.card,
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  /** แจ้งเข้างาน — โทนเขียวแบรนด์ */
  bubbleCheckIn: {
    borderLeftWidth: 4,
    borderLeftColor: c.primary,
    backgroundColor: c.primaryLight,
  },
  /** แจ้งออกงาน — โทนทอง/ส้มอ่อน แยกจากเข้า */
  bubbleCheckOut: {
    borderLeftWidth: 4,
    borderLeftColor: c.accentWarm,
    backgroundColor: c.accentWarmLight,
  },
  bubbleLeavePending: {
    borderLeftWidth: 4,
    borderLeftColor: c.river,
    backgroundColor: c.riverLight,
  },
  bubbleLeaveSick: {
    borderLeftWidth: 4,
    borderLeftColor: c.leaveSickBar,
    backgroundColor: c.leaveSickBg,
  },
  bubbleLateNotice: {
    borderLeftWidth: 4,
    borderLeftColor: c.lateNoticeBar,
    backgroundColor: c.lateNoticeBg,
  },
  lateHeaderStrip: {
    marginTop: 8,
    marginHorizontal: -4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: r.sm,
    backgroundColor: c.lateNoticeHeaderBg,
  },
  lateHeaderStripText: {
    fontSize: 14,
    fontWeight: '800',
    color: c.warningTitle,
    letterSpacing: 0.3,
  },
  bubbleHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bubbleHeadText: { flex: 1 },
  who: { fontWeight: '700', fontSize: 13, color: c.text },
  msg: { marginTop: 6, fontSize: 15, color: c.text },
  when: { marginTop: 2, fontSize: 11, color: c.textMuted },
  leaveActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    justifyContent: 'flex-end',
  },
  leaveRejectBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  leaveRejectText: { color: c.text, fontWeight: '700', fontSize: 14 },
  leaveApproveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: r.sm,
    backgroundColor: c.checkIn,
  },
  leaveApproveText: { color: c.onAccent, fontWeight: '700', fontSize: 14 },
  leaveBtnBusy: { opacity: 0.55 },
  leaveStatusPill: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: r.sm,
    borderWidth: 1,
  },
  leaveStatusApproved: {
    backgroundColor: c.primaryLight,
    borderColor: c.checkIn,
  },
  leaveStatusRejected: {
    backgroundColor: c.errorBg,
    borderColor: c.error,
  },
  leaveStatusText: { fontSize: 12, fontWeight: '700' },
  leaveStatusApprovedText: { color: c.checkIn },
  leaveStatusRejectedText: { color: c.error },
  inputRow: {
    flexDirection: 'row',
    padding: s.card,
    gap: s.gap,
    borderTopWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: c.surfaceElevated,
    color: c.text,
  },
  send: {
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: c.river,
    borderRadius: r.sm,
  },
  sendText: { color: c.onAccent, fontWeight: '700' },
  exportBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: s.screen,
  },
  exportCard: {
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: s.card,
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
  },
  profileCard: {
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: s.card,
    maxWidth: 460,
    alignSelf: 'center',
    width: '100%',
    maxHeight: '84%',
  },
  profileTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: c.text,
    marginBottom: 12,
  },
  profileAvatarWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  profileAvatarHint: {
    marginTop: 6,
    fontSize: 12,
    color: c.textMuted,
  },
  profileField: {
    marginBottom: 8,
  },
  profileFieldLabel: {
    fontSize: 12,
    color: c.textMuted,
    marginBottom: 2,
  },
  profileFieldValue: {
    fontSize: 15,
    fontWeight: '600',
    color: c.text,
  },
  profileTasksList: {
    marginTop: 6,
    maxHeight: 220,
  },
  profileTaskItem: {
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    padding: 10,
    marginBottom: 8,
  },
  profileTaskTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text,
  },
  profileTaskMeta: {
    marginTop: 3,
    fontSize: 12,
    color: c.textMuted,
  },
  profileTaskEmpty: {
    marginTop: 6,
    fontSize: 13,
    color: c.textMuted,
  },
  profileScroll: {
    flex: 1,
  },
  profileScrollContent: {
    paddingBottom: 8,
  },
  fullImageBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  fullImageCard: {
    width: '100%',
    maxWidth: 560,
    alignItems: 'center',
  },
  fullImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: r.md,
    backgroundColor: c.surface,
  },
  fullImageHint: {
    marginTop: 10,
    color: c.onAccent,
    fontSize: 12,
  },
  exportTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: c.text,
    marginBottom: 4,
  },
  exportHint: {
    fontSize: 13,
    color: c.textMuted,
    marginBottom: 12,
  },
  exportActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 16,
  },
  exportCancel: { fontSize: 15, color: c.textMuted, fontWeight: '600' },
  exportOk: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: r.sm,
    backgroundColor: c.river,
    minWidth: 120,
    alignItems: 'center',
  },
  exportOkDisabled: { opacity: 0.55 },
  exportOkText: { color: c.onAccent, fontWeight: '800', fontSize: 15 },
});
