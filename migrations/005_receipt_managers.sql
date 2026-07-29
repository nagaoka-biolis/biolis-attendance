-- 経理（領収書 手動保管）権限テーブル
-- Supabase SQL Editor で1回だけ実行。警告が出たら「Run without RLS」を選ぶ。
-- （このアプリはサーバ側 service_role で書き込み、権限はAPI側で判定するため RLS は無効）
--
-- 使い方: この行に user_id があれば「経理」権限あり＝領収書の手動保管ページを使える。
-- 在庫権限(inventory_roles)と同じ「別レイヤーの追加権限」方式。メインの role(admin/staff)は変えない。
create table if not exists public.receipt_managers (
  id uuid primary key references public.profiles(id) on delete cascade,  -- 経理権限を持つユーザー
  created_at timestamptz default now()
);

alter table public.receipt_managers disable row level security;
