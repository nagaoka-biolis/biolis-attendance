-- doctor_rates に「発効日(effective_from)」を追加し、単価の途中変更に対応する。
-- Supabase SQL Editor で1回だけ実行。警告が出たら「Run without RLS」を選ぶ。
--
-- 背景: 金子先生は 2026/9/1 から日給 140,000→120,000。従来は1人1行(主キー=user_id)で
-- 途中変更を表せなかった。主キーを (user_id, effective_from) に変え、日ごとに有効な
-- 単価を使う（計算側 /api/payroll は対応済み）。既存行は 2026-07-01 発効として残す。

-- 1) 列を足して既存行を 2026-07-01 発効にする
alter table public.doctor_rates add column if not exists effective_from date;
update public.doctor_rates set effective_from = date '2026-07-01' where effective_from is null;
alter table public.doctor_rates alter column effective_from set not null;

-- 2) 主キーを (user_id) → (user_id, effective_from) に付け替える（制約名に依存しない形で）
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.doctor_rates'::regclass and contype = 'p';
  if c is not null then execute format('alter table public.doctor_rates drop constraint %I', c); end if;
end $$;
alter table public.doctor_rates add primary key (user_id, effective_from);

-- 3) 金子先生：2026/9/1 から日給 120,000（旧 140,000 の行はそのまま 2026-07-01 発効で残る）
insert into public.doctor_rates (user_id, effective_from, employ_daily, contract_daily, monthly_allowance, both_contracts, contractor_name, note)
select user_id, date '2026-09-01', 120000, 0, 0, false, contractor_name, '2026/9/1〜 日給12万（旧14万）'
from public.doctor_rates
where effective_from = date '2026-07-01'
  and user_id in (select id from public.profiles where name like '%金子%')
on conflict (user_id, effective_from) do nothing;

-- 4) ついでに佐々木先生の受託者名を埋める（「要確認」→ AIコンサル㈱）
update public.doctor_rates set contractor_name = 'AIコンサル株式会社'
where user_id in (select id from public.profiles where name like '%佐々木%')
  and (contractor_name is null or contractor_name like '%要確認%');

-- 確認: 発効日つきで全単価を表示
select p.name, r.effective_from, r.employ_daily, r.contract_daily, r.both_contracts, r.monthly_allowance, r.contractor_name
from public.doctor_rates r join public.profiles p on p.id = r.user_id
order by p.name, r.effective_from;
