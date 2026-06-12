import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NatureTheme } from '@/constants/Theme';
import { useCuteToast } from '@/contexts/CuteToastContext';
import {
  bangkokPayrollPeriodBounds,
  formatPayrollCycleChipTh,
  formatPayrollPeriodRangeTh,
  listPayrollCycleKeysDescending,
  parsePayrollCycleKey,
  payrollCycleKeyFromBangkokDate,
} from '@/lib/leaveLateRules';
import { money } from '@/lib/payroll';
import { loadPayrollCompanyInfo } from '@/lib/payrollCompanyInfo';
import { exportPayslipPdf, openPayslipPrintWindow } from '@/lib/payslipPdf';
import { supabase } from '@/lib/supabase';
import type { PayrollItemRow, PayrollSlipRow } from '@/lib/types';

type Props = {
  userId: string | null | undefined;
  employeeId?: string | null | undefined;
  employeeName?: string | null | undefined;
  employeeMeta?: string | null | undefined;
  paymentMethod?: string | null | undefined;
  bankName?: string | null | undefined;
  bankAccount?: string | null | undefined;
};

const c = NatureTheme.colors;
const r = NatureTheme.radius;

function slipStatusLabel(status: PayrollSlipRow['status']): string {
  if (status === 'paid') return 'จ่ายแล้ว';
  return 'มีสลิป';
}

function formatDateTimeTh(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

export function ProfilePayslipCard({
  userId,
  employeeId,
  employeeName,
  employeeMeta,
  paymentMethod,
  bankName,
  bankAccount,
}: Props) {
  const toast = useCuteToast();
  const [slips, setSlips] = useState<PayrollSlipRow[]>([]);
  const [items, setItems] = useState<PayrollItemRow[]>([]);
  const [selectedCycleKey, setSelectedCycleKey] = useState(() => payrollCycleKeyFromBangkokDate());
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [confirmingReview, setConfirmingReview] = useState(false);

  const payrollCycleOptions = useMemo(() => listPayrollCycleKeysDescending(15), []);

  const load = useCallback(async () => {
    if (!userId) {
      setSlips([]);
      setItems([]);
      setSelectedCycleKey(payrollCycleKeyFromBangkokDate());
      return;
    }
    setLoading(true);
    try {
      let query = supabase
        .from('payroll_slips')
        .select('*')
        .in('status', ['confirmed', 'paid'])
        .order('cycle_key', { ascending: false })
        .limit(15);
      if (employeeId) {
        query = query.or(`user_id.eq.${userId},employee_id.eq.${employeeId}`);
      } else {
        query = query.eq('user_id', userId);
      }
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data as PayrollSlipRow[]) ?? [];
      setSlips(rows);
      setSelectedCycleKey((prev) => {
        if (prev && payrollCycleOptions.includes(prev)) return prev;
        return rows[0]?.cycle_key ?? payrollCycleOptions[0] ?? payrollCycleKeyFromBangkokDate();
      });
    } catch {
      setSlips([]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId, payrollCycleOptions, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const selectedSlip = slips.find((row) => row.cycle_key === selectedCycleKey) ?? null;
    if (!selectedSlip?.id) {
      setItems([]);
      return;
    }
    let alive = true;
    supabase
      .from('payroll_items')
      .select('*')
      .eq('slip_id', selectedSlip.id)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (alive) setItems((data as PayrollItemRow[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [selectedCycleKey, slips]);

  const selectedSlip = useMemo(
    () => slips.find((row) => row.cycle_key === selectedCycleKey) ?? null,
    [selectedCycleKey, slips]
  );

  const grouped = useMemo(
    () => ({
      income: items.filter((row) => row.item_kind === 'income'),
      deduction: items.filter((row) => row.item_kind === 'deduction'),
      reimbursement: items.filter((row) => row.item_kind === 'reimbursement'),
    }),
    [items]
  );

  async function printSelectedSlip() {
    if (!selectedSlip) return;
    const printWindow = openPayslipPrintWindow();
    setExportingPdf(true);
    try {
      const company = await loadPayrollCompanyInfo();
      await exportPayslipPdf({
        slip: selectedSlip,
        items,
        employee: {
          name: employeeName,
          meta: employeeMeta,
          paymentMethod,
          bankName,
          bankAccount,
        },
        company,
      }, printWindow);
      toast.success('เปิดสลิป PDF แล้ว', 'สามารถพิมพ์หรือบันทึกเป็น PDF ได้จากหน้าต่างที่เปิดขึ้น');
    } catch (e) {
      toast.error('สร้าง PDF ไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setExportingPdf(false);
    }
  }

  async function confirmSelectedSlipReview() {
    if (!selectedSlip?.id) return;
    setConfirmingReview(true);
    try {
      const { error } = await supabase.rpc('confirm_payroll_slip_review', {
        p_slip_id: selectedSlip.id,
      });
      if (error) throw error;
      toast.success('ยืนยันตรวจสอบสลิปแล้ว', 'ระบบบันทึกการยืนยันของคุณเรียบร้อย');
      await load();
    } catch (e) {
      toast.error('ยืนยันสลิปไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmingReview(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>สลิปเงินเดือน</Text>
          <Text style={styles.sub}>แสดงสลิปที่แอดมินยืนยันแล้วหรือบันทึกจ่ายแล้ว</Text>
        </View>
        {loading ? <ActivityIndicator color={c.primary} /> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {payrollCycleOptions.map((cycleKey) => {
          const on = cycleKey === selectedCycleKey;
          const slipForCycle = slips.find((slip) => slip.cycle_key === cycleKey);
          const parsed = parsePayrollCycleKey(cycleKey);
          const bounds = parsed ? bangkokPayrollPeriodBounds(parsed.y, parsed.m) : null;
          return (
            <Pressable
              key={cycleKey}
              style={[styles.chip, on && styles.chipOn, !slipForCycle && styles.chipDisabled]}
              onPress={() => setSelectedCycleKey(cycleKey)}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {formatPayrollCycleChipTh(cycleKey)}
              </Text>
              <Text style={[styles.chipSubText, on && styles.chipSubTextOn]}>
                {bounds ? formatPayrollPeriodRangeTh(bounds.startYmd, bounds.endYmd) : cycleKey}
              </Text>
              <Text style={[styles.chipStatus, on && styles.chipSubTextOn]}>
                {slipForCycle
                  ? `${slipStatusLabel(slipForCycle.status)} · ${
                      slipForCycle.employee_confirmed_at ? 'ยืนยันแล้ว' : 'รอตรวจสอบ'
                    }`
                  : 'ยังไม่มี'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {selectedSlip ? (
        <View style={styles.slipBox}>
          {!selectedSlip.employee_confirmed_at ? (
            <View style={styles.reviewNotice}>
              <Text style={styles.reviewNoticeTitle}>
                {selectedSlip.reissued_from_slip_id
                  ? 'มีสลิปฉบับแก้ไข กรุณาตรวจสอบอีกครั้ง'
                  : 'กรุณาตรวจสอบและยืนยันสลิปเงินเดือน'}
              </Text>
              <Text style={styles.reviewNoticeText}>
                เมื่อรายละเอียดถูกต้อง ให้กดปุ่มยืนยันเพื่อแจ้ง Admin/HR ว่าคุณตรวจสอบเงินเดือนรอบนี้แล้ว
              </Text>
            </View>
          ) : (
            <View style={styles.reviewConfirmedBox}>
              <Text style={styles.reviewConfirmedText}>
                ยืนยันตรวจสอบแล้ว · {formatDateTimeTh(selectedSlip.employee_confirmed_at)}
              </Text>
            </View>
          )}
          <Text style={styles.period}>
            {formatPayrollPeriodRangeTh(selectedSlip.period_start, selectedSlip.period_end)}
          </Text>
          <Text style={styles.netPay}>
            เงินสุทธิ {money(Number(selectedSlip.net_pay || 0))} บาท
          </Text>
          <Text style={styles.summary}>
            รายได้ {money(Number(selectedSlip.income_total || 0))} · เงินคืน{' '}
            {money(Number(selectedSlip.reimbursement_total || 0))} · รายการหัก{' '}
            {money(Number(selectedSlip.deduction_total || 0))}
          </Text>
          <Pressable
            style={[styles.pdfBtn, exportingPdf && styles.disabled]}
            disabled={exportingPdf}
            onPress={() => void printSelectedSlip()}>
            {exportingPdf ? (
              <ActivityIndicator color={c.primaryDark} />
            ) : (
              <Text style={styles.pdfBtnText}>พิมพ์ / ดาวน์โหลด PDF</Text>
            )}
          </Pressable>
          {!selectedSlip.employee_confirmed_at ? (
            <Pressable
              style={[styles.confirmReviewBtn, confirmingReview && styles.disabled]}
              disabled={confirmingReview}
              onPress={() => void confirmSelectedSlipReview()}>
              {confirmingReview ? (
                <ActivityIndicator color={c.canvas} />
              ) : (
                <Text style={styles.confirmReviewText}>ยืนยันตรวจสอบเงินเดือน</Text>
              )}
            </Pressable>
          ) : null}
          <PayslipItemGroup title="รายได้" rows={grouped.income} />
          <PayslipItemGroup title="รายการหัก" rows={grouped.deduction} />
          <PayslipItemGroup title="เงินคืน/เบิกจ่าย" rows={grouped.reimbursement} />
        </View>
      ) : (
        <Text style={styles.empty}>
          ยังไม่มีสลิปเงินเดือนที่ยืนยันแล้วในรอบ {formatPayrollCycleChipTh(selectedCycleKey)}
        </Text>
      )}
    </View>
  );
}

function PayslipItemGroup({ title, rows }: { title: string; rows: PayrollItemRow[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {rows.map((row) => (
        <View key={row.id} style={styles.itemRow}>
          <Text style={styles.itemLabel}>{row.label}</Text>
          <Text style={styles.itemAmount}>{money(Number(row.amount || 0))}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 14,
    padding: 14,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: c.text },
  sub: { marginTop: 3, color: c.textMuted, fontSize: 12, lineHeight: 17 },
  empty: {
    padding: 12,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    color: c.textMuted,
    textAlign: 'center',
    fontSize: 12,
  },
  disabled: { opacity: 0.6 },
  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: {
    minWidth: 148,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: r.md,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  chipOn: { backgroundColor: c.primaryLight, borderColor: c.primaryMuted },
  chipDisabled: { opacity: 0.72 },
  chipText: { color: c.textSecondary, fontWeight: '800', fontSize: 13 },
  chipTextOn: { color: c.primaryDark },
  chipSubText: { color: c.textMuted, fontSize: 10, marginTop: 3 },
  chipSubTextOn: { color: c.text },
  chipStatus: { color: c.textMuted, fontSize: 10, marginTop: 5, fontWeight: '800' },
  slipBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  pdfBtn: {
    marginTop: 12,
    borderRadius: r.sm,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pdfBtnText: { color: c.primaryDark, fontSize: 12, fontWeight: '900' },
  reviewNotice: {
    marginBottom: 10,
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.warningBg,
    borderWidth: 1,
    borderColor: c.warningBorder,
  },
  reviewNoticeTitle: { color: c.warningTitle, fontSize: 13, fontWeight: '900' },
  reviewNoticeText: { marginTop: 4, color: c.warningBody, fontSize: 11, lineHeight: 16 },
  reviewConfirmedBox: {
    marginBottom: 10,
    padding: 9,
    borderRadius: r.md,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
  },
  reviewConfirmedText: { color: c.primaryDark, fontSize: 12, fontWeight: '900' },
  confirmReviewBtn: {
    marginTop: 8,
    borderRadius: r.sm,
    backgroundColor: c.primary,
    paddingVertical: 11,
    alignItems: 'center',
  },
  confirmReviewText: { color: c.canvas, fontSize: 12, fontWeight: '900' },
  period: { color: c.textSecondary, fontWeight: '700', fontSize: 13 },
  netPay: { marginTop: 5, color: c.primaryDark, fontWeight: '900', fontSize: 18 },
  summary: { marginTop: 4, color: c.textMuted, fontSize: 12, lineHeight: 18 },
  group: { marginTop: 12, gap: 6 },
  groupTitle: { color: c.textSecondary, fontSize: 13, fontWeight: '800' },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  itemLabel: { flex: 1, minWidth: 0, color: c.text, fontSize: 12 },
  itemAmount: { color: c.textSecondary, fontSize: 12, fontWeight: '800' },
});
