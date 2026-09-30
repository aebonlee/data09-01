-- ============================================================================
-- 로컬 검증 전용 — supabase/2026-09-30_data0901_records.sql (기술지원 기록 서버 저장)
--   ① 이 파일이 data0901_ 밖의 개체를 만들거나 바꾸지 않는가 (전부 지웠다가 다시 적용해 카탈로그 대조)
--   ② 권한: 정비사는 자기 건만 / 관리자는 전부 / 승인 대기·비로그인은 전부 막힘 / 접속 Log 는 수정·삭제 불가
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
do $t$ begin raise notice '[공용] data0901 — 기술지원 기록(등록·문의·회신·소스·메일·접속 Log)'; end $t$;

-- ── 0. 구조 (run.sh 가 두 번 적용한 뒤) ─────────────────────────────────
do $t$
declare v_bad text; t text;
begin
  select string_agg(relname, ', ') into v_bad from pg_class
   where relname in ('data0901_sources', 'data0901_requests', 'data0901_inquiries', 'data0901_replies', 'data0901_mails', 'data0901_access_log')
     and relkind = 'r' and not relrowsecurity;
  perform public._assert(v_bad is null, '기록 표 6개 모두 RLS 켜짐' || coalesce(' (꺼짐: ' || v_bad || ')', ''));
  perform public._assert_eq((select count(*)::int from pg_class where relkind = 'r' and relname in
    ('data0901_sources', 'data0901_requests', 'data0901_inquiries', 'data0901_replies', 'data0901_mails', 'data0901_access_log')), 6, '기록 표 6개');
  foreach t in array array['data0901_sources', 'data0901_requests', 'data0901_inquiries', 'data0901_replies', 'data0901_mails', 'data0901_access_log'] loop
    perform public._assert(not has_table_privilege('anon', 'public.' || t, 'SELECT') and not has_table_privilege('anon', 'public.' || t, 'INSERT')
      and not has_table_privilege('anon', 'public.' || t, 'UPDATE') and not has_table_privilege('anon', 'public.' || t, 'DELETE'), 'anon 에 ' || t || ' 권한 없음');
    perform public._assert(not has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE'), 'authenticated 에 ' || t || ' TRUNCATE 권한 없음');
  end loop;
  perform public._assert_eq((select string_agg(polcmd::text, '' order by polcmd) from pg_policy
                              where polrelid = 'public.data0901_access_log'::regclass), 'ar', '접속 Log 정책은 INSERT(a)·SELECT(r) 두 개뿐');
  perform public._assert(not has_table_privilege('authenticated', 'public.data0901_access_log', 'UPDATE')
                     and not has_table_privilege('authenticated', 'public.data0901_access_log', 'DELETE'), '접속 Log 에 UPDATE·DELETE 권한 없음');
  perform public._assert_eq((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'data0901_requests'), 4, '등록 표 정책 4개 (두 번 적용해도 중복 없음)');
  select string_agg(proname, ', ') into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and proname like 'data0901\_%' and has_function_privilege('anon', p.oid, 'EXECUTE');
  perform public._assert(v_bad is null, 'anon 이 실행할 수 있는 data0901_ 함수 없음' || coalesce(' (' || v_bad || ')', ''));
  select string_agg(proname, ', ') into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and proname like 'data0901\_%' and coalesce(proconfig::text, '') not like '%search_path=public%';
  perform public._assert(v_bad is null, 'data0901_ 함수 전부 search_path = public 고정' || coalesce(' (' || v_bad || ')', ''));
  perform public._assert(not has_sequence_privilege('authenticated', 'public.data0901_mail_no_seq', 'USAGE')
                     and not has_sequence_privilege('anon', 'public.data0901_mail_no_seq', 'USAGE'), '메일 번호 순번은 트리거만 씀');
end $t$;

-- ── 1. 접두사 규칙 — 전부 지웠다가 다시 적용해도 data0901_ 밖은 그대로인가 ────────
create or replace function pg_temp._catalog(p_prefixed boolean) returns table (k text) language sql as $fn$
  select 'class:' || n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'auth', 'storage') and (c.relname like 'data0901\_%') = p_prefixed
  union all
  select 'proc:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':'
         || coalesce(p.proacl::text, '') || ':' || coalesce(p.proconfig::text, '') || ':' || p.prosecdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'auth', 'storage') and (p.proname like 'data0901\_%') = p_prefixed
  union all
  select 'policy:' || pol.polrelid::regclass::text || '.' || pol.polname || ':' || pol.polcmd::text || ':'
         || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ':' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    from pg_policy pol where (pol.polname like 'data0901\_%') = p_prefixed
  union all
  select 'trigger:' || tg.tgrelid::regclass::text || '.' || tg.tgname || ':' || tg.tgfoid::regproc::text from pg_trigger tg
   where not tg.tgisinternal and (tg.tgname like 'data0901\_%') = p_prefixed
  union all
  select 'bucket:' || b.id || ':' || b.public || ':' || coalesce(b.file_size_limit::text, '') || ':' || coalesce(b.allowed_mime_types::text, '')
    from storage.buckets b where not p_prefixed
$fn$;
create temp table _outside_before as select k from pg_temp._catalog(false);
create temp table _data_before as
  select (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.www_profiles t) as www_p,
         (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.www_admins t) as www_a,
         (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.data0901_profiles t) as prof,
         (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from auth.users t) as au,
         (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from storage.objects t) as so;

drop table if exists public.data0901_access_log, public.data0901_mails, public.data0901_replies,
                     public.data0901_inquiries, public.data0901_requests, public.data0901_sources cascade;
drop sequence if exists public.data0901_mail_no_seq;
drop function if exists public.data0901_owns_request(text), public.data0901_last_ref_no(date), public.data0901_find_duplicates(text),
  public.data0901_queue_mail(text, text, text, text, text), public.data0901_close_access_log(bigint), public.data0901_touch(),
  public.data0901_sources_norm(), public.data0901_requests_guard(), public.data0901_rows_stamp(), public.data0901_mails_stamp(),
  public.data0901_access_log_stamp();
create temp table _prefixed_without as select k from pg_temp._catalog(true);

set client_min_messages = warning;
\ir ../../supabase/2026-09-30_data0901_records.sql
\ir ../../supabase/2026-09-30_data0901_records.sql
set client_min_messages = notice;

do $t$
declare v_extra text; v_gone text; v_new text;
begin
  select string_agg(k, E'\n') into v_extra from (select k from pg_temp._catalog(false) except select k from _outside_before) x;
  select string_agg(k, E'\n') into v_gone  from (select k from _outside_before except select k from pg_temp._catalog(false)) x;
  perform public._assert(v_extra is null, 'data0901_ 밖에 새로 생기거나 바뀐 개체 없음 (표·함수·정책·트리거·버킷)' || coalesce(E'\n' || v_extra, ''));
  perform public._assert(v_gone is null, 'data0901_ 밖에서 없어지거나 바뀐 개체 없음' || coalesce(E'\n' || v_gone, ''));
  perform public._assert((select count(*) from (select k from _prefixed_without except select k from pg_temp._catalog(true)) x) = 0,
    '기존 data0901_ 개체(회원 표·판정 함수·Storage 정책)도 바뀌지 않음');
  select string_agg(split_part(k, ':', 2), ', ' order by k) into v_new
    from (select k from pg_temp._catalog(true) except select k from _prefixed_without) x where k like 'class:%' and k like '%:r:%';
  perform public._assert_eq(v_new, 'public.data0901_access_log, public.data0901_inquiries, public.data0901_mails, public.data0901_replies, public.data0901_requests, public.data0901_sources',
    '새 표는 data0901_ 기록 표 6개');
  perform public._assert_eq((select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.www_profiles t), (select www_p from _data_before), 'www_profiles 내용 그대로');
  perform public._assert_eq((select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.www_admins t), (select www_a from _data_before), 'www_admins 내용 그대로');
  perform public._assert_eq((select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.data0901_profiles t), (select prof from _data_before), 'data0901_profiles 내용 그대로');
  perform public._assert_eq((select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from auth.users t), (select au from _data_before), 'auth.users 내용 그대로');
  perform public._assert_eq((select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from storage.objects t), (select so from _data_before), 'storage.objects 내용 그대로');
end $t$;

-- ── 2. 계정 준비 (postgres — auth.uid() 가 없으므로 적은 값 그대로) ───────────
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-00000000000a', 'rec-a@example.com'),
  ('20000000-0000-0000-0000-00000000000b', 'rec-b@example.com'),
  ('20000000-0000-0000-0000-00000000000c', 'rec-adm@example.com'),
  ('20000000-0000-0000-0000-0000000000c2', 'rec-adm2@example.com'),
  ('20000000-0000-0000-0000-00000000000d', 'rec-pending@example.com'),
  ('20000000-0000-0000-0000-0000000000ee', 'rec-owner@example.com')
on conflict (id) do nothing;
insert into public.data0901_profiles (user_id, reg_id, name, phone, e_mail, is_dealer, country_cd, region, territory_cd, approval, role, manage_territory)
values ('20000000-0000-0000-0000-00000000000a', 'rec-a@example.com', '정비사A', '010-1111-2222', 'rec-a@example.com', true, 'KR', '경기', 'Europe', 'Approved', 'USER', ''),
       ('20000000-0000-0000-0000-00000000000b', 'rec-b@example.com', '정비사B', '010-1111-3333', 'rec-b@example.com', true, 'KR', '경남', 'Oceania', 'Approved', 'USER', ''),
       ('20000000-0000-0000-0000-00000000000c', 'rec-adm@example.com', '관리자', '010-1111-4444', 'rec-adm@example.com', false, 'KR', '경남', '', 'Approved', 'ADMIN', 'Oceania'),
       ('20000000-0000-0000-0000-0000000000c2', 'rec-adm2@example.com', '관리자2', '010-1111-4545', 'rec-adm2@example.com', false, 'KR', '경기', '', 'Approved', 'ADMIN', 'Europe; Asia'),
       ('20000000-0000-0000-0000-00000000000d', 'rec-pending@example.com', '대기', '010-1111-5555', 'rec-pending@example.com', false, 'KR', '경기', '경기', 'Pending', 'USER', '')
on conflict (user_id) do nothing;
insert into public.www_admins (user_id, note) values ('20000000-0000-0000-0000-0000000000ee', '대표(스텁)') on conflict (user_id) do nothing;

-- ── 3. 소스 — 관리자만 쓰고, 모델은 대문자로 하나만 ──────────────────────────
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000c';
do $t$ begin
  insert into public.data0901_sources (notebook_name, model, files) values ('BRP 노트북', ' brp-9 ', 'BRP-9_SM.pdf');
  perform public._assert_eq((select model from public.data0901_sources where notebook_name = 'BRP 노트북'), 'BRP-9', '모델은 대문자·공백 없이 저장');
  -- 앱의 upsert(onConflict 'model') 와 같은 모양
  insert into public.data0901_sources (notebook_name, model, files) values ('BRP 노트북 2', 'BRP-9', 'x.pdf')
  on conflict (model) do update set notebook_name = excluded.notebook_name, files = excluded.files;
  perform public._assert_eq((select count(*)::int from public.data0901_sources where model = 'BRP-9'), 1, 'onConflict model 로 같은 모델은 한 행');
  insert into public.data0901_sources (notebook_name, model) values ('100D', '100D-9V');
end $t$;
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000a';
do $t$
declare v_raised boolean := false;
begin
  perform public._assert_eq((select count(*)::int from public.data0901_sources), 2, '승인 정비사는 소스를 읽는다');
  begin insert into public.data0901_sources (notebook_name, model) values ('x', 'HACK');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, '정비사는 소스를 쓰지 못한다');
  update public.data0901_sources set files = 'hacked';
  perform public._assert_eq((select count(*)::int from public.data0901_sources where files = 'hacked'), 0, '정비사의 소스 수정은 0행');
end $t$;
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000d';
do $t$ begin
  perform public._assert_eq((select count(*)::int from public.data0901_sources), 0, '승인 대기 회원은 소스도 안 보인다');
end $t$;

-- ── 4. 정비사 A — 등록 ────────────────────────────────────────────────
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000a';
do $t$
declare r record; v_raised boolean;
begin
  perform public._assert(public.data0901_last_ref_no(date '2026-09-30') is null, '그날 첫 등록 전: 마지막 번호 없음');
  -- 남의 아이디·종료 상태를 적어도 본인·접수로 들어간다
  insert into public.data0901_requests (ref_no, status, reg_date, reg_id, model, serial_no, o_hour, type_cd, system_cat, action_content, owner_id)
  values ('202609300001', 'Completed', '2026-09-30', 'rec-b@example.com', 'BRP-9', 'SN-100', 1234.5, 'Troubleshooting', 'Engine', '가짜', '20000000-0000-0000-0000-00000000000b');
  select * into r from public.data0901_requests where ref_no = '202609300001';
  perform public._assert_eq(r.owner_id, auth.uid(), '등록 건 계정은 본인 (적은 남의 계정 무시)');
  perform public._assert_eq(r.reg_id, 'rec-a@example.com', '등록 아이디는 본인 아이디');
  perform public._assert_eq(r.status || '/' || r.action_content, 'Submitted/', '처음 상태는 접수, 조치 내용 비움');
  -- 문의 1차 — 아이디는 본인으로
  insert into public.data0901_inquiries (ref_no, s_turn, reg_date, reg_id, phenomenon, requirement, s_image)
  values ('202609300001', 1, '2026-09-30', 'someone', '시동 불량', '점검 방법', '202609300001_1.jpg');
  perform public._assert_eq((select reg_id from public.data0901_inquiries where ref_no = '202609300001' and s_turn = 1), 'rec-a@example.com', '문의 아이디는 본인');
  v_raised := false;
  begin insert into public.data0901_inquiries (ref_no, s_turn, reg_id, phenomenon, requirement) values ('202609300001', 1, 'x', '중복', '중복');
  exception when unique_violation then v_raised := true; end;
  perform public._assert(v_raised, '같은 차수 문의는 두 번 들어가지 않는다 (ref_no,s_turn UNIQUE — onConflict 짝)');
  v_raised := false;
  begin insert into public.data0901_replies (ref_no, r_turn, reply_content) values ('202609300001', 1, '셀프 회신');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, '정비사는 회신을 쓰지 못한다');
  v_raised := false;
  begin update public.data0901_requests set status = 'Answered' where ref_no = '202609300001';
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, '정비사는 상태를 회신으로 바꾸지 못한다');
  v_raised := false;
  begin update public.data0901_requests set status = 'Completed', action_content = 'x', complete_date = '2026-09-30' where ref_no = '202609300001';
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, '회신 전에는 종료하지 못한다');
  delete from public.data0901_requests where ref_no = '202609300001';
  perform public._assert_eq((select count(*)::int from public.data0901_requests), 1, '정비사의 삭제는 0행 (삭제는 관리자만)');
  -- 후속 요청: 내용 수정 + 2차 문의
  update public.data0901_requests set o_hour = 1240, reg_id = 'hack', reg_date = '2020-01-01' where ref_no = '202609300001';
  select * into r from public.data0901_requests where ref_no = '202609300001';
  perform public._assert_eq(r.o_hour::text || '/' || r.reg_id || '/' || r.reg_date, '1240.0/rec-a@example.com/2026-09-30', '후속 요청: 내용만 바뀌고 아이디·등록일은 그대로');
  insert into public.data0901_inquiries (ref_no, s_turn, reg_id, phenomenon, requirement) values ('202609300001', 2, 'x', '여전히 불량', '추가 점검');
end $t$;

-- ── 5. 정비사 B — A 의 건이 안 보이고, 번호는 겹치지 않는다 ──────────────────
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000b';
do $t$
declare v_raised boolean;
begin
  perform public._assert_eq((select count(*)::int from public.data0901_requests), 0, 'B 에게 A 의 등록 건은 안 보인다');
  perform public._assert_eq((select count(*)::int from public.data0901_inquiries), 0, 'B 에게 A 의 문의는 안 보인다');
  perform public._assert_eq(public.data0901_last_ref_no(date '2026-09-30'), '202609300001', 'B 도 그날 마지막 번호는 받는다(번호만)');
  insert into public.data0901_requests (ref_no, reg_date, reg_id, model, serial_no, o_hour, type_cd, system_cat)
  values ('202609300002', '2026-09-30', 'x', 'brp-9', ' sn-100 ', 10, 'Maintenance', 'Hydraulic');
  insert into public.data0901_inquiries (ref_no, s_turn, reg_id, phenomenon, requirement) values ('202609300002', 1, 'x', '누유', '점검');
  v_raised := false;
  begin insert into public.data0901_inquiries (ref_no, s_turn, reg_id, phenomenon, requirement) values ('202609300001', 3, 'x', '끼어들기', '끼어들기');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, 'B 는 A 의 건에 문의를 붙이지 못한다');
  v_raised := false;
  begin insert into public.data0901_requests (ref_no, reg_date, reg_id, model, serial_no, o_hour, type_cd, system_cat)
        values ('202609300001', '2026-09-30', 'x', 'BRP-9', 'S', 1, 'Maintenance', 'Engine');
  exception when unique_violation then v_raised := true; end;
  perform public._assert(v_raised, '이미 쓰인 번호로는 등록되지 않는다(번호 겹침은 DB 가 막음)');
  -- 중복 검토: 같은 모델·호기(대소문자·공백 무시)의 A 건이 번호·상태·등록일만 나온다
  perform public._assert_eq((select string_agg(ref_no || '/' || status || '/' || reg_date, ',') from public.data0901_find_duplicates('202609300002')),
    '202609300001/Submitted/2026-09-30', '중복 검토: 남의 건도 번호·상태·등록일로 찾는다');
  v_raised := false;
  begin perform public.data0901_find_duplicates('202609300001');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, 'B 는 A 의 건으로 중복 검토를 돌리지 못한다');
  -- PS 메일 대기 — 받는 사람은 B 지역(Oceania) 담당 관리자
  perform public._assert(public.data0901_queue_mail('202609300002', 'duplicate', '[중복] 1', '본문 1') ~ '^M[0-9]{5}$', '메일 번호는 서버가 M00000 형식으로');
  perform public.data0901_queue_mail('202609300002', 'duplicate', '[중복] 2', '본문 2', 'hacker@example.com');
  perform public._assert_eq((select count(*)::int from public.data0901_mails), 0, 'B 는 메일 대기 목록을 읽지 못한다');
  v_raised := false;
  begin perform public.data0901_queue_mail('202609300001', 'duplicate', 'x', 'x');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, 'B 는 A 의 건으로 메일을 넣지 못한다');
  v_raised := false;
  begin insert into public.data0901_mails (mail_id, ref_no, reason, subject, body) values ('M99999', '202609300002', 'duplicate', 'x', 'x');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, 'B 는 메일 표에 직접 넣지 못한다');
end $t$;

-- ── 6. 관리자 — 전부 보고, 회신하고, 메일을 보낸다 ──────────────────────────
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000c';
do $t$
declare m record;
begin
  perform public._assert_eq((select count(*)::int from public.data0901_requests), 2, '관리자는 A·B 의 등록 건을 모두 본다');
  perform public._assert_eq((select count(*)::int from public.data0901_inquiries), 3, '관리자는 문의 3건을 모두 본다');
  select * into m from public.data0901_mails;
  perform public._assert_eq(m.mail_to || '|' || m.subject || '|' || m.body, 'rec-adm@example.com|[중복] 2|본문 2',
    '대기 메일은 하나(두 번째가 내용을 갱신), 받는 사람은 B 지역(Oceania) 담당 관리자 한 명 (정비사가 적은 주소 무시)');
  insert into public.data0901_replies (ref_no, r_turn, r_reply_date, r_title, req_summary, reply_content, ref_info)
  values ('202609300001', 1, '2026-09-30', '연료 필터', '시동 불량', '연료 필터를 교체해 주세요.', 'BRP-9_SM p.12');
  update public.data0901_requests set status = 'Answered' where ref_no = '202609300001';
  update public.data0901_mails set status = 'Sent', sent_date = now() where ref_no = '202609300002';
  perform public._assert(public.data0901_queue_mail('202609300002', 'duplicate', '[중복] 3', '본문 3') <> m.mail_id, '보낸 뒤 다시 넣으면 새 메일 번호');
  perform public._assert_eq((select count(*)::int from public.data0901_mails), 2, '메일 2건 (보낸 것 1 + 새 대기 1)');
  -- A 의 건 — Europe 담당(관리자2)에게
  perform public.data0901_queue_mail('202609300001', 'cannot_answer', '[이관]', '본문');
  perform public._assert_eq((select mail_to from public.data0901_mails where ref_no = '202609300001'), 'rec-adm2@example.com', 'A(Europe) 건은 Europe 담당 관리자에게');
  -- 요청자 지역을 맡은 관리자가 없으면 승인 관리자 전원에게 (메일이 아무에게도 안 가는 것을 막음)
  update public.data0901_profiles set territory_cd = 'Africa' where user_id = '20000000-0000-0000-0000-00000000000b';
  perform public.data0901_queue_mail('202609300002', 'duplicate', '[중복] 4', '본문 4');
  perform public._assert_eq((select mail_to from public.data0901_mails where ref_no = '202609300002' and status = 'Pending'),
    (select string_agg(e_mail, '; ' order by e_mail) from public.data0901_profiles where approval = 'Approved' and role = 'ADMIN'),
    '담당 관리자가 없는 지역이면 승인 관리자 전원');
  -- 가져오기: 관리자가 다른 사람 아이디로 넣으면 그 사람 계정의 건이 된다
  insert into public.data0901_requests (ref_no, reg_date, reg_id, model, serial_no, o_hour, type_cd, system_cat, status)
  values ('202609290001', '2026-09-29', 'REC-B@example.com', 'BRP-9', 'SN-9', 1, 'Specification', 'Cabin', 'Answered');
  perform public._assert_eq((select owner_id::text || '/' || status from public.data0901_requests where ref_no = '202609290001'),
    '20000000-0000-0000-0000-00000000000b/Answered', '관리자가 대신 넣은 건: 아이디(대소문자 무시)로 계정을 찾고 상태는 그대로');
end $t$;

-- ── 7. A — 회신을 보고 종료, 종료 뒤에는 못 고친다 ─────────────────────────
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000a';
do $t$
declare v_raised boolean;
begin
  perform public._assert_eq((select string_agg(reply_content, ',') from public.data0901_replies), '연료 필터를 교체해 주세요.', 'A 는 자기 건의 회신을 본다');
  v_raised := false;
  begin update public.data0901_requests set status = 'Completed', action_content = '교체', complete_date = '2026-09-29' where ref_no = '202609300001';
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '완료일은 등록일보다 앞설 수 없다');
  update public.data0901_requests set status = 'Completed', action_content = '연료 필터 교체', complete_date = '2026-09-30', complete_image = '202609300001_C1.jpg'
   where ref_no = '202609300001';
  perform public._assert_eq((select status || '/' || action_content from public.data0901_requests where ref_no = '202609300001'), 'Completed/연료 필터 교체', '회신 받은 건은 조치 결과로 종료');
  v_raised := false;
  begin update public.data0901_requests set o_hour = 1 where ref_no = '202609300001';
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, '종료된 건은 고칠 수 없다');
end $t$;
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000b';
do $t$ begin
  perform public._assert_eq((select count(*)::int from public.data0901_replies), 0, 'B 에게 A 의 회신은 안 보인다');
  perform public._assert_eq((select string_agg(ref_no, ',' order by ref_no) from public.data0901_requests), '202609290001,202609300002', 'B 는 자기 건(관리자가 대신 넣은 건 포함)만 본다');
end $t$;

-- ── 8. 접속 Log ───────────────────────────────────────────────────
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000a';
do $t$
declare v_id bigint; v_raised boolean; r record;
begin
  insert into public.data0901_access_log (user_id, reg_id, login_at, logout_at)
  values ('20000000-0000-0000-0000-00000000000b', 'someone-else', '2020-01-01', '2020-01-02') returning id into v_id;
  select * into r from public.data0901_access_log where id = v_id;
  perform public._assert_eq(r.user_id, auth.uid(), 'Log 계정은 본인 (적은 남의 계정 무시)');
  perform public._assert_eq(r.reg_id, 'rec-a@example.com', 'Log 아이디는 회원 표에서');
  perform public._assert(r.login_at > now() - interval '1 minute' and r.logout_at is null, 'Log 로그인 시각은 서버 시각, 로그아웃은 비움');
  v_raised := false;
  begin update public.data0901_access_log set logout_at = now() where id = v_id;
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, 'Log UPDATE 는 막힌다');
  v_raised := false;
  begin delete from public.data0901_access_log where id = v_id;
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, 'Log DELETE 는 막힌다');
  perform public._assert_eq(public.data0901_close_access_log(v_id), 1, '로그아웃: 본인 기록 한 번 채움');
  perform public._assert_eq(public.data0901_close_access_log(v_id), 0, '두 번째는 바뀌지 않음');
  insert into public.data0901_access_log (reg_id) values ('x');   -- 두 번째 접속(열린 채)
end $t$;
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000b';
do $t$ begin
  insert into public.data0901_access_log (reg_id) values ('x');
  perform public._assert_eq((select count(*)::int from public.data0901_access_log), 1, 'B 에게는 B 의 Log 1개만 보인다');
  perform public._assert_eq((select sum(public.data0901_close_access_log(g))::int from generate_series(1, 50) g), 1, 'B 는 자기 열린 Log 만 닫는다');
end $t$;
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000c';
do $t$ begin
  perform public._assert_eq((select count(distinct user_id)::int from public.data0901_access_log), 2, '관리자는 A·B 두 사람의 Log 를 본다 (김봉수 지적 해결)');
  perform public._assert_eq((select count(*)::int from public.data0901_access_log where logout_at is null), 1, 'A 의 두 번째 접속은 열린 채 (B·관리자가 닫지 못함)');
  perform public._assert_eq((select sum(public.data0901_close_access_log(g))::int from generate_series(1, 50) g), 0, '관리자도 남의 Log 를 닫지 못한다');
end $t$;
set request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000ee';
do $t$ begin
  perform public._assert_eq((select count(*)::int from public.data0901_access_log), 3, '대표 계정(www 관리자)도 Log 전체를 본다');
  perform public._assert_eq((select count(*)::int from public.data0901_requests), 3, '대표 계정도 등록 건 전체를 본다');
end $t$;

-- ── 9. 승인 대기 · 비로그인 ─────────────────────────────────────────
set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000d';
do $t$
declare v_raised boolean;
begin
  v_raised := false;
  begin perform public.data0901_last_ref_no(current_date);
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, '승인 대기 회원은 번호를 받지 못한다');
  v_raised := false;
  begin insert into public.data0901_requests (ref_no, reg_date, reg_id, model, serial_no, o_hour, type_cd, system_cat)
        values ('202609300009', '2026-09-30', 'x', 'BRP-9', 'S', 1, 'Maintenance', 'Engine');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, '승인 대기 회원은 등록하지 못한다');
  v_raised := false;
  begin insert into public.data0901_access_log (reg_id) values ('x');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, '승인 대기 회원은 Log 를 남기지 못한다');
end $t$;
reset request.jwt.claim.sub;
set role anon;
do $t$
declare v_raised boolean; t text;
begin
  foreach t in array array['data0901_sources', 'data0901_requests', 'data0901_inquiries', 'data0901_replies', 'data0901_mails', 'data0901_access_log'] loop
    v_raised := false;
    begin execute format('select count(*) from public.%I', t);
    exception when insufficient_privilege then v_raised := true; end;
    perform public._assert(v_raised, '비로그인은 ' || t || ' 를 읽지 못한다');
  end loop;
  v_raised := false;
  begin perform public.data0901_queue_mail('202609300002', 'duplicate', 'x', 'x');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, '비로그인은 메일 함수를 실행하지 못한다');
  v_raised := false;
  begin perform public.data0901_close_access_log(1);
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, '비로그인은 로그아웃 함수를 실행하지 못한다');
end $t$;
reset role;
