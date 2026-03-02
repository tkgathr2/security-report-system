import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

const FONT_PATHS = [
  '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
  '/usr/share/fonts/truetype/ipafont-gothic/ipag.ttf',
  '/usr/share/fonts/opentype/ipafont/ipag.ttf',
  '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
];

function findJapaneseFont(): string | null {
  for (const p of FONT_PATHS) {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

function loadLogo(): Buffer | null {
  const candidates = [
    path.join(__dirname, '../../assets/logo.png'),
    path.join(__dirname, '../assets/logo.png'),
    path.join(process.cwd(), 'assets/logo.png'),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p);
    } catch {
      continue;
    }
  }
  console.warn('[PDF] Logo not found');
  return null;
}

interface ReportData {
  companyName: string;
  workDate: string;
  location: string;
  workName: string;
  supervisorName: string;
  writerName: string;
  guardContents: string[];
  guardOtherText?: string | null;
  guards?: { index: number; name: string; start_time: string; end_time: string; early_overtime_hours?: number | null }[];
  hasQualifier: boolean;
  qualifierName?: string | string[] | null;
  signaturePng?: Buffer | null;
  weather?: string | null;
  notes?: string | null;
  partnerCompanyName?: string | null;
}

export type PdfDesign = 'A'| 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

const GUARD_CONTENT_LABELS: Record<string, string> = {
  'traffic': '交通誘導',
  'pedestrian': '歩行者誘導',
  'construction': '工事関係者・車両の誘導',
  'worker_safety': '作業員の安全確保',
  'property_safety': '占有物の安全確保',
  'detour': '通行止・迂回案内',
  'alternating': '交互通行',
  'other': 'その他'
};

interface DesignColors {
  primary: string;
  secondary: string;
  accent: string;
}

const DESIGN_COLORS: Record<PdfDesign, DesignColors> = {
  A: { primary: '#C85A17', secondary: '#2B4C7E', accent: '#FBE8D8' },
  B: { primary: '#2B4C7E', secondary: '#C85A17', accent: '#EDF1F7' },
  C: { primary: '#1A1A2E', secondary: '#C85A17', accent: '#F0F0F0' },
  D: { primary: '#C85A17', secondary: '#333333', accent: '#FFF3E0' },
  E: { primary: '#C85A17', secondary: '#2B4C7E', accent: '#FAFAFA' },
  F: { primary: '#D4651E', secondary: '#E8872B', accent: '#FFF0E0' },
  G: { primary: '#C85A17', secondary: '#E07B30', accent: '#FDE8D0' },
  H: { primary: '#B5500F', secondary: '#D96B1C', accent: '#FFF5EB' },
  I: { primary: '#D4651E', secondary: '#C85A17', accent: '#FFE8D5' },
  J: { primary: '#E07B30', secondary: '#C85A17', accent: '#FFF3E6' },
};

export const DESIGN_NAMES: Record<PdfDesign, string> = {
  A: 'Executive',
  B: 'Modern',
  C: 'Corporate',
  D: 'Bold',
  E: 'Clean',
  F: 'Sunset',
  G: 'Flame',
  H: 'Citrus',
  I: 'Amber',
  J: 'Blaze',
};

const GUARD_CONTENT_ALL = [
  { key: 'traffic', label: '交通誘導' },
  { key: 'pedestrian', label: '①歩行者誘導' },
  { key: 'vehicle', label: '②一般車両の誘導' },
  { key: 'construction', label: '③工事関係者,車両の誘導' },
  { key: 'worker_safety', label: '④作業員の安全確保' },
  { key: 'property_safety', label: '⑤占有物の安全確保' },
  { key: 'detour', label: '⑥通行止・迂回案内' },
  { key: 'alternating', label: '⑦交互通行' },
  { key: 'other', label: '⑧その他' },
];

function toReiwa(dateStr: string): { year: number; month: number; day: number; dayOfWeek: string } {
  const match = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!match) return { year: 7, month: 1, day: 1, dayOfWeek: '月' };
  const y = parseInt(match[1]);
  const m = parseInt(match[2]);
  const d = parseInt(match[3]);
  const reiwaYear = y - 2018;
  const dow = ['日', '月', '火', '水', '木', '金', '土'];
  const date = new Date(y, m - 1, d);
  return { year: reiwaYear, month: m, day: d, dayOfWeek: dow[date.getDay()] };
}

function weatherToJapanese(weather?: string | null): { sunny: boolean; cloudy: boolean; rainy: boolean } {
  if (!weather) return { sunny: false, cloudy: false, rainy: false };
  const w = weather.toLowerCase();
  return {
    sunny: w === 'sunny' || w === 'clear' || w === '晴れ' || w === '晴',
    cloudy: w === 'cloudy' || w === '曇り' || w === '曇',
    rainy: w === 'rainy' || w === '雨' || w === 'stormy' || w === '嵐',
  };
}

function truncateText(doc: PDFKit.PDFDocument, text: string, maxWidth: number, fontSize: number): string {
  doc.fontSize(fontSize);
  if (doc.widthOfString(text) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && doc.widthOfString(truncated + '…') > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

function drawCell(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  text: string, fontSize: number,
  options?: { align?: 'left' | 'center' | 'right'; padding?: number }
) {
  const pad = options?.padding ?? 3;
  const align = options?.align ?? 'left';
  const displayText = truncateText(doc, text, w - pad * 2, fontSize);
  doc.fontSize(fontSize);
  const textHeight = doc.heightOfString(displayText, { width: w - pad * 2 });
  const ty = y + (h - textHeight) / 2;
  doc.text(displayText, x + pad, ty, { width: w - pad * 2, align, lineBreak: false });
}

export type PdfLayout = 'classic' | 'handwritten';

interface ReportDataWithLayout extends ReportData {
  layout?: PdfLayout;
  design?: PdfDesign;
}

export async function generateReportPdf(data: ReportDataWithLayout): Promise<Buffer> {
  const layout = data.layout || 'classic';
  if (layout === 'classic') {
    const { generateReportPdfClassic } = await import('./pdfGeneratorClassic');
    return generateReportPdfClassic(data, data.design || 'A');
  }
  return generateReportPdfHandwritten(data);
}

async function generateReportPdfHandwritten(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 25, bottom: 0, left: 25, right: 25 },
        autoFirstPage: true,
        bufferPages: true,
        info: {
          Title: 'デジタル警備報告書システム【ほうこちゃん】',
          Author: 'デジタル警備報告書システム【ほうこちゃん】',
          Subject: `警備報告書 - ${data.companyName} - ${data.workDate}`
        }
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fontPath = findJapaneseFont();
      if (fontPath) {
        doc.registerFont('IPAGothic', fontPath);
        doc.font('IPAGothic');
      } else {
        console.warn('[PDF] No Japanese font found, using default Helvetica');
        doc.font('Helvetica');
      }

      const logoBuffer = loadLogo();

      const W = 841.89;
      const H = 595.28;
      const ML = 25;
      const MR = 25;
      const MT = 25;
      const CW = W - ML - MR;

      const BORDER = '#333333';
      const LW = 0.8;
      const THIN = 0.4;
      const TEXT_COLOR = '#1A1A1A';
      const HEADER_BG = '#F5F0E8';

      const reiwa = toReiwa(data.workDate);
      const weatherState = weatherToJapanese(data.weather);

      const LEFT_W = 250;
      const RIGHT_W = CW - LEFT_W;

      const FORM_TOP = MT;
      const FORM_H = H - MT - 20;
      const FORM_BOTTOM = FORM_TOP + FORM_H;

      doc.save();
      doc.rect(ML, FORM_TOP, CW, FORM_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.restore();

      const TITLE_H = 36;
      doc.save();
      doc.rect(ML, FORM_TOP, LEFT_W, TITLE_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.restore();

      doc.fillColor(TEXT_COLOR);
      const titleChars = ['警', '備', '報', '告', '書'];
      titleChars.forEach((ch, i) => {
        doc.fontSize(22).text(ch, ML + 30 + i * 32, FORM_TOP + 6, { lineBreak: false });
      });

      const GUARD_SECTION_TOP = FORM_TOP + TITLE_H;
      const GUARD_SECTION_H = 160;

      doc.save();
      doc.rect(ML, GUARD_SECTION_TOP, LEFT_W, GUARD_SECTION_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.restore();

      doc.fillColor(TEXT_COLOR).fontSize(10);
      doc.text('警　備　内　容', ML + 70, GUARD_SECTION_TOP + 5, { lineBreak: false });

      const checkY = GUARD_SECTION_TOP + 22;
      const checkX = ML + 10;
      const lineH = 15;

      const selectedContents = new Set(data.guardContents.map(c => {
        const label = GUARD_CONTENT_LABELS[c];
        return label || c;
      }));

      const isChecked = (item: { key: string; label: string }): boolean => {
        if (selectedContents.has(item.key)) return true;
        for (const sel of selectedContents) {
          if (item.label.includes(sel) || sel.includes(item.label.replace(/[①②③④⑤⑥⑦⑧]/g, ''))) return true;
        }
        return false;
      };

      doc.fontSize(8);
      GUARD_CONTENT_ALL.forEach((item, i) => {
        const y = checkY + i * lineH;
        const checked = isChecked(item);
        if (i === 0) {
          const mark = checked ? '☑' : '☐';
          doc.fillColor(TEXT_COLOR).text(`${mark} ${item.label}`, checkX, y, { lineBreak: false });
        } else {
          const mark = checked ? '☑' : '　';
          doc.fillColor(TEXT_COLOR).text(`${mark} ${item.label}`, checkX + 10, y, { lineBreak: false });
        }
      });

      const otherTextY = checkY + GUARD_CONTENT_ALL.length * lineH + 2;
      const otherText = data.guardOtherText ? `（ ${data.guardOtherText} ）` : '（　　　　　　　　　　　　）';
      doc.fillColor(TEXT_COLOR).fontSize(8).text(otherText, checkX, otherTextY, { lineBreak: false });

      const QUALIFIER_TOP = GUARD_SECTION_TOP + GUARD_SECTION_H;
      const QUALIFIER_H = 22;
      doc.save();
      doc.rect(ML, QUALIFIER_TOP, LEFT_W, QUALIFIER_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.restore();

      const qNames = Array.isArray(data.qualifierName) ? data.qualifierName.filter((n: string) => n && n.trim() !== '') : (data.qualifierName ? [data.qualifierName] : []);
      const hasQ = data.hasQualifier;
      const qualText = `資格者　${hasQ ? '◉有' : '有'}・${hasQ ? '無' : '◉無'}`;
      doc.fillColor(TEXT_COLOR).fontSize(9).text(qualText, ML + 10, QUALIFIER_TOP + 5, { lineBreak: false });
      if (qNames.length > 0) {
        doc.fontSize(8).text(`（${qNames.join('、')}）`, ML + 130, QUALIFIER_TOP + 6, { lineBreak: false });
      }

      const NOTES_TOP = QUALIFIER_TOP + QUALIFIER_H;
      const NOTES_H = 40;
      doc.save();
      doc.rect(ML, NOTES_TOP, LEFT_W, NOTES_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.restore();
      doc.fillColor(TEXT_COLOR).fontSize(8).text('備考', ML + 5, NOTES_TOP + 3, { lineBreak: false });
      if (data.notes && data.notes.trim()) {
        doc.fillColor(TEXT_COLOR).fontSize(7).text(data.notes.trim(), ML + 5, NOTES_TOP + 14, { width: LEFT_W - 10, height: NOTES_H - 16, ellipsis: true });
      }

      const COMPANY_INFO_TOP = NOTES_TOP + NOTES_H;
      const COMPANY_INFO_H = FORM_BOTTOM - COMPANY_INFO_TOP;
      doc.save();
      doc.rect(ML, COMPANY_INFO_TOP, LEFT_W, COMPANY_INFO_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.restore();

      if (logoBuffer) {
        try {
          doc.image(logoBuffer, ML + 10, COMPANY_INFO_TOP + 5, { height: 28 });
        } catch { /* logo load failure is non-fatal */ }
      }

      doc.fillColor(TEXT_COLOR).fontSize(7);
      const compInfoX = ML + 10;
      const compInfoY = COMPANY_INFO_TOP + 38;
      doc.text('株式会社　日本交通誘導', compInfoX, compInfoY, { lineBreak: false });
      doc.text('〒540-0031', compInfoX, compInfoY + 11, { lineBreak: false });
      doc.text('大阪市中央区北浜東4-33北浜 NEXUBUILD 17階', compInfoX, compInfoY + 22, { lineBreak: false });
      doc.text('TEL.06-4400-8747  FAX.06-6941-1332', compInfoX, compInfoY + 33, { lineBreak: false });

      const RX = ML + LEFT_W;

      const HEADER_ROWS_TOP = FORM_TOP;
      const ROW_H = 28;

      const COL1_W = 100;
      const COL2_W = RIGHT_W - COL1_W;

      doc.save();
      doc.rect(RX, HEADER_ROWS_TOP, COL1_W, ROW_H).fill(HEADER_BG);
      doc.rect(RX, HEADER_ROWS_TOP, RIGHT_W, ROW_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.moveTo(RX + COL1_W, HEADER_ROWS_TOP).lineTo(RX + COL1_W, HEADER_ROWS_TOP + ROW_H).lineWidth(THIN).stroke();
      doc.restore();

      doc.fillColor(TEXT_COLOR);
      drawCell(doc, RX, HEADER_ROWS_TOP, COL1_W, ROW_H, '協力会社名', 9, { align: 'center' });
      const companyLine = data.partnerCompanyName
        ? `${data.companyName}　御中（協力会社名：${data.partnerCompanyName}依頼分）`
        : `${data.companyName}　御中`;
      drawCell(doc, RX + COL1_W, HEADER_ROWS_TOP, COL2_W, ROW_H, companyLine, 11, { padding: 8 });

      const ROW2_Y = HEADER_ROWS_TOP + ROW_H;
      const dateColW = COL2_W * 0.55;
      const dayColW = COL2_W * 0.22;
      const weatherColW = COL2_W - dateColW - dayColW;

      doc.save();
      doc.rect(RX, ROW2_Y, COL1_W, ROW_H).fill(HEADER_BG);
      doc.rect(RX, ROW2_Y, RIGHT_W, ROW_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.moveTo(RX + COL1_W, ROW2_Y).lineTo(RX + COL1_W, ROW2_Y + ROW_H).lineWidth(THIN).stroke();
      doc.moveTo(RX + COL1_W + dateColW, ROW2_Y).lineTo(RX + COL1_W + dateColW, ROW2_Y + ROW_H).lineWidth(THIN).stroke();
      doc.moveTo(RX + COL1_W + dateColW + dayColW, ROW2_Y).lineTo(RX + COL1_W + dateColW + dayColW, ROW2_Y + ROW_H).lineWidth(THIN).stroke();
      doc.restore();

      doc.fillColor(TEXT_COLOR);
      drawCell(doc, RX, ROW2_Y, COL1_W, ROW_H, '依頼分', 9, { align: 'center' });
      drawCell(doc, RX + COL1_W, ROW2_Y, dateColW, ROW_H,
        `R${reiwa.year}　年　${reiwa.month}　月　${reiwa.day}　日`, 10, { padding: 8 });
      drawCell(doc, RX + COL1_W + dateColW, ROW2_Y, dayColW, ROW_H,
        `${reiwa.dayOfWeek}曜日`, 10, { align: 'center' });

      const sunnyMark = weatherState.sunny ? '◉晴' : '晴';
      const cloudyMark = weatherState.cloudy ? '◉曇' : '曇';
      const rainyMark = weatherState.rainy ? '◉雨' : '雨';
      drawCell(doc, RX + COL1_W + dateColW + dayColW, ROW2_Y, weatherColW, ROW_H,
        `${sunnyMark}・${cloudyMark}・${rainyMark}`, 9, { align: 'center' });

      const ROW3_Y = ROW2_Y + ROW_H;
      doc.save();
      doc.rect(RX, ROW3_Y, COL1_W, ROW_H).fill(HEADER_BG);
      doc.rect(RX, ROW3_Y, RIGHT_W, ROW_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.moveTo(RX + COL1_W, ROW3_Y).lineTo(RX + COL1_W, ROW3_Y + ROW_H).lineWidth(THIN).stroke();
      doc.restore();
      doc.fillColor(TEXT_COLOR);
      drawCell(doc, RX, ROW3_Y, COL1_W, ROW_H, '勤務場所', 9, { align: 'center' });
      drawCell(doc, RX + COL1_W, ROW3_Y, COL2_W, ROW_H, data.location, 10, { padding: 8 });

      const ROW4_Y = ROW3_Y + ROW_H;
      doc.save();
      doc.rect(RX, ROW4_Y, COL1_W, ROW_H).fill(HEADER_BG);
      doc.rect(RX, ROW4_Y, RIGHT_W, ROW_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.moveTo(RX + COL1_W, ROW4_Y).lineTo(RX + COL1_W, ROW4_Y + ROW_H).lineWidth(THIN).stroke();
      doc.restore();
      doc.fillColor(TEXT_COLOR);
      drawCell(doc, RX, ROW4_Y, COL1_W, ROW_H, '作業名称', 9, { align: 'center' });
      drawCell(doc, RX + COL1_W, ROW4_Y, COL2_W, ROW_H, data.workName, 10, { padding: 8 });

      const META_Y = ROW4_Y + ROW_H;
      const META_H = 22;
      const metaCol1 = RIGHT_W * 0.25;
      const metaCol2 = RIGHT_W * 0.25;
      const metaCol3 = RIGHT_W * 0.25;
      const metaCol4 = RIGHT_W * 0.25;

      doc.save();
      doc.rect(RX, META_Y, metaCol1, META_H).fill(HEADER_BG);
      doc.rect(RX + metaCol1 + metaCol2, META_Y, metaCol3, META_H).fill(HEADER_BG);
      doc.rect(RX, META_Y, RIGHT_W, META_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.moveTo(RX + metaCol1, META_Y).lineTo(RX + metaCol1, META_Y + META_H).lineWidth(THIN).stroke();
      doc.moveTo(RX + metaCol1 + metaCol2, META_Y).lineTo(RX + metaCol1 + metaCol2, META_Y + META_H).lineWidth(THIN).stroke();
      doc.moveTo(RX + metaCol1 + metaCol2 + metaCol3, META_Y).lineTo(RX + metaCol1 + metaCol2 + metaCol3, META_Y + META_H).lineWidth(THIN).stroke();
      doc.restore();

      doc.fillColor(TEXT_COLOR);
      drawCell(doc, RX, META_Y, metaCol1, META_H, '監督者', 8, { align: 'center' });
      drawCell(doc, RX + metaCol1, META_Y, metaCol2, META_H, data.supervisorName, 9, { align: 'center' });
      drawCell(doc, RX + metaCol1 + metaCol2, META_Y, metaCol3, META_H, '記入者', 8, { align: 'center' });
      drawCell(doc, RX + metaCol1 + metaCol2 + metaCol3, META_Y, metaCol4, META_H, data.writerName, 9, { align: 'center' });

      const TABLE_TOP = META_Y + META_H;
      const TABLE_BOTTOM = FORM_BOTTOM;
      const TABLE_H = TABLE_BOTTOM - TABLE_TOP;
      const HEADER_ROW_H = 22;
      const MAX_GUARDS = 7;
      const TOTAL_ROW_H = 22;
      const GUARD_ROW_H = Math.min(
        Math.floor((TABLE_H - HEADER_ROW_H - TOTAL_ROW_H) / MAX_GUARDS),
        35
      );

      const numCol = 25;
      const nameCol = RIGHT_W * 0.25;
      const qualNameCol = RIGHT_W * 0.20;
      const timeCol = RIGHT_W * 0.22;
      const overtimeCol = RIGHT_W * 0.15;
      const hCol = RIGHT_W - numCol - nameCol - qualNameCol - timeCol - overtimeCol;

      doc.save();
      doc.rect(RX, TABLE_TOP, RIGHT_W, HEADER_ROW_H).fill(HEADER_BG);
      doc.rect(RX, TABLE_TOP, RIGHT_W, TABLE_H).lineWidth(LW).strokeColor(BORDER).stroke();
      doc.restore();

      const colXs = [
        RX,
        RX + numCol,
        RX + numCol + nameCol,
        RX + numCol + nameCol + qualNameCol,
        RX + numCol + nameCol + qualNameCol + timeCol,
        RX + numCol + nameCol + qualNameCol + timeCol + overtimeCol,
        RX + RIGHT_W,
      ];
      const colWs = [numCol, nameCol, qualNameCol, timeCol, overtimeCol, hCol];

      for (let i = 1; i < colXs.length - 1; i++) {
        doc.save();
        doc.moveTo(colXs[i], TABLE_TOP).lineTo(colXs[i], TABLE_TOP + TABLE_H).lineWidth(THIN).strokeColor(BORDER).stroke();
        doc.restore();
      }

      doc.save();
      doc.moveTo(RX, TABLE_TOP + HEADER_ROW_H).lineTo(RX + RIGHT_W, TABLE_TOP + HEADER_ROW_H).lineWidth(THIN).strokeColor(BORDER).stroke();
      doc.restore();

      doc.fillColor(TEXT_COLOR);
      const tableHeaders = ['', '警備員氏名', '資格者氏名', '勤務時間', '早出残業', 'H'];
      tableHeaders.forEach((h, i) => {
        drawCell(doc, colXs[i], TABLE_TOP, colWs[i], HEADER_ROW_H, h, 8, { align: 'center' });
      });

      const guards = data.guards || [];
      for (let i = 0; i < MAX_GUARDS; i++) {
        const rowY = TABLE_TOP + HEADER_ROW_H + i * GUARD_ROW_H;
        doc.save();
        doc.moveTo(RX, rowY).lineTo(RX + RIGHT_W, rowY).lineWidth(THIN).strokeColor(BORDER).stroke();
        doc.restore();

        doc.fillColor(TEXT_COLOR);
        drawCell(doc, colXs[0], rowY, colWs[0], GUARD_ROW_H, String(i + 1), 8, { align: 'center' });

        if (i < guards.length) {
          const g = guards[i];
          drawCell(doc, colXs[1], rowY, colWs[1], GUARD_ROW_H, g.name || '', 9, { padding: 5 });

          const qNameForGuard = qNames.length > i ? String(qNames[i]) : '';
          drawCell(doc, colXs[2], rowY, colWs[2], GUARD_ROW_H, qNameForGuard, 8, { padding: 5 });

          const timeStr = (g.start_time && g.end_time) ? `${g.start_time} ～ ${g.end_time}` : '';
          drawCell(doc, colXs[3], rowY, colWs[3], GUARD_ROW_H, timeStr, 9, { align: 'center' });

          const overtime = g.early_overtime_hours !== undefined && g.early_overtime_hours !== null ? String(g.early_overtime_hours) : '';
          drawCell(doc, colXs[4], rowY, colWs[4], GUARD_ROW_H, overtime, 9, { align: 'center' });

          drawCell(doc, colXs[5], rowY, colWs[5], GUARD_ROW_H, 'H', 8, { align: 'center' });
        } else {
          drawCell(doc, colXs[5], rowY, colWs[5], GUARD_ROW_H, 'H', 8, { align: 'center' });
        }
      }

      const totalRowY = TABLE_TOP + HEADER_ROW_H + MAX_GUARDS * GUARD_ROW_H;
      doc.save();
      doc.moveTo(RX, totalRowY).lineTo(RX + RIGHT_W, totalRowY).lineWidth(THIN).strokeColor(BORDER).stroke();
      doc.restore();
      drawCell(doc, colXs[0], totalRowY, colWs[0] + colWs[1], TOTAL_ROW_H, '計', 8, { align: 'center' });

      if (data.signaturePng && data.signaturePng.length > 0) {
        const sigAreaTop = FORM_BOTTOM - 80;
        const sigAreaLeft = ML + 10;
        const sigAreaW = LEFT_W - 20;
        const sigAreaH = 70;

        try {
          doc.image(data.signaturePng, sigAreaLeft, sigAreaTop, {
            fit: [sigAreaW, sigAreaH],
            align: 'center',
            valign: 'center'
          });
          doc.save();
          doc.rect(sigAreaLeft, sigAreaTop, sigAreaW, sigAreaH).lineWidth(THIN).strokeColor('#999999').stroke();
          doc.restore();
          doc.fillColor('#999999').fontSize(6).text('署名', sigAreaLeft + 2, sigAreaTop - 8, { lineBreak: false });
        } catch {
          doc.fillColor('#999999').fontSize(7).text('(署名)', ML + 10, FORM_BOTTOM - 20, { lineBreak: false });
        }
      }

      const now = new Date();
      const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const generatedAt = `${jst.getUTCFullYear()}/${String(jst.getUTCMonth() + 1).padStart(2, '0')}/${String(jst.getUTCDate()).padStart(2, '0')} ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
      doc.fillColor('#999999').fontSize(5);
      doc.text(`生成: ${generatedAt} | ほうこちゃん`, ML, H - 15, { width: CW, align: 'right', lineBreak: false });

      const pageRange = doc.bufferedPageRange();
      if (pageRange.count > 1) {
        for (let i = pageRange.count - 1; i > 0; i--) {
          doc.switchToPage(i);
        }
        doc.switchToPage(0);
      }
      doc.flushPages();
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
