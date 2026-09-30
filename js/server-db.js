/*
 * 기술지원 기록의 서버 저장 — 공용 Supabase 의 data0901_ 표 (supabase/2026-09-30_data0901_records.sql)
 *
 *  화면은 지금처럼 db 한 덩어리({ mains, inquiries, replies, users, sources, logs, mails })를 다루고,
 *  바뀐 부분만 골라 서버 표에 넣거나 고칩니다(diff → ops → run). 순수 부분(바꾸기·고른 목록)은 Node 테스트로 확인합니다.
 *
 *    도구 필드               서버 표
 *    mains                   data0901_requests   (키 ref_no)
 *    inquiries               data0901_inquiries  (키 ref_no + s_turn — UNIQUE, upsert onConflict 'ref_no,s_turn')
 *    replies                 data0901_replies    (키 ref_no + r_turn — UNIQUE, onConflict 'ref_no,r_turn')
 *    sources                 data0901_sources    (키 model — 대문자로 맞춤, UNIQUE, onConflict 'model')
 *    mails                   data0901_mails      (새 메일·대기 메일 내용은 data0901_queue_mail() — 번호·받는 사람은 서버가)
 *    logs                    data0901_access_log (로그인 때 넣고, 로그아웃 시각은 data0901_close_access_log())
 *
 *  누가 무엇을 보는지는 서버 RLS 가 정합니다(정비사 = 자기 건, 관리자 = 전부). 이 파일은 그 결과를 그대로 씁니다.
 */
(function (root) {
  'use strict';
  var T = {
    requests: 'data0901_requests', inquiries: 'data0901_inquiries', replies: 'data0901_replies',
    sources: 'data0901_sources', mails: 'data0901_mails', logs: 'data0901_access_log'
  };
  var MAIN_FIELDS = ['status', 'model', 'serial_no', 'o_hour', 'type_cd', 'system_cat', 'action_content', 'complete_date', 'complete_image'];
  var INQ_FIELDS = ['reg_date', 'phenomenon', 'requirement', 's_image'];
  var REP_FIELDS = ['r_reply_date', 'r_title', 'req_summary', 'reply_content', 'ref_info'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function s(v) { return v == null ? '' : String(v); }
  // 서버 시각(timestamptz) → 도구 표기 'YYYY-MM-DD HH:MM' (브라우저 시간대)
  function dt(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d)) return s(v);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  // 도구 표기 'YYYY-MM-DD HH:MM' → ISO (브라우저 시간대로 읽음). 비면 null
  function iso(v) {
    var m = s(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).toISOString();
  }
  function day(v) { var x = s(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null; }
  function normModel(m) { return s(m).trim().toUpperCase(); }

  // ── 서버 행 → 도구 행 ─────────────────────────────────────────
  var from = {
    main: function (r) {
      return {
        ref_no: r.ref_no, status: r.status, reg_date: s(r.reg_date).slice(0, 10), reg_id: r.reg_id,
        model: r.model, serial_no: r.serial_no, o_hour: r.o_hour == null ? '' : Number(r.o_hour),
        type_cd: r.type_cd, system_cat: r.system_cat, action_content: s(r.action_content),
        complete_date: r.complete_date ? s(r.complete_date).slice(0, 10) : '', complete_image: s(r.complete_image)
      };
    },
    inquiry: function (r) {
      return { ref_no: r.ref_no, s_turn: Number(r.s_turn), reg_date: s(r.reg_date).slice(0, 10), reg_id: r.reg_id,
        phenomenon: r.phenomenon, requirement: r.requirement, s_image: s(r.s_image) };
    },
    reply: function (r) {
      return { ref_no: r.ref_no, r_turn: Number(r.r_turn), r_reply_date: s(r.r_reply_date).slice(0, 10), r_title: s(r.r_title),
        req_summary: s(r.req_summary), reply_content: r.reply_content, ref_info: s(r.ref_info) };
    },
    source: function (r) { return { notebook_name: r.notebook_name, model: r.model, files: s(r.files) }; },
    mail: function (r) {
      return { mail_id: r.mail_id, ref_no: r.ref_no, reason: r.reason, mail_to: s(r.mail_to), subject: r.subject, body: r.body,
        created_date: dt(r.created_date), status: r.status, sent_date: dt(r.sent_date) };
    },
    log: function (r) { return { id: r.id, user_id: r.user_id, reg_id: r.reg_id, login_date: dt(r.login_at), logout_date: dt(r.logout_at) }; }
  };

  // ── 도구 행 → 서버 행 ─────────────────────────────────────────
  var to = {
    main: function (m) {
      return {
        ref_no: m.ref_no, status: m.status || 'Submitted', reg_date: day(m.reg_date), reg_id: s(m.reg_id),
        model: s(m.model).trim(), serial_no: s(m.serial_no).trim(), o_hour: Number(m.o_hour) || 0,
        type_cd: m.type_cd, system_cat: m.system_cat, action_content: s(m.action_content),
        complete_date: day(m.complete_date), complete_image: s(m.complete_image)
      };
    },
    inquiry: function (q) {
      return { ref_no: q.ref_no, s_turn: Number(q.s_turn), reg_date: day(q.reg_date), reg_id: s(q.reg_id),
        phenomenon: s(q.phenomenon), requirement: s(q.requirement), s_image: s(q.s_image) };
    },
    reply: function (r) {
      return { ref_no: r.ref_no, r_turn: Number(r.r_turn), r_reply_date: day(r.r_reply_date), r_title: s(r.r_title),
        req_summary: s(r.req_summary), reply_content: s(r.reply_content), ref_info: s(r.ref_info) };
    },
    source: function (x) { return { notebook_name: s(x.notebook_name).trim(), model: normModel(x.model), files: s(x.files) }; }
  };
  function pick(row, fields) { var o = {}; fields.forEach(function (f) { o[f] = row[f]; }); return o; }
  function same(a, b, fields) { return fields.every(function (f) { return s(a[f]) === s(b[f]); }); }
  function index(rows, key) { var o = {}; (rows || []).forEach(function (r) { o[key(r)] = r; }); return o; }
  var KEY = {
    main: function (m) { return m.ref_no; },
    inquiry: function (q) { return q.ref_no + '|' + Number(q.s_turn); },
    reply: function (r) { return r.ref_no + '|' + Number(r.r_turn); },
    source: function (x) { return normModel(x.model); },
    mail: function (m) { return m.mail_id; }
  };

  // ── 바뀐 것 고르기 ────────────────────────────────────────────
  // prev: 서버에서 읽어 온(또는 마지막으로 맞춘) db, next: 화면이 만든 새 db
  // 결과: [{ op, table, row?, match?, args? }] — 서버에 보낼 순서(소스 → 등록 → 문의 → 회신 → 메일)대로
  function diff(prev, next) {
    var ops = [];
    var pS = index(prev.sources, KEY.source), nS = index(next.sources, KEY.source);
    Object.keys(nS).forEach(function (k) {
      var n = nS[k], p = pS[k];
      if (!p) ops.push({ op: 'insert', table: T.sources, row: to.source(n) });
      else if (!same(to.source(p), to.source(n), ['notebook_name', 'files'])) ops.push({ op: 'update', table: T.sources, row: pick(to.source(n), ['notebook_name', 'files']), match: { model: k } });
    });
    Object.keys(pS).forEach(function (k) { if (!nS[k]) ops.push({ op: 'delete', table: T.sources, match: { model: k } }); });

    var pM = index(prev.mains, KEY.main);
    (next.mains || []).forEach(function (n) {
      var p = pM[n.ref_no];
      if (!p) ops.push({ op: 'insert', table: T.requests, row: to.main(n) });
      else if (!same(to.main(p), to.main(n), MAIN_FIELDS)) ops.push({ op: 'update', table: T.requests, row: pick(to.main(n), MAIN_FIELDS), match: { ref_no: n.ref_no } });
    });
    [['inquiries', T.inquiries, KEY.inquiry, to.inquiry, INQ_FIELDS, 's_turn'], ['replies', T.replies, KEY.reply, to.reply, REP_FIELDS, 'r_turn']].forEach(function (c) {
      var pI = index(prev[c[0]], c[2]);
      (next[c[0]] || []).forEach(function (n) {
        var p = pI[c[2](n)];
        var match = { ref_no: n.ref_no }; match[c[5]] = Number(n[c[5]]);
        if (!p) ops.push({ op: 'insert', table: c[1], row: c[3](n) });
        else if (!same(c[3](p), c[3](n), c[4])) ops.push({ op: 'update', table: c[1], row: pick(c[3](n), c[4]), match: match });
      });
    });
    var pMail = index(prev.mails, KEY.mail);
    (next.mails || []).forEach(function (n) {
      var p = pMail[n.mail_id];
      var queue = { op: 'rpc', name: 'data0901_queue_mail', args: { p_ref_no: n.ref_no, p_reason: n.reason, p_subject: s(n.subject), p_body: s(n.body), p_mail_to: s(n.mail_to) }, mails: true };
      if (!p) { if (n.status !== 'Sent') ops.push(queue); return; }
      if (n.status === 'Sent' && p.status !== 'Sent') {
        ops.push({ op: 'update', table: T.mails, row: { status: 'Sent', sent_date: iso(n.sent_date) || new Date().toISOString() }, match: { mail_id: n.mail_id }, mails: true });
      } else if (n.status !== 'Sent' && !same(p, n, ['subject', 'body', 'mail_to'])) ops.push(queue);
    });
    return ops;
  }

  // ── 브라우저 기록 → 서버 (관리자, 한 번) ────────────────────────
  // 서버에 이미 있는 등록번호·모델은 건너뜁니다(같은 번호의 다른 건에 문의가 붙지 않게, 등록 건 단위로 통째로).
  // 접속 Log 는 옮기지 않습니다(서버 시각으로만 쌓는 감사 기록이라 옛 시각을 새로 적을 수 없음).
  function planMigration(local, server) {
    var have = index(server.mains, KEY.main), haveS = index(server.sources, KEY.source);
    var mains = (local.mains || []).filter(function (m) { return /^\d{12}$/.test(s(m.ref_no)) && !have[m.ref_no]; });
    var refs = index(mains, KEY.main);
    var inRef = function (r) { return !!refs[r.ref_no]; };
    var seenS = {};
    var sources = (local.sources || []).filter(function (x) {
      var k = KEY.source(x);
      if (!k || haveS[k] || seenS[k]) return false;
      seenS[k] = true; return true;
    });
    var plan = {
      sources: sources.map(to.source),
      requests: mains.map(to.main),
      inquiries: (local.inquiries || []).filter(inRef).map(to.inquiry),
      replies: (local.replies || []).filter(inRef).map(to.reply),
      mails: (local.mails || []).filter(inRef).map(function (m) {
        return { mail_id: '', ref_no: m.ref_no, reason: m.reason, mail_to: s(m.mail_to), subject: s(m.subject), body: s(m.body),
          created_date: iso(m.created_date) || new Date().toISOString(), status: m.status === 'Sent' ? 'Sent' : 'Pending', sent_date: iso(m.sent_date) };
      }),
      skipped: (local.mains || []).length - mains.length,
      skippedSources: (local.sources || []).length - sources.length,
      logs: (local.logs || []).length
    };
    return plan;
  }

  // ── 서버와 주고받기 (브라우저) ──────────────────────────────────
  // 표가 아직 없으면(대표가 SQL 을 실행하기 전) PostgREST 가 PGRST205(표)·PGRST202(함수)·42P01 을 돌려줍니다
  function isMissing(err) { return !!err && /PGRST205|PGRST202|42P01|42883/.test(s(err.code) + ' ' + s(err.message)); }
  function fail(err, table) {
    var e = new Error(s(err && err.message || err)); e.code = err && err.code; e.table = table; e.missing = isMissing(err); throw e;
  }
  function all(c, table, order) {
    // 1000 행씩 끝까지 (PostgREST 기본 한도)
    var out = [];
    function page(fromRow) {
      return c.from(table).select('*').order(order, { ascending: true }).range(fromRow, fromRow + 999).then(function (r) {
        if (r.error) fail(r.error, table);
        out = out.concat(r.data || []);
        return (r.data || []).length === 1000 ? page(fromRow + 1000) : out;
      });
    }
    return page(0);
  }
  // opts.admin: 메일 목록도 읽음(정비사는 메일 표를 못 읽음)
  function load(c, opts) {
    opts = opts || {};
    return Promise.all([
      all(c, T.sources, 'model'), all(c, T.requests, 'ref_no'), all(c, T.inquiries, 'id'), all(c, T.replies, 'id'),
      opts.admin ? all(c, T.mails, 'id') : Promise.resolve([])
    ]).then(function (rs) {
      return {
        sources: rs[0].map(from.source), mains: rs[1].map(from.main), inquiries: rs[2].map(from.inquiry),
        replies: rs[3].map(from.reply), mails: rs[4].map(from.mail), users: [], logs: []
      };
    });
  }
  function loadMails(c) { return all(c, T.mails, 'id').then(function (rows) { return rows.map(from.mail); }); }
  function loadLogs(c) { return all(c, T.logs, 'id').then(function (rows) { return rows.map(from.log); }); }
  function applyMatch(q, match) { Object.keys(match).forEach(function (k) { q = q.eq(k, match[k]); }); return q; }
  // ops 를 차례로 보냅니다. 하나라도 실패하면 거기서 멈추고 오류를 던집니다(이미 보낸 것은 서버에 남음 → 화면이 서버를 다시 읽음)
  function run(c, ops) {
    var chain = Promise.resolve(), results = [];
    ops.forEach(function (o) {
      chain = chain.then(function () {
        var q;
        if (o.op === 'rpc') q = c.rpc(o.name, o.args);
        else if (o.op === 'insert') q = c.from(o.table).insert(o.row);
        else if (o.op === 'update') q = applyMatch(c.from(o.table).update(o.row), o.match);
        else if (o.op === 'delete') q = applyMatch(c.from(o.table).delete(), o.match);
        return q.then(function (r) { if (r.error) fail(r.error, o.table || o.name); results.push(r.data); });
      });
    });
    return chain.then(function () { return results; });
  }
  function lastRefNo(c, dayStr) {
    return c.rpc('data0901_last_ref_no', { p_day: dayStr }).then(function (r) { if (r.error) fail(r.error, 'data0901_last_ref_no'); return r.data || ''; });
  }
  function findDuplicates(c, refNo) {
    return c.rpc('data0901_find_duplicates', { p_ref_no: refNo }).then(function (r) { if (r.error) fail(r.error, 'data0901_find_duplicates'); return r.data || []; });
  }
  function openLog(c, regId) {
    return c.from(T.logs).insert({ reg_id: regId }).select('id').single().then(function (r) { if (r.error) fail(r.error, T.logs); return r.data.id; });
  }
  function closeLog(c, id) {
    return c.rpc('data0901_close_access_log', { p_id: id }).then(function (r) { if (r.error) fail(r.error, 'data0901_close_access_log'); return r.data; });
  }
  // 옮기기 — upsert 는 onConflict 를 UNIQUE 제약과 같은 글자로, 이미 있으면 건너뜀(ignoreDuplicates)
  function migrate(c, plan) {
    function up(table, rows, onConflict) {
      if (!rows.length) return Promise.resolve();
      return c.from(table).upsert(rows, { onConflict: onConflict, ignoreDuplicates: true }).then(function (r) { if (r.error) fail(r.error, table); });
    }
    return up(T.sources, plan.sources, 'model')
      .then(function () { return up(T.requests, plan.requests, 'ref_no'); })
      .then(function () { return up(T.inquiries, plan.inquiries, 'ref_no,s_turn'); })
      .then(function () { return up(T.replies, plan.replies, 'ref_no,r_turn'); })
      .then(function () {
        if (!plan.mails.length) return;
        return c.from(T.mails).insert(plan.mails).then(function (r) { if (r.error) fail(r.error, T.mails); });
      });
  }

  var api = {
    TABLES: T, from: from, to: to, diff: diff, planMigration: planMigration, isMissing: isMissing, dt: dt, iso: iso,
    load: load, loadMails: loadMails, loadLogs: loadLogs, run: run, lastRefNo: lastRefNo, findDuplicates: findDuplicates,
    openLog: openLog, closeLog: closeLog, migrate: migrate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TSServerDb = api;
})(typeof window !== 'undefined' ? window : this);
