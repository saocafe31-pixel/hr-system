import { useMemo, useState } from 'react';
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
import type { EmployeeDirectory, Profile } from '@/lib/types';

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

export function ProfileClaimsCard({ userId, profile, myHr, onSubmitted }: Props) {
  const toast = useCuteToast();
  const [salaryBase, setSalaryBase] = useState('');
  const [salaryAmount, setSalaryAmount] = useState('');
  const [salaryNote, setSalaryNote] = useState('');
  const [salarySaving, setSalarySaving] = useState(false);

  const [expenseRows, setExpenseRows] = useState<ExpenseDraft[]>([newExpenseDraft()]);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

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
    onSubmitted?.();
  }

  return (
    <View style={styles.wrap}>
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
    backgroundColor: c.surfaceElevated,
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
    backgroundColor: c.canvas,
  },
  itemTitle: { fontWeight: '700', color: c.text },
  removeBtn: { alignSelf: 'flex-start', paddingVertical: 2 },
  removeBtnText: { color: c.error, fontWeight: '700', fontSize: 12 },
  disabled: { opacity: 0.65 },
});
