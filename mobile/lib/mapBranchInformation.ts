import type { Branch } from '@/lib/types';

/** แปลงแถวจาก PostgREST (branch_information) ให้เป็น Branch */
export function mapBranchInformationRows(
  rows: Record<string, unknown>[] | null | undefined
): Branch[] {
  if (!rows?.length) return [];
  return rows.map((row) => ({
    id: Number(row.id),
    branch_code: (row.branch_code as string) ?? null,
    branch_name: (row.branch_name as string) ?? null,
    address: (row.address as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    phone_number:
      row.phone_number != null ? Number(row.phone_number) : null,
    radius_meters:
      row.radius_meters != null ? Number(row.radius_meters) : 150,
  }));
}
