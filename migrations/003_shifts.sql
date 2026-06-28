-- シフト用テーブル
-- Supabase SQL Editor で1回だけ実行。警告が出たら「Run without RLS」を選ぶ
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  date date not null,
  start_time text,            -- "10:00"（休みの場合は null）
  end_time text,              -- "19:00"
  kind text not null default 'work',   -- work=出勤 / off=休み / paid=有給
  status text not null default '確定',  -- 確定 / 申請中 など
  note text,                  -- 備考（OP・ドレーンOFF 等）
  created_at timestamptz default now(),
  unique (user_id, date)
);

alter table public.shifts disable row level security;
