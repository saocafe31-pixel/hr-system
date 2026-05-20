import type { SupabaseClient } from '@supabase/supabase-js';

export type MentionableUser = {
  userId: string;
  /** แสดงหลัง @ — full_name ถ้ามี ไม่เช่นนั้น email */
  insertLabel: string;
  /** สตริงที่ใช้จับคู่ @token (ไม่รวม @) */
  matchKeys: string[];
};

type ProfileMentionRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

function norm(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function fold(s: string): string {
  return s.trim().toLocaleLowerCase('th-TH');
}

function uniqNonEmpty(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const t = norm(x);
    if (!t) continue;
    const k = fold(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** โหลดรายชื่อ @ จาก profiles เท่านั้น — แสดง full_name หรือ email */
export async function loadMentionableUsers(
  supabase: SupabaseClient
): Promise<MentionableUser[]> {
  const { data: profs, error } = await supabase
    .from('profiles')
    .select('id, full_name, email');
  if (error) throw new Error(error.message);
  const profileRows = (profs as ProfileMentionRow[]) ?? [];

  const out: MentionableUser[] = [];
  for (const p of profileRows) {
    const fullName = norm(p.full_name);
    const email = norm(p.email);
    const insertLabel = fullName || email || p.id.slice(0, 6);
    const emailLocal =
      email && email.includes('@') ? norm(email.split('@')[0]) : '';

    const matchKeys = uniqNonEmpty([
      insertLabel,
      fullName,
      email,
      emailLocal,
      ...(fullName ? fullName.split(/\s+/u) : []),
    ]);

    out.push({ userId: p.id, insertLabel, matchKeys });
  }

  out.sort((a, b) =>
    a.insertLabel.localeCompare(b.insertLabel, 'th-TH', { sensitivity: 'base' })
  );
  return out;
}

/** ดึง token หลัง @ จากข้อความ (ไม่รวม @) — แยกด้วยช่องว่าง */
export function extractMentionTokens(body: string): string[] {
  const re = /@([^\s@]+)/gu;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const t = norm(m[1]);
    if (t) found.push(t);
  }
  return [...new Set(found)];
}

function resolveTokenToUserIds(
  token: string,
  users: readonly MentionableUser[]
): string[] {
  const f = fold(token);
  if (!f) return [];

  const exact: string[] = [];
  for (const u of users) {
    if (u.matchKeys.some((k) => fold(k) === f)) exact.push(u.userId);
  }
  if (exact.length === 1) return exact;
  if (exact.length > 1) return exact;

  const starts: string[] = [];
  for (const u of users) {
    if (u.matchKeys.some((k) => fold(k).startsWith(f))) starts.push(u.userId);
  }
  const uniq = [...new Set(starts)];
  return uniq.length === 1 ? uniq : [];
}

/** คืน user_id ของผู้ที่ถูกกล่าวถึง (ไม่ซ้ำ, ไม่รวมผู้ส่ง) */
export function resolveMentionRecipients(
  body: string,
  users: readonly MentionableUser[],
  senderId: string
): string[] {
  const tokens = extractMentionTokens(body);
  const ids = new Set<string>();
  for (const t of tokens) {
    for (const id of resolveTokenToUserIds(t, users)) {
      if (id !== senderId) ids.add(id);
    }
  }
  return [...ids];
}

export type ActiveMentionQuery = {
  /** ตำแหน่งอักขระ @ */
  atIndex: number;
  /** แทนที่ช่วง [atIndex+1, caret) ด้วยชื่อที่เลือก */
  caret: number;
  query: string;
} | null;

/** จากตำแหน่งเคอร์เซอร์ — มีโหมดพิมพ์ @ อยู่หรือไม่ (ไม่มีช่องว่างใน segment) */
export function activeMentionQuery(
  text: string,
  caret: number
): ActiveMentionQuery {
  const before = text.slice(0, Math.max(0, caret));
  const atIndex = before.lastIndexOf('@');
  if (atIndex < 0) return null;
  const segment = before.slice(atIndex + 1);
  if (segment.includes(' ') || segment.includes('\n')) return null;
  return { atIndex, caret, query: segment };
}

export function filterMentionables(
  users: readonly MentionableUser[],
  query: string
): MentionableUser[] {
  const q = fold(query);
  if (!q) return [...users];
  return users.filter(
    (u) =>
      fold(u.insertLabel).includes(q) ||
      u.matchKeys.some((k) => fold(k).includes(q))
  );
}
