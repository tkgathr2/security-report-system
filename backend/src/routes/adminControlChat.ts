/**
 * 自動管制システム チャット API — 自然言語で管制ナレッジを「覚えさせる」/ 質問に答える。
 *
 * POST /api/admin/control-chat  { message }
 *   → OpenAI（function-calling）が管制官の発言を解釈し、必要なら管制ナレッジを更新して
 *     日本語で返答する。{ reply, mutated } を返す（mutated=true ならフロントは盤面を再取得）。
 *
 * ツール：
 *   - lookup_staff    : 名前→候補＋現在のナレッジ（質問に答える）
 *   - set_constraint  : 1人立ち可否 / 夜勤可否 / メモ を更新（覚える）
 *   - add_compat      : 相性ペア（avoid/good）を登録
 *   - lookup_projects : 日付＋名前で案件を検索（配置確認・project_id取得）
 *   - assign_cast     : キャストを案件に配置する
 *   - unassign_cast   : キャストの配置を解除する
 */
import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { logAudit } from '../utils/auditLog';
import { sendBadRequest } from '../utils/errorHandler';
import { resolveStaffName, StaffNameRow } from '../utils/staffNameResolver';

const router = Router();

const MODEL = 'gpt-4o';
const MAX_TURNS = 5;
const MAX_MESSAGE_LEN = 1000;
const MAX_MUTATIONS = 8; // 1リクエストでの書き込み上限（暴走防止）

const SYSTEM_PROMPT = `あなたは高木産業グループ「自動管制システム」のアシスタントです。警備・交通誘導の管制官と日本語で会話します。
管制官の発言から、キャスト（警備員）の管制ナレッジ更新や配置変更を行い、質問に答えます。

判断の目安：
- 「〇〇さんは1人立ちOK / 1人で大丈夫」→ set_constraint(solo_ok=true)
- 「〇〇さんは1人立ちNG / 1人は無理 / 単独不可」→ set_constraint(solo_ok=false)
- 「〇〇さんは夜勤OK / 夜いける」→ set_constraint(night_ok=true)
- 「〇〇さんは夜勤NG / 夜は無理」→ set_constraint(night_ok=false)
- 「〇〇さんは△△（特記事項）」→ set_constraint(note="△△")
- 「AさんとBさんは組ませないで / 相性が悪い」→ add_compat(kind=avoid)
- 「AさんとBさんは相性がいい / よく組む」→ add_compat(kind=good)
- 「〇〇さんは1人立ちできる？」等の質問 → lookup_staff で調べてから答える
- 「〇〇さんをXX現場に入れて / 配置して / 行かせて」→ lookup_projects で現場を特定してから assign_cast
- 「〇〇さんをXX現場から外して / 引いて / 抜いて」→ lookup_projects で現場を特定してから unassign_cast
- 「〇〇さんをXXからYYに移して / 替えて」→ unassign_cast の後に assign_cast の順
- 「今日のXX現場に誰がいる？ / XX現場の配置を教えて」→ lookup_projects で調べてから答える

ルール：
- 名前が曖昧で候補が複数出たら、勝手に決めず候補を挙げて管制官に確認する。
- 現場名が曖昧で複数ヒットしたら、候補を挙げて管制官に確認する。
- 該当者・該当現場が見つからなければ、その旨を正直に伝える。
- 更新・変更したら「覚えました」「配置しました」等、何をどうしたかを一言で返す。
- 簡潔に、現場の管制官に分かる日本語で答える。絵文字は使わない。`;

interface ToolPayload {
  [key: string]: unknown;
}

// スタッフ一覧をリクエスト内で1回だけ読む（名前解決の素材）。
function makeStaffLoader(): () => Promise<StaffNameRow[]> {
  let cache: StaffNameRow[] | null = null;
  return async () => {
    if (cache) return cache;
    const r = await pool.query(
      `SELECT id, display_name_kanji, display_name_kana FROM staff_master WHERE deleted_at IS NULL`
    );
    cache = r.rows as StaffNameRow[];
    return cache;
  };
}

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_staff',
      description: 'スタッフ名から候補と現在の管制ナレッジ（1人立ち可否 solo_ok / 夜勤可否 night_ok / メモ）を調べる。',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_constraint',
      description: 'スタッフの1人立ち可否(solo_ok)/夜勤可否(night_ok)/メモ(note)を設定して覚える。変更する項目だけ渡す。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, solo_ok: { type: 'boolean' }, night_ok: { type: 'boolean' }, note: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_compat',
      description: '2人の相性ペアを登録する。kind=avoid（同じ現場に組ませない）/ good（相性が良い）。',
      parameters: {
        type: 'object',
        properties: { name_a: { type: 'string' }, name_b: { type: 'string' }, kind: { type: 'string', enum: ['avoid', 'good'] } },
        required: ['name_a', 'name_b', 'kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_projects',
      description: '案件（現場）を日付と名前で検索する。現在の配置キャスト一覧も返す。assign_cast/unassign_castで使うproject_idを取得するために使う。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '対象日（YYYY-MM-DD）。省略すると今日。' },
          name: { type: 'string', description: '現場名または取引先名の一部（空文字で全件）。' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assign_cast',
      description: 'キャストを案件（現場）に配置する。事前に lookup_projects で project_id を取得すること。',
      parameters: {
        type: 'object',
        properties: {
          staff_name: { type: 'string', description: 'キャストの名前' },
          project_id: { type: 'string', description: '案件ID（lookup_projects で取得）' },
        },
        required: ['staff_name', 'project_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unassign_cast',
      description: 'キャストの案件（現場）への配置を解除する。事前に lookup_projects で project_id を取得すること。',
      parameters: {
        type: 'object',
        properties: {
          staff_name: { type: 'string', description: 'キャストの名前' },
          project_id: { type: 'string', description: '案件ID（lookup_projects で取得）' },
        },
        required: ['staff_name', 'project_id'],
      },
    },
  },
];

export default function buildControlChatRouter(): Router {
  router.post('/', requireAdmin, async (req: Request, res: Response) => {
    const { message } = req.body as { message?: unknown };
    if (typeof message !== 'string' || message.trim() === '') {
      sendBadRequest(res, 'message を指定してください');
      return;
    }
    if (message.length > MAX_MESSAGE_LEN) {
      sendBadRequest(res, `message は${MAX_MESSAGE_LEN}文字以内で指定してください`);
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.json({
        reply: 'チャット機能は準備中です（APIキー未設定）。設定が済めば、ここで話すだけで管制ナレッジを覚えさせられるようになります。',
        mutated: false,
        configured: false,
      });
      return;
    }

    const adminUser = req.user as { email: string };
    const client = new OpenAI({ apiKey });
    const getStaff = makeStaffLoader();
    let mutated = false;
    let mutationCount = 0;

    // ── ツール実行 ───────────────────────────────────────────────
    const executeTool = async (name: string, input: ToolPayload): Promise<ToolPayload> => {
      if (name === 'lookup_staff') {
        const matches = resolveStaffName(String(input.name ?? ''), await getStaff());
        if (matches.length === 0) return { found: 0, message: '該当者なし' };
        if (matches.length > 1) return { found: matches.length, candidates: matches.slice(0, 8).map((m) => m.name) };
        const r = await pool.query(
          `SELECT display_name_kanji, solo_ok, night_ok, control_note FROM staff_master WHERE id = $1`,
          [matches[0].id]
        );
        const row = r.rows[0];
        if (!row) return { found: 0, message: '該当者なし' };
        return { found: 1, staff: { name: matches[0].name, solo_ok: row.solo_ok, night_ok: row.night_ok, note: row.control_note ?? null } };
      }

      if (name === 'set_constraint') {
        if (mutationCount >= MAX_MUTATIONS) return { ok: false, reason: 'too_many_changes' };
        const matches = resolveStaffName(String(input.name ?? ''), await getStaff());
        if (matches.length === 0) return { ok: false, reason: 'not_found' };
        if (matches.length > 1) return { ok: false, reason: 'ambiguous', candidates: matches.slice(0, 8).map((m) => m.name) };
        const sets: string[] = [];
        const vals: unknown[] = [];
        const applied: Record<string, unknown> = {};
        if (typeof input.solo_ok === 'boolean') { vals.push(input.solo_ok); sets.push(`solo_ok = $${vals.length}`); applied.solo_ok = input.solo_ok; }
        if (typeof input.night_ok === 'boolean') { vals.push(input.night_ok); sets.push(`night_ok = $${vals.length}`); applied.night_ok = input.night_ok; }
        if (typeof input.note === 'string') { const note = input.note.trim().slice(0, 1000); vals.push(note || null); sets.push(`control_note = $${vals.length}`); applied.note = note || null; }
        if (sets.length === 0) return { ok: false, reason: 'no_fields' };
        vals.push(matches[0].id);
        await pool.query(
          `UPDATE staff_master SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} AND deleted_at IS NULL`,
          vals
        );
        mutated = true; mutationCount += 1;
        logAudit({ req, actorEmail: adminUser.email, action: 'CHAT_SET_CONSTRAINT', targetType: 'staff_master', targetId: matches[0].id, payload: { ...applied, source: 'chat' } });
        return { ok: true, name: matches[0].name, applied };
      }

      if (name === 'add_compat') {
        if (mutationCount >= MAX_MUTATIONS) return { ok: false, reason: 'too_many_changes' };
        const staff = await getStaff();
        const a = resolveStaffName(String(input.name_a ?? ''), staff);
        const b = resolveStaffName(String(input.name_b ?? ''), staff);
        if (a.length !== 1 || b.length !== 1) {
          return { ok: false, reason: 'resolve_failed', a: a.length === 1 ? a[0].name : a.slice(0, 8).map((m) => m.name), b: b.length === 1 ? b[0].name : b.slice(0, 8).map((m) => m.name) };
        }
        if (a[0].id === b[0].id) return { ok: false, reason: 'same_person' };
        const kind = input.kind === 'good' ? 'good' : 'avoid';
        const [normA, normB] = a[0].id <= b[0].id ? [a[0].id, b[0].id] : [b[0].id, a[0].id];
        const ins = await pool.query(
          `INSERT INTO staff_compatibility (staff_a_id, staff_b_id, kind, note, created_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (staff_a_id, staff_b_id, kind) WHERE deleted_at IS NULL DO NOTHING
           RETURNING id`,
          [normA, normB, kind, 'チャットから登録', adminUser.email]
        );
        if (ins.rows.length > 0) {
          mutated = true; mutationCount += 1;
          logAudit({ req, actorEmail: adminUser.email, action: 'CHAT_ADD_COMPAT', targetType: 'staff_compatibility', targetId: ins.rows[0].id as string, payload: { staff_a_id: normA, staff_b_id: normB, kind, source: 'chat' } });
          return { ok: true, a: a[0].name, b: b[0].name, kind };
        }
        return { ok: true, already: true, a: a[0].name, b: b[0].name, kind };
      }

      if (name === 'lookup_projects') {
        const today = new Date().toISOString().slice(0, 10);
        const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today;
        const search = typeof input.name === 'string' ? input.name.trim() : '';
        const r = await pool.query(
          `SELECT p.id, p.work_name, c.name AS client_name, p.location, p.start_time,
                  COALESCE(
                    ARRAY_AGG(sm.display_name_kanji ORDER BY pc.row_index) FILTER (WHERE pc.deleted_at IS NULL AND sm.id IS NOT NULL),
                    ARRAY[]::text[]
                  ) AS current_casts
           FROM projects p
           JOIN clients c ON c.id = p.client_id
           LEFT JOIN project_casts pc ON pc.project_id = p.id AND pc.deleted_at IS NULL
           LEFT JOIN staff_master sm ON sm.id = pc.staff_id AND sm.deleted_at IS NULL
           WHERE p.work_date = $1
             AND p.deleted_at IS NULL
             AND ($2 = '' OR p.work_name ILIKE $3 OR c.name ILIKE $3)
           GROUP BY p.id, c.name
           ORDER BY p.start_time`,
          [date, search, `%${search}%`]
        );
        if (r.rows.length === 0) return { found: 0, date, message: '該当する案件がありません' };
        return {
          found: r.rows.length,
          date,
          projects: r.rows.map((row) => ({
            id: row.id as string,
            name: row.work_name as string,
            client: row.client_name as string,
            location: (row.location ?? null) as string | null,
            start_time: (row.start_time ?? null) as string | null,
            current_casts: (row.current_casts ?? []) as string[],
          })),
        };
      }

      if (name === 'assign_cast') {
        if (mutationCount >= MAX_MUTATIONS) return { ok: false, reason: 'too_many_changes' };
        const matches = resolveStaffName(String(input.staff_name ?? ''), await getStaff());
        if (matches.length === 0) return { ok: false, reason: 'staff_not_found' };
        if (matches.length > 1) return { ok: false, reason: 'staff_ambiguous', candidates: matches.slice(0, 8).map((m) => m.name) };
        const staffId = matches[0].id;
        const projectId = String(input.project_id ?? '');
        const pCheck = await pool.query(
          `SELECT id, work_name FROM projects WHERE id = $1 AND deleted_at IS NULL`,
          [projectId]
        );
        if (pCheck.rows.length === 0) return { ok: false, reason: 'project_not_found' };
        const existing = await pool.query(
          `SELECT id FROM project_casts WHERE project_id = $1 AND staff_id = $2 AND deleted_at IS NULL`,
          [projectId, staffId]
        );
        if (existing.rows.length > 0) return { ok: true, already: true, name: matches[0].name, project: pCheck.rows[0].work_name as string };
        const ins = await pool.query(
          `INSERT INTO project_casts (project_id, staff_id, row_index)
           SELECT $1, $2, COALESCE((SELECT MAX(row_index) FROM project_casts WHERE project_id = $1 AND deleted_at IS NULL), 0) + 1
           RETURNING id`,
          [projectId, staffId]
        );
        mutated = true; mutationCount += 1;
        logAudit({ req, actorEmail: adminUser.email, action: 'CHAT_ASSIGN_CAST', targetType: 'project_casts', targetId: ins.rows[0].id as string, payload: { project_id: projectId, staff_id: staffId, source: 'chat' } });
        return { ok: true, name: matches[0].name, project: pCheck.rows[0].work_name as string };
      }

      if (name === 'unassign_cast') {
        if (mutationCount >= MAX_MUTATIONS) return { ok: false, reason: 'too_many_changes' };
        const matches = resolveStaffName(String(input.staff_name ?? ''), await getStaff());
        if (matches.length === 0) return { ok: false, reason: 'staff_not_found' };
        if (matches.length > 1) return { ok: false, reason: 'staff_ambiguous', candidates: matches.slice(0, 8).map((m) => m.name) };
        const staffId = matches[0].id;
        const projectId = String(input.project_id ?? '');
        const del = await pool.query(
          `UPDATE project_casts SET deleted_at = NOW()
           WHERE project_id = $1 AND staff_id = $2 AND deleted_at IS NULL
           RETURNING id`,
          [projectId, staffId]
        );
        if (del.rows.length === 0) return { ok: false, reason: 'not_assigned' };
        const pName = await pool.query(`SELECT work_name FROM projects WHERE id = $1`, [projectId]);
        mutated = true; mutationCount += 1;
        logAudit({ req, actorEmail: adminUser.email, action: 'CHAT_UNASSIGN_CAST', targetType: 'project_casts', targetId: del.rows[0].id as string, payload: { project_id: projectId, staff_id: staffId, source: 'chat' } });
        return { ok: true, name: matches[0].name, project: (pName.rows[0]?.work_name ?? projectId) as string };
      }

      return { error: 'unknown_tool' };
    };

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ];

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const resp = await client.chat.completions.create({ model: MODEL, max_tokens: 1024, messages, tools, tool_choice: 'auto' });
        const msg = resp.choices[0]?.message;
        if (!msg) {
          res.json({ reply: '応答を生成できませんでした。', mutated, configured: true });
          return;
        }

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          messages.push(msg);
          for (const tc of msg.tool_calls) {
            if (tc.type !== 'function') continue;
            let result: ToolPayload;
            try {
              const args = JSON.parse(tc.function.arguments || '{}') as ToolPayload;
              result = await executeTool(tc.function.name, args);
            } catch (toolErr) {
              console.error('[control-chat] tool error:', tc.function.name, toolErr);
              result = { error: 'この操作の実行中にエラーが発生しました。' };
            }
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          }
          continue;
        }

        res.json({ reply: (msg.content ?? '').trim() || '（応答を生成できませんでした）', mutated, configured: true });
        return;
      }
      res.json({ reply: '処理が長くなりすぎました。短く言い直してもらえますか。', mutated, configured: true });
    } catch (error) {
      console.error('[control-chat] error:', error);
      res.status(502).json({ reply: 'チャットの処理中にエラーが発生しました。少し待って再度お試しください。', mutated, configured: true });
    }
  });

  return router;
}
