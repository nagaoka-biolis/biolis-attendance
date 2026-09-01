-- AIチャット（BiOLiS AI）の利用者名簿と監査ログ
-- Supabase SQL Editor で1回だけ実行。警告が出たら「Run without RLS」を選ぶ。
-- （このアプリはサーバ側 service_role で書き込み、権限はAPI側で判定するため RLS は無効）
--
-- ■ 他の権限テーブルとの違い
-- receipt_managers / inventory_roles は「admin なら自動でOK ＋ 名簿もOK」方式。
-- ai_users は **名簿に載っている人だけ** で、role='admin' でも通さない。
-- 理由: 売上は現状アプリ画面に出ておらずLINE WORKS通知のみ。AIチャットで初めて
-- アプリから経営数字が見えるため、勤怠の管理者が増えたときに売上まで自動で
-- ついてくるのを防ぐ。「勤怠を管理できる」と「経営数字を見られる」を分離する。

create table if not exists public.ai_users (
  id uuid primary key references public.profiles(id) on delete cascade,
  -- 何を答えてよいか。'exec' = 経営数字(売上・医師別実績)まで可 / 'self' = 自分の勤怠のみ
  -- 将来スタッフに開放するときは 'self' で追加する。判定はAPI側。
  scope text not null default 'exec',
  created_at timestamptz default now()
);

alter table public.ai_users disable row level security;

-- 監査ログ。誰がいつ何を聞いたか。
-- 監視が目的ではなく「経営数字を扱うツールで、利用者を限定し記録も残る」と
-- 説明できるようにするための守り。
-- ※ model 列は実費の集計に必須（モデルによって単価が5倍違うため、
--    どのモデルで答えたかが無いと後から金額を出せない）。
create table if not exists public.ai_chat_logs (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,
  question text,
  answer text,
  model text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz default now()
);

alter table public.ai_chat_logs disable row level security;
create index if not exists ai_chat_logs_created_idx on public.ai_chat_logs (created_at desc);
create index if not exists ai_chat_logs_user_idx on public.ai_chat_logs (user_id, created_at desc);


-- ------------------------------------------------------------------
-- 初期メンバーの登録（2026-09-01 時点は長岡CDO・廣田CEO の2名のみ）
-- 氏名で照合するので、書き換えは不要。
-- 廣田CEOのアカウントを作る前に実行しても、その行は何も起きない（後で再実行すればよい）。
-- ------------------------------------------------------------------

insert into public.ai_users (id, scope)
select id, 'exec' from public.profiles where name like '%長岡%'
on conflict (id) do nothing;

insert into public.ai_users (id, scope)
select id, 'exec' from public.profiles where name like '%廣田%'
on conflict (id) do nothing;

-- 確認用: 誰が登録されたか
select p.name, a.scope from public.ai_users a join public.profiles p on p.id = a.id;
