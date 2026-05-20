import type { AdminEmployeePasswordRow, Profile } from '@/lib/types';

export type EmployeeProfileLinkKind = 'employee_id' | 'userid_uuid' | 'userid_email';

export type MergedEmployeeAdminRow = {
  employee: AdminEmployeePasswordRow;
  profile: Profile | null;
  linkKind: EmployeeProfileLinkKind | null;
};

export function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function normEmpId(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const t = String(raw).trim();
  return t === '' ? null : t;
}

/** เชื่อมแถว employee กับ profiles ตาม employee_id = e.id หรือ UserID = profile.id (uuid) หรือ UserID = email */
export function mergeEmployeeWithProfiles(
  employees: AdminEmployeePasswordRow[],
  profiles: Profile[]
): MergedEmployeeAdminRow[] {
  return employees.map((row) => {
    let profile: Profile | null = null;
    let linkKind: EmployeeProfileLinkKind | null = null;

    const byEmp = profiles.find((p) => normEmpId(p.employee_id) === row.id);
    if (byEmp) {
      profile = byEmp;
      linkKind = 'employee_id';
    } else {
      const uid = row.legacy_user_id?.trim();
      if (uid) {
        if (isUuidLike(uid)) {
          const byId = profiles.find((p) => p.id.toLowerCase() === uid.toLowerCase());
          if (byId) {
            profile = byId;
            linkKind = 'userid_uuid';
          }
        }
        if (!profile) {
          const low = uid.toLowerCase();
          const byEmail = profiles.find(
            (p) => (p.email ?? '').trim().toLowerCase() === low
          );
          if (byEmail) {
            profile = byEmail;
            linkKind = 'userid_email';
          }
        }
      }
    }

    return { employee: row, profile, linkKind };
  });
}
