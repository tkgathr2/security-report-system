import PDFDocument from 'pdfkit';
import * as fs from 'fs';

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
}

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

const BRAND_ORANGE = '#C85A17';
const BRAND_NAVY = '#2B4C7E';
const LIGHT_GRAY = '#F5F5F5';
const BORDER_GRAY = '#DDDDDD';
const TEXT_DARK = '#333333';
const TEXT_LIGHT = '#FFFFFF';

export async function generateReportPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 50, right: 50 },
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

      const pageWidth = 595.28;
      const marginLeft = 50;
      const contentWidth = pageWidth - marginLeft - 50;

      doc.save();
      doc.rect(0, 0, pageWidth, 80).fill(BRAND_ORANGE);
      doc.restore();

      doc.save();
      doc.rect(0, 80, pageWidth, 4).fill(BRAND_NAVY);
      doc.restore();

      doc.fillColor(TEXT_LIGHT);
      doc.fontSize(18).text('警 備 報 告 書', marginLeft, 18, { width: contentWidth, align: 'center' });
      doc.fontSize(9).text('デジタル警備報告書システム【ほうこちゃん】', marginLeft, 50, { width: contentWidth, align: 'center' });

      doc.fillColor(TEXT_DARK);
      doc.y = 100;

      doc.fontSize(13).fillColor(BRAND_NAVY).text(`${data.companyName} 御中`, marginLeft, doc.y);
      doc.moveDown(0.3);
      doc.save();
      doc.moveTo(marginLeft, doc.y).lineTo(marginLeft + contentWidth, doc.y).strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();
      doc.restore();
      doc.moveDown(0.8);

      doc.fillColor(TEXT_DARK);

      const tableTop = doc.y;
      const labelColWidth = 110;
      const valueColWidth = contentWidth - labelColWidth;
      const rowHeight = 28;

      const infoRows: [string, string][] = [
        ['実施日', data.workDate],
        ['実施場所', data.location],
        ['作業名称', data.workName],
        ['監督者名', data.supervisorName],
        ['記入者名', data.writerName],
      ];

      infoRows.forEach((row, i) => {
        const y = tableTop + i * rowHeight;

        doc.save();
        doc.rect(marginLeft, y, labelColWidth, rowHeight).fill(LIGHT_GRAY);
        doc.restore();

        doc.save();
        doc.rect(marginLeft, y, contentWidth, rowHeight).strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();
        doc.moveTo(marginLeft + labelColWidth, y).lineTo(marginLeft + labelColWidth, y + rowHeight).stroke();
        doc.restore();

        doc.fillColor(BRAND_NAVY).fontSize(10).text(row[0], marginLeft + 8, y + 8, { width: labelColWidth - 16 });
        doc.fillColor(TEXT_DARK).fontSize(10).text(row[1], marginLeft + labelColWidth + 8, y + 8, { width: valueColWidth - 16 });
      });

      doc.y = tableTop + infoRows.length * rowHeight + 16;

      doc.save();
      doc.rect(marginLeft, doc.y, contentWidth, 24).fill(BRAND_NAVY);
      doc.restore();
      doc.fillColor(TEXT_LIGHT).fontSize(11).text('警備内容', marginLeft + 10, doc.y + 6);
      doc.y = doc.y + 24;

      doc.fillColor(TEXT_DARK);
      const guardContentLabels = data.guardContents.map(code =>
        GUARD_CONTENT_LABELS[code] || code
      );

      const contentBoxTop = doc.y;

      doc.fontSize(10);
      let chipX = marginLeft + 10;
      let chipY = contentBoxTop + 8;
      const chipHeight = 20;
      const chipPadding = 12;
      const chipGap = 6;

      guardContentLabels.forEach(label => {
        const textWidth = doc.widthOfString(label);
        const chipWidth = textWidth + chipPadding * 2;

        if (chipX + chipWidth > marginLeft + contentWidth - 10) {
          chipX = marginLeft + 10;
          chipY += chipHeight + 4;
        }

        doc.save();
        doc.roundedRect(chipX, chipY, chipWidth, chipHeight, 4).fill(BRAND_ORANGE);
        doc.restore();

        doc.fillColor(TEXT_LIGHT).fontSize(9).text(label, chipX + chipPadding, chipY + 5, { width: textWidth + 2 });
        doc.fillColor(TEXT_DARK);

        chipX += chipWidth + chipGap;
      });

      doc.y = chipY + chipHeight + 8;

      if (data.guardOtherText) {
        doc.fontSize(9).fillColor('#666666').text(`  その他: ${data.guardOtherText}`, marginLeft + 10, doc.y);
        doc.fillColor(TEXT_DARK);
        doc.y += 16;
      }

      doc.save();
      doc.rect(marginLeft, contentBoxTop, contentWidth, doc.y - contentBoxTop).strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();
      doc.restore();

      doc.moveDown(0.8);

      const qNames = Array.isArray(data.qualifierName) ? data.qualifierName.filter(n => n && n.trim() !== '') : (data.qualifierName ? [data.qualifierName] : []);
      const qualifierText = data.hasQualifier
        ? `有 (${qNames.length > 0 ? qNames.join('、') : '氏名未記入'})`
        : '無';

      const qRowY = doc.y;
      doc.save();
      doc.rect(marginLeft, qRowY, labelColWidth, rowHeight).fill(LIGHT_GRAY);
      doc.restore();
      doc.save();
      doc.rect(marginLeft, qRowY, contentWidth, rowHeight).strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();
      doc.moveTo(marginLeft + labelColWidth, qRowY).lineTo(marginLeft + labelColWidth, qRowY + rowHeight).stroke();
      doc.restore();
      doc.fillColor(BRAND_NAVY).fontSize(10).text('資格者', marginLeft + 8, qRowY + 8, { width: labelColWidth - 16 });
      doc.fillColor(TEXT_DARK).fontSize(10).text(qualifierText, marginLeft + labelColWidth + 8, qRowY + 8, { width: valueColWidth - 16 });
      doc.y = qRowY + rowHeight + 16;

      if (data.guards && data.guards.length > 0) {
        doc.save();
        doc.rect(marginLeft, doc.y, contentWidth, 24).fill(BRAND_NAVY);
        doc.restore();
        doc.fillColor(TEXT_LIGHT).fontSize(11).text('警備員一覧', marginLeft + 10, doc.y + 6);
        doc.y = doc.y + 24;

        doc.fillColor(TEXT_DARK);

        const colWidths = [35, 160, 100, 100, 100];
        const colXs = [marginLeft];
        for (let c = 1; c <= colWidths.length; c++) {
          colXs.push(colXs[c - 1] + colWidths[c - 1]);
        }
        const tHeaders = ['No', '氏名', '開始', '終了', '早出残業(h)'];
        const thY = doc.y;
        const thH = 24;

        doc.save();
        doc.rect(marginLeft, thY, contentWidth, thH).fill(LIGHT_GRAY);
        doc.restore();

        tHeaders.forEach((h, i) => {
          doc.fillColor(BRAND_NAVY).fontSize(9).text(h, colXs[i] + 6, thY + 7, { width: colWidths[i] - 12 });
        });

        doc.save();
        doc.rect(marginLeft, thY, contentWidth, thH).strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();
        colXs.slice(1, -1).forEach(x => {
          doc.moveTo(x, thY).lineTo(x, thY + thH).stroke();
        });
        doc.restore();

        doc.y = thY + thH;

        data.guards.forEach((g, idx) => {
          const rY = doc.y;
          const rH = 22;

          if (idx % 2 === 1) {
            doc.save();
            doc.rect(marginLeft, rY, contentWidth, rH).fill('#FAFAFA');
            doc.restore();
          }

          doc.save();
          doc.rect(marginLeft, rY, contentWidth, rH).strokeColor(BORDER_GRAY).lineWidth(0.3).stroke();
          colXs.slice(1, -1).forEach(x => {
            doc.moveTo(x, rY).lineTo(x, rY + rH).strokeColor('#EEEEEE').lineWidth(0.3).stroke();
          });
          doc.restore();

          doc.fillColor(TEXT_DARK).fontSize(9);
          doc.text(String(g.index ?? ''), colXs[0] + 6, rY + 6, { width: colWidths[0] - 12 });
          doc.text(g.name || '', colXs[1] + 6, rY + 6, { width: colWidths[1] - 12 });
          doc.text(g.start_time || '', colXs[2] + 6, rY + 6, { width: colWidths[2] - 12 });
          doc.text(g.end_time || '', colXs[3] + 6, rY + 6, { width: colWidths[3] - 12 });
          doc.text(
            g.early_overtime_hours !== undefined && g.early_overtime_hours !== null ? String(g.early_overtime_hours) : '',
            colXs[4] + 6, rY + 6, { width: colWidths[4] - 12 }
          );

          doc.y = rY + rH;
        });
      }

      doc.moveDown(1.5);

      if (data.signaturePng && data.signaturePng.length > 0) {
        try {
          const sigLabelY = doc.y;
          doc.save();
          doc.rect(marginLeft, sigLabelY, labelColWidth, 80).fill(LIGHT_GRAY);
          doc.restore();
          doc.save();
          doc.rect(marginLeft, sigLabelY, contentWidth, 80).strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();
          doc.moveTo(marginLeft + labelColWidth, sigLabelY).lineTo(marginLeft + labelColWidth, sigLabelY + 80).stroke();
          doc.restore();

          doc.fillColor(BRAND_NAVY).fontSize(10).text('署名', marginLeft + 8, sigLabelY + 30);
          doc.image(data.signaturePng, marginLeft + labelColWidth + 20, sigLabelY + 5, {
            width: 140,
            height: 70
          });
          doc.y = sigLabelY + 80;
        } catch (imgError) {
          console.error('[PDF] Failed to embed signature image:', imgError);
          doc.fillColor(TEXT_DARK).text('(署名画像の埋め込みに失敗しました)', marginLeft + labelColWidth + 8);
        }
      }

      const footerY = 800;
      doc.save();
      doc.rect(0, footerY, pageWidth, 2).fill(BRAND_ORANGE);
      doc.restore();

      const now = new Date();
      const generatedAt = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      doc.fillColor('#999999').fontSize(7);
      doc.text(`生成日時: ${generatedAt}`, marginLeft, footerY + 8, { width: contentWidth, align: 'right' });
      doc.text('Powered by デジタル警備報告書システム【ほうこちゃん】', marginLeft, doc.y, { width: contentWidth, align: 'right' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
