-- ============================================================================
-- 로컬 검증 전용 — supabase/2026-09-30_data0901_student_admin.sql (수강생 관리자 지정)
--   가입 전 → 기본 정보 전 → 저장 뒤 세 단계에서 실행해 보고, data0901_profiles 밖은 건드리지 않는지 본다.
-- ⚠ 운영에서 실행할 수 없습니다(가드 내장).
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;
reset role;
reset request.jwt.claim.sub;
do $t$ begin raise notice '[공용] data0901 — 수강생 관리자 지정 SQL'; end $t$;

create temp table _n as select count(*) as n_prof from public.data0901_profiles;

-- ① 가입 전 — 아무것도 바뀌지 않는다
\ir ../../supabase/2026-09-30_data0901_student_admin.sql
do $t$ begin
  perform public._assert_eq((select count(*)::int from public.data0901_profiles), (select n_prof::int from _n), '가입 전: 회원 표 그대로');
end $t$;

-- ② 가입만 하고 기본 정보 전 — 그대로
insert into auth.users (id, email) values ('10000000-0000-0000-0000-0000000000f1', 'Noja2178@gmail.com') on conflict (id) do nothing;
-- 공용 표 스냅숏 — 가입(auth.users insert)이 만든 www_profiles 행까지 포함한 뒤의 모습
create temp table _before as
  select (select md5(string_agg(t::text, '|' order by t::text)) from public.www_profiles t) as www_p,
         (select md5(string_agg(t::text, '|' order by t::text)) from public.www_admins t) as www_a,
         0 as _;

\ir ../../supabase/2026-09-30_data0901_student_admin.sql
do $t$ begin
  perform public._assert_eq((select count(*)::int from public.data0901_profiles where user_id = '10000000-0000-0000-0000-0000000000f1'), 0, '기본 정보 전: 행을 만들지 않는다');
end $t$;

-- ③ 기본 정보 저장(승인 대기) 뒤 실행 → 승인 ADMIN, 두 번 실행해도 같다
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000f1';
insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, country_cd, region)
values (auth.uid(), 'noja2178@gmail.com', '김봉수', '010-7777-8888', 'noja2178@gmail.com', false, 'KR', '경기');
do $t$ begin
  perform public._assert_eq((select approval || '/' || role from public.data0901_profiles where user_id = auth.uid()), 'Pending/USER', '(전제) 가입은 승인 대기 USER');
  perform public._assert(not public.data0901_is_admin(), '(전제) 지정 전에는 관리자 아님');
end $t$;
reset role;
reset request.jwt.claim.sub;
\ir ../../supabase/2026-09-30_data0901_student_admin.sql
\ir ../../supabase/2026-09-30_data0901_student_admin.sql
do $t$ begin
  perform public._assert_eq((select approval || '/' || role || '/' || manage_territory from public.data0901_profiles
                               where user_id = '10000000-0000-0000-0000-0000000000f1'),
    'Approved/ADMIN/경기; 경남; 전라; 충청; 강원; Direct Sales', '지정 뒤: 승인 ADMIN · 관리 지역(이메일 대소문자 무시)');
  perform public._assert_eq((select md5(string_agg(t::text, '|' order by t::text)) from public.www_profiles t), (select www_p from _before),
    'www_profiles 는 바뀌지 않는다');
  perform public._assert_eq((select md5(string_agg(t::text, '|' order by t::text)) from public.www_admins t), (select www_a from _before),
    'www_admins 는 바뀌지 않는다');
end $t$;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000f1';
do $t$ begin
  perform public._assert(public.data0901_is_admin(), '지정된 수강생은 관리자 판정 참');
  perform public._assert_eq((select count(*)::int from storage.objects where name like 'originals/%'), 3, '지정된 수강생은 제공 자료를 본다');
end $t$;
reset role;
reset request.jwt.claim.sub;
