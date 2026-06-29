import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { NatureTheme } from '@/constants/Theme';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

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

type Props = {
  visible: boolean;
  manager: Profile | null;
  /** บัญชีที่เลือกเป็นคนในทีมได้ รวมถึง Admin/HR เมื่อองค์กรต้องการให้ manager มอบหมายงานให้ได้ */
  candidateProfiles: Profile[];
  onClose: () => void;
  onSaved: () => void;
};

export function AdminManagerDelegationModal({
  visible,
  manager,
  candidateProfiles,
  onClose,
  onSaved,
}: Props) {
  const toast = useCuteToast();
  const [canApproveLeave, setCanApproveLeave] = useState(false);
  const [canManageSchedule, setCanManageSchedule] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!manager?.id) return;
    setLoading(true);
    try {
      const [{ data: scope }, { data: reps }] = await Promise.all([
        supabase
          .from('manager_scopes')
          .select('can_approve_leave, can_manage_schedule')
          .eq('manager_id', manager.id)
          .maybeSingle(),
        supabase
          .from('manager_direct_reports')
          .select('subordinate_id')
          .eq('manager_id', manager.id),
      ]);
      setCanApproveLeave(!!scope?.can_approve_leave);
      setCanManageSchedule(!!scope?.can_manage_schedule);
      const ids = new Set<string>();
      for (const r of reps ?? []) {
        const sid = (r as { subordinate_id?: string }).subordinate_id;
        if (sid) ids.add(sid);
      }
      setSelected(ids);
    } finally {
      setLoading(false);
    }
  }, [manager?.id]);

  useEffect(() => {
    if (visible && manager) void load();
  }, [visible, manager, load]);

  const sortedCandidates = useMemo(() => {
    return [...candidateProfiles].sort((a, b) =>
      (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'th')
    );
  }, [candidateProfiles]);

  function toggleSub(id: string) {
    if (id === manager?.id) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!manager) return;
    setSaving(true);
    try {
      const { data: scopeRes, error: e1 } = await supabase.rpc('admin_set_manager_scope', {
        p_manager_id: manager.id,
        p_can_approve_leave: canApproveLeave,
        p_can_manage_schedule: canManageSchedule,
      });
      if (e1) {
        toast.error('บันทึกสิทธิ์ไม่สำเร็จ', e1.message);
        return;
      }
      const raw = scopeRes as { ok?: boolean; error?: string } | null;
      if (raw && raw.ok === false) {
        toast.error('บันทึกสิทธิ์ไม่สำเร็จ', raw.error ?? 'unknown');
        return;
      }
      const { data: repRes, error: e2 } = await supabase.rpc('admin_set_manager_direct_reports', {
        p_manager_id: manager.id,
        p_subordinate_ids: Array.from(selected),
      });
      if (e2) {
        toast.error('บันทึกลูกทีมไม่สำเร็จ', e2.message);
        return;
      }
      const raw2 = repRes as { ok?: boolean; error?: string } | null;
      if (raw2 && raw2.ok === false) {
        toast.error('บันทึกลูกทีมไม่สำเร็จ', raw2.error ?? 'unknown');
        return;
      }
      toast.success('บันทึกแล้ว', 'สิทธิ์และลูกทีมของผู้จัดการอัปเดตแล้ว');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const c = NatureTheme.colors;
  const r = NatureTheme.radius;
  const s = NatureTheme.spacing;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, WEB_MODAL_BACKDROP]} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>สิทธิ์ผู้จัดการ & ลูกทีม</Text>
          {manager ? (
            <Text style={styles.sub}>
              {manager.full_name || manager.email || manager.id}
            </Text>
          ) : null}
          {loading ? (
            <ActivityIndicator color={c.primary} style={{ marginVertical: 24 }} />
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: '72%' }}>
              <Text style={styles.label}>อนุมัติคำขอลาของลูกทีม</Text>
              <View style={styles.switchRow}>
                <Switch
                  value={canApproveLeave}
                  onValueChange={setCanApproveLeave}
                  trackColor={{ false: c.border, true: c.primaryMuted }}
                  thumbColor={canApproveLeave ? c.primary : c.surfaceMuted}
                />
                <Text style={styles.switchLabel}>
                  {canApproveLeave ? 'เปิด' : 'ปิด'} — ใช้กับคำขอที่รออนุมัติของพนักงานในรายชื่อด้านล่าง
                </Text>
              </View>
              <Text style={[styles.label, { marginTop: 14 }]}>จัดตารางกะ (มอบหมายงาน)</Text>
              <View style={styles.switchRow}>
                <Switch
                  value={canManageSchedule}
                  onValueChange={setCanManageSchedule}
                  trackColor={{ false: c.border, true: c.primaryMuted }}
                  thumbColor={canManageSchedule ? c.primary : c.surfaceMuted}
                />
                <Text style={styles.switchLabel}>
                  {canManageSchedule ? 'เปิด' : 'ปิด'} — แก้มอบหมายกะรายวันให้ลูกทีมในหน้า «ตาราง»
                </Text>
              </View>
              <Text style={[styles.label, { marginTop: 14 }]}>คนในทีม / ผู้รับมอบหมายงาน</Text>
              <Text style={styles.hint}>
                เลือกบัญชีที่ผู้จัดการคนนี้ดูแล — เมื่อบันทึกแล้วจะอนุมัติลา มอบหมายตาราง และตั้งวันหยุดให้ลูกทีมได้
                (สวิตช์ด้านบนปรับละเอียดเพิ่มเติมได้ แต่จะเปิดอัตโนมัติเมื่อมีลูกทีม)
              </Text>
              {sortedCandidates.map((p) => {
                const on = selected.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.row, on && styles.rowOn]}
                    onPress={() => toggleSub(p.id)}>
                    <View style={[styles.dot, on && styles.dotOn]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{p.full_name || p.email || p.id}</Text>
                      <Text style={styles.rowSub}>
                        {p.email ?? '—'} · {p.role}
                        {p.employee_id ? '' : ' · ยังไม่เชื่อม employee'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <View style={styles.actions}>
            <Pressable style={styles.btnGhost} onPress={onClose} disabled={saving}>
              <Text style={styles.btnGhostText}>ยกเลิก</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, saving && styles.btnDisabled]}
              onPress={() => void save()}
              disabled={saving || !manager}>
              {saving ? (
                <ActivityIndicator color={c.onAccent} />
              ) : (
                <Text style={styles.btnText}>บันทึก</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: c.surfaceElevated,
    borderTopLeftRadius: r.lg,
    borderTopRightRadius: r.lg,
    paddingHorizontal: s.screen,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '92%',
  },
  title: { fontSize: 18, fontWeight: '700', color: c.text },
  sub: { fontSize: 13, color: c.textMuted, marginTop: 4, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 8 },
  hint: { fontSize: 12, color: c.textMuted, marginBottom: 10, lineHeight: 18 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  switchLabel: { flex: 1, fontSize: 13, color: c.text, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    marginBottom: 8,
    backgroundColor: c.surface,
  },
  rowOn: { borderColor: c.primaryMuted, backgroundColor: c.primaryLight },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: c.border,
  },
  dotOn: { backgroundColor: c.primary, borderColor: c.primary },
  rowTitle: { fontSize: 14, fontWeight: '600', color: c.text },
  rowSub: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
    alignItems: 'center',
  },
  btnGhost: { paddingVertical: 10, paddingHorizontal: 14 },
  btnGhostText: { color: c.link, fontWeight: '700' },
  btn: {
    backgroundColor: c.primary,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: r.sm,
    minWidth: 120,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.65 },
  btnText: { color: c.onAccent, fontWeight: '700' },
});
