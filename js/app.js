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
 */
(function () {
  'use strict';
  var L = window.TSLogic, S = window.TSStore, M = window.TSManual, MS = window.TSManualStore;
  var db = S.loadDb();
  var lang = S.getLang();
  var t = window.TSI18n.make(lang);
  var main = document.getElementById('main');
  var listFilter = null; // 조회 화면 검색조건 유지
  var afterRender = null; // 화면을 다시 그린 뒤 띄울 안내(대화상자) — render 가 열린 대화상자를 닫기 때문
  var manuals = [];       // 불러온 매뉴얼 색인 (IndexedDB 에서 읽어 옴)
  var manualsReady = MS.list().then(function (list) {
    manuals = (list || []).map(function (x) { var r = M.readIndexJson(x); return r.ok ? r.index : null; }).filter(Boolean);
  }).catch(function () { manuals = []; });

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
  function me() { var s = session(); return s ? L.userOf(db, s.reg_id) : null; }
  function isAdmin() { return L.isApprovedAdmin(me()); }
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
    document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = t(el.getAttribute('data-t')); });
    document.getElementById('langSelect').value = lang;
    var nav = document.getElementById('nav');
    nav.textContent = '';
    var u = me();
    var items = [['request', 'nav_request'], ['list', 'nav_list'], ['manual', 'nav_manual']];
    if (L.isApprovedAdmin(u)) {
      var pendingUsers = db.users.filter(function (x) { return L.approvalOf(x) === 'Pending'; }).length;
      var pendingMails = (db.mails || []).filter(function (x) { return x.status === 'Pending'; }).length;
      items.push(['members', 'nav_members', pendingUsers], ['mails', 'nav_mails', pendingMails], ['sources', 'nav_sources'], ['logs', 'nav_logs']);
    }
    items.push(['data', 'nav_data']);
    items.forEach(function (it) {
      nav.appendChild(h('a', { href: '#/' + it[0], 'aria-current': route === it[0] ? 'page' : null }, t(it[1]),
        it[2] ? h('span', { class: 'count-badge', title: t('pending_count') }, String(it[2])) : null));
    });
    document.getElementById('whoami').textContent = u ? u.req_name + ' (' + u.reg_id + (u.user_type === 'ADMIN' ? ' · ADMIN' : '') + ')' : '';
    var auth = document.getElementById('authBtn');
    auth.textContent = u ? t('logout') : t('login');
    var banner = document.getElementById('sampleBanner');
    banner.hidden = !db._sample;
    banner.textContent = t('sample_banner');
  }

  document.getElementById('langSelect').addEventListener('change', function (e) {
    lang = e.target.value; S.setLang(lang); t = window.TSI18n.make(lang); render();
  });
  document.getElementById('authBtn').addEventListener('click', function () {
    if (me()) logout(); else go('#/login');
  });

  // 결과: { ok, code } — 승인 대기·반려된 계정은 로그인하지 못합니다(2026-09-29 수강생 답변)
  function login(regId) {
    var chk = L.canLogin(db, regId);
    if (!chk.ok) return chk;
    var u = chk.user;
    var at = L.toDateTimeStr(now());
    db.logs.push({ reg_id: u.reg_id, login_date: at, logout_date: '' });
    save();
    S.setSession({ reg_id: u.reg_id, login_date: at });
    return { ok: true };
  }
  function logout() {
    var s = session();
    if (s) {
      for (var i = db.logs.length - 1; i >= 0; i--) {
        var l = db.logs[i];
        if (l.reg_id === s.reg_id && l.login_date === s.login_date && !l.logout_date) { l.logout_date = L.toDateTimeStr(now()); break; }
      }
      save();
    }
    S.setSession(null);
    go('#/login');
  }

  function guard(needAdmin) {
    if (!me()) {
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
      S.setSession(null);
      save();
      toast(t('data_loaded'));
      go('#/login');
    }
    var has = db.mains.length || db.users.length || db.sources.length;
    if (has && !skipConfirm) dialog(t('load_sample'), h('p', null, t('data_sample_confirm')),
      [{ label: t('btn_close'), value: 'close' }, { label: t('load_sample'), primary: true, onClick: doIt }]);
    else doIt();
  }

  // ── 접속화면 ─────────────────────────────────────────────
  function viewLogin() {
    var loginForm = h('form', { class: 'card', novalidate: true },
      h('h1', null, t('login_title')),
      field(t('login_id'), h('input', { name: 'reg_id', autocomplete: 'username', required: true }), { name: 'reg_id' }),
      field(t('login_pw'), h('input', { name: 'password', type: 'password', autocomplete: 'current-password' }), { name: 'password', hint: t('login_pw_note') }),
      h('div', { class: 'submit-bar' }, h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, t('login_btn'))));
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = loginForm.elements.reg_id.value.trim();
      var res = login(id);
      if (!res.ok) { showErrors(loginForm, []); toast(t('login_' + res.code), true); return; }
      go('#/request');
    });

    var accounts = h('div', { class: 'card' }, h('h2', null, t('login_pick')));
    if (!db.users.length) {
      accounts.appendChild(h('p', null, t('empty_db')));
      accounts.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { loadSample(true); } }, t('load_sample')));
    } else {
      accounts.appendChild(h('div', { class: 'account-list' }, db.users.map(function (u) {
        var ap = L.approvalOf(u);
        return h('button', { class: 'btn', type: 'button', onclick: function () { loginForm.elements.reg_id.value = u.reg_id; loginForm.elements.reg_id.focus(); } },
          u.req_name + ' · ' + u.reg_id + (u.user_type === 'ADMIN' ? ' (ADMIN)' : ''),
          ap !== 'Approved' ? h('span', { class: 'status ' + (ap === 'Pending' ? 'red' : 'black'), style: 'margin-left:6px' }, t('approval_' + ap)) : null);
      })));
    }

    // 회원 등록 — 본인이 정한 ID(사번 없음), 중복 ID 확인, 관리자 승인 후 사용 (2026-09-29 수강생 답변)
    var idInput = h('input', { name: 'reg_id', maxlength: 20, autocomplete: 'off', placeholder: 'kim_bs01' });
    var idResult = h('small', { class: 'id-check', 'aria-live': 'polite' });
    function checkId() {
      var r = L.checkRegId(db, idInput.value);
      idResult.textContent = t('id_' + (r.ok ? 'ok' : r.code === 'required' ? 'required' : r.code === 'bad_id' ? 'bad' : 'taken'));
      idResult.className = 'id-check ' + (r.ok ? 'ok' : 'ng');
      return r;
    }
    idInput.addEventListener('input', function () { idResult.textContent = ''; });
    var idField = h('div', { class: 'field', 'data-field': 'reg_id' }, h('span', null, t('login_id') + ' *'),
      h('div', { class: 'input-row' }, idInput, h('button', { class: 'btn', type: 'button', onclick: checkId }, t('id_check'))),
      h('small', { class: 'note' }, t('id_rule')), idResult, h('small', { class: 'err', hidden: true }));
    var memberForm = h('form', { class: 'form-grid', novalidate: true },
      idField,
      field(t('f_req_name') + ' *', h('input', { name: 'req_name', maxlength: 50 }), { name: 'req_name' }),
      field(t('f_e_mail') + ' *', h('input', { name: 'e_mail', type: 'email', maxlength: 50 }), { name: 'e_mail', hint: t('email_hint') }),
      field(t('f_phone'), h('input', { name: 'phone', type: 'tel', maxlength: 20 }), { name: 'phone' }),
      field(t('f_country'), h('input', { name: 'country_cd', maxlength: 20, placeholder: 'KR' }), { name: 'country_cd' }),
      field(t('f_dealer') + ' *', h('input', { name: 'dealer', maxlength: 50 }), { name: 'dealer' }),
      field(t('f_territory') + ' *', codeSelect('territory_cd', L.TERRITORY_CD, ''), { name: 'territory_cd', hint: t('territory_hint') }),
      h('p', { class: 'span-all note' }, t('member_note')),
      h('div', { class: 'span-all btn-row' }, h('button', { class: 'btn btn-primary', type: 'submit' }, t('member_save'))));
    memberForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var res = L.registerMember(db, fd(memberForm), now());
      if (!res.ok) {
        showErrors(memberForm, res.errors);
        if (res.errors.some(function (x) { return x.field === 'reg_id'; })) checkId();
        return;
      }
      save(res.db);
      afterRender = { title: t('member_title'), body: t(res.autoApproved ? 'member_first_admin' : 'member_pending', { id: res.user.reg_id }) };
      render();
    });

    main.appendChild(h('div', { class: 'login-wrap' },
      h('div', null, loginForm, accounts),
      h('div', { class: 'card' }, h('h2', null, t('member_title')), memberForm)));
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
      var headers = cols.map(function (c) { return { key: c[0], label: c[0] }; });
      var out = rows.map(function (r) { var o = Object.assign({}, r); o.status = r.status; return o; });
      var name = (admin ? '기술지원조회_Admin_' : '기술지원조회_') + L.toDateStr(now()) + (db._sample ? '_예시데이터' : '') + '.csv';
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
    manuals = manuals.filter(function (x) { return x.file !== ix.file; }).concat([ix]);
    manuals.sort(function (a, b) { return a.file < b.file ? -1 : 1; });
    return MS.put(M.toStorable(ix));
  }

  var manualQuery = '', manualModel = '';
  function viewManual() {
    if (!guard()) return;
    main.appendChild(h('div', { class: 'page-head' },
      h('div', { style: 'margin-right:auto' }, h('h1', null, t('manual_title')), h('p', { class: 'note' }, t('manual_sub')))));
    main.appendChild(h('div', { class: 'alert info' }, t('manual_privacy')));

    // 불러오기
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
      h('h2', null, t('manual_load')),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('span', null, t('manual_pdf')), pdfInput, h('small', { class: 'note' }, t('manual_pdf_note'))),
        h('div', { class: 'field' }, h('span', null, t('manual_json')), jsonInput, h('small', { class: 'note' }, t('manual_json_note')))),
      status,
      MS.isPersistent() === false ? h('p', { class: 'alert warn' }, t('manual_memory_only')) : null));

    if (!manuals.length) { main.appendChild(h('div', { class: 'card' }, h('p', null, t('manual_empty')))); return; }

    // 불러온 매뉴얼 — 적용 모델은 고칠 수 있습니다(요청 모델과 맞춰 검색 대상을 고름)
    var rows = manuals.map(function (ix) {
      var models = h('input', { value: ix.models || '', 'aria-label': t('manual_models') + ' — ' + ix.file });
      models.addEventListener('change', function () { ix.models = models.value.trim(); saveManual(ix); toast(t('manual_models_saved')); });
      var toc = (ix.toc && ix.toc.entries) || [];
      // 소스 등록(모델 ↔ 매뉴얼 대응표)에서 이 파일에 연결된 모델
      var linked = db.sources.filter(function (sv) { return M.manualsBySource([ix], db.sources, sv.model).length; })
        .map(function (sv) { return sv.model; });
      return h('div', { class: 'manual-item' },
        h('div', { class: 'manual-head' },
          h('strong', null, ix.title), h('span', { class: 'sub' }, (ix.kind ? ix.kind + ' · ' : '') + ix.pages.length + t('page_unit') + ' · ' + t('manual_toc_count', { n: toc.length })),
          h('button', { class: 'btn btn-danger', type: 'button', onclick: function () {
            dialog(t('manual_remove'), h('p', null, t('manual_remove_confirm', { name: ix.title })), [
              { label: t('btn_close'), value: 'close' },
              { label: t('manual_remove'), primary: true, onClick: function () { manuals = manuals.filter(function (x) { return x !== ix; }); MS.remove(ix.file); render(); } }]);
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

  // ── 회원 관리 (Admin) — 가입 승인·권한·관리 지역 ─────────────────
  function viewMembers() {
    if (!guard(true)) return;
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
        return h('label', { class: 'check' }, h('input', { type: 'checkbox', value: c, checked: mine.indexOf(c) !== -1 }), c);
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
          h('span', { class: 'sub' }, [u.dealer, u.territory_cd, u.e_mail, t('member_joined', { date: L.displayDate(u.join_date) })].filter(Boolean).join(' · ')),
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
          var v = c[0] === 'minutes' ? (r.logout_date ? L.formatDuration(r.minutes) : t('log_open')) : r[c[0]];
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
      download('기술지원DB_' + L.toDateStr(now()) + (db._sample ? '_예시데이터' : '') + '.xlsx',
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
  function render() {
    var parts = (location.hash.replace(/^#\/?/, '') || (me() ? 'request' : 'login')).split('/');
    var route = parts[0], arg = parts[1] ? decodeURIComponent(parts[1]) : '';
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
  // 저장된 매뉴얼 색인을 다 읽으면 매뉴얼 화면·AI 회신 화면을 다시 그립니다
  manualsReady.then(function () { if (/^#\/(manual|detail)/.test(location.hash)) render(); });
})();
