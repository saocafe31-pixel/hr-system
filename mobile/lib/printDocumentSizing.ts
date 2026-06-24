import { Platform } from 'react-native';

/** ความกว้างเนื้อหา HTML สำหรับ A4 (px @ 96dpi) */
export const PRINT_PAGE_WIDTH_PX = 794;

/** ขนาดหน้า PDF สำหรับ expo-print (points) */
export const EXPO_PRINT_WIDTH_PT = 595;
export const EXPO_PRINT_HEIGHT_PT = 842;

/** ฟอนต์เอกสารพิมพ์ — โหลดจากเว็บให้มือถือ/คอม render เหมือนกัน (Cordia มีแค่ Windows) */
export const PRINT_THAI_FONT_FAMILY = "'Sarabun', 'TH Sarabun New', sans-serif";

export function printThaiFontHeadLinks(): string {
  return `<link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet" />`;
}

export function printViewportMeta(): string {
  return `<meta name="viewport" content="width=${PRINT_PAGE_WIDTH_PX}, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no" />`;
}

/** ย่อตัวอย่างใน iframe ให้พอดีจอมือถือ โดยคงขนาดตัวอักษร pt ภายในเอกสาร */
export function computePrintPreviewScale(viewportWidth: number, pageWidthPx = PRINT_PAGE_WIDTH_PX): number {
  const padding = 20;
  const available = Math.max(280, viewportWidth - padding);
  return Math.min(1, Math.max(0.32, available / pageWidthPx));
}

/** z-index สำหรับ portal ตัวอย่างพิมพ์บนเว็บ — สูงกว่า Modal RN Web และ CuteToast */
export const WEB_PRINT_PREVIEW_Z_INDEX = 50_000_001;

/**
 * CSS สำหรับแสดงตัวอย่างใน iframe/มือถือ: คงความกว้าง A4 ไม่ให้ flex บีบตัวอักษร
 * ตอนพิมพ์จริง (@media print) คืนค่า layout มาตรฐาน
 */
export function printDocumentScreenCss(
  rootSelector = '.page, .sheet, main.page, main.sheet',
  pageWidthPx = PRINT_PAGE_WIDTH_PX
): string {
  return `
    @media screen {
      html, body {
        background: #e8e8e8;
        -webkit-text-size-adjust: none !important;
        text-size-adjust: none !important;
      }
      body {
        margin: 0;
        padding: 0;
        display: block;
        overflow-x: hidden;
      }
      ${rootSelector} {
        width: ${pageWidthPx}px;
        max-width: ${pageWidthPx}px;
        margin: 0 auto;
        box-shadow: 0 2px 16px rgba(0, 0, 0, 0.1);
        background: #fff;
      }
    }
    @media print {
      html, body {
        background: #fff !important;
        padding: 0 !important;
        margin: 0 !important;
        display: block !important;
        width: 100% !important;
        -webkit-text-size-adjust: none !important;
        text-size-adjust: none !important;
      }
      ${rootSelector} {
        box-shadow: none !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
    }
  `;
}

/** มือถือ / แท็บเล็ต — ใช้ตัวอย่างในแอปแทนเปิดหน้าต่างพิมพ์ทันที */
export function shouldUseInAppPrintPreview(windowWidth: number): boolean {
  if (Platform.OS !== 'web') return true;
  return windowWidth < 900;
}

export const expoPrintPageOptions = {
  width: EXPO_PRINT_WIDTH_PT,
  height: EXPO_PRINT_HEIGHT_PT,
} as const;

/** รอฟอนต์/รูปก่อนพิมพ์ — ลดอาการตัวอักษรเล็กผิดปกติบนมือถือ */
export function waitForPrintDocumentReady(doc: Document, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    const waitImages = () => {
      const imgs = Array.from(doc.images);
      let pending = 0;
      for (const img of imgs) {
        if (img.complete && img.naturalWidth > 0) continue;
        pending += 1;
        const onResult = () => {
          pending -= 1;
          if (pending <= 0) done();
        };
        img.addEventListener('load', onResult, { once: true });
        img.addEventListener('error', onResult, { once: true });
      }
      if (pending === 0) done();
    };

    const fontReady = doc.fonts?.ready ?? Promise.resolve();
    fontReady.then(waitImages).catch(waitImages);
    setTimeout(done, timeoutMs);
  });
}

/** วัดความสูงเอกสารใน iframe สำหรับตัวอย่าง/พิมพ์ */
export function measurePrintDocumentHeight(doc: Document): number {
  const root = doc.querySelector('.page, .sheet, main.page, main.sheet, main.report');
  const rootHeight =
    root instanceof HTMLElement
      ? Math.max(root.scrollHeight, root.offsetHeight, root.getBoundingClientRect().height)
      : 0;
  return Math.max(
    doc.documentElement?.scrollHeight ?? 0,
    doc.body?.scrollHeight ?? 0,
    rootHeight
  ) + 64;
}

/**
 * พิมพ์จาก iframe ตัวอย่าง — คงหน้า preview (ปุ่มย้อนกลับ) และยกเลิก scale ชั่วคราว
 * กัน iOS ตัดเนื้อหาขวา/ล่างเมื่อ iframe ถูก transform
 */
export async function printIframeDocument(iframe: HTMLIFrameElement): Promise<void> {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    throw new Error('ไม่พบเอกสารในตัวอย่าง');
  }

  await waitForPrintDocumentReady(doc);
  const measured = measurePrintDocumentHeight(doc);

  const prevTransform = iframe.style.transform;
  const prevTransformOrigin = iframe.style.transformOrigin;
  const prevWidth = iframe.style.width;
  const prevHeight = iframe.style.height;

  iframe.style.transform = 'none';
  iframe.style.transformOrigin = 'top left';
  iframe.style.width = `${PRINT_PAGE_WIDTH_PX}px`;
  iframe.style.height = `${measured}px`;

  const resetStyle = doc.createElement('style');
  resetStyle.setAttribute('data-print-iframe-reset', 'true');
  resetStyle.textContent = `
    @media print {
      html, body {
        overflow: visible !important;
        height: auto !important;
        width: 100% !important;
        max-width: 100% !important;
      }
      .page, .sheet, main.page, main.sheet, main.report {
        overflow: visible !important;
        width: 100% !important;
        max-width: 100% !important;
        page-break-inside: avoid;
      }
    }
  `;
  doc.head.appendChild(resetStyle);

  const restore = () => {
    iframe.style.transform = prevTransform;
    iframe.style.transformOrigin = prevTransformOrigin;
    iframe.style.width = prevWidth;
    iframe.style.height = prevHeight;
    resetStyle.remove();
  };

  try {
    win.focus();
    win.print();
  } finally {
    if (typeof win.matchMedia === 'function') {
      const media = win.matchMedia('print');
      const onChange = () => {
        if (!media.matches) {
          restore();
          media.removeEventListener('change', onChange);
        }
      };
      media.addEventListener('change', onChange);
      setTimeout(restore, 3000);
    } else {
      setTimeout(restore, 1500);
    }
  }
}

/**
 * พิมพ์จากหน้าต่างเต็ม — ใช้บนคอมจอกว้างเท่านั้น (มือถือเปิดหน้านี้จะไม่มีปุ่มย้อนกลับและตัด layout)
 */
export async function printHtmlInBrowserWindow(html: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const w = window.open('', '_blank');
  if (!w) {
    throw new Error('ไม่สามารถเปิดหน้าต่างพิมพ์ได้ กรุณาอนุญาต popup ในเบราว์เซอร์');
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  await waitForPrintDocumentReady(w.document);
  w.focus();
  w.print();
}
