-- スタッフ→管理者の連絡メッセージ用テーブル
-- Supabase SQL Editor で1回だけ実行する
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now(),
  resolved boolean default false
);

-- 既存テーブル（attendance等）と同じく、アプリ（anonキー）から読み書きできるようにする
alter table public.messages disable row level security;
