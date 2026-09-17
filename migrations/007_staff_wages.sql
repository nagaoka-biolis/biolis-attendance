-- 時給/月給スタッフの給与マスタ ＋ 給与を見られる人の名簿
-- Supabase SQL Editor で1回だけ実行。警告が出たら「Run without RLS」を選ぶ。
--
-- ■ 位置づけ
-- 医師の報酬（doctor_rates / payroll）とは完全に別建て。ここは「雇用スタッフの基本給」。
-- 基本給 ＝ 時給 × 実労働時間（休憩控除・分切り捨て）。割増は 8h超25% / 深夜(22時以降)25%。
-- 通勤手当 ＝ 往復額/日 × 出勤日数（実費・上限月2万・非課税）。
-- 計算は /api/staff-payroll（サーバ・service_role）で行い、freee にはここで作った
-- 支給項目（基本給・時間外手当・深夜手当・通勤手当）を渡す。
--
-- ■ 権限（給与を見られる人を限定する）
-- ai_users と同じ **名簿のみ** 方式。role='admin' でも自動では通さない。
-- 「勤怠を管理できる」と「給与を見られる」を分離する。判定は API 側（requirePayrollViewer）。

-- ------------------------------------------------------------------
-- 1. 給与マスタ（発効日つき履歴）
--    時給は途中で変わる（例：三好・田中は 2026/9/1〜）ので、1人につき複数行を持てる。
--    計算時は「対象日 <= effective_from の最新行」をその日の単価として使う。
-- ------------------------------------------------------------------
create table if not exists public.staff_wages (
  user_id uuid not null references public.profiles(id) on delete cascade,
  effective_from date not null,                 -- この単価が有効になる開始日
  pay_type text not null default 'hourly',      -- 'hourly'=時給制 / 'monthly'=月給制
  hourly_rate int,                              -- 時給（円）hourly のとき使用
  monthly_salary int,                           -- 月額固定給（円）monthly のとき使用
  fixed_overtime int not null default 0,        -- 固定残業手当（円・みなし）monthly のとき使用
  commute_round_trip int,                        -- 通勤手当の往復額/日（円）NULL=未取得
  freee_employee_code text,                      -- freee 従業員コード（第2弾以降の連携用・任意）
  note text,
  updated_at timestamptz default now(),
  primary key (user_id, effective_from)
);

-- 給与額は機微なので anon から読めないようにする（doctor_rates と同じ方針）。
-- API は service_role で読むので RLS 有効でも動く。ポリシーは作らない＝anon は全拒否。
alter table public.staff_wages enable row level security;

-- ------------------------------------------------------------------
-- 2. 給与を見られる人の名簿
-- ------------------------------------------------------------------
create table if not exists public.payroll_viewers (
  id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz default now()
);
alter table public.payroll_viewers enable row level security;

-- ------------------------------------------------------------------
-- 3. 初期メンバー（まずは長岡CDOのみ。増やすときは画面 or ここに追記して再実行）
-- ------------------------------------------------------------------
insert into public.payroll_viewers (id)
select id from public.profiles where name like '%長岡%'
on conflict (id) do nothing;

-- ------------------------------------------------------------------
-- 4. 時給/月給マスタの初期値（給与ルール_全社まとめ.md 2026-09-17 時点）
--    氏名の like で profiles に突合。取り違えが無いか末尾の SELECT で確認すること。
--    アカウント未作成の人の行は何も起きない（後で再実行すればよい）。
--    ※ 秋丸 樹里 / Ryu Terufumi（笠 光史）= 契約情報未入手のため seed しない。
-- ------------------------------------------------------------------
-- 時給制スタッフ
insert into public.staff_wages (user_id, effective_from, pay_type, hourly_rate, commute_round_trip, note)
select id, date '2026-07-18', 'hourly', 3000, 764, '看護師' from public.profiles where name like '%加藤%'
on conflict (user_id, effective_from) do nothing;

insert into public.staff_wages (user_id, effective_from, pay_type, hourly_rate, commute_round_trip, note)
select id, date '2026-09-01', 'hourly', 2500, null, '看護師・通勤手当未取得' from public.profiles where name like '%三好%'
on conflict (user_id, effective_from) do nothing;

insert into public.staff_wages (user_id, effective_from, pay_type, hourly_rate, commute_round_trip, note)
select id, date '2026-07-31', 'hourly', 2400, 778, '看護師' from public.profiles where name like '%武隈%'
on conflict (user_id, effective_from) do nothing;

insert into public.staff_wages (user_id, effective_from, pay_type, hourly_rate, commute_round_trip, note)
select id, date '2026-08-01', 'hourly', 2300, 356, '受付カウンセラー' from public.profiles where name like '%内田%'
on conflict (user_id, effective_from) do nothing;

insert into public.staff_wages (user_id, effective_from, pay_type, hourly_rate, commute_round_trip, note)
select id, date '2026-07-20', 'hourly', 2000, 572, '受付カウンセラー' from public.profiles where name like '%黒沼%'
on conflict (user_id, effective_from) do nothing;

insert into public.staff_wages (user_id, effective_from, pay_type, hourly_rate, commute_round_trip, note)
select id, date '2026-09-01', 'hourly', 1600, null, '受付カウンセラー・試用期間〜11/30・通勤手当未取得' from public.profiles where name like '%田中%'
on conflict (user_id, effective_from) do nothing;

insert into public.staff_wages (user_id, effective_from, pay_type, hourly_rate, commute_round_trip, note)
select id, date '2026-07-01', 'hourly', 2500, null, '会長ドライバー・契約書なし/時間外/源泉/社保/通勤手当すべて要確認' from public.profiles where name like '%山本%'
on conflict (user_id, effective_from) do nothing;

-- 正社員（月給固定）：NOH JAEBONG（パトリック）
insert into public.staff_wages (user_id, effective_from, pay_type, monthly_salary, fixed_overtime, note)
select id, date '2026-07-01', 'monthly', 400000, 80000, '正社員・社保雇用保険あり(唯一)・SNS手当/通勤手当はfreeeその他手当・欠勤控除は手入力' from public.profiles where name like '%NOH%' or name like '%パトリック%' or name like '%JAEBONG%'
on conflict (user_id, effective_from) do nothing;

-- 確認用: 誰にどの単価が入ったか
select p.name, w.effective_from, w.pay_type, w.hourly_rate, w.monthly_salary, w.fixed_overtime, w.commute_round_trip, w.note
from public.staff_wages w join public.profiles p on p.id = w.user_id
order by p.name, w.effective_from;
