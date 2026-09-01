import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAiUser } from '@/lib/server-admin'
import { buildContext, SYSTEM_PROMPT } from '@/lib/ai-context'
import { getSetting } from '@/lib/lineworks'
import { resolveModel, supportsEffort, FALLBACK_MODEL } from '@/lib/ai-models'

export const runtime = 'nodejs'
// Vercelの関数実行時間の上限。既定(10秒)だと回答が返る前に切れることがある。
export const maxDuration = 60

// BiOLiS AI（対話でシフト・売上を確認する窓口）。
// 利用者は ai_users 名簿に載っている人のみ。admin でも名簿になければ 403。

// 暴走防止の歯止め
const MAX_TOKENS = 2000 // 1回の回答の上限
const MAX_QUESTION_CHARS = 1000 // 1回の質問の上限
const DAILY_LIMIT = 50 // 1人1日あたりの質問回数
const MAX_HISTORY = 8 // さかのぼって渡す会話の数

type Turn = { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  const auth = await requireAiUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { admin, userId, scope } = auth

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'AIの接続設定(ANTHROPIC_API_KEY)がまだありません' },
      { status: 503 }
    )
  }

  const body = await req.json().catch(() => null)
  const message = String((body as { message?: unknown } | null)?.message ?? '').trim()
  if (!message) return NextResponse.json({ error: '質問を入力してください' }, { status: 400 })
  if (message.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `質問は${MAX_QUESTION_CHARS}文字以内にしてください` },
      { status: 400 }
    )
  }

  // 1日あたりの回数制限（コストの歯止め）
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('ai_chat_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)
  if ((count ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json(
      { error: `本日の質問回数の上限(${DAILY_LIMIT}回)に達しました` },
      { status: 429 }
    )
  }

  // 使うモデルを決める（質問ごとの指定 → 保存済みの既定 → 環境変数 → 既定値）
  const model = resolveModel(
    (body as { model?: unknown } | null)?.model,
    await getSetting('ai_model')
  )

  // 材料を組み立てる（合計・平均はここで確定済み。AIには計算させない）
  const ctx = await buildContext(admin, scope)

  const history = (Array.isArray((body as { history?: unknown } | null)?.history)
    ? ((body as { history: Turn[] }).history ?? [])
    : []
  )
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .slice(-MAX_HISTORY)

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user' as const, content: `# 資料\n\n${ctx.text}\n\n# 質問\n\n${message}` },
  ]

  const client = new Anthropic()

  // 回答を待ち切ってから返すと、Opus 5 では10〜20秒ずっと無音になる。
  // 届いた端から流して、画面と音声がすぐ動き出すようにする。
  const encoder = new TextEncoder()
  let answer = ''
  let usage = { input: 0, output: 0 }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const s = client.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          ...(supportsEffort(model) ? { output_config: { effort: 'medium' as const } } : {}),
          system: SYSTEM_PROMPT,
          messages,
        })
        s.on('text', (delta) => {
          answer += delta
          controller.enqueue(encoder.encode(delta))
        })
        const final = await s.finalMessage()
        if (final.stop_reason === 'refusal' && !answer) {
          const msg = '申し訳ありません。この質問にはお答えできませんでした。'
          answer = msg
          controller.enqueue(encoder.encode(msg))
        }
        usage = { input: final.usage.input_tokens, output: final.usage.output_tokens }
      } catch (error) {
        const msg =
          error instanceof Anthropic.AuthenticationError
            ? '\n\n[AIの認証に失敗しました。APIキーを確認してください]'
            : error instanceof Anthropic.RateLimitError
              ? '\n\n[混み合っています。少し待って再度お試しください]'
              : error instanceof Anthropic.APIError
                ? `\n\n[AIの呼び出しに失敗しました (${error.status}): ${error.message}]`
                : '\n\n[AIの呼び出しに失敗しました]'
        controller.enqueue(encoder.encode(msg))
        answer += msg
      }

      // 監査ログ（誰がいつ何を聞いたか）。ログの失敗で回答を落とさない。
      // ※ supabase-js のクエリは PromiseLike で .catch() を持たないため try/catch で受ける。
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from('ai_chat_logs') as any).insert({
          user_id: userId,
          question: message,
          answer,
          model,
          input_tokens: usage.input,
          output_tokens: usage.output,
        })
      } catch {
        // 記録できなくても回答は返す
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Model': model,
    },
  })
}

// 疎通確認用。利用権限と、材料が揃っているかだけを返す（AIは呼ばない）。
export async function GET(req: NextRequest) {
  const auth = await requireAiUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ctx = await buildContext(auth.admin, auth.scope)
  return NextResponse.json({
    ok: true,
    // 画面側が持っている版と比べ、古ければ更新を促すために返す
    buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? '',
    既定のモデル: await getSetting('ai_model') ?? process.env.ANTHROPIC_MODEL ?? FALLBACK_MODEL,
    APIキー設定済み: Boolean(process.env.ANTHROPIC_API_KEY),
    scope: auth.scope,
    売上の月: ctx.months,
    シフトの日数: ctx.shiftDays,
    材料の文字数: ctx.text.length,
  })
}
