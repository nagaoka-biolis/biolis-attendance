// BiOLiS AI で使ってよいモデルの一覧。
// 画面の切替スイッチとサーバ側の検証で同じ定義を使う。
// ※ route.ts からは「ハンドラ以外を export できない」ため、ここに置く。

// 単価は 100万トークンあたりの USD（2026-06 時点）。
// 実費請求の根拠に使うので、Anthropicが価格を改定したらここも直す。
// ※ここで出るのはあくまで概算。正式な金額は Console の請求書が正。
export type ModelChoice = {
  id: string
  label: string
  note: string
  inUsd: number
  outUsd: number
}

export const MODEL_CHOICES: ModelChoice[] = [
  { id: 'claude-opus-5', label: 'じっくり', note: '解釈が深い・少し遅い・費用高め', inUsd: 5, outUsd: 25 },
  { id: 'claude-sonnet-5', label: 'ふつう', note: 'バランス型', inUsd: 2, outUsd: 10 },
  { id: 'claude-haiku-4-5', label: 'さくさく', note: '速い・安い・単純な確認向き', inUsd: 1, outUsd: 5 },
]

// トークン数から概算費用(USD)を出す。モデル不明のときは最も高い単価で見積もる
// （請求を少なく見せないため、安全側に倒す）。
export function estimateCostUsd(model: string | null, inTokens: number, outTokens: number): number {
  const m = MODEL_CHOICES.find((c) => c.id === model)
  const inUsd = m?.inUsd ?? Math.max(...MODEL_CHOICES.map((c) => c.inUsd))
  const outUsd = m?.outUsd ?? Math.max(...MODEL_CHOICES.map((c) => c.outUsd))
  return (inTokens * inUsd + outTokens * outUsd) / 1_000_000
}

// 既定は Opus 5（数字の解釈と言語化の質がそのまま成果物になるため）
export const FALLBACK_MODEL = 'claude-opus-5'

const ALLOWED = new Set(MODEL_CHOICES.map((m) => m.id))
export const isAllowedModel = (v: unknown): v is string =>
  typeof v === 'string' && ALLOWED.has(v)

// モデルの決まり方（上が優先）:
//   1. 質問ごとの指定（画面の切替スイッチ）
//   2. app_settings の 'ai_model'（管理画面から変更でき、再デプロイ不要）
//   3. 環境変数 ANTHROPIC_MODEL
//   4. 既定値
export function resolveModel(perRequest: unknown, saved: string | null): string {
  for (const c of [perRequest, saved, process.env.ANTHROPIC_MODEL]) {
    if (isAllowedModel(c)) return c
  }
  return FALLBACK_MODEL
}

// effort（考える深さの指定）は Haiku 4.5 など一部のモデルではエラーになる。
// モデルを切り替えたときに落ちないよう、対応モデルのときだけ送る。
export const supportsEffort = (model: string) => !/haiku|sonnet-4-5/.test(model)
