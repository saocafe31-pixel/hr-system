import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppLoadingScreen } from '@/components/AppLoadingScreen';
import { useAuth } from '@/contexts/AuthContext';
import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  priorityLabel,
  TASK_STATUS_TH,
  taskUserIsParticipant,
} from '@/lib/taskHelpers';
import { supabase } from '@/lib/supabase';
import type { TaskRow } from '@/lib/types';

type UserDisplay = {
  label: string;
  nickname: string | null;
};

type ProfileLite = {
  id: string;
  email: string | null;
  full_name: string | null;
  employee_id?: string | null;
};

type EmployeeLite = {
  id: string;
  legacy_user_id?: string | null;
  name?: string | null;
  surname?: string | null;
  nickname?: string | null;
};

function mergeTasksById(a: TaskRow[], b: TaskRow[]): TaskRow[] {
  const map = new Map<string, TaskRow>();
  for (const t of a) map.set(t.id, t);
  for (const t of b) map.set(t.id, t);
  return [...map.values()].sort(
    (x, y) =>
      new Date(y.created_at).getTime() - new Date(x.created_at).getTime()
  );
}

export default function TasksAssignedScreen() {
  const { session } = useAuth();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createTasksAssignedStyles(theme), [theme]);
  const uid = session?.user?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [userDisplayById, setUserDisplayById] = useState<Record<string, UserDisplay>>({});
  const [tab, setTab] = useState<'own' | 'delegated'>('own');

  const load = useCallback(async () => {
    if (!uid) {
      setTasks([]);
      setUserDisplayById({});
      return;
    }
    const { data: linkRows } = await supabase
      .from('task_assignees')
      .select('task_id')
      .eq('user_id', uid);
    const coTaskIds = [
      ...new Set(
        (linkRows ?? []).map((r: { task_id: string }) => String(r.task_id))
      ),
    ];

    const { data: mainData } = await supabase
      .from('tasks')
      .select('*, task_assignees (*)')
      .or(`assigned_to.eq.${uid},assigned_by.eq.${uid}`)
      .order('created_at', { ascending: false });

    let merged = ((mainData ?? []) as TaskRow[]) ?? [];
    const have = new Set(merged.map((t) => t.id));
    const missing = coTaskIds.filter((id) => !have.has(id));
    if (missing.length > 0) {
      const { data: extra } = await supabase
        .from('tasks')
        .select('*, task_assignees (*)')
        .in('id', missing)
        .order('created_at', { ascending: false });
      merged = mergeTasksById(merged, ((extra ?? []) as TaskRow[]) ?? []);
    }

    setTasks(merged);
    const userIds = [
      ...new Set(
        merged.flatMap((t) => [
          t.assigned_to,
          t.assigned_by,
          ...((t.task_assignees ?? []).map((a) => a.user_id)),
        ]).filter((v): v is string => !!v)
      ),
    ];
    if (userIds.length === 0) {
      setUserDisplayById({});
      return;
    }

    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id,email,full_name,employee_id')
      .in('id', userIds);
    const profiles = ((profileRows ?? []) as ProfileLite[]) ?? [];
    const employeeIds = [
      ...new Set(
        profiles.map((p) => p.employee_id).filter((v): v is string => !!v)
      ),
    ];
    const emails = [
      ...new Set(
        profiles.map((p) => p.email?.trim().toLowerCase()).filter((v): v is string => !!v)
      ),
    ];
    const [byEmployeeIdRes, byLegacyRes] = await Promise.all([
      employeeIds.length
        ? supabase
            .from('employee_directory')
            .select('id,legacy_user_id,name,surname,nickname')
            .in('id', employeeIds)
        : Promise.resolve({ data: [] as unknown[] }),
      emails.length
        ? supabase
            .from('employee_directory')
            .select('id,legacy_user_id,name,surname,nickname')
            .in('legacy_user_id', emails)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);
    const employeeById = new Map<string, EmployeeLite>();
    for (const row of ((byEmployeeIdRes.data ?? []) as EmployeeLite[]) ?? []) {
      employeeById.set(String(row.id), row);
    }
    const employeeByLegacy = new Map<string, EmployeeLite>();
    for (const row of ((byLegacyRes.data ?? []) as EmployeeLite[]) ?? []) {
      const key = row.legacy_user_id?.trim().toLowerCase();
      if (key) employeeByLegacy.set(key, row);
    }
    const nextDisplay: Record<string, UserDisplay> = {};
    for (const p of profiles) {
      const emp =
        (p.employee_id ? employeeById.get(String(p.employee_id)) : undefined) ??
        (p.email ? employeeByLegacy.get(p.email.trim().toLowerCase()) : undefined);
      const fullName = [emp?.name, emp?.surname].filter(Boolean).join(' ').trim();
      const fallback = p.full_name?.trim() || p.email?.trim() || p.id.slice(0, 8);
      const nickname = emp?.nickname?.trim() || null;
      nextDisplay[p.id] = {
        label: nickname || fullName || fallback,
        nickname,
      };
    }
    setUserDisplayById(nextDisplay);
  }, [uid]);

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

  const ownTasks = useMemo(
    () => tasks.filter((t) => uid && taskUserIsParticipant(t, uid)),
    [tasks, uid]
  );

  const delegatedTasks = useMemo(
    () =>
      tasks.filter(
        (t) => uid && t.assigned_by === uid && !taskUserIsParticipant(t, uid)
      ),
    [tasks, uid]
  );

  const show = tab === 'own' ? ownTasks : delegatedTasks;

  function displayUser(userId: string | null | undefined): string {
    if (!userId) return '—';
    if (userId === uid) return 'คุณ';
    return userDisplayById[userId]?.label || `${String(userId).slice(0, 8)}…`;
  }

  function displayUsers(userIds: string[]): string {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return '—';
    return unique.map(displayUser).join(', ');
  }

  if (loading) {
    return (
      <AppLoadingScreen
        title="กำลังโหลดสถานะงาน"
        subtitle="กำลังรวบรวมงานที่ได้รับมอบหมายและความคืบหน้าล่าสุด"
      />
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Assignment Tracker</Text>
      <View style={styles.tabs}>
        <Pressable
          style={[styles.tabBtn, tab === 'own' && styles.tabBtnOn]}
          onPress={() => setTab('own')}>
          <Text style={[styles.tabText, tab === 'own' && styles.tabTextOn]}>
            My Tasks ({ownTasks.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, tab === 'delegated' && styles.tabBtnOn]}
          onPress={() => setTab('delegated')}>
          <Text style={[styles.tabText, tab === 'delegated' && styles.tabTextOn]}>
            Delegated by Me ({delegatedTasks.length})
          </Text>
        </Pressable>
      </View>

      {tab === 'delegated' ? (
        <Text style={styles.hint}>
          งานที่คุณมอบให้ผู้อื่นเท่านั้น — ดูสถานะความคืบหน้า ไม่แสดงใน «My Tasks» ยกเว้นคุณเป็นผู้รับผิดชอบหลักด้วย
        </Text>
      ) : null}

      {show.length === 0 ? (
        <Text style={styles.empty}>No tasks in this section</Text>
      ) : (
        show.map((t) => (
          <View key={t.id} style={styles.card}>
            <Text style={styles.cardTitle}>{t.title}</Text>
            <Text style={styles.meta}>
              สถานะ: {TASK_STATUS_TH[t.status] ?? t.status}
            </Text>
            <Text style={styles.meta}>
              ความสำคัญ: {priorityLabel(t.priority ?? 'normal')}
            </Text>
            {t.due_at ? (
              <Text style={styles.meta}>
                ครบกำหนด: {new Date(t.due_at).toLocaleString('th-TH')}
              </Text>
            ) : null}
            {t.assigned_by ? (
              <Text style={styles.meta}>
                ผู้มอบหมาย: {displayUser(t.assigned_by)}
              </Text>
            ) : null}
            {tab === 'own' && (t.task_assignees?.length ?? 0) > 0 ? (
              <Text style={styles.meta} numberOfLines={4}>
                ผู้รับผิดชอบหลัก:{' '}
                {displayUsers((t.task_assignees ?? []).filter((a) => a.is_primary).map((a) => a.user_id))}
              </Text>
            ) : null}
            {tab === 'delegated' ? (
              <Text style={styles.meta} numberOfLines={4}>
                ผู้รับผิดชอบ:{' '}
                {displayUsers(
                  (t.task_assignees?.length ? t.task_assignees.map((a) => a.user_id) : [t.assigned_to])
                )}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function createTasksAssignedStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;
  const s = theme.spacing;

  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  content: { padding: s.screen, paddingBottom: s.scrollBottom },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 8 },
  tabs: { flexDirection: 'row', gap: s.gap, marginBottom: s.section },
  tabBtn: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: c.chip,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabBtnOn: { backgroundColor: c.chipActive },
  tabText: { fontSize: 12, color: c.chipText, fontWeight: '700' },
  tabTextOn: { color: c.chipTextActive },
  hint: {
    fontSize: 12,
    color: c.textMuted,
    marginBottom: 12,
    lineHeight: 18,
  },
  card: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.md,
    padding: s.card,
    marginBottom: s.gap,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 6 },
  meta: { color: c.textMuted, fontSize: 12, marginBottom: 2 },
  empty: { textAlign: 'center', color: c.textMuted, marginTop: 20 },
  });
}
