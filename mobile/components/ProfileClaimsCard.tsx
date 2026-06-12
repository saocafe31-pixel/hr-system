import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { NatureTheme } from '@/constants/Theme';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { pickAndUploadExpenseEvidence } from '@/lib/uploadExpenseEvidence';
import { supabase } from '@/lib/supabase';
import type {
  EmployeeDirectory,
  ExpenseClaimItemRow,
  ExpenseClaimRow,
  Profile,
  SalaryClaimRow,
} from '@/lib/types';

type ExpenseDraft = {
  key: string;
  title: string;
  amount: string;
  note: string;
  evidenceUrl: string | null;
  evidenceName: string | null;
};

type Props = {
  userId: string | null;
  profile: Profile | null;
  myHr: EmployeeDirectory | null;
  onSubmitted?: () => void;
};

function newExpenseDraft(): ExpenseDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    amount: '',
    note: '',
    evidenceUrl: null,
    evidenceName: null,
  };
}

function money(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currentClaimMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function claimStatusLabelTh(status: SalaryClaimRow['status']): string {
  if (status === 'approved') return 'อนุมัติแล้ว';
  if (status === 'rejected') return 'ปฏิเสธแล้ว';
  if (status === 'paid') return 'จ่ายแล้ว';
  return 'รอดำเนินการ';
}

function expensePayrollHandlingLabelTh(
  handling: ExpenseClaimRow['payroll_handling'] | null | undefined
): string {
  if (handling === 'payroll') return 'ลง Payroll / สลิปเงินเดือน';
  if (handling === 'direct') return 'จ่ายแยก ไม่ลงเงินเดือน';
  return 'รอผู้อนุมัติเลือกวิธีจ่าย';
}

function formatDateTimeTh(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ProfileClaimsCard({ userId, profile, myHr, onSubmitted }: Props) {
  const toast = useCuteToast();
  const [salaryBase, setSalaryBase] = useState('');
  const [salaryAmount, setSalaryAmount] = useState('');
  const [salaryNote, setSalaryNote] = useState('');
  const [salarySaving, setSalarySaving] = useState(false);
  const [salaryHistory, setSalaryHistory] = useState<SalaryClaimRow[]>([]);

  const [expenseRows, setExpenseRows] = useState<ExpenseDraft[]>([newExpenseDraft()]);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [expenseHistory, setExpenseHistory] = useState<ExpenseClaimRow[]>([]);
  const [expenseHistoryItems, setExpenseHistoryItems] = useState<ExpenseClaimItemRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const today = new Date();
  const day = today.getDate();
  const salaryWindowOpen = day >= 10 && day <= 14;

  const baseSalaryNum = Number(salaryBase || 0);
  const halfBase = Number.isFinite(baseSalaryNum) && baseSalaryNum > 0 ? baseSalaryNum * 0.5 : 0;
  const salaryCeiling = halfBase * 0.7;

  const payoutIdentity = useMemo(
    () => ({
      full_name: myHr?.name || myHr?.surname ? `${myHr?.name ?? ''} ${myHr?.surname ?? ''}`.trim() : profile?.full_name,
      bank_name: myHr?.bank ?? null,
      account_number: myHr?.account_number ?? null,
      branch_name: myHr?.branch ?? null,
      branch_id: myHr?.branch_id ?? profile?.branch_id ?? null,
      employee_id: profile?.employee_id ?? myHr?.id ?? null,
    }),
    [myHr, profile]
  );

  const expenseItemsByClaimId = useMemo(() => {
    const map = new Map<string, ExpenseClaimItemRow[]>();
    for (const item of expenseHistoryItems) {
      const arr = map.get(item.expense_claim_id) ?? [];
      arr.push(item);
      map.set(item.expense_claim_id, arr);
    }
    return map;
  }, [expenseHistoryItems]);

  const loadHistory = useCallback(async () => {
    if (!userId) {
      setSalaryHistory([]);
      setExpenseHistory([]);
      setExpenseHistoryItems([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const [salaryRes, expenseRes] = await Promise.all([
        supabase
          .from('salary_claims')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('expense_claims')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      if (salaryRes.error) throw salaryRes.error;
      if (expenseRes.error) throw expenseRes.error;
      const expenseRowsHistory = (expenseRes.data as ExpenseClaimRow[]) ?? [];
      setSalaryHistory((salaryRes.data as SalaryClaimRow[]) ?? []);
      setExpenseHistory(expenseRowsHistory);

      const expenseIds = expenseRowsHistory.map((row) => row.id).filter(Boolean);
      if (expenseIds.length === 0) {
        setExpenseHistoryItems([]);
        return;
      }
      const { data: itemRows, error: itemErr } = await supabase
        .from('expense_claim_items')
        .select('*')
        .in('expense_claim_id', expenseIds)
        .order('created_at', { ascending: true });
      if (itemErr) throw itemErr;
      setExpenseHistoryItems((itemRows as ExpenseClaimItemRow[]) ?? []);
    } catch (e) {
      toast.error('โหลดประวัติการเบิกไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }, [toast, userId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function notifyAdminsForNewClaim(
    kind: 'salary' | 'expense',
    claimId: string,
    amount: number
  ) {
    if (!userId) return;
    const { data: adminRows } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin');
    const adminIds = ((adminRows as { id: string }[] | null) ?? [])
      .map((r) => r.id)
      .filter(Boolean);
    if (adminIds.length === 0) return;
    const who = payoutIdentity.full_name || profile?.email || 'พนักงาน';
    const body =
      kind === 'salary'
        ? `${who} ส่งคำขอเบิกเงินเดือน ${money(amount)} บาท`
        : `${who} ส่งคำขอเบิกค่าใช้จ่าย ${money(amount)} บาท`;
    await supabase.from('finance_claim_notifications').insert(
      adminIds.map((recipientId) => ({
        recipient_id: recipientId,
        actor_id: userId,
        claim_kind: kind,
        claim_id: claimId,
        event_type: 'submitted',
        status: 'pending',
        body,
      }))
    );
  }

  async function submitSalaryClaim() {
    if (!userId) return;
    if (!salaryWindowOpen) {
      toast.info('เบิกเงินเดือน', 'เบิกได้เฉพาะวันที่ 10-14 ของเดือน');
      return;
    }
    if (!Number.isFinite(baseSalaryNum) || baseSalaryNum <= 0) {
      toast.info('ฐานเงินเดือน', 'กรอกฐานเงินเดือนให้ถูกต้อง');
      return;
    }
    const ask = Number(salaryAmount || 0);
    if (!Number.isFinite(ask) || ask <= 0) {
      toast.info('ยอดเบิก', 'กรอกยอดที่ต้องการเบิกให้ถูกต้อง');
      return;
    }
    if (ask > salaryCeiling) {
      toast.info('ยอดเกินวงเงิน', `ยอดสูงสุดคือ ${money(salaryCeiling)} บาท`);
      return;
    }
    setSalarySaving(true);
    const { data, error } = await supabase
      .from('salary_claims')
      .insert({
        user_id: userId,
        employee_id: payoutIdentity.employee_id,
        claim_month: currentClaimMonth(),
        base_salary: baseSalaryNum,
        eligible_base_amount: halfBase,
        max_claim_amount: salaryCeiling,
        requested_amount: ask,
        full_name: payoutIdentity.full_name ?? null,
        bank_name: payoutIdentity.bank_name,
        account_number: payoutIdentity.account_number,
        branch_name: payoutIdentity.branch_name,
        branch_id: payoutIdentity.branch_id,
        note: salaryNote.trim() || null,
      })
      .select('id, requested_amount')
      .single();
    setSalarySaving(false);
    if (error) {
      toast.error('ส่งคำขอไม่สำเร็จ', error.message);
      return;
    }
    setSalaryAmount('');
    setSalaryNote('');
    if (data?.id) {
      await notifyAdminsForNewClaim('salary', data.id, Number(data.requested_amount ?? ask));
    }
    toast.success('ส่งคำขอเบิกเงินเดือนแล้ว', 'ส่งเข้าหน้าแอดมินเรียบร้อย');
    await loadHistory();
    onSubmitted?.();
  }

  async function uploadEvidence(rowKey: string) {
    if (!userId) return;
    setUploadingKey(rowKey);
    try {
      const uploaded = await pickAndUploadExpenseEvidence(userId);
      setExpenseRows((prev) =>
        prev.map((row) =>
          row.key === rowKey
            ? { ...row, evidenceUrl: uploaded.url, evidenceName: uploaded.fileName }
            : row
        )
      );
      toast.success('แนบหลักฐานแล้ว', uploaded.fileName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ';
      if (msg !== 'ยกเลิกการเลือกไฟล์') {
        toast.error('แนบหลักฐานไม่สำเร็จ', msg);
      }
    } finally {
      setUploadingKey(null);
    }
  }

  async function submitExpenseClaim() {
    if (!userId) return;
    const normalized = expenseRows.map((row) => ({
      ...row,
      amountNum: Number(row.amount || 0),
      titleText: row.title.trim(),
      noteText: row.note.trim(),
    }));
    if (normalized.length === 0) {
      toast.info('รายการเบิก', 'เพิ่มรายการอย่างน้อย 1 รายการ');
      return;
    }
    for (const row of normalized) {
      if (!row.titleText) {
        toast.info('รายการเบิก', 'กรุณากรอกชื่อรายการให้ครบ');
        return;
      }
      if (!Number.isFinite(row.amountNum) || row.amountNum <= 0) {
        toast.info('จำนวนเงิน', 'กรุณากรอกจำนวนเงินให้ถูกต้อง');
        return;
      }
      if (!row.evidenceUrl) {
        toast.info('หลักฐานการเบิก', 'แต่ละรายการต้องแนบหลักฐาน');
        return;
      }
    }
    const total = normalized.reduce((sum, row) => sum + row.amountNum, 0);
    setExpenseSaving(true);
    const { data: claimData, error: claimErr } = await supabase
      .from('expense_claims')
      .insert({
        user_id: userId,
        employee_id: payoutIdentity.employee_id,
        full_name: payoutIdentity.full_name ?? null,
        bank_name: payoutIdentity.bank_name,
        account_number: payoutIdentity.account_number,
        branch_name: payoutIdentity.branch_name,
        branch_id: payoutIdentity.branch_id,
        total_amount: total,
      })
      .select('id')
      .single();
    if (claimErr || !claimData?.id) {
      setExpenseSaving(false);
      toast.error('ส่งคำขอไม่สำเร็จ', claimErr?.message ?? 'ไม่พบรหัสคำขอ');
      return;
    }
    const { error: itemErr } = await supabase.from('expense_claim_items').insert(
      normalized.map((row) => ({
        expense_claim_id: claimData.id,
        item_title: row.titleText,
        amount: row.amountNum,
        note: row.noteText || null,
        evidence_url: row.evidenceUrl,
        evidence_name: row.evidenceName,
      }))
    );
    setExpenseSaving(false);
    if (itemErr) {
      toast.error('บันทึกรายการไม่สำเร็จ', itemErr.message);
      return;
    }
    await notifyAdminsForNewClaim('expense', claimData.id, total);
    setExpenseRows([newExpenseDraft()]);
    toast.success('ส่งคำขอเบิกค่าใช้จ่ายแล้ว', 'ระบบส่งรายการแยกแถวเข้าแอดมินแล้ว');
    await loadHistory();
    onSubmitted?.();
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.claimSectionCard}>
        <Text style={styles.sectionTitle}>เบิกเงินเดือน (Claim Salary)</Text>
        <Text style={styles.hint}>
          เบิกได้วันที่ 10-14 เท่านั้น · ยอดสูงสุด = 70% ของ 50% ฐานเงินเดือน
        </Text>
        <Text style={styles.hint}>
          วันนี้วันที่ {day} · สถานะ {salaryWindowOpen ? 'เปิดให้เบิก' : 'ยังไม่อยู่ในช่วงเบิก'}
        </Text>
        <TextInput
          style={styles.input}
          value={salaryBase}
          onChangeText={setSalaryBase}
          keyboardType="decimal-pad"
          placeholder="ฐานเงินเดือน (บาท)"
        />
        <Text style={styles.small}>
          50% ของฐานเงินเดือน: {money(halfBase)} บาท · เบิกได้สูงสุด: {money(salaryCeiling)} บาท
        </Text>
        <TextInput
          style={styles.input}
          value={salaryAmount}
          onChangeText={setSalaryAmount}
          keyboardType="decimal-pad"
          placeholder="ยอดที่ต้องการเบิก"
        />
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => setSalaryAmount(salaryCeiling > 0 ? salaryCeiling.toFixed(2) : '')}>
          <Text style={styles.secondaryBtnText}>เบิกเต็มจำนวน</Text>
        </Pressable>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={salaryNote}
          onChangeText={setSalaryNote}
          placeholder="หมายเหตุ (ไม่บังคับ)"
          multiline
        />
        <Pressable
          style={[styles.primaryBtn, (salarySaving || !salaryWindowOpen) && styles.disabled]}
          disabled={salarySaving || !salaryWindowOpen}
          onPress={() => void submitSalaryClaim()}>
          {salarySaving ? (
            <ActivityIndicator color={NatureTheme.colors.onAccent} />
          ) : (
            <Text style={styles.primaryBtnText}>ส่งคำขอเบิกเงินเดือน</Text>
          )}
        </Pressable>

        <View style={styles.historyHeaderRow}>
          <Text style={styles.historyTitle}>ประวัติเบิกเงินเดือน (Claim Salary)</Text>
          <Pressable
            style={[styles.refreshBtn, historyLoading && styles.disabled]}
            disabled={historyLoading}
            onPress={() => void loadHistory()}>
            <Text style={styles.refreshBtnText}>{historyLoading ? 'กำลังโหลด...' : 'รีเฟรช'}</Text>
          </Pressable>
        </View>
        {historyLoading && salaryHistory.length === 0 ? (
          <ActivityIndicator color={c.primary} />
        ) : salaryHistory.length === 0 ? (
          <Text style={styles.emptyText}>ยังไม่มีประวัติเบิกเงินเดือน</Text>
        ) : (
          salaryHistory.map((row) => (
            <View key={row.id} style={styles.historyCard}>
              <View style={styles.historyCardTop}>
                <Text style={styles.historyAmount}>{money(Number(row.requested_amount || 0))} บาท</Text>
                <Text style={[styles.statusPill, statusPillToneStyle(row.status)]}>
                  {claimStatusLabelTh(row.status)}
                </Text>
              </View>
              <Text style={styles.historyMeta}>เดือนที่ขอเบิก: {String(row.claim_month).slice(0, 10)}</Text>
              <Text style={styles.historyMeta}>ส่งคำขอ: {formatDateTimeTh(row.created_at)}</Text>
              <Text style={styles.historyMeta}>วงเงินสูงสุด: {money(Number(row.max_claim_amount || 0))} บาท</Text>
              {row.note ? <Text style={styles.historyNote}>หมายเหตุของฉัน: {row.note}</Text> : null}
              {row.review_note ? (
                <Text style={styles.historyNote}>ผลตรวจ/หมายเหตุแอดมิน: {row.review_note}</Text>
              ) : null}
              {row.reviewed_at ? (
                <Text style={styles.historyMeta}>ตรวจเมื่อ: {formatDateTimeTh(row.reviewed_at)}</Text>
              ) : null}
            </View>
          ))
        )}
      </View>

      <View style={styles.claimSectionCard}>
        <Text style={styles.sectionTitle}>เบิกเงิน (Expense Claim)</Text>
        <Text style={styles.hint}>
          เพิ่มได้หลายรายการ และแต่ละรายการต้องมีหลักฐานรูป/ไฟล์
        </Text>
        {expenseRows.map((row, idx) => (
          <View key={row.key} style={styles.itemCard}>
            <Text style={styles.itemTitle}>รายการที่ {idx + 1}</Text>
            <TextInput
              style={styles.input}
              value={row.title}
              onChangeText={(v) =>
                setExpenseRows((prev) =>
                  prev.map((it) => (it.key === row.key ? { ...it, title: v } : it))
                )
              }
              placeholder="รายการเบิก"
            />
            <TextInput
              style={styles.input}
              value={row.amount}
              onChangeText={(v) =>
                setExpenseRows((prev) =>
                  prev.map((it) => (it.key === row.key ? { ...it, amount: v } : it))
                )
              }
              keyboardType="decimal-pad"
              placeholder="จำนวนเงิน (บาท)"
            />
            <TextInput
              style={[styles.input, styles.textarea]}
              value={row.note}
              onChangeText={(v) =>
                setExpenseRows((prev) =>
                  prev.map((it) => (it.key === row.key ? { ...it, note: v } : it))
                )
              }
              placeholder="หมายเหตุ (ไม่บังคับ)"
              multiline
            />
            <Pressable
              style={[styles.secondaryBtn, uploadingKey === row.key && styles.disabled]}
              disabled={uploadingKey === row.key}
              onPress={() => void uploadEvidence(row.key)}>
              <Text style={styles.secondaryBtnText}>
                {uploadingKey === row.key ? 'กำลังอัปโหลด...' : 'แนบหลักฐาน'}
              </Text>
            </Pressable>
            <Text style={styles.small}>
              {row.evidenceName ? `ไฟล์: ${row.evidenceName}` : 'ยังไม่ได้แนบหลักฐาน'}
            </Text>
            {expenseRows.length > 1 ? (
              <Pressable
                style={styles.removeBtn}
                onPress={() =>
                  setExpenseRows((prev) => prev.filter((it) => it.key !== row.key))
                }>
                <Text style={styles.removeBtnText}>ลบรายการนี้</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => setExpenseRows((prev) => [...prev, newExpenseDraft()])}>
          <Text style={styles.secondaryBtnText}>+ เพิ่มรายการเบิก</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryBtn, expenseSaving && styles.disabled]}
          disabled={expenseSaving}
          onPress={() => void submitExpenseClaim()}>
          {expenseSaving ? (
            <ActivityIndicator color={NatureTheme.colors.onAccent} />
          ) : (
            <Text style={styles.primaryBtnText}>ส่งคำขอเบิกค่าใช้จ่าย</Text>
          )}
        </Pressable>

        <View style={styles.historyHeaderRow}>
          <Text style={styles.historyTitle}>ประวัติเบิกเงิน (Expense Claim)</Text>
          <Pressable
            style={[styles.refreshBtn, historyLoading && styles.disabled]}
            disabled={historyLoading}
            onPress={() => void loadHistory()}>
            <Text style={styles.refreshBtnText}>{historyLoading ? 'กำลังโหลด...' : 'รีเฟรช'}</Text>
          </Pressable>
        </View>
        {historyLoading && expenseHistory.length === 0 ? (
          <ActivityIndicator color={c.primary} />
        ) : expenseHistory.length === 0 ? (
          <Text style={styles.emptyText}>ยังไม่มีประวัติเบิกเงินค่าใช้จ่าย</Text>
        ) : (
          expenseHistory.map((claim) => {
          const items = expenseItemsByClaimId.get(claim.id) ?? [];
          return (
            <View key={claim.id} style={styles.historyCard}>
              <View style={styles.historyCardTop}>
                <Text style={styles.historyAmount}>{money(Number(claim.total_amount || 0))} บาท</Text>
                <Text style={[styles.statusPill, statusPillToneStyle(claim.status)]}>
                  {claimStatusLabelTh(claim.status)}
                </Text>
              </View>
              <Text style={styles.historyMeta}>ส่งคำขอ: {formatDateTimeTh(claim.created_at)}</Text>
              <Text style={styles.historyMeta}>
                วิธีจ่าย: {expensePayrollHandlingLabelTh(claim.payroll_handling)}
              </Text>
              {claim.review_note ? (
                <Text style={styles.historyNote}>ผลตรวจ/หมายเหตุแอดมิน: {claim.review_note}</Text>
              ) : null}
              {claim.reviewed_at ? (
                <Text style={styles.historyMeta}>ตรวจเมื่อ: {formatDateTimeTh(claim.reviewed_at)}</Text>
              ) : null}
              {items.length > 0 ? (
                <View style={styles.historyItemList}>
                  {items.map((item, idx) => (
                    <View key={item.id} style={styles.historyItemRow}>
                      <Text style={styles.historyItemTitle}>
                        {idx + 1}. {item.item_title} · {money(Number(item.amount || 0))} บาท
                      </Text>
                      {item.note ? <Text style={styles.historyMeta}>หมายเหตุ: {item.note}</Text> : null}
                      {item.evidence_name ? (
                        <Text style={styles.historyMeta}>หลักฐาน: {item.evidence_name}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
          })
        )}
      </View>
    </View>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;

const styles = StyleSheet.create({
  wrap: {
    marginTop: 18,
    padding: 12,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
    gap: 12,
  },
  claimSectionCard: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.lg,
    padding: 12,
    backgroundColor: c.surfaceElevated,
    gap: 8,
  },
  sectionTitle: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: '800',
    color: c.text,
  },
  hint: {
    fontSize: 12,
    color: c.textMuted,
  },
  small: { fontSize: 12, color: c.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 10,
    backgroundColor: c.surface,
    color: c.text,
  },
  textarea: { minHeight: 64, textAlignVertical: 'top' },
  primaryBtn: {
    marginTop: 4,
    backgroundColor: c.primary,
    borderRadius: r.sm,
    alignItems: 'center',
    paddingVertical: 11,
  },
  primaryBtnText: { color: c.onAccent, fontWeight: '700' },
  secondaryBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: c.primaryMuted,
    borderRadius: r.sm,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: c.surfaceElevated,
  },
  secondaryBtnText: { color: c.primaryDark, fontWeight: '700' },
  itemCard: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    padding: 10,
    gap: 8,
    backgroundColor: c.surfaceMuted,
  },
  itemTitle: { fontWeight: '700', color: c.text },
  removeBtn: { alignSelf: 'flex-start', paddingVertical: 2 },
  removeBtnText: { color: c.error, fontWeight: '700', fontSize: 12 },
  historyHeaderRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  refreshBtn: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: c.surfaceElevated,
  },
  refreshBtnText: { color: c.primaryDark, fontSize: 12, fontWeight: '800' },
  historyTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: c.text,
  },
  emptyText: {
    paddingVertical: 8,
    color: c.textMuted,
    fontSize: 12,
  },
  historyCard: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.md,
    padding: 11,
    backgroundColor: c.surface,
    gap: 4,
  },
  historyCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  historyAmount: {
    flex: 1,
    minWidth: 0,
    color: c.text,
    fontSize: 15,
    fontWeight: '900',
  },
  statusPill: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
    fontSize: 11,
    fontWeight: '900',
  },
  status_pending: {
    backgroundColor: c.warningBg,
    color: c.warningTitle,
  },
  status_approved: {
    backgroundColor: c.primaryLight,
    color: c.primaryDark,
  },
  status_rejected: {
    backgroundColor: c.errorBg,
    color: c.error,
  },
  status_paid: {
    backgroundColor: c.linkLight,
    color: c.link,
  },
  historyMeta: {
    color: c.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  historyNote: {
    marginTop: 3,
    color: c.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  historyItemList: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
    paddingTop: 6,
    gap: 6,
  },
  historyItemRow: {
    gap: 2,
  },
  historyItemTitle: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  disabled: { opacity: 0.65 },
});

function statusPillToneStyle(status: SalaryClaimRow['status']) {
  if (status === 'approved') return styles.status_approved;
  if (status === 'rejected') return styles.status_rejected;
  if (status === 'paid') return styles.status_paid;
  return styles.status_pending;
}
