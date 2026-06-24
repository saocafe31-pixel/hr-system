const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

function bangkokYmdParts(d = new Date()): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'month')?.value ?? 0);
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? 0);
  return { y, m, day };
}

/** แทนที่ช่องว่างด้วย non-breaking space — กันเลขวันที่/เดือนแตกบรรทัดในเอกสาร */
export function unbreakableThaiText(text: string): string {
  return text.replace(/ /g, '\u00A0');
}

/** วันที่แบบยาว เช่น 30 เมษายน 2569 */
export function formatThaiDateLong(input?: string | Date | null): string {
  if (input instanceof Date) {
    const { y, m, day } = bangkokYmdParts(input);
    if (!y || !m || !day) return '—';
    return `${day} ${THAI_MONTHS[m - 1]} ${y + 543}`;
  }
  const raw = (input ?? '').trim();
  if (!raw) {
    const { y, m, day } = bangkokYmdParts();
    return `${day} ${THAI_MONTHS[m - 1]} ${y + 543}`;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const day = Number(iso[3]);
    if (y && m && day) return `${day} ${THAI_MONTHS[m - 1]} ${y + 543}`;
  }
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const day = Number(dmy[1]);
    const m = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 2400) y += 543;
    if (day && m) return `${day} ${THAI_MONTHS[m - 1]} ${y}`;
  }
  return raw;
}

export function formatSalaryAmount(amount: number): string {
  const n = Math.round(Number(amount) || 0);
  return `${n.toLocaleString('en-US')}.-`;
}

const THAI_DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];

/** อ่านเลข 0–99 (หลักสิบ-หน่วย) */
function readTwoDigits(n: number): string {
  if (n <= 0) return '';
  if (n < 10) return THAI_DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensText = tens === 2 ? 'ยี่สิบ' : tens === 1 ? 'สิบ' : `${THAI_DIGITS[tens]}สิบ`;
  if (ones === 0) return tensText;
  if (ones === 1) return `${tensText}เอ็ด`;
  return `${tensText}${THAI_DIGITS[ones]}`;
}

/** อ่านเลข 0–999 */
function readUpTo999(n: number): string {
  if (n <= 0) return '';
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const hundredText =
    hundred > 0 ? (hundred === 1 ? 'หนึ่งร้อย' : `${THAI_DIGITS[hundred]}ร้อย`) : '';
  return `${hundredText}${readTwoDigits(rest)}`;
}

const BAHT_SCALES: { value: number; unit: string }[] = [
  { value: 1_000_000, unit: 'ล้าน' },
  { value: 100_000, unit: 'แสน' },
  { value: 10_000, unit: 'หมื่น' },
  { value: 1_000, unit: 'พัน' },
];

/** แปลงจำนวนเต็มบาทเป็นข้อความไทย เช่น สามหมื่นบาทถ้วน, หนึ่งหมื่นแปดพันบาทถ้วน */
export function thaiBahtText(amount: number): string {
  const n = Math.round(Math.abs(Number(amount) || 0));
  if (n === 0) return 'ศูนย์บาทถ้วน';

  const parts: string[] = [];
  let remainder = n;

  for (const { value, unit } of BAHT_SCALES) {
    const count = Math.floor(remainder / value);
    if (count > 0) {
      parts.push(`${readUpTo999(count)}${unit}`);
      remainder %= value;
    }
  }

  if (remainder > 0) {
    parts.push(readUpTo999(remainder));
  }

  return `${parts.join('')}บาทถ้วน`;
}
