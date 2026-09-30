-- ============================================================================
-- 로컬 검증 전용 — supabase/2026-09-30_data0901_auth.sql (공용 프로젝트용) 검증
--   역할 전환으로 실제 사용자처럼 질의합니다.
--     set role authenticated + request.jwt.claim.sub = uuid → auth.uid()
--     set role anon                                          → 비로그인
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
do $t$ begin raise notice '[공용] data0901 — 재실행 · 가입 승인 · 권한 · Storage'; end $t$;

-- ── 0. 재실행·구조 (run.sh 가 두 번 적용한 뒤) ─────────────────────────────
do $t$
begin
  perform public._assert_eq((select count(*)::int from pg_trigger where tgname = 'data0901_profiles_guard'), 1,
    '보호 트리거 하나 (두 번 적용 후에도)');
  perform public._assert_eq((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
                              where c.relname = 'data0901_profiles'), 4, 'data0901_profiles 정책 4개 (중복 없음)');
  perform public._assert_eq((select count(*)::int from pg_policy where polname like 'data0901\_manuals\_%'), 4,
    'Storage 정책 4개 (중복 없음)');
  perform public._assert_eq((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
                              where c.relname = 'data0901_profiles' and p.polcmd = 'd'), 0, '회원 표에 DELETE 정책이 없다');
  perform public._assert_eq((select public from storage.buckets where id = 'data0901-manuals'), false, '매뉴얼 버킷은 private');
  perform public._assert((select proconfig::text like '%search_path=public%' from pg_proc where proname = 'data0901_guard_profile'),
    '트리거 함수 search_path = public 고정');
  perform public._assert((select prosecdef from pg_proc where proname = 'data0901_is_admin'), '판정 함수는 security definer');
  perform public._assert(not has_function_privilege('anon', 'public.data0901_is_admin()', 'EXECUTE'), 'anon 은 data0901_is_admin 실행 불가');
  perform public._assert(not has_function_privilege('anon', 'public.data0901_is_approved()', 'EXECUTE'), 'anon 은 data0901_is_approved 실행 불가');
  perform public._assert(has_function_privilege('authenticated', 'public.data0901_is_approved()', 'EXECUTE'), 'authenticated 는 판정 함수 실행 가능(정책 식)');
end $t$;

-- ── 1. 계정 준비 (postgres) ─────────────────────────────────────────────
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-00000000000a', 'mech-a@example.com'),
  ('10000000-0000-0000-0000-00000000000b', 'mech-b@example.com'),
  ('10000000-0000-0000-0000-0000000000cc', 'owner@example.com'),
  ('10000000-0000-0000-0000-0000000000dd', 'student@example.com')
on conflict (id) do nothing;
insert into public.www_admins (user_id, note) values ('10000000-0000-0000-0000-0000000000cc', '대표 계정(스텁)')
on conflict (user_id) do nothing;
insert into storage.objects (bucket_id, name) values ('data0901-manuals', 'BRP-9_SM.manual.json.gz');

-- ── 2. 정비사 A — 가입은 승인 대기로 고정 ─────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
do $t$
declare v_raised boolean;
begin
  insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, dealer_name, country_cd, region, territory_cd,
                                        approval, role, manage_territory)
  values (auth.uid(), 'mech-a@example.com', '정비사A', '010-1234-5678', 'mech-a@example.com', true, '경기딜러', 'KR', '경기', '경기',
          'Approved', 'ADMIN', '경기');
  perform public._assert_eq((select approval || '/' || role || '/' || manage_territory from public.data0901_profiles where user_id = auth.uid()),
    'Pending/USER/', '가입은 승인 대기·USER·관리 지역 없음 (본인이 Approved·ADMIN 을 적어도)');
  perform public._assert(not public.data0901_is_approved(), '승인 전에는 승인 회원이 아니다');
  perform public._assert_eq((select count(*)::int from storage.objects where bucket_id = 'data0901-manuals'), 0,
    '승인 전에는 매뉴얼 파일이 보이지 않는다');

  v_raised := false;
  begin
    update public.data0901_profiles set approval = 'Approved' where user_id = auth.uid();
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, '본인이 승인 칸을 바꾸면 거부된다');

  v_raised := false;
  begin
    update public.data0901_profiles set role = 'ADMIN' where user_id = auth.uid();
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, '본인이 권한을 ADMIN 으로 바꾸면 거부된다');

  update public.data0901_profiles set phone = '+82 10-9999-0000', reg_id = 'hijack' where user_id = auth.uid();
  perform public._assert_eq((select phone from public.data0901_profiles where user_id = auth.uid()), '+82 10-9999-0000',
    '본인은 전화번호 등 기본 정보를 고칠 수 있다');
  perform public._assert_eq((select reg_id from public.data0901_profiles where user_id = auth.uid()), 'mech-a@example.com',
    '아이디(reg_id)는 가입 뒤 바뀌지 않는다');

  v_raised := false;
  begin
    insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, country_cd, region)
    values ('10000000-0000-0000-0000-00000000000b', 'fake-b', '가짜', '010-0000-0000', 'x@example.com', false, 'KR', '경기');
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, '남의 계정으로 회원 행을 만들 수 없다 (RLS)');

  delete from public.data0901_profiles where user_id = auth.uid();
  perform public._assert_eq((select count(*)::int from public.data0901_profiles where user_id = auth.uid()), 1,
    '삭제 정책이 없어 본인 행도 지워지지 않는다');
end $t$;

-- 제약 — 형식이 틀린 값은 DB 가 막는다
set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000b';
do $t$
declare v_raised boolean;
begin
  v_raised := false;
  begin
    insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, country_cd, region)
    values (auth.uid(), 'mech-b@example.com', '정비사B', '12', 'mech-b@example.com', false, 'KR', '경남');
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '전화번호 형식 오류는 거부된다');
  v_raised := false;
  begin
    insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, country_cd, region)
    values (auth.uid(), 'mech-b@example.com', '정비사B', '010-2222-3333', 'mech-b@example.com', false, 'Korea', '경남');
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '국가 코드는 ISO 두 글자만 받는다');
  v_raised := false;
  begin
    insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, country_cd, region)
    values (auth.uid(), 'MECH-A@example.com', '정비사B', '010-2222-3333', 'mech-b@example.com', false, 'KR', '경남');
  exception when unique_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '아이디는 대소문자만 달라도 중복으로 막힌다');

  insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, country_cd, region, territory_cd)
  values (auth.uid(), 'mech-b@example.com', 'Mechanic B', '+49 151 2345 6789', 'mech-b@example.com', true, 'DE', 'Bavaria', 'Europe');
  perform public._assert_eq((select count(*)::int from public.data0901_profiles), 1, 'B 는 자기 행만 보인다 (A 의 행은 안 보임)');
end $t$;

-- ── 3. 대표 계정 — 가입과 동시에 승인 관리자, 회원 승인 ───────────────────────
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000cc';
do $t$
begin
  insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, country_cd, region)
  values (auth.uid(), 'owner@example.com', '대표', '010-1111-2222', 'owner@example.com', false, 'KR', '경기');
  perform public._assert_eq((select approval || '/' || role from public.data0901_profiles where user_id = auth.uid()), 'Approved/ADMIN',
    '대표 계정(www_admins)은 가입과 동시에 승인된 관리자');
  perform public._assert_eq((select count(*)::int from public.data0901_profiles), 3, '관리자는 모든 회원을 본다');
  update public.data0901_profiles set approval = 'Approved' where reg_id = 'mech-a@example.com';
  perform public._assert_eq((select approved_by from public.data0901_profiles where reg_id = 'mech-a@example.com'),
    auth.uid(), '승인하면 처리자(approved_by)가 기록된다');
  perform public._assert((select approved_at is not null from public.data0901_profiles where reg_id = 'mech-a@example.com'), '승인 시각이 기록된다');
  perform public._assert_eq((select count(*)::int from storage.objects where bucket_id = 'data0901-manuals'), 1, '관리자는 매뉴얼 파일을 본다');
  insert into storage.objects (bucket_id, name) values ('data0901-manuals', '15BRP-X SM_EXP.manual.json.gz');
  perform public._assert_eq((select count(*)::int from storage.objects where bucket_id = 'data0901-manuals'), 2, '관리자는 매뉴얼을 올릴 수 있다');
end $t$;

-- 수강생 D — 가입 뒤 대표가 사이트 관리자로 지정
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000dd';
insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, country_cd, region)
values (auth.uid(), 'student@example.com', '수강생', '010-3333-4444', 'student@example.com', false, 'KR', '경기');
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000cc';
update public.data0901_profiles set approval = 'Approved', role = 'ADMIN', manage_territory = '경기; 경남'
 where reg_id = 'student@example.com';

-- ── 4. 승인된 정비사 A — 매뉴얼 읽기만 ─────────────────────────────────────
set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
do $t$
declare v_raised boolean;
begin
  perform public._assert(public.data0901_is_approved(), '승인 뒤에는 승인 회원이다');
  perform public._assert(not public.data0901_is_admin(), '승인 회원이라도 관리자는 아니다');
  perform public._assert_eq((select count(*)::int from storage.objects where bucket_id = 'data0901-manuals'), 2, '승인 회원은 매뉴얼 파일을 읽는다');
  v_raised := false;
  begin
    insert into storage.objects (bucket_id, name) values ('data0901-manuals', 'hack.manual.json');
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, '승인 회원은 매뉴얼을 올릴 수 없다');
  delete from storage.objects where bucket_id = 'data0901-manuals';
  perform public._assert_eq((select count(*)::int from storage.objects where bucket_id = 'data0901-manuals'), 2, '승인 회원은 매뉴얼을 지울 수 없다');
  perform public._assert_eq((select count(*)::int from public.data0901_profiles), 1, '승인 회원도 남의 회원 정보는 못 본다');
end $t$;

-- ── 5. 사이트 관리자(수강생) — 승인·반려, 자기 권한은 못 내림 ──────────────────
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000dd';
do $t$
declare v_raised boolean;
begin
  perform public._assert(public.data0901_is_admin(), '사이트 ADMIN 은 관리자다');
  perform public._assert_eq((select manage_territory from public.data0901_profiles where user_id = auth.uid()), '경기; 경남',
    '관리 지역이 저장된다');
  update public.data0901_profiles set approval = 'Rejected' where reg_id = 'mech-b@example.com';
  perform public._assert_eq((select approval from public.data0901_profiles where reg_id = 'mech-b@example.com'), 'Rejected',
    '사이트 관리자는 반려할 수 있다');
  v_raised := false;
  begin
    update public.data0901_profiles set role = 'USER' where user_id = auth.uid();
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, '관리자는 자기 권한을 스스로 내릴 수 없다(잠김 방지)');
  update public.data0901_profiles set role = 'USER' where reg_id = 'mech-a@example.com';
  perform public._assert_eq((select manage_territory from public.data0901_profiles where reg_id = 'mech-a@example.com'), '',
    'USER 는 관리 지역이 비워진다');
end $t$;

-- 반려된 B 는 매뉴얼을 못 읽는다
set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000b';
do $t$
begin
  perform public._assert_eq((select count(*)::int from storage.objects where bucket_id = 'data0901-manuals'), 0, '반려된 회원은 매뉴얼을 못 읽는다');
  -- www_profiles 공용 정보: 본인 행만 고칠 수 있다 (사이트 온보딩이 쓰는 경로)
  update public.www_profiles set name = 'Mechanic B', phone = '+49 151 2345 6789', signup_site = 'hdx-ps' where user_id = auth.uid();
  perform public._assert_eq((select signup_site || '/' || is_complete::text from public.www_profiles where user_id = auth.uid()),
    'hdx-ps/true', 'www_profiles 본인 행에 가입 출처·기본 정보를 채우면 is_complete');
  update public.www_profiles set name = 'x' where user_id = '10000000-0000-0000-0000-00000000000a';
  perform public._assert_eq((select count(*)::int from public.www_profiles), 1, 'www_profiles 는 본인 행만 보인다');
end $t$;

-- ── 6. 비로그인 ─────────────────────────────────────────────────────────
reset request.jwt.claim.sub;
set role anon;
do $t$
declare v_raised boolean;
begin
  v_raised := false;
  begin
    perform count(*) from public.data0901_profiles;
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, '비로그인은 회원 표를 읽을 수 없다');
  perform public._assert_eq((select count(*)::int from storage.objects where bucket_id = 'data0901-manuals'), 0, '비로그인은 매뉴얼 파일이 안 보인다');
  v_raised := false;
  begin
    perform public.data0901_is_admin();
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, '비로그인은 판정 함수를 호출할 수 없다');
end $t$;
reset role;

-- ── 7. 대표 SQL Editor 직접 실행(auth.uid() 없음) — 적힌 값 그대로 ─────────────
do $t$
begin
  update public.data0901_profiles set approval = 'Approved', role = 'ADMIN' where reg_id = 'mech-b@example.com';
  perform public._assert_eq((select approval || '/' || role from public.data0901_profiles where reg_id = 'mech-b@example.com'), 'Approved/ADMIN',
    'SQL Editor(auth.uid 없음)에서는 승인·권한을 바로 지정할 수 있다');
end $t$;
