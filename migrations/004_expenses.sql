-- 交通費・経費申請テーブル
-- Supabase SQL Editor で1回だけ実行。警告が出たら「Run without RLS」を選ぶ。
-- （このアプリはサーバ側 service_role で書き込み、権限はAPI側で判定するため RLS は無効）
create table if not exists public.expense_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,  -- 申請者
  date date not null,                       -- 利用日
  amount integer not null,                  -- 金額(円・税込実費)
  category text not null default '交通費',   -- 費目（交通費 / その他経費 など）
  from_place text,                          -- 出発
  to_place text,                            -- 到着
  transport text,                           -- 交通手段（電車 / バス / タクシー 等）
  purpose text,                             -- 目的・理由
  receipt_url text,                         -- 領収書写真URL（Storage: expense-receipts）
  status text not null default 'pending',   -- pending=申請中 / approved=承認 / rejected=却下
  reject_reason text,                       -- 却下理由
  reviewed_by uuid references public.profiles(id),  -- 承認/却下した管理者
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_expense_user_date on public.expense_requests (user_id, date);
create index if not exists idx_expense_status on public.expense_requests (status);

alter table public.expense_requests disable row level security;
