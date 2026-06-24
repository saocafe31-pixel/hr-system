import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { formatPayrollCycleChipTh, formatPayrollPeriodRangeTh } from '@/lib/leaveLateRules';
import { money } from '@/lib/payroll';
import type { PayslipYearToDate } from '@/lib/payrollSlipYtd';
import type { PayrollCompanyInfo } from '@/lib/payrollCompanyInfo';
import { expoPrintPageOptions, printDocumentScreenCss, printViewportMeta, PRINT_PAGE_WIDTH_PX } from '@/lib/printDocumentSizing';
import type { PayrollItemKind, PayrollItemRow, PayrollSlipRow } from '@/lib/types';

type PayslipEmployeeInfo = {
  name?: string | null;
  employeeCode?: string | null;
  position?: string | null;
  paymentMethod?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
};

type ExportPayslipPdfInput = {
  slip: PayrollSlipRow;
  items: PayrollItemRow[];
  employee?: PayslipEmployeeInfo;
  company?: PayrollCompanyInfo | null;
  yearToDate?: PayslipYearToDate | null;
};

export type PayslipPrintWindow = Window | null;

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function itemKindTitle(kind: PayrollItemKind): string {
  if (kind === 'income') return 'รายได้';
  if (kind === 'deduction') return 'รายการหัก';
  return 'เงินคืน/เบิกจ่าย';
}

function itemGroupHtml(kind: PayrollItemKind, rows: PayrollItemRow[]): string {
  const groupRows = rows.filter((row) => row.item_kind === kind);
  if (groupRows.length === 0) return '';
  const total = groupRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return `
    <section class="group">
      <div class="group-title">
        <span>${htmlEscape(itemKindTitle(kind))}</span>
        <strong>${htmlEscape(money(total))} บาท</strong>
      </div>
      <table>
        <tbody>
          ${groupRows
            .map(
              (row) => `
                <tr>
                  <td>
                    ${htmlEscape(row.label)}
                    ${row.taxable ? '<span class="tag">คิดภาษี</span>' : ''}
                  </td>
                  <td class="amount">${htmlEscape(money(Number(row.amount || 0)))} บาท</td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </section>
  `;
}

export function buildPayslipHtml({ slip, items, employee, company, yearToDate }: ExportPayslipPdfInput): string {
  const employeeName = employee?.name?.trim() || 'พนักงาน';
  const employeeCode = employee?.employeeCode?.trim() || '';
  const employeePosition = employee?.position?.trim() || '';
  const paymentMethod = employee?.paymentMethod?.trim() || '';
  const bankName = employee?.bankName?.trim() || '';
  const bankAccount = employee?.bankAccount?.trim() || '';
  const companyName = company?.name?.trim() || '';
  const companyAddressLines = company?.addressLines?.map((line) => line.trim()).filter(Boolean) ?? [];
  const companyJuristicId = company?.juristicId?.trim() || '';
  const hasCompanyInfo = Boolean(companyName || companyAddressLines.length || companyJuristicId);
  const confirmedAt = slip.confirmed_at
    ? new Intl.DateTimeFormat('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Bangkok',
      }).format(new Date(slip.confirmed_at))
    : '-';

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      ${printViewportMeta()}
      <title>Payslip ${htmlEscape(slip.cycle_key)}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; -webkit-text-size-adjust: none; text-size-adjust: none; }
        @page { size: A4; margin: 14mm; }
        html { font-size: 12pt; }
        body {
          font-family: 'Sarabun', Arial, sans-serif;
          font-size: 12pt;
          color: #1f2d25;
          margin: 0;
          padding: 21pt;
          background: #ffffff;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .sheet {
          width: ${PRINT_PAGE_WIDTH_PX}px;
          max-width: ${PRINT_PAGE_WIDTH_PX}px;
          margin: 0 auto;
          border: 1px solid #ccd8cf;
          border-radius: 18px;
          overflow: hidden;
        }
        .header {
          padding: 22px 24px;
          background: #e6f1e8;
          border-bottom: 1px solid #ccd8cf;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
          flex-wrap: nowrap;
        }
        .company {
          flex: 1 1 50%;
          min-width: 180px;
        }
        .company-name {
          font-size: 12pt;
          font-weight: 800;
          margin-bottom: 4pt;
          word-break: keep-all;
          overflow-wrap: anywhere;
          line-height: 1.35;
        }
        .company-line {
          font-size: 8pt;
          color: #526457;
          line-height: 1.45;
          word-break: keep-all;
          overflow-wrap: anywhere;
        }
        .document-title {
          flex: 0 0 auto;
          min-width: 200px;
          text-align: right;
        }
        h1 {
          margin: 0;
          font-size: 18pt;
          letter-spacing: .2px;
        }
        .subtitle {
          margin-top: 4pt;
          font-size: 10pt;
          color: #526457;
        }
        .employee-line {
          margin-top: 3pt;
          font-size: 10pt;
          color: #526457;
          line-height: 1.45;
        }
        .content { padding: 22px 24px 26px; }
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 18px;
        }
        .info-card {
          border: 1px solid #dbe5dc;
          border-radius: 12px;
          padding: 12px;
          background: #f7faf7;
        }
        .payment-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin: -4px 0 18px;
        }
        .label {
          display: block;
          font-size: 8pt;
          color: #6c7b70;
          margin-bottom: 3pt;
        }
        .value {
          font-size: 10.5pt;
          font-weight: 700;
          color: #1f2d25;
        }
        .net {
          margin: 16px 0 18px;
          padding: 16px;
          border-radius: 14px;
          background: #f0f7df;
          border: 1px solid #cbdc9b;
        }
        .net .label { color: #5f6f36; }
        .net .value { font-size: 20pt; color: #425c12; }
        .summary {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 14px;
        }
        .summary-card {
          border: 1px solid #dbe5dc;
          border-radius: 12px;
          padding: 10px;
        }
        .summary-card strong {
          display: block;
          margin-top: 3pt;
          font-size: 11pt;
        }
        .group { margin-top: 16px; }
        .group-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 12px;
          border-radius: 12px 12px 0 0;
          background: #f2f7f2;
          border: 1px solid #dbe5dc;
          border-bottom: 0;
          font-size: 10.5pt;
          font-weight: 800;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9pt;
        }
        td {
          border: 1px solid #dbe5dc;
          padding: 9px 10px;
          vertical-align: top;
        }
        .amount {
          width: 160px;
          text-align: right;
          font-weight: 700;
        }
        .tag {
          display: inline-block;
          margin-left: 6px;
          padding: 2px 6px;
          border-radius: 999px;
          background: #fff3cd;
          color: #785f00;
          font-size: 7.5pt;
          font-weight: 700;
        }
        .note {
          margin-top: 14pt;
          font-size: 8pt;
          color: #6c7b70;
          line-height: 1.5;
        }
        .ytd-section {
          margin-top: 20px;
          padding: 14px 16px;
          border-radius: 14px;
          background: #f7faf7;
          border: 1px solid #dbe5dc;
        }
        .ytd-title {
          font-size: 9pt;
          font-weight: 800;
          color: #425c12;
          margin-bottom: 8pt;
        }
        .ytd-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .ytd-card {
          border: 1px solid #dbe5dc;
          border-radius: 12px;
          padding: 12px;
          background: #fff;
        }
        .ytd-card strong {
          display: block;
          margin-top: 4pt;
          font-size: 12pt;
          color: #1f2d25;
        }
        .ytd-hint {
          margin-top: 6pt;
          font-size: 7.5pt;
          color: #6c7b70;
          line-height: 1.45;
        }
        @media print {
          html, body { font-size: 12pt; padding: 0; }
          body { padding: 0; }
          .sheet { border-radius: 0; border: 0; width: auto; max-width: none; min-width: 0; }
        }

        ${printDocumentScreenCss('main.sheet, .sheet')}
      </style>
    </head>
    <body>
      <main class="sheet">
        <header class="header">
          <div class="company">
            ${
              hasCompanyInfo
                ? `<div class="company-name">${htmlEscape(companyName || 'บริษัท')}</div>
                  ${companyAddressLines
                    .map((line) => `<div class="company-line">${htmlEscape(line)}</div>`)
                    .join('')}
                  ${
                    companyJuristicId
                      ? `<div class="company-line">เลขนิติบุคคล ${htmlEscape(companyJuristicId)}</div>`
                      : ''
                  }`
                : `<div class="company-name">ยังไม่ได้ตั้งค่าข้อมูลบริษัท</div>
                  <div class="company-line">ตั้งค่าได้ที่ app_settings key: payroll_company_info</div>`
            }
          </div>
          <div class="document-title">
            <h1>สลิปเงินเดือน</h1>
            <div class="subtitle">${htmlEscape(formatPayrollCycleChipTh(slip.cycle_key))} · ${htmlEscape(
              formatPayrollPeriodRangeTh(slip.period_start, slip.period_end)
            )}</div>
          </div>
        </header>
        <section class="content">
          <div class="info-grid">
            <div class="info-card">
              <span class="label">พนักงาน</span>
              <div class="value">${htmlEscape(employeeName)}</div>
              ${employeeCode ? `<div class="employee-line">รหัสพนักงาน ${htmlEscape(employeeCode)}</div>` : ''}
              ${employeePosition ? `<div class="employee-line">${htmlEscape(employeePosition)}</div>` : ''}
            </div>
            <div class="info-card">
              <span class="label">สถานะสลิป</span>
              <div class="value">${slip.status === 'confirmed' ? 'ยืนยันแล้ว' : 'Draft'}</div>
              <div class="subtitle">ยืนยันเมื่อ ${htmlEscape(confirmedAt)}</div>
            </div>
          </div>

          ${
            paymentMethod || bankName || bankAccount
              ? `<div class="payment-grid">
                  <div class="info-card">
                    <span class="label">ช่องทางรับเงิน</span>
                    <div class="value">${htmlEscape(paymentMethod || 'โอนผ่านบัญชีธนาคาร')}</div>
                  </div>
                  <div class="info-card">
                    <span class="label">ธนาคาร</span>
                    <div class="value">${htmlEscape(bankName || '-')}</div>
                  </div>
                  <div class="info-card">
                    <span class="label">เลขบัญชีธนาคาร</span>
                    <div class="value">${htmlEscape(bankAccount || '-')}</div>
                  </div>
                </div>`
              : ''
          }

          <div class="net">
            <span class="label">เงินสุทธิ</span>
            <div class="value">${htmlEscape(money(Number(slip.net_pay || 0)))} บาท</div>
          </div>

          <div class="summary">
            <div class="summary-card">
              <span class="label">รายได้</span>
              <strong>${htmlEscape(money(Number(slip.income_total || 0)))} บาท</strong>
            </div>
            <div class="summary-card">
              <span class="label">เงินคืน/เบิกจ่าย</span>
              <strong>${htmlEscape(money(Number(slip.reimbursement_total || 0)))} บาท</strong>
            </div>
            <div class="summary-card">
              <span class="label">รายการหัก</span>
              <strong>${htmlEscape(money(Number(slip.deduction_total || 0)))} บาท</strong>
            </div>
          </div>

          ${itemGroupHtml('income', items)}
          ${itemGroupHtml('deduction', items)}
          ${itemGroupHtml('reimbursement', items)}

          ${
            yearToDate
              ? `<section class="ytd-section">
                  <div class="ytd-title">ยอดสะสมปี ${htmlEscape(yearToDate.year + 543)} · ถึงรอบ ${htmlEscape(formatPayrollCycleChipTh(slip.cycle_key))}</div>
                  <div class="ytd-grid">
                    <div class="ytd-card">
                      <span class="label">รายได้สะสม (คิดภาษี)</span>
                      <strong>${htmlEscape(money(yearToDate.taxableIncomeYtd))} บาท</strong>
                    </div>
                    <div class="ytd-card">
                      <span class="label">ประกันสังคมสะสม</span>
                      <strong>${htmlEscape(money(yearToDate.socialSecurityYtd))} บาท</strong>
                    </div>
                  </div>
                  <div class="ytd-hint">รวมเฉพาะสลิปที่ยืนยัน/จ่ายแล้ว และรอบปัจจุบัน · ไม่รวมสลิปที่ยกเลิก</div>
                </section>`
              : ''
          }

          <p class="note">
            เอกสารนี้สร้างจากระบบ HR System โดยอ้างอิงข้อมูลสลิป ณ เวลาที่พิมพ์/ดาวน์โหลด
            ${slip.notes ? `<br />หมายเหตุ: ${htmlEscape(slip.notes)}` : ''}
          </p>
        </section>
      </main>
    </body>
  </html>`;
}

export function openPayslipPrintWindow(): PayslipPrintWindow {
  if (Platform.OS !== 'web') return null;
  const w = window.open('', '_blank');
  if (!w) return null;
  w.document.write(`<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      ${printViewportMeta()}
      <title>Preparing payslip</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #1f2d25; }
      </style>
    </head>
    <body>กำลังเตรียมสลิปเงินเดือน...</body>
  </html>`);
  w.document.close();
  return w;
}

export async function exportPayslipPdf(
  input: ExportPayslipPdfInput,
  printWindow?: PayslipPrintWindow
): Promise<void> {
  const html = buildPayslipHtml(input);
  if (Platform.OS === 'web') {
    const w = printWindow ?? window.open('', '_blank');
    if (!w) throw new Error('ไม่สามารถเปิดหน้าต่างพิมพ์ได้ กรุณาอนุญาต popup ในเบราว์เซอร์');
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
    return;
  }

  const pdf = await Print.printToFileAsync({ html, ...expoPrintPageOptions });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(pdf.uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'ดาวน์โหลดสลิปเงินเดือน (PDF)',
    });
  }
}
