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
 */
(function () {
  'use strict';
  var L = window.TSLogic, S = window.TSStore;
  var db = S.loadDb();
  var lang = S.getLang();
  var t = window.TSI18n.make(lang);
  var main = document.getElementById('main');
  var listFilter = null; // 조회 화면 검색조건 유지

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
  function isAdmin() { var u = me(); return !!u && u.user_type === 'ADMIN'; }
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
    var items = [['request', 'nav_request'], ['list', 'nav_list']];
    if (u && u.user_type === 'ADMIN') items.push(['sources', 'nav_sources'], ['logs', 'nav_logs']);
    items.push(['data', 'nav_data']);
    items.forEach(function (it) {
      nav.appendChild(h('a', { href: '#/' + it[0], 'aria-current': route === it[0] ? 'page' : null }, t(it[1])));
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

  function login(regId) {
    var u = L.userOf(db, regId);
    if (!u) return false;
    var at = L.toDateTimeStr(now());
    db.logs.push({ reg_id: u.reg_id, login_date: at, logout_date: '' });
    save();
    S.setSession({ reg_id: u.reg_id, login_date: at });
    return true;
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
      if (!login(id)) { showErrors(loginForm, []); toast(t('login_unknown'), true); return; }
      go('#/request');
    });

    var accounts = h('div', { class: 'card' }, h('h2', null, t('login_pick')));
    if (!db.users.length) {
      accounts.appendChild(h('p', null, t('empty_db')));
      accounts.appendChild(h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { loadSample(true); } }, t('load_sample')));
    } else {
      accounts.appendChild(h('div', { class: 'account-list' }, db.users.map(function (u) {
        return h('button', { class: 'btn', type: 'button', onclick: function () { loginForm.elements.reg_id.value = u.reg_id; loginForm.elements.reg_id.focus(); } },
          u.req_name + ' · ' + u.reg_id + (u.user_type === 'ADMIN' ? ' (ADMIN)' : ''));
      })));
    }

    var memberForm = h('form', { class: 'form-grid', novalidate: true },
      field(t('login_id'), h('input', { name: 'reg_id', maxlength: 20 }), { name: 'reg_id' }),
      field(t('f_req_name'), h('input', { name: 'req_name', maxlength: 50 }), { name: 'req_name' }),
      field(t('f_e_mail'), h('input', { name: 'e_mail', type: 'email', maxlength: 50 }), { name: 'e_mail' }),
      field(t('f_phone'), h('input', { name: 'phone', type: 'tel', maxlength: 20 }), { name: 'phone' }),
      field(t('f_country'), h('input', { name: 'country_cd', maxlength: 20, placeholder: 'KR' }), { name: 'country_cd' }),
      field(t('f_dealer'), h('input', { name: 'dealer', maxlength: 50 }), { name: 'dealer' }),
      field(t('f_territory'), codeSelect('territory_cd', L.TERRITORY_CD, ''), { name: 'territory_cd' }),
      field(t('f_user_type'), codeSelect('user_type', L.USER_TYPE, 'USER'), { name: 'user_type' }),
      h('div', { class: 'span-all btn-row' }, h('button', { class: 'btn btn-primary', type: 'submit' }, t('member_save'))));
    memberForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = fd(memberForm), errs = [];
      ['reg_id', 'req_name', 'dealer'].forEach(function (k) { if (!v[k].trim()) errs.push({ field: k, code: 'required' }); });
      if (errs.length) { showErrors(memberForm, errs); return; }
      if (L.userOf(db, v.reg_id.trim())) { toast(t('member_dup'), true); return; }
      db.users.push({
        reg_id: v.reg_id.trim(), req_name: v.req_name.trim(), e_mail: v.e_mail.trim(), phone: v.phone.trim(),
        country_cd: v.country_cd.trim(), dealer: v.dealer.trim(), join_date: L.toDateStr(now()),
        user_type: v.user_type || 'USER', territory_cd: v.territory_cd
      });
      save(); toast(t('member_saved')); render();
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
              dialog(t('ref_popup'), [h('p', null, h('strong', null, x)), h('p', { class: 'note' }, t('ref_popup_note'))]);
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
          kv(t('f_action_content'), h('span', { class: 'body' }, m.action_content || '-'))));
    } else if (!admin && m.status === 'Answered') {
      var closeForm = h('form', { class: 'form-grid', novalidate: true },
        field(t('f_action_content'), h('textarea', { name: 'action_content', rows: 4 }), { name: 'action_content', span: true }),
        field(t('f_complete_date'), h('input', { type: 'date', name: 'complete_date', value: L.toDateStr(now()), min: m.reg_date, max: L.toDateStr(now()) }), { name: 'complete_date' }),
        h('div', { class: 'span-all submit-bar' }, h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, t('btn_complete'))));
      closeForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var res = L.completeRequest(db, refNo, fd(closeForm), now());
        if (!res.ok) { showErrors(closeForm, res.errors); return; }
        save(res.db); toast(t('completed_ok')); render();
      });
      closing = h('div', { class: 'card close-card' }, h('h2', null, t('close_title')), h('p', { class: 'note' }, t('close_note')), closeForm);
    }

    main.appendChild(h('div', { class: 'page-head' },
      h('div', { style: 'margin-right:auto' }, h('h1', null, t('detail_title')), h('p', { class: 'note' }, t('detail_sub'))), buttons));
    main.appendChild(head);
    main.appendChild(h('div', { class: 'card' }, thread));
    if (closing) main.appendChild(closing);
    if (admin && m.status !== 'Completed') main.appendChild(aiPanel(refNo));
  }

  // AI 회신 — 프롬프트 생성 → 붙여넣기 → 나누기 → 저장 (반자동)
  function aiPanel(refNo) {
    var prompt = L.buildAiPrompt(db, refNo);
    var paste = h('textarea', { name: 'ai_answer', rows: 8 });
    var result = h('div');
    var panel = h('div', { class: 'card ai-panel' },
      h('h2', null, t('ai_title')),
      h('p', { class: 'note' }, t('ai_step1')), h('p', { class: 'note' }, t('ai_step2')), h('p', { class: 'note' }, t('ai_step3')),
      h('pre', { class: 'prompt-box' }, prompt),
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
        var mail = L.buildPsMail(db, refNo, p.reply_content);
        var mailto = 'mailto:?subject=' + encodeURIComponent(mail.subject) + '&body=' + encodeURIComponent(mail.body);
        append(result, [
          h('div', { class: 'alert warn' }, t('ai_cannot')),
          h('h3', null, t('ps_title')),
          h('pre', { class: 'prompt-box' }, mail.subject + '\n\n' + mail.body),
          h('p', { class: 'note' }, t('ps_note')),
          h('div', { class: 'btn-row' },
            h('a', { class: 'btn', href: mailto }, t('ps_mailto')),
            h('button', { class: 'btn', type: 'button', onclick: function () { copyText(mail.subject + '\n\n' + mail.body); } }, t('ps_copy')))
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
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, t('src_title'))));
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
      default: viewLogin();
    }
    main.setAttribute('data-route', location.hash || '#/'); // 화면 전환 완료 표시(점검용)
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);
  render();
})();
