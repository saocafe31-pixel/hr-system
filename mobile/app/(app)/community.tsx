import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';

import { CommunityFeedPostImage } from '@/components/CommunityFeedPostImage';
import { UserAvatar } from '@/components/UserAvatar';
import { ZoomableImage } from '@/components/ZoomableImage';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { isAdmin, useAuth, useRole } from '@/contexts/AuthContext';
import { NatureTheme } from '@/constants/Theme';
import { supabase } from '@/lib/supabase';
import type {
  CommunityFeedPost,
  CommunityNote,
  CommunityNoteReply,
  TaskRow,
} from '@/lib/types';
import {
  clampFeedAspectRatio,
  COMMUNITY_FEED_VIDEO_MAX_BYTES,
  getUriFileSizeBytes,
  uploadCommunityFeedImageFromUri,
  uploadCommunityFeedVideoFromUri,
} from '@/lib/uploadCommunityFeedImage';
import { leaveTypeLabelTh } from '@/lib/leaveAttendanceChat';
import {
  fetchLatestTodayEmojiByUserIds,
  nameWithMoodEmoji,
} from '@/lib/wellbeing';

type LeaveRowLite = {
  user_id: string;
  leave_type: string;
  starts_on: string;
  ends_on: string;
  status: string;
};

type EmployeeCard = {
  user_id: string;
  email: string | null;
  display_name: string;
  display_with_mood: string;
  avatar_url: string | null;
  position: string;
  branch: string;
  note: CommunityNote | null;
  replies: CommunityNoteReply[];
  activeTasks: TaskRow[];
  presence: 'online' | 'break' | 'offline';
  leaveSummary: string | null;
};

function formatLeaveYmdTh(ymd: string): string {
  const parts = ymd.split('-').map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  try {
    return new Intl.DateTimeFormat('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    }).format(dt);
  } catch {
    return ymd;
  }
}

function pickLeaveSummaryForUser(
  uid: string,
  rows: LeaveRowLite[],
  todayYmd: string
): string | null {
  const mine = rows.filter((r) => r.user_id === uid);
  const pending = mine
    .filter((r) => r.status === 'pending')
    .sort((a, b) => (a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0));
  if (pending[0]) {
    const r = pending[0];
    const range =
      r.starts_on === r.ends_on
        ? formatLeaveYmdTh(r.starts_on)
        : `${formatLeaveYmdTh(r.starts_on)} – ${formatLeaveYmdTh(r.ends_on)}`;
    return `${leaveTypeLabelTh(r.leave_type)} ${range} · รออนุมัติ`;
  }
  const onApproved = mine
    .filter(
      (r) =>
        r.status === 'approved' &&
        r.starts_on <= todayYmd &&
        r.ends_on >= todayYmd
    )
    .sort((a, b) => (a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0));
  if (onApproved[0]) {
    const r = onApproved[0];
    const range =
      r.starts_on === r.ends_on
        ? formatLeaveYmdTh(r.starts_on)
        : `${formatLeaveYmdTh(r.starts_on)} – ${formatLeaveYmdTh(r.ends_on)}`;
    return `${leaveTypeLabelTh(r.leave_type)} ${range} · อนุมัติแล้ว (อยู่ระหว่างลา)`;
  }
  return null;
}

function taskProgressPercent(task: TaskRow): number {
  const items = task.task_checklist_items ?? [];
  if (!items.length) return 0;
  const done = items.filter((i) => i.done).length;
  return Math.round((done / items.length) * 100);
}

/** โน้ต «ฉันกำลังคิดว่า…» — ต้องสอดคล้องกับ check ใน community_notes */
const MY_NOTE_MAX_CHARS = 200;

function formatFeedTime(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    }).format(d);
  } catch {
    return '';
  }
}

type FeedCommentRow = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  author_name: string;
  author_avatar: string | null;
  parent_id: string | null;
  replies: FeedCommentRow[];
};

function nestFeedComments(flat: FeedCommentRow[]): FeedCommentRow[] {
  if (flat.length === 0) return [];
  const byId: Record<string, FeedCommentRow> = {};
  for (const c of flat) {
    byId[c.id] = { ...c, replies: [] };
  }
  const roots: FeedCommentRow[] = [];
  for (const c of flat) {
    const node = byId[c.id];
    if (!c.parent_id) {
      roots.push(node);
    } else {
      const parent = byId[c.parent_id];
      if (parent) parent.replies.push(node);
      else roots.push(node);
    }
  }
  const sortByTime = (a: FeedCommentRow, b: FeedCommentRow) =>
    a.created_at.localeCompare(b.created_at);
  const sortDeep = (nodes: FeedCommentRow[]) => {
    nodes.sort(sortByTime);
    for (const n of nodes) sortDeep(n.replies);
  };
  sortDeep(roots);
  return roots;
}

function feedReplyDraftKey(postId: string, parentCommentId: string): string {
  return `${postId}:${parentCommentId}`;
}

type FeedRow = CommunityFeedPost & {
  author_name: string;
  author_avatar: string | null;
  author_email: string | null;
  comments: FeedCommentRow[];
  like_count: number;
  liked_by_me: boolean;
};

type LikerRow = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
};

type FeedAspectPreset = 'square' | 'portrait' | 'landscape';

const NOTE_TTL_MS = 24 * 60 * 60 * 1000;

type ProfileLite = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  employee_id: string | null;
};

type EmployeeDirLite = {
  id: string;
  position: string | null;
  branch: string | null;
  name: string | null;
  surname: string | null;
  nickname: string | null;
  legacy_user_id?: string | null;
};

function normalizeText(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function employeePrettyName(emp?: EmployeeDirLite): string | null {
  if (!emp) return null;
  const nickname = normalizeText(emp.nickname);
  if (nickname) return nickname;
  const first = normalizeText(emp.name);
  const last = normalizeText(emp.surname);
  const full = `${first} ${last}`.trim();
  return full || null;
}

function pickDisplayName(
  p: Pick<ProfileLite, 'id' | 'full_name' | 'email'>,
  emp?: EmployeeDirLite
): string {
  return (
    normalizeText(p.full_name) ||
    employeePrettyName(emp) ||
    normalizeText(p.email) ||
    p.id.slice(0, 8)
  );
}

export default function CommunityScreen() {
  const toast = useCuteToast();
  const role = useRole();
  const admin = isAdmin(role);
  const { profile, refreshProfile } = useAuth();
  const [cards, setCards] = useState<EmployeeCard[]>([]);
  const [feedPosts, setFeedPosts] = useState<FeedRow[]>([]);
  const [feedImageUri, setFeedImageUri] = useState<string | null>(null);
  const [feedVideoUri, setFeedVideoUri] = useState<string | null>(null);
  const [feedCaption, setFeedCaption] = useState('');
  const [feedPosting, setFeedPosting] = useState(false);
  const [feedVideoCompressing, setFeedVideoCompressing] = useState(false);
  const [feedAspect, setFeedAspect] = useState<FeedAspectPreset>('landscape');
  const [feedPreviewMeasuredAspect, setFeedPreviewMeasuredAspect] = useState<
    number | null
  >(null);
  const [feedCommentDrafts, setFeedCommentDrafts] = useState<
    Record<string, string>
  >({});
  const [feedReplyTarget, setFeedReplyTarget] = useState<{
    postId: string;
    parentId: string;
  } | null>(null);
  const [feedReplyDrafts, setFeedReplyDrafts] = useState<Record<string, string>>(
    {}
  );
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myNote, setMyNote] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [selectedCard, setSelectedCard] = useState<EmployeeCard | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [feedAutoDeleteSaving, setFeedAutoDeleteSaving] = useState(false);
  const [likersModalPostId, setLikersModalPostId] = useState<string | null>(null);
  const [likersRows, setLikersRows] = useState<LikerRow[]>([]);
  const [likersLoading, setLikersLoading] = useState(false);
  const [heartFlashPostId, setHeartFlashPostId] = useState<string | null>(null);
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const lastTapByPostRef = useRef<Record<string, number>>({});
  const storyScrollRef = useRef<ScrollView>(null);
  const [storyScrollX, setStoryScrollX] = useState(0);
  const [storyViewportW, setStoryViewportW] = useState(0);
  const [storyContentW, setStoryContentW] = useState(0);
  const storySlideY = useRef(new Animated.Value(20)).current;
  const storyFade = useRef(new Animated.Value(0)).current;
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReloadRef = useRef(false);
  const storyCards = useMemo(
    () =>
      cards.filter(
        (c) => !!c.note?.body && c.note.body.trim().length > 0
      ),
    [cards]
  );
  const filteredFeed = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return feedPosts;
    return feedPosts.filter((p) => {
      const name = p.author_name.toLowerCase();
      const mail = (p.author_email ?? '').toLowerCase();
      return name.includes(q) || mail.includes(q);
    });
  }, [feedPosts, query]);
  const canScrollStory = storyContentW > storyViewportW + 8;

  useEffect(() => {
    if (!heartFlashPostId) return;
    heartOpacity.setValue(0);
    const useNative = Platform.OS !== 'web';
    const anim = Animated.sequence([
      Animated.timing(heartOpacity, {
        toValue: 1,
        duration: 90,
        useNativeDriver: useNative,
      }),
      Animated.timing(heartOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: useNative,
      }),
    ]);
    anim.start(({ finished }) => {
      if (finished) setHeartFlashPostId(null);
    });
    return () => anim.stop();
  }, [heartFlashPostId, heartOpacity]);

  useEffect(() => {
    if (!feedImageUri) {
      setFeedPreviewMeasuredAspect(null);
      return;
    }
    Image.getSize(
      feedImageUri,
      (w, h) => {
        if (w > 0 && h > 0) {
          setFeedPreviewMeasuredAspect(clampFeedAspectRatio(w / h));
        }
      },
      () => setFeedPreviewMeasuredAspect(null)
    );
  }, [feedImageUri]);

  useEffect(() => {
    if (!likersModalPostId) {
      setLikersRows([]);
      return;
    }
    let cancelled = false;
    setLikersLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('community_feed_likes')
        .select(
          `
          user_id,
          profiles!user_id ( full_name, email, avatar_url )
        `
        )
        .eq('post_id', likersModalPostId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setLikersLoading(false);
      if (error || !data) {
        setLikersRows([]);
        return;
      }
      type LEmbed = {
        full_name: string | null;
        email: string | null;
        avatar_url: string | null;
      } | null;
      const rows: LikerRow[] = (data as unknown[]).map((raw) => {
        const row = raw as {
          user_id: string;
          profiles: LEmbed | LEmbed[];
        };
        const p = row.profiles;
        const prof: LEmbed = Array.isArray(p) ? (p[0] ?? null) : p;
        const name =
          normalizeText(prof?.full_name) ||
          normalizeText(prof?.email) ||
          row.user_id.slice(0, 8);
        return {
          user_id: row.user_id,
          display_name: name,
          avatar_url: prof?.avatar_url ?? null,
        };
      });
      setLikersRows(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [likersModalPostId]);

  useEffect(() => {
    storySlideY.setValue(20);
    storyFade.setValue(0);
    Animated.parallel([
      Animated.timing(storySlideY, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(storyFade, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [storyCards.length, query, storyFade, storySlideY]);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const uid = user?.id ?? null;
    setActiveUserId(uid);

    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url, employee_id, role')
      .order('full_name');
    if (pErr) {
      toast.error('โหลดข้อมูลไม่สำเร็จ', pErr.message);
      return;
    }

    const rows = (profiles as ProfileLite[]) ?? [];
    const userIds = rows.map((r) => r.id);
    const empIds = rows
      .map((r) => r.employee_id)
      .filter((v): v is string => !!v);
    const profileEmails = rows
      .map((r) => normalizeText(r.email).toLowerCase())
      .filter((v): v is string => v.length > 0);

    /* profiles!user_id = ระบุ FK ชัด — ถ้ามีหลาย FK ไป profiles PostgREST จะ error */
    const feedSelectLegacy = `
      id,
      user_id,
      image_url,
      caption,
      created_at,
      profiles!user_id ( full_name, email, avatar_url )
    `;
    const feedSelectFull = `
      id,
      user_id,
      image_url,
      caption,
      created_at,
      media_type,
      image_layout,
      profiles!user_id ( full_name, email, avatar_url )
    `;

    const [
      { data: employeeRowsById },
      { data: employeeRowsByEmail },
      { data: notes },
      { data: tasks },
      { data: attRows },
      { data: leaveRows },
    ] = await Promise.all([
      empIds.length
        ? supabase
            .from('employee_directory')
            .select('id,position,branch,name,surname,nickname')
            .in('id', empIds)
        : Promise.resolve({ data: [] as unknown[] }),
      profileEmails.length
        ? supabase
            .from('employee_directory')
            .select('id,position,branch,name,surname,nickname,legacy_user_id')
            .in('legacy_user_id', profileEmails)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase
        .from('community_notes')
        .select('id,user_id,body,created_at,updated_at')
        .gte(
          'updated_at',
          new Date(Date.now() - NOTE_TTL_MS).toISOString()
        ),
      userIds.length
        ? supabase
            .from('tasks')
            .select('id,title,description,assigned_to,assigned_by,status,due_at,start_at,priority,created_at,task_checklist_items(done)')
            .in('assigned_to', userIds)
            .eq('status', 'in_progress')
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as unknown[] }),
      userIds.length
        ? supabase
            .from('attendance_logs')
            .select('user_id,kind,created_at')
            .in('user_id', userIds)
            .in('kind', ['check_in', 'check_out', 'break_start', 'break_end'])
            .order('created_at', { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] as unknown[] }),
      userIds.length
        ? supabase
            .from('leave_requests')
            .select('user_id,leave_type,starts_on,ends_on,status')
            .in('user_id', userIds)
            .in('status', ['pending', 'approved'])
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

    let feedRaw: unknown[] | null = null;
    let feedErr: { message: string; code?: string } | null = null;
    {
      const r1 = await supabase
        .from('community_feed_posts')
        .select(feedSelectFull)
        .order('created_at', { ascending: false })
        .limit(80);
      feedRaw = (r1.data ?? null) as unknown[] | null;
      feedErr = r1.error;
      if (feedErr) {
        const r2 = await supabase
          .from('community_feed_posts')
          .select(feedSelectLegacy)
          .order('created_at', { ascending: false })
          .limit(80);
        if (!r2.error) {
          feedRaw = (r2.data ?? []) as unknown[];
          feedErr = null;
        }
      }
    }

    type ProfEmbed = {
      full_name: string | null;
      email: string | null;
      avatar_url: string | null;
    } | null;
    const empMap: Record<string, EmployeeDirLite> = {};
    for (const e of (employeeRowsById as EmployeeDirLite[]) ?? []) {
      empMap[e.id] = e;
    }
    const empByLegacyUserId: Record<string, EmployeeDirLite> = {};
    for (const e of (employeeRowsByEmail as EmployeeDirLite[]) ?? []) {
      const key = normalizeText(e.legacy_user_id).toLowerCase();
      if (key) empByLegacyUserId[key] = e;
      if (!empMap[e.id]) empMap[e.id] = e;
    }
    const profileNameMap: Record<string, string> = {};
    const profileAvatarMap: Record<string, string | null> = {};
    for (const p of rows) {
      const empFromId = p.employee_id ? empMap[p.employee_id] : undefined;
      const empFromEmail = p.email
        ? empByLegacyUserId[normalizeText(p.email).toLowerCase()]
        : undefined;
      const emp = empFromId ?? empFromEmail;
      profileNameMap[p.id] = pickDisplayName(p, emp);
      profileAvatarMap[p.id] = p.avatar_url ?? null;
    }

    let feedMapped: FeedRow[] = [];
    try {
      feedMapped = ((feedRaw ?? []) as unknown[]).map((raw) => {
      const row = raw as {
        id: string;
        user_id: string;
        image_url: string;
        caption: string | null;
        created_at: string;
        media_type?: string | null;
        image_layout?: string | null;
        profiles?: ProfEmbed | ProfEmbed[] | null;
      };
      const p = row.profiles ?? null;
      const prof: ProfEmbed =
        p == null ? null : Array.isArray(p) ? (p[0] ?? null) : p;
      const fallbackName =
        normalizeText(prof?.full_name) ||
        normalizeText(prof?.email) ||
        row.user_id.slice(0, 8);
      const baseName =
        profileNameMap[row.user_id] ?? fallbackName;
      const mt =
        row.media_type === 'video' ? 'video' : 'image';
      const ilRaw = row.image_layout;
      const image_layout =
        ilRaw === 'square' || ilRaw === 'portrait' || ilRaw === 'landscape'
          ? ilRaw
          : null;
      return {
        id: row.id,
        user_id: row.user_id,
        image_url: row.image_url,
        caption: row.caption,
        created_at: row.created_at,
        media_type: mt,
        image_layout: mt === 'video' ? null : image_layout ?? 'landscape',
        author_name: baseName,
        author_avatar: profileAvatarMap[row.user_id] ?? prof?.avatar_url ?? null,
        author_email: prof?.email ?? null,
        comments: [] as FeedCommentRow[],
        like_count: 0,
        liked_by_me: false,
      };
    });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('อ่านข้อมูลฟีดไม่สำเร็จ', msg);
      feedMapped = [];
    }

    const noteRows = (notes as CommunityNote[]) ?? [];
    const noteIds = noteRows.map((n) => n.id);
    const replies = noteIds.length
      ? (
          await supabase
            .from('community_note_replies')
            .select('id,note_id,user_id,body,created_at')
            .in('note_id', noteIds)
            .order('created_at', { ascending: true })
        ).data
      : [];

    let feedWithComments: FeedRow[] = feedMapped;
    if (!feedErr && feedMapped.length > 0) {
      const postIds = feedMapped.map((p) => p.id);
      const { data: cRaw, error: cErr } = await supabase
        .from('community_feed_comments')
        .select(
          `
          id,
          post_id,
          user_id,
          body,
          created_at,
          parent_id,
          profiles!user_id ( full_name, email, avatar_url )
        `
        )
        .in('post_id', postIds)
        .order('created_at', { ascending: true });
      if (!cErr && cRaw) {
        const byPostFlat: Record<string, FeedCommentRow[]> = {};
        for (const raw of (cRaw ?? []) as unknown[]) {
          const crow = raw as {
            id: string;
            post_id: string;
            user_id: string;
            body: string;
            created_at: string;
            parent_id?: string | null;
            profiles: ProfEmbed | ProfEmbed[];
          };
          const p = crow.profiles;
          const cprof: ProfEmbed = Array.isArray(p) ? (p[0] ?? null) : p;
          const fallbackCommentName =
            normalizeText(cprof?.full_name) ||
            normalizeText(cprof?.email) ||
            crow.user_id.slice(0, 8);
          const cname =
            profileNameMap[crow.user_id] ?? fallbackCommentName;
          const fc: FeedCommentRow = {
            id: crow.id,
            user_id: crow.user_id,
            body: crow.body,
            created_at: crow.created_at,
            author_name: cname,
            author_avatar: profileAvatarMap[crow.user_id] ?? cprof?.avatar_url ?? null,
            parent_id: crow.parent_id ?? null,
            replies: [],
          };
          byPostFlat[crow.post_id] = [...(byPostFlat[crow.post_id] ?? []), fc];
        }
        const byPost: Record<string, FeedCommentRow[]> = {};
        for (const pid of Object.keys(byPostFlat)) {
          byPost[pid] = nestFeedComments(byPostFlat[pid] ?? []);
        }
        feedWithComments = feedMapped.map((p) => ({
          ...p,
          comments: byPost[p.id] ?? [],
        }));
      }
    }

    let feedWithLikes: FeedRow[] = feedWithComments;
    if (!feedErr && feedMapped.length > 0 && uid) {
      const postIds = feedMapped.map((p) => p.id);
      const { data: likeRows, error: lErr } = await supabase
        .from('community_feed_likes')
        .select('post_id,user_id')
        .in('post_id', postIds);
      if (!lErr && likeRows) {
        const counts: Record<string, number> = {};
        const likedMap: Record<string, boolean> = {};
        for (const lr of likeRows as { post_id: string; user_id: string }[]) {
          counts[lr.post_id] = (counts[lr.post_id] ?? 0) + 1;
          if (lr.user_id === uid) likedMap[lr.post_id] = true;
        }
        feedWithLikes = feedWithComments.map((p) => ({
          ...p,
          like_count: counts[p.id] ?? 0,
          liked_by_me: !!likedMap[p.id],
        }));
      }
    }

    setFeedPosts(feedErr ? [] : feedWithLikes);
    if (feedErr) {
      toast.error(
        'โหลดฟีดคอมมูนิตี้ไม่สำเร็จ',
        `${feedErr.message} — ลองรีเฟรชหน้า หรือรัน migration บน Supabase ให้ตรงกับแอป (db:push)`
      );
    }

    const moodMap = await fetchLatestTodayEmojiByUserIds(userIds);
    const empInfoMap: Record<string, { position: string; branch: string }> = {};
    for (const e of Object.values(empMap)) {
      empInfoMap[e.id] = {
        position: e.position?.trim() || 'ไม่ระบุตำแหน่ง',
        branch: e.branch?.trim() || 'ไม่ระบุสาขา',
      };
    }

    const noteMap: Record<string, CommunityNote> = {};
    for (const n of noteRows) noteMap[n.user_id] = n;

    const repliesByNote: Record<string, CommunityNoteReply[]> = {};
    for (const r of (replies as CommunityNoteReply[]) ?? []) {
      repliesByNote[r.note_id] = [...(repliesByNote[r.note_id] ?? []), r];
    }

    const tasksByUser: Record<string, TaskRow[]> = {};
    for (const t of (tasks as TaskRow[]) ?? []) {
      tasksByUser[t.assigned_to] = [...(tasksByUser[t.assigned_to] ?? []), t];
    }
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const presenceMap: Record<string, EmployeeCard['presence']> = {};
    for (const lg of
      (attRows as { user_id: string; kind: string; created_at: string }[]) ?? []) {
      if (presenceMap[lg.user_id]) continue;
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(lg.created_at));
      if (day !== today) continue;
      if (lg.kind === 'break_start') presenceMap[lg.user_id] = 'break';
      else if (lg.kind === 'check_in' || lg.kind === 'break_end')
        presenceMap[lg.user_id] = 'online';
      else presenceMap[lg.user_id] = 'offline';
    }

    const leaveList = (leaveRows as LeaveRowLite[]) ?? [];
    const built = rows.map((p) => {
      const emp = p.employee_id ? empInfoMap[p.employee_id] : null;
      const baseName = profileNameMap[p.id] ?? p.id.slice(0, 8);
      const note = noteMap[p.id] ?? null;
      const card: EmployeeCard = {
        user_id: p.id,
        email: p.email,
        display_name: baseName,
        display_with_mood: nameWithMoodEmoji(baseName, moodMap[p.id]),
        avatar_url: p.avatar_url,
        position: emp?.position || 'ไม่ระบุตำแหน่ง',
        branch: emp?.branch || 'ไม่ระบุสาขา',
        note,
        replies: note ? repliesByNote[note.id] ?? [] : [],
        activeTasks: tasksByUser[p.id] ?? [],
        presence: presenceMap[p.id] ?? 'offline',
        leaveSummary: pickLeaveSummaryForUser(p.id, leaveList, today),
      };
      return card;
    });

    setCards(built);
    const mine = uid ? built.find((b) => b.user_id === uid) : null;
    setMyNote(mine?.note?.body ?? '');
  }, [toast]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const flushReload = useCallback(() => {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
    if (!pendingReloadRef.current) return;
    pendingReloadRef.current = false;
    void load();
  }, [load]);

  const scheduleReload = useCallback(() => {
    pendingReloadRef.current = true;
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      flushReload();
    }, 400);
    if (!maxWaitTimerRef.current) {
      maxWaitTimerRef.current = setTimeout(() => {
        maxWaitTimerRef.current = null;
        flushReload();
      }, 2000);
    }
  }, [flushReload]);

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
    const id = setInterval(() => {
      scheduleReload();
    }, 60_000);
    return () => clearInterval(id);
  }, [scheduleReload]);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`community_live_${activeUserId ?? 'guest'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_notes' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_note_replies' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_feed_posts' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_feed_comments' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_feed_likes' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_logs' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leave_requests' },
        scheduleReload
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [scheduleReload, activeUserId]);

  async function saveMyNote() {
    if (!activeUserId) return;
    const text = myNote.trim();
    if (!text) {
      toast.info('ยังไม่มีข้อความนะ', 'พิมพ์โน้ตสั้นๆ แล้วกดบันทึกอีกครั้ง 🌿');
      return;
    }
    if (text.length > MY_NOTE_MAX_CHARS) {
      toast.info(
        'ข้อความยาวเกินไป',
        `จำกัดไม่เกิน ${MY_NOTE_MAX_CHARS} ตัวอักษร — ลดนิดนึงนะ ✂️`
      );
      return;
    }
    setSaving(true);
    const nowIso = new Date().toISOString();
    const { error } = await supabase.from('community_notes').upsert(
      {
        user_id: activeUserId,
        body: text,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' }
    );
    setSaving(false);
    if (error) {
      toast.error('บันทึกโน้ตไม่สำเร็จ', error.message);
      return;
    }
    toast.success('บันทึกโน้ตแล้ว', 'ทีมเห็นข้อความคุณในวงแหวนแล้วนะ ✨');
    await load();
  }

  async function addReply(noteId: string) {
    if (!activeUserId) return;
    const text = (replyDrafts[noteId] ?? '').trim();
    if (!text) return;
    const { error } = await supabase.from('community_note_replies').insert({
      note_id: noteId,
      user_id: activeUserId,
      body: text.slice(0, 120),
    });
    if (error) {
      toast.error('ตอบกลับไม่สำเร็จ', error.message);
      return;
    }
    toast.success('ส่งคำตอบแล้ว', 'ขอบคุณที่แบ่งปันกับทีม 💚');
    setReplyDrafts((prev) => ({ ...prev, [noteId]: '' }));
    await load();
  }

  async function pickFeedImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.info('ขอสิทธิ์รูปภาพหน่อย', 'อนุญาตให้เข้าถึงคลัง แล้วเลือกรูปได้เลย 📷');
      return;
    }
    const aspect: [number, number] =
      feedAspect === 'square' ? [1, 1] : feedAspect === 'portrait' ? [3, 4] : [4, 3];
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setFeedVideoUri(null);
    setFeedImageUri(result.assets[0].uri);
  }

  async function pickFeedVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.info('ขอสิทธิ์วิดีโอหน่อย', 'อนุญาตให้เข้าถึงคลัง แล้วเลือกคลิปได้เลย 🎬');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: true,
      videoMaxDuration: 120,
      quality: Platform.OS === 'android' ? 0.5 : 0.72,
      ...(Platform.OS === 'ios'
        ? { videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality }
        : {}),
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    const pickedSize = await getUriFileSizeBytes(uri);
    if (
      pickedSize != null &&
      pickedSize > COMMUNITY_FEED_VIDEO_MAX_BYTES * 2
    ) {
      toast.info(
        'ไฟล์วิดีโอใหญ่มาก',
        'ระบบจะพยายามบีบก่อนอัปโหลด — ถ้ายังเกินเกณฑ์จะไม่ให้โพสต์ ลองเลือกคลิปสั้นลงได้นะ'
      );
    }
    setFeedImageUri(null);
    setFeedVideoUri(uri);
  }

  async function publishFeedPost() {
    if (!activeUserId) {
      toast.info('ล็อกอินก่อนนะ', 'เข้าสู่ระบบแล้วค่อยโพสต์ได้ 🌱');
      return;
    }
    if (!feedImageUri && !feedVideoUri) {
      toast.info('เลือกสื่อก่อนนะ', 'เลือกรูปหรือวิดีโอ แล้วค่อยโพสต์ 🖼️');
      return;
    }
    setFeedPosting(true);
    try {
      const cap = feedCaption.trim().slice(0, 2000);
      if (feedVideoUri) {
        const videoUrl = await uploadCommunityFeedVideoFromUri(
          activeUserId,
          feedVideoUri,
          { onCompressing: setFeedVideoCompressing }
        );
        const { error } = await supabase.from('community_feed_posts').insert({
          user_id: activeUserId,
          image_url: videoUrl,
          caption: cap.length > 0 ? cap : null,
          media_type: 'video',
          image_layout: null,
        });
        if (error) throw new Error(error.message);
      } else if (feedImageUri) {
        const imageUrl = await uploadCommunityFeedImageFromUri(
          activeUserId,
          feedImageUri,
          feedAspect
        );
        const { error } = await supabase.from('community_feed_posts').insert({
          user_id: activeUserId,
          image_url: imageUrl,
          caption: cap.length > 0 ? cap : null,
          media_type: 'image',
          image_layout: feedAspect,
        });
        if (error) throw new Error(error.message);
      }
      setFeedCaption('');
      setFeedImageUri(null);
      setFeedVideoUri(null);
      toast.success('โพสต์แล้ว', 'ขึ้นฟีดชุมชนแล้ว แชร์ความสุขต่อได้เลย 🌿');
      await load();
    } catch (e) {
      toast.error(
        'โพสต์ไม่สำเร็จ',
        e instanceof Error ? e.message : 'ลองใหม่อีกครั้งนะ'
      );
    } finally {
      setFeedVideoCompressing(false);
      setFeedPosting(false);
    }
  }

  async function toggleFeedLike(postId: string) {
    if (!activeUserId) {
      toast.info('ล็อกอินก่อนนะ', 'เข้าสู่ระบบแล้วกดถูกใจได้ 💚');
      return;
    }
    const post = feedPosts.find((p) => p.id === postId);
    if (!post) return;
    const nextLiked = !post.liked_by_me;
    const delta = nextLiked ? 1 : -1;
    setFeedPosts((prev) =>
      prev.map((p) =>
        p.id !== postId
          ? p
          : {
              ...p,
              liked_by_me: nextLiked,
              like_count: Math.max(0, p.like_count + delta),
            }
      )
    );
    try {
      if (nextLiked) {
        const { error } = await supabase.from('community_feed_likes').insert({
          post_id: postId,
          user_id: activeUserId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('community_feed_likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', activeUserId);
        if (error) throw error;
      }
    } catch (e) {
      await load();
      toast.error(
        'อัปเดตถูกใจไม่สำเร็จ',
        e instanceof Error ? e.message : 'ลองใหม่นะ'
      );
    }
  }

  function onFeedMediaPress(postId: string) {
    const now = Date.now();
    const prev = lastTapByPostRef.current[postId] ?? 0;
    if (now - prev < 320) {
      delete lastTapByPostRef.current[postId];
      void toggleFeedLike(postId);
      setHeartFlashPostId(postId);
    } else {
      lastTapByPostRef.current[postId] = now;
    }
  }

  async function persistFeedAutoDelete(enabled: boolean) {
    if (!activeUserId) return;
    setFeedAutoDeleteSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ community_feed_auto_delete_enabled: enabled })
      .eq('id', activeUserId);
    setFeedAutoDeleteSaving(false);
    if (error) {
      toast.error('บันทึกการตั้งค่าไม่สำเร็จ', error.message);
      return;
    }
    await refreshProfile();
    toast.success(
      enabled ? 'เปิดลบอัตโนมัติแล้ว' : 'ปิดลบอัตโนมัติแล้ว',
      enabled
        ? 'โพสต์ฟีดของคุณที่เกิน 30 วันจะถูกลบทุกวัน (รวมไฟล์ในคลัง)'
        : 'โพสต์จะอยู่ในฟีดตามปกติจนกว่าคุณจะลบเอง'
    );
  }

  async function deleteFeedPost(postId: string) {
    const { error } = await supabase
      .from('community_feed_posts')
      .delete()
      .eq('id', postId);
    if (error) {
      toast.error('ลบโพสต์ไม่สำเร็จ', error.message);
      return;
    }
    toast.success('ลบโพสต์แล้ว', 'ฟีดสะอาดขึ้นแล้วนะ 🍃');
    await load();
  }

  /** บนเว็บ Alert หลายปุ่มใน react-native-web มักใช้ไม่ได้ — ใช้ confirm ของเบราว์เซอร์แทน */
  function confirmDeleteFeedPost(postId: string) {
    const run = () => {
      void deleteFeedPost(postId);
    };
    if (Platform.OS === 'web') {
      if (
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as unknown as { confirm?: (msg: string) => boolean })
          .confirm === 'function'
      ) {
        const ok = (globalThis as unknown as Window).confirm(
          'ต้องการลบโพสต์นี้หรือไม่?'
        );
        if (ok) run();
      }
      return;
    }
    Alert.alert('ลบโพสต์', 'ต้องการลบโพสต์นี้หรือไม่?', [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ลบ', style: 'destructive', onPress: run },
    ]);
  }

  async function addFeedComment(postId: string) {
    if (!activeUserId) {
      toast.info('ล็อกอินก่อนนะ', 'เข้าสู่ระบบแล้วค่อยคอมเมนต์ได้ 🌱');
      return;
    }
    const text = (feedCommentDrafts[postId] ?? '').trim();
    if (!text) return;
    const { error } = await supabase.from('community_feed_comments').insert({
      post_id: postId,
      user_id: activeUserId,
      body: text.slice(0, 500),
    });
    if (error) {
      toast.error('ส่งคอมเมนต์ไม่สำเร็จ', error.message);
      return;
    }
    toast.success('ส่งความเห็นแล้ว', 'ขอบคุณที่คุยกับทีม 💬✨');
    setFeedCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
    await load();
  }

  async function addFeedReply(postId: string, parentCommentId: string) {
    if (!activeUserId) {
      toast.info('ล็อกอินก่อนนะ', 'เข้าสู่ระบบแล้วค่อยตอบกลับได้ 🌱');
      return;
    }
    const key = feedReplyDraftKey(postId, parentCommentId);
    const text = (feedReplyDrafts[key] ?? '').trim();
    if (!text) return;
    const { error } = await supabase.from('community_feed_comments').insert({
      post_id: postId,
      user_id: activeUserId,
      parent_id: parentCommentId,
      body: text.slice(0, 500),
    });
    if (error) {
      toast.error('ส่งคำตอบไม่สำเร็จ', error.message);
      return;
    }
    toast.success('ส่งคำตอบแล้ว', 'ขอบคุณที่คุยต่อกับทีม 💬');
    setFeedReplyDrafts((prev) => ({ ...prev, [key]: '' }));
    setFeedReplyTarget(null);
    await load();
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
        visible={!!selectedCard}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedCard(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelectedCard(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>
              งานกำลังดำเนินการ: {selectedCard?.display_name ?? ''}
            </Text>
            <View style={styles.modalNoteBox}>
              <Text style={styles.modalNoteLabel}>โน๊ตสตอรี่</Text>
              <Text style={styles.modalNoteText}>
                {selectedCard?.note?.body ?? 'ยังไม่มีโน๊ต'}
              </Text>
            </View>
            <View style={styles.modalLeaveBox}>
              <Text style={styles.modalLeaveLabel}>สถานะการลา</Text>
              <Text style={styles.modalLeaveText}>
                {selectedCard?.leaveSummary ?? 'ไม่มีคำขอลาที่รออนุมัติ และไม่อยู่ในช่วงลาที่อนุมัติแล้ว (วันนี้)'}
              </Text>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {(selectedCard?.activeTasks ?? []).length === 0 ? (
                <Text style={styles.emptyTask}>ตอนนี้ไม่มีงานที่กำลังทำอยู่</Text>
              ) : (
                selectedCard?.activeTasks.map((t) => {
                  const pct = taskProgressPercent(t);
                  return (
                    <View key={t.id} style={styles.taskItem}>
                      <Text style={styles.taskTitle} numberOfLines={2}>
                        {t.title}
                      </Text>
                      <Text style={styles.taskPct}>{pct}%</Text>
                      <View style={styles.taskBar}>
                        <View style={[styles.taskFill, { width: `${pct}%` }]} />
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
            {selectedCard?.note ? (
              <View style={styles.replyWrap}>
                {selectedCard.replies.map((r) => {
                  const who =
                    cards.find((c) => c.user_id === r.user_id)?.display_name ??
                    r.user_id.slice(0, 6);
                  return (
                    <Text key={r.id} style={styles.replyLine}>
                      <Text style={styles.replyWho}>{who}: </Text>
                      {r.body}
                    </Text>
                  );
                })}
                <View style={styles.replyRow}>
                  <TextInput
                    style={styles.replyInput}
                    value={replyDrafts[selectedCard.note.id] ?? ''}
                    onChangeText={(t) =>
                      setReplyDrafts((prev) => ({
                        ...prev,
                        [selectedCard.note!.id]: t.slice(0, 120),
                      }))
                    }
                    placeholder="ตอบกลับโน๊ตนี้..."
                  />
                  <Pressable
                    style={styles.replyBtn}
                    onPress={() => addReply(selectedCard.note!.id)}>
                    <Text style={styles.replyBtnText}>ตอบ</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <FlatList
        data={filteredFeed}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
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
        ListEmptyComponent={
          <View style={styles.feedEmpty}>
            <Text style={styles.feedEmptyText}>
              {query.trim()
                ? 'ไม่พบโพสต์ที่ตรงกับการค้นหา'
                : 'ยังไม่มีโพสต์ในฟีด'}
            </Text>
            <Text style={styles.feedEmptySub}>
              {query.trim()
                ? 'ลองคำค้นอื่น หรือล้างช่องค้นหา'
                : 'เลือกรูปหรือวิดีโอและเขียนแคปชั่นด้านบนเพื่อโพสต์แรก'}
            </Text>
          </View>
        }
        ListHeaderComponent={
          <View>
            <View style={styles.searchWrap}>
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="ค้นหาจากชื่อหรืออีเมล..."
                autoCapitalize="none"
                autoCorrect={false}
              />
              {!!query.trim() ? (
                <Pressable onPress={() => setQuery('')}>
                  <Text style={styles.clearText}>ล้าง</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.storySection}>
              <View style={styles.storyHeader}>
                <Text style={styles.storyTitle}>โน๊ตของทีมวันนี้</Text>
                <Text style={styles.storySub}>
                  แตะรูปเพื่อดูโน้ตและงานที่กำลังทำ
                </Text>
              </View>
              {storyCards.length === 0 ? (
                <Text style={styles.storyEmpty}>
                  ยังไม่มีโน๊ตสตอรี่ตอนนี้
                </Text>
              ) : (
                <Animated.View
                  style={[
                    styles.storyAnimated,
                    { opacity: storyFade, transform: [{ translateY: storySlideY }] },
                  ]}>
                  <View style={styles.storyScrollerWrap}>
                    <ScrollView
                      ref={storyScrollRef}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.storyRow}
                      onLayout={(e) => setStoryViewportW(e.nativeEvent.layout.width)}
                      onContentSizeChange={(w) => setStoryContentW(w)}
                      onScroll={(e) => setStoryScrollX(e.nativeEvent.contentOffset.x)}
                      scrollEventThrottle={16}>
                      {storyCards.map((c) => (
                        <Pressable
                          key={`story-${c.user_id}`}
                          style={({ pressed }) => [
                            styles.storyItem,
                            pressed && styles.storyItemPressed,
                          ]}
                          onPress={() => setSelectedCard(c)}>
                          <View style={styles.storyNotePill}>
                            <Text style={styles.storyDots}>⋮</Text>
                            <Text style={styles.storyNoteText} numberOfLines={2}>
                              {c.note?.body}
                            </Text>
                          </View>
                          <LinearGradient
                            colors={['#8EEA92', '#44B95B', '#2D8E44']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.storyRing}>
                            {c.avatar_url ? (
                              <Image source={{ uri: c.avatar_url }} style={styles.storyImg} />
                            ) : (
                              <View style={styles.storyFallback}>
                                <Text style={styles.storyFallbackText}>
                                  {c.display_name.slice(0, 1).toUpperCase()}
                                </Text>
                              </View>
                            )}
                            <View
                              style={[
                                styles.statusDot,
                                c.presence === 'online'
                                  ? styles.statusOnline
                                  : c.presence === 'break'
                                    ? styles.statusBreak
                                    : styles.statusOffline,
                              ]}
                            />
                          </LinearGradient>
                          <Text style={styles.storyName} numberOfLines={1}>
                            {c.display_name}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                    {canScrollStory && storyScrollX > 6 ? (
                      <Pressable
                        style={[styles.chevronBtn, styles.chevronLeft]}
                        onPress={() =>
                          storyScrollRef.current?.scrollTo({
                            x: Math.max(0, storyScrollX - 220),
                            animated: true,
                          })
                        }>
                        <Text style={styles.chevronText}>‹</Text>
                      </Pressable>
                    ) : null}
                    {canScrollStory && storyScrollX < storyContentW - storyViewportW - 6 ? (
                      <Pressable
                        style={[styles.chevronBtn, styles.chevronRight]}
                        onPress={() =>
                          storyScrollRef.current?.scrollTo({
                            x: Math.min(
                              storyContentW - storyViewportW,
                              storyScrollX + 220
                            ),
                            animated: true,
                          })
                        }>
                        <Text style={styles.chevronText}>›</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </Animated.View>
              )}
            </View>

            <View style={styles.composer}>
              <Text style={styles.composerTitle}>ฉันกำลังคิดว่า...</Text>
              <Text style={styles.composerHint}>
                สูงสุด {MY_NOTE_MAX_CHARS} ตัวอักษร — ถ้าตัวนับเกินเลขหลัง / แปลว่ายาวเกิน
                ต้องลดข้อความก่อนบันทึก
              </Text>
              <TextInput
                style={styles.input}
                value={myNote}
                onChangeText={(t) => setMyNote(t.slice(0, MY_NOTE_MAX_CHARS))}
                placeholder="เขียนข้อความสั้นๆ ให้ทีมเห็น..."
                multiline
                maxLength={MY_NOTE_MAX_CHARS}
              />
              <View style={styles.composerActions}>
                <Text
                  style={[
                    styles.count,
                    myNote.length >= MY_NOTE_MAX_CHARS && styles.countAtLimit,
                  ]}>
                  {myNote.length}/{MY_NOTE_MAX_CHARS}
                </Text>
                <Pressable
                  style={[
                    styles.postBtn,
                    (saving || myNote.trim().length === 0) &&
                      styles.postBtnDisabled,
                  ]}
                  onPress={saveMyNote}
                  disabled={saving || myNote.trim().length === 0}>
                  <Text style={styles.postBtnText}>บันทึก</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.feedComposer}>
              <View style={styles.feedTopBar}>
                <Text style={styles.feedSectionTitle}>ฟีดชุมชน</Text>
                <View style={styles.feedActionBar}>
                  <Pressable style={styles.feedActionChip} onPress={pickFeedImage}>
                    <Text style={styles.feedActionChipText}>
                      {feedImageUri ? '🖼 เปลี่ยนรูป' : '📷 รูป'}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.feedActionChip} onPress={pickFeedVideo}>
                    <Text style={styles.feedActionChipText}>
                      {feedVideoUri ? '🎬 เปลี่ยนคลิป' : '🎬 วิดีโอ'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.feedActionChip}
                    onPress={() => setQuery('')}>
                    <Text style={styles.feedActionChipText}>🔎 ค้นหา</Text>
                  </Pressable>
                </View>
              </View>
              <Text style={styles.feedComposerHint}>
                โพสต์รูปหรือวิดีโอและแคปชั่น — รูปจะถูกย่อให้พอดีกรอบฟีด วิดีโอแนะนำไม่เกิน 2 นาที
                {'\n'}
                วิดีโอจะถูกบีบอัตโนมัติถ้าไฟล์ใหญ่ — หลังบีบต้องไม่เกิน{' '}
                {Math.round(COMMUNITY_FEED_VIDEO_MAX_BYTES / (1024 * 1024))} MB
                {Platform.OS === 'web' ? ' (บนเว็บไม่มีขั้นบีบ native)' : ''}
              </Text>
              {!feedVideoUri ? (
                <View style={styles.aspectRow}>
                  <Pressable
                    style={[styles.aspectChip, feedAspect === 'square' && styles.aspectChipOn]}
                    onPress={() => setFeedAspect('square')}>
                    <Text
                      style={[styles.aspectChipText, feedAspect === 'square' && styles.aspectChipTextOn]}>
                      1:1
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.aspectChip, feedAspect === 'portrait' && styles.aspectChipOn]}
                    onPress={() => setFeedAspect('portrait')}>
                    <Text
                      style={[
                        styles.aspectChipText,
                        feedAspect === 'portrait' && styles.aspectChipTextOn,
                      ]}>
                      3:4
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.aspectChip, feedAspect === 'landscape' && styles.aspectChipOn]}
                    onPress={() => setFeedAspect('landscape')}>
                    <Text
                      style={[
                        styles.aspectChipText,
                        feedAspect === 'landscape' && styles.aspectChipTextOn,
                      ]}>
                      4:3
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.feedAspectVideoNote}>
                  วิดีโอแสดงในกรอบ 16:9 (ไม่ล้นขอบการ์ด)
                </Text>
              )}
              {feedVideoUri ? (
                <View style={[styles.feedPreviewWrap, { aspectRatio: 16 / 9 }]}>
                  <Video
                    source={{ uri: feedVideoUri }}
                    style={styles.feedPreviewMedia}
                    resizeMode={ResizeMode.CONTAIN}
                    useNativeControls
                    isLooping={false}
                  />
                </View>
              ) : feedImageUri ? (
                <View
                  style={[
                    styles.feedPreviewWrap,
                    {
                      aspectRatio:
                        feedPreviewMeasuredAspect ??
                        (feedAspect === 'square'
                          ? 1
                          : feedAspect === 'portrait'
                            ? 3 / 4
                            : 4 / 3),
                    },
                  ]}>
                  <ZoomableImage
                    source={{ uri: feedImageUri }}
                    style={styles.feedPreviewMedia}
                    resizeMode="contain"
                  />
                </View>
              ) : null}
              <View style={styles.feedTtlRow}>
                <View style={styles.feedTtlTextCol}>
                  <Text style={styles.feedTtlTitle}>ลบโพสต์ฟีดอัตโนมัติ</Text>
                  <Text style={styles.feedTtlSub}>
                    เมื่อเปิด โพสต์ของคุณที่เกิน 30 วันจะถูกลบทุกวัน (ลดข้อมูลหลังบ้าน)
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="ลบโพสต์ฟีดอัตโนมัติหลัง 30 วัน"
                  value={profile?.community_feed_auto_delete_enabled === true}
                  disabled={!activeUserId || feedAutoDeleteSaving}
                  onValueChange={(v) => void persistFeedAutoDelete(v)}
                  trackColor={{ false: c.border, true: c.primaryMuted }}
                  thumbColor={
                    profile?.community_feed_auto_delete_enabled === true
                      ? c.primary
                      : c.surfaceElevated
                  }
                />
              </View>
              <TextInput
                style={styles.feedCaptionInput}
                value={feedCaption}
                onChangeText={(t) => setFeedCaption(t.slice(0, 2000))}
                placeholder="แคปชั่น (ไม่บังคับ)"
                multiline
              />
              <Pressable
                style={[
                  styles.postBtn,
                  (feedPosting || (!feedImageUri && !feedVideoUri)) &&
                    styles.postBtnDisabled,
                ]}
                onPress={publishFeedPost}
                disabled={feedPosting || (!feedImageUri && !feedVideoUri)}>
                <Text style={styles.postBtnText}>
                  {feedVideoCompressing
                    ? 'กำลังบีบวิดีโอ...'
                    : feedPosting
                      ? 'กำลังโพสต์...'
                      : 'โพสต์'}
                </Text>
              </Pressable>
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const canDelete =
            !!activeUserId &&
            (item.user_id === activeUserId || admin);
          return (
            <View style={styles.feedPost}>
              <View style={styles.feedPostHead}>
                <UserAvatar
                  uri={item.author_avatar}
                  label={item.author_name}
                  size={40}
                />
                <View style={styles.feedPostHeadText}>
                  <Text style={styles.feedAuthor} numberOfLines={1}>
                    {item.author_name}
                  </Text>
                  <Text style={styles.feedTime}>
                    {formatFeedTime(item.created_at)}
                  </Text>
                </View>
                {canDelete ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="ลบโพสต์"
                    hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                    style={({ pressed }) => [
                      styles.feedDeleteBtn,
                      pressed && styles.feedDeleteBtnPressed,
                    ]}
                    onPress={() => confirmDeleteFeedPost(item.id)}>
                    <Text style={styles.feedDelete}>ลบ</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.feedMetaRow}>
                <Text style={styles.feedMetaText}>
                  💬 {(item.comments ?? []).length} ความคิดเห็น
                </Text>
                <Text style={styles.feedMetaText}>
                  {formatFeedTime(item.created_at)}
                </Text>
              </View>
              <CommunityFeedPostImage
                key={item.id}
                uri={item.image_url}
                mediaType={item.media_type}
                imageLayout={item.image_layout}
                postId={item.id}
                heartFlashPostId={heartFlashPostId}
                heartOpacity={heartOpacity}
                onPressImage={onFeedMediaPress}
              />
              <View style={styles.feedLikeBar}>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => void toggleFeedLike(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={item.liked_by_me ? 'เลิกถูกใจ' : 'ถูกใจ'}>
                  <Text style={styles.feedHeartBtn}>
                    {item.liked_by_me ? '❤️' : '🤍'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    item.like_count > 0 && setLikersModalPostId(item.id)
                  }
                  disabled={item.like_count === 0}
                  style={({ pressed }) => [
                    styles.feedLikeCountWrap,
                    item.like_count === 0 && styles.feedLikeCountWrapDisabled,
                    pressed &&
                      item.like_count > 0 &&
                      styles.feedLikeCountWrapPressed,
                  ]}>
                  <Text
                    style={[
                      styles.feedLikeCount,
                      item.like_count === 0 && styles.feedLikeCountMuted,
                    ]}>
                    {item.like_count === 0
                      ? 'ยังไม่มีถูกใจ'
                      : `ถูกใจ ${item.like_count} คน · แตะดูรายชื่อ`}
                  </Text>
                </Pressable>
              </View>
              {item.caption ? (
                <Text style={styles.feedPostCaption}>{item.caption}</Text>
              ) : null}

              <View style={styles.feedCommentSection}>
                {(item.comments ?? []).map((cm) => (
                  <FeedCommentRecursive
                    key={cm.id}
                    cm={cm}
                    postId={item.id}
                    depth={0}
                    activeUserId={activeUserId}
                    replyTarget={feedReplyTarget}
                    replyDrafts={feedReplyDrafts}
                    onOpenReply={(postId, parentId) =>
                      setFeedReplyTarget({ postId, parentId })
                    }
                    onCancelReply={() => setFeedReplyTarget(null)}
                    onChangeReplyDraft={(key, text) =>
                      setFeedReplyDrafts((prev) => ({ ...prev, [key]: text }))
                    }
                    onSendReply={(postId, parentId) =>
                      void addFeedReply(postId, parentId)
                    }
                  />
                ))}
                <View style={styles.feedCommentComposer}>
                  <TextInput
                    style={styles.feedCommentInput}
                    value={feedCommentDrafts[item.id] ?? ''}
                    onChangeText={(t) =>
                      setFeedCommentDrafts((prev) => ({
                        ...prev,
                        [item.id]: t.slice(0, 500),
                      }))
                    }
                    placeholder="แสดงความคิดเห็น..."
                    placeholderTextColor={NatureTheme.colors.textMuted}
                    multiline
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.feedCommentSend,
                      pressed && styles.feedCommentSendPressed,
                      !activeUserId && styles.feedCommentSendDisabled,
                    ]}
                    onPress={() => addFeedComment(item.id)}
                    disabled={!activeUserId}>
                    <Text style={styles.feedCommentSendText}>↗</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        }}
      />

      <Modal
        visible={!!likersModalPostId}
        transparent
        animationType="fade"
        onRequestClose={() => setLikersModalPostId(null)}>
        <View style={styles.likersModalRoot}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setLikersModalPostId(null)}
          />
          <View style={styles.likersModalCard}>
            <Text style={styles.likersModalTitle}>ถูกใจ</Text>
            {likersLoading ? (
              <ActivityIndicator
                style={styles.likersModalSpinner}
                color={NatureTheme.colors.primary}
              />
            ) : likersRows.length === 0 ? (
              <Text style={styles.likersModalEmpty}>ยังไม่มีรายชื่อ</Text>
            ) : (
              <FlatList
                data={likersRows}
                keyExtractor={(r) => r.user_id}
                style={styles.likersModalList}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item: liker }) => (
                  <View style={styles.likersRow}>
                    <UserAvatar
                      uri={liker.avatar_url}
                      label={liker.display_name}
                      size={40}
                    />
                    <Text style={styles.likersName} numberOfLines={1}>
                      {liker.display_name}
                    </Text>
                  </View>
                )}
              />
            )}
            <Pressable
              style={styles.likersModalClose}
              onPress={() => setLikersModalPostId(null)}>
              <Text style={styles.likersModalCloseText}>ปิด</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.canvas },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchWrap: {
    marginTop: s.section,
    marginHorizontal: s.screen,
    marginBottom: s.section,
    borderRadius: 999,
    borderWidth: 0,
    backgroundColor: c.surface,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 7,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    color: c.text,
    fontSize: 14,
    paddingVertical: 4,
  },
  clearText: { color: c.link, fontWeight: '700', fontSize: 12 },
  storySection: {
    marginHorizontal: 12,
    marginTop: 0,
    marginBottom: 10,
    padding: 12,
    borderRadius: 20,
    borderWidth: 0,
    backgroundColor: c.surface,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 2,
  },
  storyHeader: { marginBottom: 8 },
  storyTitle: { fontSize: 14, fontWeight: '700', color: c.text },
  storySub: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  storyAnimated: { width: '100%' },
  storyScrollerWrap: { position: 'relative' },
  storyRow: { paddingRight: 8, gap: 12, paddingTop: 2 },
  storyItem: { width: 108, alignItems: 'center' },
  storyItemPressed: { transform: [{ scale: 0.94 }] },
  storyEmpty: {
    fontSize: 12,
    color: c.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
  },
  storyNotePill: {
    width: 102,
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(24, 31, 39, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
    justifyContent: 'center',
    position: 'relative',
  },
  storyDots: {
    position: 'absolute',
    top: 4,
    right: 6,
    color: 'rgba(248,250,252,0.9)',
    fontSize: 12,
    fontWeight: '700',
  },
  storyNoteText: {
    fontSize: 11,
    lineHeight: 14,
    color: '#F8FAFC',
    textAlign: 'center',
    fontWeight: '600',
    paddingRight: 10,
  },
  storyRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  storyImg: { width: '100%', height: '100%', borderRadius: 999 },
  storyFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyFallbackText: { fontWeight: '700', color: c.primaryDark },
  statusDot: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: c.canvas,
  },
  statusOnline: { backgroundColor: '#22C55E' },
  statusBreak: { backgroundColor: '#F59E0B' },
  statusOffline: { backgroundColor: '#94A3B8' },
  storyName: {
    marginTop: 4,
    fontSize: 12,
    color: c.text,
    maxWidth: 100,
    fontWeight: '600',
  },
  chevronBtn: {
    position: 'absolute',
    top: 48,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(24,31,39,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  chevronLeft: { left: 2 },
  chevronRight: { right: 2 },
  chevronText: { color: '#F8FAFC', fontSize: 20, lineHeight: 20, fontWeight: '700' },
  composer: {
    margin: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: c.surface,
    borderWidth: 0,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 9,
    elevation: 2,
  },
  listContent: { paddingBottom: 18, flexGrow: 1 },
  feedComposer: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: c.surface,
    borderWidth: 0,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 9,
    elevation: 2,
  },
  feedTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  feedActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedActionChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D5EBDA',
    backgroundColor: '#F2FCF4',
  },
  feedActionChipText: { color: '#2E6B45', fontWeight: '700', fontSize: 12 },
  feedSectionTitle: { fontWeight: '700', color: c.text, fontSize: 15 },
  feedComposerHint: {
    fontSize: 12,
    color: c.textMuted,
    marginTop: 4,
    marginBottom: 10,
  },
  aspectRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  aspectChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: c.chip,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  aspectChipOn: { backgroundColor: c.primaryLight, borderColor: c.primaryMuted },
  aspectChipText: { color: c.textMuted, fontWeight: '600', fontSize: 11 },
  aspectChipTextOn: { color: c.primaryDark, fontWeight: '700' },
  feedAspectVideoNote: {
    fontSize: 12,
    color: c.textMuted,
    marginBottom: 10,
  },
  feedPreviewWrap: {
    width: '100%',
    borderRadius: r.sm,
    marginBottom: 10,
    backgroundColor: c.chip,
    overflow: 'hidden',
  },
  feedPreviewMedia: { width: '100%', height: '100%' },
  feedTtlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  feedTtlTextCol: { flex: 1, minWidth: 0 },
  feedTtlTitle: { fontSize: 13, fontWeight: '700', color: c.text },
  feedTtlSub: {
    fontSize: 11,
    color: c.textMuted,
    marginTop: 4,
    lineHeight: 15,
  },
  feedCaptionInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 10,
    minHeight: 72,
    textAlignVertical: 'top',
    backgroundColor: c.surfaceElevated,
    color: c.text,
    marginBottom: 10,
  },
  feedPost: {
    marginHorizontal: 12,
    marginBottom: 14,
    padding: 12,
    borderRadius: 20,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: '#E3F2E7',
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  feedPostHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  feedPostHeadText: { flex: 1, minWidth: 0 },
  feedAuthor: { fontWeight: '700', color: c.text, fontSize: 14 },
  feedTime: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  feedDeleteBtn: {
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: -4,
    marginVertical: -6,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: r.sm,
  },
  feedDeleteBtnPressed: { backgroundColor: 'rgba(220, 38, 38, 0.08)' },
  feedDelete: { color: '#DC2626', fontWeight: '700', fontSize: 14 },
  feedLikeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    marginTop: 2,
  },
  feedHeartBtn: { fontSize: 22 },
  feedLikeCountWrap: { flex: 1, minWidth: 0, paddingVertical: 4 },
  feedLikeCountWrapDisabled: { opacity: 0.45 },
  feedLikeCountWrapPressed: { opacity: 0.75 },
  feedLikeCount: { fontSize: 13, fontWeight: '600', color: c.link },
  feedLikeCountMuted: { color: c.textMuted, fontWeight: '500' },
  likersModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 24,
  },
  likersModalCard: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '72%',
    borderRadius: 20,
    backgroundColor: c.surface,
    padding: 16,
    borderWidth: 1,
    borderColor: c.borderSoft,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  likersModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: c.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  likersModalSpinner: { marginVertical: 24 },
  likersModalEmpty: {
    textAlign: 'center',
    color: c.textMuted,
    paddingVertical: 20,
    fontSize: 14,
  },
  likersModalList: { maxHeight: 320 },
  likersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderSoft,
  },
  likersName: { flex: 1, fontSize: 15, fontWeight: '600', color: c.text },
  likersModalClose: {
    marginTop: 12,
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: c.river,
  },
  likersModalCloseText: { color: c.onAccent, fontWeight: '700', fontSize: 14 },
  feedMetaRow: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  feedMetaText: { fontSize: 11, color: c.textMuted, fontWeight: '600' },
  feedPostCaption: {
    marginTop: 10,
    fontSize: 14,
    color: c.text,
    lineHeight: 20,
  },
  feedCommentSection: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
    gap: 8,
  },
  feedCommentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  feedCommentBubble: {
    flex: 1,
    minWidth: 0,
    backgroundColor: c.surfaceMuted,
    borderRadius: r.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  feedCommentAuthor: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text,
    marginBottom: 2,
  },
  feedCommentText: {
    fontSize: 13,
    color: c.textSecondary,
    lineHeight: 18,
  },
  feedCommentComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  feedCommentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 9,
    minHeight: 38,
    maxHeight: 74,
    backgroundColor: c.surfaceElevated,
    color: c.text,
    fontSize: 12,
  },
  feedCommentSend: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: c.river,
    borderRadius: 999,
  },
  feedCommentSendPressed: { opacity: 0.88 },
  feedCommentSendDisabled: { opacity: 0.45 },
  feedCommentSendText: {
    color: c.onAccent,
    fontWeight: '700',
    fontSize: 15,
  },
  feedEmpty: {
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
  },
  feedEmptyText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  feedEmptySub: {
    marginTop: 6,
    fontSize: 12,
    color: c.textMuted,
    textAlign: 'center',
  },
  composerTitle: { fontWeight: '700', color: c.text, marginBottom: 8 },
  composerHint: {
    fontSize: 12,
    color: c.textMuted,
    marginBottom: 8,
    lineHeight: 17,
  },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 10,
    minHeight: 58,
    textAlignVertical: 'top',
    backgroundColor: c.surfaceElevated,
    color: c.text,
  },
  count: { fontSize: 11, color: c.textMuted },
  countAtLimit: { color: c.warningTitle, fontWeight: '700' },
  postBtn: {
    backgroundColor: c.river,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: r.sm,
  },
  postBtnText: { color: c.onAccent, fontWeight: '700' },
  postBtnDisabled: { opacity: 0.55 },
  replyWrap: { marginTop: 8, gap: 6 },
  replyLine: { fontSize: 12, color: c.textSecondary },
  replyWho: { color: c.primaryDark, fontWeight: '700' },
  replyRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  replyInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: c.text,
  },
  replyBtn: {
    backgroundColor: c.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: r.sm,
  },
  replyBtnText: { color: c.onAccent, fontWeight: '700' },
  backdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: c.surfaceElevated,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderBottomWidth: 0,
    padding: 14,
    maxHeight: '78%',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 8 },
  modalNoteBox: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    padding: 10,
    marginBottom: 10,
  },
  modalNoteLabel: { fontSize: 11, color: c.textMuted },
  modalNoteText: { marginTop: 4, color: c.textSecondary, fontSize: 14 },
  modalLeaveBox: {
    borderWidth: 1,
    borderColor: c.river,
    borderRadius: r.sm,
    backgroundColor: c.riverLight,
    padding: 10,
    marginBottom: 10,
  },
  modalLeaveLabel: { fontSize: 11, color: c.textMuted, fontWeight: '600' },
  modalLeaveText: { marginTop: 4, color: c.text, fontSize: 13, lineHeight: 19 },
  emptyTask: { textAlign: 'center', color: c.textMuted, paddingVertical: 20 },
  taskItem: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    backgroundColor: c.surface,
    padding: 10,
    marginBottom: 8,
  },
  taskTitle: { fontSize: 14, color: c.text, fontWeight: '600' },
  taskPct: { marginTop: 4, fontSize: 12, color: c.primaryDark, fontWeight: '700' },
  taskBar: {
    marginTop: 6,
    height: 7,
    borderRadius: 4,
    backgroundColor: c.chip,
    overflow: 'hidden',
  },
  taskFill: { height: '100%', backgroundColor: c.primary },
  feedCommentThread: { marginBottom: 6 },
  feedReplyIndent: {
    marginLeft: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: c.borderSoft,
  },
  feedReplyLink: { marginTop: 6, alignSelf: 'flex-start', paddingVertical: 2 },
  feedReplyLinkText: { fontSize: 12, fontWeight: '700', color: c.link },
  feedReplyComposer: { marginTop: 8, gap: 8 },
  feedReplyInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 40,
    maxHeight: 100,
    fontSize: 13,
    color: c.text,
    backgroundColor: c.surfaceElevated,
    textAlignVertical: 'top',
  },
  feedReplyActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  feedReplyCancelText: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  feedReplySendBtn: {
    backgroundColor: c.river,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
  },
  feedReplySendBtnText: { color: c.onAccent, fontWeight: '700', fontSize: 12 },
});

type FeedCommentRecursiveProps = {
  cm: FeedCommentRow;
  postId: string;
  depth: number;
  activeUserId: string | null;
  replyTarget: { postId: string; parentId: string } | null;
  replyDrafts: Record<string, string>;
  onOpenReply: (postId: string, parentId: string) => void;
  onCancelReply: () => void;
  onChangeReplyDraft: (key: string, text: string) => void;
  onSendReply: (postId: string, parentId: string) => void;
};

function FeedCommentRecursive({
  cm,
  postId,
  depth,
  activeUserId,
  replyTarget,
  replyDrafts,
  onOpenReply,
  onCancelReply,
  onChangeReplyDraft,
  onSendReply,
}: FeedCommentRecursiveProps) {
  const draftKey = feedReplyDraftKey(postId, cm.id);
  const showReplyBox =
    replyTarget?.postId === postId && replyTarget?.parentId === cm.id;
  const indent = depth > 0;

  return (
    <View
      style={[
        styles.feedCommentThread,
        indent ? styles.feedReplyIndent : null,
      ]}>
      <View style={styles.feedCommentRow}>
        <UserAvatar uri={cm.author_avatar} label={cm.author_name} size={30} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.feedCommentBubble}>
            <Text style={styles.feedCommentAuthor} numberOfLines={1}>
              {cm.author_name}
            </Text>
            <Text style={styles.feedCommentText}>{cm.body}</Text>
          </View>
          <Pressable
            style={styles.feedReplyLink}
            hitSlop={8}
            onPress={() => onOpenReply(postId, cm.id)}>
            <Text style={styles.feedReplyLinkText}>ตอบกลับ</Text>
          </Pressable>
          {showReplyBox ? (
            <View style={styles.feedReplyComposer}>
              <TextInput
                style={styles.feedReplyInput}
                value={replyDrafts[draftKey] ?? ''}
                onChangeText={(t) => onChangeReplyDraft(draftKey, t.slice(0, 500))}
                placeholder="เขียนคำตอบ..."
                placeholderTextColor={NatureTheme.colors.textMuted}
                multiline
              />
              <View style={styles.feedReplyActions}>
                <Pressable onPress={onCancelReply} hitSlop={8}>
                  <Text style={styles.feedReplyCancelText}>ยกเลิก</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.feedReplySendBtn,
                    pressed && { opacity: 0.88 },
                    !activeUserId && { opacity: 0.45 },
                  ]}
                  onPress={() => onSendReply(postId, cm.id)}
                  disabled={!activeUserId}>
                  <Text style={styles.feedReplySendBtnText}>ส่ง</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </View>
      {(cm.replies ?? []).map((child) => (
        <FeedCommentRecursive
          key={child.id}
          cm={child}
          postId={postId}
          depth={depth + 1}
          activeUserId={activeUserId}
          replyTarget={replyTarget}
          replyDrafts={replyDrafts}
          onOpenReply={onOpenReply}
          onCancelReply={onCancelReply}
          onChangeReplyDraft={onChangeReplyDraft}
          onSendReply={onSendReply}
        />
      ))}
    </View>
  );
}
