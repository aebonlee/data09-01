-- ============================================================================
-- 로컬 검증 전용 — supabase/2026-09-30_data0901_originals.sql (제공 자료 원본 보관) 검증
--   30_data0901_shared.local.sql 뒤에 돕니다(그 파일이 만든 계정을 씁니다):
--     A(…0a) 승인 USER · B(…0b) 관리자(SQL Editor 지정) · 대표(…cc, www_admins) · 수강생(…dd) 사이트 ADMIN
--   run.sh 가 originals SQL → auth SQL 재실행 → originals SQL 순으로 적용해 둔 상태입니다.
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
do $t$ begin raise notice '[공용] data0901 — 제공 자료 원본(originals/)'; end $t$;

-- ── 0. 버킷 제한 ────────────────────────────────────────────────────────
do $t$
declare b storage.buckets;
begin
  select * into b from storage.buckets where id = 'data0901-manuals';
  perform public._assert_eq(b.public, false, '버킷은 여전히 private');
  perform public._assert_eq(b.file_size_limit, 104857600::bigint, '한 파일 100MB');
  perform public._assert(b.allowed_mime_types @> array['application/gzip', 'application/json'], '매뉴얼 색인 형식(gzip·json)은 그대로 허용');
  perform public._assert(b.allowed_mime_types @> array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/png', 'image/jpeg', 'application/zip', 'application/octet-stream'],
    '원본 형식(PDF·docx·xlsx·pptx·사진·zip·기타)이 허용된다');
  perform public._assert_eq((select count(*)::int from pg_policy where polname like 'data0901\_%' and polrelid = 'storage.objects'::regclass), 4,
    'Storage 정책은 auth SQL 의 4개 그대로(새 정책 없음)');
end $t$;

-- ── 1. 관리자(수강생 사이트 ADMIN) — 원본 올리기 ────────────────────────────
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000dd';
do $t$
begin
  insert into storage.objects (bucket_id, name) values
    ('data0901-manuals', 'originals/_index.json'),
    ('data0901-manuals', 'originals/20260928-06_screen.xlsx');
  perform public._assert_eq((select count(*)::int from storage.objects where name like 'originals/%'), 2, '사이트 관리자는 originals/ 에 올린다');
  delete from storage.objects where name = 'originals/20260928-06_screen.xlsx';
  insert into storage.objects (bucket_id, name) values ('data0901-manuals', 'originals/20260928-06_screen.xlsx');
  perform public._assert_eq((select count(*)::int from storage.objects where name like 'originals/%'), 2, '사이트 관리자는 원본을 지우고 다시 올린다');
end $t$;

-- 대표 계정(www_admins) — 원본 올리기
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000cc';
insert into storage.objects (bucket_id, name) values ('data0901-manuals', 'originals/20260929-100D-9V_SM_ENG.pdf');
do $t$ begin
  perform public._assert_eq((select count(*)::int from storage.objects where name like 'originals/%'), 3, '대표 계정(www_admins)도 원본을 올린다');
end $t$;

-- ── 2. 승인 USER(정비사 A) — 읽기만 ────────────────────────────────────────
set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
do $t$
declare v_raised boolean;
begin
  perform public._assert_eq((select approval || '/' || role from public.data0901_profiles where user_id = auth.uid()), 'Approved/USER', '(전제) A 는 승인 USER');
  perform public._assert_eq((select count(*)::int from storage.objects where name like 'originals/%'), 3, '승인 회원은 원본 목록·파일을 읽는다');
  v_raised := false;
  begin
    insert into storage.objects (bucket_id, name) values ('data0901-manuals', 'originals/hack.pdf');
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, '승인 회원은 원본을 올릴 수 없다');
  delete from storage.objects where name like 'originals/%';
  perform public._assert_eq((select count(*)::int from storage.objects where name like 'originals/%'), 3, '승인 회원은 원본을 지울 수 없다');
end $t$;

-- ── 3. 승인 대기 · 비로그인 — 보이지 않는다 ────────────────────────────────
reset role;
insert into auth.users (id, email) values ('10000000-0000-0000-0000-0000000000ee', 'pending@example.com') on conflict (id) do nothing;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-0000-0000-0000000000ee';
insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, country_cd, region)
values (auth.uid(), 'pending@example.com', '대기', '010-5555-6666', 'pending@example.com', false, 'KR', '경기');
do $t$ begin
  perform public._assert_eq((select count(*)::int from storage.objects where name like 'originals/%'), 0, '승인 대기 회원은 원본이 안 보인다');
end $t$;
reset request.jwt.claim.sub;
set role anon;
do $t$ begin
  perform public._assert_eq((select count(*)::int from storage.objects where name like 'originals/%'), 0, '비로그인은 원본이 안 보인다');
end $t$;
reset role;
