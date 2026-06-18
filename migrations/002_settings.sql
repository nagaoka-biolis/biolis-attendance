-- アプリ設定用テーブル（所定労働時間など）
-- Supabase SQL Editor で1回だけ実行する。実行時の警告は「Run without RLS」を選ぶ
create table if not exists public.app_settings (
  key text primary key,
  value text
);

alter table public.app_settings disable row level security;

-- 所定労働時間の初期値：8時間（480分）
insert into public.app_settings (key, value)
values ('standard_work_minutes', '480')
on conflict (key) do nothing;
