export const ANNOUNCEMENT_SETTINGS_KEY = 'announcement_slides';

export function parseAnnouncementUrls(value: unknown): string[] {
  return parseAnnouncementSettings(value).urls;
}

export type AnnouncementSettingsParsed = {
  urls: string[];
  slides: AnnouncementSlide[];
  transitionMode: AnnouncementTransitionMode;
  /** ความสูงรูปสไลด์ที่หน้าเข้า-ออก (px) */
  slideHeightPx: number;
};

export type AnnouncementSlide = {
  url: string;
  durationMs: number;
};

export type AnnouncementTransitionMode = 'slide' | 'fade';

const SLIDE_H_MIN = 100;
const SLIDE_H_MAX = 320;
const SLIDE_H_DEFAULT = 160;
export const ANNOUNCEMENT_DEFAULT_DURATION_MS = 4000;
const ANNOUNCEMENT_DURATION_MIN_MS = 1000;
const ANNOUNCEMENT_DURATION_MAX_MS = 60000;
const ANNOUNCEMENT_DEFAULT_TRANSITION_MODE: AnnouncementTransitionMode = 'slide';

function clampDurationMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return ANNOUNCEMENT_DEFAULT_DURATION_MS;
  return Math.min(
    ANNOUNCEMENT_DURATION_MAX_MS,
    Math.max(ANNOUNCEMENT_DURATION_MIN_MS, Math.round(n))
  );
}

function parseSlideDurationMs(raw: Record<string, unknown>): number {
  if (raw.duration_ms != null) return clampDurationMs(raw.duration_ms);
  if (raw.durationMs != null) return clampDurationMs(raw.durationMs);
  if (raw.duration_seconds != null) return clampDurationMs(Number(raw.duration_seconds) * 1000);
  if (raw.durationSeconds != null) return clampDurationMs(Number(raw.durationSeconds) * 1000);
  return ANNOUNCEMENT_DEFAULT_DURATION_MS;
}

function parseTransitionMode(raw: unknown): AnnouncementTransitionMode {
  return raw === 'fade' || raw === 'slide' ? raw : ANNOUNCEMENT_DEFAULT_TRANSITION_MODE;
}

export function parseAnnouncementSettings(value: unknown): AnnouncementSettingsParsed {
  const slides: AnnouncementSlide[] = [];
  let transitionMode: AnnouncementTransitionMode = ANNOUNCEMENT_DEFAULT_TRANSITION_MODE;
  if (value != null && typeof value === 'object') {
    transitionMode = parseTransitionMode((value as { transition_mode?: unknown }).transition_mode);
    const rawSlides = (value as { slides?: unknown }).slides;
    if (Array.isArray(rawSlides)) {
      for (const x of rawSlides) {
        if (!x || typeof x !== 'object') continue;
        const row = x as Record<string, unknown>;
        const url = typeof row.url === 'string' ? row.url.trim() : '';
        if (url.length > 0) {
          slides.push({ url, durationMs: parseSlideDurationMs(row) });
        }
      }
    }

    const raw = (value as { urls?: unknown }).urls;
    if (Array.isArray(raw)) {
      for (const x of raw) {
        const url = typeof x === 'string' ? x.trim() : '';
        if (url.length > 0 && !slides.some((slide) => slide.url === url)) {
          slides.push({ url, durationMs: ANNOUNCEMENT_DEFAULT_DURATION_MS });
        }
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
  return { urls: slides.map((slide) => slide.url), slides, transitionMode, slideHeightPx };
}

export function buildAnnouncementSettingsValue(
  slidesOrUrls: (AnnouncementSlide | string)[],
  slideHeightPx: number,
  transitionMode: AnnouncementTransitionMode = ANNOUNCEMENT_DEFAULT_TRANSITION_MODE
): {
  urls: string[];
  slides: { url: string; duration_ms: number }[];
  slide_height_px: number;
  transition_mode: AnnouncementTransitionMode;
} {
  const slides = slidesOrUrls
    .map((item) => {
      if (typeof item === 'string') {
        return { url: item.trim(), duration_ms: ANNOUNCEMENT_DEFAULT_DURATION_MS };
      }
      return {
        url: item.url.trim(),
        duration_ms: clampDurationMs(item.durationMs),
      };
    })
    .filter((item) => item.url.length > 0);
  const h = Math.min(SLIDE_H_MAX, Math.max(SLIDE_H_MIN, Math.round(slideHeightPx)));
  return {
    urls: slides.map((slide) => slide.url),
    slides,
    slide_height_px: h,
    transition_mode: parseTransitionMode(transitionMode),
  };
}
