/*
 * 화면 — 화면구성.xlsx 의 10개 화면을 해시 주소로 나눕니다.
 *   #/login            접속화면 (언어·로그인)
 *   #/request          기술지원1 (신규 등록)  → 후속 요청 팝업(기술지원2)
 *   #/request/<ref>    기술지원3 (후속 요청: 기존 내용 수정·재제출)
 *   #/list             조회_User / 조회_Admin (권한에 따라 열·검색조건이 다름)
 *   #/detail/<ref>     상세조회_User / 상세조회_Admin
 *   #/sources[/<ref>]  소스등록 (Admin)
 *   #/logs             접속Log (Admin)
 *   #/data             데이터 관리 (예시 데이터·엑셀 가져오기/내보내기)
 *   #/manual           매뉴얼 근거 검색 (내 PC 의 매뉴얼 PDF → 목차·키워드 검색·발췌)   — 2026-09-29
 *   #/members          회원 관리 (Admin: 가입 승인·권한·관리 지역)                        — 2026-09-29
 *   #/mails            PS 메일 발송 대기 (Admin: AI 답변 불가·중복 등록 건)              — 2026-09-29
 *   #/profile          기본 정보 입력(첫 로그인)·내 정보                                   — 2026-09-30
 *   #/manual-admin     매뉴얼 등록 (Admin: 서버 비공개 저장소에 매뉴얼 텍스트 색인 올리기)    — 2026-09-30
 *   #/originals        제공 자료 (승인 회원: 원본 내려받기 / Admin: 원본 올리기·지우기)         — 2026-09-30
 *
 * 2026-09-30 강사 결정: 로그인은 공용 Supabase 의 구글·카카오(js/auth.js), 가입 뒤 기본 정보를 받고
 * 관리자가 승인합니다. 예전의 아이디 직접 가입은 없앴고, 예시 데이터 시연은 로그인 없이 예시 계정으로 합니다.
 * 기술지원 기록(등록·문의·회신·메일·Log)은 아직 이 브라우저(localStorage)에 둡니다 — 서버 이전은 다음 단계.
 */
(function () {
  'use strict';
  var L = window.TSLogic, S = window.TSStore, M = window.TSManual, MS = window.TSManualStore;
  var P = window.TSProfile, A = window.TSAuth, O = window.TSOriginals;
  var db = S.loadDb();
  var lang = S.getLang() || window.TSI18n.defaultLang(navigator.language);
  if (lang !== 'ko' && lang !== 'en') lang = 'ko';
  var t = window.TSI18n.make(lang);
  // 서버 로그인 상태 — checked: 확인이 끝났는지, user: 구글·카카오 계정, profile: data0901_profiles 행
  var auth = { checked: !A.enabled(), user: null, profile: null, www: null, isAdmin: false, error: '' };
  var main = document.getElementById('main');
  var listFilter = null; // 조회 화면 검색조건 유지
  var afterRender = null; // 화면을 다시 그린 뒤 띄울 안내(대화상자) — render 가 열린 대화상자를 닫기 때문
  // 매뉴얼 색인: 서버에 등록된 것(승인 회원, 메모리에만) + 내 PC 에서 불러온 것(IndexedDB). 같은 파일은 서버 쪽을 씁니다.
  var manuals = [], localManuals = [], serverManuals = [];
  var serverManualState = { status: 'idle', k: 0, n: 0, msg: '' };
  function mergeManuals() {
    var files = {};
    serverManuals.forEach(function (x) { files[x.file] = true; });
    manuals = serverManuals.concat(localManuals.filter(function (x) { return !files[x.file]; }));
    manuals.sort(function (a, b) { return a.file < b.file ? -1 : 1; });
  }
  var manualsReady = MS.list().then(function (list) {
    localManuals = (list || []).map(function (x) { var r = M.readIndexJson(x); return r.ok ? r.index : null; }).filter(Boolean);
    mergeManuals();
  }).catch(function () { localManuals = []; mergeManuals(); });

  // ── 도우미 ────────────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function save(newDb) { if (newDb) db = newDb; S.saveDb(db); }
  function now() { return new Date(); }
  function session() { return S.getSession(); }
  // 서버 로그인 사용자를 도구의 사용자 행 모양으로 (승인 전이면 approval 이 Pending)
  function serverUser() { return auth.user && auth.profile ? P.toLocalUser(auth.profile, auth.isAdmin) : null; }
  // 지금 쓰는 사용자: 서버 로그인이면 승인된 경우에만, 아니면 예시 데이터 시연 계정(이 브라우저 안)
  function me() {
    if (auth.user) { var su = serverUser(); return su && L.isApproved(su) ? su : null; }
    var s = session(); return s && !s.server ? L.userOf(db, s.reg_id) : null;
  }
  function isAdmin() { return L.isApprovedAdmin(me()); }
  function isServerAdmin() { return !!auth.user && isAdmin(); }
  function terrLabel(code) { return P.territoryLabel(code, lang); }
  function kindLabel(kind) { return /service|정비/i.test(kind || '') ? t('kind_sm') : /operator|운전/i.test(kind || '') ? t('kind_om') : (kind || ''); }
  // 서버 회원을 로컬 사용자 목록에 둡니다(조회·상세의 이름·딜러, PS 메일 받는 사람 고르기에 씀)
  function upsertLocalUser(u) {
    var k = String(u.reg_id).toLowerCase();
    var i = -1;
    db.users.forEach(function (x, j) { if (String(x.reg_id).toLowerCase() === k) i = j; });
    if (i === -1) db.users.push(u); else db.users[i] = Object.assign({}, db.users[i], u);
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  var toastTimer;
  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  // 대화상자: buttons = [{label, value, primary, onClick}]
  function dialog(title, content, buttons) {
    var dlg = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = title;
    var box = document.getElementById('dialogContent');
    box.textContent = '';
    append(box, content);
    var acts = document.getElementById('dialogActions');
    acts.textContent = '';
    (buttons || [{ label: t('btn_close'), value: 'close' }]).forEach(function (b) {
      acts.appendChild(h('button', {
        class: 'btn' + (b.primary ? ' btn-primary' : ''), value: b.value || 'close',
        onclick: b.onClick ? function (e) { e.preventDefault(); dlg.close(); b.onClick(); } : null
      }, b.label));
    });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    return dlg;
  }
  function closeDialog() { var d = document.getElementById('dialog'); if (d.open) d.close(); }

  function copyText(text) {
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;left:-9999px' });
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).catch(fallback);
    else fallback();
    toast(t('ai_copied'));
  }

  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // 영상 길이(초)를 <video> 메타데이터로 읽습니다. 못 읽으면(코덱 미지원·시간 초과) null
  function readDuration(file) {
    return new Promise(function (resolve) {
      var url, v = document.createElement('video'), done = false, timer;
      function finish(d) {
        if (done) return;
        done = true; clearTimeout(timer);
        v.removeAttribute('src'); try { v.load(); } catch (e) { /* 무시 */ }
        if (url) URL.revokeObjectURL(url);
        resolve(typeof d === 'number' && isFinite(d) ? d : null);
      }
      try { url = URL.createObjectURL(file); } catch (e) { resolve(null); return; }
      timer = setTimeout(function () { finish(null); }, 8000);
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = function () { finish(v.duration); };
      v.onerror = function () { finish(null); };
      v.src = url;
    });
  }

  function statusBadge(st) {
    var m = L.STATUS_META[st] || { ko: st, en: st, color: 'black' };
    return h('span', { class: 'status ' + m.color }, lang === 'en' ? m.en : m.ko);
  }
  function typeLabel(code) {
    var f = L.TYPE_CD.filter(function (x) { return x.code === code; })[0];
    return f ? (lang === 'en' ? f.code : f.ko + ' (' + f.code + ')') : (code || '');
  }
  function catLabel(code) {
    var f = L.SYSTEM_CAT.filter(function (x) { return x.code === code; })[0];
    return f ? (lang === 'en' ? f.code : f.ko + ' (' + f.code + ')') : (code || '');
  }
  function codeSelect(name, list, value, labeler) {
    return h('select', { name: name, id: 'f_' + name },
      h('option', { value: '' }, t('select_placeholder')),
      list.map(function (x) {
        var code = typeof x === 'string' ? x : x.code;
        return h('option', { value: code, selected: code === value }, labeler ? labeler(code) : code);
      }));
  }
  function field(label, control, opts) {
    opts = opts || {};
    return h('label', { class: 'field' + (opts.span ? ' span-all' : ''), 'data-field': opts.name || '' },
      h('span', null, label), control,
      opts.hint ? h('small', { class: 'note' }, opts.hint) : null,
      h('small', { class: 'err', hidden: true }));
  }
  function readonlyField(label, value) {
    return h('div', { class: 'field' }, h('span', null, label), h('div', { class: 'readonly-val' }, value));
  }
  function showErrors(form, errors) {
    form.querySelectorAll('.field').forEach(function (f) {
      f.classList.remove('invalid');
      var e = f.querySelector('.err'); if (e) { e.hidden = true; e.textContent = ''; }
    });
    errors.forEach(function (er) {
      var f = form.querySelector('.field[data-field="' + er.field + '"]');
      if (!f) { toast(t('err_' + er.code), true); return; }
      f.classList.add('invalid');
      var e = f.querySelector('.err'); e.hidden = false; e.textContent = t('err_' + er.code);
    });
    var first = form.querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea');
    if (first) first.focus();
  }
  function fd(form) {
    var o = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (el.name && el.type !== 'file') o[el.name] = el.value;
    });
    return o;
  }

  // ── 머리 ─────────────────────────────────────────────────
  function renderHeader(route) {
    document.documentElement.lang = lang;
    document.title = t('brand') + ' — ' + t('brandSub');
    document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = t(el.getAttribute('data-t')); });
    document.querySelectorAll('[data-t-attr]').forEach(function (el) {
      var p = el.getAttribute('data-t-attr').split(':'); el.setAttribute(p[0], t(p[1]));
    });
    document.querySelectorAll('.lang-toggle button').forEach(function (b) { b.setAttribute('aria-pressed', b.value === lang ? 'true' : 'false'); });
    var nav = document.getElementById('nav');
    nav.textContent = '';
    var u = me();
    var items = [['request', 'nav_request'], ['list', 'nav_list'], ['manual', 'nav_manual']];
    if (auth.user && u) items.push(['originals', 'nav_originals']); // 서버 승인 회원만(시연 계정은 서버 파일을 못 봄)
    if (L.isApprovedAdmin(u)) {
      // 서버 로그인 관리자의 승인 대기 수는 서버 목록(membersCache)에서, 시연은 로컬 사용자에서 셉니다
      var pendingUsers = auth.user ? (membersCache || []).filter(function (x) { return x.approval === 'Pending'; }).length
        : db.users.filter(function (x) { return L.approvalOf(x) === 'Pending'; }).length;
      var pendingMails = (db.mails || []).filter(function (x) { return x.status === 'Pending'; }).length;
      items.push(['members', 'nav_members', pendingUsers], ['mails', 'nav_mails', pendingMails], ['sources', 'nav_sources'], ['logs', 'nav_logs']);
      if (auth.user) items.push(['manual-admin', 'nav_manual_admin']);
    }
    items.push(['data', 'nav_data']);
    if (auth.user && auth.profile) items.push(['profile', 'nav_profile']);
    items.forEach(function (it) {
      nav.appendChild(h('a', { href: '#/' + it[0], 'aria-current': route === it[0] ? 'page' : null }, t(it[1]),
        it[2] ? h('span', { class: 'count-badge', title: t('pending_count') }, String(it[2])) : null));
    });
    var su = serverUser();
    var who = u || su;
    document.getElementById('whoami').textContent = who ? who.req_name + ' (' + who.reg_id + (who.user_type === 'ADMIN' && L.isApproved(who) ? ' · ADMIN' : '') +
      (!auth.user ? ' · ' + t('demo_tag') : '') + ')' : (auth.user ? String(auth.user.email || '') : '');
    var authBtn = document.getElementById('authBtn');
    authBtn.textContent = u || auth.user ? t('logout') : t('login');
    var banner = document.getElementById('sampleBanner');
    banner.hidden = !db._sample;
    banner.textContent = t('sample_banner');
  }

  // 한/영 전환 (KO | EN) — 선택은 이 브라우저에 기억합니다(저장소가 막혀 있으면 이번 방문만)
  document.querySelectorAll('.lang-toggle button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.value === lang) return;
      lang = b.value; S.setLang(lang); t = window.TSI18n.make(lang); render();
    });
  });
  document.getElementById('authBtn').addEventListener('click', function () {
    if (me() || auth.user) logout(); else go('#/login');
  });

  // ── 로그인 ───────────────────────────────────────────────
  // 접속 Log 는 이 브라우저에 남깁니다(로그인·로그아웃 시각). 서버 로그인도 처음 확인될 때 한 번 기록합니다.
  function startLog(regId, server) {
    var at = L.toDateTimeStr(now());
    db.logs.push({ reg_id: regId, login_date: at, logout_date: '' });
    save();
    S.setSession({ reg_id: regId, login_date: at, server: !!server });
  }
  function endLog() {
    var s = session();
    if (!s) return;
    for (var i = db.logs.length - 1; i >= 0; i--) {
      var l = db.logs[i];
      if (l.reg_id === s.reg_id && l.login_date === s.login_date && !l.logout_date) { l.logout_date = L.toDateTimeStr(now()); break; }
    }
    save();
  }
  // 예시 데이터 시연 계정으로 들어가기 (이 브라우저 안에서만, 비밀번호 없음)
  // 결과: { ok, code } — 승인 대기·반려된 계정은 들어가지 못합니다(2026-09-29 수강생 답변)
  function login(regId) {
    var chk = L.canLogin(db, regId);
    if (!chk.ok) return chk;
    startLog(chk.user.reg_id, false);
    return { ok: true };
  }
  function resetAuth() {
    auth = { checked: true, user: null, profile: null, www: null, isAdmin: false, error: '' };
    serverManuals = []; serverManualState = { status: 'idle', k: 0, n: 0, msg: '' }; membersCache = null;
    mergeManuals();
  }
  function logout() {
    endLog();
    S.setSession(null);
    if (auth.user) {
      A.signOut().then(function () { resetAuth(); go('#/login'); });
      return;
    }
    go('#/login');
  }

  // 서버 로그인 상태를 읽어 옵니다(첫 화면, 구글·카카오에서 돌아왔을 때, 기본 정보 저장 뒤)
  function refreshAuth() {
    if (!A.enabled()) { auth.checked = true; return Promise.resolve(); }
    return A.getUser().then(function (user) {
      A.cleanUrl();
      return A.loadState(user);
    }).then(function (st) {
      auth.user = st.user; auth.profile = st.profile; auth.www = st.www; auth.isAdmin = st.isAdmin;
      auth.checked = true; auth.error = '';
      afterAuth();
    }).catch(function (e) {
      auth.checked = true; auth.error = String(e && e.message || e);
    });
  }
  function afterAuth() {
    var su = serverUser();
    if (!auth.user) {
      var s0 = session();
      if (s0 && s0.server) S.setSession(null); // 서버 세션이 끝났으면 기록도 닫습니다
      return;
    }
    if (su && L.isApproved(su)) {
      upsertLocalUser(su);
      var s = session();
      if (!s || !s.server || s.reg_id !== su.reg_id) { if (s) endLog(); startLog(su.reg_id, true); } else save();
      loadServerManuals();
      if (isAdmin()) loadMembers(false);
    } else if (session()) {
      endLog(); S.setSession(null); // 승인 전 서버 계정이면 예시 계정 세션은 닫습니다
    }
  }

  function guard(needAdmin) {
    if (!auth.checked) { main.appendChild(h('div', { class: 'card' }, h('p', { class: 'note' }, t('login_checking')))); return false; }
    if (!me()) {
      if (auth.user) { viewPending(); return false; }
      main.appendChild(h('div', { class: 'card' }, h('p', null, t('need_login')),
        h('a', { class: 'btn btn-primary', href: '#/login' }, t('login'))));
      return false;
    }
    if (needAdmin && !isAdmin()) {
      main.appendChild(h('div', { class: 'card' }, h('p', null, t('need_admin'))));
      return false;
    }
    return true;
  }

  function loadSample(skipConfirm) {
    function doIt() {
      db = window.TSSample.build(now());
      if (!auth.user) S.setSession(null);
      else { var su = serverUser(); if (su && L.isApproved(su)) upsertLocalUser(su); }
      save();
      toast(t('data_loaded'));
      go(auth.user ? '#/list' : '#/login');
    }
    var has = db.mains.length || db.users.length || db.sources.length;
    if (has && !skipConfirm) dialog(t('load_sample'), h('p', null, t('data_sample_confirm')),
      [{ label: t('btn_close'), value: 'close' }, { label: t('load_sample'), primary: true, onClick: doIt }]);
    else doIt();
  }

  // ── 접속화면 — 구글·카카오 로그인 + 예시 데이터 시연 ────────────────
  function viewLogin() {
    if (auth.user) { go(auth.profile ? (me() ? '#/request' : '#/profile') : '#/profile'); return; }
    var off = A.reason();
    var loginCard = h('div', { class: 'card' },
      h('h1', null, t('login_title')),
      h('p', null, t('login_intro')));
    if (!auth.checked) loginCard.appendChild(h('p', { class: 'note' }, t('login_checking')));
    if (auth.error) loginCard.appendChild(h('p', { class: 'alert warn' }, t('auth_error', { msg: auth.error })));
    if (off) {
      loginCard.appendChild(h('p', { class: 'alert warn' }, t(off === 'file' ? 'login_off_file' : 'login_off_lib')));
    }
    function start(provider) {
      A.signIn(provider).catch(function (e) { toast(t('login_fail', { msg: String(e && e.message || e) }), true); });
    }
    loginCard.appendChild(h('div', { class: 'oauth-buttons' },
      h('button', { class: 'btn oauth google', type: 'button', disabled: !!off, onclick: function () { start('google'); } },
        oauthIcon('google'), h('span', null, t('login_google'))),
      h('button', { class: 'btn oauth kakao', type: 'button', disabled: !!off, onclick: function () { start('kakao'); } },
        oauthIcon('kakao'), h('span', null, t('login_kakao')))));

    // 시연 — 로그인 없이 예시 데이터와 예시 계정으로
    var demo = h('div', { class: 'card' }, h('h2', null, t('demo_title')), h('p', { class: 'note' }, t('demo_note')));
    var demoUsers = db.users.filter(function (u) { return !u._server; });
    if (!db._sample || !demoUsers.length) {
      demo.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { loadSample(!db.mains.length && !db.users.length); } }, t('load_sample')));
    } else {
      demo.appendChild(h('h3', null, t('demo_accounts')));
      demo.appendChild(h('div', { class: 'account-list' }, demoUsers.map(function (u) {
        var ap = L.approvalOf(u);
        return h('button', { class: 'btn', type: 'button', onclick: function () {
          var res = login(u.reg_id);
          if (!res.ok) { toast(t('login_' + res.code), true); return; }
          go('#/request');
        } },
          u.req_name + ' · ' + u.reg_id + (u.user_type === 'ADMIN' ? ' (ADMIN)' : ''),
          ap !== 'Approved' ? h('span', { class: 'status ' + (ap === 'Pending' ? 'red' : 'black'), style: 'margin-left:6px' }, t('approval_' + ap)) : null);
      })));
    }
    main.appendChild(h('div', { class: 'login-wrap' }, loginCard, demo));
  }
  function oauthIcon(kind) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('viewBox', kind === 'google' ? '0 0 48 48' : '0 0 24 24');
    var paths = kind === 'google' ? [
      ['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
      ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
      ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
      ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z']
    ] : [['#191919', 'M12 3C6.48 3 2 6.48 2 10.77c0 2.76 1.85 5.18 4.63 6.55l-1.18 4.33c-.1.38.33.68.66.46l5.15-3.4c.24.02.49.03.74.03 5.52 0 10-3.48 10-7.77S17.52 3 12 3z']];
    paths.forEach(function (p) { var el = document.createElementNS(ns, 'path'); el.setAttribute('fill', p[0]); el.setAttribute('d', p[1]); svg.appendChild(el); });
    return svg;
  }

  // ── 기본 정보 입력(첫 로그인) · 내 정보 ────────────────────────────
  function viewProfile() {
    if (!auth.checked) { main.appendChild(h('div', { class: 'card' }, h('p', { class: 'note' }, t('login_checking')))); return; }
    if (!auth.user) { go('#/login'); return; }
    var p = auth.profile || {};
    var www = auth.www || {};
    var first = !auth.profile;
    var countrySel = h('select', { name: 'country_cd', id: 'f_country_cd' },
      h('option', { value: '' }, t('select_placeholder')),
      P.countryOptions(lang).map(function (c) { return h('option', { value: c.code, selected: c.code === (p.country_cd || (first && lang === 'ko' ? 'KR' : '')) }, c.label); }));
    var regionList = h('datalist', { id: 'regionList' });
    function fillRegions() {
      regionList.textContent = '';
      P.regionSuggestions(countrySel.value).forEach(function (r) { regionList.appendChild(h('option', { value: r }, terrLabel(r) !== r ? terrLabel(r) : null)); });
    }
    countrySel.addEventListener('change', fillRegions);
    var dealerY = h('input', { type: 'radio', name: 'is_dealer', value: 'Y', checked: p.is_dealer === true });
    var dealerN = h('input', { type: 'radio', name: 'is_dealer', value: 'N', checked: p.is_dealer === false });
    var dealerName = h('input', { name: 'dealer_name', maxlength: 60, value: p.dealer_name || '' });
    var dealerNameField = field(t('f_dealer_name'), dealerName, { name: 'dealer_name' });
    function syncDealer() { dealerNameField.hidden = !dealerY.checked; }
    dealerY.addEventListener('change', syncDealer); dealerN.addEventListener('change', syncDealer);
    var form = h('form', { class: 'card form-grid', novalidate: true },
      h('p', { class: 'span-all note' }, t('ob_login_as', { email: auth.user.email || '-' })),
      field(t('f_ob_name') + ' *', h('input', { name: 'name', maxlength: 50, autocomplete: 'name', value: p.name || www.name || '' }), { name: 'name' }),
      field(t('f_ob_phone') + ' *', h('input', { name: 'phone', type: 'tel', maxlength: 25, autocomplete: 'tel', placeholder: '010-1234-5678', value: p.phone || www.phone || '' }), { name: 'phone', hint: t('phone_hint') }),
      field(t('f_ob_email') + ' *', h('input', { name: 'e_mail', type: 'email', maxlength: 80, autocomplete: 'email', value: p.e_mail || www.email || auth.user.email || '' }), { name: 'e_mail', hint: t('ob_email_hint') }),
      h('div', { class: 'field', 'data-field': 'is_dealer' }, h('span', null, t('f_is_dealer') + ' *'),
        h('div', { class: 'checks' }, h('label', { class: 'check' }, dealerY, t('dealer_yes')), h('label', { class: 'check' }, dealerN, t('dealer_no'))),
        h('small', { class: 'err', hidden: true })),
      dealerNameField,
      field(t('f_ob_country') + ' *', countrySel, { name: 'country_cd' }),
      field(t('f_ob_region') + ' *', h('input', { name: 'region', list: 'regionList', maxlength: 60, autocomplete: 'off', value: p.region || '' }), { name: 'region', hint: t('region_hint') }),
      regionList,
      h('div', { class: 'span-all submit-bar' }, h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, t('ob_save'))));
    fillRegions(); syncDealer();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = fd(form);
      v.is_dealer = dealerY.checked ? 'Y' : dealerN.checked ? 'N' : '';
      var res = P.validateOnboarding(v);
      if (!res.ok) { showErrors(form, res.errors); return; }
      var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      A.saveProfile(auth, res.value).then(function (r) {
        auth.profile = r.profile; auth.www = r.www;
        return refreshAuth().then(function () {
          var body = t(me() ? 'ob_saved' : 'ob_saved_pending') + (r.warnings.length ? ' ' + t('ob_www_warn') : '');
          afterRender = { title: t(first ? 'ob_title' : 'ob_edit_title'), body: body };
          go(me() ? (first ? '#/request' : '#/profile') : '#/profile');
          if (!first) render();
        });
      }).catch(function (err) {
        btn.disabled = false;
        var dup = /duplicate|unique|23505/i.test(String(err && (err.code || '') + ' ' + err.message));
        toast(dup ? t('err_dup_account') : t('auth_error', { msg: String(err && err.message || err) }), true);
      });
    });
    main.appendChild(h('div', { class: 'page-head' }, h('div', { style: 'margin-right:auto' },
      h('h1', null, t(first ? 'ob_title' : 'ob_edit_title')), h('p', { class: 'note' }, t(first ? 'ob_note' : 'ob_edit_note')))));
    if (!first && !me()) main.appendChild(pendingCard());
    main.appendChild(form);
  }
  function pendingCard() {
    var su = serverUser();
    var rejected = su && su.approval === 'Rejected';
    return h('div', { class: 'card' },
      h('h2', null, h('span', { class: 'status ' + (rejected ? 'black' : 'red'), style: 'margin-right:8px' }, t('approval_' + (su ? su.approval : 'Pending'))),
        t(rejected ? 'rejected_title' : 'pending_title')),
      h('p', null, t(rejected ? 'login_rejected' : 'pending_body')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { refreshAuth().then(render); } }, t('btn_refresh')),
        h('a', { class: 'btn', href: '#/profile' }, t('btn_edit_profile')),
        h('button', { class: 'btn', type: 'button', onclick: logout }, t('logout'))));
  }
  // 로그인했지만 아직 승인 전(또는 기본 정보 전)
  function viewPending() {
    if (!auth.profile) { go('#/profile'); return; }
    main.appendChild(pendingCard());
  }

  // ── 기술지원1·3 (등록 / 후속 요청) ──────────────────────────
  function viewRequest(refNo) {
    if (!guard()) return;
    var u = me();
    var mainRow = refNo ? db.mains.filter(function (m) { return m.ref_no === refNo; })[0] : null;
    if (refNo && (!mainRow || (mainRow.reg_id !== u.reg_id && !isAdmin()))) { go('#/request'); return; }
    var q = mainRow ? L.latestInquiry(db, refNo) : null;
    var v = mainRow ? {
      model: mainRow.model, serial_no: mainRow.serial_no, o_hour: mainRow.o_hour, type_cd: mainRow.type_cd,
      system_cat: mainRow.system_cat, phenomenon: q ? q.phenomenon : '', requirement: q ? q.requirement : ''
    } : {};
    var modelList = h('datalist', { id: 'modelList' }, db.sources.map(function (s) { return h('option', { value: s.model }); }));
    if (mainRow && mainRow.status === 'Completed') {
      main.appendChild(h('div', { class: 'page-head' }, h('h1', null, t('btn_follow'))));
      main.appendChild(h('div', { class: 'card' }, h('p', null, t('completed_readonly')),
        h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '#/request' }, t('btn_new')),
          h('a', { class: 'btn', href: '#/detail/' + refNo }, t('detail_title')))));
      return;
    }
    var fileNames = h('ul', { class: 'file-names', hidden: true });
    var fileInput = h('input', { type: 'file', name: 's_image', multiple: true, accept: 'image/*,video/*' });
    var existing = mainRow ? db.inquiries.filter(function (x) { return x.ref_no === refNo; })
      .reduce(function (n, x) { return n + L.splitList(x.s_image).length; }, 0) : 0;
    // 첨부 제한(사진 5장·영상 1개 60초): 파일을 고르면 영상 길이를 읽어 바로 확인합니다
    var attachMeta = [], attachPending = Promise.resolve(), attachToken = 0;
    var attachField = h('div', { class: 'field span-all', 'data-field': 's_image' }, h('span', null, t('f_s_image')), fileInput,
      h('small', { class: 'note' }, t('attach_limit')), h('small', { class: 'note' }, t('attach_note')), fileNames,
      h('small', { class: 'err', hidden: true }));
    function showAttach() {
      var names = attachMeta.map(function (f) { return f.name; });
      var check = L.validateAttachments(attachMeta);
      var preview = L.imageFileNames(refNo || 'yyyymmddnnnn', names, existing + 1);
      fileNames.textContent = '';
      fileNames.hidden = !names.length;
      if (names.length) fileNames.appendChild(h('li', { class: 'note' }, t('attach_count', { images: check.images, videos: check.videos })));
      names.forEach(function (n, i) { fileNames.appendChild(h('li', null, n + ' → ' + preview[i])); });
      check.warnings.forEach(function (w) { fileNames.appendChild(h('li', { class: 'alert warn' }, t('warn_' + w.code, { name: w.name }))); });
      var e = attachField.querySelector('.err');
      attachField.classList.toggle('invalid', !check.ok);
      e.hidden = check.ok;
      e.textContent = check.errors.map(function (x) { return t('err_' + x.code); }).join(' ');
    }
    fileInput.addEventListener('change', function () {
      var token = ++attachToken;
      var files = Array.prototype.slice.call(fileInput.files);
      attachMeta = files.map(function (f) { return { name: f.name, type: f.type, duration: null }; });
      fileNames.textContent = '';
      fileNames.hidden = !files.length;
      if (files.some(function (f) { return L.attachKind(f) === 'video'; })) fileNames.appendChild(h('li', { class: 'note' }, t('attach_checking')));
      attachPending = Promise.all(files.map(function (f) {
        return L.attachKind(f) === 'video' ? readDuration(f) : Promise.resolve(null);
      })).then(function (durations) {
        if (token !== attachToken) return;
        durations.forEach(function (d, i) { attachMeta[i].duration = d; });
        showAttach();
      });
    });

    var form = h('form', { class: 'card', novalidate: true },
      h('div', { class: 'form-grid cols-4' },
        readonlyField(t('f_ref_no'), refNo || t('auto_after_submit')),
        readonlyField(t('f_reg_date'), L.displayDate(mainRow ? mainRow.reg_date : L.toDateStr(now()))),
        readonlyField(t('f_reg_id'), u.reg_id),
        h('div', { class: 'field' }, h('span', null, t('f_status')), h('div', { class: 'readonly-val' }, mainRow ? statusBadge(mainRow.status) : statusBadge('Submitted')))),
      h('hr', { style: 'border:none;border-top:1px solid var(--line);margin:20px 0' }),
      h('div', { class: 'form-grid' },
        field(t('f_model'), h('input', { name: 'model', list: 'modelList', maxlength: 20, value: v.model || '', autocomplete: 'off' }), { name: 'model', hint: t('model_hint') }),
        field(t('f_serial_no'), h('input', { name: 'serial_no', maxlength: 20, value: v.serial_no || '' }), { name: 'serial_no' }),
        field(t('f_o_hour'), h('input', { name: 'o_hour', inputmode: 'decimal', value: v.o_hour != null ? v.o_hour : '', placeholder: '1234.5' }), { name: 'o_hour' }),
        field(t('f_type_cd'), codeSelect('type_cd', L.TYPE_CD, v.type_cd, typeLabel), { name: 'type_cd' }),
        field(t('f_system_cat'), codeSelect('system_cat', L.SYSTEM_CAT, v.system_cat, catLabel), { name: 'system_cat' }),
        h('div', { class: 'field' }),
        field(t('f_phenomenon'), h('textarea', { name: 'phenomenon', value: v.phenomenon || '' }), { name: 'phenomenon', span: true }),
        field(t('f_requirement'), h('textarea', { name: 'requirement', value: v.requirement || '' }), { name: 'requirement', span: true }),
        attachField),
      modelList,
      h('div', { class: 'submit-bar' }, h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, t('btn_submit'))));
    // textarea value 는 속성이 아니라 속성값으로 넣어야 보입니다
    form.elements.phenomenon.value = v.phenomenon || '';
    form.elements.requirement.value = v.requirement || '';

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      attachPending.then(submit); // 영상 길이 확인이 끝난 뒤 제출합니다
    });
    function submit() {
      var data = fd(form);
      var files = attachMeta;
      var res = refNo ? L.addFollowUp(db, refNo, data, u, now(), files) : L.createRequest(db, data, u, now(), files);
      if (!res.ok) {
        showErrors(form, res.errors);
        var modelErr = res.errors.filter(function (x) { return x.field === 'model' && x.code === 'model_not_registered'; })[0];
        if (modelErr) {
          dialog(t('model_popup_title'), h('p', null, t('model_popup_body', {
            model: data.model.trim(), list: db.sources.map(function (s) { return s.model; }).join(', ') || '-'
          })));
        }
        return;
      }
      save(res.db);
      toast(refNo ? t('followed_ok', { ref: res.ref_no, turn: res.s_turn }) : t('submitted_ok', { ref: res.ref_no }));
      // 같은 모델·호기의 기 등록 건이 있으면 막지 않고 PS 담당자 검토 메일을 발송 대기 목록에 넣습니다
      if (res.duplicates && res.duplicates.length) {
        var q = L.queueMail(db, L.buildDupMail(db, res.ref_no, res.duplicates), now());
        if (q.ok) save(q.db);
        afterRender = { title: t('dup_title'), body: t('dup_user_note', { list: res.duplicates.join(', ') }) };
      }
      go('#/detail/' + res.ref_no);
    }

    main.appendChild(h('div', { class: 'page-head' },
      h('h1', null, refNo ? t('btn_follow') : t('btn_new')),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn', href: '#/request', 'aria-pressed': refNo ? 'false' : 'true' }, t('btn_new')),
        h('button', { class: 'btn', type: 'button', 'aria-pressed': refNo ? 'true' : 'false', onclick: pickFollowUp }, t('btn_follow')))));
    if (refNo) main.appendChild(h('div', { class: 'mode-note' }, t('follow_mode')));
    main.appendChild(form);
  }

  // 기술지원2 — 최근 1달 본인 등록 건 팝업
  function pickFollowUp() {
    var u = me();
    // 종료된 건은 다시 열지 않으므로 목록에서 뺍니다
    var rows = L.recentOwnRequests(db, u.reg_id, now()).filter(function (m) { return m.status !== 'Completed'; });
    var content = rows.length ? h('ul', { class: 'pick-list' }, rows.map(function (m) {
      var q = L.latestInquiry(db, m.ref_no) || {};
      return h('li', null, h('button', {
        type: 'button', onclick: function (e) { e.preventDefault(); closeDialog(); go('#/request/' + m.ref_no); }
      }, h('strong', null, m.ref_no + ' · ' + m.model + ' '), statusBadge(m.status),
        h('span', { class: 'sub' }, L.displayDate(m.reg_date) + ' · ' + (q.phenomenon || ''))));
    })) : h('p', null, t('follow_none'));
    dialog(t('follow_pick_title'), [h('p', { class: 'note' }, t('follow_pick_note')), content]);
  }

  // ── 조회_User / 조회_Admin ─────────────────────────────────
  function viewList() {
    if (!guard()) return;
    var admin = isAdmin(), u = me();
    var f = listFilter || { from: '', to: '', model: '', dealer: '', type_cd: '', system_cat: '' };
    var dealers = db.users.map(function (x) { return x.dealer; }).filter(function (d, i, a) { return d && a.indexOf(d) === i; });
    var controls = [
      field(t('from'), h('input', { type: 'date', name: 'from', value: f.from })),
      field(t('to'), h('input', { type: 'date', name: 'to', value: f.to })),
      field(t('f_model'), h('input', { name: 'model', value: f.model, list: 'modelList2' }))
    ];
    if (admin) controls.push(
      field(t('f_dealer'), codeSelect('dealer', dealers, f.dealer)),
      field(t('f_type_cd'), codeSelect('type_cd', L.TYPE_CD, f.type_cd, typeLabel)),
      field(t('f_system_cat'), codeSelect('system_cat', L.SYSTEM_CAT, f.system_cat, catLabel)));
    var form = h('form', { class: 'card filters' }, controls,
      h('datalist', { id: 'modelList2' }, db.sources.map(function (s) { return h('option', { value: s.model }); })),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'submit' }, t('search')),
        h('button', { class: 'btn', type: 'button', onclick: function () { listFilter = null; render(); } }, t('reset'))));
    form.querySelectorAll('select option[value=""]').forEach(function (o) { o.textContent = t('all'); });
    form.addEventListener('submit', function (e) { e.preventDefault(); listFilter = fd(form); render(); });

    var filter = Object.assign({}, f);
    if (!admin) { filter.reg_id = u.reg_id; delete filter.dealer; delete filter.type_cd; delete filter.system_cat; }
    var rows = L.filterRows(L.buildListRows(db), filter);

    // 열 — 화면구성.xlsx 조회_User / 조회_Admin 순서
    var cols = admin ? [
      ['status', 'f_status'], ['ref_no', 'f_ref_no'], ['count', 'f_count'], ['reg_date', 'f_reg_date'], ['req_name', 'f_name'],
      ['dealer', 'f_dealer'], ['model', 'f_model'], ['type_cd', 'f_type_cd'], ['phenomenon', 'f_phenomenon'],
      ['requirement', 'f_requirement'], ['r_title', 'f_title'], ['reply_content', 'f_reply'],
      ['complete_date', 'f_complete_date'], ['action_content', 'f_action_content']
    ] : [
      ['status', 'f_status'], ['ref_no', 'f_ref_no'], ['reg_date', 'f_reg_date'], ['reg_id', 'f_reg_id'], ['model', 'f_model'],
      ['type_cd', 'f_type_cd'], ['phenomenon', 'f_phenomenon'], ['requirement', 'f_requirement'], ['r_title', 'f_title']
    ];
    var longCols = ['phenomenon', 'requirement', 'r_title', 'reply_content', 'action_content'];
    function cell(r, k) {
      if (k === 'status') return statusBadge(r.status);
      if (k === 'reg_date' || k === 'complete_date') return L.displayDate(r[k]);
      if (k === 'type_cd') return typeLabel(r.type_cd);
      if (longCols.indexOf(k) !== -1) return h('div', { class: 'clip-text' }, r[k]);
      return String(r[k] == null ? '' : r[k]);
    }
    var tbody = h('tbody', null, rows.map(function (r) {
      function open() { go('#/detail/' + r.ref_no); }
      return h('tr', {
        tabindex: 0, ondblclick: open,
        onkeydown: function (e) { if (e.key === 'Enter') open(); }
      }, cols.map(function (c) {
        return h('td', { class: longCols.indexOf(c[0]) !== -1 ? 'clip' : 'nowrap' }, cell(r, c[0]));
      }));
    }));
    var table = h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { scope: 'col' }, t(c[1])); }))),
      tbody));

    function exportCsv() {
      // 머리행은 화면 언어의 열 이름(한국어 화면은 「등록번호(Ref. No.)」처럼 필드명을 함께 적음)
      var headers = cols.map(function (c) { return { key: c[0], label: t(c[1]) }; });
      var out = rows.map(function (r) { var o = Object.assign({}, r); o.status = r.status; return o; });
      var name = t(admin ? 'file_list_admin' : 'file_list') + '_' + L.toDateStr(now()) + (db._sample ? '_' + t('file_sample') : '') + '.csv';
      download(name, new Blob([L.toCsv(headers, out)], { type: 'text/csv;charset=utf-8' }));
    }

    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, admin ? t('list_title_admin') : t('list_title_user'))));
    main.appendChild(form);
    main.appendChild(h('div', { class: 'list-meta' },
      h('strong', null, rows.length + ' ' + t('rows')),
      h('span', { class: 'note' }, t('list_hint')),
      h('button', { class: 'btn', type: 'button', onclick: exportCsv, style: 'margin-left:auto' }, t('export_csv'))));
    main.appendChild(rows.length ? table : h('div', { class: 'card' }, t('list_empty')));
  }

  // ── 상세조회 ─────────────────────────────────────────────
  function viewDetail(refNo) {
    if (!guard()) return;
    var admin = isAdmin(), u = me();
    var m = db.mains.filter(function (x) { return x.ref_no === refNo; })[0];
    if (!m || (!admin && m.reg_id !== u.reg_id)) { go('#/list'); return; }
    var owner = L.userOf(db, m.reg_id) || {};
    var qs = db.inquiries.filter(function (x) { return x.ref_no === refNo; });
    var rs = db.replies.filter(function (x) { return x.ref_no === refNo; });

    function kv(label, value) { return h('dl', { class: 'kv' }, h('dt', null, label), h('dd', null, value)); }
    var head = h('div', { class: 'card' },
      h('div', { class: 'detail-head' },
        kv(t('f_ref_no'), m.ref_no), kv(t('f_status'), statusBadge(m.status)),
        kv(t('f_reg_date'), L.displayDate(m.reg_date)), kv(t('f_reg_id'), m.reg_id + (owner.req_name ? ' · ' + owner.req_name : '')),
        kv(t('f_model'), m.model), kv(t('f_serial_no'), m.serial_no), kv(t('f_o_hour'), String(m.o_hour)),
        kv(t('f_count'), String(qs.length)), kv(t('f_type_cd'), typeLabel(m.type_cd)), kv(t('f_system_cat'), catLabel(m.system_cat)),
        admin ? kv(t('f_dealer'), owner.dealer || '') : null));

    // 요청 차수와 회신 차수를 번갈아 놓습니다 (1차 요청 → 1차 회신 → 2차 요청 …)
    var items = [];
    qs.forEach(function (q) { items.push({ k: 'q', turn: Number(q.s_turn), date: q.reg_date, row: q }); });
    rs.forEach(function (r) { items.push({ k: 'r', turn: Number(r.r_turn), date: r.r_reply_date, row: r }); });
    items.sort(function (a, b) { return a.turn - b.turn || (a.k === 'q' ? -1 : 1); });
    var thread = h('div', { class: 'thread' }, items.map(function (it) {
      var r = it.row;
      if (it.k === 'q') {
        return h('div', { class: 'bubble q' },
          h('h3', null, t('bubble_q', { turn: it.turn }) + ' · ' + L.displayDate(it.date)),
          h('p', null, h('span', { class: 'label' }, t('f_phenomenon') + ': '), h('span', { class: 'body' }, r.phenomenon)),
          h('p', null, h('span', { class: 'label' }, t('f_requirement') + ': '), h('span', { class: 'body' }, r.requirement)),
          L.splitList(r.s_image).length ? h('p', { class: 'note' }, t('f_s_image') + ': ' + L.splitList(r.s_image).join(', ')) : null);
      }
      var refs = L.splitList(r.ref_info);
      return h('div', { class: 'bubble r' },
        h('h3', null, t('bubble_r', { turn: it.turn }) + ' · ' + L.displayDate(it.date)),
        r.r_title ? h('p', null, h('strong', null, r.r_title)) : null,
        r.req_summary ? h('p', { class: 'note' }, r.req_summary) : null,
        h('p', { class: 'body' }, r.reply_content),
        refs.length ? h('div', null, h('span', { class: 'label' }, t('ref_info')),
          h('div', { class: 'chips' }, refs.map(function (x) {
            return h('button', { type: 'button', class: 'chip', onclick: function () {
              // 불러온 매뉴얼에 그 쪽이 있으면 쪽 본문을 보여 줍니다(이전/다음 이동)
              var hit = M.findRef(manuals, x);
              if (hit) { showManualPage(hit.index, hit.n); return; }
              dialog(t('ref_popup'), [h('p', null, h('strong', null, x)), h('p', { class: 'note' }, t(manuals.length ? 'ref_not_found' : 'ref_popup_note')),
                h('a', { class: 'btn', href: '#/manual' }, t('nav_manual'))]);
            } }, x);
          }))) : null);
    }));
    if (!rs.length) thread.appendChild(h('p', { class: 'note' }, t('no_reply')));

    var buttons = h('div', { class: 'btn-row' });
    if (admin) {
      buttons.appendChild(h('a', { class: 'btn', href: '#/sources/' + refNo }, t('btn_to_source')));
    } else if (m.status !== 'Completed') {
      buttons.appendChild(h('a', { class: 'btn btn-primary', href: '#/request/' + refNo }, t('btn_add_request')));
    }
    buttons.appendChild(h('a', { class: 'btn', href: '#/list' }, t('btn_close')));

    // 조치 결과 — 종료된 건은 조치 내용·완료일을 보여 주고(옛 데이터는 비어 있을 수 있음),
    // 회신 받은 본인 건은 조치 결과를 적어 종료합니다
    var closing = null;
    if (m.status === 'Completed') {
      closing = h('div', { class: 'card result-card' }, h('h2', null, t('result_title')),
        h('div', { class: 'detail-head' },
          kv(t('f_complete_date'), m.complete_date ? L.displayDate(m.complete_date) : '-'),
          kv(t('f_action_content'), h('span', { class: 'body' }, m.action_content || '-')),
          kv(t('f_complete_image'), L.splitList(m.complete_image).join(', ') || '-')));
    } else if (!admin && m.status === 'Answered') {
      // 완료 사진(선택, 최대 5장) — 2026-09-29 수강생 답변 「조치내용, 완료사진, 완료일」
      var photoInput = h('input', { type: 'file', name: 'complete_image', multiple: true, accept: 'image/*' });
      var photoNames = h('ul', { class: 'file-names', hidden: true });
      photoInput.addEventListener('change', function () {
        var names = Array.prototype.map.call(photoInput.files, function (f) { return f.name; });
        var after = L.completeImageNames(refNo, names);
        photoNames.textContent = '';
        photoNames.hidden = !names.length;
        names.forEach(function (n, i) { photoNames.appendChild(h('li', null, n + ' → ' + after[i])); });
      });
      var closeForm = h('form', { class: 'form-grid', novalidate: true },
        field(t('f_action_content'), h('textarea', { name: 'action_content', rows: 4 }), { name: 'action_content', span: true }),
        field(t('f_complete_date'), h('input', { type: 'date', name: 'complete_date', value: L.toDateStr(now()), min: m.reg_date, max: L.toDateStr(now()) }), { name: 'complete_date' }),
        h('div', { class: 'field span-all', 'data-field': 'complete_image' }, h('span', null, t('f_complete_image')), photoInput,
          h('small', { class: 'note' }, t('complete_image_note')), photoNames, h('small', { class: 'err', hidden: true })),
        h('div', { class: 'span-all submit-bar' }, h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, t('btn_complete'))));
      closeForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var closingData = fd(closeForm);
        closingData.complete_image = Array.prototype.map.call(photoInput.files, function (f) { return { name: f.name, type: f.type }; });
        var res = L.completeRequest(db, refNo, closingData, now());
        if (!res.ok) { showErrors(closeForm, res.errors); return; }
        save(res.db); toast(t('completed_ok')); render();
      });
      closing = h('div', { class: 'card close-card' }, h('h2', null, t('close_title')), h('p', { class: 'note' }, t('close_note')), closeForm);
    }

    main.appendChild(h('div', { class: 'page-head' },
      h('div', { style: 'margin-right:auto' }, h('h1', null, t('detail_title')), h('p', { class: 'note' }, t('detail_sub'))), buttons));
    main.appendChild(head);
    var dups = L.findDuplicates(db, refNo);
    if (dups.length) main.appendChild(h('div', { class: 'alert warn' }, t('dup_detail'), ' ',
      dups.map(function (r, i) { return [i ? ', ' : '', admin || db.mains.some(function (x) { return x.ref_no === r && x.reg_id === u.reg_id; }) ? h('a', { href: '#/detail/' + r }, r) : r]; })));
    main.appendChild(h('div', { class: 'card' }, thread));
    if (closing) main.appendChild(closing);
    if (admin && m.status !== 'Completed') main.appendChild(aiPanel(refNo));
  }

  // AI 회신 — 프롬프트 생성 → (매뉴얼 근거 붙이기) → 붙여넣기 → 나누기 → 저장 (반자동)
  function aiPanel(refNo) {
    var basePrompt = L.buildAiPrompt(db, refNo);
    var prompt = basePrompt;
    var promptBox = h('pre', { class: 'prompt-box' }, prompt);
    var paste = h('textarea', { name: 'ai_answer', rows: 8 });
    var result = h('div');
    var panel = h('div', { class: 'card ai-panel' },
      h('h2', null, t('ai_title')),
      h('p', { class: 'note' }, t('ai_step1')), h('p', { class: 'note' }, t('ai_step2')), h('p', { class: 'note' }, t('ai_step3')),
      groundingPanel(refNo, function (block) {
        prompt = basePrompt + block;
        promptBox.textContent = prompt;
      }),
      promptBox,
      h('div', { class: 'btn-row', style: 'margin:10px 0 16px' },
        h('button', { class: 'btn', type: 'button', onclick: function () { copyText(prompt); } }, t('ai_copy'))),
      field(t('ai_paste'), paste),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: parse }, t('ai_parse'))),
      result);

    function parse() {
      result.textContent = '';
      var p = L.parseAiAnswer(paste.value);
      if (!paste.value.trim()) return;
      if (p.cannotAnswer) {
        // 관리 지역 담당 관리자에게 보낼 메일을 발송 대기 목록에 넣습니다
        var mail = L.buildPsMail(db, refNo, p.reply_content);
        var q = L.queueMail(db, mail, now());
        if (q.ok) save(q.db);
        append(result, [
          h('div', { class: 'alert warn' }, t('ai_cannot')),
          mailCard(q.mail || mail, true)
        ]);
        return;
      }
      var form = h('form', { class: 'form-grid', novalidate: true, style: 'margin-top:16px' },
        field(t('f_r_title'), h('input', { name: 'r_title', value: p.r_title }), { name: 'r_title', span: true }),
        field(t('f_req_summary'), h('textarea', { name: 'req_summary' }), { name: 'req_summary', span: true }),
        field(t('f_reply_content'), h('textarea', { name: 'reply_content' }), { name: 'reply_content', span: true }),
        field(t('f_ref_info'), h('input', { name: 'ref_info', value: p.ref_info }), { name: 'ref_info', span: true }),
        h('div', { class: 'span-all submit-bar' }, h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, t('ai_save'))));
      form.elements.req_summary.value = p.req_summary;
      form.elements.reply_content.value = p.reply_content;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var res = L.addReply(db, refNo, fd(form), now());
        if (!res.ok) { showErrors(form, res.errors); return; }
        save(res.db); toast(t('ai_saved')); render();
      });
      if (p.missing.length) result.appendChild(h('div', { class: 'alert info' }, t('ai_missing', { list: p.missing.join(', ') })));
      result.appendChild(form);
    }
    return panel;
  }

  // 매뉴얼 근거 붙이기 — 접수 내용으로 검색 낱말을 만들고, 고른 쪽의 발췌를 프롬프트 끝에 붙입니다
  function groundingPanel(refNo, onChange) {
    var m = db.mains.filter(function (x) { return x.ref_no === refNo; })[0] || {};
    var box = h('div', { class: 'ground-box' }, h('h3', null, t('ground_title')));
    if (!manuals.length) {
      box.appendChild(h('p', { class: 'note' }, t('ground_none')));
      box.appendChild(h('a', { class: 'btn', href: '#/manual' }, t('manual_go')));
      return box;
    }
    var chosen = []; // [{ index, n }]
    var qInput = h('input', { name: 'ground_q', value: M.keywordsFromRequest(m, L.latestInquiry(db, refNo)) });
    var info = h('p', { class: 'note' });
    var list = h('ul', { class: 'result-list' });
    var picked = h('p', { class: 'note' });
    function update() {
      onChange(M.groundingBlock(chosen));
      picked.textContent = chosen.length ? t('ground_picked', { list: chosen.map(function (c) { return M.refLabel(c.index, c.n); }).join(', ') }) : '';
    }
    function run() {
      var r = M.search(manuals, qInput.value, { model: m.model, sources: db.sources, limit: 8 });
      list.textContent = '';
      info.textContent = r.terms.length ? t('ground_match_' + r.match, { model: m.model || '-' }) + ' ' + t('manual_found', { n: r.total }) : t('manual_need_words');
      r.results.forEach(function (x) {
        var ix = manuals.filter(function (y) { return y.file === x.file; })[0];
        var on = chosen.some(function (c) { return c.index === ix && c.n === x.n; });
        var cb = h('input', { type: 'checkbox', checked: on, 'aria-label': M.refLabel(ix, x.n) });
        cb.addEventListener('change', function () {
          chosen = chosen.filter(function (c) { return !(c.index === ix && c.n === x.n); });
          if (cb.checked) chosen.push({ index: ix, n: x.n });
          update();
        });
        list.appendChild(resultItem(ix, x, cb));
      });
    }
    qInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    append(box, [
      h('p', { class: 'note' }, t('ground_note')),
      h('div', { class: 'input-row' }, qInput, h('button', { class: 'btn', type: 'button', onclick: run }, t('search'))),
      info, list, picked
    ]);
    run();
    return box;
  }

  // 검색 결과 한 줄 (앞에 체크박스를 붙일 수 있음)
  function resultItem(ix, x, lead) {
    return h('li', null, lead || null,
      h('div', { class: 'result-body' },
        h('button', { type: 'button', class: 'link-btn', onclick: function () { showManualPage(ix, x.n); } },
          M.refLabel(ix, x.n) + ' · PDF ' + x.n + t('page_unit')),
        x.section ? h('span', { class: 'sub' }, x.section) : null,
        h('span', { class: 'snippet' }, x.snippet)));
  }

  // 쪽 본문 보기 — 이전/다음 쪽 이동. 매뉴얼 전체를 내보내는 기능은 두지 않습니다(발췌만)
  function showManualPage(ix, n) {
    var page = ix.pages.filter(function (p) { return p.n === n; })[0];
    if (!page) return;
    var i = ix.pages.indexOf(page);
    var sec = M.sectionOf(ix, n);
    var buttons = [];
    if (i > 0) buttons.push({ label: t('page_prev'), onClick: function () { showManualPage(ix, ix.pages[i - 1].n); } });
    if (i < ix.pages.length - 1) buttons.push({ label: t('page_next'), onClick: function () { showManualPage(ix, ix.pages[i + 1].n); } });
    buttons.push({ label: t('ref_copy'), onClick: function () { copyText(M.refLabel(ix, n)); } });
    buttons.push({ label: t('btn_close'), value: 'close', primary: true });
    dialog(M.refLabel(ix, n), [
      h('p', { class: 'note' }, (sec ? sec + ' · ' : '') + 'PDF ' + n + ' / ' + ix.pages.length + t('page_unit')),
      h('pre', { class: 'page-text' }, page.text || t('page_empty'))
    ], buttons);
  }

  // ── 매뉴얼 근거 검색 ──────────────────────────────────────
  var pdfjsPromise = null;
  // pdf.js 는 이 화면에서 필요할 때만 불러옵니다(약 1.4MB).
  // 로컬 파일(file://)로 열면 브라우저가 Worker 를 막으므로 worker 스크립트를 일반 스크립트로 먼저 읽어
  // 같은 화면(메인 스레드)에서 돌립니다. 웹 주소(http/https)에서는 별도 Worker 로 돌아 화면이 덜 멈춥니다.
  function loadPdfJs() {
    if (pdfjsPromise) return pdfjsPromise;
    function load(src) {
      return new Promise(function (resolve, reject) {
        var el = document.createElement('script');
        el.src = src; el.onload = resolve;
        el.onerror = function () { reject(new Error(src)); };
        document.head.appendChild(el);
      });
    }
    pdfjsPromise = load('vendor/pdfjs/pdf.min.js')
      .then(function () { return location.protocol === 'file:' ? load('vendor/pdfjs/pdf.worker.min.js') : null; })
      .then(function () {
        var lib = window.pdfjsLib;
        if (!lib) throw new Error('pdfjsLib');
        lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
        return lib;
      });
    pdfjsPromise.catch(function () { pdfjsPromise = null; });
    return pdfjsPromise;
  }
  // PDF 한 개 → 색인. onProgress(현재 쪽, 전체 쪽)
  function extractPdf(file, onProgress) {
    return loadPdfJs().then(function (lib) {
      return file.arrayBuffer().then(function (buf) {
        return lib.getDocument({ data: new Uint8Array(buf), disableFontFace: true, isEvalSupported: false }).promise;
      }).then(function (doc) {
        var pages = [];
        var n = doc.numPages;
        function next(i) {
          if (i > n) { doc.destroy(); return M.makeIndex({ file: file.name, created: L.toDateStr(now()) }, pages); }
          return doc.getPage(i).then(function (pg) {
            return pg.getTextContent().then(function (tc) {
              pages.push({ n: i, text: M.itemsToText(tc.items) });
              pg.cleanup();
              if (onProgress) onProgress(i, n);
              // 쪽마다 한 번씩 화면에 숨 쉴 틈을 줍니다(진행 표시가 갱신되도록)
              return new Promise(function (r) { setTimeout(r, 0); }).then(function () { return next(i + 1); });
            });
          });
        }
        return next(1);
      });
    });
  }
  function saveManual(ix) {
    localManuals = localManuals.filter(function (x) { return x.file !== ix.file; }).concat([ix]);
    mergeManuals();
    return MS.put(M.toStorable(ix));
  }

  // 서버에 등록된 매뉴얼 — 승인 회원만 읽을 수 있습니다(Storage 정책). 이 브라우저 메모리에만 둡니다.
  var serverManualPromise = null;
  function loadServerManuals(force) {
    if (!auth.user || !me()) return Promise.resolve();
    if (serverManualPromise && !force) return serverManualPromise;
    serverManualState = { status: 'loading', k: 0, n: 0, msg: '' };
    serverManualPromise = A.listManuals().then(function (objs) {
      serverManualState.n = objs.length;
      var out = [];
      var chain = Promise.resolve();
      objs.forEach(function (o) {
        chain = chain.then(function () {
          return A.downloadManual(o.name).then(function (txt) {
            var r = M.readIndexJson(txt);
            if (r.ok) { r.index._server = o.name; r.index._size = o.metadata && o.metadata.size; out.push(r.index); }
          }).catch(function () { /* 한 파일이 깨져도 나머지는 씁니다 */ })
            .then(function () { serverManualState.k++; if (/^#\/manual$/.test(location.hash)) updateServerStatus(); });
        });
      });
      return chain.then(function () {
        serverManuals = out; mergeManuals();
        serverManualState.status = 'ready';
      });
    }).catch(function (e) {
      serverManualState = { status: 'error', k: 0, n: 0, msg: String(e && e.message || e) };
      serverManualPromise = null;
    }).then(function () {
      if (/^#\/(manual|detail)/.test(location.hash)) render();
    });
    return serverManualPromise;
  }
  function serverStatusText() {
    var st = serverManualState;
    if (!auth.user || !me()) return t('manual_server_need');
    if (st.status === 'loading') return t('manual_server_loading', { k: st.k, n: st.n || '?' });
    if (st.status === 'error') return t('manual_server_fail', { msg: st.msg });
    if (st.status === 'ready' && !serverManuals.length) return t('manual_server_none');
    return t('manual_server_note');
  }
  function updateServerStatus() {
    var el = document.getElementById('serverManualStatus');
    if (el) el.textContent = serverStatusText();
  }

  var manualQuery = '', manualModel = '';
  function viewManual() {
    if (!guard()) return;
    main.appendChild(h('div', { class: 'page-head' },
      h('div', { style: 'margin-right:auto' }, h('h1', null, t('manual_title')), h('p', { class: 'note' }, t('manual_sub')))));
    // 서버에 등록된 매뉴얼(승인 회원) — 관리자는 「매뉴얼 등록」에서 올립니다
    main.appendChild(h('div', { class: 'card' },
      h('h2', null, t('manual_server_title')),
      h('p', { id: 'serverManualStatus', class: serverManualState.status === 'error' ? 'alert warn' : 'note', 'aria-live': 'polite' }, serverStatusText()),
      isServerAdmin() ? h('a', { class: 'btn', href: '#/manual-admin' }, t('nav_manual_admin')) : null));

    // 내 PC 에서 불러오기 (서버 매뉴얼이 없을 때의 대안)
    var status = h('p', { class: 'note', 'aria-live': 'polite' });
    var pdfInput = h('input', { type: 'file', accept: '.pdf,application/pdf', multiple: true });
    var jsonInput = h('input', { type: 'file', accept: '.json,application/json', multiple: true });
    pdfInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(pdfInput.files);
      if (!files.length) return;
      pdfInput.disabled = true;
      var chain = Promise.resolve();
      files.forEach(function (f, k) {
        chain = chain.then(function () {
          status.textContent = t('manual_reading', { name: f.name, i: 0, n: '?', k: k + 1, total: files.length });
          return extractPdf(f, function (i, n) {
            if (i === 1 || i % 5 === 0 || i === n) status.textContent = t('manual_reading', { name: f.name, i: i, n: n, k: k + 1, total: files.length });
          }).then(saveManual);
        });
      });
      chain.then(function () { toast(t('manual_loaded', { n: files.length })); render(); })
        .catch(function (err) {
          pdfInput.disabled = false;
          status.textContent = t('manual_pdf_fail', { msg: String(err && err.message || err) });
          status.className = 'alert warn';
        });
    });
    jsonInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(jsonInput.files);
      Promise.all(files.map(function (f) { return f.text().then(function (txt) { return { f: f, r: M.readIndexJson(txt) }; }); }))
        .then(function (rs) {
          var bad = rs.filter(function (x) { return !x.r.ok; });
          return Promise.all(rs.filter(function (x) { return x.r.ok; }).map(function (x) { return saveManual(x.r.index); }))
            .then(function () {
              render();
              if (bad.length) dialog(t('manual_json'), bad.map(function (x) { return h('p', { class: 'alert warn' }, x.f.name + ': ' + t('manual_json_' + x.r.code)); }));
              else toast(t('manual_loaded', { n: rs.length }));
            });
        });
    });
    main.appendChild(h('div', { class: 'card' },
      h('h2', null, t('manual_local_title')),
      h('p', { class: 'alert info' }, t('manual_privacy')),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('span', null, t('manual_pdf')), pdfInput, h('small', { class: 'note' }, t('manual_pdf_note'))),
        h('div', { class: 'field' }, h('span', null, t('manual_json')), jsonInput, h('small', { class: 'note' }, t('manual_json_note')))),
      status,
      MS.isPersistent() === false ? h('p', { class: 'alert warn' }, t('manual_memory_only')) : null));

    if (!manuals.length) { main.appendChild(h('div', { class: 'card' }, h('p', null, t('manual_empty')))); return; }

    // 불러온 매뉴얼 — 적용 모델은 고칠 수 있습니다(요청 모델과 맞춰 검색 대상을 고름)
    var rows = manuals.map(function (ix) {
      var models = h('input', { value: ix.models || '', 'aria-label': t('manual_models') + ' — ' + ix.file, readonly: !!ix._server });
      if (!ix._server) models.addEventListener('change', function () { ix.models = models.value.trim(); saveManual(ix); toast(t('manual_models_saved')); });
      var toc = (ix.toc && ix.toc.entries) || [];
      // 소스 등록(모델 ↔ 매뉴얼 대응표)에서 이 파일에 연결된 모델
      var linked = db.sources.filter(function (sv) { return M.manualsBySource([ix], db.sources, sv.model).length; })
        .map(function (sv) { return sv.model; });
      return h('div', { class: 'manual-item' },
        h('div', { class: 'manual-head' },
          h('span', { class: 'status ' + (ix._server ? 'blue' : 'black') }, t(ix._server ? 'manual_badge_server' : 'manual_badge_local')),
          h('strong', null, ix.title), h('span', { class: 'sub' }, (ix.kind ? kindLabel(ix.kind) + ' · ' : '') + ix.pages.length + t('page_unit') + ' · ' + t('manual_toc_count', { n: toc.length })),
          ix._server ? null : h('button', { class: 'btn btn-danger', type: 'button', onclick: function () {
            dialog(t('manual_remove'), h('p', null, t('manual_remove_confirm', { name: ix.title })), [
              { label: t('btn_close'), value: 'close' },
              { label: t('manual_remove'), primary: true, onClick: function () { localManuals = localManuals.filter(function (x) { return x !== ix; }); mergeManuals(); MS.remove(ix.file); render(); } }]);
          } }, t('manual_remove'))),
        h('p', { class: linked.length ? 'note' : 'alert warn' }, linked.length ? t('manual_linked', { list: linked.join(', ') }) : t('manual_not_linked')),
        h('label', { class: 'field' }, h('span', null, t('manual_models')), models, h('small', { class: 'note' }, t('manual_models_note'))),
        toc.length ? h('details', { class: 'toc' }, h('summary', null, t('manual_toc')),
          h('ul', null, toc.map(function (e) {
            return h('li', { class: e.level === 1 ? 'toc-1' : 'toc-2' },
              e.page ? h('button', { type: 'button', class: 'link-btn', onclick: function () { showManualPage(ix, e.page); } }, e.title) : h('span', null, e.title),
              e.label ? h('span', { class: 'sub' }, ' ' + e.label) : null);
          }))) : h('p', { class: 'note' }, t('manual_no_toc')));
    });
    main.appendChild(h('div', { class: 'card' }, h('h2', null, t('manual_list', { n: manuals.length })), rows));

    // 검색
    var q = h('input', { name: 'q', value: manualQuery, placeholder: 'error code 219 stepper' });
    var mdl = h('input', { name: 'model', value: manualModel, list: 'modelList3', placeholder: '30BRP-X' });
    var out = h('div');
    function run() {
      manualQuery = q.value; manualModel = mdl.value;
      out.textContent = '';
      var r = M.search(manuals, q.value, { model: mdl.value.trim(), sources: db.sources, limit: 20 });
      if (!r.terms.length) { out.appendChild(h('p', { class: 'note' }, t('manual_need_words'))); return; }
      out.appendChild(h('p', { class: 'note' }, (mdl.value.trim() ? t('ground_match_' + r.match, { model: mdl.value.trim() }) + ' ' : '') + t('manual_found', { n: r.total })));
      out.appendChild(h('ul', { class: 'result-list' }, r.results.map(function (x) {
        return resultItem(manuals.filter(function (y) { return y.file === x.file; })[0], x);
      })));
    }
    var form = h('form', { class: 'card', novalidate: true },
      h('h2', null, t('manual_search')),
      h('p', { class: 'note' }, t('manual_search_note')),
      h('div', { class: 'form-grid' },
        field(t('manual_words'), q, { span: false }),
        field(t('f_model'), mdl)),
      h('datalist', { id: 'modelList3' }, db.sources.map(function (s) { return h('option', { value: s.model }); })),
      h('div', { class: 'btn-row', style: 'margin-top:10px' }, h('button', { class: 'btn btn-primary', type: 'submit' }, t('search'))),
      out);
    form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
    main.appendChild(form);
    if (manualQuery) run();
  }

  // ── 매뉴얼 등록 (서버 관리자) ─────────────────────────────────
  // 수강생이 받은 매뉴얼을 승인 회원이 쓰도록 올립니다. 원문 PDF 는 올리지 않고 쪽별 텍스트 색인(JSON)을
  // 압축해 비공개 버킷(data0901-manuals)에 둡니다. 읽기 = 승인 회원, 쓰기 = 관리자(서버 정책).
  var mregList = null, mregError = '';
  function viewManualAdmin() {
    if (!guard(true)) return;
    if (!auth.user) { main.appendChild(h('div', { class: 'card' }, h('p', null, t('manual_server_need')))); return; }
    main.appendChild(h('div', { class: 'page-head' },
      h('div', { style: 'margin-right:auto' }, h('h1', null, t('mreg_title')), h('p', { class: 'note' }, t('mreg_sub')))));
    var status = h('p', { class: 'note', 'aria-live': 'polite' });
    var picked = h('p', { class: 'mreg-picked', id: 'mregPicked', 'aria-live': 'polite' });
    var jsonInput = h('input', { type: 'file', accept: '.json,application/json', multiple: true });
    var pdfInput = h('input', { type: 'file', accept: '.pdf,application/pdf', multiple: true });
    function finish(done, fails, total) {
      serverManualPromise = null; loadServerManuals(true);
      // 목록을 먼저 받아 두고 결과 대화상자를 띄웁니다 — 목록을 받은 뒤 다시 그리면 열린 대화상자가 닫히기 때문
      A.listManuals().then(function (objs) { mregList = objs; mregError = ''; }, function (e) { mregList = null; mregError = String(e && e.message || e); })
        .then(function () {
          afterRender = { title: t('mreg_title'), body: [t('mreg_done', { n: done, total: total })].concat(fails).join('\n') };
          if (location.hash === '#/manual-admin') render();
        });
    }
    function uploadAll(items, readOne) {
      jsonInput.disabled = pdfInput.disabled = true;
      picked.textContent = t('mreg_selected', { n: items.length });
      var done = 0, fails = [], chain = Promise.resolve();
      items.forEach(function (f, k) {
        chain = chain.then(function () {
          status.textContent = t('mreg_uploading', { k: k + 1, total: items.length, name: f.name });
          return readOne(f, function (i, n) {
            if (i === 1 || i % 10 === 0 || i === n) status.textContent = t('manual_reading', { name: f.name, i: i, n: n, k: k + 1, total: items.length });
          }).then(function (obj) { return A.uploadManual(obj); })
            .then(function () { done++; })
            .catch(function (e) { fails.push(t('mreg_fail', { name: f.name, msg: String(e && e.message || e) })); });
        });
      });
      chain.then(function () { finish(done, fails, items.length); });
    }
    jsonInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(jsonInput.files);
      if (!files.length) return;
      uploadAll(files, function (f) {
        return f.text().then(function (txt) {
          var r = M.readIndexJson(txt);
          if (!r.ok) throw new Error(t('manual_json_' + r.code));
          return M.toStorable(r.index);
        });
      });
    });
    pdfInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(pdfInput.files);
      if (!files.length) return;
      uploadAll(files, function (f, progress) { return extractPdf(f, progress).then(M.toStorable); });
    });
    main.appendChild(h('div', { class: 'card' },
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('span', null, t('mreg_json')), jsonInput, h('small', { class: 'note' }, t('mreg_json_note'))),
        h('div', { class: 'field' }, h('span', null, t('mreg_pdf')), pdfInput, h('small', { class: 'note' }, t('mreg_pdf_note')))),
      typeof window.CompressionStream !== 'function' ? h('p', { class: 'alert warn' }, t('mreg_no_gzip')) : null,
      picked, status,
      h('p', { class: 'note' }, t('mreg_originals_hint'), ' ', h('a', { href: '#/originals' }, t('nav_originals')))));

    var listCard = h('div', { class: 'card' });
    main.appendChild(listCard);
    if (mregError) listCard.appendChild(h('p', { class: 'alert warn' }, t('auth_error', { msg: mregError })));
    if (!mregList) {
      listCard.appendChild(h('p', { class: 'note' }, t('mreg_loading')));
      A.listManuals().then(function (objs) { mregList = objs; mregError = ''; })
        .catch(function (e) { mregList = []; mregError = String(e && e.message || e); })
        .then(function () { if (location.hash === '#/manual-admin') render(); });
      return;
    }
    listCard.appendChild(h('h2', null, t('mreg_list', { n: mregList.length })));
    if (!mregList.length) { listCard.appendChild(h('p', { class: 'note' }, t('mreg_empty'))); return; }
    listCard.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('tbody', null, mregList.map(function (o) {
        var size = o.metadata && o.metadata.size ? Math.round(o.metadata.size / 1024) + ' KB' : '';
        return h('tr', null,
          h('td', null, o.name), h('td', { class: 'nowrap' }, size),
          h('td', { class: 'nowrap' }, String(o.updated_at || o.created_at || '').slice(0, 10)),
          h('td', null, h('button', { class: 'btn btn-danger', type: 'button', onclick: function () {
            dialog(t('manual_remove'), h('p', null, t('mreg_remove_confirm', { name: o.name })), [
              { label: t('btn_close'), value: 'close' },
              { label: t('manual_remove'), primary: true, onClick: function () {
                A.removeManual(o.name).then(function () { mregList = null; loadServerManuals(true); render(); })
                  .catch(function (e) { toast(t('auth_error', { msg: String(e && e.message || e) }), true); });
              } }]);
          } }, t('manual_remove'))));
      })))));
  }

  // ── 제공 자료 (원본) ─────────────────────────────────────────
  // 수강생이 준 원본 파일(기획서·DB 엑셀·화면구성·매뉴얼 PDF 등)을 비공개 버킷 originals/ 에 둡니다.
  // 승인 회원 = 목록·내려받기(10분짜리 서명 주소), 관리자 = 올리기·지우기. 권한은 서버 정책이 막습니다.
  var origList = null, origError = '';
  function viewOriginals() {
    if (!guard()) return;
    main.appendChild(h('div', { class: 'page-head' },
      h('div', { style: 'margin-right:auto' }, h('h1', null, t('orig_title')), h('p', { class: 'note' }, t('orig_sub')))));
    if (!auth.user) { main.appendChild(h('div', { class: 'card' }, h('p', null, t('orig_need_server')))); return; }

    if (isServerAdmin()) {
      var picked = h('p', { class: 'mreg-picked', id: 'origPicked', 'aria-live': 'polite' });
      var status = h('p', { class: 'note', 'aria-live': 'polite' });
      var noteInput = h('input', { type: 'text', name: 'orig_note', maxlength: '80', placeholder: t('orig_note_ph') });
      var fileInput = h('input', { type: 'file', id: 'origFiles', multiple: true });
      fileInput.addEventListener('change', function () {
        var files = Array.prototype.slice.call(fileInput.files);
        if (!files.length) return;
        var total = files.reduce(function (a, f) { return a + (f.size || 0); }, 0);
        picked.textContent = t('orig_selected', { n: files.length, size: O.fmtSize(total) });
        fileInput.disabled = noteInput.disabled = true;
        A.uploadOriginals(files, noteInput.value.trim(), function (k, n, f) {
          status.textContent = t('orig_uploading', { k: k, total: n, name: f.name });
        }).then(function (r) {
          // 목록을 먼저 받아 두고 결과 대화상자를 띄웁니다(목록을 받은 뒤 다시 그리면 대화상자가 닫힘)
          return A.listOriginals().then(function (rows) { origList = rows; origError = ''; }, function (e) { origList = null; origError = String(e && e.message || e); })
            .then(function () {
              afterRender = { title: t('orig_title'), body: [t('orig_done', { n: r.done.length, total: files.length })]
                .concat(r.fails.map(function (x) { return t('orig_fail', { name: x.name, msg: x.msg }); })).join('\n') };
              if (location.hash === '#/originals') render();
            });
        }).catch(function (e) {
          fileInput.disabled = noteInput.disabled = false;
          status.textContent = t('auth_error', { msg: String(e && e.message || e) });
        });
      });
      main.appendChild(h('div', { class: 'card' },
        h('h2', null, t('orig_upload')),
        h('div', { class: 'form-grid' },
          h('div', { class: 'field' }, h('span', null, t('orig_files')), fileInput, h('small', { class: 'note' }, t('orig_files_note'))),
          h('label', { class: 'field' }, h('span', null, t('orig_note')), noteInput)),
        picked, status));
    }

    var listCard = h('div', { class: 'card', id: 'origListCard' });
    main.appendChild(listCard);
    if (origError) listCard.appendChild(h('p', { class: 'alert warn' }, t('auth_error', { msg: origError })));
    if (!origList) {
      listCard.appendChild(h('p', { class: 'note' }, t('orig_loading')));
      A.listOriginals().then(function (rows) { origList = rows; origError = ''; })
        .catch(function (e) { origList = []; origError = String(e && e.message || e); })
        .then(function () { if (location.hash === '#/originals') render(); });
      return;
    }
    var totalSize = origList.reduce(function (a, x) { return a + (x.size || 0); }, 0);
    listCard.appendChild(h('h2', null, t('orig_list', { n: origList.length, size: O.fmtSize(totalSize) })));
    if (!origList.length) { listCard.appendChild(h('p', { class: 'note' }, t('orig_empty'))); return; }
    listCard.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, t('orig_col_name')), h('th', null, t('orig_note')),
        h('th', null, t('orig_col_size')), h('th', null, t('orig_col_date')), h('th', null, ''))),
      h('tbody', null, origList.map(function (o) {
        return h('tr', null,
          h('td', null, o.name), h('td', null, o.note), h('td', { class: 'nowrap' }, O.fmtSize(o.size)),
          h('td', { class: 'nowrap' }, o.updated),
          h('td', { class: 'nowrap' },
            h('button', { class: 'btn', type: 'button', onclick: function (ev) {
              var btn = ev.currentTarget; btn.disabled = true;
              A.originalUrl(o.key, o.name).then(function (url) { window.location.assign(url); })
                .catch(function (e) { toast(t('auth_error', { msg: String(e && e.message || e) }), true); })
                .then(function () { btn.disabled = false; });
            } }, t('orig_download')),
            isServerAdmin() ? h('button', { class: 'btn btn-danger', type: 'button', onclick: function () {
              dialog(t('manual_remove'), h('p', null, t('orig_remove_confirm', { name: o.name })), [
                { label: t('btn_close'), value: 'close' },
                { label: t('manual_remove'), primary: true, onClick: function () {
                  A.removeOriginal(o.key).then(function () { origList = null; render(); })
                    .catch(function (e) { toast(t('auth_error', { msg: String(e && e.message || e) }), true); });
                } }]);
            } }, t('manual_remove')) : null));
      })))));
  }

  // ── 회원 관리 (Admin) — 가입 승인·권한·관리 지역 ─────────────────
  // 서버 로그인 관리자: 구글·카카오로 가입한 회원(data0901_profiles). 예시 데이터 시연: 이 브라우저의 예시 계정.
  var membersCache = null, membersError = '';
  function loadMembers(rerender) {
    return A.listMembers().then(function (rows) {
      membersCache = rows; membersError = '';
      rows.forEach(function (p) { upsertLocalUser(P.toLocalUser(p, false)); }); // PS 메일 받는 사람 고르기에 씀
      save();
    }).catch(function (e) { membersError = String(e && e.message || e); })
      .then(function () { if (rerender !== false && /^#\/(members|list|request|detail|mails)/.test(location.hash || '')) render(); else renderHeader(currentRoute()); });
  }
  function viewMembers() {
    if (!guard(true)) return;
    if (auth.user) viewMembersServer(); else viewMembersLocal();
  }
  function territoryChecks(selected) {
    var mine = L.listTerritories(selected);
    return L.TERRITORY_CD.map(function (c) {
      return h('label', { class: 'check' }, h('input', { type: 'checkbox', value: c, checked: mine.indexOf(c) !== -1 }), terrLabel(c));
    });
  }
  function viewMembersServer() {
    main.appendChild(h('div', { class: 'page-head' },
      h('div', { style: 'margin-right:auto' }, h('h1', null, t('members_title')),
        h('p', { class: 'note' }, t('members_sub', { n: (membersCache || []).filter(function (x) { return x.approval === 'Pending'; }).length }))),
      h('button', { class: 'btn', type: 'button', onclick: function () { membersCache = null; render(); } }, t('btn_refresh'))));
    main.appendChild(h('p', { class: 'note' }, t('members_server_note')));
    if (membersError) main.appendChild(h('div', { class: 'alert warn' }, t('auth_error', { msg: membersError })));
    if (!membersCache) { main.appendChild(h('div', { class: 'card' }, h('p', { class: 'note' }, t('members_loading')))); loadMembers(true); return; }
    var order = { Pending: 0, Approved: 1, Rejected: 2 };
    var rows = membersCache.slice().sort(function (a, b) {
      return order[a.approval] - order[b.approval] || (a.created_at < b.created_at ? 1 : -1);
    });
    if (!rows.length) { main.appendChild(h('div', { class: 'card' }, t('members_empty'))); return; }
    function apply(p, change) {
      A.updateMember(p.user_id, change).then(function (row) {
        membersCache = membersCache.map(function (x) { return x.user_id === row.user_id ? row : x; });
        upsertLocalUser(P.toLocalUser(row, false)); save();
        toast(t('member_updated', { id: row.reg_id })); render();
      }).catch(function (e) { toast(t('auth_error', { msg: String(e && e.message || e) }), true); });
    }
    append(main, rows.map(function (p) {
      var self = p.user_id === auth.user.id;
      var typeSel = codeSelect('user_type', L.USER_TYPE, p.role || 'USER');
      typeSel.id = 'type_' + p.user_id;
      var boxes = territoryChecks(p.manage_territory);
      var terrWrap = h('fieldset', { class: 'territory-set', hidden: p.role !== 'ADMIN' },
        h('legend', null, t('f_manage_territory')), h('div', { class: 'checks' }, boxes),
        h('small', { class: 'note' }, t('manage_territory_note')));
      typeSel.addEventListener('change', function () { terrWrap.hidden = typeSel.value !== 'ADMIN'; });
      var reqTerr = h('select', { name: 'territory_cd' }, h('option', { value: '' }, '-'),
        L.TERRITORY_CD.map(function (c) { return h('option', { value: c, selected: c === p.territory_cd }, terrLabel(c)); }));
      function picked() { return boxes.map(function (b) { return b.querySelector('input'); }).filter(function (x) { return x.checked; }).map(function (x) { return x.value; }).join('; '); }
      function settings() {
        var role = typeSel.value;
        return { role: role, manage_territory: role === 'ADMIN' ? picked() : '', territory_cd: reqTerr.value };
      }
      var actions = h('div', { class: 'btn-row' });
      if (p.approval !== 'Approved') actions.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { apply(p, Object.assign({ approval: 'Approved' }, settings())); } }, t('member_approve')));
      if (p.approval === 'Pending') actions.appendChild(h('button', { class: 'btn btn-danger', type: 'button', onclick: function () { apply(p, { approval: 'Rejected' }); } }, t('member_reject')));
      if (p.approval === 'Approved') {
        actions.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: function () {
          var ch = settings(); if (self) { delete ch.role; ch.manage_territory = picked(); }
          apply(p, ch);
        } }, t('member_save_settings')));
        if (!self) actions.appendChild(h('button', { class: 'btn', type: 'button', onclick: function () { apply(p, { approval: 'Rejected' }); } }, t('member_suspend')));
      }
      if (self) typeSel.disabled = true; // 자기 권한은 스스로 내릴 수 없습니다(서버에서도 막음)
      return h('div', { class: 'card member-card' },
        h('div', { class: 'member-head' },
          h('span', { class: 'status ' + (p.approval === 'Approved' ? 'blue' : p.approval === 'Pending' ? 'red' : 'black') }, t('approval_' + p.approval)),
          h('strong', null, p.name + ' · ' + p.reg_id + (self ? ' (' + t('member_self') + ')' : '')),
          h('span', { class: 'sub' }, [
            p.is_dealer ? t('dealer_yes') + (p.dealer_name ? ' · ' + p.dealer_name : '') : t('dealer_no'),
            P.countryName(p.country_cd, lang) + ' / ' + p.region, p.phone, p.e_mail,
            t('member_joined', { date: L.displayDate(String(p.created_at || '').slice(0, 10)) })
          ].join(' · ')),
          p.approved_at ? h('span', { class: 'sub' }, t('member_approved_by', { by: p.approved_by === auth.user.id ? t('member_self') : ((membersCache.filter(function (x) { return x.user_id === p.approved_by; })[0] || {}).name || '-'), date: L.displayDate(String(p.approved_at).slice(0, 10)) })) : null),
        h('div', { class: 'form-grid' }, field(t('f_user_type'), typeSel),
          field(t('f_req_territory'), reqTerr, { hint: t('req_territory_note') })),
        terrWrap, actions);
    }));
  }

  // 예시 데이터 시연: 이 브라우저의 예시 계정 승인·권한
  function viewMembersLocal() {
    var admin = me();
    var order = { Pending: 0, Approved: 1, Rejected: 2 };
    var users = db.users.slice().sort(function (a, b) {
      return order[L.approvalOf(a)] - order[L.approvalOf(b)] || (a.join_date < b.join_date ? 1 : -1);
    });
    function apply(u, change) {
      var res = L.updateMember(db, u.reg_id, change, admin, now());
      if (!res.ok) { toast(t('err_' + res.errors[0].code), true); return; }
      save(res.db); toast(t('member_updated', { id: u.reg_id })); render();
    }
    var cards = users.map(function (u) {
      var ap = L.approvalOf(u);
      var typeSel = codeSelect('user_type', L.USER_TYPE, u.user_type || 'USER');
      typeSel.id = 'type_' + u.reg_id;
      var mine = L.listTerritories(u.manage_territory);
      var boxes = L.TERRITORY_CD.map(function (c) {
        return h('label', { class: 'check' }, h('input', { type: 'checkbox', value: c, checked: mine.indexOf(c) !== -1 }), terrLabel(c));
      });
      var terrWrap = h('fieldset', { class: 'territory-set', hidden: (u.user_type || 'USER') !== 'ADMIN' },
        h('legend', null, t('f_manage_territory')), h('div', { class: 'checks' }, boxes),
        h('small', { class: 'note' }, t('manage_territory_note')));
      typeSel.addEventListener('change', function () { terrWrap.hidden = typeSel.value !== 'ADMIN'; });
      function picked() { return boxes.map(function (b) { return b.querySelector('input'); }).filter(function (x) { return x.checked; }).map(function (x) { return x.value; }); }
      var actions = h('div', { class: 'btn-row' });
      if (ap !== 'Approved') actions.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { apply(u, { approval: 'Approved', user_type: typeSel.value, manage_territory: picked() }); } }, t('member_approve')));
      if (ap === 'Pending') actions.appendChild(h('button', { class: 'btn btn-danger', type: 'button', onclick: function () { apply(u, { approval: 'Rejected' }); } }, t('member_reject')));
      if (ap === 'Approved') {
        actions.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { apply(u, { user_type: typeSel.value, manage_territory: picked() }); } }, t('member_save_settings')));
        if (u.reg_id !== admin.reg_id) actions.appendChild(h('button', { class: 'btn', type: 'button', onclick: function () { apply(u, { approval: 'Rejected' }); } }, t('member_suspend')));
      }
      return h('div', { class: 'card member-card' },
        h('div', { class: 'member-head' },
          h('span', { class: 'status ' + (ap === 'Approved' ? 'blue' : ap === 'Pending' ? 'red' : 'black') }, t('approval_' + ap)),
          h('strong', null, u.req_name + ' · ' + u.reg_id),
          h('span', { class: 'sub' }, [u.dealer, terrLabel(u.territory_cd), u.e_mail, t('member_joined', { date: L.displayDate(u.join_date) })].filter(Boolean).join(' · ')),
          u.approved_by ? h('span', { class: 'sub' }, t('member_approved_by', { by: u.approved_by, date: L.displayDate(u.approved_date) })) : null),
        h('div', { class: 'form-grid' }, field(t('f_user_type'), typeSel)),
        terrWrap, actions);
    });
    var pending = users.filter(function (u) { return L.approvalOf(u) === 'Pending'; }).length;
    main.appendChild(h('div', { class: 'page-head' },
      h('div', { style: 'margin-right:auto' }, h('h1', null, t('members_title')), h('p', { class: 'note' }, t('members_sub', { n: pending })))));
    append(main, cards.length ? cards : h('div', { class: 'card' }, t('members_empty')));
  }

  // ── PS 메일 발송 대기 (Admin) ───────────────────────────────
  // 정적 웹이라 메일을 직접 보내지 않습니다. 메일 앱을 열어(mailto) 담당자가 보내고 「보냄」으로 표시합니다.
  function mailCard(mail, compact) {
    var to = Array.isArray(mail.to) ? mail.to : L.splitList(mail.mail_to || mail.to);
    var rc = mail.ref_no ? L.psRecipients(db, mail.ref_no) : null;
    var sent = mail.status === 'Sent';
    return h('div', { class: compact ? 'mail-card' : 'card mail-card' },
      h('div', { class: 'member-head' },
        h('span', { class: 'status ' + (sent ? 'black' : 'red') }, t(sent ? 'mail_sent' : 'mail_pending')),
        h('strong', null, (mail.mail_id ? mail.mail_id + ' · ' : '') + t('mail_reason_' + mail.reason)),
        mail.ref_no ? h('a', { href: '#/detail/' + mail.ref_no }, mail.ref_no) : null,
        mail.created_date ? h('span', { class: 'sub' }, mail.created_date + (mail.sent_date ? ' → ' + mail.sent_date : '')) : null),
      h('p', null, h('span', { class: 'label' }, t('mail_to') + ': '), to.length ? to.join(', ') : t('mail_no_admin')),
      rc ? h('p', { class: 'note' }, rc.fallback ? t('mail_fallback', { territory: rc.territory || '-' }) : t('mail_routed', { territory: rc.territory })) : null,
      h('pre', { class: 'prompt-box' }, mail.subject + '\n\n' + mail.body),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn btn-primary', href: L.mailtoHref(mail) }, t('ps_mailto')),
        h('button', { class: 'btn', type: 'button', onclick: function () { copyText((to.length ? t('mail_to') + ': ' + to.join(', ') + '\n' : '') + mail.subject + '\n\n' + mail.body); } }, t('ps_copy')),
        !sent && mail.mail_id ? h('button', { class: 'btn', type: 'button', onclick: function () {
          var r = L.markMailSent(db, mail.mail_id, now());
          if (r.ok) { save(r.db); toast(t('mail_marked')); render(); }
        } }, t('mail_mark_sent')) : null,
        compact ? h('a', { class: 'btn', href: '#/mails' }, t('nav_mails')) : null));
  }
  function viewMails() {
    if (!guard(true)) return;
    var mails = (db.mails || []).slice().sort(function (a, b) {
      return (a.status === b.status ? 0 : a.status === 'Pending' ? -1 : 1) || (a.mail_id < b.mail_id ? 1 : -1);
    });
    main.appendChild(h('div', { class: 'page-head' },
      h('div', { style: 'margin-right:auto' }, h('h1', null, t('mails_title')), h('p', { class: 'note' }, t('mails_sub')))));
    main.appendChild(h('div', { class: 'alert info' }, t('mails_why')));
    append(main, mails.length ? mails.map(function (m) { return mailCard(m, false); }) : h('div', { class: 'card' }, t('mails_empty')));
  }

  // ── 소스등록 ─────────────────────────────────────────────
  function viewSources(refNo) {
    if (!guard(true)) return;
    var pre = {};
    if (refNo) {
      var m = db.mains.filter(function (x) { return x.ref_no === refNo; })[0];
      if (m) { var s = L.findSource(db.sources, m.model); pre = { model: m.model, notebook_name: s ? s.notebook_name : '' }; }
    }
    var fileInput = h('input', { type: 'file', name: 'files', multiple: true, accept: '.pdf,.txt,.doc,.docx,.xlsx,image/*' });
    var form = h('form', { class: 'card form-grid', novalidate: true },
      refNo ? h('div', { class: 'span-all mode-note' }, t('src_from_detail') + ' (' + refNo + ')') : null,
      field(t('f_model'), h('input', { name: 'model', maxlength: 20, value: pre.model || '' }), { name: 'model' }),
      field(t('f_notebook'), h('input', { name: 'notebook_name', value: pre.notebook_name || '' }), { name: 'notebook_name' }),
      h('div', { class: 'field span-all' }, h('span', null, t('f_files')), fileInput, h('small', { class: 'note' }, t('src_note'))),
      h('div', { class: 'span-all submit-bar' }, h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, t('src_save'))));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = fd(form);
      v.files = Array.prototype.map.call(fileInput.files, function (f) { return f.name; }).join('; ');
      var res = L.upsertSource(db, v);
      if (!res.ok) { showErrors(form, res.errors); return; }
      save(res.db); toast(res.updated ? t('src_updated') : t('src_saved')); go('#/sources');
    });
    var list = db.sources.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, [t('f_model'), t('f_notebook'), t('f_files'), ''].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, db.sources.map(function (s, i) {
        return h('tr', null, h('td', { class: 'nowrap' }, s.model), h('td', null, s.notebook_name),
          h('td', null, L.splitList(s.files).join(', ')),
          h('td', null, h('button', { class: 'btn btn-danger', type: 'button', onclick: function () {
            dialog(t('src_delete'), h('p', null, t('src_delete_confirm', { model: s.model })), [
              { label: t('btn_close'), value: 'close' },
              { label: t('src_delete'), primary: true, onClick: function () { db.sources.splice(i, 1); save(); render(); } }]);
          } }, t('src_delete'))));
      })))) : h('p', { class: 'note' }, t('src_empty'));
    // 모델 ↔ 매뉴얼 대응표 엑셀(Manual Medel Name.xlsx 형식: model · notebook_name · 파일명) 한꺼번에 등록 — 2026-09-29 오후
    var mapInput = h('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
    mapInput.addEventListener('change', function () {
      var f = mapInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
          var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
          var r = M.sourcesFromRows(rows);
          if (r.problem) { toast(t('src_map_' + r.problem), true); return; }
          var added = 0, updated = 0, cur = db;
          r.rows.forEach(function (row) {
            var u = L.upsertSource(cur, row);
            if (u.ok) { cur = u.db; if (u.updated) updated++; else added++; }
          });
          save(cur);
          afterRender = { title: t('src_map_title'), body: t('src_map_done', { added: added, updated: updated }) };
          render();
        } catch (err) { toast(String(err && err.message || err), true); }
      };
      reader.readAsArrayBuffer(f);
    });
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, t('src_title'))));
    main.appendChild(h('div', { class: 'card' }, h('h2', null, t('src_map_title')), h('p', { class: 'note' }, t('src_map_note')), mapInput));
    main.appendChild(form);
    main.appendChild(h('h2', null, t('src_list')));
    main.appendChild(list);
  }

  // ── 접속Log ─────────────────────────────────────────────
  var logFilter = null;
  function viewLogs() {
    if (!guard(true)) return;
    var f = logFilter || { from: '', to: '', user: '', dealer: '' };
    var dealers = db.users.map(function (x) { return x.dealer; }).filter(function (d, i, a) { return d && a.indexOf(d) === i; });
    var form = h('form', { class: 'card filters' },
      field(t('from'), h('input', { type: 'date', name: 'from', value: f.from })),
      field(t('to'), h('input', { type: 'date', name: 'to', value: f.to })),
      field(t('log_user'), h('input', { name: 'user', value: f.user })),
      field(t('f_dealer'), codeSelect('dealer', dealers, f.dealer)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'submit' }, t('search')),
        h('button', { class: 'btn', type: 'button', onclick: function () { logFilter = null; render(); } }, t('reset'))));
    form.querySelectorAll('select option[value=""]').forEach(function (o) { o.textContent = t('all'); });
    form.addEventListener('submit', function (e) { e.preventDefault(); logFilter = fd(form); render(); });
    var rows = L.buildLogRows(db, f);
    var cols = [['req_name', 'f_req_name'], ['reg_id', 'f_reg_id'], ['country_cd', 'f_country'], ['dealer', 'f_dealer'],
      ['login_date', 'f_login'], ['logout_date', 'f_logout'], ['minutes', 'f_duration']];
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, t('log_title'))));
    main.appendChild(form);
    main.appendChild(h('div', { class: 'list-meta' }, h('strong', null, rows.length + ' ' + t('rows'))));
    main.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, cols.map(function (c) { return h('th', null, t(c[1])); }))),
      h('tbody', null, rows.map(function (r) {
        return h('tr', null, cols.map(function (c) {
          var v = c[0] === 'minutes' ? (r.logout_date ? L.formatDuration(r.minutes, lang) : t('log_open')) : r[c[0]];
          return h('td', { class: 'nowrap' }, String(v == null ? '' : v));
        }));
      })))));
  }

  // ── 데이터 관리 ─────────────────────────────────────────
  function viewData() {
    var counts = {};
    Object.keys(L.emptyDb()).forEach(function (k) { counts[k] = db[k].length; });
    var fileInput = h('input', { type: 'file', accept: '.xlsx,.xls' });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var wb = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: true });
          var sheets = {};
          wb.SheetNames.forEach(function (n) {
            sheets[n.trim()] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
          });
          var res = L.sheetsToDb(sheets);
          db = res.db;
          if (/예시/.test(f.name)) db._sample = true;
          S.setSession(null);
          save();
          var msg = t('data_imported', { list: res.report.read.join(', ') || '-' });
          render(); // render 가 대화상자를 닫으므로 결과 안내보다 먼저 그립니다
          dialog(t('data_import'), [h('p', null, msg)].concat(res.report.problems.map(function (p) { return h('p', { class: 'alert warn' }, p); })));
        } catch (err) { toast(String(err && err.message || err), true); }
      };
      reader.readAsArrayBuffer(f);
    });
    function exportXlsx() {
      var sheets = L.dbToSheets(db);
      var wb = XLSX.utils.book_new();
      Object.keys(sheets).forEach(function (n) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[n]), n); });
      var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      // 시트 이름·머리행은 가져오기와 짝이 맞아야 하므로 언어와 무관하게 DB 필드명 그대로 둡니다
      download(t('file_db') + '_' + L.toDateStr(now()) + (db._sample ? '_' + t('file_sample') : '') + '.xlsx',
        new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    }
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, t('data_title'))));
    if (!S.available()) main.appendChild(h('div', { class: 'alert warn' }, t('storage_fail')));
    main.appendChild(h('div', { class: 'card' },
      h('p', null, t('data_note')),
      h('p', null, h('strong', null, t('data_counts', counts)), db._sample ? h('span', { class: 'status black', style: 'margin-left:8px' }, t('sample_badge')) : null),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { loadSample(false); } }, t('load_sample')),
        h('button', { class: 'btn', type: 'button', onclick: exportXlsx }, t('data_export')))));
    main.appendChild(h('div', { class: 'card' },
      h('h2', null, t('data_import')), h('p', { class: 'note' }, t('data_import_note')), fileInput));
    main.appendChild(h('div', { class: 'card' },
      h('button', { class: 'btn btn-danger', type: 'button', onclick: function () {
        dialog(t('data_clear'), h('p', null, t('data_clear_confirm')), [
          { label: t('btn_close'), value: 'close' },
          { label: t('data_clear'), primary: true, onClick: function () { S.clearDb(); db = L.emptyDb(); toast(t('data_cleared')); go('#/login'); } }]);
      } }, t('data_clear'))));
  }

  // ── 라우터 ──────────────────────────────────────────────
  function currentRoute() { return (location.hash.replace(/^#\/?/, '') || (me() ? 'request' : 'login')).split('/')[0]; }
  function render() {
    var parts = (location.hash.replace(/^#\/?/, '') || (me() ? 'request' : 'login')).split('/');
    var route = parts[0], arg = parts[1] ? decodeURIComponent(parts[1]) : '';
    // 서버로 로그인했는데 기본 정보가 없으면 먼저 기본 정보를 받습니다(데이터 화면은 그대로 열어 둠)
    if (auth.checked && auth.user && !auth.profile && route !== 'data') route = 'profile';
    renderHeader(route);
    main.textContent = '';
    closeDialog();
    switch (route) {
      case 'login': viewLogin(); break;
      case 'request': viewRequest(arg); break;
      case 'list': viewList(); break;
      case 'detail': viewDetail(arg); break;
      case 'sources': viewSources(arg); break;
      case 'logs': viewLogs(); break;
      case 'data': viewData(); break;
      case 'manual': viewManual(); break;
      case 'members': viewMembers(); break;
      case 'mails': viewMails(); break;
      case 'profile': viewProfile(); break;
      case 'manual-admin': viewManualAdmin(); break;
      case 'originals': viewOriginals(); break;
      default: viewLogin();
    }
    if (afterRender) {
      var ar = afterRender; afterRender = null;
      dialog(ar.title, h('p', null, ar.body));
    }
    main.setAttribute('data-route', location.hash || '#/'); // 화면 전환 완료 표시(점검용)
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);
  render();
  // 서버 로그인 상태 확인(구글·카카오에서 돌아온 경우 포함) → 다시 그림
  refreshAuth().then(function () {
    if (auth.user && /^(#\/?)?(login)?$/.test(location.hash)) location.hash = auth.profile ? (me() ? '#/request' : '#/profile') : '#/profile';
    else render();
    A.onChange(function (event, user) {
      var was = auth.user && auth.user.id, now2 = user && user.id;
      if (was !== now2) { if (!now2) resetAuth(); refreshAuth().then(render); }
    });
  });
  // 저장된 매뉴얼 색인을 다 읽으면 매뉴얼 화면·AI 회신 화면을 다시 그립니다
  manualsReady.then(function () { if (/^#\/(manual|detail)/.test(location.hash)) render(); });
})();
