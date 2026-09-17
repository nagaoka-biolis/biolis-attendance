-- freee連携用の従業員番号マスタ。freeeの勤怠サマリーCSVは「従業員番号」で紐付けるため、
-- freee側とアプリ側で同じ番号を持つ必要がある。まずは仮番号を自動採番しておき、
-- 社内で正式番号が決まったら差し替える（アプリ画面 or ここで更新）。
-- Supabase SQL Editor で1回だけ実行。

create table if not exists public.freee_employee_map (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  employee_code text,           -- freeeの従業員番号（仮番号→正式番号に差し替え）
  updated_at timestamptz default now()
);
alter table public.freee_employee_map enable row level security;  -- API(service_role)経由のみ

-- 仮番号を作成順に採番（1001から）。既に番号がある人は触らない。
insert into public.freee_employee_map (user_id, employee_code)
select id, (1000 + row_number() over (order by created_at))::text
from public.profiles
on conflict (user_id) do nothing;

select p.name, m.employee_code
from public.freee_employee_map m join public.profiles p on p.id = m.user_id
order by (m.employee_code)::int;
