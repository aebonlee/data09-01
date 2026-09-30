-- ============================================================================
-- data09-01 (hdx-ps) — 지게차 AI 기술지원 · 회원(구글·카카오)·승인·매뉴얼 보관
--
--  실행 위치 : 공용 Supabase 프로젝트(hcmgdztsgjvzcyxyayaj) SQL Editor — 대표가 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--  접두사    : 모든 개체가 data0901_ (Storage 버킷은 이름 규칙상 data0901-manuals)
--
--  이 파일이 만드는 것
--    표     data0901_profiles        사이트 회원 정보(이름·전화·딜러 여부·국가·지역) + 가입 승인·권한·관리 지역
--    함수   data0901_is_admin()      관리자 판정: www_admins(대표 계정 2종) 또는 이 사이트 승인 ADMIN
--           data0901_is_approved()   승인 회원 판정 (관리자 포함)
--           data0901_guard_profile() 트리거 — 승인·권한은 관리자만 바꾸고, 가입은 승인 대기로 고정
--    버킷   data0901-manuals (private) — 매뉴얼 텍스트 색인(JSON·gzip). 읽기 = 승인 회원, 쓰기 = 관리자
--
--  기존 공용 개체(www_profiles·www_admins·www_is_admin)는 읽기만 하고 바꾸지 않습니다.
--  공통 회원 정보(www_profiles 의 이름·전화·이메일·가입 출처)는 사이트 화면이 온보딩 때
--  본인 행을 update 합니다(www 표준 OnboardingGate 와 같은 방식, 가입 출처 'hdx-ps').
--
--  supabase/schema.sql 은 수강생 본인 프로젝트용(접두사 없음) 예비 스크립트이며 이 파일과 별개입니다.
--  공용 프로젝트에서는 이 파일만 실행합니다.
-- ============================================================================

-- 0. 전제 확인 — 공용 회원 체계가 있는 프로젝트인지 (없으면 여기서 멈춥니다)
do $pre$
begin
  if to_regclass('public.www_profiles') is null or to_regclass('public.www_admins') is null
     or to_regprocedure('public.www_is_admin()') is null then
    raise exception 'www 공용 회원 체계(www_profiles·www_admins·www_is_admin)가 없는 데이터베이스입니다. 공용 프로젝트에서 실행해 주세요.';
  end if;
end;
$pre$;

-- ----------------------------------------------------------------------------
-- 1. 표 — 사이트 회원
-- ----------------------------------------------------------------------------
create table if not exists public.data0901_profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  reg_id           text not null check (length(btrim(reg_id)) between 3 and 80),   -- 화면·기록의 아이디(가입 때 이메일)
  name             text not null check (length(btrim(name)) between 1 and 50),
  -- 국제 번호도 받습니다: + 로 시작할 수 있고 숫자·빈칸·-·() 만, 숫자 7~15자리 (js/profile.js PHONE_RE 와 같은 규칙)
  phone            text not null check (phone ~ '^\+?[0-9][0-9 ()-]{5,24}$'
                                    and length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 15),
  e_mail           text not null check (e_mail ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  is_dealer        boolean not null,                                                -- 딜러 여부 (아니면 본사·직원)
  dealer_name      text not null default '' check (length(dealer_name) <= 60),      -- 딜러사명(선택)
  country_cd       text not null check (country_cd ~ '^[A-Z]{2}$'),                  -- ISO 3166-1 alpha-2
  region           text not null check (length(btrim(region)) between 1 and 60),    -- 지역(자유 입력, 화면에서 제안)
  territory_cd     text not null default '' check (territory_cd = '' or territory_cd in (
                     '경기', '경남', '전라', '충청', '강원', 'Direct Sales', 'Europe',
                     'North America', 'South America', 'Middle East', 'Africa', 'Asia', 'Oceania')),
  approval         text not null default 'Pending' check (approval in ('Pending', 'Approved', 'Rejected')),
  role             text not null default 'USER' check (role in ('USER', 'ADMIN')),
  manage_territory text not null default '',                                         -- 관리자 담당 지역 '경기; 경남'
  approved_by      uuid references auth.users (id) on delete set null,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.data0901_profiles is 'hdx-ps(data09-01) 지게차 기술지원 회원 — 승인 대기 → 관리자 승인 후 이용';

-- 아이디는 대소문자만 달라도 같은 아이디 (도구의 중복 확인 규칙과 같음)
create unique index if not exists data0901_profiles_reg_id_key on public.data0901_profiles (lower(reg_id));
create index if not exists data0901_profiles_approval_idx on public.data0901_profiles (approval);

-- ----------------------------------------------------------------------------
-- 2. 판정 함수 — 정책 식에서 쓰므로 security definer (재귀 방지) + search_path 고정
-- ----------------------------------------------------------------------------
create or replace function public.data0901_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select coalesce(public.www_is_admin(), false)
      or exists (select 1 from public.data0901_profiles
                  where user_id = auth.uid() and approval = 'Approved' and role = 'ADMIN');
$fn$;

create or replace function public.data0901_is_approved()
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select public.data0901_is_admin()
      or exists (select 1 from public.data0901_profiles
                  where user_id = auth.uid() and approval = 'Approved');
$fn$;

-- ----------------------------------------------------------------------------
-- 3. 보호 트리거 — 가입은 승인 대기로 고정, 승인·권한·관리 지역은 관리자만
-- ----------------------------------------------------------------------------
create or replace function public.data0901_guard_profile()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_uid   uuid    := auth.uid();
  v_admin boolean := v_uid is not null and public.data0901_is_admin();
  v_www   boolean := v_uid is not null and coalesce(public.www_is_admin(), false);
begin
  -- auth.uid() 가 없으면 SQL Editor(대표)의 직접 실행이므로 적힌 값을 그대로 둡니다
  if tg_op = 'INSERT' then
    if v_uid is not null then
      if v_www and new.user_id = v_uid then
        -- 대표 계정(www_admins)은 가입과 동시에 승인된 관리자
        new.approval := 'Approved'; new.role := 'ADMIN';
        new.approved_by := v_uid;    new.approved_at := now();
      else
        -- 본인이 무엇을 적든 승인 대기·일반 회원으로 들어갑니다
        new.approval := 'Pending'; new.role := 'USER'; new.manage_territory := '';
        new.approved_by := null;   new.approved_at := null;
      end if;
    end if;
    new.created_at := now();
    new.updated_at := now();
    if new.role <> 'ADMIN' then new.manage_territory := ''; end if;
    return new;
  end if;

  -- UPDATE: 아이디·계정·가입 시각은 바뀌지 않습니다
  new.user_id := old.user_id;
  new.reg_id := old.reg_id;
  new.created_at := old.created_at;

  if v_uid is not null then
    if (new.approval is distinct from old.approval or new.role is distinct from old.role
        or new.manage_territory is distinct from old.manage_territory
        or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
      if not v_admin then
        raise exception 'data0901: 승인·권한·관리 지역은 관리자만 바꿀 수 있습니다' using errcode = '42501';
      end if;
      -- 관리자 본인의 승인·권한을 스스로 내리지 못하게 합니다(잠김 방지). 대표 계정은 예외.
      if new.user_id = v_uid and not v_www
         and (new.approval is distinct from old.approval or new.role is distinct from old.role) then
        raise exception 'data0901: 자기 자신의 승인·권한은 바꿀 수 없습니다' using errcode = '42501';
      end if;
    end if;
    if new.approval is distinct from old.approval then
      new.approved_by := case when new.approval = 'Pending' then null else v_uid end;
      new.approved_at := case when new.approval = 'Pending' then null else now() end;
    else
      new.approved_by := old.approved_by;
      new.approved_at := old.approved_at;
    end if;
  end if;

  if new.role <> 'ADMIN' then new.manage_territory := ''; end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists data0901_profiles_guard on public.data0901_profiles;
create trigger data0901_profiles_guard
  before insert or update on public.data0901_profiles
  for each row execute function public.data0901_guard_profile();

-- ----------------------------------------------------------------------------
-- 4. RLS — 비로그인은 아무것도 못 봅니다. 삭제 정책은 두지 않습니다(반려·사용 중지로 처리).
-- ----------------------------------------------------------------------------
alter table public.data0901_profiles enable row level security;

revoke all on public.data0901_profiles from anon;
grant select, insert, update on public.data0901_profiles to authenticated;

drop policy if exists data0901_profiles_select on public.data0901_profiles;
create policy data0901_profiles_select on public.data0901_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.data0901_is_admin());

drop policy if exists data0901_profiles_insert_own on public.data0901_profiles;
create policy data0901_profiles_insert_own on public.data0901_profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists data0901_profiles_update_own on public.data0901_profiles;
create policy data0901_profiles_update_own on public.data0901_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists data0901_profiles_update_admin on public.data0901_profiles;
create policy data0901_profiles_update_admin on public.data0901_profiles
  for update to authenticated
  using (public.data0901_is_admin())
  with check (public.data0901_is_admin());

-- ----------------------------------------------------------------------------
-- 5. 함수 권한 (§3.7) — PUBLIC 과 anon 을 둘 다 끊습니다.
--    Supabase 는 새 함수마다 anon·authenticated 에 EXECUTE 를 자동으로 붙입니다.
--    판정 함수는 정책 식(to authenticated)에서 쓰이므로 authenticated 는 남깁니다.
-- ----------------------------------------------------------------------------
revoke execute on function public.data0901_is_admin()      from public, anon;
revoke execute on function public.data0901_is_approved()   from public, anon;
revoke execute on function public.data0901_guard_profile() from public, anon;
grant  execute on function public.data0901_is_admin()      to authenticated;
grant  execute on function public.data0901_is_approved()   to authenticated;
grant  execute on function public.data0901_guard_profile() to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Storage — 매뉴얼 텍스트 색인 (회사 저작물이라 private)
--    파일: <매뉴얼 파일명>.manual.json.gz (gzip) 또는 .manual.json
--    읽기 = 승인 회원(관리자 포함) / 올리기·바꾸기·지우기 = 관리자
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('data0901-manuals', 'data0901-manuals', false, 52428800,
        array['application/gzip', 'application/json'])
on conflict (id) do update
  set public = false;
-- 이미 있는 버킷의 크기·형식 제한은 건드리지 않습니다 — 2026-09-30_data0901_originals.sql 이 넓힌 제한을
-- 이 파일을 다시 실행해도 좁히지 않게(두 파일을 어느 순서로 몇 번 실행해도 결과가 같게)

drop policy if exists data0901_manuals_read on storage.objects;
create policy data0901_manuals_read on storage.objects
  for select to authenticated
  using (bucket_id = 'data0901-manuals' and public.data0901_is_approved());

drop policy if exists data0901_manuals_insert on storage.objects;
create policy data0901_manuals_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'data0901-manuals' and public.data0901_is_admin());

drop policy if exists data0901_manuals_update on storage.objects;
create policy data0901_manuals_update on storage.objects
  for update to authenticated
  using (bucket_id = 'data0901-manuals' and public.data0901_is_admin())
  with check (bucket_id = 'data0901-manuals' and public.data0901_is_admin());

drop policy if exists data0901_manuals_delete on storage.objects;
create policy data0901_manuals_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'data0901-manuals' and public.data0901_is_admin());

-- ============================================================================
-- 실행 뒤 확인 (SQL Editor)
--   select approval, role, count(*) from public.data0901_profiles group by 1, 2;
--   select id, public from storage.buckets where id = 'data0901-manuals';     -- public = false
--   select proname, array_to_string(proacl, ' ') from pg_proc
--    where proname like 'data0901\_%';                                        -- anon=X 가 없어야 함
--
-- 수강생(김봉수)을 사이트 관리자로 지정 — 수강생이 구글/카카오로 가입해 기본 정보를 저장한 뒤
-- 「회원 관리」 화면에서 대표 계정으로 승인·ADMIN 지정해도 되고, 아래 한 줄로 해도 됩니다(이메일만 바꿈).
--   update public.data0901_profiles
--      set approval = 'Approved', role = 'ADMIN',
--          manage_territory = '경기; 경남; 전라; 충청; 강원; Direct Sales'
--    where lower(e_mail) = lower('수강생 이메일');
-- ============================================================================
