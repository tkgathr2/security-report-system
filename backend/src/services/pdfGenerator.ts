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
  qualifierName?: string | null;
  signaturePng?: Buffer | null;
}

const GUARD_CONTENT_LABELS: Record<string, string> = {
  'traffic': '①交通誘導',
  'pedestrian': '②歩行者誘導',
  'construction': '③工事関係者、車両の誘導',
  'worker_safety': '④作業員の安全確保',
  'property_safety': '⑤占有物の安全確保',
  'detour': '⑥通行止・迂回案内',
  'alternating': '⑦交互通行',
  'other': '⑧その他'
};

export async function generateReportPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
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

      doc.fontSize(20).text('デジタル警備報告書システム【ほうこちゃん】', { align: 'center' });
      doc.moveDown(2);

      doc.fontSize(14).text(`${data.companyName} 御中`, { align: 'left' });
      doc.moveDown(1.5);

      doc.fontSize(12);
      
      const startX = 50;
      const labelWidth = 120;
      const valueX = startX + labelWidth;
      
      const addRow = (label: string, value: string) => {
        doc.text(label, startX, doc.y, { continued: false });
        const y = doc.y - 14;
        doc.text(value, valueX, y);
        doc.moveDown(0.5);
      };

      addRow('実施日:', data.workDate);
      addRow('実施場所:', data.location);
      addRow('作業名称:', data.workName);
      addRow('監督者名:', data.supervisorName);
      addRow('記入者名:', data.writerName);

      doc.moveDown(1);

      doc.fontSize(12).text('警備内容:', startX);
      doc.moveDown(0.3);
      
      const guardContentLabels = data.guardContents.map(code => 
        GUARD_CONTENT_LABELS[code] || code
      );
      doc.fontSize(11).text(guardContentLabels.join('、'), valueX, doc.y);
      
      if (data.guardOtherText) {
        doc.moveDown(0.3);
        doc.text(`その他: ${data.guardOtherText}`, valueX);
      }
      doc.moveDown(1);

      const qualifierText = data.hasQualifier 
        ? `有 (${data.qualifierName || '氏名未記入'})`
        : '無';
      addRow('資格者:', qualifierText);

      // 警備員一覧（任意）
      if (data.guards && data.guards.length > 0) {
        doc.moveDown(1);
        doc.text('警備員一覧:', startX);
        doc.moveDown(0.3);
        const colXs = [startX, startX + 40, startX + 200, startX + 300, startX + 400];
        const headers = ['No', '氏名', '開始', '終了', '早出残業(h)'];
        const headerY = doc.y;
        headers.forEach((h, i) => doc.text(h, colXs[i], headerY, { width: colXs[i + 1] ? colXs[i + 1] - colXs[i] - 5 : 100 }));
        doc.y = headerY + 18;
        data.guards.forEach(g => {
          const rowY = doc.y;
          doc.text(String(g.index ?? ''), colXs[0], rowY, { width: 35 });
          doc.text(g.name || '', colXs[1], rowY, { width: 155 });
          doc.text(g.start_time || '', colXs[2], rowY, { width: 95 });
          doc.text(g.end_time || '', colXs[3], rowY, { width: 95 });
          doc.text(
            g.early_overtime_hours !== undefined && g.early_overtime_hours !== null ? String(g.early_overtime_hours) : '',
            colXs[4], rowY, { width: 60 }
          );
          doc.y = rowY + 18;
        });
      }

      doc.moveDown(2);

      if (data.signaturePng && data.signaturePng.length > 0) {
        try {
          doc.fontSize(12).text('署名:', startX);
          doc.moveDown(0.3);
          doc.image(data.signaturePng, valueX, doc.y, { 
            width: 150,
            height: 75
          });
          doc.moveDown(6);
        } catch (imgError) {
          console.error('[PDF] Failed to embed signature image:', imgError);
          doc.text('(署名画像の埋め込みに失敗しました)', valueX);
          doc.moveDown(1);
        }
      }

      doc.moveDown(2);
      const now = new Date();
      const generatedAt = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      doc.fontSize(9).text(`生成日時: ${generatedAt}`, { align: 'right' });
      doc.text('Powered by デジタル警備報告書システム【ほうこちゃん】', { align: 'right' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
