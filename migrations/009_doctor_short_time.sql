-- 医師の「短時間勤務の按分」を先生ごとに設定できるようにする。
-- Supabase SQL Editor で1回だけ実行。警告が出たら「Run without RLS」を選ぶ。
--
-- 仕組み（1つのモード＋しきい値で全員を表せる）:
--   働いた時間 ＝ シフト(終了-開始) − 法定休憩（6h以下=0 / 6h超8h以下=45分 / 8h超=60分）
--   short_time_mode='prorate' の日で、働いた時間 < full_day_hours なら
--     日給・日額 × (働いた時間 / 8) に按分。full_day_hours 以上なら満額(1日)。
--   龍・今井 = しきい値8時間 ／ 佐々木 = しきい値3時間（3h以上は1日）／ その他 = 按分なし。
-- 計算側 /api/payroll は対応済み。

alter table public.doctor_rates add column if not exists short_time_mode text not null default 'none';
alter table public.doctor_rates add column if not exists full_day_hours numeric not null default 8;

-- 龍先生：8時間未満は按分（個人=雇用/法人=委託の両方）
update public.doctor_rates set short_time_mode = 'prorate', full_day_hours = 8
where user_id in (select id from public.profiles where name like '%龍%');

-- 今井先生：延長・短時間は時給15,000（=日給12万÷8）＝按分と同じ
update public.doctor_rates set short_time_mode = 'prorate', full_day_hours = 8
where user_id in (select id from public.profiles where name like '%今井%');

-- 佐々木先生：3時間以上は1日、未満は按分（時給＝日給÷8＝雇用6,250/委託12,500）
update public.doctor_rates set short_time_mode = 'prorate', full_day_hours = 3
where user_id in (select id from public.profiles where name like '%佐々木%');

-- 確認
select p.name, r.effective_from, r.employ_daily, r.contract_daily, r.short_time_mode, r.full_day_hours
from public.doctor_rates r join public.profiles p on p.id = r.user_id
order by p.name, r.effective_from;
