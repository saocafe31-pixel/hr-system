/** แถวจาก RPC task_assign_picklist (manager/admin) */
export type AssignPickRow = {
  profile_id: string;
  account_email: string | null;
  hr_user_id: string | null;
  full_name: string | null;
  employee_id: string | null;
  hr_name: string | null;
  hr_surname: string | null;
  hr_nickname: string | null;
};

export function normalizeAssignPickRows(raw: unknown): AssignPickRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item as Record<string, unknown>;
      const profileId = o.profile_id != null ? String(o.profile_id) : '';
      if (!profileId) return null;
      const s = (v: unknown) =>
        v != null && String(v).trim() !== '' ? String(v).trim() : null;
      return {
        profile_id: profileId,
        account_email: s(o.account_email),
        hr_user_id: s(o.hr_user_id),
        full_name: s(o.full_name),
        employee_id: s(o.employee_id),
        hr_name: s(o.hr_name),
        hr_surname: s(o.hr_surname),
        hr_nickname: s(o.hr_nickname),
      };
    })
    .filter((x): x is AssignPickRow => x != null);
}

/** ชื่อที่แสดงเป็นหัวข้อหลัก — ไม่ใช้อีเมล (ยกเว้นไม่มีชื่อเลย) */
export function assignDisplayHeadline(row: AssignPickRow): string {
  const hr = [row.hr_name, row.hr_surname].filter(Boolean).join(' ').trim();
  if (hr) return hr;
  const fn = row.full_name?.trim();
  if (fn) return fn;
  return '';
}

export function assigneeLabelFromPicklist(id: string, pick: AssignPickRow[]): string {
  const row = pick.find((p) => p.profile_id === id);
  if (!row) return id.slice(0, 8) + '…';
  const h = assignDisplayHeadline(row);
  return h || row.account_email || id.slice(0, 8) + '…';
}

export function assignMatchesSearch(row: AssignPickRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.hr_name,
    row.hr_surname,
    row.hr_nickname,
    row.full_name,
    row.account_email,
    row.hr_user_id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}
