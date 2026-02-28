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
}

export type PdfDesign= 'A'| 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

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

function drawHeader(
  doc: PDFKit.PDFDocument,
  design: PdfDesign,
  colors: DesignColors,
  logoBuffer: Buffer | null,
  W: number,
  M: number,
  CW: number,
) {
  if (design === 'A') {
    doc.rect(0, 0, W, 70).fill(colors.primary);
    doc.rect(0, 70, W, 4).fill(colors.secondary);
    if (logoBuffer) doc.image(logoBuffer, 12, 10, { height: 45 });
    doc.fillColor('#FFFFFF').fontSize(20).text('警備報告書', M, 14, { width: CW, align: 'right' });
    doc.fillColor('#FFFFFF').fontSize(7).text('SECURITY REPORT', M, 38, { width: CW, align: 'right' });
    doc.fillColor('#FFFFFF').fontSize(6).text('デジタル警備報告書システム【ほうこちゃん】', M, 50, { width: CW, align: 'right' });
    doc.y = 82;
  } else if (design === 'B') {
    doc.rect(0, 0, W, 85).fill(colors.primary);
    doc.rect(0, 0, 8, 85).fill(colors.secondary);
    if (logoBuffer) doc.image(logoBuffer, 22, 10, { height: 28 });
    doc.fillColor('#FFFFFF').fontSize(18).text('警備報告書', M, 42, { width: CW });
    doc.fillColor('#DDDDDD').fontSize(8).text('SECURITY REPORT', M, 42, { width: CW, align: 'right' });
    doc.rect(0, 85, W, 3).fill(colors.secondary);
    doc.y = 100;
  } else if (design === 'C') {
    doc.rect(0, 0, W, 110).fill(colors.primary);
    if (logoBuffer) doc.image(logoBuffer, W / 2 - 100, 12, { height: 32 });
    doc.fillColor(colors.secondary).fontSize(24).text('警備報告書', 0, 56, { width: W, align: 'center' });
    doc.fillColor('#999999').fontSize(7).text('デジタル警備報告書システム【ほうこちゃん】', 0, 84, { width: W, align: 'center' });
    doc.save(); doc.rect(W / 2 - 40, 96, 80, 2).fill(colors.secondary); doc.restore();
    doc.y = 115;
  } else if (design === 'D') {
    doc.rect(0, 0, W, 100).fill('#FFFFFF');
    doc.rect(0, 0, 8, 100).fill(colors.primary);
    if (logoBuffer) doc.image(logoBuffer, 20, 12, { height: 30 });
    doc.fillColor(colors.primary).fontSize(28).text('警備報告書', M, 55, { width: CW, align: 'left' });
    doc.fillColor('#999999').fontSize(8).text('SECURITY REPORT', M, 55, { width: CW, align: 'right' });
    doc.fillColor('#999999').fontSize(7).text('デジタル警備報告書システム【ほうこちゃん】', M, 85, { width: CW, align: 'right' });
    doc.rect(0, 100, W, 3).fill(colors.primary);
    doc.y = 118;
  } else if (design === 'F') {
    doc.rect(0, 0, W, 95).fill(colors.primary);
    doc.rect(0, 95, W, 8).fill(colors.secondary);
    doc.rect(0, 103, W, 3).fill(colors.primary);
    if (logoBuffer) doc.image(logoBuffer, 20, 15, { height: 55 });
    doc.fillColor('#FFFFFF').fontSize(24).text('警備報告書', M, 18, { width: CW, align: 'right' });
    doc.fillColor('#FFE0C0').fontSize(9).text('SECURITY REPORT', M, 48, { width: CW, align: 'right' });
    doc.fillColor('#FFE0C0').fontSize(7).text('デジタル警備報告書システム【ほうこちゃん】', M, 65, { width: CW, align: 'right' });
    doc.y = 118;
  } else if (design === 'G') {
    doc.rect(0, 0, W, 6).fill(colors.primary);
    doc.rect(0, 6, W, 6).fill(colors.secondary);
    if (logoBuffer) doc.image(logoBuffer, M, 22, { height: 30 });
    doc.fillColor(colors.primary).fontSize(26).text('警備報告書', M, 58, { width: CW, align: 'left' });
    doc.fillColor(colors.secondary).fontSize(8).text('SECURITY REPORT', M, 58, { width: CW, align: 'right' });
    doc.fillColor('#999999').fontSize(7).text('デジタル警備報告書システム【ほうこちゃん】', M, 88, { width: CW, align: 'right' });
    doc.rect(0, 100, W, 4).fill(colors.primary);
    doc.rect(0, 104, W, 2).fill(colors.secondary);
    doc.y = 118;
  } else if (design === 'H') {
    doc.rect(0, 0, W, 85).fill(colors.primary);
    doc.save(); doc.moveTo(W - 180, 0).lineTo(W - 130, 85).lineTo(W - 120, 85).lineTo(W - 70, 0).closePath().fill(colors.secondary).opacity(0.3); doc.restore();
    if (logoBuffer) doc.image(logoBuffer, 22, 12, { height: 26 });
    doc.fillColor('#FFFFFF').fontSize(22).text('警備報告書', M, 14, { width: CW, align: 'right' });
    doc.fillColor('#FFD8B8').fontSize(8).text('SECURITY REPORT', M, 42, { width: CW, align: 'right' });
    doc.fillColor('#FFD8B8').fontSize(7).text('デジタル警備報告書システム【ほうこちゃん】', M, 58, { width: CW, align: 'right' });
    doc.rect(0, 85, W, 4).fill(colors.secondary);
    doc.y = 100;
  } else if (design === 'I') {
    doc.rect(0, 0, 12, 110).fill(colors.primary);
    doc.rect(0, 0, W, 5).fill(colors.secondary);
    doc.rect(12, 5, W - 12, 105).fill('#FFFFFF');
    if (logoBuffer) doc.image(logoBuffer, 24, 14, { height: 30 });
    doc.fillColor(colors.primary).fontSize(24).text('警備報告書', M, 50, { width: CW, align: 'left' });
    doc.fillColor(colors.secondary).fontSize(8).text('SECURITY REPORT', M, 50, { width: CW, align: 'right' });
    doc.fillColor('#999999').fontSize(7).text('デジタル警備報告書システム【ほうこちゃん】', M, 85, { width: CW, align: 'right' });
    doc.rect(0, 110, W, 3).fill(colors.primary);
    doc.y = 125;
  } else {
    doc.rect(0, 0, W, 100).fill(colors.primary);
    doc.rect(0, 100, W, 4).fill(colors.secondary);
    if (logoBuffer) doc.image(logoBuffer, W / 2 - 100, 8, { height: 30 });
    doc.fillColor('#FFFFFF').fontSize(26).text('警備報告書', 0, 44, { width: W, align: 'center' });
    doc.fillColor('#FFD8B0').fontSize(8).text('SECURITY REPORT', 0, 74, { width: W, align: 'center' });
    doc.fillColor('#FFD8B0').fontSize(7).text('デジタル警備報告書システム【ほうこちゃん】', 0, 86, { width: W, align: 'center' });
    doc.y = 118;
  }
}

export async function generateReportPdfClassic(data: ReportData, design: PdfDesign = 'A'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 20, bottom: 20, left: 40, right: 40 },
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

      const colors = DESIGN_COLORS[design];
      const logoBuffer = loadLogo();

      const pageWidth = 595.28;
      const marginLeft = 40;
      const contentWidth = pageWidth - marginLeft - 40;

      drawHeader(doc, design, colors, logoBuffer, pageWidth, marginLeft, contentWidth);

      doc.fillColor(colors.secondary).fontSize(11).text(`${data.companyName} 御中`, marginLeft, doc.y);
      doc.moveDown(0.2);
      doc.save(); doc.moveTo(marginLeft, doc.y).lineTo(marginLeft + contentWidth, doc.y).strokeColor('#DDDDDD').lineWidth(0.5).stroke(); doc.restore();
      doc.moveDown(0.3);

      const labelColWidth = 100;
      const valueColWidth = contentWidth - labelColWidth;
      const rowHeight = 20;
      const tableTop = doc.y;

      const infoRows: [string, string][] = [
        ['実施日', data.workDate],
        ['実施場所', data.location],
        ['作業名称', data.workName],
        ['監督者名', data.supervisorName],
        ['記入者名', data.writerName],
      ];

      infoRows.forEach((row, i) => {
        const y = tableTop + i * rowHeight;
        doc.save(); doc.rect(marginLeft, y, labelColWidth, rowHeight).fill(colors.accent); doc.restore();
        doc.save();
        doc.rect(marginLeft, y, contentWidth, rowHeight).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
        doc.moveTo(marginLeft + labelColWidth, y).lineTo(marginLeft + labelColWidth, y + rowHeight).stroke();
        doc.restore();
        doc.fillColor(colors.secondary).fontSize(8).text(row[0], marginLeft + 6, y + 5, { width: labelColWidth - 12 });
        doc.fillColor('#333333').fontSize(8).text(row[1], marginLeft + labelColWidth + 6, y + 5, { width: valueColWidth - 12 });
      });

      doc.y = tableTop + infoRows.length * rowHeight + 6;

      doc.save(); doc.rect(marginLeft, doc.y, contentWidth, 18).fill(colors.secondary); doc.restore();
      doc.fillColor('#FFFFFF').fontSize(9).text('警備内容', marginLeft + 8, doc.y + 4);
      doc.y += 18;

      const guardContentLabels = data.guardContents.map(code =>
        GUARD_CONTENT_LABELS[code] || code
      );

      const contentBoxTop = doc.y;
      let chipX = marginLeft + 6;
      let chipY = contentBoxTop + 5;

      doc.fontSize(7);
      guardContentLabels.forEach(label => {
        const tw = doc.widthOfString(label);
        const cw = tw + 14;
        if (chipX + cw > marginLeft + contentWidth - 6) { chipX = marginLeft + 6; chipY += 18; }
        doc.save(); doc.roundedRect(chipX, chipY, cw, 15, 3).fill(colors.primary); doc.restore();
        doc.fillColor('#FFFFFF').fontSize(7).text(label, chipX + 7, chipY + 3, { width: tw + 4 });
        chipX += cw + 4;
      });

      doc.y = chipY + 20;

      if (data.guardOtherText) {
        doc.fontSize(8).fillColor('#666666').text(`  その他: ${data.guardOtherText}`, marginLeft + 6, doc.y);
        doc.y += 14;
      }

      doc.save(); doc.rect(marginLeft, contentBoxTop, contentWidth, doc.y - contentBoxTop).strokeColor('#DDDDDD').lineWidth(0.5).stroke(); doc.restore();
      doc.moveDown(0.2);

      const qNames = Array.isArray(data.qualifierName) ? data.qualifierName.filter(n => n && n.trim() !== '') : (data.qualifierName ? [data.qualifierName] : []);
      const qualifierText = data.hasQualifier
        ? `有 (${qNames.length > 0 ? qNames.join('、') : '氏名未記入'})`
        : '無';

      const qRowY = doc.y;
      doc.save(); doc.rect(marginLeft, qRowY, labelColWidth, rowHeight).fill(colors.accent); doc.restore();
      doc.save();
      doc.rect(marginLeft, qRowY, contentWidth, rowHeight).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
      doc.moveTo(marginLeft + labelColWidth, qRowY).lineTo(marginLeft + labelColWidth, qRowY + rowHeight).stroke();
      doc.restore();
      doc.fillColor(colors.secondary).fontSize(8).text('資格者', marginLeft + 6, qRowY + 5);
      doc.fillColor('#333333').fontSize(8).text(qualifierText, marginLeft + labelColWidth + 6, qRowY + 5);
      doc.y = qRowY + rowHeight + 6;

      if (data.guards && data.guards.length > 0) {
        doc.save(); doc.rect(marginLeft, doc.y, contentWidth, 18).fill(colors.secondary); doc.restore();
        doc.fillColor('#FFFFFF').fontSize(9).text('警備員一覧', marginLeft + 8, doc.y + 4);
        doc.y += 18;

        const colWidths = [30, 170, 95, 95, 125];
        const colXs = [marginLeft];
        for (let c = 1; c <= colWidths.length; c++) colXs.push(colXs[c - 1] + colWidths[c - 1]);
        const tHeaders = ['No', '氏名', '開始', '終了', '早出残業(h)'];
        const thY = doc.y;

        doc.save(); doc.rect(marginLeft, thY, contentWidth, 16).fill(colors.accent); doc.restore();
        tHeaders.forEach((h, i) => {
          doc.fillColor(colors.secondary).fontSize(7).text(h, colXs[i] + 4, thY + 4, { width: colWidths[i] - 8 });
        });
        doc.save();
        doc.rect(marginLeft, thY, contentWidth, 16).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
        colXs.slice(1, -1).forEach(x => doc.moveTo(x, thY).lineTo(x, thY + 16).stroke());
        doc.restore();
        doc.y = thY + 16;

        data.guards.forEach((g, idx) => {
          const rY = doc.y;
          const rH = 16;
          if (idx % 2 === 1) { doc.save(); doc.rect(marginLeft, rY, contentWidth, rH).fill('#FAFAFA'); doc.restore(); }
          doc.save();
          doc.rect(marginLeft, rY, contentWidth, rH).strokeColor('#EEEEEE').lineWidth(0.3).stroke();
          colXs.slice(1, -1).forEach(x => doc.moveTo(x, rY).lineTo(x, rY + rH).stroke());
          doc.restore();
          doc.fillColor('#333333').fontSize(7);
          doc.text(String(g.index ?? ''), colXs[0] + 4, rY + 4, { width: colWidths[0] - 8 });
          doc.text(g.name || '', colXs[1] + 4, rY + 4, { width: colWidths[1] - 8 });
          doc.text(g.start_time || '', colXs[2] + 4, rY + 4, { width: colWidths[2] - 8 });
          doc.text(g.end_time || '', colXs[3] + 4, rY + 4, { width: colWidths[3] - 8 });
          doc.text(
            g.early_overtime_hours !== undefined && g.early_overtime_hours !== null ? String(g.early_overtime_hours) : '',
            colXs[4] + 4, rY + 4, { width: colWidths[4] - 8 }
          );
          doc.y = rY + rH;
        });
      }

      if (data.notes && data.notes.trim()) {
        doc.moveDown(0.3);
        const notesY = doc.y;
        doc.save(); doc.rect(marginLeft, notesY, labelColWidth, rowHeight).fill(colors.accent); doc.restore();
        const notesTextHeight = doc.fontSize(8).heightOfString(data.notes.trim(), { width: contentWidth - labelColWidth - 12 });
        const notesRowH = Math.max(rowHeight, notesTextHeight + 10);
        doc.save();
        doc.rect(marginLeft, notesY, contentWidth, notesRowH).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
        doc.moveTo(marginLeft + labelColWidth, notesY).lineTo(marginLeft + labelColWidth, notesY + notesRowH).stroke();
        doc.restore();
        doc.fillColor(colors.secondary).fontSize(8).text('備考', marginLeft + 6, notesY + 5);
        doc.fillColor('#333333').fontSize(8).text(data.notes.trim(), marginLeft + labelColWidth + 6, notesY + 5, { width: contentWidth - labelColWidth - 12 });
        doc.y = notesY + notesRowH;
      }

      doc.moveDown(0.5);

      if (data.signaturePng && data.signaturePng.length > 0) {
        try {
          const sigLabelY = doc.y;
          const sigHeight = 140;
          const sigAreaWidth = contentWidth - labelColWidth - 20;
          const sigAreaHeight = sigHeight - 16;
          doc.save(); doc.rect(marginLeft, sigLabelY, labelColWidth, sigHeight).fill(colors.accent); doc.restore();
          doc.save();
          doc.rect(marginLeft, sigLabelY, contentWidth, sigHeight).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
          doc.moveTo(marginLeft + labelColWidth, sigLabelY).lineTo(marginLeft + labelColWidth, sigLabelY + sigHeight).stroke();
          doc.restore();
          doc.fillColor(colors.secondary).fontSize(9).text('署名', marginLeft + 6, sigLabelY + 55);
          doc.image(data.signaturePng, marginLeft + labelColWidth + 10, sigLabelY + 8, { fit: [sigAreaWidth, sigAreaHeight], align: 'center', valign: 'center' });
          doc.y = sigLabelY + sigHeight;
        } catch (imgError) {
          console.error('[PDF] Failed to embed signature image:', imgError);
          doc.fillColor('#333333').text('(署名画像の埋め込みに失敗しました)', marginLeft + labelColWidth + 8);
        }
      }

      const footerY = Math.max(doc.y + 10, 800);
      doc.save(); doc.rect(0, footerY, pageWidth, 1).fill(colors.primary); doc.restore();
      const now = new Date();
      const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const generatedAt = `${jst.getUTCFullYear()}/${String(jst.getUTCMonth() + 1).padStart(2, '0')}/${String(jst.getUTCDate()).padStart(2, '0')} ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
      doc.fillColor('#999999').fontSize(6);
      doc.text(`生成日時: ${generatedAt}  |  Powered by デジタル警備報告書システム【ほうこちゃん】`, marginLeft, footerY + 4, { width: contentWidth, align: 'right' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
