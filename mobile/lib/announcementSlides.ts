export const ANNOUNCEMENT_SETTINGS_KEY = 'announcement_slides';

export function parseAnnouncementUrls(value: unknown): string[] {
  return parseAnnouncementSettings(value).urls;
}

export type AnnouncementSettingsParsed = {
  urls: string[];
  /** ความสูงรูปสไลด์ที่หน้าเข้า-ออก (px) */
  slideHeightPx: number;
};

const SLIDE_H_MIN = 100;
const SLIDE_H_MAX = 320;
const SLIDE_H_DEFAULT = 160;

export function parseAnnouncementSettings(value: unknown): AnnouncementSettingsParsed {
  const urls: string[] = [];
  if (value != null && typeof value === 'object') {
    const raw = (value as { urls?: unknown }).urls;
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (typeof x === 'string' && x.trim().length > 0) urls.push(x.trim());
      }
    }
  }
  let slideHeightPx = SLIDE_H_DEFAULT;
  if (value != null && typeof value === 'object') {
    const h = (value as { slide_height_px?: unknown }).slide_height_px;
    if (typeof h === 'number' && Number.isFinite(h)) {
      slideHeightPx = Math.min(SLIDE_H_MAX, Math.max(SLIDE_H_MIN, Math.round(h)));
    }
  }
  return { urls, slideHeightPx };
}

export function buildAnnouncementSettingsValue(
  urls: string[],
  slideHeightPx: number
): { urls: string[]; slide_height_px: number } {
  const clean = urls.map((s) => s.trim()).filter((s) => s.length > 0);
  const h = Math.min(SLIDE_H_MAX, Math.max(SLIDE_H_MIN, Math.round(slideHeightPx)));
  return { urls: clean, slide_height_px: h };
}
