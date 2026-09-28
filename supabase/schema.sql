-- ============================================================================
-- data09-01 — 지게차 AI 기술지원(AI Field 기술지원) 플랫폼
-- Supabase(PostgreSQL) 스키마 + RLS
--
--  무엇인가 : 지금은 브라우저 localStorage('data09-01.db') 한 곳에 들어 있는
--             등록·문의·회신·사용자·소스등록·접속 Log 를 DB 표로 옮기기 위한 스크립트입니다.
--             필드 이름은 도구(js/logic.js 의 SHEETS)와 04_DB.xlsx 정의를 그대로 씁니다.
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  본인 프로젝트에 올리는 것을 전제로 하므로 테이블 이름에 접두사를 붙이지 않았습니다.
--
--  테이블 (7)
--    app_members  권한(USER/ADMIN) — 관리자 판정의 기준
--    users        사용자 (사용자 시트)
--    sources      소스등록 (모델 ↔ 노트북·매뉴얼 파일)
--    mains        기술지원 등록 (등록 시트, ref_no 1건 = 1행)
--    inquiries    문의 (ref_no × s_turn)
--    replies      회신 (ref_no × r_turn)
--    access_log   접속 Log (기록성 — 수정·삭제 불가)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 권한 — 앱의 user_type(USER/ADMIN)을 실제로 집행하는 곳.
-- users.user_type 은 화면 표시용 사본이고, 누가 관리자인지는 이 표만 본다.
-- 이 표는 관리자만 고칠 수 있으므로 본인이 스스로 ADMIN 이 될 수 없다.
create table if not exists public.app_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'USER' check (role in ('USER', 'ADMIN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 사용자 — 비밀번호 열은 두지 않는다. 로그인은 Supabase Auth 가 맡는다(평문 저장 금지).
create table if not exists public.users (
  id           bigint generated always as identity primary key,
  reg_id       varchar(20) not null unique,
  req_name     text not null,
  e_mail       text,
  phone        text,
  country_cd   text,
  dealer       text,
  join_date    date not null default current_date,
  user_type    text not null default 'USER' check (user_type in ('USER', 'ADMIN')),
  territory_cd text check (territory_cd is null or territory_cd in (
                 '경기', '경남', '전라', '충청', '강원', 'Direct Sales', 'Europe',
                 'North America', 'South America', 'Middle East', 'Africa', 'Asia', 'Oceania')),
  owner_id     uuid not null default auth.uid() unique,   -- 로그인 계정 1개 = 사용자 1명
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 소스등록 — 모델 하나에 노트북 하나. 도구는 모델을 대문자로 맞춰 찾으므로(findSource)
-- 중복 판정도 대소문자·앞뒤 공백을 무시한다.
create table if not exists public.sources (
  id            bigint generated always as identity primary key,
  notebook_name text not null check (length(trim(notebook_name)) > 0),
  model         varchar(20) not null check (length(trim(model)) > 0),
  files         text not null default '',                 -- '파일1; 파일2'
  owner_id      uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists sources_model_key on public.sources (upper(trim(model)));

-- 기술지원 등록 — ref_no 는 yyyymmddnnnn (그날 일련번호 4자리)
create table if not exists public.mains (
  ref_no         varchar(20) primary key check (ref_no ~ '^\d{12}$'),
  status         text not null default 'Submitted'
                 check (status in ('Submitted', 'Answered', 'Completed')),
  reg_date       date not null default current_date,
  reg_id         varchar(20) not null,
  model          varchar(20) not null,
  serial_no      varchar(20) not null,
  o_hour         numeric(8,1) not null check (o_hour >= 0),   -- DECIMAL(8,1)
  type_cd        text not null check (type_cd in ('Troubleshooting', 'Maintenance', 'Specification')),
  system_cat     text not null check (system_cat in (
                   'Transmission', 'Engine', 'Electric', 'Hydraulic',
                   'Drive Axle', 'Steering Axle', 'Cabin', 'HVAC')),
  action_content text not null default '',                  -- 조치 내용 (종료 때 기록)
  complete_date  date,                                      -- 완료일 (종료 때 기록)
  owner_id       uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- 도구(completeRequest)와 같은 규칙: 완료일은 등록일보다 앞설 수 없다
  constraint mains_complete_after_reg check (complete_date is null or complete_date >= reg_date)
);
create index if not exists mains_owner_idx    on public.mains (owner_id);
create index if not exists mains_reg_date_idx on public.mains (reg_date desc);

-- 문의 — 같은 건을 다시 요청하면 s_turn 이 1, 2, 3 … 으로 늘어난다
create table if not exists public.inquiries (
  id          bigint generated always as identity primary key,
  ref_no      varchar(20) not null references public.mains (ref_no) on delete cascade,
  s_turn      int not null check (s_turn >= 1),
  reg_date    date not null default current_date,
  reg_id      varchar(20) not null,
  phenomenon  text not null check (length(trim(phenomenon)) > 0),
  requirement text not null check (length(trim(requirement)) > 0),
  s_image     text not null default '',                     -- 'ref_no_1.jpg; ref_no_2.jpg'
  owner_id    uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ⚠ 프런트에서 upsert 할 때 onConflict 를 'ref_no,s_turn' 으로 반드시 지정할 것
  constraint inquiries_ref_turn_key unique (ref_no, s_turn)
);

-- 회신 — 회신마다 r_turn 이 늘어난다. ref_info 는 근거가 여러 개면 '; ' 로 잇는다
create table if not exists public.replies (
  id            bigint generated always as identity primary key,
  ref_no        varchar(20) not null references public.mains (ref_no) on delete cascade,
  r_turn        int not null check (r_turn >= 1),
  r_reply_date  date not null default current_date,
  r_title       text not null default '',
  req_summary   text not null default '',
  reply_content text not null check (length(trim(reply_content)) > 0),
  ref_info      text not null default '',
  owner_id      uuid not null default auth.uid(),          -- 회신을 등록한 관리자
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- ⚠ 프런트에서 upsert 할 때 onConflict 를 'ref_no,r_turn' 으로 반드시 지정할 것
  constraint replies_ref_turn_key unique (ref_no, r_turn)
);

-- 접속 Log — 기록성 테이블. UPDATE/DELETE 정책을 두지 않는다.
-- 로그아웃 시각은 아래 close_access_log() 로 한 번만 채운다.
create table if not exists public.access_log (
  id          bigint generated always as identity primary key,
  reg_id      varchar(20) not null,
  login_date  timestamptz not null default now(),
  logout_date timestamptz,
  owner_id    uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint access_log_logout_after_login check (logout_date is null or logout_date >= login_date)
);
create index if not exists access_log_login_idx on public.access_log (login_date desc);

-- ----------------------------------------------------------------------------
-- 2. 함수 — 전부 search_path 를 고정한다
-- ----------------------------------------------------------------------------

-- 관리자 판정. RLS 정책 안에서 쓴다.
-- SECURITY DEFINER 인 이유: 정책 안에서 app_members 를 읽을 때 app_members 자신의
-- RLS 가 다시 걸려 재귀가 되는 것을 피한다.
-- 정책이 전부 `to authenticated` 라 비로그인(anon)은 이 함수를 평가할 일이 없다
-- → anon EXECUTE 를 남기지 않는다.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.app_members m
                  where m.user_id = auth.uid() and m.role = 'ADMIN');
$fn$;

-- 이 ref_no 가 로그인한 사람의 등록 건인가 (문의·회신 정책에서 쓴다)
create or replace function public.owns_request(p_ref_no text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.mains m
                  where m.ref_no = p_ref_no and m.owner_id = auth.uid());
$fn$;

-- 로그아웃 시각 기록 — 접속 Log 에 UPDATE 정책을 열지 않고 이 칸 하나만 한 번 채운다.
-- 본인 기록이고 아직 비어 있을 때만 바뀐다. 바뀐 행 수(0 또는 1)를 돌려준다.
create or replace function public.close_access_log(p_id bigint)
returns int language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  update public.access_log
     set logout_date = greatest(now(), login_date)
   where id = p_id and owner_id = auth.uid() and logout_date is null;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['app_members','users','sources','mains','inquiries','replies','access_log']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS
--   USER  : 자기 것만 본다 (등록·문의·회신·접속 Log)
--   ADMIN : 전부 본다, 회신·소스·권한을 쓴다
--   비로그인(anon) : 정책이 없으므로 아무것도 보거나 쓰지 못한다
-- ----------------------------------------------------------------------------

alter table public.app_members enable row level security;
alter table public.users       enable row level security;
alter table public.sources     enable row level security;
alter table public.mains       enable row level security;
alter table public.inquiries   enable row level security;
alter table public.replies     enable row level security;
alter table public.access_log  enable row level security;

-- app_members — 본인 권한은 본인이 볼 수 있고, 부여·회수는 관리자만
drop policy if exists app_members_read   on public.app_members;
drop policy if exists app_members_insert on public.app_members;
drop policy if exists app_members_update on public.app_members;
drop policy if exists app_members_delete on public.app_members;
create policy app_members_read   on public.app_members for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy app_members_insert on public.app_members for insert to authenticated
  with check (public.is_admin());
create policy app_members_update on public.app_members for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy app_members_delete on public.app_members for delete to authenticated
  using (public.is_admin());

-- users — 본인 행만. user_type 을 ADMIN 으로 적는 것은 관리자만 가능
drop policy if exists users_read   on public.users;
drop policy if exists users_insert on public.users;
drop policy if exists users_update on public.users;
drop policy if exists users_delete on public.users;
create policy users_read   on public.users for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
create policy users_insert on public.users for insert to authenticated
  with check ((owner_id = auth.uid() and user_type = 'USER') or public.is_admin());
create policy users_update on public.users for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check ((owner_id = auth.uid() and user_type = 'USER') or public.is_admin());
create policy users_delete on public.users for delete to authenticated
  using (public.is_admin());

-- sources — 등록 화면의 모델 검증에 쓰이므로 로그인 사용자는 모두 읽는다. 쓰기는 관리자
drop policy if exists sources_read   on public.sources;
drop policy if exists sources_insert on public.sources;
drop policy if exists sources_update on public.sources;
drop policy if exists sources_delete on public.sources;
create policy sources_read   on public.sources for select to authenticated using (true);
create policy sources_insert on public.sources for insert to authenticated with check (public.is_admin());
create policy sources_update on public.sources for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy sources_delete on public.sources for delete to authenticated using (public.is_admin());

-- mains — 본인 등록 건만. 관리자는 회신 때 상태를 바꾸고, 엑셀 가져오기로 대신 등록할 수 있다
drop policy if exists mains_read   on public.mains;
drop policy if exists mains_insert on public.mains;
drop policy if exists mains_update on public.mains;
drop policy if exists mains_delete on public.mains;
create policy mains_read   on public.mains for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
create policy mains_insert on public.mains for insert to authenticated
  with check (owner_id = auth.uid() or public.is_admin());
create policy mains_update on public.mains for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
create policy mains_delete on public.mains for delete to authenticated
  using (public.is_admin());

-- inquiries — 본인 등록 건에만 문의(후속 요청)를 붙인다. 고치고 지우는 것은 관리자만
drop policy if exists inquiries_read   on public.inquiries;
drop policy if exists inquiries_insert on public.inquiries;
drop policy if exists inquiries_update on public.inquiries;
drop policy if exists inquiries_delete on public.inquiries;
create policy inquiries_read   on public.inquiries for select to authenticated
  using (public.owns_request(ref_no) or public.is_admin());
create policy inquiries_insert on public.inquiries for insert to authenticated
  with check ((owner_id = auth.uid() and public.owns_request(ref_no)) or public.is_admin());
create policy inquiries_update on public.inquiries for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy inquiries_delete on public.inquiries for delete to authenticated
  using (public.is_admin());

-- replies — 요청자는 자기 건의 회신을 읽기만. 회신 등록은 관리자(PS 담당자)
drop policy if exists replies_read   on public.replies;
drop policy if exists replies_insert on public.replies;
drop policy if exists replies_update on public.replies;
drop policy if exists replies_delete on public.replies;
create policy replies_read   on public.replies for select to authenticated
  using (public.owns_request(ref_no) or public.is_admin());
create policy replies_insert on public.replies for insert to authenticated
  with check (public.is_admin());
create policy replies_update on public.replies for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy replies_delete on public.replies for delete to authenticated
  using (public.is_admin());

-- access_log — 기록성: INSERT + SELECT 만. 로그아웃 시각은 close_access_log() 로
drop policy if exists access_log_read   on public.access_log;
drop policy if exists access_log_insert on public.access_log;
create policy access_log_read   on public.access_log for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
create policy access_log_insert on public.access_log for insert to authenticated
  with check (owner_id = auth.uid() and logout_date is null);

-- ----------------------------------------------------------------------------
-- 4. 함수 실행 권한
--
--  ⚠ GRANT 만으로는 제한되지 않는다. 권한이 두 겹으로 미리 붙는다.
--    ① PostgreSQL 이 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 ALTER DEFAULT PRIVILEGES 로 신규 함수마다
--       anon·authenticated·service_role 에 자동 부여
--    PUBLIC 만 지우면 anon 이 남아 비로그인 호출이 그대로 뚫린다.
-- ----------------------------------------------------------------------------

revoke all on function public.is_admin()                from public, anon;
revoke all on function public.owns_request(text)        from public, anon;
revoke all on function public.close_access_log(bigint)  from public, anon;
revoke all on function public.set_updated_at()          from public, anon;

grant execute on function public.is_admin()               to authenticated;
grant execute on function public.owns_request(text)       to authenticated;
grant execute on function public.close_access_log(bigint) to authenticated;
-- 트리거 전용 함수는 authenticated 를 남긴다. 직접 호출하면
-- "can only be called as trigger" 로 죽으므로 무해하다.
grant execute on function public.set_updated_at()         to authenticated;

-- ----------------------------------------------------------------------------
-- 끝. 첫 관리자 등록 (SQL Editor 에서, 이메일만 바꿔 실행):
--   insert into public.app_members (user_id, role)
--   select id, 'ADMIN' from auth.users where email = '<관리자 이메일>'
--   on conflict (user_id) do update set role = 'ADMIN';
-- ----------------------------------------------------------------------------
