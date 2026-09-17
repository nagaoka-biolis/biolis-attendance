-- 月給者の「その他手当」（例：パトリックのSNS手当50,000）を扱えるようにする。
-- パトリックの月給400,000の内訳＝基本給270,000＋固定残業80,000＋SNS手当50,000。
-- Supabase SQL Editor で1回だけ実行。

alter table public.staff_wages add column if not exists other_allowance int not null default 0;      -- その他手当（円）
alter table public.staff_wages add column if not exists other_allowance_label text;                  -- その他手当の名称（例：SNS手当）
