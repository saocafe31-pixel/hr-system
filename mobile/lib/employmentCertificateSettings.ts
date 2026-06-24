import { supabase } from '@/lib/supabase';

export const EMPLOYMENT_CERTIFICATE_SETTINGS_KEY = 'employment_certificate_settings';

export type EmploymentCertificateSettings = {
  signerName: string;
  signerTitle: string;
  signatureUrl: string;
  logoUrl: string;
  hrFooterNote: string;
};

export const emptyEmploymentCertificateSettings: EmploymentCertificateSettings = {
  signerName: '',
  signerTitle: 'ประธานกรรมการบริษัท',
  signatureUrl: '',
  logoUrl: '',
  hrFooterNote: 'หมายเหตุ: ฝ่ายทรัพยากรมนุษย์ โทร. 061-732-1346',
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseEmploymentCertificateSettings(
  raw: unknown
): EmploymentCertificateSettings {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as unknown;
    } catch {
      return emptyEmploymentCertificateSettings;
    }
  }
  if (!obj || typeof obj !== 'object') return emptyEmploymentCertificateSettings;
  const record = obj as Record<string, unknown>;
  return {
    signerName: cleanText(record.signer_name ?? record.signerName),
    signerTitle:
      cleanText(record.signer_title ?? record.signerTitle) ||
      emptyEmploymentCertificateSettings.signerTitle,
    signatureUrl: cleanText(record.signature_url ?? record.signatureUrl),
    logoUrl: cleanText(record.logo_url ?? record.logoUrl),
    hrFooterNote:
      cleanText(record.hr_footer_note ?? record.hrFooterNote) ||
      emptyEmploymentCertificateSettings.hrFooterNote,
  };
}

export function serializeEmploymentCertificateSettings(
  settings: EmploymentCertificateSettings
): Record<string, string> {
  return {
    signer_name: settings.signerName.trim(),
    signer_title: settings.signerTitle.trim(),
    signature_url: settings.signatureUrl.trim(),
    logo_url: settings.logoUrl.trim(),
    hr_footer_note: settings.hrFooterNote.trim(),
  };
}

export async function loadEmploymentCertificateSettings(): Promise<EmploymentCertificateSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', EMPLOYMENT_CERTIFICATE_SETTINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseEmploymentCertificateSettings(data?.value);
}

export async function saveEmploymentCertificateSettings(
  settings: EmploymentCertificateSettings
): Promise<void> {
  const { error } = await supabase.from('app_settings').upsert(
    {
      key: EMPLOYMENT_CERTIFICATE_SETTINGS_KEY,
      value: serializeEmploymentCertificateSettings(settings),
    },
    { onConflict: 'key' }
  );
  if (error) throw error;
}
