import PDFDocument from 'pdfkit';

const FONT_PATH = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf';

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
  'patrol': '巡回警備',
  'access_control': '出入管理',
  'traffic_control': '交通誘導',
  'facility_guard': '施設警備',
  'event_guard': 'イベント警備',
  'parking_guard': '駐車場警備',
  'construction_guard': '工事現場警備',
  'other': 'その他'
};

export async function generateReportPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: 'デジタル警備報告書「ほうこちゃん」',
          Author: 'ほうこちゃん',
          Subject: `警備報告書 - ${data.companyName} - ${data.workDate}`
        }
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('IPAGothic', FONT_PATH);
      doc.font('IPAGothic');

      doc.fontSize(20).text('デジタル警備報告書「ほうこちゃん」', { align: 'center' });
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
        const colXs = [startX, startX + 60, startX + 220, startX + 320, startX + 420];
        const headers = ['No', '氏名', '開始', '終了', '早出残業(h)'];
        headers.forEach((h, i) => doc.text(h, colXs[i], doc.y, { continued: i < headers.length - 1 }));
        doc.moveDown(0.5);
        data.guards.forEach(g => {
          const y = doc.y;
          doc.text(String(g.index ?? ''), colXs[0], y);
          doc.text(g.name || '', colXs[1], y);
          doc.text(g.start_time || '', colXs[2], y);
          doc.text(g.end_time || '', colXs[3], y);
          doc.text(
            g.early_overtime_hours !== undefined && g.early_overtime_hours !== null ? String(g.early_overtime_hours) : '',
            colXs[4], y
          );
          doc.moveDown(0.3);
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
      doc.text('Powered by ほうこちゃん', { align: 'right' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
