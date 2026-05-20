import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { NatureTheme } from '@/constants/Theme';
import {
  priorityLabel,
  TASK_STATUS_TH,
  taskUserIsParticipant,
} from '@/lib/taskHelpers';
import { supabase } from '@/lib/supabase';
import type { TaskRow } from '@/lib/types';

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
  const uid = session?.user?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tab, setTab] = useState<'own' | 'delegated'>('own');

  const load = useCallback(async () => {
    if (!uid) return;
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={NatureTheme.colors.primary} />
      </View>
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
                ผู้มอบหมาย:{' '}
                {t.assigned_by === uid
                  ? 'คุณ'
                  : `${String(t.assigned_by).slice(0, 8)}…`}
              </Text>
            ) : null}
            {tab === 'own' && (t.task_assignees?.length ?? 0) > 0 ? (
              <Text style={styles.meta} numberOfLines={4}>
                ผู้รับผิดชอบหลัก:{' '}
                {(t.task_assignees ?? [])
                  .filter((a) => a.is_primary)
                  .map((a) => a.user_id.slice(0, 8))
                  .join(', ') || '—'}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

const styles = StyleSheet.create({
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
