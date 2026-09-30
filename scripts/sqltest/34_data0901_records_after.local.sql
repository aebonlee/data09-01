-- ============================================================================
-- 로컬 검증 전용 — records SQL 첫 적용(두 번) 뒤: data0901_ 밖은 하나도 바뀌지 않았는가 (34_..._before 와 짝)
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
do $t$ begin raise notice '[공용] data0901 — 기록 SQL 첫 적용 전후 대조 (접두사 규칙)'; end $t$;
do $t$
declare v_extra text; v_gone text; v_data text;
begin
  select string_agg(k, E'\n') into v_extra from (select k from _sqltest.catalog(false) except select k from _sqltest.outside_before) x;
  select string_agg(k, E'\n') into v_gone  from (select k from _sqltest.outside_before except select k from _sqltest.catalog(false)) x;
  select string_agg(k, E'\n') into v_data  from (select k from _sqltest.data_before except select k from _sqltest.shared_data()) x;
  -- (_assert 는 10_common 이 나중에 만들므로 여기서는 직접 알립니다)
  if v_extra is not null then raise exception 'FAIL  첫 적용: data0901_ 밖에 새로 생기거나 바뀐 개체 %', E'\n' || v_extra; end if;
  raise notice '  OK   첫 적용: data0901_ 밖에 새로 생기거나 바뀐 개체 없음 (표·열·제약·함수·정책·트리거·버킷·스키마)';
  if v_gone is not null then raise exception 'FAIL  첫 적용: data0901_ 밖에서 없어지거나 바뀐 개체 %', E'\n' || v_gone; end if;
  raise notice '  OK   첫 적용: data0901_ 밖에서 없어지거나 바뀐 개체 없음';
  if v_data is not null then raise exception 'FAIL  첫 적용: 공용 데이터가 바뀜 %', E'\n' || v_data; end if;
  raise notice '  OK   첫 적용: www_profiles·www_admins·data0901_profiles·auth.users·storage.objects 내용 그대로';
end $t$;
drop schema _sqltest cascade;
