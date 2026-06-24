import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { UserAvatar } from '@/components/UserAvatar';
import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { parseMoneyInput } from '@/lib/payroll';
import { deriveRatesFromMonthlySalary } from '@/lib/payrollPeriodWork';
import { supabase } from '@/lib/supabase';
import type { BaseSalaryRow, Profile } from '@/lib/types';

type EmployeeDisplay = {
  primary: string;
  secondary: string;
  searchText: string;
};

type BaseSalaryDraft = {
  monthly_salary: string;
  daily_rate: string;
  hourly_rate: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  profiles: Profile[];
  employeeDisplayByUserId: Map<string, EmployeeDisplay>;
};

function emptyDraft(): BaseSalaryDraft {
  return { monthly_salary: '', daily_rate: '', hourly_rate: '' };
}

function fmtInput(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  return Number.isFinite(num) && num > 0 ? String(num) : '';
}

function profileName(p: Profile, display?: EmployeeDisplay): string {
  return display?.primary || p.full_name?.trim() || p.email?.trim() || p.employee_code?.trim() || p.id.slice(0, 8);
}

export function AdminBaseSalaryPanel({
  visible,
  onClose,
  profiles,
  employeeDisplayByUserId,
}: Props) {
  const { session } = useAuth();
  const toast = useCuteToast();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [loading, setLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draftByUserId, setDraftByUserId] = useState<Map<string, BaseSalaryDraft>>(new Map());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const loadBaseSalaries = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('base_salary').select('*');
      if (error) throw error;
      const map = new Map<string, BaseSalaryDraft>();
      for (const row of (data as BaseSalaryRow[]) ?? []) {
        map.set(row.user_id, {
          monthly_salary: fmtInput(row.monthly_salary),
          daily_rate: fmtInput(row.daily_rate),
          hourly_rate: fmtInput(row.hourly_rate),
        });
      }
      for (const profile of profiles) {
        if (!map.has(profile.id)) map.set(profile.id, emptyDraft());
      }
      setDraftByUserId(map);
    } catch (e) {
      toast.error('โหลดฐานเงินเดือนไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [profiles, toast]);

  useEffect(() => {
    if (visible) void loadBaseSalaries();
  }, [visible, loadBaseSalaries]);

  useEffect(() => {
    if (!visible) return;
    setSelectedUserId((prev) => prev ?? profiles[0]?.id ?? null);
  }, [visible, profiles]);

  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => {
      const display = employeeDisplayByUserId.get(p.id);
      const hay = [display?.searchText, p.full_name, p.email, p.employee_code]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [profiles, search, employeeDisplayByUserId]);

  const selectedProfile = profiles.find((p) => p.id === selectedUserId) ?? null;
  const selectedDraft = selectedUserId ? draftByUserId.get(selectedUserId) ?? emptyDraft() : emptyDraft();

  function setDraftField(userId: string, key: keyof BaseSalaryDraft, value: string) {
    setDraftByUserId((prev) => {
      const next = new Map(prev);
      next.set(userId, { ...(next.get(userId) ?? emptyDraft()), [key]: value });
      return next;
    });
  }

  async function saveUserBaseSalary(userId: string) {
    if (!session?.user?.id) return;
    const draft = draftByUserId.get(userId) ?? emptyDraft();
    setSavingUserId(userId);
    try {
      const monthly = parseMoneyInput(draft.monthly_salary);
      const daily = parseMoneyInput(draft.daily_rate);
      const hourly = parseMoneyInput(draft.hourly_rate);
      const { error } = await supabase.from('base_salary').upsert(
        {
          user_id: userId,
          monthly_salary: monthly,
          daily_rate: daily,
          hourly_rate: hourly,
          updated_by: session.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
      if (error) throw error;
      await supabase.from('payroll_employee_compensation').upsert(
        {
          user_id: userId,
          base_salary: monthly,
          updated_by: session.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
      const display = employeeDisplayByUserId.get(userId);
      const profile = profiles.find((p) => p.id === userId);
      toast.success(
        'บันทึกฐานเงินเดือนแล้ว',
        profile ? profileName(profile, display) : userId.slice(0, 8)
      );
    } catch (e) {
      toast.error('บันทึกไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingUserId(null);
    }
  }

  function autoCalculateRates(userId: string) {
    const monthly = parseMoneyInput(draftByUserId.get(userId)?.monthly_salary ?? '');
    if (monthly <= 0) {
      toast.info('กรุณากรอกฐานเงินเดือนก่อน', 'ใช้ฐานเงินเดือน ÷ 30 และ ÷ 8');
      return;
    }
    const { daily_rate, hourly_rate } = deriveRatesFromMonthlySalary(monthly);
    setDraftByUserId((prev) => {
      const next = new Map(prev);
      const current = next.get(userId) ?? emptyDraft();
      next.set(userId, {
        ...current,
        daily_rate: String(daily_rate),
        hourly_rate: String(hourly_rate),
      });
      return next;
    });
    toast.success('คำนวณอัตโนมัติแล้ว', `รายวัน ${daily_rate} · รายชั่วโมง ${hourly_rate} (แก้ไขได้)`);
  }

  function renderRateInput(
    label: string,
    value: string,
    onChange: (text: string) => void,
    hint?: string
  ) {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder="0"
          placeholderTextColor={c.textMuted}
          keyboardType="decimal-pad"
        />
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title}>จัดการฐานเงินเดือน</Text>
              <Text style={styles.sub}>
                ตั้งฐานเงินเดือน ค่าจ้างรายวัน และค่าจ้างรายชั่วโมง — Payroll และเบิกเงินเดือนจะดึงจากตารางนี้
              </Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeText}>ปิด</Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="ค้นหาชื่อ รหัส อีเมล"
            placeholderTextColor={c.textMuted}
          />

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={c.primary} />
              <Text style={styles.sub}>กำลังโหลด...</Text>
            </View>
          ) : (
            <View style={styles.body}>
              <ScrollView style={styles.listPane} contentContainerStyle={styles.listContent}>
                {filteredProfiles.map((profile) => {
                  const display = employeeDisplayByUserId.get(profile.id);
                  const on = profile.id === selectedUserId;
                  const draft = draftByUserId.get(profile.id);
                  const hasRates =
                    parseMoneyInput(draft?.monthly_salary ?? '') > 0 ||
                    parseMoneyInput(draft?.daily_rate ?? '') > 0 ||
                    parseMoneyInput(draft?.hourly_rate ?? '') > 0;
                  return (
                    <Pressable
                      key={profile.id}
                      style={[styles.listItem, on && styles.listItemOn]}
                      onPress={() => setSelectedUserId(profile.id)}>
                      <UserAvatar uri={profile.avatar_url} label={display?.primary} size={36} />
                      <View style={styles.listItemBody}>
                        <Text style={styles.listItemTitle} numberOfLines={1}>
                          {profileName(profile, display)}
                        </Text>
                        <Text style={styles.listItemSub} numberOfLines={1}>
                          {hasRates ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้งค่า'}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                {filteredProfiles.length === 0 ? (
                  <Text style={styles.empty}>ไม่พบพนักงานตามคำค้นหา</Text>
                ) : null}
              </ScrollView>

              <ScrollView style={styles.formPane} contentContainerStyle={styles.formContent}>
                {selectedProfile && selectedUserId ? (
                  <>
                    <Text style={styles.formTitle}>
                      {profileName(selectedProfile, employeeDisplayByUserId.get(selectedUserId))}
                    </Text>
                    <Text style={styles.sub}>
                      {employeeDisplayByUserId.get(selectedUserId)?.secondary}
                    </Text>
                    {renderRateInput(
                      'ฐานเงินเดือน (รายเดือน)',
                      selectedDraft.monthly_salary,
                      (text) => setDraftField(selectedUserId, 'monthly_salary', text),
                      'ใช้เมื่อเลือกโหมดจ่ายรายเดือน และสำหรับเบิกเงินเดือน'
                    )}
                    <Pressable
                      style={styles.autoCalcBtn}
                      onPress={() => autoCalculateRates(selectedUserId)}>
                      <Text style={styles.autoCalcBtnText}>คำนวณอัตโนมัติ รายวัน / รายชั่วโมง</Text>
                      <Text style={styles.autoCalcHint}>ฐานเงินเดือน ÷ 30 → รายวัน · รายวัน ÷ 8 → รายชั่วโมง</Text>
                    </Pressable>
                    {renderRateInput(
                      'ค่าจ้างรายวัน',
                      selectedDraft.daily_rate,
                      (text) => setDraftField(selectedUserId, 'daily_rate', text),
                      'คูณจำนวนวันจากตารางเข้างานในรอบ (ไม่นับวันหยุดและวันลาไม่รับเงิน)'
                    )}
                    {renderRateInput(
                      'ค่าจ้างรายชั่วโมง',
                      selectedDraft.hourly_rate,
                      (text) => setDraftField(selectedUserId, 'hourly_rate', text),
                      'คูณชั่วโมงทำงานจาก check-in / check-out'
                    )}
                    <Pressable
                      style={[styles.saveBtn, savingUserId === selectedUserId && styles.disabled]}
                      disabled={savingUserId === selectedUserId}
                      onPress={() => void saveUserBaseSalary(selectedUserId)}>
                      <Text style={styles.saveBtnText}>
                        {savingUserId === selectedUserId ? 'กำลังบันทึก...' : 'บันทึกฐานเงินเดือน'}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.empty}>เลือกพนักงานจากรายการ</Text>
                )}
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function createStyles(theme: AppTheme) {
  const c = theme.colors;
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      maxHeight: '92%',
      backgroundColor: c.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 24,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 12,
    },
    title: { fontSize: 18, fontWeight: '700', color: c.text },
    sub: { fontSize: 13, color: c.textMuted, marginTop: 4, lineHeight: 18 },
    closeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: c.surfaceMuted,
    },
    closeText: { color: c.primaryDark, fontWeight: '600' },
    searchInput: {
      marginHorizontal: 20,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: c.text,
      backgroundColor: c.surface,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 20,
    },
    body: { flexDirection: 'row', minHeight: 360, maxHeight: 520 },
    listPane: { width: '38%', borderRightWidth: 1, borderRightColor: c.border },
    listContent: { paddingVertical: 8 },
    listItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    listItemOn: { backgroundColor: c.primaryLight },
    listItemBody: { flex: 1, minWidth: 0 },
    listItemTitle: { fontSize: 14, fontWeight: '600', color: c.text },
    listItemSub: { fontSize: 12, color: c.textMuted, marginTop: 2 },
    formPane: { flex: 1 },
    formContent: { padding: 16, gap: 4 },
    formTitle: { fontSize: 16, fontWeight: '700', color: c.text },
    field: { marginTop: 12 },
    autoCalcBtn: {
      marginTop: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.primaryMuted,
      backgroundColor: c.primaryLight,
    },
    autoCalcBtnText: { fontSize: 13, fontWeight: '700', color: c.primaryDark },
    autoCalcHint: { marginTop: 4, fontSize: 11, color: c.textMuted, lineHeight: 16 },
    label: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 4 },
    hint: { fontSize: 12, color: c.textMuted, marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: c.text,
      backgroundColor: c.surface,
    },
    saveBtn: {
      marginTop: 20,
      backgroundColor: c.primary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
    },
    saveBtnText: { color: '#FFFFFF', fontWeight: '700' },
    disabled: { opacity: 0.6 },
    empty: { padding: 20, color: c.textMuted, textAlign: 'center' },
  });
}
