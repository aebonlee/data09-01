/*
 * 서버 연결 — 공용 Supabase(구글·카카오 로그인, 회원 정보, 매뉴얼 보관)
 *
 *  - 로그인: 구글·카카오(OAuth). 돌아올 주소는 지금 페이지 주소(location.origin + location.pathname).
 *    GitHub Pages 하위 경로(/data09-01/)나 사용자 도메인 루트 어느 쪽에서도 같은 화면으로 돌아옵니다.
 *  - 회원: data0901_profiles (가입 → 기본 정보 입력 → 관리자 승인). 전 사이트 공용 www_profiles 에도
 *    이름·전화·이메일·가입 출처('hdx-ps')를 채웁니다(www 표준 OnboardingGate 와 같은 방식).
 *  - 매뉴얼: private 버킷 data0901-manuals 의 텍스트 색인(gzip JSON). 읽기 = 승인 회원, 쓰기 = 관리자.
 *  - 제공 자료: 같은 버킷의 originals/ — 수강생이 준 원본 파일(기획서·엑셀·매뉴얼 PDF 등). 권한은 위와 같음.
 *
 * 접속 정보는 전 사이트 공통 공개 값(anon 키)입니다. 실제 보호는 서버의 RLS·Storage 정책이 합니다.
 * 파일로 열었을 때(file://)는 로그인하지 못하므로 서버 기능이 꺼지고 예시 데이터 시연만 됩니다.
 */
(function (root) {
  'use strict';
  var URL = (root.DATA0901_SUPABASE && root.DATA0901_SUPABASE.url) || 'https://hcmgdztsgjvzcyxyayaj.supabase.co';
  var KEY = (root.DATA0901_SUPABASE && root.DATA0901_SUPABASE.anonKey) ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjbWdkenRzZ2p2emN5eHlheWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzU4ODcsImV4cCI6MjA4NzAxMTg4N30.gznaPzY1l8qDAPsEyYNR9KS7f7VqS3xaw-_2HTSwSZw';
  var BUCKET = 'data0901-manuals';
  var P = root.TSProfile;
  var client = null;

  function reason() {
    if (!/^https?:$/.test(root.location.protocol)) return 'file';
    if (!root.supabase || typeof root.supabase.createClient !== 'function') return 'lib';
    return '';
  }
  function sb() {
    if (client) return client;
    if (reason()) return null;
    client = root.supabase.createClient(URL, KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    });
    return client;
  }
  function fail(error) { var e = new Error(error && error.message || String(error)); e.code = error && error.code; throw e; }
  function redirectTo() { return root.location.origin + root.location.pathname; }

  // OAuth 가 돌려준 ?code=… · ?error=… 를 주소창에서 지웁니다(해시 라우터와 섞이지 않게)
  function cleanUrl() {
    try {
      var q = new root.URLSearchParams(root.location.search);
      if (q.has('code') || q.has('error') || q.has('error_description')) {
        root.history.replaceState(null, '', root.location.pathname + (root.location.hash && !/access_token|error=/.test(root.location.hash) ? root.location.hash : ''));
      } else if (/access_token=|error_description=/.test(root.location.hash)) {
        root.history.replaceState(null, '', root.location.pathname);
      }
    } catch (e) { /* 무시 */ }
  }

  function signIn(provider) {
    var c = sb();
    if (!c) return Promise.reject(new Error(reason()));
    try { root.localStorage.setItem('signup_site', P.SITE_ID); } catch (e) { /* 무시 */ }
    return c.auth.signInWithOAuth({ provider: provider, options: { redirectTo: redirectTo() } })
      .then(function (r) { if (r.error) fail(r.error); return r.data; });
  }
  function signOut() {
    var c = sb();
    return c ? c.auth.signOut().catch(function () { /* 이미 끊긴 세션 */ }) : Promise.resolve();
  }
  function getUser() {
    var c = sb();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (r) { return r.data && r.data.session ? r.data.session.user : null; });
  }
  function onChange(cb) {
    var c = sb();
    if (!c) return;
    c.auth.onAuthStateChange(function (event, session) { cb(event, session ? session.user : null); });
  }

  // 로그인 사용자의 상태: { user, profile(data0901_profiles|null), www(www_profiles|null), isAdmin }
  function loadState(user) {
    var c = sb();
    if (!c || !user) return Promise.resolve({ user: null, profile: null, www: null, isAdmin: false });
    return Promise.all([
      c.from('data0901_profiles').select('*').eq('user_id', user.id).maybeSingle(),
      c.from('www_profiles').select('*').eq('user_id', user.id).maybeSingle(),
      c.rpc('data0901_is_admin')
    ]).then(function (rs) {
      if (rs[0].error) fail(rs[0].error);
      return {
        user: user, profile: rs[0].data || null,
        www: rs[1].error ? null : rs[1].data || null,
        isAdmin: !rs[2].error && rs[2].data === true
      };
    });
  }

  // 기본 정보 저장 — 처음이면 insert(서버가 승인 대기로 고정), 이후엔 본인 정보만 update.
  // 결과: { profile, warnings: [] } — www_profiles 갱신이 실패해도 사이트 가입은 막지 않고 경고만 돌려줍니다.
  function saveProfile(state, value) {
    var c = sb();
    var user = state.user;
    var row = {
      name: value.name, phone: value.phone, e_mail: value.e_mail, is_dealer: value.is_dealer,
      dealer_name: value.dealer_name, country_cd: value.country_cd, region: value.region, territory_cd: value.territory_cd
    };
    var q = state.profile
      ? c.from('data0901_profiles').update(row).eq('user_id', user.id).select().single()
      : c.from('data0901_profiles').insert(Object.assign({ user_id: user.id, reg_id: String(value.e_mail).toLowerCase() }, row)).select().single();
    return q.then(function (r) {
      if (r.error) fail(r.error);
      var profile = r.data;
      var patch = P.wwwPatch(state.www, value);
      return c.from('www_profiles').update(patch).eq('user_id', user.id).select().maybeSingle().then(function (w) {
        var warnings = [];
        if (w.error || !w.data) warnings.push('www_profiles');
        else { try { root.localStorage.removeItem('signup_site'); } catch (e) { /* 무시 */ } }
        return { profile: profile, www: w.data || state.www, warnings: warnings };
      });
    });
  }

  // 회원 관리 (관리자)
  function listMembers() {
    return sb().from('data0901_profiles').select('*').order('created_at', { ascending: false })
      .then(function (r) { if (r.error) fail(r.error); return r.data || []; });
  }
  function updateMember(userId, change) {
    return sb().from('data0901_profiles').update(change).eq('user_id', userId).select().single()
      .then(function (r) { if (r.error) fail(r.error); return r.data; });
  }

  // ── 매뉴얼 (Storage) ──────────────────────────────────────
  // 저장 이름: 원래 파일명에서 Storage 가 받지 않는 글자를 _ 로 바꾸고 .manual.json(.gz)
  function objectName(file, gz) {
    var base = String(file || 'manual').replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9 ._()-]/g, '_').trim() || 'manual';
    return base + '.manual.json' + (gz ? '.gz' : '');
  }
  function canGzip() { return typeof root.CompressionStream === 'function' && typeof root.Response === 'function'; }
  function gzip(text) {
    var s = new root.Blob([text]).stream().pipeThrough(new root.CompressionStream('gzip'));
    // Response 가 돌려준 Blob 은 형식이 비어 있어 업로드(multipart)에서 application/octet-stream 으로 붙습니다.
    // supabase-js 는 Blob 을 올릴 때 contentType 옵션 대신 Blob 의 형식을 쓰므로 여기서 형식을 붙입니다.
    return new root.Response(s).blob().then(function (b) { return new root.Blob([b], { type: 'application/gzip' }); });
  }
  function gunzip(blob) {
    if (typeof root.DecompressionStream !== 'function') return Promise.reject(new Error('DecompressionStream'));
    return new root.Response(blob.stream().pipeThrough(new root.DecompressionStream('gzip'))).text();
  }
  function listManuals() {
    return sb().storage.from(BUCKET).list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
      .then(function (r) {
        if (r.error) fail(r.error);
        return (r.data || []).filter(function (o) { return /\.manual\.json(\.gz)?$/i.test(o.name); });
      });
  }
  function downloadManual(name) {
    return sb().storage.from(BUCKET).download(name).then(function (r) {
      if (r.error) fail(r.error);
      return /\.gz$/i.test(name) ? gunzip(r.data) : r.data.text();
    });
  }
  // obj: manual_to_json.py 형식(또는 화면에서 PDF 로 만든 색인). 같은 매뉴얼은 덮어씁니다.
  function uploadManual(obj) {
    var text = JSON.stringify(obj);
    var gz = canGzip();
    var name = objectName(obj.file, gz);
    var other = objectName(obj.file, !gz);
    return (gz ? gzip(text) : Promise.resolve(new root.Blob([text], { type: 'application/json' }))).then(function (body) {
      return sb().storage.from(BUCKET).upload(name, body, {
        upsert: true, contentType: gz ? 'application/gzip' : 'application/json', cacheControl: '3600'
      });
    }).then(function (r) {
      if (r.error) fail(r.error);
      // 압축 여부가 다른 옛 사본이 있으면 지웁니다(같은 매뉴얼이 두 번 보이지 않게)
      return sb().storage.from(BUCKET).remove([other]).then(function () { return { name: name, bytes: text.length }; });
    });
  }
  function removeManual(name) {
    return sb().storage.from(BUCKET).remove([name]).then(function (r) { if (r.error) fail(r.error); });
  }

  // ── 제공 자료 원본 (Storage originals/) ─────────────────────
  // 경로·목록 규칙은 js/originals.js. 읽기 = 승인 회원, 올리기·지우기 = 관리자(서버 정책).
  var O = root.TSOriginals;
  function readOriginalsIndex() {
    return sb().storage.from(BUCKET).download(O.INDEX).then(function (r) {
      if (r.error) return O.readIndex(null);   // 아직 목록 파일이 없으면 빈 목록
      return r.data.text().then(O.readIndex);
    }, function () { return O.readIndex(null); });
  }
  function writeOriginalsIndex(index) {
    var body = new root.Blob([JSON.stringify(index)], { type: 'application/json' });
    return sb().storage.from(BUCKET).upload(O.INDEX, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
      .then(function (r) { if (r.error) fail(r.error); });
  }
  function listOriginals() {
    return Promise.all([
      sb().storage.from(BUCKET).list(O.PREFIX.replace(/\/$/, ''), { limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
      readOriginalsIndex()
    ]).then(function (rs) {
      if (rs[0].error) fail(rs[0].error);
      return O.merge(rs[0].data || [], rs[1]);
    });
  }
  // files: File 목록. note: 모두에 붙일 메모(출처 등). onEach(k, total, file) 로 진행을 알립니다.
  // 결과: { done: [...], fails: [{ name, msg }] } — 다 올린 뒤 목록 파일을 한 번만 고쳐 씁니다.
  function uploadOriginals(files, note, onEach) {
    var done = [], fails = [], chain = Promise.resolve();
    files.forEach(function (f, k) {
      chain = chain.then(function () {
        if (onEach) onEach(k + 1, files.length, f);
        var key = O.keyOf(f.name), type = O.contentTypeOf(f.name, f.type);
        // Blob 의 형식이 곧 올라가는 형식입니다(위 gzip 설명) — 확장자로 정한 형식을 붙인 사본으로 올립니다
        var body = new root.Blob([f], { type: type });
        return sb().storage.from(BUCKET).upload(key, body, { upsert: true, contentType: type, cacheControl: '3600' })
          .then(function (r) {
            if (r.error) fail(r.error);
            done.push({ key: key, name: f.name, note: note || '', size: f.size, type: type, uploaded: new Date().toISOString().slice(0, 10) });
          })
          .catch(function (e) { fails.push({ name: f.name, msg: String(e && e.message || e) }); });
      });
    });
    return chain.then(function () {
      if (!done.length) return { done: done, fails: fails };
      return readOriginalsIndex().then(function (ix) { return writeOriginalsIndex(O.withFiles(ix, done)); })
        .then(function () { return { done: done, fails: fails }; });
    });
  }
  function removeOriginal(key) {
    return sb().storage.from(BUCKET).remove([key]).then(function (r) {
      if (r.error) fail(r.error);
      return readOriginalsIndex().then(function (ix) { return writeOriginalsIndex(O.withoutFiles(ix, [key])); });
    });
  }
  // 내려받기 주소 — 10분 동안만 쓰는 서명 주소(원래 이름으로 저장되게 download 에 이름을 줌)
  function originalUrl(key, name) {
    return sb().storage.from(BUCKET).createSignedUrl(key, 600, { download: name || true })
      .then(function (r) { if (r.error) fail(r.error); return r.data.signedUrl; });
  }

  root.TSAuth = {
    SITE_ID: P.SITE_ID, BUCKET: BUCKET, reason: reason, enabled: function () { return !reason(); },
    redirectTo: redirectTo, cleanUrl: cleanUrl, signIn: signIn, signOut: signOut, getUser: getUser, onChange: onChange,
    loadState: loadState, saveProfile: saveProfile, listMembers: listMembers, updateMember: updateMember,
    objectName: objectName, listManuals: listManuals, downloadManual: downloadManual, uploadManual: uploadManual,
    removeManual: removeManual,
    listOriginals: listOriginals, uploadOriginals: uploadOriginals, removeOriginal: removeOriginal, originalUrl: originalUrl
  };
})(window);
