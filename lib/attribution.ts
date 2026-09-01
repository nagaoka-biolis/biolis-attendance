// 「この施術を誰がやったか」を割り出す。
//
// ACUSISはどの帳票でも「施術ごとの担当医」を出してくれない。持っているのは
//   ・日次売上 … その日の会計ごとの金額と、その中身（施術名・金額）
//   ・スタッフ別売上(Dr) … その日の医師ごとの金額・件数・人数
// の2つだけ。
//
// ただし「医師の金額」は「その医師が担当した会計の合計」なので、
// 会計の金額を組み合わせて医師の金額に一致させれば、担当が復元できる。
// 例) 8/21: 会計は 880,000 と 14,300。医師は 金子Dr 880,000(1人)・金Dr 14,300(1人)
//     → 一意に決まる。
//
// 一意に決まらない日（同額の会計が複数ある等）は「不明」のままにする。
// 推測で埋めると数字の信用が落ちるため、そこは正直に空ける。

import type { Checkout } from './sales-daily'

export type DoctorAmount = { label: string; amount: number; patients: number }

export type Attribution = {
  byCheckout: Map<string, string> // 会計No → 医師ラベル
  unresolved: number // 割り当てられなかった会計の数
  ambiguous: boolean // 解が複数あって決められなかった
}

// 会計の集合から、合計が target・件数が count になる組み合わせを全部探す。
// 会計は1日あたり多くて十数件なので総当たりで足りる。
// 解が2通り以上見つかった時点で「決められない」として打ち切る。
function findSubsets(
  items: Checkout[],
  target: number,
  count: number
): { solutions: number[][]; tooMany: boolean } {
  const solutions: number[][] = []
  let tooMany = false

  const walk = (start: number, picked: number[], sum: number) => {
    if (tooMany) return
    if (picked.length === count) {
      if (sum === target) {
        solutions.push([...picked])
        if (solutions.length > 1) tooMany = true
      }
      return
    }
    if (sum > target) return
    for (let i = start; i < items.length; i++) {
      picked.push(i)
      walk(i + 1, picked, sum + items[i].amount)
      picked.pop()
      if (tooMany) return
    }
  }
  walk(0, [], 0)
  return { solutions, tooMany }
}

// その日の会計に担当医を割り当てる。
export function attributeCheckouts(
  checkouts: Checkout[],
  doctors: DoctorAmount[]
): Attribution {
  const byCheckout = new Map<string, string>()
  const remaining = checkouts.filter((c) => c.amount > 0)
  const targets = doctors.filter((d) => d.amount > 0 || d.patients > 0)
  let ambiguous = false

  // 金額・人数がはっきりしている医師から順に確定させる。
  // 人数1人＝会計1件なので、まずそこから決まることが多い。
  const ordered = [...targets].sort((a, b) => a.patients - b.patients)

  const pool = [...remaining]
  for (const d of ordered) {
    if (d.patients <= 0 || pool.length === 0) continue
    const { solutions, tooMany } = findSubsets(pool, d.amount, d.patients)
    if (tooMany || solutions.length !== 1) {
      if (tooMany) ambiguous = true
      continue
    }
    const idx = new Set(solutions[0])
    solutions[0].forEach((i) => byCheckout.set(pool[i].no, d.label))
    // 割り当て済みを取り除いて次の医師へ
    for (let i = pool.length - 1; i >= 0; i--) if (idx.has(i)) pool.splice(i, 1)
  }

  return { byCheckout, unresolved: pool.length, ambiguous }
}
