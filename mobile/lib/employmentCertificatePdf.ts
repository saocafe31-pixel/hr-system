import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { EmploymentCertificatePayload } from '@/lib/employmentCertificateData';
import {
  expoPrintPageOptions,
  printDocumentScreenCss,
  printHtmlInBrowserWindow,
  printThaiFontHeadLinks,
  PRINT_THAI_FONT_FAMILY,
  printViewportMeta,
  PRINT_PAGE_WIDTH_PX,
  waitForPrintDocumentReady,
} from '@/lib/printDocumentSizing';
import {
  formatSalaryAmount,
  formatThaiDateLong,
  thaiBahtText,
  unbreakableThaiText,
} from '@/lib/thaiCertificateFormat';

export type EmploymentCertificatePrintWindow = Window | null;

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function imageUrlToDataUrl(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) return trimmed;
  if (typeof FileReader === 'undefined') return trimmed;
  try {
    const response = await fetch(trimmed);
    if (!response.ok) return trimmed;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || trimmed));
      reader.onerror = () => resolve(trimmed);
      reader.readAsDataURL(blob);
    });
  } catch {
    return trimmed;
  }
}

async function resolveCertificateAssets(
  payload: EmploymentCertificatePayload
): Promise<EmploymentCertificatePayload> {
  const [signatureUrl, logoUrl] = await Promise.all([
    imageUrlToDataUrl(payload.certificate.signatureUrl),
    imageUrlToDataUrl(payload.certificate.logoUrl),
  ]);
  return {
    ...payload,
    certificate: {
      ...payload.certificate,
      signatureUrl,
      logoUrl,
    },
  };
}

function detailRow(label: string, value: string, extraClass = ''): string {
  return `
    <div class="detail-row ${extraClass}">
      <span class="detail-label">${htmlEscape(label)}</span>
      <span class="detail-colon">:</span>
      <span class="detail-value">${value}</span>
    </div>
  `;
}

function letterheadHtml(payload: EmploymentCertificatePayload): string {
  const companyName = payload.company.name?.trim() || 'บริษัท';
  const address = payload.company.addressLines?.filter(Boolean).join(' ') || '';
  const logoUrl = payload.certificate.logoUrl?.trim() || '';
  const logoBlock = logoUrl
    ? `<img src="${htmlEscape(logoUrl)}" alt="logo" class="logo-img" />`
    : '';

  return `
    <header class="letterhead">
      ${logoBlock}
      <div class="company-name">${htmlEscape(companyName)}</div>
      ${address ? `<div class="company-address">${htmlEscape(address)}</div>` : ''}
    </header>
  `;
}

function signatureBlockHtml(payload: EmploymentCertificatePayload): string {
  const signatureUrl = payload.certificate.signatureUrl?.trim() || '';
  const signerName = payload.certificate.signerName?.trim() || 'ผู้มีอำนาจลงนาม';
  const signerTitle = payload.certificate.signerTitle?.trim() || '';
  const signatureImg = signatureUrl
    ? `<img src="${htmlEscape(signatureUrl)}" alt="signature" class="signature-img" />`
    : '';

  return `
    <div class="signature-wrap">
      <div class="signature-block">
        ${signatureImg}
        <div class="signature-line"></div>
        <div class="signer-name">( ${htmlEscape(signerName)} )</div>
        ${signerTitle ? `<div class="signer-title">${htmlEscape(signerTitle)}</div>` : ''}
      </div>
    </div>
  `;
}

function emSpan(text: string, options?: { nowrap?: boolean }): string {
  const cls = options?.nowrap ? 'em phrase' : 'em';
  return `<span class="${cls}">${htmlEscape(text)}</span>`;
}

function certificateFontFamily(): string {
  /** Sarabun โหลดจาก Google Fonts — คอม/มือถือ render เหมือนกัน */
  return PRINT_THAI_FONT_FAMILY;
}

function certificateStyles(): string {
  /**
   * Sarabun ดูใหญ่กว่า Cordia ~12% ที่ pt เดียวกัน
   * ค่าด้านล่างปรับให้ใกล้ Cordia 16pt / 18pt / 15pt ที่เคยใช้บนคอม
   */
  const bodySize = '11pt';
  const bodyLine = '1.5';
  const paraIndent = '2.75em';
  const sectionGap = '9pt';
  const titleTopGap = '16pt';
  const detailLabelWidth = '11.5em';
  const salaryWordsIndent = '12em';
  const pageMargin = '22mm 24mm 20mm';
  const font = certificateFontFamily();

  return `
    * { box-sizing: border-box; -webkit-text-size-adjust: none; text-size-adjust: none; }
    @page { size: A4; margin: ${pageMargin}; }
    html { font-size: ${bodySize}; }
    body {
      font-family: ${font};
      font-size: ${bodySize};
      line-height: ${bodyLine};
      color: #111;
      margin: 0;
      padding: 0;
      background: #fff;
      word-break: keep-all;
      overflow-wrap: anywhere;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: ${PRINT_PAGE_WIDTH_PX}px;
      max-width: ${PRINT_PAGE_WIDTH_PX}px;
      margin: 0 auto;
      padding: ${pageMargin};
    }

    .letterhead {
      margin-bottom: 12pt;
      padding-bottom: 5pt;
      border-bottom: 0.5pt solid #bbb;
    }
    .logo-img {
      display: block;
      max-height: 26pt;
      max-width: 112pt;
      object-fit: contain;
      margin-bottom: 3pt;
    }
    .company-name {
      font-size: 10pt;
      font-weight: 700;
      line-height: 1.35;
      color: #111;
      word-break: keep-all;
      overflow-wrap: anywhere;
    }
    .company-address {
      margin-top: 2pt;
      font-size: 8.5pt;
      line-height: 1.45;
      color: #333;
      max-width: 92%;
      word-break: keep-all;
      overflow-wrap: anywhere;
    }

    .doc-title {
      text-align: center;
      font-size: 13pt;
      font-weight: 700;
      letter-spacing: 0.02em;
      margin: ${titleTopGap} 0 8pt;
      color: #111;
    }
    .doc-date {
      text-align: right;
      margin: 0 0 ${sectionGap};
      font-size: ${bodySize};
      color: #111;
    }

    .body-section {
      margin-bottom: ${sectionGap};
    }

    .body-text,
    .intro-text {
      display: block;
      text-align: justify;
      text-align-last: left;
      text-indent: ${paraIndent};
      margin: 0 0 7pt;
      line-height: ${bodyLine};
      font-size: ${bodySize};
      word-break: keep-all;
      overflow-wrap: anywhere;
    }
    .body-text:last-child,
    .intro-text:last-child {
      margin-bottom: 0;
    }
    .body-text .em,
    .intro-text .em {
      font-weight: 700;
      color: #000;
    }
    .phrase {
      white-space: nowrap;
    }

    .detail-list {
      margin: 5pt 0 0 ${paraIndent};
      padding: 0;
      max-width: 100%;
    }
    .detail-row {
      display: flex;
      align-items: flex-start;
      gap: 0;
      margin-bottom: 4pt;
      line-height: ${bodyLine};
      font-size: ${bodySize};
    }
    .detail-label {
      flex: 0 0 ${detailLabelWidth};
      text-align: left;
      color: #111;
      padding-top: 0.05em;
    }
    .detail-colon {
      flex: 0 0 0.55em;
      text-align: center;
      color: #111;
    }
    .detail-value {
      flex: 1;
      min-width: 0;
      font-weight: 700;
      color: #000;
      word-break: keep-all;
      overflow-wrap: anywhere;
    }
    .detail-row.salary-words-row {
      display: block;
      margin-top: -1pt;
      margin-bottom: 5pt;
    }
    .detail-row.salary-words-row .detail-label,
    .detail-row.salary-words-row .detail-colon {
      display: none;
    }
    .detail-row.salary-words-row .detail-value {
      display: block;
      font-weight: 400;
      font-size: 10pt;
      color: #222;
      padding-left: ${salaryWordsIndent};
      white-space: normal;
      word-break: keep-all;
      overflow-wrap: anywhere;
      line-height: 1.45;
    }
    .detail-section-gap {
      height: 3pt;
    }

    .certify {
      display: block;
      text-align: center;
      margin: ${sectionGap} 0;
      font-size: ${bodySize};
      line-height: ${bodyLine};
      color: #111;
    }

    .signature-wrap {
      display: flex;
      justify-content: flex-end;
      margin-top: 22pt;
      page-break-inside: avoid;
    }
    .signature-block {
      width: 52%;
      min-width: 220pt;
      max-width: 280pt;
      text-align: center;
    }
    .signature-img {
      display: block;
      margin: 0 auto -4pt;
      height: 76pt;
      width: auto;
      max-width: 240pt;
      object-fit: contain;
      object-position: center bottom;
    }
    .signature-line {
      border-bottom: 0.5pt dotted #333;
      margin: 0 10pt 5pt;
      min-height: 1pt;
    }
    .signer-name {
      font-size: ${bodySize};
      line-height: 1.35;
      color: #111;
    }
    .signer-title {
      margin-top: 2pt;
      font-size: 10pt;
      color: #222;
    }

    .footer-note {
      margin-top: 22pt;
      padding-top: 5pt;
      border-top: 0.5pt solid #ccc;
      font-size: 7.5pt;
      color: #444;
      line-height: 1.45;
      word-break: keep-all;
      overflow-wrap: anywhere;
    }

    @media print {
      html, body {
        font-size: ${bodySize} !important;
        width: 100% !important;
        max-width: 100% !important;
        margin: 0;
        padding: 0;
        overflow: visible !important;
        height: auto !important;
        -webkit-text-size-adjust: none !important;
        text-size-adjust: none !important;
      }
      .page {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: visible !important;
        page-break-inside: avoid;
      }
      .body-text, .intro-text { text-indent: ${paraIndent}; }
      .signature-wrap, .footer-note { page-break-inside: avoid; }
      .signature-img { height: 76pt; max-width: 240pt; }
    }

    ${printDocumentScreenCss('main.page, .page')}
  `;
}

export function buildEmploymentCertificateHtml(
  payload: EmploymentCertificatePayload
): string {
  const issuedDate = formatThaiDateLong();
  const companyName = payload.company.name?.trim() || 'บริษัท';
  const fullName = payload.employee.fullName || '—';
  const position = payload.employee.position || '—';
  const branch = payload.employee.branch || 'สำนักงานใหญ่';
  const startDate = unbreakableThaiText(formatThaiDateLong(payload.employee.startDate));
  const issuedDateUnbroken = unbreakableThaiText(issuedDate);
  const footerNote = payload.certificate.hrFooterNote?.trim() || '';

  let bodyContent = '';

  if (payload.withSalary) {
    const salary = Number(payload.monthlySalary ?? 0);
    const salaryText = formatSalaryAmount(salary);
    const salaryWords = thaiBahtText(salary);
    bodyContent = `
      <div class="body-section">
        <p class="intro-text">
          หนังสือฉบับนี้ออกให้เพื่อรับรองว่าข้อมูลของบุคคลตามรายละเอียดต่อไปนี้
          เป็นพนักงานประจำของ ${emSpan(companyName)}
        </p>
        <div class="detail-list">
          ${detailRow('ชื่อ-นามสกุล', emSpan(fullName))}
          ${detailRow('ตำแหน่ง', emSpan(position))}
          ${detailRow('สังกัด/หน่วยงาน', emSpan(branch))}
          ${detailRow('อัตราเงินเดือนๆ ละ', `<span class="phrase">${htmlEscape(salaryText)}&nbsp;บาท</span>`)}
          <div class="detail-row salary-words-row">
            <span class="detail-label">—</span>
            <span class="detail-colon">:</span>
            <span class="detail-value">(-${htmlEscape(salaryWords)}-)</span>
          </div>
          <div class="detail-section-gap"></div>
          ${detailRow('เริ่มปฏิบัติงานตั้งแต่วันที่', `<span class="phrase">${startDate}</span>`)}
          ${detailRow('จนถึงวันที่', `<span class="phrase">${issuedDateUnbroken}</span>`)}
        </div>
      </div>
    `;
  } else {
    bodyContent = `
      <div class="body-section">
        <p class="body-text">
          หนังสือฉบับนี้ออกให้เพื่อรับรองว่า ${emSpan(fullName)} ได้ทำงานกับ ${emSpan(companyName)} ในตำแหน่ง ${emSpan(position)} ตั้งแต่วันที่ ${emSpan(startDate, { nowrap: true })} จนถึงปัจจุบัน
        </p>
      </div>
    `;
  }

  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    ${printViewportMeta()}
    ${printThaiFontHeadLinks()}
    <title>หนังสือรับรองการทำงาน</title>
    <style>${certificateStyles()}</style>
  </head>
  <body>
    <main class="page">
      ${letterheadHtml(payload)}
      <h1 class="doc-title">หนังสือรับรอง</h1>
      <div class="doc-date">วันที่ ${issuedDateUnbroken}</div>
      ${bodyContent}
      <p class="certify">ขอรับรองว่าข้อความข้างต้นนี้ เป็นความจริงทุกประการ</p>
      ${signatureBlockHtml(payload)}
      ${footerNote ? `<div class="footer-note">${htmlEscape(footerNote)}</div>` : ''}
    </main>
  </body>
</html>`;
}

export function openEmploymentCertificatePrintWindow(): EmploymentCertificatePrintWindow {
  if (Platform.OS !== 'web') return null;
  const w = window.open('', '_blank');
  if (!w) return null;
  w.document.write(`<!doctype html><html><body>กำลังเตรียมหนังสือรับรอง...</body></html>`);
  w.document.close();
  return w;
}

export async function prepareEmploymentCertificateHtml(
  payload: EmploymentCertificatePayload
): Promise<string> {
  const resolved = await resolveCertificateAssets(payload);
  return buildEmploymentCertificateHtml(resolved);
}

export async function exportEmploymentCertificatePdf(
  payload: EmploymentCertificatePayload,
  printWindow?: EmploymentCertificatePrintWindow
): Promise<void> {
  const html = await prepareEmploymentCertificateHtml(payload);
  const title = payload.withSalary
    ? 'หนังสือรับรองการทำงาน (ระบุเงินเดือน)'
    : 'หนังสือรับรองการทำงาน';

  if (Platform.OS === 'web') {
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      await waitForPrintDocumentReady(printWindow.document);
      printWindow.focus();
      printWindow.print();
      return;
    }
    await printHtmlInBrowserWindow(html);
    return;
  }

  const pdf = await Print.printToFileAsync({ html, ...expoPrintPageOptions });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(pdf.uri, {
      mimeType: 'application/pdf',
      dialogTitle: title,
    });
  }
}
