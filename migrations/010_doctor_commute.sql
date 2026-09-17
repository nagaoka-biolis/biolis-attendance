-- 医師の「定期通勤手当（固定の電車賃）」を doctor_rates に追加。
-- Supabase SQL Editor で1回だけ実行。
--
-- 通勤手当（定期）＝ 往復額/日 × 出勤日数（月上限つき）。領収書の実費交通費とは別ライン。
-- 上限は雇用の通勤手当で全員 月40,000円（ファイル準拠）。設定した先生だけ自動計上される。
-- 計算側 /api/payroll は対応済み。

alter table public.doctor_rates add column if not exists commute_round_trip int;  -- 往復額/日（円）NULL=なし
alter table public.doctor_rates add column if not exists commute_cap int;         -- 月上限（円）NULL=上限なし

-- 既知の4名（ファイル 2026-09-17）
update public.doctor_rates set commute_round_trip = 682, commute_cap = 40000
where user_id in (select id from public.profiles where name like '%金子%');

update public.doctor_rates set commute_round_trip = 504, commute_cap = 40000
where user_id in (select id from public.profiles where name like '%今井%');

update public.doctor_rates set commute_round_trip = 3780, commute_cap = 40000
where user_id in (select id from public.profiles where name like '%金 喜燦%' or name like '%喜燦%');

-- 龍先生：往復840円/日（東京駅〜下北沢）・上限4万
update public.doctor_rates set commute_round_trip = 840, commute_cap = 40000
where user_id in (select id from public.profiles where name like '%龍%');

-- 鑓水（車通勤・申請なし）・佐々木（実費のみ）は設定しない＝自動計上しない。

select p.name, r.effective_from, r.commute_round_trip, r.commute_cap
from public.doctor_rates r join public.profiles p on p.id = r.user_id
order by p.name, r.effective_from;
