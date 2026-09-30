-- ============================================================================
-- 로컬 검증 전용 — 2026-09-30_data0901_records.sql 을 "처음" 적용하기 직전의 카탈로그·공용 데이터 스냅숏
--   run.sh: 이 파일 → records SQL 두 번 적용 → 34_data0901_records_after.local.sql 로 대조
--   (37 은 지웠다가 다시 적용해 보지만, 첫 적용 때 한 번만 일어나는 변경(ADD COLUMN IF NOT EXISTS 등)은
--    그 방법으로는 안 보이므로 여기서 첫 적용 전후를 따로 잰다)
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
create schema if not exists _sqltest;
-- 이름·정의·권한·열까지 한 줄로. p_prefixed=false 면 data0901_ 가 아닌 것만, true 면 data0901_ 만.
create or replace function _sqltest.catalog(p_prefixed boolean) returns table (k text) language sql as $fn$
  select 'class:' || n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'auth', 'storage') and (c.relname like 'data0901\_%') = p_prefixed
  union all
  select 'column:' || n.nspname || '.' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull
         || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname in ('public', 'auth', 'storage') and a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'v')
     and (c.relname like 'data0901\_%') = p_prefixed
  union all
  select 'constraint:' || con.conrelid::regclass::text || '.' || con.conname || ':' || pg_get_constraintdef(con.oid)
    from pg_constraint con join pg_namespace n on n.oid = con.connamespace
   where n.nspname in ('public', 'auth', 'storage') and con.conrelid <> 0
     and (con.conrelid::regclass::text like '%data0901\_%') = p_prefixed
  union all
  select 'proc:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':'
         || coalesce(p.proacl::text, '') || ':' || coalesce(p.proconfig::text, '') || ':' || p.prosecdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'auth', 'storage') and (p.proname like 'data0901\_%') = p_prefixed
  union all
  select 'policy:' || pol.polrelid::regclass::text || '.' || pol.polname || ':' || pol.polcmd::text || ':' || pol.polroles::text || ':'
         || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ':' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    from pg_policy pol where (pol.polname like 'data0901\_%') = p_prefixed
  union all
  select 'trigger:' || tg.tgrelid::regclass::text || '.' || tg.tgname || ':' || tg.tgfoid::regproc::text || ':' || tg.tgenabled::text from pg_trigger tg
   where not tg.tgisinternal and (tg.tgname like 'data0901\_%') = p_prefixed
  union all
  select 'bucket:' || b.id || ':' || b.public || ':' || coalesce(b.file_size_limit::text, '') || ':' || coalesce(b.allowed_mime_types::text, '')
    from storage.buckets b where not p_prefixed
  union all
  select 'schema:' || nspname || ':' || coalesce(nspacl::text, '') from pg_namespace where not p_prefixed and nspname not like 'pg\_%' and nspname <> '_sqltest'
$fn$;
create or replace function _sqltest.shared_data() returns table (k text) language sql as $fn$
  select 'www_profiles:'  || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.www_profiles t
  union all select 'www_admins:' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.www_admins t
  union all select 'data0901_profiles:' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.data0901_profiles t
  union all select 'auth.users:' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from auth.users t
  union all select 'storage.objects:' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from storage.objects t
$fn$;
create table _sqltest.outside_before as select k from _sqltest.catalog(false);
create table _sqltest.data_before as select k from _sqltest.shared_data();
