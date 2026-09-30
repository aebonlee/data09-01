-- ============================================================================
-- data09-01 (hdx-ps) — 수강생 김봉수 님(noja2178@gmail.com)을 이 사이트 관리자(ADMIN)로 지정
--
--  실행 위치 : 공용 Supabase 프로젝트 SQL Editor — 대표가 실행 (화면으로 해도 됩니다: 아래 「권장」)
--  바꾸는 것 : public.data0901_profiles 한 행뿐 (auth.users 는 이메일로 user_id 를 찾으려고 읽기만)
--              www_* · user_profiles 등 다른 공용 개체는 건드리지 않습니다.
--  재실행    : 안전합니다 — 몇 번 실행해도 같은 결과. 아직 가입 전이거나 기본 정보 저장 전이면
--              아무것도 바꾸지 않고 안내(NOTICE)만 냅니다.
--
--  권장 : SQL 대신 화면으로 — 수강생이 https://hdx-ps.jobability.co.kr/ 에서 구글로 가입하고 「내 정보」를
--         저장하면, 대표 계정으로 로그인해 「회원 관리」에서 그 회원을 「승인」하고 권한 ADMIN·관리 지역을 고릅니다.
--  관리 지역 기본값 : 국내 5개 + Direct Sales (화면에서 언제든 고칠 수 있음)
-- ============================================================================
do $admin$
declare
  v_email constant text := 'noja2178@gmail.com';
  v_uid   uuid;
  v_n     int;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email) limit 1;
  if v_uid is null then
    raise notice '% 계정이 아직 가입하지 않았습니다. 구글로 한 번 로그인한 뒤 다시 실행해 주세요.', v_email;
    return;
  end if;
  update public.data0901_profiles
     set approval = 'Approved', role = 'ADMIN',
         manage_territory = case when coalesce(manage_territory, '') = '' then '경기; 경남; 전라; 충청; 강원; Direct Sales' else manage_territory end
   where user_id = v_uid;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise notice '% 계정은 가입했지만 「내 정보」(기본 정보)를 아직 저장하지 않았습니다. 저장한 뒤 다시 실행해 주세요.', v_email;
  else
    raise notice '% 계정을 승인된 관리자(ADMIN)로 지정했습니다.', v_email;
  end if;
end;
$admin$;

-- 확인
--   select reg_id, approval, role, manage_territory from public.data0901_profiles
--    where user_id = (select id from auth.users where lower(email) = 'noja2178@gmail.com');
