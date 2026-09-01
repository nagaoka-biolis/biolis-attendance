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
  let answer = ''
  let usage: { input: number; output: number } = { input: 0, output: 0 }

  try {
    const res = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // 資料は小さく質問も短いので、深く考え込ませるより速さを優先する。
      // Vercelの60秒上限に収めるための設定でもある。
      ...(supportsEffort(model) ? { output_config: { effort: 'medium' as const } } : {}),
      system: SYSTEM_PROMPT,
      messages,
    })
    if (res.stop_reason === 'refusal') {
      answer = '申し訳ありません。この質問にはお答えできませんでした。'
    } else {
      answer = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
    }
    usage = { input: res.usage.input_tokens, output: res.usage.output_tokens }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'AIの認証に失敗しました（APIキーを確認してください）' }, { status: 502 })
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: '混み合っています。少し待って再度お試しください' }, { status: 429 })
    }
    if (error instanceof Anthropic.APIError) {
      // クレジット切れもここに来る（前払い残高が尽きるとAPIがエラーを返す）
      return NextResponse.json(
        { error: `AIの呼び出しに失敗しました (${error.status}): ${error.message}` },
        { status: 502 }
      )
    }
    return NextResponse.json({ error: 'AIの呼び出しに失敗しました' }, { status: 502 })
  }

  // 監査ログ（誰がいつ何を聞いたか）。ログの失敗で回答を落とさない。
  // ※ supabase-js のクエリは PromiseLike（then だけ）で .catch() を持たないため、
  //   必ず try/catch で受ける。.catch() を繋ぐと実行時に TypeError になる。
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

  return NextResponse.json({
    ok: true,
    answer,
    model,
    usage,
    データ: { 売上の月: ctx.months, シフトの日数: ctx.shiftDays },
  })
}

// 疎通確認用。利用権限と、材料が揃っているかだけを返す（AIは呼ばない）。
export async function GET(req: NextRequest) {
  const auth = await requireAiUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ctx = await buildContext(auth.admin, auth.scope)
  return NextResponse.json({
    ok: true,
    既定のモデル: await getSetting('ai_model') ?? process.env.ANTHROPIC_MODEL ?? FALLBACK_MODEL,
    APIキー設定済み: Boolean(process.env.ANTHROPIC_API_KEY),
    scope: auth.scope,
    売上の月: ctx.months,
    シフトの日数: ctx.shiftDays,
    材料の文字数: ctx.text.length,
  })
}
