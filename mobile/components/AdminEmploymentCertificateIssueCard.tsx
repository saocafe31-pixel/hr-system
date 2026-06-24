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

import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { usePrintDocumentPreview } from '@/contexts/PrintDocumentPreviewContext';
import { directoryDisplayName } from '@/lib/employeeDirectoryDisplay';
import { loadAdminEmploymentCertificatePayload } from '@/lib/employmentCertificateData';
import { prepareEmploymentCertificateHtml } from '@/lib/employmentCertificatePdf';
import { supabase } from '@/lib/supabase';
import type { EmployeeDirectory } from '@/lib/types';

function isActiveEmployee(row: EmployeeDirectory): boolean {
  const status = (row.status ?? '').toLowerCase();
  return !status.includes('ลาออก') && !status.includes('resign');
}

export function AdminEmploymentCertificateIssueCard() {
  const toast = useCuteToast();
  const { openPrintPreview } = usePrintDocumentPreview();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [employees, setEmployees] = useState<EmployeeDirectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'with' | 'without' | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<'with' | 'without'>('without');

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_employee_directory_rows');
      if (error) throw error;
      const rows = ((data as EmployeeDirectory[]) ?? []).filter(isActiveEmployee);
      rows.sort((a, b) => directoryDisplayName(a).localeCompare(directoryDisplayName(b), 'th'));
      setEmployees(rows);
      setSelectedId((prev) => prev ?? rows[0]?.id ?? null);
    } catch (e) {
      toast.error('โหลดรายชื่อพนักงานไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  const selectedEmployee = useMemo(
    () => employees.find((row) => row.id === selectedId) ?? null,
    [employees, selectedId]
  );

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((row) => {
      const hay = [
        directoryDisplayName(row),
        row.position,
        row.branch,
        row.employee_no != null ? String(row.employee_no) : '',
        row.legacy_user_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [employees, search]);

  async function issueCertificate(withSalary: boolean) {
    if (!selectedId) {
      toast.info('เลือกพนักงาน', 'กรุณาเลือกพนักงานก่อนออกหนังสือรับรอง');
      return;
    }
    setSelectedVariant(withSalary ? 'with' : 'without');
    setExporting(withSalary ? 'with' : 'without');
    try {
      const payload = await loadAdminEmploymentCertificatePayload(selectedId, withSalary);
      const html = await prepareEmploymentCertificateHtml(payload);
      openPrintPreview({
        html,
        title: withSalary ? 'หนังสือรับรอง (ระบุเงินเดือน)' : 'หนังสือรับรองการทำงาน',
        shareDialogTitle: withSalary
          ? 'หนังสือรับรองการทำงาน (ระบุเงินเดือน)'
          : 'หนังสือรับรองการทำงาน',
      });
      toast.success(
        'เปิดตัวอย่างเอกสารแล้ว',
        `พนักงาน: ${payload.employee.fullName || directoryDisplayName(selectedEmployee!)}`
      );
    } catch (e) {
      toast.error('ออกหนังสือรับรองไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>ออกหนังสือรับรองการทำงาน</Text>
          <Text style={styles.sub}>
            แอดมิน/HR ออกหนังสือรับรองให้พนักงานได้ — เลือกพนักงานแล้วพิมพ์หรือบันทึก PDF
          </Text>
        </View>
        {loading ? <ActivityIndicator color={c.primary} /> : null}
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>วิธีใช้งาน</Text>
        <Text style={styles.infoText}>
          • เลือกพนักงานจากรายชื่อ{'\n'}
          • แบบไม่ระบุเงินเดือน — ใช้ยื่นธนาคาร วีซ่า หรือเอกสารทั่วไป{'\n'}
          • แบบระบุฐานเงินเดือน — ต้องตั้งฐานเงินเดือนในเมนูจัดการฐานเงินเดือนก่อน{'\n'}
          • ลายเซ็นและชื่อผู้ลงนามใช้จากการตั้งค่าด้านล่าง · ชื่อบริษัทใช้จากหัวสลิป
        </Text>
      </View>

      <Text style={styles.label}>พนักงาน</Text>
      <Pressable style={styles.selectBtn} onPress={() => setPickerOpen(true)}>
        <Text style={styles.selectBtnText} numberOfLines={2}>
          {selectedEmployee
            ? `${directoryDisplayName(selectedEmployee)}${selectedEmployee.position ? ` · ${selectedEmployee.position}` : ''}`
            : 'เลือกพนักงาน'}
        </Text>
        <Text style={styles.selectBtnAction}>เปลี่ยน</Text>
      </Pressable>

      <Pressable
        style={[
          styles.optionBtn,
          selectedVariant === 'without' && styles.optionBtnSelected,
          exporting === 'without' && styles.disabled,
        ]}
        disabled={exporting !== null || !selectedId}
        onPress={() => void issueCertificate(false)}>
        {exporting === 'without' ? (
          <ActivityIndicator color={c.primaryDark} />
        ) : (
          <Text
            style={[
              styles.optionBtnText,
              selectedVariant === 'without' && styles.optionBtnTextSelected,
            ]}>
            ออกหนังสือรับรอง (ไม่ระบุเงินเดือน)
          </Text>
        )}
      </Pressable>

      <Pressable
        style={[
          styles.optionBtn,
          styles.optionBtnSpaced,
          selectedVariant === 'with' && styles.optionBtnSelected,
          exporting === 'with' && styles.disabled,
        ]}
        disabled={exporting !== null || !selectedId}
        onPress={() => void issueCertificate(true)}>
        {exporting === 'with' ? (
          <ActivityIndicator color={c.primaryDark} />
        ) : (
          <Text
            style={[
              styles.optionBtnText,
              selectedVariant === 'with' && styles.optionBtnTextSelected,
            ]}>
            ออกหนังสือรับรอง (ระบุฐานเงินเดือน)
          </Text>
        )}
      </Pressable>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>เลือกพนักงาน</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="ค้นหาชื่อ ตำแหน่ง สาขา รหัส..."
              value={search}
              onChangeText={setSearch}
              placeholderTextColor={c.textMuted}
            />
            <ScrollView style={styles.modalList}>
              {filteredEmployees.map((row) => {
                const on = row.id === selectedId;
                return (
                  <Pressable
                    key={row.id}
                    style={[styles.modalRow, on && styles.modalRowOn]}
                    onPress={() => {
                      setSelectedId(row.id);
                      setPickerOpen(false);
                      setSearch('');
                    }}>
                    <Text style={[styles.modalRowTitle, on && styles.modalRowTitleOn]}>
                      {directoryDisplayName(row)}
                    </Text>
                    <Text style={styles.modalRowSub}>
                      {[row.position, row.branch, row.employee_no != null ? `#${row.employee_no}` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </Pressable>
                );
              })}
              {filteredEmployees.length === 0 ? (
                <Text style={styles.muted}>ไม่พบพนักงาน</Text>
              ) : null}
            </ScrollView>
            <Pressable style={styles.modalCloseBtn} onPress={() => setPickerOpen(false)}>
              <Text style={styles.modalCloseText}>ปิด</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;

  return StyleSheet.create({
    card: {
      marginTop: 16,
      padding: 14,
      borderRadius: r.lg,
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.borderSoft,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
    title: { fontSize: 16, fontWeight: '800', color: c.text },
    sub: { marginTop: 4, color: c.textMuted, fontSize: 12, lineHeight: 17 },
    infoBox: {
      marginBottom: 12,
      padding: 10,
      borderRadius: r.sm,
      backgroundColor: c.primaryLight,
      borderWidth: 1,
      borderColor: c.primaryMuted,
    },
    infoTitle: { fontSize: 12, fontWeight: '900', color: c.primaryDark },
    infoText: { marginTop: 6, fontSize: 11, lineHeight: 17, color: c.textSecondary },
    label: { marginBottom: 4, color: c.textSecondary, fontSize: 12, fontWeight: '800' },
    selectBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 12,
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderRadius: r.sm,
      borderWidth: 1,
      borderColor: c.borderSoft,
      backgroundColor: c.surface,
    },
    selectBtnText: { flex: 1, color: c.text, fontSize: 13, fontWeight: '700' },
    selectBtnAction: { color: c.primaryDark, fontSize: 12, fontWeight: '900' },
    optionBtn: {
      borderRadius: r.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.borderSoft,
      paddingVertical: 12,
      alignItems: 'center',
    },
    optionBtnSpaced: { marginTop: 8 },
    optionBtnSelected: {
      backgroundColor: c.primaryLight,
      borderColor: c.primaryMuted,
    },
    optionBtnText: { color: c.textSecondary, fontSize: 13, fontWeight: '900' },
    optionBtnTextSelected: { color: c.primaryDark },
    disabled: { opacity: 0.6 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      padding: 20,
    },
    modalCard: {
      maxHeight: '80%',
      borderRadius: r.lg,
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.borderSoft,
      padding: 14,
    },
    modalTitle: { fontSize: 16, fontWeight: '900', color: c.text },
    searchInput: {
      marginTop: 10,
      borderRadius: r.sm,
      borderWidth: 1,
      borderColor: c.borderSoft,
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: c.text,
      fontSize: 14,
    },
    modalList: { marginTop: 10, maxHeight: 360 },
    modalRow: {
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.borderSoft,
    },
    modalRowOn: { backgroundColor: c.primaryLight },
    modalRowTitle: { fontSize: 14, fontWeight: '800', color: c.text },
    modalRowTitleOn: { color: c.primaryDark },
    modalRowSub: { marginTop: 2, fontSize: 11, color: c.textMuted },
    muted: { padding: 12, textAlign: 'center', color: c.textMuted, fontSize: 12 },
    modalCloseBtn: {
      marginTop: 10,
      borderRadius: r.sm,
      backgroundColor: c.primary,
      paddingVertical: 11,
      alignItems: 'center',
    },
    modalCloseText: { color: c.canvas, fontWeight: '900', fontSize: 13 },
  });
}
