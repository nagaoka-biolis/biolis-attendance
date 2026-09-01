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
// 2段構えで探す。
//   1回目: 金額と人数の両方が合う組み合わせ（確実性が高い）
//   2回目: 残りを金額だけで合わせる
// ACUSISの「人数」は患者数であって会計件数ではない（同じ患者が2回精算する日がある）。
// そのため人数を必須にすると取りこぼす。金額だけの照合も併用して拾う。
export function attributeCheckouts(
  checkouts: Checkout[],
  doctors: DoctorAmount[]
): Attribution {
  const byCheckout = new Map<string, string>()
  const paid = checkouts.filter((c) => c.amount > 0)
  let ambiguous = false

  // --- 1回目: 金額 + 人数 ---
  const pool = [...paid]
  for (const d of [...doctors].filter((d) => d.patients > 0).sort((a, b) => a.patients - b.patients)) {
    if (pool.length === 0) continue
    const { solutions, tooMany } = findSubsets(pool, d.amount, d.patients)
    if (tooMany) ambiguous = true
    if (tooMany || solutions.length !== 1) continue
    const idx = new Set(solutions[0])
    solutions[0].forEach((i) => byCheckout.set(pool[i].no, d.label))
    for (let i = pool.length - 1; i >= 0; i--) if (idx.has(i)) pool.splice(i, 1)
  }

  // --- 2回目: 残りを金額だけで ---
  // 1回目で確定した分を医師の金額から差し引き、残額に合う組み合わせを探す。
  const used = new Map<string, number>()
  for (const [no, label] of byCheckout) {
    const c = paid.find((x) => x.no === no)
    if (c) used.set(label, (used.get(label) ?? 0) + c.amount)
  }
  const remain = doctors
    .map((d) => ({ ...d, amount: d.amount - (used.get(d.label) ?? 0) }))
    .filter((d) => d.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  for (const d of remain) {
    if (pool.length === 0) continue
    const { solutions, tooMany } = findAnySize(pool, d.amount)
    if (tooMany) ambiguous = true
    if (tooMany || solutions.length !== 1) continue
    const idx = new Set(solutions[0])
    solutions[0].forEach((i) => byCheckout.set(pool[i].no, d.label))
    for (let i = pool.length - 1; i >= 0; i--) if (idx.has(i)) pool.splice(i, 1)
  }

  // --- 3回目: 残った会計を「施術1行ずつ」に分解して照合 ---
  // 1つの会計の中で施術ごとに担当が違う日があり、会計をまるごと1人に
  // 割り当てる方法では解けない。施術単位まで下ろすと解ける場合がある。
  // （ただし施術単位だけでやると同額の施術が多く曖昧になるため、
  //   会計単位で解けなかった分にだけ適用する）
  if (pool.length > 0) {
    const used2 = new Map<string, number>()
    for (const [no, label] of byCheckout) {
      const c = paid.find((x) => x.no === no)
      if (c) used2.set(label, (used2.get(label) ?? 0) + c.amount)
    }
    const remain2 = doctors
      .map((d) => ({ ...d, amount: d.amount - (used2.get(d.label) ?? 0) }))
      .filter((d) => d.amount > 0)
      .sort((a, b) => b.amount - a.amount)

    type Line = { amount: number; no: string }
    let lines: Line[] = pool.flatMap((c) =>
      c.items.filter((i) => i.amount > 0).map((i) => ({ amount: i.amount, no: c.no }))
    )
    const lineOwner = new Map<string, Set<string>>() // 会計No → 付いた医師の集合

    for (const d of remain2) {
      if (lines.length === 0) break
      const { solutions, tooMany } = findAnySize(
        lines.map((l) => ({ no: l.no, time: '', amount: l.amount, items: [] })),
        d.amount,
        12
      )
      if (tooMany || solutions.length !== 1) continue
      const idx = new Set(solutions[0])
      solutions[0].forEach((i) => {
        const set = lineOwner.get(lines[i].no) ?? new Set<string>()
        set.add(d.label)
        lineOwner.set(lines[i].no, set)
      })
      lines = lines.filter((_, i) => !idx.has(i))
    }

    // その会計の施術がすべて同じ医師に付いたときだけ、会計の担当として採る
    for (let i = pool.length - 1; i >= 0; i--) {
      const c = pool[i]
      const owners = lineOwner.get(c.no)
      const paidLines = c.items.filter((it) => it.amount > 0).length
      const stillLeft = lines.filter((l) => l.no === c.no).length
      if (owners && owners.size === 1 && paidLines > 0 && stillLeft === 0) {
        byCheckout.set(c.no, [...owners][0])
        pool.splice(i, 1)
      }
    }
  }

  return { byCheckout, unresolved: pool.length, ambiguous }
}

// 件数を問わず、合計が target になる組み合わせを探す（多くても6件まで）
function findAnySize(
  items: Checkout[],
  target: number,
  maxSize = 6
): { solutions: number[][]; tooMany: boolean } {
  const solutions: number[][] = []
  let tooMany = false
  const walk = (start: number, picked: number[], sum: number) => {
    if (tooMany) return
    if (sum === target && picked.length > 0) {
      solutions.push([...picked])
      if (solutions.length > 1) tooMany = true
      return
    }
    if (sum > target || picked.length >= maxSize) return
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
