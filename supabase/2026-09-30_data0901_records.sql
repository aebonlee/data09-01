-- ============================================================================
-- data09-01 (hdx-ps) — 기술지원 기록을 서버에 (등록·문의·회신·소스·PS 메일·접속 Log)
--
--  실행 위치 : 공용 Supabase 프로젝트(hcmgdztsgjvzcyxyayaj) SQL Editor — 대표가 실행
--  실행 순서 : 2026-09-30_data0901_auth.sql 다음 (data0901_profiles·data0901_is_admin() 이 있어야 함)
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행). 데이터는 지우지 않습니다.
--  접두사    : 만들고 바꾸는 개체는 전부 data0901_ 뿐입니다.
--              www_*·user_profiles·auth.* 와 접두사 없는 개체는 만들지도 바꾸지도 않습니다
--              (auth.uid() 를 읽고 auth.users 를 참조만 합니다). scripts/sqltest 하네스가 카탈로그를 대조해 확인합니다.
--
--  왜: 2026-09-30 수강생(김봉수) 지적 — 「접속 Log 는 본인 ID 것만 조회된다」.
--      기록이 전부 각자 브라우저(localStorage)에만 있어서, 관리자는 자기 브라우저 기록만 봤습니다.
--      등록·문의·회신도 같은 한계였습니다(정비사가 등록한 건을 PS 담당자가 볼 수 없음).
--      설계는 수강생 schema.sql(필드 이름·제약·RLS)을 그대로 따르고 이름에 data0901_ 만 붙였습니다.
--
--  이 파일이 만드는 것
--    표   data0901_sources     소스등록 (모델 ↔ 노트북·매뉴얼 파일). 모델은 대문자로 맞춰 하나만
--         data0901_requests    기술지원 등록 (수강생 설계의 mains — ref_no 1건 = 1행)
--         data0901_inquiries   문의 (ref_no × s_turn)
--         data0901_replies     회신 (ref_no × r_turn)
--         data0901_mails       PS 통보 메일 발송 대기 (같은 건·같은 사유 대기 메일은 하나만)
--         data0901_access_log  접속 Log (기록성 — 수정·삭제 정책 없음)
--    함수 data0901_owns_request(ref_no)      정책용 판정: 내 등록 건인가
--         data0901_last_ref_no(day)          그날 마지막 등록번호 (남의 건이 안 보여도 번호가 겹치지 않게)
--         data0901_find_duplicates(ref_no)   같은 모델·호기의 기 등록 건 번호·상태·등록일 (중복 검토)
--         data0901_queue_mail(...)           PS 메일 대기 등록 — 받는 사람(관리 지역 관리자)은 서버가 정함
--         data0901_close_access_log(id)      로그아웃 시각을 본인 기록에 한 번만
--         트리거 함수 data0901_touch · data0901_requests_guard · data0901_rows_stamp · data0901_mails_stamp
--                     · data0901_sources_norm · data0901_access_log_stamp
--    순번 data0901_mail_no_seq (메일 번호 M00001 …)
--
--  권한 (수강생 설계와 같음)
--    정비사(승인 USER) : 자기 등록 건·문의·회신·자기 접속 Log 를 본다 / 등록·후속 요청·조치 결과 / 소스는 읽기
--    PS 담당자(ADMIN)  : 전부 본다 / 회신·소스·메일 보냄 표시 (data0901_is_admin() — www 관리자 포함)
--    승인 대기·비로그인 : 아무것도 못 보고 못 씀
--  사진·영상 파일은 이 단계에서도 올리지 않고 규칙에 맞춘 파일명만 기록합니다(기획서 1단계 범위 그대로).
-- ============================================================================

-- 0. 전제 확인 — auth SQL 을 먼저 실행했는지 (없으면 여기서 멈춥니다)
do $pre$
begin
  if to_regclass('public.data0901_profiles') is null
     or to_regprocedure('public.data0901_is_admin()') is null
     or to_regprocedure('public.data0901_is_approved()') is null then
    raise exception 'data0901_profiles·data0901_is_admin() 이 없습니다. 2026-09-30_data0901_auth.sql 을 먼저 실행해 주세요.';
  end if;
end;
$pre$;

-- ----------------------------------------------------------------------------
-- 1. 표
-- ----------------------------------------------------------------------------

-- 소스등록 — 모델 하나에 노트북 하나. 모델은 트리거가 대문자·앞뒤 공백 없이 맞춥니다(도구 findSource 와 같은 규칙).
-- ⚠ 프런트에서 upsert 할 때 onConflict 는 'model' (아래 UNIQUE 제약과 같은 글자)
create table if not exists public.data0901_sources (
  id            bigint generated always as identity primary key,
  notebook_name text not null check (length(btrim(notebook_name)) between 1 and 200),
  model         text not null check (length(btrim(model)) between 1 and 20),
  files         text not null default '',                 -- '파일1; 파일2'
  owner_id      uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint data0901_sources_model_key unique (model)
);

-- 기술지원 등록 — ref_no 는 yyyymmddnnnn (그날 일련번호 4자리)
-- reg_id 는 로그인 아이디(가입 이메일, data0901_profiles.reg_id) — 수강생 설계의 VARCHAR(20) 보다 길 수 있어 80자
create table if not exists public.data0901_requests (
  ref_no         text primary key check (ref_no ~ '^[0-9]{12}$'),
  status         text not null default 'Submitted' check (status in ('Submitted', 'Answered', 'Completed')),
  reg_date       date not null default current_date,
  reg_id         text not null check (length(btrim(reg_id)) between 1 and 80),
  model          text not null check (length(btrim(model)) between 1 and 20),
  serial_no      text not null check (length(btrim(serial_no)) between 1 and 20),
  o_hour         numeric(8,1) not null check (o_hour >= 0),          -- DECIMAL(8,1)
  type_cd        text not null check (type_cd in ('Troubleshooting', 'Maintenance', 'Specification')),
  system_cat     text not null check (system_cat in (
                   'Transmission', 'Engine', 'Electric', 'Hydraulic', 'Drive Axle', 'Steering Axle', 'Cabin', 'HVAC')),
  action_content text not null default '',                           -- 조치 내용 (종료 때)
  complete_date  date,                                               -- 완료일 (종료 때)
  complete_image text not null default '',                           -- 완료 사진 파일명 'ref_no_C1.jpg; …'
  owner_id       uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint data0901_requests_complete_after_reg check (complete_date is null or complete_date >= reg_date)
);
create index if not exists data0901_requests_owner_idx    on public.data0901_requests (owner_id);
create index if not exists data0901_requests_reg_date_idx on public.data0901_requests (reg_date desc);

-- 문의 — 같은 건을 다시 요청하면 s_turn 이 1, 2, 3 … 으로 늘어납니다
-- ⚠ upsert 때 onConflict 는 'ref_no,s_turn'
create table if not exists public.data0901_inquiries (
  id          bigint generated always as identity primary key,
  ref_no      text not null references public.data0901_requests (ref_no) on delete cascade,
  s_turn      int not null check (s_turn >= 1),
  reg_date    date not null default current_date,
  reg_id      text not null check (length(btrim(reg_id)) between 1 and 80),
  phenomenon  text not null check (length(btrim(phenomenon)) > 0),
  requirement text not null check (length(btrim(requirement)) > 0),
  s_image     text not null default '',                     -- 'ref_no_1.jpg; ref_no_2.jpg'
  owner_id    uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint data0901_inquiries_ref_turn_key unique (ref_no, s_turn)
);

-- 회신 — 회신마다 r_turn 이 늘어납니다. ref_info 는 근거가 여러 개면 '; ' 로 잇습니다
-- ⚠ upsert 때 onConflict 는 'ref_no,r_turn'
create table if not exists public.data0901_replies (
  id            bigint generated always as identity primary key,
  ref_no        text not null references public.data0901_requests (ref_no) on delete cascade,
  r_turn        int not null check (r_turn >= 1),
  r_reply_date  date not null default current_date,
  r_title       text not null default '',
  req_summary   text not null default '',
  reply_content text not null check (length(btrim(reply_content)) > 0),
  ref_info      text not null default '',
  owner_id      uuid not null default auth.uid(),          -- 회신을 등록한 관리자
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint data0901_replies_ref_turn_key unique (ref_no, r_turn)
);

-- PS 통보 메일 발송 대기 — 정적 웹이라 메일은 사람이 메일 앱에서 보내고 'Sent' 로 표시합니다
create sequence if not exists public.data0901_mail_no_seq;
create table if not exists public.data0901_mails (
  id           bigint generated always as identity primary key,
  mail_id      text not null,                                -- 서버가 매기는 번호 (M00001 …)
  ref_no       text not null references public.data0901_requests (ref_no) on delete cascade,
  reason       text not null check (reason in ('cannot_answer', 'duplicate')),
  mail_to      text not null default '',                    -- 'a@x.com; b@x.com'
  subject      text not null,
  body         text not null,
  created_date timestamptz not null default now(),
  status       text not null default 'Pending' check (status in ('Pending', 'Sent')),
  sent_date    timestamptz,
  owner_id     uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint data0901_mails_mail_id_key unique (mail_id)
);
-- 같은 건·같은 사유의 대기 메일은 하나만 (도구 queueMail 과 같은 규칙을 DB 가 보장)
create unique index if not exists data0901_mails_pending_key on public.data0901_mails (ref_no, reason) where status = 'Pending';

-- 접속 Log — 로그인 1회 = 1행. 기록성: INSERT·SELECT 만, 로그아웃 시각은 data0901_close_access_log() 로 한 번만
create table if not exists public.data0901_access_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reg_id     text not null,
  login_at   timestamptz not null default now(),
  logout_at  timestamptz,
  created_at timestamptz not null default now(),
  constraint data0901_access_log_logout_after_login check (logout_at is null or logout_at >= login_at)
);
create index if not exists data0901_access_log_login_idx on public.data0901_access_log (login_at desc);
create index if not exists data0901_access_log_user_idx  on public.data0901_access_log (user_id, login_at desc);

-- ----------------------------------------------------------------------------
-- 2. 판정·도우미 함수 — 전부 search_path 고정
-- ----------------------------------------------------------------------------

-- 이 ref_no 가 로그인한 사람의 등록 건인가 (문의·회신 정책에서 씀. security definer — 정책 재귀 방지)
create or replace function public.data0901_owns_request(p_ref_no text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.data0901_requests r where r.ref_no = p_ref_no and r.owner_id = auth.uid());
$fn$;

-- 그날의 마지막 등록번호 — 정비사는 남의 건이 안 보이므로, 번호를 매기기 전에 서버에서 이것만 받아 겹치지 않게 합니다
create or replace function public.data0901_last_ref_no(p_day date)
returns text language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not public.data0901_is_approved() then
    raise exception 'data0901: 승인된 회원만 등록할 수 있습니다' using errcode = '42501';
  end if;
  return (select max(r.ref_no) from public.data0901_requests r where r.ref_no like to_char(p_day, 'YYYYMMDD') || '____');
end;
$fn$;

-- 같은 모델·같은 호기의 다른 건 중 아직 종료되지 않았거나 최근 1달 안에 등록된 건 (도구 findDuplicates 와 같은 규칙).
-- 남의 건이면 번호·상태·등록일만 돌려줍니다(요청자·내용은 관리자 메일에서만).
create or replace function public.data0901_find_duplicates(p_ref_no text)
returns table (ref_no text, status text, reg_date date)
language plpgsql stable security definer set search_path = public as $fn$
declare me public.data0901_requests;
begin
  if auth.uid() is null or not (public.data0901_is_admin() or public.data0901_owns_request(p_ref_no)) then
    raise exception 'data0901: 본인 등록 건만 확인할 수 있습니다' using errcode = '42501';
  end if;
  select * into me from public.data0901_requests r where r.ref_no = p_ref_no;
  if not found or btrim(me.serial_no) = '' then return; end if;
  return query
    select r.ref_no, r.status, r.reg_date from public.data0901_requests r
     where r.ref_no <> me.ref_no
       and upper(btrim(r.model)) = upper(btrim(me.model))
       and upper(regexp_replace(r.serial_no, '\s+', '', 'g')) = upper(regexp_replace(me.serial_no, '\s+', '', 'g'))
       and (r.status <> 'Completed' or (r.reg_date >= (me.reg_date - interval '1 month')::date and r.reg_date <= me.reg_date))
     order by r.ref_no desc;
end;
$fn$;

-- PS 메일 대기 등록 — 같은 건·같은 사유로 대기 중인 메일이 있으면 내용만 갱신합니다. 결과: 메일 번호
-- 받는 사람: 요청자 지역(territory_cd)을 관리 지역으로 가진 승인 관리자, 없으면 승인 관리자 전원(도구 psRecipients 와 같은 규칙).
-- 정비사는 관리자 이메일을 볼 수 없으므로 받는 사람은 서버가 정합니다. 관리자가 p_mail_to 를 주면 그 값을 씁니다.
create or replace function public.data0901_queue_mail(p_ref_no text, p_reason text, p_subject text, p_body text, p_mail_to text default '')
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_admin boolean := auth.uid() is not null and public.data0901_is_admin();
  v_terr  text;
  v_to    text;
  v_id    text;
begin
  if auth.uid() is null or not (v_admin or (public.data0901_is_approved() and public.data0901_owns_request(p_ref_no))) then
    raise exception 'data0901: 본인 등록 건의 메일만 대기 목록에 넣을 수 있습니다' using errcode = '42501';
  end if;
  if v_admin and btrim(coalesce(p_mail_to, '')) <> '' then
    v_to := btrim(p_mail_to);
  else
    select p.territory_cd into v_terr from public.data0901_requests r join public.data0901_profiles p on p.user_id = r.owner_id
     where r.ref_no = p_ref_no;
    select string_agg(a.e_mail, '; ' order by a.e_mail) into v_to from public.data0901_profiles a
     where a.approval = 'Approved' and a.role = 'ADMIN' and coalesce(v_terr, '') <> ''
       and v_terr = any (select btrim(x) from unnest(string_to_array(a.manage_territory, ';')) x);
    if v_to is null then
      select string_agg(a.e_mail, '; ' order by a.e_mail) into v_to from public.data0901_profiles a
       where a.approval = 'Approved' and a.role = 'ADMIN';
    end if;
  end if;
  update public.data0901_mails m set mail_to = coalesce(v_to, ''), subject = p_subject, body = p_body
   where m.ref_no = p_ref_no and m.reason = p_reason and m.status = 'Pending'
   returning m.mail_id into v_id;
  if v_id is null then
    insert into public.data0901_mails (ref_no, reason, mail_to, subject, body, mail_id)
    values (p_ref_no, p_reason, coalesce(v_to, ''), p_subject, p_body, '')
    returning mail_id into v_id;
  end if;
  return v_id;
end;
$fn$;

-- 로그아웃 시각 — 본인 기록에, 아직 비어 있을 때 한 번만. 결과: 채운 행 수(0 또는 1)
create or replace function public.data0901_close_access_log(p_id bigint)
returns int language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  update public.data0901_access_log set logout_at = greatest(now(), login_at)
   where id = p_id and user_id = auth.uid() and logout_at is null;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- 3. 트리거 — 서버가 정하는 칸(계정·아이디·번호·시각)은 본인이 적은 값을 믿지 않습니다
--    auth.uid() 가 없으면 SQL Editor(대표)의 직접 실행이므로 적힌 값을 그대로 둡니다
-- ----------------------------------------------------------------------------

-- updated_at 자동 갱신
create or replace function public.data0901_touch()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- 소스: 모델을 대문자·앞뒤 공백 없이
create or replace function public.data0901_sources_norm()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.model := upper(btrim(new.model));
  new.notebook_name := btrim(new.notebook_name);
  if tg_op = 'INSERT' and auth.uid() is not null then new.owner_id := auth.uid(); end if;
  if tg_op = 'UPDATE' then new.owner_id := old.owner_id; new.created_at := old.created_at; end if;
  return new;
end;
$fn$;

-- 등록 건: 정비사가 넣으면 계정·아이디는 본인, 상태는 접수. 관리자가 대신 넣으면(가져오기) 아이디로 계정을 찾습니다.
-- 고칠 때: 번호·아이디·계정·등록일은 그대로. 정비사는 회신(Answered)으로 바꾸지 못하고, 종료된 건은 고치지 못합니다.
create or replace function public.data0901_requests_guard()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_uid   uuid    := auth.uid();
  v_admin boolean := v_uid is not null and public.data0901_is_admin();
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      if v_admin then
        new.owner_id := coalesce((select p.user_id from public.data0901_profiles p where lower(p.reg_id) = lower(btrim(new.reg_id))), v_uid);
      else
        new.owner_id := v_uid;
        new.reg_id := coalesce((select p.reg_id from public.data0901_profiles p where p.user_id = v_uid), new.reg_id);
        new.status := 'Submitted';
        new.action_content := ''; new.complete_date := null; new.complete_image := '';
      end if;
    end if;
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;

  new.ref_no := old.ref_no; new.reg_id := old.reg_id; new.owner_id := old.owner_id;
  new.reg_date := old.reg_date; new.created_at := old.created_at;
  if v_uid is not null and not v_admin then
    if old.status = 'Completed' then
      raise exception 'data0901: 종료된 건은 고칠 수 없습니다' using errcode = '42501';
    end if;
    if new.status = 'Answered' and old.status <> 'Answered' then
      raise exception 'data0901: 회신 상태는 관리자만 정합니다' using errcode = '42501';
    end if;
    if new.status = 'Completed' and old.status <> 'Answered' then
      raise exception 'data0901: 회신 받은 건만 종료할 수 있습니다' using errcode = '42501';
    end if;
    if new.status <> 'Completed' then
      new.action_content := old.action_content; new.complete_date := old.complete_date; new.complete_image := old.complete_image;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

-- 문의·회신: 넣은 사람 계정은 본인. 정비사의 문의 아이디는 본인 아이디.
create or replace function public.data0901_rows_stamp()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    new.owner_id := v_uid;
    if tg_table_name = 'data0901_inquiries' and not public.data0901_is_admin() then
      new.reg_id := coalesce((select p.reg_id from public.data0901_profiles p where p.user_id = v_uid), new.reg_id);
    end if;
  end if;
  new.created_at := now(); new.updated_at := now();
  return new;
end;
$fn$;

-- 메일: 번호는 서버 순번으로 (정비사는 남의 메일이 안 보이므로 브라우저에서 매기면 겹칩니다)
create or replace function public.data0901_mails_stamp()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is not null or coalesce(new.mail_id, '') = '' then
    new.mail_id := 'M' || lpad(nextval('public.data0901_mail_no_seq')::text, 5, '0');
  end if;
  if auth.uid() is not null then new.owner_id := auth.uid(); end if;
  new.created_date := coalesce(new.created_date, now());
  new.created_at := now(); new.updated_at := now();
  return new;
end;
$fn$;

-- 접속 Log: 로그인 시각·아이디·계정은 서버가
create or replace function public.data0901_access_log_stamp()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    new.user_id := v_uid;
    new.reg_id := coalesce((select p.reg_id from public.data0901_profiles p where p.user_id = v_uid), new.reg_id);
    new.login_at := now();
    new.logout_at := null;
  end if;
  new.created_at := now();
  return new;
end;
$fn$;

drop trigger if exists data0901_sources_norm on public.data0901_sources;
create trigger data0901_sources_norm before insert or update on public.data0901_sources
  for each row execute function public.data0901_sources_norm();
drop trigger if exists data0901_sources_touch on public.data0901_sources;
create trigger data0901_sources_touch before update on public.data0901_sources
  for each row execute function public.data0901_touch();

drop trigger if exists data0901_requests_guard on public.data0901_requests;
create trigger data0901_requests_guard before insert or update on public.data0901_requests
  for each row execute function public.data0901_requests_guard();

drop trigger if exists data0901_inquiries_stamp on public.data0901_inquiries;
create trigger data0901_inquiries_stamp before insert on public.data0901_inquiries
  for each row execute function public.data0901_rows_stamp();
drop trigger if exists data0901_inquiries_touch on public.data0901_inquiries;
create trigger data0901_inquiries_touch before update on public.data0901_inquiries
  for each row execute function public.data0901_touch();

drop trigger if exists data0901_replies_stamp on public.data0901_replies;
create trigger data0901_replies_stamp before insert on public.data0901_replies
  for each row execute function public.data0901_rows_stamp();
drop trigger if exists data0901_replies_touch on public.data0901_replies;
create trigger data0901_replies_touch before update on public.data0901_replies
  for each row execute function public.data0901_touch();

drop trigger if exists data0901_mails_stamp on public.data0901_mails;
create trigger data0901_mails_stamp before insert on public.data0901_mails
  for each row execute function public.data0901_mails_stamp();
drop trigger if exists data0901_mails_touch on public.data0901_mails;
create trigger data0901_mails_touch before update on public.data0901_mails
  for each row execute function public.data0901_touch();

drop trigger if exists data0901_access_log_stamp on public.data0901_access_log;
create trigger data0901_access_log_stamp before insert on public.data0901_access_log
  for each row execute function public.data0901_access_log_stamp();

-- ----------------------------------------------------------------------------
-- 4. RLS — 비로그인은 정책이 없어 아무것도 못 봅니다. 모든 정책은 to authenticated.
-- ----------------------------------------------------------------------------
alter table public.data0901_sources    enable row level security;
alter table public.data0901_requests   enable row level security;
alter table public.data0901_inquiries  enable row level security;
alter table public.data0901_replies    enable row level security;
alter table public.data0901_mails      enable row level security;
alter table public.data0901_access_log enable row level security;

-- 표 권한: Supabase 가 새 표마다 anon·authenticated 에 전부 붙이므로 먼저 모두 걷고 필요한 것만 줍니다
revoke all on public.data0901_sources, public.data0901_requests, public.data0901_inquiries,
              public.data0901_replies, public.data0901_mails, public.data0901_access_log from public, anon, authenticated;
grant select, insert, update, delete on public.data0901_sources, public.data0901_requests, public.data0901_inquiries,
                                        public.data0901_replies, public.data0901_mails to authenticated;
grant select, insert on public.data0901_access_log to authenticated;     -- 기록성: UPDATE·DELETE 권한도 없음
-- 순번: 메일 번호는 트리거(security definer)만 씁니다. identity 순번도 anon 에서 걷습니다
revoke all on sequence public.data0901_mail_no_seq from public, anon, authenticated;
do $seq$
declare s text;
begin
  foreach s in array array[
    pg_get_serial_sequence('public.data0901_sources', 'id'),   pg_get_serial_sequence('public.data0901_inquiries', 'id'),
    pg_get_serial_sequence('public.data0901_replies', 'id'),   pg_get_serial_sequence('public.data0901_mails', 'id'),
    pg_get_serial_sequence('public.data0901_access_log', 'id')]
  loop
    execute format('revoke all on sequence %s from public, anon', s);
  end loop;
end;
$seq$;

-- sources — 등록 화면의 모델 확인에 쓰므로 승인 회원은 모두 읽습니다. 쓰기는 관리자
drop policy if exists data0901_sources_read   on public.data0901_sources;
drop policy if exists data0901_sources_insert on public.data0901_sources;
drop policy if exists data0901_sources_update on public.data0901_sources;
drop policy if exists data0901_sources_delete on public.data0901_sources;
create policy data0901_sources_read   on public.data0901_sources for select to authenticated using (public.data0901_is_approved());
create policy data0901_sources_insert on public.data0901_sources for insert to authenticated with check (public.data0901_is_admin());
create policy data0901_sources_update on public.data0901_sources for update to authenticated
  using (public.data0901_is_admin()) with check (public.data0901_is_admin());
create policy data0901_sources_delete on public.data0901_sources for delete to authenticated using (public.data0901_is_admin());

-- requests — 본인 등록 건만. 관리자는 전부(회신 때 상태 변경, 가져오기로 대신 등록)
drop policy if exists data0901_requests_read   on public.data0901_requests;
drop policy if exists data0901_requests_insert on public.data0901_requests;
drop policy if exists data0901_requests_update on public.data0901_requests;
drop policy if exists data0901_requests_delete on public.data0901_requests;
create policy data0901_requests_read   on public.data0901_requests for select to authenticated
  using (owner_id = auth.uid() or public.data0901_is_admin());
create policy data0901_requests_insert on public.data0901_requests for insert to authenticated
  with check ((owner_id = auth.uid() and public.data0901_is_approved()) or public.data0901_is_admin());
create policy data0901_requests_update on public.data0901_requests for update to authenticated
  using ((owner_id = auth.uid() and public.data0901_is_approved()) or public.data0901_is_admin())
  with check ((owner_id = auth.uid() and public.data0901_is_approved()) or public.data0901_is_admin());
create policy data0901_requests_delete on public.data0901_requests for delete to authenticated using (public.data0901_is_admin());

-- inquiries — 본인 등록 건에만 문의(후속 요청)를 붙입니다. 고치고 지우는 것은 관리자만
drop policy if exists data0901_inquiries_read   on public.data0901_inquiries;
drop policy if exists data0901_inquiries_insert on public.data0901_inquiries;
drop policy if exists data0901_inquiries_update on public.data0901_inquiries;
drop policy if exists data0901_inquiries_delete on public.data0901_inquiries;
create policy data0901_inquiries_read   on public.data0901_inquiries for select to authenticated
  using (public.data0901_owns_request(ref_no) or public.data0901_is_admin());
create policy data0901_inquiries_insert on public.data0901_inquiries for insert to authenticated
  with check ((owner_id = auth.uid() and public.data0901_owns_request(ref_no) and public.data0901_is_approved()) or public.data0901_is_admin());
create policy data0901_inquiries_update on public.data0901_inquiries for update to authenticated
  using (public.data0901_is_admin()) with check (public.data0901_is_admin());
create policy data0901_inquiries_delete on public.data0901_inquiries for delete to authenticated using (public.data0901_is_admin());

-- replies — 요청자는 자기 건의 회신을 읽기만. 회신 등록은 관리자(PS 담당자)
drop policy if exists data0901_replies_read   on public.data0901_replies;
drop policy if exists data0901_replies_insert on public.data0901_replies;
drop policy if exists data0901_replies_update on public.data0901_replies;
drop policy if exists data0901_replies_delete on public.data0901_replies;
create policy data0901_replies_read   on public.data0901_replies for select to authenticated
  using (public.data0901_owns_request(ref_no) or public.data0901_is_admin());
create policy data0901_replies_insert on public.data0901_replies for insert to authenticated with check (public.data0901_is_admin());
create policy data0901_replies_update on public.data0901_replies for update to authenticated
  using (public.data0901_is_admin()) with check (public.data0901_is_admin());
create policy data0901_replies_delete on public.data0901_replies for delete to authenticated using (public.data0901_is_admin());

-- mails — 관리자만 읽고 보냄 표시. 정비사는 data0901_queue_mail() 로 자기 건의 중복 검토 메일만 넣습니다
drop policy if exists data0901_mails_read   on public.data0901_mails;
drop policy if exists data0901_mails_insert on public.data0901_mails;
drop policy if exists data0901_mails_update on public.data0901_mails;
drop policy if exists data0901_mails_delete on public.data0901_mails;
create policy data0901_mails_read   on public.data0901_mails for select to authenticated using (public.data0901_is_admin());
create policy data0901_mails_insert on public.data0901_mails for insert to authenticated with check (public.data0901_is_admin());
create policy data0901_mails_update on public.data0901_mails for update to authenticated
  using (public.data0901_is_admin()) with check (public.data0901_is_admin());
create policy data0901_mails_delete on public.data0901_mails for delete to authenticated using (public.data0901_is_admin());

-- access_log — 기록성: INSERT·SELECT 만 (UPDATE·DELETE 정책 없음)
drop policy if exists data0901_access_log_select     on public.data0901_access_log;
drop policy if exists data0901_access_log_insert_own on public.data0901_access_log;
create policy data0901_access_log_select on public.data0901_access_log for select to authenticated
  using (user_id = auth.uid() or public.data0901_is_admin());
create policy data0901_access_log_insert_own on public.data0901_access_log for insert to authenticated
  with check (user_id = auth.uid() and public.data0901_is_approved());

-- ----------------------------------------------------------------------------
-- 5. 함수 권한 (§3.7) — PUBLIC 과 anon 을 둘 다 끊습니다(Supabase 가 새 함수마다 anon 에 자동 부여).
--    정책 식의 판정 함수(owns_request)도 정책이 전부 to authenticated 라 anon 은 필요 없습니다.
--    트리거 함수는 authenticated 를 남깁니다(직접 부르면 "trigger 로만" 오류로 죽어 무해).
-- ----------------------------------------------------------------------------
revoke execute on function public.data0901_owns_request(text)                         from public, anon;
revoke execute on function public.data0901_last_ref_no(date)                          from public, anon;
revoke execute on function public.data0901_find_duplicates(text)                      from public, anon;
revoke execute on function public.data0901_queue_mail(text, text, text, text, text)   from public, anon;
revoke execute on function public.data0901_close_access_log(bigint)                   from public, anon;
revoke execute on function public.data0901_touch()                                    from public, anon;
revoke execute on function public.data0901_sources_norm()                             from public, anon;
revoke execute on function public.data0901_requests_guard()                           from public, anon;
revoke execute on function public.data0901_rows_stamp()                               from public, anon;
revoke execute on function public.data0901_mails_stamp()                              from public, anon;
revoke execute on function public.data0901_access_log_stamp()                         from public, anon;
grant  execute on function public.data0901_owns_request(text)                         to authenticated;
grant  execute on function public.data0901_last_ref_no(date)                          to authenticated;
grant  execute on function public.data0901_find_duplicates(text)                      to authenticated;
grant  execute on function public.data0901_queue_mail(text, text, text, text, text)   to authenticated;
grant  execute on function public.data0901_close_access_log(bigint)                   to authenticated;
grant  execute on function public.data0901_touch()                                    to authenticated;
grant  execute on function public.data0901_sources_norm()                             to authenticated;
grant  execute on function public.data0901_requests_guard()                           to authenticated;
grant  execute on function public.data0901_rows_stamp()                               to authenticated;
grant  execute on function public.data0901_mails_stamp()                              to authenticated;
grant  execute on function public.data0901_access_log_stamp()                         to authenticated;

-- ============================================================================
-- 실행 뒤 확인 (SQL Editor)
--   select relname, relrowsecurity from pg_class where relname like 'data0901\_%' and relkind = 'r' order by 1;  -- 모두 true
--   select c.relname, p.polname, p.polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
--    where c.relname = 'data0901_access_log';                                   -- r(select)·a(insert) 두 개만
--   select proname, array_to_string(proacl, ' ') from pg_proc where proname like 'data0901\_%';  -- anon=X 가 없어야 함
-- ============================================================================
