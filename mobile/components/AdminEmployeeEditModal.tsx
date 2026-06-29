import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { AppTheme } from '@/constants/Theme';
import { FriendlyNoticeModal } from '@/components/FriendlyNoticeModal';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { type EmployeeHrForm } from '@/lib/employeeTableUpdate';
import { adminUpdateEmployeeHr } from '@/lib/adminUpdateEmployeeHr';
import { adminResetUserPassword } from '@/lib/adminResetUserPassword';
import { resolveProfileUserIdForLeave } from '@/lib/adminProfileResolveForEmployee';
import {
  currentYearBangkok,
  PERSONAL_ANNUAL_DAYS,
  SICK_ANNUAL_DAYS,
  sumLeaveDaysInYear,
} from '@/lib/leaveLateRules';
import { supabase } from '@/lib/supabase';
import type {
  AdminEmployeePasswordRow,
  Branch,
  EmployeeDirectory,
  Profile,
  UserRole,
} from '@/lib/types';

const CREATE_ROLES: UserRole[] = ['employee', 'manager', 'admin'];
const ROLE_CHIPS: UserRole[] = ['employee', 'manager', 'admin'];

function branchLabel(branch: Branch): string {
  const code = branch.branch_code?.trim();
  const name = branch.branch_name?.trim();
  if (name && code) return `${name} (${code})`;
  return name || code || `สาขา #${branch.id}`;
}

function hrFormToDirectoryStub(
  f: EmployeeHrForm,
  empId: string
): EmployeeDirectory {
  const idNum = f.employee_no.trim() ? parseInt(f.employee_no.trim(), 10) : null;
  return {
    id: empId,
    legacy_user_id: f.legacy_user_id.trim() || null,
    employee_no: idNum !== null && !Number.isNaN(idNum) ? idNum : null,
    prefix: f.prefix || null,
    name: f.name || null,
    surname: f.surname || null,
    nickname: f.nickname || null,
    position: f.position || null,
    branch: f.branch || null,
    branch_id: f.branch_id,
    phone: f.phone || null,
    start_date: f.start_date || null,
    national_id: f.national_id || null,
    address_id_card: f.address_id_card || null,
    current_address: f.current_address || null,
    bank: f.bank || null,
    account_number: f.account_number || null,
    status: f.status || null,
  };
}

const emptyHr = (): EmployeeHrForm => ({
  legacy_user_id: '',
  employee_no: '',
  prefix: '',
  name: '',
  surname: '',
  nickname: '',
  position: '',
  branch: '',
  branch_id: null,
  phone: '',
  start_date: '',
  national_id: '',
  address_id_card: '',
  current_address: '',
  bank: '',
  account_number: '',
  status: '',
});

function directoryToForm(d: EmployeeDirectory): EmployeeHrForm {
  return {
    legacy_user_id: d.legacy_user_id ?? '',
    employee_no: d.employee_no != null ? String(d.employee_no) : '',
    prefix: d.prefix ?? '',
    name: d.name ?? '',
    surname: d.surname ?? '',
    nickname: d.nickname ?? '',
    position: d.position ?? '',
    branch: d.branch ?? '',
    branch_id:
      d.branch_id != null && !Number.isNaN(Number(d.branch_id))
        ? Number(d.branch_id)
        : null,
    phone: d.phone ?? '',
    start_date: d.start_date ?? '',
    national_id: d.national_id ?? '',
    address_id_card: d.address_id_card ?? '',
    current_address: d.current_address ?? '',
    bank: d.bank ?? '',
    account_number: d.account_number ?? '',
    status: d.status ?? '',
  };
}

async function fetchEmployeeDirectoryRow(
  employeeId: string
): Promise<EmployeeDirectory | null> {
  const { data, error } = await supabase.rpc('admin_get_employee_directory_row', {
    p_id: employeeId,
  });
  if (error) throw new Error(error.message);
  const raw = data as unknown;
  const rows: EmployeeDirectory[] = Array.isArray(raw)
    ? (raw as EmployeeDirectory[])
    : raw != null
      ? [raw as EmployeeDirectory]
      : [];
  return rows[0] ?? null;
}

export const ADMIN_NEW_EMPLOYEE_ID = '__new__';
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
  employeeId: string | null;
  preview: AdminEmployeePasswordRow | null;
  branches: Branch[];
  /** รายชื่อ profiles ทั้งหมด (บทบาท + เชื่อม HR + เลือกบัญชีในโมดัล) */
  allProfiles: Profile[];
  onClose: () => void;
  onSaved: () => void;
};

export function AdminEmployeeEditModal({
  visible,
  employeeId,
  preview,
  branches,
  allProfiles,
  onClose,
  onSaved,
}: Props) {
  const toast = useCuteToast();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const styles = useMemo(() => createAdminEmployeeEditStyles(theme), [theme]);
  const [hr, setHr] = useState<EmployeeHrForm>(emptyHr);
  const [loading, setLoading] = useState(false);
  const [savingLoginPw, setSavingLoginPw] = useState(false);
  const [savingHr, setSavingHr] = useState(false);
  const [savingLeaveBalance, setSavingLeaveBalance] = useState(false);
  const [loginPw1, setLoginPw1] = useState('');
  const [loginPw2, setLoginPw2] = useState('');
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [usedSick, setUsedSick] = useState(0);
  const [usedPersonal, setUsedPersonal] = useState(0);
  const [usedVacation, setUsedVacation] = useState(0);
  const [remainSick, setRemainSick] = useState('');
  const [remainPersonal, setRemainPersonal] = useState('');
  const [remainVacation, setRemainVacation] = useState('');
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error' | 'info';
    title: string;
    message?: string;
  } | null>(null);

  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createPassword2, setCreatePassword2] = useState('');
  const [createFullName, setCreateFullName] = useState('');
  const [createRole, setCreateRole] = useState<UserRole>('employee');
  const [grantYear, setGrantYear] = useState(() => String(currentYearBangkok()));
  const [profilePickerVisible, setProfilePickerVisible] = useState(false);
  const [linkPickSaving, setLinkPickSaving] = useState(false);
  const [savingRole, setSavingRole] = useState(false);

  const isCreate = employeeId === ADMIN_NEW_EMPLOYEE_ID;

  const linkedProfile = useMemo(
    () =>
      targetUserId
        ? allProfiles.find((p) => p.id === targetUserId) ?? null
        : null,
    [allProfiles, targetUserId]
  );

  const sortedProfilesPicker = useMemo(() => {
    if (!employeeId || isCreate) return [];
    const eid = String(employeeId).trim();
    return [...allProfiles].sort((a, b) => {
      const aEmp = (a.employee_id ?? '').trim();
      const bEmp = (b.employee_id ?? '').trim();
      const aHere = aEmp === eid;
      const bHere = bEmp === eid;
      if (aHere !== bHere) return aHere ? -1 : 1;
      const aUn = !aEmp;
      const bUn = !bEmp;
      if (aUn !== bUn) return aUn ? -1 : 1;
      return (a.full_name || a.email || '').localeCompare(
        b.full_name || b.email || ''
      );
    });
  }, [allProfiles, employeeId, isCreate]);

  const loadLeaveAndGrants = useCallback(
    async (uid: string | null, year: number) => {
      if (!uid) {
        setUsedSick(0);
        setUsedPersonal(0);
        setUsedVacation(0);
        setRemainSick('');
        setRemainPersonal('');
        setRemainVacation('');
        return;
      }
      const yStart = `${year}-01-01`;
      const yEnd = `${year}-12-31`;
      const [lrRes, vgRes] = await Promise.all([
        supabase
          .from('leave_requests')
          .select('leave_type, starts_on, ends_on, status')
          .eq('user_id', uid)
          .lte('starts_on', yEnd)
          .gte('ends_on', yStart),
        supabase
          .from('vacation_grants')
          .select('days_granted, sick_days_granted, personal_days_granted')
          .eq('user_id', uid)
          .eq('year', year)
          .maybeSingle(),
      ]);
      if (lrRes.error) {
        toast.error('โหลดวันลาสะสมไม่สำเร็จ', lrRes.error.message);
      }
      if (vgRes.error) {
        toast.error('โหลดโควตาวันลาไม่สำเร็จ', vgRes.error.message);
      }
      const leaveRows = (lrRes.data ?? []) as Array<{
        leave_type: 'sick' | 'personal' | 'vacation' | 'unpaid';
        starts_on: string;
        ends_on: string;
        status: string;
      }>;
      const sick = sumLeaveDaysInYear(leaveRows, year, 'sick');
      const personal = sumLeaveDaysInYear(leaveRows, year, 'personal');
      const vacation = sumLeaveDaysInYear(leaveRows, year, 'vacation');
      setUsedSick(sick);
      setUsedPersonal(personal);
      setUsedVacation(vacation);
      const grant = (vgRes.data ?? null) as {
        days_granted?: number | null;
        sick_days_granted?: number | null;
        personal_days_granted?: number | null;
      } | null;
      const sickGrant = grant?.sick_days_granted ?? SICK_ANNUAL_DAYS;
      const personalGrant = grant?.personal_days_granted ?? PERSONAL_ANNUAL_DAYS;
      const vacationGrant = grant?.days_granted ?? 0;
      setRemainSick(String(Math.max(0, sickGrant - sick)));
      setRemainPersonal(String(Math.max(0, personalGrant - personal)));
      setRemainVacation(String(Math.max(0, vacationGrant - vacation)));
    },
    [toast]
  );

  useEffect(() => {
    if (!visible || !employeeId) {
      return;
    }
    let cancelled = false;
    setLoginPw1('');
    setLoginPw2('');
    setTargetUserId(null);
    setUsedSick(0);
    setUsedPersonal(0);
    setUsedVacation(0);
    setRemainSick('');
    setRemainPersonal('');
    setRemainVacation('');
    if (isCreate) {
      setHr(emptyHr());
      setCreateEmail('');
      setCreatePassword('');
      setCreatePassword2('');
      setCreateFullName('');
      setCreateRole('employee');
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      // ใช้ RPC (SECURITY DEFINER) แทน employee_directory — view นั้นเป็น security_invoker
      // จึงโดน RLS ของ employee ทำให้แอดมินอ่านแถวของพนักงานคนอื่นไม่ได้ ฟอร์ม HR เลยว่าง
      const { data, error } = await supabase.rpc(
        'admin_get_employee_directory_row',
        { p_id: employeeId }
      );
      if (cancelled) return;
      let hrDirRow: EmployeeDirectory | null = null;
      if (error) {
        toast.error('โหลดข้อมูลไม่สำเร็จ', error.message);
        setHr(emptyHr());
      } else {
        const raw = data as unknown;
        const rows: EmployeeDirectory[] = Array.isArray(raw)
          ? (raw as EmployeeDirectory[])
          : raw != null
            ? [raw as EmployeeDirectory]
            : [];
        const row = rows[0];
        hrDirRow = row ?? null;
        if (row) {
          setHr(directoryToForm(row));
        } else {
          setHr(emptyHr());
          toast.info(
            'ไม่พบข้อมูล HR',
            'ไม่มีแถวพนักงานตาม id นี้ หรือยังไม่ได้รัน migration ฟังก์ชัน admin_get_employee_directory_row ใน Supabase'
          );
        }
      }
      if (!isCreate) {
        const uid = await resolveProfileUserIdForLeave(
          supabase,
          employeeId,
          hrDirRow
        );
        if (cancelled) return;
        setTargetUserId(uid);
        const y = currentYearBangkok();
        setGrantYear(String(y));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, employeeId, isCreate, toast]);

  useEffect(() => {
    if (!visible || !employeeId || isCreate) return;
    const uid = targetUserId;
    const yRaw = Number(grantYear.trim());
    const year =
      Number.isFinite(yRaw) && yRaw >= 2000 && yRaw <= 2100
        ? yRaw
        : currentYearBangkok();
    let cancelled = false;
    void (async () => {
      await loadLeaveAndGrants(uid, year);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [
    visible,
    employeeId,
    isCreate,
    targetUserId,
    grantYear,
    loadLeaveAndGrants,
  ]);

  async function saveLoginPassword() {
    if (!employeeId || isCreate) return;
    if (!targetUserId) {
      toast.info(
        'บัญชีล็อกอิน',
        'เชื่อมบัญชีแอปกับพนักงานคนนี้ก่อน แล้วจึงตั้งรหัสผ่านล็อกอินได้'
      );
      return;
    }
    if (!loginPw1 && !loginPw2) {
      toast.info('รหัสผ่านล็อกอิน', 'กรอกรหัสใหม่หรือยกเลิก');
      return;
    }
    if (loginPw1.length < 6) {
      toast.info('รหัสผ่านล็อกอิน', 'ต้องมีอย่างน้อย 6 ตัวอักษร');
      return;
    }
    if (loginPw1 !== loginPw2) {
      toast.info('รหัสผ่านล็อกอิน', 'ยืนยันรหัสไม่ตรงกัน');
      return;
    }
    setSavingLoginPw(true);
    try {
      await adminResetUserPassword({
        userId: targetUserId,
        employeeId,
        password: loginPw1,
      });
      setLoginPw1('');
      setLoginPw2('');
      toast.success(
        'ตั้งรหัสล็อกอินแล้ว',
        'พนักงานใช้อีเมลที่เชื่อมกับบัญชีนี้และรหัสผ่านใหม่เข้าแอปได้'
      );
    } catch (e) {
      toast.error(
        'ตั้งรหัสล็อกอินไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setSavingLoginPw(false);
    }
  }

  async function saveHr() {
    if (!employeeId) return;
    setSavingHr(true);
    if (isCreate) {
      const email = createEmail.trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setSavingHr(false);
        toast.info('อีเมล', 'กรุณากรอกอีเมลล็อกอินให้ถูกต้อง');
        return;
      }
      if (createPassword.length < 6) {
        setSavingHr(false);
        toast.info('รหัสผ่าน', 'รหัสผ่านล็อกอินต้องมีอย่างน้อย 6 ตัวอักษร');
        return;
      }
      if (createPassword !== createPassword2) {
        setSavingHr(false);
        toast.info('รหัสผ่าน', 'ยืนยันรหัสล็อกอินไม่ตรงกัน');
        return;
      }
      const { data: fnData, error: fnErr } =
        await supabase.functions.invoke<{
          ok?: boolean;
          error?: string;
          message?: string;
          user_id?: string;
          employee_id?: string;
        }>('admin-create-employee', {
          body: {
            email,
            password: createPassword,
            full_name: createFullName.trim() || null,
            role: createRole,
            branch_id: hr.branch_id,
            employee: {
              employee_no: hr.employee_no,
              prefix: hr.prefix,
              name: hr.name,
              surname: hr.surname,
              nickname: hr.nickname,
              position: hr.position,
              branch: hr.branch,
              branch_id: hr.branch_id,
              phone: hr.phone,
              start_date: hr.start_date,
              national_id: hr.national_id,
              address_id_card: hr.address_id_card,
              current_address: hr.current_address,
              bank: hr.bank,
              account_number: hr.account_number,
              status: hr.status,
            },
          },
        });
      setSavingHr(false);
      if (fnErr) {
        const hint =
          fnErr.message?.includes('Failed to fetch') || fnErr.message?.includes('404')
            ? ' ตรวจสอบว่า deploy Edge Function admin-create-employee ใน Supabase แล้ว'
            : '';
        setFeedback({
          variant: 'error',
          title: 'สร้างบัญชีไม่สำเร็จ',
          message: `${fnErr.message ?? 'ไม่ทราบสาเหตุ'}${hint}`,
        });
        return;
      }
      const apiErr = fnData?.error;
      if (apiErr) {
        setFeedback({
          variant: 'error',
          title: 'สร้างพนักงานไม่สำเร็จ',
          message: fnData?.message ?? apiErr,
        });
        return;
      }
      setFeedback({
        variant: 'success',
        title: 'สร้างพนักงานและบัญชีแล้ว',
        message: `UserID ใน HR = อีเมล · UID ${fnData?.user_id?.slice(0, 8) ?? ''}…`,
      });
      onSaved();
      onClose();
      return;
    }
    try {
      await adminUpdateEmployeeHr(employeeId, hr);
    } catch (e) {
      setSavingHr(false);
      setFeedback({
        variant: 'error',
        title: 'บันทึกข้อมูลไม่สำเร็จ',
        message:
          (e instanceof Error ? e.message : String(e)) +
          '\n\nถ้าเห็นข้อความว่าไม่พบฟังก์ชัน ให้รัน migration admin_update_employee_hr ใน Supabase',
      });
      return;
    }
    let profileBranchUpdateMessage = '';
    if (targetUserId) {
      const { error: profileBranchErr } = await supabase
        .from('profiles')
        .update({ branch_id: hr.branch_id })
        .eq('id', targetUserId);
      if (profileBranchErr) {
        profileBranchUpdateMessage =
          '\n\nหมายเหตุ: บันทึก employee แล้ว แต่ยัง sync profiles.branch_id ไม่สำเร็จ: ' +
          profileBranchErr.message;
      }
    }
    try {
      const refreshed = await fetchEmployeeDirectoryRow(employeeId);
      if (refreshed) setHr(directoryToForm(refreshed));
    } catch {
      /* บันทึกสำเร็จแล้ว — โหลดซ้ำไม่ได้ไม่ถือเป็นความล้มเหลว */
    }
    setSavingHr(false);
    setFeedback({
      variant: 'success',
      title: 'อัปเดตข้อมูลพนักงานแล้ว',
      message: `ข้อมูล HR ถูกบันทึกในตาราง employee แล้ว${profileBranchUpdateMessage}`,
    });
    onSaved();
  }

  async function saveLeaveBalance() {
    if (!targetUserId || !employeeId || isCreate) {
      toast.info('ยังผูกบัญชีไม่ได้', 'พนักงานคนนี้ยังไม่เชื่อมกับ profiles');
      return;
    }
    const parse = (v: string) => {
      const n = Number(v.trim());
      return Number.isFinite(n) && n >= 0 ? n : NaN;
    };
    const nextRemainSick = parse(remainSick);
    const nextRemainPersonal = parse(remainPersonal);
    const nextRemainVacation = parse(remainVacation);
    if (
      Number.isNaN(nextRemainSick) ||
      Number.isNaN(nextRemainPersonal) ||
      Number.isNaN(nextRemainVacation)
    ) {
      toast.info('รูปแบบไม่ถูกต้อง', 'กรุณากรอกจำนวนวันคงเหลือเป็นตัวเลขที่ไม่ติดลบ');
      return;
    }
    const sickGrant = usedSick + nextRemainSick;
    const personalGrant = usedPersonal + nextRemainPersonal;
    const vacationGrant = usedVacation + nextRemainVacation;
    const yRaw = Number(grantYear.trim());
    const year =
      Number.isFinite(yRaw) && yRaw >= 2000 && yRaw <= 2100
        ? yRaw
        : currentYearBangkok();
    setSavingLeaveBalance(true);
    const authUser = await supabase.auth.getUser();
    const updatedBy = authUser.data.user?.id ?? null;
    const { error } = await supabase.from('vacation_grants').upsert(
      {
        user_id: targetUserId,
        year,
        days_granted: vacationGrant,
        sick_days_granted: sickGrant,
        personal_days_granted: personalGrant,
        updated_by: updatedBy,
      },
      { onConflict: 'user_id,year' }
    );
    setSavingLeaveBalance(false);
    if (error) {
      setFeedback({
        variant: 'error',
        title: 'บันทึกวันลาคงเหลือไม่สำเร็จ',
        message: error.message,
      });
      return;
    }
    setFeedback({
      variant: 'success',
      title: 'บันทึกวันลาคงเหลือแล้ว',
      message: 'อัปเดตโควตาวันลาของพนักงานเรียบร้อย',
    });
    onSaved();
  }

  async function saveLinkedRole(role: UserRole) {
    if (!targetUserId) {
      toast.info('บทบาท', 'ยังไม่มีบัญชีที่เชื่อม — เลือกบัญชีแอปก่อน');
      return;
    }
    setSavingRole(true);
    const { error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', targetUserId);
    setSavingRole(false);
    if (error) {
      toast.error('อัปเดตบทบาทไม่สำเร็จ', error.message);
      return;
    }
    toast.success('อัปเดตบทบาทแล้ว', `บทบาทถูกตั้งเป็น ${role}`);
    onSaved();
  }

  async function linkAppProfile(profileId: string) {
    if (!employeeId || isCreate) return;
    setLinkPickSaving(true);
    try {
      const { error: clearErr } = await supabase
        .from('profiles')
        .update({ employee_id: null })
        .eq('employee_id', employeeId);
      if (clearErr) throw clearErr;
      const { error } = await supabase
        .from('profiles')
        .update({ employee_id: employeeId })
        .eq('id', profileId);
      if (error) throw error;
      const uid = await resolveProfileUserIdForLeave(
        supabase,
        employeeId,
        hrFormToDirectoryStub(hr, employeeId)
      );
      setTargetUserId(uid);
      const yRaw = Number(grantYear.trim());
      const year =
        Number.isFinite(yRaw) && yRaw >= 2000 && yRaw <= 2100
          ? yRaw
          : currentYearBangkok();
      await loadLeaveAndGrants(uid, year);
      setProfilePickerVisible(false);
      toast.success('เชื่อมบัญชีแล้ว', 'อัปเดต profiles.employee_id แล้ว');
      onSaved();
    } catch (e) {
      toast.error(
        'เชื่อมบัญชีไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setLinkPickSaving(false);
    }
  }

  async function unlinkAppProfile() {
    if (!employeeId || isCreate) return;
    setLinkPickSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ employee_id: null })
        .eq('employee_id', employeeId);
      if (error) throw error;
      setTargetUserId(null);
      await loadLeaveAndGrants(null, currentYearBangkok());
      toast.success('ยกเลิกการเชื่อมแล้ว', 'profiles.employee_id ถูกล้างแล้ว');
      onSaved();
    } catch (e) {
      toast.error(
        'ยกเลิกการเชื่อมไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setLinkPickSaving(false);
    }
  }

  function field<K extends keyof EmployeeHrForm>(key: K, label: string, multiline = false) {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          style={[styles.input, multiline && styles.inputTall]}
          value={hr[key] as string}
          onChangeText={(t) => setHr((s) => ({ ...s, [key]: t }))}
          multiline={multiline}
        />
      </View>
    );
  }

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent>
        <KeyboardAvoidingView
          style={[styles.backdrop, WEB_MODAL_BACKDROP]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {isCreate ? 'เพิ่มพนักงาน (HR)' : 'แก้ไขพนักงาน'}
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>ปิด</Text>
            </Pressable>
          </View>

          {!isCreate && preview ? (
            <Text style={styles.preview}>
              {preview.display_name ?? '—'} · UserID: {preview.legacy_user_id ?? '—'}
            </Text>
          ) : isCreate ? (
            <Text style={styles.preview}>
              สร้างบัญชี Supabase Auth + แถว employee + เชื่อม profiles.employee_id อัตโนมัติ
            </Text>
          ) : null}

          {loading ? (
            <ActivityIndicator
              style={{ marginVertical: 24 }}
              color={c.primary}
            />
          ) : (
            <ScrollView
              style={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {isCreate ? (
                <>
                  <Text style={styles.section}>บัญชีล็อกอิน (Supabase Auth)</Text>
                  <Text style={styles.hint}>
                    อีเมลนี้จะถูกบันทึกเป็น UserID ในแถว employee และใช้ล็อกอินแอป
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="อีเมลล็อกอิน *"
                    value={createEmail}
                    onChangeText={setCreateEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="รหัสผ่านล็อกอิน * (อย่างน้อย 6 ตัว)"
                    secureTextEntry
                    value={createPassword}
                    onChangeText={setCreatePassword}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="ยืนยันรหัสผ่านล็อกอิน *"
                    secureTextEntry
                    value={createPassword2}
                    onChangeText={setCreatePassword2}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="ชื่อเต็มในระบบ (ไม่บังคับ)"
                    value={createFullName}
                    onChangeText={setCreateFullName}
                  />
                  <Text style={styles.fieldLabel}>บทบาทในแอป</Text>
                  <ScrollView horizontal style={styles.branchPick} nestedScrollEnabled>
                    {CREATE_ROLES.map((r) => (
                      <Pressable
                        key={r}
                        style={[styles.chip, createRole === r && styles.chipOn]}
                        onPress={() => setCreateRole(r)}>
                        <Text
                          style={createRole === r ? styles.chipTextOn : styles.chipText}>
                          {r}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              ) : null}

              <Text style={[styles.section, { marginTop: 20 }]}>ข้อมูล HR</Text>
              {isCreate ? (
                <Text style={styles.hint}>
                  UserID ใน HR จะถูกตั้งเป็นอีเมลที่กรอกด้านบนอัตโนมัติ
                </Text>
              ) : (
                field('legacy_user_id', 'UserID')
              )}
              {field('employee_no', 'รหัสพนักงาน (ตัวเลข)')}
              {field('prefix', 'คำนำหน้า')}
              {field('name', 'ชื่อ')}
              {field('surname', 'นามสกุล')}
              {field('nickname', 'ชื่อเล่น')}
              {field('position', 'ตำแหน่ง')}
              <Text style={styles.fieldLabel}>สาขา (เชื่อม branch_information)</Text>
              <ScrollView horizontal style={styles.branchPick} nestedScrollEnabled>
                <Pressable
                  style={[
                    styles.chip,
                    !hr.branch_id && styles.chipOn,
                  ]}
                  onPress={() => setHr((s) => ({ ...s, branch_id: null, branch: '' }))}>
                  <Text style={!hr.branch_id ? styles.chipTextOn : styles.chipText}>
                    ไม่ระบุ
                  </Text>
                </Pressable>
                {branches.map((b) => (
                  <Pressable
                    key={b.id}
                    style={[
                      styles.chip,
                      hr.branch_id === b.id && styles.chipOn,
                    ]}
                    onPress={() =>
                      setHr((s) => ({
                        ...s,
                        branch_id: b.id,
                        branch: b.branch_name ?? b.branch_code ?? String(b.id),
                      }))
                    }>
                    <Text
                      style={
                        hr.branch_id === b.id ? styles.chipTextOn : styles.chipText
                      }>
                      {branchLabel(b)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={styles.fieldHint}>
                ระบบจะเติม employee.branch และ branch_code จากข้อมูลสาขาจริงหลังบันทึก
              </Text>
              {field('phone', 'เบอร์โทร')}
              {field('start_date', 'วันเริ่มงาน')}
              {field('national_id', 'เลขบัตร ปชช.')}
              {field('address_id_card', 'ที่อยู่ตามบัตร', true)}
              {field('current_address', 'ที่อยู่ปัจจุบัน', true)}
              {field('bank', 'ธนาคาร')}
              {field('account_number', 'เลขบัญชี')}
              {field('status', 'สถานะ')}

              {!isCreate ? (
                <>
                  <Text style={[styles.section, { marginTop: 20 }]}>
                    บัญชีแอป & บทบาท
                  </Text>
                  <Text style={styles.hint}>
                    เชื่อมบัญชีแอปกับแถวพนักงานนี้ (profiles.employee_id) — โควตาวันลา
                    (vacation_grants) ใช้กับบัญชีที่เชื่อมแล้ว
                  </Text>
                  {linkedProfile ? (
                    <Text style={styles.currentPw}>
                      เชื่อมแล้ว: {linkedProfile.full_name || linkedProfile.email || '—'} ·{' '}
                      {linkedProfile.email ?? '—'} · บทบาท {linkedProfile.role ?? '—'}
                    </Text>
                  ) : (
                    <Text style={styles.currentPw}>ยังไม่มีบัญชีที่ผูก employee_id กับพนักงานคนนี้</Text>
                  )}
                  <Pressable
                    style={[styles.btnSecondary, linkPickSaving && styles.disabled]}
                    onPress={() => setProfilePickerVisible(true)}
                    disabled={linkPickSaving}>
                    <Text style={styles.btnSecondaryText}>
                      {linkPickSaving ? 'กำลังประมวลผล…' : 'เลือก / เปลี่ยนบัญชีแอปที่เชื่อม'}
                    </Text>
                  </Pressable>
                  {linkedProfile ? (
                    <Pressable
                      style={[styles.btnOutlineDanger, linkPickSaving && styles.disabled]}
                      onPress={() => void unlinkAppProfile()}
                      disabled={linkPickSaving}>
                      <Text style={styles.btnOutlineDangerText}>ยกเลิกการเชื่อมบัญชีนี้</Text>
                    </Pressable>
                  ) : null}
                  {targetUserId ? (
                    <>
                      <Text style={[styles.fieldLabel, { marginTop: 10 }]}>บทบาทในแอป</Text>
                      <ScrollView horizontal style={styles.branchPick} nestedScrollEnabled>
                        {ROLE_CHIPS.map((r) => (
                          <Pressable
                            key={r}
                            style={[
                              styles.chip,
                              linkedProfile?.role === r && styles.chipOn,
                              savingRole && styles.disabled,
                            ]}
                            onPress={() => void saveLinkedRole(r)}
                            disabled={savingRole}>
                            <Text
                              style={
                                linkedProfile?.role === r
                                  ? styles.chipTextOn
                                  : styles.chipText
                              }>
                              {r}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </>
                  ) : null}
                </>
              ) : null}

              {!isCreate ? (
                <>
                  <Text style={[styles.section, { marginTop: 20 }]}>
                    รหัสผ่านล็อกอิน (แอป)
                  </Text>
                  <Text style={styles.hint}>
                    ใช้เมื่อพนักงานลืมรหัส — ตั้งรหัสใหม่ให้บัญชี Supabase Auth ที่เชื่อมกับพนักงานคนนี้
                  </Text>
                  {linkedProfile ? (
                    <Text style={styles.currentPw}>
                      อีเมลล็อกอิน:{' '}
                      <Text style={styles.mono}>{linkedProfile.email ?? '—'}</Text>
                    </Text>
                  ) : (
                    <Text style={[styles.currentPw, { color: c.warningTitle }]}>
                      ยังไม่มีบัญชีที่เชื่อม — เลือกบัญชีในส่วน «บัญชีแอป & บทบาท» ก่อน
                    </Text>
                  )}
                  <TextInput
                    style={styles.input}
                    placeholder="รหัสผ่านล็อกอินใหม่ (อย่างน้อย 6 ตัว)"
                    secureTextEntry
                    value={loginPw1}
                    onChangeText={setLoginPw1}
                    editable={!!targetUserId && !savingLoginPw}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="ยืนยันรหัสผ่านล็อกอิน"
                    secureTextEntry
                    value={loginPw2}
                    onChangeText={setLoginPw2}
                    editable={!!targetUserId && !savingLoginPw}
                  />
                  <Pressable
                    style={[
                      styles.btnPw,
                      (!targetUserId || savingLoginPw) && styles.disabled,
                    ]}
                    onPress={() => void saveLoginPassword()}
                    disabled={!targetUserId || savingLoginPw}>
                    <Text style={styles.btnPwText}>
                      {savingLoginPw ? 'กำลังบันทึก…' : 'ตั้งรหัสผ่านล็อกอิน'}
                    </Text>
                  </Pressable>
                </>
              ) : null}

              <Text style={[styles.section, { marginTop: 22 }]}>
                วันลาคงเหลือ (vacation_grants)
              </Text>
              {!isCreate ? (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>ปี (ค.ศ.)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    placeholder={String(currentYearBangkok())}
                    value={grantYear}
                    onChangeText={setGrantYear}
                  />
                </View>
              ) : null}
              {targetUserId ? (
                <>
                  <Text style={styles.hint}>
                    กรอก "คงเหลือ" ระบบจะคำนวณโควตาทั้งปีให้อัตโนมัติจากวันลาที่ใช้แล้ว
                  </Text>
                  <Text style={styles.currentPw}>
                    ใช้ไปแล้ว: ลาป่วย {usedSick.toFixed(1)} วัน · ลากิจ {usedPersonal.toFixed(1)} วัน ·
                    พักร้อน {usedVacation.toFixed(1)} วัน
                  </Text>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>ลาป่วยคงเหลือ (วัน)</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      value={remainSick}
                      onChangeText={setRemainSick}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>ลากิจคงเหลือ (วัน)</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      value={remainPersonal}
                      onChangeText={setRemainPersonal}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>ลาพักร้อนคงเหลือ (วัน)</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      value={remainVacation}
                      onChangeText={setRemainVacation}
                    />
                  </View>
                  <Pressable
                    style={[styles.btnPw, savingLeaveBalance && styles.disabled]}
                    onPress={saveLeaveBalance}
                    disabled={savingLeaveBalance}>
                    <Text style={styles.btnPwText}>
                      {savingLeaveBalance ? 'กำลังบันทึก…' : 'บันทึกวันลาคงเหลือ'}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.hint}>
                  ยังไม่พบบัญชีผู้ใช้ที่เชื่อมกับพนักงานคนนี้ (profiles.employee_id)
                </Text>
              )}

              <Pressable
                style={[styles.btnHr, savingHr && styles.disabled]}
                onPress={saveHr}
                disabled={savingHr}>
                <Text style={styles.btnHrText}>
                  {savingHr
                    ? 'กำลังบันทึก…'
                    : isCreate
                      ? 'สร้างบัญชี + พนักงาน'
                      : 'บันทึกข้อมูล HR'}
                </Text>
              </Pressable>
              <View style={{ height: 28 }} />
            </ScrollView>
          )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={profilePickerVisible}
        animationType="fade"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => {
          if (!linkPickSaving) setProfilePickerVisible(false);
        }}>
        <Pressable
          style={[styles.pickBackdrop, WEB_MODAL_BACKDROP]}
          onPress={() => {
            if (!linkPickSaving) setProfilePickerVisible(false);
          }}>
          <Pressable style={styles.pickCard} onPress={() => {}}>
            <Text style={styles.pickTitle}>เลือกบัญชีแอป</Text>
            <Text style={styles.pickHint}>
              แตะแถวเพื่อเชื่อมกับพนักงานคนนี้ — ระบบจะล้าง employee_id เดิมของพนักงานคนนี้ก่อน แล้วผูกบัญชีที่เลือก
            </Text>
            <FlatList
              data={sortedProfilesPicker}
              keyExtractor={(p) => p.id}
              style={styles.pickList}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: p }) => {
                const here =
                  !!employeeId &&
                  (p.employee_id ?? '').trim() === String(employeeId).trim();
                const other =
                  !!(p.employee_id ?? '').trim() && !here;
                return (
                  <Pressable
                    style={[styles.pickRow, here && styles.pickRowOn]}
                    onPress={() => void linkAppProfile(p.id)}
                    disabled={linkPickSaving}>
                    <Text style={styles.pickRowTitle}>
                      {p.full_name || p.email || p.id.slice(0, 8)}
                    </Text>
                    <Text style={styles.pickRowSub}>{p.email ?? '—'}</Text>
                    {here ? (
                      <Text style={styles.pickBadge}>เชื่อมกับพนักงานนี้</Text>
                    ) : other ? (
                      <Text style={styles.pickBadgeMuted}>เชื่อมพนักงานอื่นอยู่</Text>
                    ) : (
                      <Text style={styles.pickBadgeMuted}>ยังไม่ผูกพนักงาน</Text>
                    )}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.hint}>
                  ไม่มีรายการ profiles — ลองดึงรีเฟรชหน้าแอดมิน / โปรไฟล์
                </Text>
              }
            />
            {linkPickSaving ? (
              <ActivityIndicator
                style={{ marginTop: 12 }}
                color={c.primary}
              />
            ) : null}
            <Pressable
              style={[styles.btnSecondary, { marginTop: 12 }]}
              onPress={() => {
                if (!linkPickSaving) setProfilePickerVisible(false);
              }}>
              <Text style={styles.btnSecondaryText}>ปิด</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <FriendlyNoticeModal
        visible={!!feedback}
        variant={feedback?.variant ?? 'info'}
        title={feedback?.title ?? ''}
        message={feedback?.message}
        autoDismissMs={2500}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}

function createAdminEmployeeEditStyles(theme: AppTheme) {
  const tc = theme.colors;
  const tr = theme.radius;

  return StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: tc.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: tc.surfaceMuted,
    borderTopLeftRadius: tr.lg,
    borderTopRightRadius: tr.lg,
    maxHeight: '92%',
    paddingBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: tc.borderSoft,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: tc.text },
  close: { color: tc.link, fontWeight: '600', fontSize: 16 },
  preview: {
    paddingHorizontal: 16,
    paddingTop: 8,
    color: tc.textMuted,
    fontSize: 13,
  },
  scroll: { paddingHorizontal: 16, maxHeight: '100%' },
  section: { fontSize: 16, fontWeight: '700', color: tc.text, marginTop: 8 },
  hint: {
    fontSize: 12,
    color: tc.warningTitle,
    marginTop: 6,
    lineHeight: 18,
  },
  currentPw: { fontSize: 13, color: tc.textSecondary, marginVertical: 8 },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: tc.link,
  },
  input: {
    borderWidth: 1,
    borderColor: tc.border,
    borderRadius: tr.sm,
    padding: 10,
    backgroundColor: tc.surfaceElevated,
    fontSize: 15,
    marginBottom: 8,
    color: tc.text,
  },
  inputTall: { minHeight: 72, textAlignVertical: 'top' },
  field: { marginTop: 4 },
  fieldLabel: {
    fontWeight: '600',
    color: tc.textSecondary,
    marginBottom: 4,
    marginTop: 6,
  },
  fieldHint: {
    color: tc.textMuted,
    fontSize: 12,
    marginTop: -2,
    marginBottom: 8,
    lineHeight: 17,
  },
  btnPw: {
    backgroundColor: tc.accentWarm,
    paddingVertical: 12,
    borderRadius: tr.sm,
    alignItems: 'center',
    marginTop: 4,
  },
  btnPwText: { color: tc.onAccent, fontWeight: '700' },
  btnHr: {
    backgroundColor: tc.primary,
    paddingVertical: 14,
    borderRadius: tr.sm,
    alignItems: 'center',
    marginTop: 16,
  },
  btnHrText: { color: tc.onAccent, fontWeight: '700' },
  disabled: { opacity: 0.65 },
  branchPick: { flexGrow: 0, marginBottom: 8, maxHeight: 44 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: tr.sm,
    backgroundColor: tc.chip,
    marginRight: 8,
  },
  chipOn: { backgroundColor: tc.chipActive },
  chipText: { color: tc.chipText, fontSize: 13 },
  chipTextOn: { color: tc.chipTextActive, fontWeight: '700', fontSize: 13 },
  btnSecondary: {
    borderWidth: 1,
    borderColor: tc.primary,
    paddingVertical: 12,
    borderRadius: tr.sm,
    alignItems: 'center',
    marginTop: 8,
  },
  btnSecondaryText: { color: tc.primary, fontWeight: '700', fontSize: 15 },
  btnOutlineDanger: {
    borderWidth: 1,
    borderColor: tc.warningTitle,
    paddingVertical: 10,
    borderRadius: tr.sm,
    alignItems: 'center',
    marginTop: 8,
  },
  btnOutlineDangerText: {
    color: tc.warningTitle,
    fontWeight: '600',
    fontSize: 14,
  },
  pickBackdrop: {
    flex: 1,
    backgroundColor: tc.overlay,
    justifyContent: 'center',
    padding: 16,
  },
  pickCard: {
    backgroundColor: tc.surfaceMuted,
    borderRadius: tr.lg,
    padding: 16,
    maxHeight: '88%',
  },
  pickTitle: { fontSize: 17, fontWeight: '700', color: tc.text },
  pickHint: {
    fontSize: 12,
    color: tc.textMuted,
    marginTop: 8,
    marginBottom: 12,
    lineHeight: 18,
  },
  pickList: { maxHeight: 400 },
  pickRow: {
    padding: 12,
    borderWidth: 1,
    borderColor: tc.borderSoft,
    borderRadius: tr.sm,
    marginBottom: 8,
    backgroundColor: tc.surfaceElevated,
  },
  pickRowOn: { borderColor: tc.primary },
  pickRowTitle: { fontSize: 15, fontWeight: '600', color: tc.text },
  pickRowSub: { fontSize: 13, color: tc.textSecondary, marginTop: 4 },
  pickBadge: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: tc.primary,
  },
  pickBadgeMuted: { marginTop: 6, fontSize: 12, color: tc.textMuted },
  });
}
