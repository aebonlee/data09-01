-- ============================================================================
-- 로컬 검증 전용 — data09-01 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  역할 전환으로 실제 사용자처럼 질의한다.
--    set role authenticated + request.jwt.claim.sub = 사용자 uuid  → auth.uid()
--    set role anon                                                   → 비로그인
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

do $t$ begin raise notice '[프로젝트] data09-01 — 재실행 · 제약 · RLS · 함수 권한'; end $t$;

-- ── 0. 재실행 안전 (run.sh 가 schema.sql 을 두 번 적용한 뒤다) ──────────────
do $t$
declare v_n int;
begin
  perform public._assert_eq(
    (select count(*)::int from pg_tables where schemaname = 'public'
      and tablename in ('app_members','users','sources','mains','inquiries','replies','access_log','mails')),
    8, '표 8개가 한 번씩만 있다 (두 번 적용 후)');
  select count(*) into v_n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and t.tgname like '%\_updated\_at';
  perform public._assert_eq(v_n, 8, 'updated_at 트리거가 표마다 하나씩 (중복 생성 없음)');
  perform public._assert_eq((select count(*)::int from pg_trigger where tgname = 'users_guard_approval'), 1,
    '승인 보호 트리거 하나 (중복 생성 없음)');
end $t$;

-- ── 1. 테스트 계정 (postgres 권한으로 준비) ────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.com')
on conflict (id) do nothing;
insert into public.app_members (user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'USER'),
  ('00000000-0000-0000-0000-00000000000b', 'USER'),
  ('00000000-0000-0000-0000-0000000000ad', 'ADMIN')
on conflict (user_id) do nothing;

-- ── 2. 사용자 A ──────────────────────────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

do $t$
declare v_raised boolean; v_n int;
begin
  -- 본인이 가입하며 승인 칸을 'Approved' 로 적어도 승인 대기로 들어간다
  insert into public.users (reg_id, req_name, user_type, territory_cd, approval, manage_territory)
  values ('user_a', '정비사A', 'USER', '경기', 'Approved', '경기');
  perform public._assert_eq((select approval from public.users where reg_id = 'user_a'), 'Pending',
    '가입은 승인 대기로 고정된다 (본인이 Approved 로 적어도)');
  perform public._assert_eq((select manage_territory from public.users where reg_id = 'user_a'), '',
    '관리 지역은 본인이 정할 수 없다');
  perform public._assert(not public.is_approved(), '승인 전 A 는 is_approved() 가 거짓');

  v_raised := false;
  begin
    update public.users set approval = 'Approved' where reg_id = 'user_a';
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, 'A 는 스스로 승인할 수 없다 (트리거)');

  v_raised := false;
  begin
    insert into public.mains (ref_no, reg_date, reg_id, model, serial_no, o_hour, type_cd, system_cat)
    values ('202609010099', '2026-09-01', 'user_a', '30BRP-X', 'SN-0', 1, 'Troubleshooting', 'Engine');
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, '승인 대기 회원은 기술지원을 등록할 수 없다 (RLS)');

  perform public._assert(not public.reg_id_available('USER_A'), '중복 ID 확인: 대소문자만 달라도 사용 중');
  perform public._assert(public.reg_id_available('user_z'), '중복 ID 확인: 새 ID 는 사용 가능');

  -- 스스로 ADMIN 이 될 수 없다
  v_raised := false;
  begin
    update public.users set user_type = 'ADMIN' where reg_id = 'user_a';
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, 'USER 는 자기 user_type 을 ADMIN 으로 바꿀 수 없다');

  update public.app_members set role = 'ADMIN' where user_id = auth.uid();
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, 0, 'USER 는 app_members 의 자기 권한을 올릴 수 없다');

  v_raised := false;
  begin
    -- RLS 검사를 통과하는 본인 행으로 넣어야 CHECK 까지 도달한다
    insert into public.users (reg_id, req_name, territory_cd)
    values ('user_x', '잘못된지역', '서울');
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, 'territory_cd 는 정해진 코드만 (CHECK)');
  perform public._assert(not public.is_admin(), 'A 는 관리자가 아니다');

  -- 소스 등록은 관리자만
  v_raised := false;
  begin
    insert into public.sources (notebook_name, model) values ('몰래', 'X-1');
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, 'USER 는 소스를 등록할 수 없다');
end $t$;

-- ── 3. 관리자 — 소스 등록 ─────────────────────────────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ad';
do $t$
declare v_raised boolean := false;
begin
  perform public._assert(public.is_admin(), '관리자 계정은 is_admin() 이 참');
  update public.users set approval = 'Approved', approved_by = 'admin', approved_date = current_date
   where reg_id = 'user_a';
  perform public._assert_eq((select approval from public.users where reg_id = 'user_a'), 'Approved', '관리자는 가입을 승인한다');
  insert into public.sources (notebook_name, model, files)
  values ('30BRP-X 정비매뉴얼(예시)', '30BRP-X', 'manual.pdf');
  begin
    insert into public.sources (notebook_name, model) values ('중복', ' 30brp-x ');
  exception when unique_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '모델은 대소문자·공백을 무시하고 하나만 등록된다 (UNIQUE)');
end $t$;

-- ── 4. A 가 등록·문의, B 는 A 의 건을 못 본다 ────────────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $t$
declare v_raised boolean;
begin
  insert into public.mains (ref_no, reg_date, reg_id, model, serial_no, o_hour, type_cd, system_cat)
  values ('202609010001', '2026-09-01', 'user_a', '30BRP-X', 'SN-1', 1234.5, 'Troubleshooting', 'Engine');
  insert into public.inquiries (ref_no, s_turn, reg_date, reg_id, phenomenon, requirement)
  values ('202609010001', 1, '2026-09-01', 'user_a', '에러코드 219', '원인 알려주세요');

  perform public._assert_eq((select count(*) from public.sources), 1::bigint,
    'USER 도 소스 목록은 읽는다 (모델 검증용)');
  perform public._assert(public.is_approved(), '승인 뒤 A 는 등록할 수 있다');

  -- 중복 등록 검토 메일: 요청자는 넣기만 하고 읽지 못한다
  insert into public.mails (mail_id, ref_no, reason, mail_to, subject, body)
  values ('M00001', '202609010001', 'duplicate', 'admin@example.com', '[중복 검토]', '본문');
  perform public._assert_eq((select count(*) from public.mails), 0::bigint, 'USER 는 메일 대기 목록을 읽지 못한다');
  v_raised := false;
  begin
    insert into public.mails (mail_id, ref_no, reason, subject, body) values ('M00002', '202609010001', 'duplicate', 's', 'b');
  exception when unique_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '같은 건·같은 사유의 대기 메일은 하나만 (부분 UNIQUE)');

  v_raised := false;
  begin
    insert into public.users (reg_id, req_name) values ('User_A', '대소문자');
  exception when unique_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '대소문자만 다른 ID 는 UNIQUE 가 막는다');

  -- CHECK 제약
  v_raised := false;
  begin
    insert into public.mains (ref_no, reg_id, model, serial_no, o_hour, type_cd, system_cat)
    values ('202609010002', 'user_a', '30BRP-X', 'SN-2', 1, 'Specificatio', 'Engine');
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, 'type_cd 오타(Specificatio)는 CHECK 가 막는다');

  v_raised := false;
  begin
    insert into public.mains (ref_no, reg_id, model, serial_no, o_hour, type_cd, system_cat)
    values ('2026-09-01-1', 'user_a', '30BRP-X', 'SN-2', 1, 'Maintenance', 'Engine');
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, 'ref_no 는 12자리 숫자만 (CHECK)');

  v_raised := false;
  begin
    insert into public.mains (ref_no, reg_id, model, serial_no, o_hour, type_cd, system_cat, status)
    values ('202609010003', 'user_a', '30BRP-X', 'SN-3', 1, 'Maintenance', 'Engine', 'Closed');
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, 'status 는 Submitted·Answered·Completed 만 (CHECK)');

  v_raised := false;
  begin
    insert into public.mains (ref_no, reg_id, model, serial_no, o_hour, type_cd, system_cat)
    values ('202609010004', 'user_a', '30BRP-X', 'SN-4', 12345678.9, 'Maintenance', 'Engine');
  exception when numeric_value_out_of_range then v_raised := true;
  end;
  perform public._assert(v_raised, 'o_hour 는 DECIMAL(8,1) 범위를 넘으면 막힌다');

  v_raised := false;
  begin
    update public.mains set complete_date = '2026-08-01' where ref_no = '202609010001';
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '완료일이 등록일보다 앞서면 CHECK 가 막는다');

  v_raised := false;
  begin
    insert into public.inquiries (ref_no, s_turn, reg_id, phenomenon, requirement)
    values ('202609010001', 1, 'user_a', '중복', '중복');
  exception when unique_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '같은 ref_no·s_turn 문의는 UNIQUE 가 막는다');

  -- 회신은 관리자만
  v_raised := false;
  begin
    insert into public.replies (ref_no, r_turn, reply_content) values ('202609010001', 1, '셀프 회신');
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, 'USER 는 회신을 등록할 수 없다');

  -- 접속 Log
  insert into public.access_log (reg_id, login_date) values ('user_a', now() - interval '10 minutes');
end $t$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $t$
declare v_n int; v_raised boolean := false;
begin
  insert into public.users (reg_id, req_name) values ('user_b', '정비사B');
  perform public._assert_eq((select count(*) from public.mails), 0::bigint, 'B 는 메일 대기 목록을 못 본다');
  perform public._assert_eq((select count(*) from public.mains), 0::bigint, 'B 는 A 의 등록 건을 못 본다');
  perform public._assert_eq((select count(*) from public.inquiries), 0::bigint, 'B 는 A 의 문의를 못 본다');
  perform public._assert_eq((select count(*) from public.users), 1::bigint, 'B 는 자기 사용자 행만 본다');
  perform public._assert_eq((select count(*) from public.access_log), 0::bigint, 'B 는 A 의 접속 Log 를 못 본다');

  update public.mains set status = 'Completed' where ref_no = '202609010001';
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, 0, 'B 는 A 의 등록 건을 고칠 수 없다');

  begin
    insert into public.inquiries (ref_no, s_turn, reg_id, phenomenon, requirement)
    values ('202609010001', 2, 'user_b', '끼어들기', '끼어들기');
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, 'B 는 A 의 건에 후속 요청을 붙일 수 없다');

  v_raised := false;
  begin
    insert into public.mains (ref_no, reg_id, model, serial_no, o_hour, type_cd, system_cat, owner_id)
    values ('202609010009', 'user_b', '30BRP-X', 'SN-9', 1, 'Maintenance', 'Engine',
            '00000000-0000-0000-0000-00000000000a');
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, 'B 는 남의 owner_id 로 행을 만들 수 없다');
end $t$;

-- ── 5. 관리자 — 전부 보고 회신한다 ────────────────────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ad';
do $t$
declare v_raised boolean := false;
begin
  perform public._assert_eq((select count(*) from public.mains), 1::bigint, '관리자는 A 의 등록 건을 본다');
  perform public._assert_eq((select count(*) from public.users), 2::bigint, '관리자는 사용자 전원을 본다');
  perform public._assert_eq((select count(*) from public.access_log), 1::bigint, '관리자는 접속 Log 를 본다');
  insert into public.replies (ref_no, r_turn, r_title, reply_content, ref_info)
  values ('202609010001', 1, '에러코드 219', '스텝핑 모터 커넥터 점검', '매뉴얼 p.1');
  update public.mains set status = 'Answered' where ref_no = '202609010001';
  begin
    insert into public.replies (ref_no, r_turn, reply_content) values ('202609010001', 2, '   ');
  exception when check_violation then v_raised := true;
  end;
  perform public._assert(v_raised, '빈 회신 내용은 CHECK 가 막는다');
  perform public._assert_eq((select count(*) from public.mails), 1::bigint, '관리자는 메일 대기 목록을 본다');
  update public.mails set status = 'Sent', sent_date = now() where mail_id = 'M00001';
  insert into public.mails (mail_id, ref_no, reason, subject, body) values ('M00002', '202609010001', 'duplicate', 's', 'b');
  perform public._assert_eq((select count(*) from public.mails), 2::bigint, '보낸 뒤에는 같은 사유 메일을 다시 대기시킬 수 있다');
  update public.users set user_type = 'ADMIN', manage_territory = '경기; 경남' where reg_id = 'user_b';
  perform public._assert_eq((select manage_territory from public.users where reg_id = 'user_b'), '경기; 경남', '관리자는 관리 지역을 정한다');
  update public.users set user_type = 'USER', manage_territory = '' where reg_id = 'user_b';
end $t$;

-- ── 6. A 는 자기 건의 회신을 읽고, B 는 못 읽는다 ─────────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $t$
declare v_before timestamptz; v_after timestamptz;
begin
  perform public._assert_eq((select count(*) from public.replies), 1::bigint, 'A 는 자기 건의 회신을 읽는다');
  select updated_at into v_before from public.mains where ref_no = '202609010001';
  perform pg_sleep(0.01);
  update public.mains set status = 'Completed', action_content = '커넥터 재체결', complete_date = '2026-09-02'
   where ref_no = '202609010001';
  select updated_at into v_after from public.mains where ref_no = '202609010001';
  perform public._assert(v_after > v_before, 'updated_at 트리거가 수정 시각을 갱신한다');
end $t$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $t$ begin
  perform public._assert_eq((select count(*) from public.replies), 0::bigint, 'B 는 A 의 회신을 못 읽는다');
end $t$;

-- ── 7. 접속 Log — 기록성: 수정·삭제 불가, 로그아웃은 함수로 한 번만 ───────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $t$
declare v_n int; v_id bigint;
begin
  select id into v_id from public.access_log limit 1;
  update public.access_log set login_date = now() - interval '1 year' where id = v_id;
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, 0, '접속 Log 는 본인도 UPDATE 할 수 없다');
  delete from public.access_log where id = v_id;
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, 0, '접속 Log 는 본인도 DELETE 할 수 없다');
  perform public._assert_eq(public.close_access_log(v_id), 1, 'close_access_log 가 로그아웃 시각을 채운다');
  perform public._assert_eq(public.close_access_log(v_id), 0, '로그아웃 시각은 한 번만 채워진다');
end $t$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $t$ begin
  perform public._assert_eq(public.close_access_log((select max(id) from public.access_log)), 0,
    'B 는 남의 접속 Log 를 닫을 수 없다');
end $t$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ad';
do $t$
declare v_n int;
begin
  delete from public.access_log;
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, 0, '관리자도 접속 Log 를 DELETE 할 수 없다');
end $t$;

-- ── 8. 비로그인(anon) ─────────────────────────────────────────────────────
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $t$
declare v_raised boolean := false; v_t text;
begin
  foreach v_t in array array['app_members','users','sources','mains','inquiries','replies','access_log','mails']
  loop
    execute format('select count(*) = 0 from public.%I', v_t) into v_raised;
    perform public._assert(v_raised, 'anon 은 ' || v_t || ' 을 한 행도 못 본다');
  end loop;
  v_raised := false;
  begin
    insert into public.sources (notebook_name, model) values ('anon', 'ANON-1');
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, 'anon 은 쓸 수 없다');
  v_raised := false;
  begin
    perform public.is_admin();
  exception when insufficient_privilege then v_raised := true;
  end;
  perform public._assert(v_raised, 'anon 은 is_admin() 을 호출할 수 없다');
end $t$;
reset role;

-- ── 9. 함수 ACL — PUBLIC·anon 에 EXECUTE 가 없다 (proacl 직접 확인) ───────────
--    이 프로젝트에는 anon 예외 함수가 없다. 정책이 전부 `to authenticated` 라
--    비로그인 요청이 판정 함수를 평가할 일이 없기 때문이다.
do $t$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole);
  perform public._assert(v_bad is null,
    'proacl 에 PUBLIC·anon EXECUTE 가 없다' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert_eq(
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('is_admin','owns_request','close_access_log','set_updated_at',
                                                   'is_approved','reg_id_available','users_guard_approval')
        and p.proconfig @> array['search_path=public']),
    7, '함수 7개 모두 search_path=public 고정');
end $t$;

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
