/*
 * 지게차 AI 기술지원 — 순수 로직 모듈 (화면·저장소와 무관)
 * 필드명은 수강생 DB 정의(04_DB.xlsx, 2026-09-28 최신본)를 그대로 씁니다.
 * 브라우저에서는 window.TSLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 로컬 파일(file://)로 열었을 때
 * 브라우저가 module 스크립트를 막기 때문입니다.
 */
(function (root) {
  'use strict';

  // ── 코드값 (04_DB.xlsx 등록·사용자 시트) ─────────────────────────
  var STATUS = {
    SUBMITTED: 'Submitted', // 접수, 빨강
    ANSWERED: 'Answered',   // 회신, 파랑
    COMPLETED: 'Completed'  // 종료, 검정
  };
  var STATUS_META = {
    Submitted: { ko: '접수', en: 'Submitted', color: 'red' },
    Answered: { ko: '회신', en: 'Answered', color: 'blue' },
    Completed: { ko: '종료', en: 'Completed', color: 'black' }
  };
  // 원본 "Specificatio" 는 오타 — 수강생 확인(2026-09-28 패들릿 댓글 「"Specification"으로 통일」)대로 통일
  var TYPE_CD = [
    { code: 'Troubleshooting', ko: '고장진단' },
    { code: 'Maintenance', ko: '유지보수' },
    { code: 'Specification', ko: '제원' }
  ];
  var SYSTEM_CAT = [
    { code: 'Transmission', ko: '미션' },
    { code: 'Engine', ko: '엔진' },
    { code: 'Electric', ko: '전장' },
    { code: 'Hydraulic', ko: '유압' },
    { code: 'Drive Axle', ko: '구동축' },
    { code: 'Steering Axle', ko: '조향축' },
    { code: 'Cabin', ko: '케빈' },
    { code: 'HVAC', ko: '공조기' }
  ];
  var USER_TYPE = ['USER', 'ADMIN'];
  var TERRITORY_CD = ['경기', '경남', '전라', '충청', '강원', 'Direct Sales', 'Europe',
    'North America', 'South America', 'Middle East', 'Africa', 'Asia', 'Oceania'];

  // DB.xlsx 시트·필드 순서 (엑셀 가져오기/내보내기 머리행)
  var SHEETS = {
    // action_content(조치 내용)·complete_date(완료일)는 2026-09-28 수강생 확인으로 추가(기획서 10장 6번).
    // 두 열이 없는 옛 엑셀도 그대로 읽힙니다(빈 값).
    // complete_image(완료 사진)는 2026-09-29 수강생 답변(「조치내용, 완료사진, 완료일」)으로 추가.
    '등록': ['ref_no', 'status', 'reg_date', 'reg_id', 'model', 'serial_no', 'o_hour', 'type_cd', 'system_cat',
      'action_content', 'complete_date', 'complete_image'],
    '문의': ['ref_no', 's_turn', 'reg_date', 'reg_id', 'phenomenon', 'requirement', 's_image'],
    '회신': ['ref_no', 'r_turn', 'r_reply_date', 'r_title', 'req_summary', 'reply_content', 'ref_info'],
    // approval·approved_by·approved_date(가입 승인)·manage_territory(관리 지역)는 2026-09-29 수강생 답변으로 추가.
    // 네 열이 없는 옛 엑셀의 사용자는 이미 쓰던 계정이므로 승인된 것으로 읽습니다.
    '사용자': ['reg_id', 'req_name', 'e_mail', 'phone', 'country_cd', 'dealer', 'join_date', 'user_type', 'territory_cd',
      'approval', 'approved_by', 'approved_date', 'manage_territory'],
    '소스등록': ['notebook_name', 'model', 'files'],
    'Log Data': ['reg_id', 'login_date', 'logout_date'],
    // PS 통보 메일 발송 대기 목록 (AI 답변 불가·중복 등록). 정적 웹이라 실제 발송은 메일 앱에서 합니다.
    '메일': ['mail_id', 'ref_no', 'reason', 'mail_to', 'subject', 'body', 'created_date', 'status', 'sent_date']
  };
  var SHEET_KEYS = { '등록': 'mains', '문의': 'inquiries', '회신': 'replies', '사용자': 'users', '소스등록': 'sources', 'Log Data': 'logs', '메일': 'mails' };

  // 필드 크기 (Data Field정의 시트의 VARCHAR 크기)
  var MAX_LEN = { ref_no: 20, model: 20, serial_no: 20, reg_id: 20, ref_info: 50 };

  // 첨부 제한 — PRD 「사진 최대 5장/영상 1분」, 수강생 확인(2026-09-28)대로 적용.
  // 한 번 제출(문의 1차수)마다 사진 5장·영상 1개(60초 이하)까지입니다.
  var ATTACH_LIMIT = { images: 5, videos: 1, videoSeconds: 60 };
  var IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'heif', 'tif', 'tiff'];
  var VIDEO_EXT = ['mp4', 'mov', 'm4v', 'avi', 'wmv', 'mkv', 'webm', '3gp', 'mpeg', 'mpg'];

  function emptyDb() {
    return { mains: [], inquiries: [], replies: [], users: [], sources: [], logs: [], mails: [] };
  }

  // ── 날짜 ─────────────────────────────────────────────────────
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function toDateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function toDateTimeStr(d) { return toDateStr(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function parseDate(s) {
    if (s instanceof Date) return s;
    if (!s) return null;
    var m = String(s).trim().match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  }
  // 화면 표기: 2026.09.30 (화면구성.xlsx 표기)
  function displayDate(s) {
    var d = parseDate(s);
    return d ? d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) : '';
  }

  // ── ref_no 채번: yyyymmddnnnn (그날 일련번호 4자리) ─────────────
  function nextRefNo(existingRefNos, now) {
    var prefix = toDateStr(now).replace(/-/g, '');
    var max = 0;
    (existingRefNos || []).forEach(function (r) {
      r = String(r || '');
      if (r.length === 12 && r.indexOf(prefix) === 0) {
        var n = parseInt(r.slice(8), 10);
        if (n > max) max = n;
      }
    });
    if (max >= 9999) throw new Error('하루 채번 한도(9999건)를 넘었습니다.');
    return prefix + pad(max + 1, 4);
  }

  // ── 코드 보조 ────────────────────────────────────────────────
  // 원본 오타 「Specificatio」와 대소문자 차이를 코드 표기로 맞춥니다(가져오기용)
  function normTypeCd(v) {
    var s = String(v == null ? '' : v).trim();
    if (/^specificatio(n)?$/i.test(s)) return 'Specification';
    for (var i = 0; i < TYPE_CD.length; i++) if (TYPE_CD[i].code.toLowerCase() === s.toLowerCase()) return TYPE_CD[i].code;
    return s;
  }
  function isTypeCd(v) { return TYPE_CD.some(function (t) { return t.code === v; }); }
  function isSystemCat(v) { return SYSTEM_CAT.some(function (t) { return t.code === v; }); }
  function normModel(m) { return String(m || '').trim().toUpperCase(); }
  function findSource(sources, model) {
    var k = normModel(model);
    if (!k) return null;
    for (var i = 0; i < (sources || []).length; i++) {
      if (normModel(sources[i].model) === k) return sources[i];
    }
    return null;
  }

  // 가동시간 DECIMAL(8,1): 정수부 7자리 + 소수 1자리
  function parseOHour(v) {
    var s = String(v == null ? '' : v).trim().replace(/,/g, '');
    if (!/^\d{1,7}(\.\d)?$/.test(s)) return null;
    return Math.round(parseFloat(s) * 10) / 10;
  }

  // ── 등록 양식 검증 ────────────────────────────────────────────
  // 결과: { ok, errors: [{field, code}] }. code 는 화면에서 문구로 바꿉니다.
  function validateRequest(form, sources) {
    var errors = [];
    function err(field, code) { errors.push({ field: field, code: code }); }
    var model = String(form.model || '').trim();
    if (!model) err('model', 'required');
    else if (model.length > MAX_LEN.model) err('model', 'too_long');
    else if (!findSource(sources, model)) err('model', 'model_not_registered');
    var serial = String(form.serial_no || '').trim();
    if (!serial) err('serial_no', 'required');
    else if (serial.length > MAX_LEN.serial_no) err('serial_no', 'too_long');
    if (String(form.o_hour == null ? '' : form.o_hour).trim() === '') err('o_hour', 'required');
    else if (parseOHour(form.o_hour) === null) err('o_hour', 'bad_number');
    if (!form.type_cd) err('type_cd', 'required');
    else if (!isTypeCd(form.type_cd)) err('type_cd', 'bad_code');
    if (!form.system_cat) err('system_cat', 'required');
    else if (!isSystemCat(form.system_cat)) err('system_cat', 'bad_code');
    if (!String(form.phenomenon || '').trim()) err('phenomenon', 'required');
    if (!String(form.requirement || '').trim()) err('requirement', 'required');
    return { ok: errors.length === 0, errors: errors };
  }

  // ── 첨부 파일명: 'ref_no_일련번호' + 원래 확장자 ───────────────
  // startSeq: 이 건에 이미 붙은 첨부 수 + 1 (후속 요청에서도 번호가 이어집니다)
  function imageFileNames(refNo, originalNames, startSeq) {
    var seq = startSeq || 1;
    return (originalNames || []).map(function (name, i) {
      var m = String(name).match(/\.([A-Za-z0-9]{1,5})$/);
      return refNo + '_' + (seq + i) + (m ? '.' + m[1].toLowerCase() : '');
    });
  }
  function splitList(s) {
    return String(s || '').split(/[;\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function countImages(db, refNo) {
    return db.inquiries.filter(function (q) { return q.ref_no === refNo; })
      .reduce(function (n, q) { return n + splitList(q.s_image).length; }, 0);
  }

  // 첨부 한 건: 파일명 문자열 또는 { name, type(MIME), duration(초, 영상만·모르면 null) }
  function fileName(f) { return typeof f === 'string' ? f : String((f && f.name) || ''); }
  function attachKind(f) {
    var type = typeof f === 'string' ? '' : String((f && f.type) || '');
    if (/^image\//i.test(type)) return 'image';
    if (/^video\//i.test(type)) return 'video';
    var m = fileName(f).match(/\.([A-Za-z0-9]{1,5})$/);
    var ext = m ? m[1].toLowerCase() : '';
    if (IMAGE_EXT.indexOf(ext) !== -1) return 'image';
    if (VIDEO_EXT.indexOf(ext) !== -1) return 'video';
    return 'other';
  }
  // 결과: { ok, errors: [{field:'s_image', code}], warnings: [{code, name}], images, videos }
  // 영상 길이를 읽지 못했으면(duration 이 null·NaN·Infinity) 막지 않고 경고만 냅니다.
  function validateAttachments(files) {
    var errors = [], warnings = [], images = 0, videos = 0;
    function err(code) { if (!errors.some(function (e) { return e.code === code; })) errors.push({ field: 's_image', code: code }); }
    (files || []).forEach(function (f) {
      var kind = attachKind(f);
      if (kind === 'image') images++;
      else if (kind === 'video') {
        videos++;
        var d = typeof f === 'string' ? null : f.duration;
        if (typeof d !== 'number' || !isFinite(d)) warnings.push({ code: 'video_duration_unknown', name: fileName(f) });
        else if (d > ATTACH_LIMIT.videoSeconds) err('video_too_long');
      } else err('bad_file_type');
    });
    if (images > ATTACH_LIMIT.images) err('too_many_images');
    if (videos > ATTACH_LIMIT.videos) err('too_many_videos');
    return { ok: errors.length === 0, errors: errors, warnings: warnings, images: images, videos: videos };
  }

  function clone(db) { return JSON.parse(JSON.stringify(db)); }

  // ── 신규 등록(기술지원1) ──────────────────────────────────────
  function createRequest(db, form, user, now, files) {
    var v = validateRequest(form, db.sources);
    var a = validateAttachments(files);
    if (!v.ok || !a.ok) return { ok: false, errors: v.errors.concat(a.errors) };
    var fileNames = (files || []).map(fileName);
    var out = clone(db);
    var refNo = nextRefNo(out.mains.map(function (m) { return m.ref_no; }), now);
    var date = toDateStr(now);
    var src = findSource(out.sources, form.model);
    out.mains.push({
      ref_no: refNo, status: STATUS.SUBMITTED, reg_date: date, reg_id: user.reg_id,
      model: src.model, serial_no: String(form.serial_no).trim(), o_hour: parseOHour(form.o_hour),
      type_cd: form.type_cd, system_cat: form.system_cat, action_content: '', complete_date: '', complete_image: ''
    });
    out.inquiries.push({
      ref_no: refNo, s_turn: 1, reg_date: date, reg_id: user.reg_id,
      phenomenon: String(form.phenomenon).trim(), requirement: String(form.requirement).trim(),
      s_image: imageFileNames(refNo, fileNames, 1).join('; ')
    });
    // 같은 모델·호기의 기 등록 건 — 막지 않고 알려서 PS 담당자 검토로 넘깁니다(Flowchart 「중복 검토」)
    return { ok: true, db: out, ref_no: refNo, duplicates: findDuplicates(out, refNo) };
  }

  // ── 후속 요청(기술지원3): s_turn 증가, 상태 다시 접수 ───────────
  function addFollowUp(db, refNo, form, user, now, files) {
    var out = clone(db);
    var main = out.mains.filter(function (m) { return m.ref_no === refNo; })[0];
    if (!main) return { ok: false, errors: [{ field: 'ref_no', code: 'not_found' }] };
    if (main.reg_id !== user.reg_id && user.user_type !== 'ADMIN') {
      return { ok: false, errors: [{ field: 'ref_no', code: 'not_owner' }] };
    }
    // 종료(조치 결과 등록)된 건은 다시 열지 않습니다 — 새 지원 요청으로 접수합니다
    if (main.status === STATUS.COMPLETED) return { ok: false, errors: [{ field: 'ref_no', code: 'already_completed' }] };
    var v = validateRequest(form, out.sources);
    var a = validateAttachments(files);
    if (!v.ok || !a.ok) return { ok: false, errors: v.errors.concat(a.errors) };
    var fileNames = (files || []).map(fileName);
    var turn = maxTurn(out.inquiries, refNo, 's_turn') + 1;
    var src = findSource(out.sources, form.model);
    main.model = src.model;
    main.serial_no = String(form.serial_no).trim();
    main.o_hour = parseOHour(form.o_hour);
    main.type_cd = form.type_cd;
    main.system_cat = form.system_cat;
    main.status = STATUS.SUBMITTED;
    out.inquiries.push({
      ref_no: refNo, s_turn: turn, reg_date: toDateStr(now), reg_id: user.reg_id,
      phenomenon: String(form.phenomenon).trim(), requirement: String(form.requirement).trim(),
      s_image: imageFileNames(refNo, fileNames, countImages(db, refNo) + 1).join('; ')
    });
    return { ok: true, db: out, ref_no: refNo, s_turn: turn };
  }

  function maxTurn(rows, refNo, key) {
    return rows.filter(function (r) { return r.ref_no === refNo; })
      .reduce(function (m, r) { return Math.max(m, Number(r[key]) || 0); }, 0);
  }

  // 후속 요청 팝업: 최근 1달간 본인이 등록한 건 (최신순)
  function oneMonthBefore(now) {
    var d = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    // 3/31 → 2/31 처럼 넘치면 전달 말일로 맞춤
    if (d.getMonth() === now.getMonth()) d = new Date(now.getFullYear(), now.getMonth(), 0);
    return d;
  }
  function recentOwnRequests(db, regId, now) {
    var from = toDateStr(oneMonthBefore(now));
    var to = toDateStr(now);
    return db.mains.filter(function (m) {
      return m.reg_id === regId && m.reg_date >= from && m.reg_date <= to;
    }).sort(function (a, b) { return a.ref_no < b.ref_no ? 1 : -1; });
  }

  function latestInquiry(db, refNo) {
    var t = maxTurn(db.inquiries, refNo, 's_turn');
    return db.inquiries.filter(function (q) { return q.ref_no === refNo && Number(q.s_turn) === t; })[0] || null;
  }
  function latestReply(db, refNo) {
    var t = maxTurn(db.replies, refNo, 'r_turn');
    return db.replies.filter(function (r) { return r.ref_no === refNo && Number(r.r_turn) === t; })[0] || null;
  }

  // ── AI 회신 (반자동) ─────────────────────────────────────────
  var AI_MARK = { title: '[제목]', summary: '[요약]', reply: '[회신]', ref: '[근거]', cannot: '[답변불가]' };

  function codeLabel(list, code) {
    var f = list.filter(function (t) { return t.code === code; })[0];
    return f ? f.code + '(' + f.ko + ')' : (code || '');
  }

  function buildAiPrompt(db, refNo) {
    var main = db.mains.filter(function (m) { return m.ref_no === refNo; })[0];
    if (!main) return '';
    var src = findSource(db.sources, main.model);
    var qs = db.inquiries.filter(function (q) { return q.ref_no === refNo; })
      .sort(function (a, b) { return a.s_turn - b.s_turn; });
    var rs = db.replies.filter(function (r) { return r.ref_no === refNo; })
      .sort(function (a, b) { return a.r_turn - b.r_turn; });
    var lines = [];
    lines.push('너는 지게차 제조사의 PS(Product Support) 기술지원 담당자야.');
    lines.push('지금 연결된 소스는 모델 ' + main.model + ' 의 정비 매뉴얼' +
      (src && src.notebook_name ? '(노트북: ' + src.notebook_name + ')' : '') + '이야.');
    lines.push('아래 현장 정비사의 기술지원 요청에 대해, 매뉴얼에 근거가 있는 내용만으로 답해줘.');
    lines.push('매뉴얼에서 근거를 찾을 수 없으면 추측하지 말고 [답변불가] 한 줄과 그 이유만 적어줘.');
    lines.push('');
    lines.push('## 요청 정보');
    lines.push('- 기준번호(ref_no): ' + main.ref_no);
    lines.push('- 모델(model): ' + main.model);
    lines.push('- 차량 호기(serial_no): ' + main.serial_no);
    lines.push('- 가동시간(o_hour): ' + main.o_hour);
    lines.push('- 유형(type_cd): ' + codeLabel(TYPE_CD, main.type_cd));
    lines.push('- 구분(system_cat): ' + codeLabel(SYSTEM_CAT, main.system_cat));
    qs.forEach(function (q) {
      var r = rs.filter(function (x) { return Number(x.r_turn) === Number(q.s_turn) - 1; })[0];
      if (q.s_turn > 1 && r) {
        lines.push('');
        lines.push('## 이전 회신 (' + r.r_turn + '차)');
        lines.push(r.reply_content);
      }
      lines.push('');
      lines.push('## ' + (q.s_turn > 1 ? '후속 요청 (' + q.s_turn + '차)' : '문의 (1차)'));
      lines.push('- 현상(phenomenon): ' + q.phenomenon);
      lines.push('- 요청사항(requirement): ' + q.requirement);
    });
    lines.push('');
    lines.push('## 답변 형식 (아래 네 머리말을 그대로 써줘)');
    lines.push(AI_MARK.title + ' 요청 내용을 한 문장으로 요약한 제목');
    lines.push(AI_MARK.summary + ' 정비사의 요청사항 요약 (2~3문장)');
    lines.push(AI_MARK.reply + ' 하자 원인, 점검 사항, 조치 방법을 순서대로');
    lines.push(AI_MARK.ref + ' 근거로 삼은 매뉴얼 이름과 페이지 (여러 개면 ; 로 구분)');
    return lines.join('\n');
  }

  // 붙여 넣은 AI 답변을 r_title·req_summary·reply_content·ref_info 로 나눕니다
  function parseAiAnswer(text) {
    var t = String(text || '').replace(/\r\n?/g, '\n').replace(/\*\*/g, '');
    var res = { r_title: '', req_summary: '', reply_content: '', ref_info: '', cannotAnswer: false, missing: [] };
    if (t.indexOf(AI_MARK.cannot) !== -1) {
      res.cannotAnswer = true;
      res.reply_content = t.split(AI_MARK.cannot).join('').trim();
      return res;
    }
    var keys = [['r_title', AI_MARK.title], ['req_summary', AI_MARK.summary], ['reply_content', AI_MARK.reply], ['ref_info', AI_MARK.ref]];
    var found = keys.map(function (k) { return { key: k[0], mark: k[1], at: t.indexOf(k[1]) }; })
      .filter(function (k) { return k.at !== -1; })
      .sort(function (a, b) { return a.at - b.at; });
    found.forEach(function (k, i) {
      var end = i + 1 < found.length ? found[i + 1].at : t.length;
      res[k.key] = t.slice(k.at + k.mark.length, end).trim();
    });
    if (!found.length) res.reply_content = t.trim(); // 머리말이 없으면 통째로 회신 내용
    res.ref_info = splitList(res.ref_info).join('; ');
    keys.forEach(function (k) { if (!res[k[0]]) res.missing.push(k[0]); });
    return res;
  }

  function addReply(db, refNo, reply, now) {
    var out = clone(db);
    var main = out.mains.filter(function (m) { return m.ref_no === refNo; })[0];
    if (!main) return { ok: false, errors: [{ field: 'ref_no', code: 'not_found' }] };
    if (!String(reply.reply_content || '').trim()) return { ok: false, errors: [{ field: 'reply_content', code: 'required' }] };
    var turn = maxTurn(out.replies, refNo, 'r_turn') + 1;
    out.replies.push({
      ref_no: refNo, r_turn: turn, r_reply_date: toDateStr(now),
      r_title: String(reply.r_title || '').trim(), req_summary: String(reply.req_summary || '').trim(),
      reply_content: String(reply.reply_content).trim(), ref_info: String(reply.ref_info || '').trim()
    });
    main.status = STATUS.ANSWERED;
    return { ok: true, db: out, r_turn: turn };
  }

  // 정비사가 해결 확인 → 조치 결과(조치 내용·완료일)를 적고 종료.
  // 회신이 없는 건은 종료할 수 없습니다. 완료일은 등록일 이후·오늘 이전이어야 합니다.
  // closing: { action_content, complete_date('YYYY-MM-DD', 비우면 오늘) }
  function completeRequest(db, refNo, closing, now) {
    closing = closing || {};
    now = now || new Date();
    var out = clone(db);
    var main = out.mains.filter(function (m) { return m.ref_no === refNo; })[0];
    if (!main) return { ok: false, errors: [{ field: 'ref_no', code: 'not_found' }] };
    if (main.status !== STATUS.ANSWERED) return { ok: false, errors: [{ field: 'status', code: 'not_answered' }] };
    var errors = [];
    var action = String(closing.action_content || '').trim();
    if (!action) errors.push({ field: 'action_content', code: 'required' });
    var raw = String(closing.complete_date || '').trim();
    var d = raw ? parseDate(raw) : now;
    var date = d && !isNaN(d) ? toDateStr(d) : '';
    if (!date) errors.push({ field: 'complete_date', code: 'bad_date' });
    else if (main.reg_date && date < main.reg_date) errors.push({ field: 'complete_date', code: 'date_before_reg' });
    else if (date > toDateStr(now)) errors.push({ field: 'complete_date', code: 'date_future' });
    // 완료 사진(선택) — 사진만, 최대 5장. 파일명은 'ref_no_C일련번호'(문의 첨부 'ref_no_일련번호'와 구분)
    var photos = closing.complete_image || [];
    var pc = validateAttachments(photos);
    if (pc.videos) errors.push({ field: 'complete_image', code: 'photo_only' });
    pc.errors.forEach(function (e) { errors.push({ field: 'complete_image', code: e.code }); });
    if (errors.length) return { ok: false, errors: errors };
    main.status = STATUS.COMPLETED;
    main.action_content = action;
    main.complete_date = date;
    main.complete_image = completeImageNames(refNo, photos.map(fileName)).join('; ');
    return { ok: true, db: out };
  }

  function completeImageNames(refNo, names) {
    return (names || []).map(function (name, i) {
      var m = String(name).match(/\.([A-Za-z0-9]{1,5})$/);
      return refNo + '_C' + (i + 1) + (m ? '.' + m[1].toLowerCase() : '');
    });
  }

  // ── 중복 등록 검토 (Flowchart 「기 등록 건?」) ─────────────────────
  // 같은 모델·같은 호기(serial_no)로 등록된 다른 건 중 아직 종료되지 않았거나 최근 1달 안에 등록된 건.
  // 등록을 막지는 않습니다 — 수강생 답변(2026-09-29)대로 PS 담당자에게 메일로 넘겨 검토합니다.
  function normSerial(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }
  function findDuplicates(db, refNo) {
    var me = db.mains.filter(function (m) { return m.ref_no === refNo; })[0];
    if (!me || !normSerial(me.serial_no)) return [];
    var base = parseDate(me.reg_date) || new Date();
    var from = toDateStr(oneMonthBefore(base));
    return db.mains.filter(function (m) {
      if (m.ref_no === refNo) return false;
      if (normModel(m.model) !== normModel(me.model) || normSerial(m.serial_no) !== normSerial(me.serial_no)) return false;
      return m.status !== STATUS.COMPLETED || (m.reg_date >= from && m.reg_date <= me.reg_date);
    }).sort(function (a, b) { return a.ref_no < b.ref_no ? 1 : -1; })
      .map(function (m) { return m.ref_no; });
  }

  // ── 회원 등록·승인 (2026-09-29 수강생 답변) ─────────────────────────
  // 사번이 없는 대리점 인원이 많아 본인이 정한 ID 로 가입하고, 기 등록 관리자가 승인해야 쓸 수 있습니다.
  var APPROVAL = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };
  var ID_RULE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,19}$/; // 영문·숫자로 시작, 3~20자 (reg_id VARCHAR(20))
  var EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // 옛 데이터(승인 칸 없음)의 사용자는 이미 쓰던 계정이므로 승인된 것으로 봅니다
  function approvalOf(u) { return (u && u.approval) || APPROVAL.APPROVED; }
  function isApproved(u) { return !!u && approvalOf(u) === APPROVAL.APPROVED; }
  function isApprovedAdmin(u) { return isApproved(u) && u.user_type === 'ADMIN'; }
  function findUserId(db, id) {
    var k = String(id || '').trim().toLowerCase();
    if (!k) return null;
    return db.users.filter(function (u) { return String(u.reg_id).toLowerCase() === k; })[0] || null;
  }
  // 중복 ID 확인 — 대소문자만 다른 ID 도 같은 ID 로 봅니다(Kim01 / kim01 혼동 방지)
  function checkRegId(db, id) {
    var s = String(id || '').trim();
    if (!s) return { ok: false, code: 'required' };
    if (!ID_RULE.test(s)) return { ok: false, code: 'bad_id' };
    if (findUserId(db, s)) return { ok: false, code: 'id_taken' };
    return { ok: true, code: 'id_ok' };
  }
  // 결과: { ok, errors, db, user, autoApproved }. 승인된 관리자가 한 명도 없으면(빈 DB) 첫 가입자를
  // 관리자로 바로 승인합니다 — 그렇지 않으면 아무도 승인할 수 없기 때문입니다.
  function registerMember(db, form, now) {
    var errors = [];
    var id = checkRegId(db, form.reg_id);
    if (!id.ok) errors.push({ field: 'reg_id', code: id.code });
    ['req_name', 'dealer'].forEach(function (k) { if (!String(form[k] || '').trim()) errors.push({ field: k, code: 'required' }); });
    var mail = String(form.e_mail || '').trim();
    if (!mail) errors.push({ field: 'e_mail', code: 'required' });
    else if (!EMAIL_RULE.test(mail)) errors.push({ field: 'e_mail', code: 'bad_email' });
    if (!form.territory_cd) errors.push({ field: 'territory_cd', code: 'required' });
    else if (TERRITORY_CD.indexOf(form.territory_cd) === -1) errors.push({ field: 'territory_cd', code: 'bad_code' });
    if (errors.length) return { ok: false, errors: errors };
    var out = clone(db);
    var first = !out.users.some(isApprovedAdmin);
    var today = toDateStr(now);
    var user = {
      reg_id: String(form.reg_id).trim(), req_name: String(form.req_name).trim(), e_mail: mail,
      phone: String(form.phone || '').trim(), country_cd: String(form.country_cd || '').trim(),
      dealer: String(form.dealer).trim(), join_date: today,
      user_type: first ? 'ADMIN' : 'USER', territory_cd: form.territory_cd,
      approval: first ? APPROVAL.APPROVED : APPROVAL.PENDING,
      approved_by: first ? '(첫 관리자 자동 승인)' : '', approved_date: first ? today : '', manage_territory: ''
    };
    out.users.push(user);
    return { ok: true, db: out, user: user, autoApproved: first };
  }
  // 로그인 가능 여부: { ok, code } — unknown_id / pending / rejected
  function canLogin(db, id) {
    var u = findUserId(db, id);
    if (!u) return { ok: false, code: 'unknown_id' };
    if (approvalOf(u) === APPROVAL.PENDING) return { ok: false, code: 'pending', user: u };
    if (approvalOf(u) === APPROVAL.REJECTED) return { ok: false, code: 'rejected', user: u };
    return { ok: true, user: u };
  }
  function listTerritories(s) {
    return splitList(s).filter(function (x, i, a) { return TERRITORY_CD.indexOf(x) !== -1 && a.indexOf(x) === i; });
  }
  // 관리자가 승인·반려하거나 권한·관리 지역을 바꿉니다.
  // change: { approval?, user_type?, manage_territory?(배열 또는 '경기; 경남') }
  function updateMember(db, regId, change, admin, now) {
    if (!isApprovedAdmin(admin)) return { ok: false, errors: [{ field: 'reg_id', code: 'not_admin' }] };
    var out = clone(db);
    var u = findUserId(out, regId);
    if (!u) return { ok: false, errors: [{ field: 'reg_id', code: 'not_found' }] };
    var next = {
      approval: change.approval || approvalOf(u),
      user_type: change.user_type || u.user_type || 'USER'
    };
    if ([APPROVAL.PENDING, APPROVAL.APPROVED, APPROVAL.REJECTED].indexOf(next.approval) === -1) return { ok: false, errors: [{ field: 'approval', code: 'bad_code' }] };
    if (USER_TYPE.indexOf(next.user_type) === -1) return { ok: false, errors: [{ field: 'user_type', code: 'bad_code' }] };
    // 승인된 관리자가 0명이 되면 아무도 승인할 수 없으므로 막습니다
    var wasAdmin = isApprovedAdmin(u);
    var staysAdmin = next.approval === APPROVAL.APPROVED && next.user_type === 'ADMIN';
    if (wasAdmin && !staysAdmin && out.users.filter(isApprovedAdmin).length <= 1) {
      return { ok: false, errors: [{ field: 'reg_id', code: 'last_admin' }] };
    }
    if (change.approval && change.approval !== approvalOf(u)) {
      u.approved_by = change.approval === APPROVAL.PENDING ? '' : admin.reg_id;
      u.approved_date = change.approval === APPROVAL.PENDING ? '' : toDateStr(now);
    }
    u.approval = next.approval;
    u.user_type = next.user_type;
    if (change.manage_territory != null) {
      var list = Array.isArray(change.manage_territory) ? change.manage_territory : splitList(change.manage_territory);
      u.manage_territory = listTerritories(list.join('; ')).join('; ');
    }
    if (u.user_type !== 'ADMIN') u.manage_territory = '';
    return { ok: true, db: out, user: u };
  }

  // ── PS 통보 메일 (AI 답변 불가·중복 등록) ────────────────────────────
  // 받는 사람: 요청자 지역(territory_cd)을 관리 지역으로 가진 승인된 관리자.
  // 그런 관리자가 없으면 승인된 관리자 전원에게 보내고 fallback 으로 표시합니다(메일이 아무에게도 안 가는 것을 막음).
  function psRecipients(db, refNo) {
    var main = db.mains.filter(function (m) { return m.ref_no === refNo; })[0];
    var requester = main ? userOf(db, main.reg_id) : null;
    var territory = requester ? requester.territory_cd || '' : '';
    var admins = db.users.filter(function (u) { return isApprovedAdmin(u) && EMAIL_RULE.test(String(u.e_mail || '')); });
    var matched = territory ? admins.filter(function (u) { return listTerritories(u.manage_territory).indexOf(territory) !== -1; }) : [];
    var list = matched.length ? matched : admins;
    return {
      territory: territory, fallback: !matched.length,
      to: list.map(function (u) { return u.e_mail; }), ids: list.map(function (u) { return u.reg_id; })
    };
  }
  var MAIL_REASON = { CANNOT: 'cannot_answer', DUPLICATE: 'duplicate' };
  function mailHeadLines(db, main, q) {
    var requester = userOf(db, main.reg_id) || {};
    return [
      '기준번호: ' + main.ref_no, '모델: ' + main.model, '차량 호기: ' + main.serial_no,
      '가동시간: ' + main.o_hour, '유형: ' + codeLabel(TYPE_CD, main.type_cd),
      '구분: ' + codeLabel(SYSTEM_CAT, main.system_cat),
      '요청자: ' + main.reg_id + (requester.dealer ? ' · ' + requester.dealer : '') + (requester.territory_cd ? ' · 지역 ' + requester.territory_cd : ''),
      '접수 차수: ' + q.s_turn, '', '현상: ' + q.phenomenon, '요청사항: ' + q.requirement
    ];
  }
  // reason: AI 가 적은 답변 불가 사유
  function buildPsMail(db, refNo, reason) {
    var main = db.mains.filter(function (m) { return m.ref_no === refNo; })[0];
    var q = latestInquiry(db, refNo);
    if (!main || !q) return null;
    var rc = psRecipients(db, refNo);
    return {
      reason: MAIL_REASON.CANNOT, ref_no: refNo, to: rc.to, fallback: rc.fallback, territory: rc.territory,
      subject: '[기술지원 이관] ' + main.ref_no + ' ' + main.model + ' — AI 답변 불가',
      body: ['PS 담당자님, AI가 매뉴얼에서 근거를 찾지 못한 기술지원 요청을 넘깁니다.', '']
        .concat(mailHeadLines(db, main, q))
        .concat(['', 'AI 답변 불가 사유: ' + (reason || '(없음)'), '',
          '검토 후 보완 자료를 소스 등록 화면에서 해당 모델 소스에 등록하고, AI 회신을 다시 받아 저장해 주세요.'])
        .join('\n')
    };
  }
  function buildDupMail(db, refNo, dupRefs) {
    var main = db.mains.filter(function (m) { return m.ref_no === refNo; })[0];
    var q = latestInquiry(db, refNo);
    if (!main || !q) return null;
    dupRefs = dupRefs || findDuplicates(db, refNo);
    var rc = psRecipients(db, refNo);
    var lines = dupRefs.map(function (r) {
      var m = db.mains.filter(function (x) { return x.ref_no === r; })[0] || {};
      var dq = latestInquiry(db, r) || {};
      return '- ' + r + ' · ' + (m.status || '') + ' · 등록 ' + (m.reg_date || '') + ' · ' + (m.reg_id || '') + ' · ' + (dq.phenomenon || '');
    });
    return {
      reason: MAIL_REASON.DUPLICATE, ref_no: refNo, to: rc.to, fallback: rc.fallback, territory: rc.territory,
      subject: '[기술지원 중복 검토] ' + main.ref_no + ' ' + main.model + ' ' + main.serial_no,
      body: ['PS 담당자님, 같은 모델·호기로 이미 등록된 건이 있는 기술지원 요청입니다. 검토 후 AI 회신을 진행해 주세요.', '']
        .concat(mailHeadLines(db, main, q))
        .concat(['', '기 등록 건(같은 모델·호기):'], lines).join('\n')
    };
  }
  // 메일 앱 열기 주소. 받는 사람이 여럿이면 쉼표로 잇습니다.
  function mailtoHref(mail) {
    var to = (Array.isArray(mail.to) ? mail.to : splitList(mail.mail_to || mail.to)).join(',');
    return 'mailto:' + to + '?subject=' + encodeURIComponent(mail.subject || '') + '&body=' + encodeURIComponent(mail.body || '');
  }
  // 발송 대기 목록에 넣습니다. 같은 건·같은 사유로 아직 대기 중인 메일이 있으면 새로 만들지 않고 내용을 갱신합니다.
  function queueMail(db, mail, now) {
    if (!mail) return { ok: false, db: db };
    var out = clone(db);
    out.mails = out.mails || [];
    var to = (Array.isArray(mail.to) ? mail.to : splitList(mail.to)).join('; ');
    var cur = out.mails.filter(function (x) { return x.ref_no === mail.ref_no && x.reason === mail.reason && x.status === 'Pending'; })[0];
    if (cur) {
      cur.mail_to = to; cur.subject = mail.subject; cur.body = mail.body;
      return { ok: true, db: out, mail: cur, updated: true };
    }
    var max = out.mails.reduce(function (n, x) { return Math.max(n, parseInt(String(x.mail_id).replace(/\D/g, ''), 10) || 0); }, 0);
    var row = {
      mail_id: 'M' + pad(max + 1, 5), ref_no: mail.ref_no, reason: mail.reason, mail_to: to,
      subject: mail.subject, body: mail.body, created_date: toDateTimeStr(now), status: 'Pending', sent_date: ''
    };
    out.mails.push(row);
    return { ok: true, db: out, mail: row, updated: false };
  }
  function markMailSent(db, mailId, now) {
    var out = clone(db);
    var m = (out.mails || []).filter(function (x) { return x.mail_id === mailId; })[0];
    if (!m) return { ok: false, db: db };
    m.status = 'Sent'; m.sent_date = toDateTimeStr(now);
    return { ok: true, db: out };
  }

  // ── 조회 목록 ────────────────────────────────────────────────
  function userOf(db, regId) { return db.users.filter(function (u) { return u.reg_id === regId; })[0] || null; }

  // 조회_User / 조회_Admin 공통 행. 열은 화면구성.xlsx 기준.
  function buildListRows(db) {
    return db.mains.map(function (m) {
      var q = latestInquiry(db, m.ref_no) || {};
      var first = db.inquiries.filter(function (x) { return x.ref_no === m.ref_no && Number(x.s_turn) === 1; })[0] || q;
      var r = latestReply(db, m.ref_no) || {};
      var u = userOf(db, m.reg_id) || {};
      return {
        status: m.status, ref_no: m.ref_no, count: maxTurn(db.inquiries, m.ref_no, 's_turn'),
        reg_date: m.reg_date, reg_id: m.reg_id, req_name: u.req_name || '', dealer: u.dealer || '',
        model: m.model, type_cd: m.type_cd, system_cat: m.system_cat,
        phenomenon: first.phenomenon || '', requirement: first.requirement || '',
        r_title: r.r_title || '', reply_content: r.reply_content || '',
        complete_date: m.complete_date || '', action_content: m.action_content || ''
      };
    }).sort(function (a, b) { return a.ref_no < b.ref_no ? 1 : -1; });
  }

  // filter: { reg_id(본인만), from, to, model, dealer, type_cd, system_cat, status }
  function filterRows(rows, f) {
    f = f || {};
    var model = normModel(f.model);
    return rows.filter(function (r) {
      if (f.reg_id && r.reg_id !== f.reg_id) return false;
      if (f.from && r.reg_date < f.from) return false;
      if (f.to && r.reg_date > f.to) return false;
      if (model && normModel(r.model).indexOf(model) === -1) return false;
      if (f.dealer && r.dealer !== f.dealer) return false;
      if (f.type_cd && r.type_cd !== f.type_cd) return false;
      if (f.system_cat && r.system_cat !== f.system_cat) return false;
      if (f.status && r.status !== f.status) return false;
      return true;
    });
  }

  // ── 접속 Log ────────────────────────────────────────────────
  function sessionMinutes(login, logout) {
    var a = parseDate(login), b = parseDate(logout);
    if (!a || !b || b < a) return null;
    return Math.round((b - a) / 60000);
  }
  // lang 'en' 이면 영어 표기(2026-09-30 한/영 화면)
  function formatDuration(min, lang) {
    if (min == null) return '';
    var h = Math.floor(min / 60), m = min % 60;
    if (lang === 'en') return (h ? h + ' h ' : '') + m + ' min';
    return (h ? h + '시간 ' : '') + m + '분';
  }
  function buildLogRows(db, f) {
    f = f || {};
    return db.logs.map(function (l) {
      var u = userOf(db, l.reg_id) || {};
      return {
        req_name: u.req_name || '', reg_id: l.reg_id, country_cd: u.country_cd || '', dealer: u.dealer || '',
        login_date: l.login_date, logout_date: l.logout_date || '',
        minutes: sessionMinutes(l.login_date, l.logout_date)
      };
    }).filter(function (r) {
      var day = String(r.login_date).slice(0, 10);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      if (f.user) {
        var k = String(f.user).toLowerCase();
        if (r.reg_id.toLowerCase().indexOf(k) === -1 && r.req_name.toLowerCase().indexOf(k) === -1) return false;
      }
      if (f.dealer && r.dealer !== f.dealer) return false;
      return true;
    }).sort(function (a, b) { return a.login_date < b.login_date ? 1 : -1; });
  }

  // ── 소스등록 ────────────────────────────────────────────────
  function upsertSource(db, src) {
    var model = String(src.model || '').trim();
    var nb = String(src.notebook_name || '').trim();
    var errors = [];
    if (!model) errors.push({ field: 'model', code: 'required' });
    else if (model.length > MAX_LEN.model) errors.push({ field: 'model', code: 'too_long' });
    if (!nb) errors.push({ field: 'notebook_name', code: 'required' });
    if (errors.length) return { ok: false, errors: errors };
    var out = clone(db);
    var cur = findSource(out.sources, model);
    var files = splitList(src.files);
    if (cur) {
      cur.notebook_name = nb;
      var merged = splitList(cur.files);
      files.forEach(function (f) { if (merged.indexOf(f) === -1) merged.push(f); });
      cur.files = merged.join('; ');
    } else {
      out.sources.push({ notebook_name: nb, model: model, files: files.join('; ') });
    }
    return { ok: true, db: out, updated: !!cur };
  }

  // ── 내보내기·가져오기 ─────────────────────────────────────────
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // 엑셀에서 한글이 깨지지 않도록 BOM 을 붙입니다
  function toCsv(headers, rows) {
    var out = [headers.map(function (h) { return csvCell(h.label); }).join(',')];
    rows.forEach(function (r) { out.push(headers.map(function (h) { return csvCell(r[h.key]); }).join(',')); });
    return '﻿' + out.join('\r\n');
  }

  // DB → { 시트명: [ [머리행], [값…] … ] }
  function dbToSheets(db) {
    var res = {};
    Object.keys(SHEETS).forEach(function (name) {
      var cols = SHEETS[name];
      res[name] = [cols.slice()].concat((db[SHEET_KEYS[name]] || []).map(function (row) {
        return cols.map(function (c) { return row[c] == null ? '' : row[c]; });
      }));
    });
    return res;
  }

  function cellToString(v) {
    if (v instanceof Date) return toDateStr(v);
    return v == null ? '' : String(v).trim();
  }

  // { 시트명: [[머리행], …] } → DB. 머리행 필드명이 DB 정의와 맞는 시트만 읽습니다.
  function sheetsToDb(sheets) {
    var db = emptyDb();
    var report = { read: [], skipped: [], problems: [] };
    Object.keys(SHEETS).forEach(function (name) {
      var rows = sheets[name];
      if (!rows || !rows.length) { report.skipped.push(name); return; }
      // 수강생 원본처럼 위에 제목 행이 있을 수 있어 필드명이 있는 행을 찾습니다
      var cols = SHEETS[name];
      var hIdx = -1;
      for (var i = 0; i < Math.min(rows.length, 5); i++) {
        var h = (rows[i] || []).map(cellToString);
        if (h.indexOf(cols[0]) !== -1 && h.indexOf(cols[1]) !== -1) { hIdx = i; break; }
      }
      if (hIdx === -1) { report.problems.push(name + ': 필드명 머리행을 찾지 못했습니다'); return; }
      var head = rows[hIdx].map(cellToString);
      var list = [];
      rows.slice(hIdx + 1).forEach(function (r) {
        if (!r || !r.some(function (c) { return cellToString(c) !== ''; })) return;
        var o = {};
        cols.forEach(function (c) {
          var j = head.indexOf(c);
          o[c] = j === -1 ? '' : cellToString(r[j]);
        });
        if (!o[cols[0]] && name !== '소스등록') return; // 코드값 안내 행 등은 건너뜀
        if (name === '소스등록' && !o.model) return;
        list.push(o);
      });
      list.forEach(function (o) {
        if ('s_turn' in o) o.s_turn = Number(o.s_turn) || 1;
        if ('r_turn' in o) o.r_turn = Number(o.r_turn) || 1;
        if ('o_hour' in o) o.o_hour = parseOHour(o.o_hour);
        if ('reg_date' in o) o.reg_date = o.reg_date ? toDateStr(parseDate(o.reg_date) || new Date(NaN)) : '';
        if ('r_reply_date' in o && o.r_reply_date) o.r_reply_date = toDateStr(parseDate(o.r_reply_date));
        if ('complete_date' in o && o.complete_date) {
          var cd = parseDate(o.complete_date);
          o.complete_date = cd ? toDateStr(cd) : o.complete_date;
        }
        if ('type_cd' in o) o.type_cd = normTypeCd(o.type_cd);
        if (name === '사용자' && !o.approval) o.approval = APPROVAL.APPROVED; // 옛 엑셀: 이미 쓰던 계정
        if (name === '메일' && !o.status) o.status = 'Pending';
      });
      db[SHEET_KEYS[name]] = list;
      report.read.push(name + ' ' + list.length + '건');
    });
    // 참조 무결성: 문의·회신의 ref_no 가 등록에 있어야 합니다
    var refs = {};
    db.mains.forEach(function (m) { refs[m.ref_no] = true; });
    ['inquiries', 'replies'].forEach(function (k) {
      var bad = db[k].filter(function (r) { return !refs[r.ref_no]; }).length;
      if (bad) report.problems.push((k === 'inquiries' ? '문의' : '회신') + ' 시트에 등록에 없는 ref_no ' + bad + '건');
    });
    db.mains.forEach(function (m) {
      if (m.status && !STATUS_META[m.status]) report.problems.push(m.ref_no + ': 알 수 없는 status "' + m.status + '"');
    });
    return { db: db, report: report };
  }

  var api = {
    STATUS: STATUS, STATUS_META: STATUS_META, TYPE_CD: TYPE_CD, SYSTEM_CAT: SYSTEM_CAT,
    USER_TYPE: USER_TYPE, TERRITORY_CD: TERRITORY_CD, SHEETS: SHEETS, SHEET_KEYS: SHEET_KEYS, AI_MARK: AI_MARK,
    ATTACH_LIMIT: ATTACH_LIMIT, attachKind: attachKind, validateAttachments: validateAttachments, normTypeCd: normTypeCd,
    emptyDb: emptyDb, toDateStr: toDateStr, toDateTimeStr: toDateTimeStr, parseDate: parseDate, displayDate: displayDate,
    nextRefNo: nextRefNo, findSource: findSource, parseOHour: parseOHour, validateRequest: validateRequest,
    imageFileNames: imageFileNames, splitList: splitList, createRequest: createRequest, addFollowUp: addFollowUp,
    oneMonthBefore: oneMonthBefore, recentOwnRequests: recentOwnRequests, latestInquiry: latestInquiry,
    latestReply: latestReply, buildAiPrompt: buildAiPrompt, parseAiAnswer: parseAiAnswer, addReply: addReply,
    completeRequest: completeRequest, buildPsMail: buildPsMail, buildDupMail: buildDupMail, completeImageNames: completeImageNames,
    findDuplicates: findDuplicates, APPROVAL: APPROVAL, approvalOf: approvalOf, isApproved: isApproved, isApprovedAdmin: isApprovedAdmin,
    findUserId: findUserId, checkRegId: checkRegId, registerMember: registerMember, canLogin: canLogin, updateMember: updateMember,
    listTerritories: listTerritories, psRecipients: psRecipients, MAIL_REASON: MAIL_REASON, mailtoHref: mailtoHref,
    queueMail: queueMail, markMailSent: markMailSent, codeLabel: codeLabel, userOf: userOf,
    buildListRows: buildListRows, filterRows: filterRows, sessionMinutes: sessionMinutes,
    formatDuration: formatDuration, buildLogRows: buildLogRows, upsertSource: upsertSource,
    toCsv: toCsv, dbToSheets: dbToSheets, sheetsToDb: sheetsToDb
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TSLogic = api;
})(typeof window !== 'undefined' ? window : this);
