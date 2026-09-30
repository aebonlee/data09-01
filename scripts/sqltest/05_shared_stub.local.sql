-- ============================================================================
-- 로컬 검증 전용 — 공용 프로젝트(hcmgdztsgjvzcyxyayaj)의 공용 개체 스텁
--   www_profiles · www_admins · www_is_admin() · storage.buckets · storage.objects
--
-- supabase/2026-09-30_data0901_auth.sql 이 기대는 개체만 운영과 같은 모양으로 흉내 냅니다.
--   www_profiles : 06-personal/www/react-source/sql/www_member_schema.sql 의 확정본과 같은 열
--                  (is_complete 는 이름·전화·이메일이 모두 있으면 참인 생성 열)
--   www_is_admin : 운영판은 user_profiles.role='superadmin' 도 보지만, 여기서는 www_admins 만 봅니다
--   storage      : Supabase Storage 가 쓰는 두 표의 필요한 열만
--
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

create table if not exists public.www_profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  name        text,
  phone       text,
  email       text,
  org         text,
  course      text,
  signup_site text,
  signup_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_complete boolean generated always as (name is not null and phone is not null and email is not null) stored
);
create table if not exists public.www_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note    text
);
alter table public.www_profiles enable row level security;
alter table public.www_admins enable row level security;

create or replace function public.www_is_admin()
returns boolean language sql security definer set search_path = public stable as $fn$
  select exists (select 1 from public.www_admins where user_id = auth.uid());
$fn$;
revoke execute on function public.www_is_admin() from public, anon;

drop policy if exists www_profiles_select_own on public.www_profiles;
create policy www_profiles_select_own on public.www_profiles for select to authenticated
  using (auth.uid() = user_id or public.www_is_admin());
drop policy if exists www_profiles_update_own on public.www_profiles;
create policy www_profiles_update_own on public.www_profiles for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists www_admins_select_admin on public.www_admins;
create policy www_admins_select_admin on public.www_admins for select to authenticated
  using (public.www_is_admin());

-- 가입 트리거 흉내: auth.users 에 행이 생기면 www_profiles 행을 만듭니다(signup_site 는 비움 — OAuth 가입과 같음)
create or replace function public.www_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.www_profiles (user_id, email) values (new.id, new.email) on conflict (user_id) do nothing;
  return new;
end;
$fn$;
revoke execute on function public.www_handle_new_user() from public, anon;
drop trigger if exists www_on_auth_user_created on auth.users;
create trigger www_on_auth_user_created after insert on auth.users
  for each row execute function public.www_handle_new_user();

-- Storage
create schema if not exists storage;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text,
  owner     uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
