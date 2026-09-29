/*
 * 매뉴얼 근거 검색 — 순수 로직 (화면·저장소·PDF 라이브러리와 무관)
 *
 * 사용자가 자기 PC 의 매뉴얼 PDF 를 불러오면, 브라우저가 페이지별 텍스트를 뽑아(app.js + vendor/pdfjs)
 * 이 모듈이 목차·키워드 검색·발췌를 맡습니다. 매뉴얼 원문은 리포에도 서버에도 올라가지 않고
 * 이 브라우저 안에만 남습니다. AI 프롬프트에는 고른 페이지의 발췌만 붙습니다(기획서 1장 「단편적 정보」).
 *
 * 매뉴얼 색인(index) 형식 — scripts/manual_to_json.py 가 만드는 JSON 과 같습니다.
 *   { format: 'data09-01.manual-index', version: 1, file, title, models, created,
 *     pages: [{ n: PDF 쪽번호(1부터), label: 인쇄된 쪽 표기('6-17' 등, 없으면 ''), text }] }
 */
(function (root) {
  'use strict';

  var FORMAT = 'data09-01.manual-index';
  // 인쇄된 쪽 표기: 0-1, 6-17, 8-4-1(추가 페이지), A-1(부록)
  var LABEL_RE = /^(?:\d{1,2}|[A-Z])-\d{1,3}(?:-\d{1,2})?$/;

  // ── PDF 텍스트 조각 → 줄 텍스트 ───────────────────────────────────
  // pdf.js getTextContent() 의 items: [{ str, transform:[a,b,c,d,x,y], width }]
  // 같은 높이(y)의 조각을 한 줄로 모으고, 위에서 아래·왼쪽에서 오른쪽 순서로 잇습니다.
  function itemsToText(items) {
    var rows = [];
    (items || []).forEach(function (it) {
      if (!it || typeof it.str !== 'string' || !it.transform) return;
      var x = it.transform[4], y = it.transform[5];
      var h = Math.abs(it.transform[3]) || 8;
      var row = null;
      for (var i = 0; i < rows.length; i++) {
        if (Math.abs(rows[i].y - y) <= Math.max(2, h * 0.3)) { row = rows[i]; break; }
      }
      if (!row) { row = { y: y, parts: [] }; rows.push(row); }
      row.parts.push({ x: x, w: it.width || 0, s: it.str, h: h });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      var line = '', end = null;
      var prev = null;
      r.parts.forEach(function (p) {
        // 굵게 보이려고 같은 글자를 겹쳐 두 번 찍은 PDF 가 있어(BRP-9 SM 제목) 겹친 같은 조각은 건너뜁니다
        if (prev && p.s === prev.s && Math.abs(p.x - prev.x) < Math.max(1, p.h * 0.5)) return;
        prev = p;
        if (end != null && p.x - end > p.h * 0.2 && !/\s$/.test(line) && !/^\s/.test(p.s)) line += ' ';
        line += p.s;
        end = p.x + p.w;
      });
      return line.replace(/\s+$/, '');
    }).filter(function (l) { return l.trim() !== ''; }).join('\n');
  }

  // 페이지 텍스트에서 인쇄된 쪽 표기를 찾습니다(따로 떨어진 줄 중 마지막 것)
  function pageLabel(text) {
    var lines = String(text || '').split('\n');
    for (var i = lines.length - 1; i >= 0; i--) {
      var s = lines[i].trim();
      if (LABEL_RE.test(s)) return s;
    }
    return '';
  }

  // ── 목차 (CONTENTS 쪽의 SECTION·Group 또는 1. 2. 항목) ──────────────
  // 쪽 표기로 끝나는 줄(점선·대시 리더 포함)을 항목으로, 쪽 표기가 없는 굵은 제목 줄을 큰 제목으로 봅니다.
  // 정규식을 잘게 나눈 이유: 점선 리더를 한 식으로 잡으면(중첩 반복) 리더가 긴 줄에서 역추적이 폭발합니다.
  var TOC_LABEL_END = /\s*((?:\d{1,2}|[A-Z])-\d{1,3})$/;
  var TOC_LEADER = /[.\-·–—]\s?[.\-·–—]\s?[.\-·–—]/;
  var TOC_NUMBERED = /^(?:Group\s+\d+|\d{1,2}\.)\s+\S/;
  function tocEntry(s) {
    var m = s.match(TOC_LABEL_END);
    if (!m) return null;
    var head = s.slice(0, m.index);
    if (!/[A-Za-z]/.test(head)) return null;
    if (!TOC_LEADER.test(head) && !TOC_NUMBERED.test(head)) return null;
    return [s, head, m[1]];
  }
  var TOC_HEAD = /^(?:SECTION\s+\d+\s+\S.*|\d{1,2}\.\s+[A-Z][A-Z0-9 &\/,'()-]{2,}|FOREWORDS?|APPENDIX.*|INDEX)$/;
  function cleanTitle(s) {
    return String(s).replace(/[\s.\-·–—]+$/, '').replace(/\s{2,}/g, ' ').trim();
  }
  function buildToc(pages, maxScan) {
    var entries = [], tocPages = [];
    var scan = (pages || []).slice(0, maxScan || 8);
    var started = false;
    scan.forEach(function (p) {
      var found = 0;
      var lines = String(p.text || '').split('\n');
      var local = [];
      lines.forEach(function (raw) {
        var s = raw.replace(/\s+/g, ' ').trim();
        if (!s || LABEL_RE.test(s) || /^CONTENTS$/i.test(s)) return;
        var m = tocEntry(s);
        if (m) {
          var title = cleanTitle(m[1]);
          if (TOC_HEAD.test(title) && /^(?:SECTION|APPENDIX)/.test(title)) local.push({ level: 1, title: title, label: m[2] });
          else local.push({ level: 2, title: title, label: m[2] });
          found++;
          return;
        }
        if (TOC_HEAD.test(s)) local.push({ level: 1, title: cleanTitle(s), label: '' });
      });
      // 목차 쪽은 쪽 표기로 끝나는 항목이 여러 개 있는 쪽입니다
      if (found >= 3) { started = true; tocPages.push(p.n); entries = entries.concat(local); }
      else if (started) started = false;
    });
    // 쪽 표기 → PDF 쪽번호 (처음 나오는 쪽). 목차 쪽 자신은 빼고 찾습니다.
    var map = {};
    (pages || []).forEach(function (p) {
      if (tocPages.indexOf(p.n) !== -1) return;
      var l = p.label || pageLabel(p.text);
      if (l && map[l] == null) map[l] = p.n;
    });
    entries.forEach(function (e) { e.page = e.label && map[e.label] != null ? map[e.label] : null; });
    // 큰 제목의 쪽은 바로 아래 첫 항목의 쪽
    entries.forEach(function (e, i) {
      if (e.level === 1 && e.page == null) {
        for (var j = i + 1; j < entries.length && entries[j].level === 2; j++) {
          if (entries[j].page != null) { e.page = entries[j].page; break; }
        }
      }
    });
    return { entries: entries, tocPages: tocPages };
  }

  // 이 쪽이 속한 목차 항목 (큰 제목 › 항목)
  function sectionOf(index, n) {
    var toc = (index && index.toc && index.toc.entries) || [];
    var head = null, item = null;
    toc.forEach(function (e) {
      if (e.page == null || e.page > n) return;
      if (e.level === 1) { if (!head || e.page >= head.page) { head = e; item = null; } }
      else if (!item || e.page >= item.page) item = e;
    });
    if (item && head && item.page < head.page) item = null;
    return [head && head.title, item && item.title].filter(Boolean).join(' › ');
  }

  // ── 모델 ────────────────────────────────────────────────────────
  function normKey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, ''); }
  // 파일 이름에서 적용 모델을 짐작합니다. 예: '15182023BRP-X OM' → 15BRP-X; 18BRP-X; 20BRP-X; 23BRP-X
  function guessModels(fileName) {
    var base = String(fileName || '').replace(/\.[^.]+$/, '');
    var m = base.match(/^((?:\d{2})+)\s*([A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)?)/i);
    if (m) {
      var fam = m[2].toUpperCase();
      return m[1].match(/\d{2}/g).map(function (d) { return d + fam; }).join('; ');
    }
    var f = base.match(/([A-Z]{2,}[A-Z0-9]*-[A-Z0-9]+)/i);
    return f ? f[1].toUpperCase() : '';
  }
  function guessTitle(fileName) {
    var base = String(fileName || '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    var kind = /\bSM\b/i.test(base) ? '정비 매뉴얼(Service Manual)' : /\bOM\b/i.test(base) ? '운전자 매뉴얼(Operator\'s Manual)' : '';
    return { title: base, kind: kind };
  }
  function familyOf(model) { return normKey(model).replace(/^\d+/, ''); }
  // 요청 모델과 매뉴얼의 관계: 'exact'(적용 모델에 있음) / 'family'(숫자만 다른 같은 계열, 예 30BRP-X ↔ 15BRP-X) / ''
  function modelMatch(index, model) {
    var k = normKey(model);
    if (!k) return '';
    var list = String(index.models || '').split(/[;,\n]/).map(normKey).filter(Boolean);
    if (list.indexOf(k) !== -1) return 'exact';
    var fam = familyOf(model);
    if (fam && fam.length >= 3 && list.some(function (x) { return familyOf(x) === fam; })) return 'family';
    return '';
  }
  // 검색 대상 매뉴얼: 적용 모델이 맞는 것 → 없으면 같은 계열 → 없으면 전부
  function pickManuals(indexes, model) {
    indexes = indexes || [];
    if (!model) return { list: indexes, match: 'all' };
    var ex = indexes.filter(function (x) { return modelMatch(x, model) === 'exact'; });
    if (ex.length) return { list: ex, match: 'exact' };
    var fa = indexes.filter(function (x) { return modelMatch(x, model) === 'family'; });
    if (fa.length) return { list: fa, match: 'family' };
    return { list: indexes, match: 'all' };
  }

  // ── 검색 ────────────────────────────────────────────────────────
  var STOP = ['the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'you', 'your', 'not', 'into', 'then', 'when'];
  function tokenize(q) {
    return String(q || '').toLowerCase()
      .split(/[^0-9a-z가-힣]+/)
      .filter(function (w) { return w && (/^\d+$/.test(w) ? w.length >= 2 : w.length >= 2) && STOP.indexOf(w) === -1; })
      .filter(function (w, i, a) { return a.indexOf(w) === i; });
  }
  function countTerm(lower, term) {
    // 영문·숫자는 낱말 경계로 셉니다(219 가 2190 에 걸리지 않도록). 한글은 그대로 포함 여부로 셉니다.
    if (/^[0-9a-z]+$/.test(term)) {
      var re = new RegExp('(^|[^0-9a-z])' + term + '(?=$|[^0-9a-z])', 'g');
      var n = 0; while (re.exec(lower)) n++;
      return n;
    }
    var c = 0, at = 0;
    while ((at = lower.indexOf(term, at)) !== -1) { c++; at += term.length; }
    return c;
  }
  // 결과: [{ file, title, n, label, score, hits:[term], snippet, section }] 점수 높은 순
  // opts: { model, limit(기본 10), includeToc(목차 쪽 포함, 기본 false) }
  function search(indexes, query, opts) {
    opts = opts || {};
    var terms = tokenize(query);
    if (!terms.length) return { terms: [], results: [], match: 'all' };
    var pick = pickManuals(indexes, opts.model);
    var pages = [];
    pick.list.forEach(function (ix) {
      var skip = (ix.toc && ix.toc.tocPages) || [];
      ix.pages.forEach(function (p) {
        if (!opts.includeToc && skip.indexOf(p.n) !== -1) return;
        pages.push({ ix: ix, p: p, lower: String(p.text || '').toLowerCase() });
      });
    });
    var df = {};
    terms.forEach(function (tm) { df[tm] = pages.filter(function (x) { return countTerm(x.lower, tm) > 0; }).length; });
    var N = pages.length || 1;
    var phrase = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
    var results = [];
    pages.forEach(function (x) {
      var score = 0, hits = [];
      terms.forEach(function (tm) {
        var c = countTerm(x.lower, tm);
        if (!c) return;
        hits.push(tm);
        score += (1 + Math.log(c)) * Math.log(1 + N / df[tm]);
      });
      if (!hits.length) return;
      score *= hits.length / terms.length + 0.5; // 여러 낱말이 함께 나오는 쪽을 앞으로
      if (phrase.length > 3 && hits.length > 1 && x.lower.replace(/\s+/g, ' ').indexOf(phrase) !== -1) score *= 1.5;
      results.push({
        file: x.ix.file, title: x.ix.title, n: x.p.n, label: x.p.label || '', score: Math.round(score * 1000) / 1000,
        hits: hits, snippet: snippet(x.p.text, hits), section: sectionOf(x.ix, x.p.n)
      });
    });
    results.sort(function (a, b) { return b.score - a.score || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.n - b.n); });
    return { terms: terms, results: results.slice(0, opts.limit || 10), total: results.length, match: pick.match };
  }
  // 첫 적중 낱말 주변 글
  function snippet(text, terms, radius) {
    radius = radius || 110;
    var flat = String(text || '').replace(/\s+/g, ' ').trim();
    var lower = flat.toLowerCase();
    var at = -1;
    (terms || []).some(function (tm) { at = lower.indexOf(tm); return at !== -1; });
    if (at === -1) return flat.slice(0, radius * 2);
    var from = Math.max(0, at - radius), to = Math.min(flat.length, at + radius);
    return (from > 0 ? '…' : '') + flat.slice(from, to) + (to < flat.length ? '…' : '');
  }

  // ── 접수 내용 → 검색 낱말 ─────────────────────────────────────────
  // 매뉴얼은 영문이라 한글 현상 설명으로는 검색되지 않습니다. 자주 쓰는 현장 용어를 영문으로 바꿔 줍니다.
  // (기획서 5장 「현장 용어 → 표준 용어 사전」의 씨앗. 사전 관리는 3단계)
  var GLOSSARY = [
    ['에러코드', 'error code'], ['에러 코드', 'error code'], ['에러', 'error'], ['고장코드', 'fault code'], ['경고등', 'warning lamp'],
    ['스티어링', 'steering'], ['조향', 'steering'], ['핸들', 'steering wheel'], ['브레이크', 'brake'], ['제동', 'brake'],
    ['유압', 'hydraulic'], ['마스트', 'mast'], ['포크', 'fork'], ['체인', 'chain'], ['리프트', 'lift'], ['틸트', 'tilt'],
    ['배터리', 'battery'], ['충전', 'charger'], ['퓨즈', 'fuse'], ['릴레이', 'relay'], ['커넥터', 'connector'], ['배선', 'wiring'],
    ['센서', 'sensor'], ['모터', 'motor'], ['스텝핑', 'stepper'], ['컨트롤러', 'controller'], ['클러스터', 'cluster'], ['계기판', 'cluster'],
    ['펌프', 'pump'], ['밸브', 'valve'], ['실린더', 'cylinder'], ['호스', 'hose'], ['누유', 'leak'], ['오일', 'oil'], ['필터', 'filter'],
    ['엔진', 'engine'], ['미션', 'transmission'], ['변속', 'transmission'], ['구동축', 'drive axle'], ['조향축', 'steering axle'],
    ['타이어', 'tire'], ['휠', 'wheel'], ['너트', 'nut'], ['토크', 'torque'], ['조임', 'tightening torque'],
    ['교환 주기', 'replacement interval'], ['교환주기', 'replacement interval'], ['점검', 'inspection'], ['소음', 'noise'],
    ['진동', 'vibration'], ['과열', 'overheat'], ['속도', 'speed'], ['주행', 'travel'], ['시동', 'start'], ['비상', 'emergency'],
    ['견인', 'towing'], ['캐빈', 'cabin'], ['케빈', 'cabin'], ['에어컨', 'air conditioner'], ['공조', 'hvac'], ['사양', 'specification'], ['제원', 'specification']
  ];
  function keywordsFromRequest(main, inquiry) {
    main = main || {}; inquiry = inquiry || {};
    var text = [inquiry.phenomenon, inquiry.requirement].join(' ');
    var out = [];
    function add(w) { w = String(w).toLowerCase(); if (w && out.indexOf(w) === -1) out.push(w); }
    // 에러코드 숫자, 영문 낱말(현장에서 그대로 적은 표기, 예 Stepper mot Mism)
    (text.match(/[A-Za-z][A-Za-z0-9-]{2,}|\d{2,4}/g) || []).forEach(function (w) {
      if (/^\d+$/.test(w) || STOP.indexOf(w.toLowerCase()) === -1) add(w);
    });
    GLOSSARY.forEach(function (g) { if (text.indexOf(g[0]) !== -1) g[1].split(' ').forEach(add); });
    if (main.system_cat) String(main.system_cat).split(' ').forEach(add);
    return out.slice(0, 12).join(' ');
  }

  // ── 프롬프트에 붙일 발췌 ──────────────────────────────────────────
  function refLabel(index, n) {
    var p = (index.pages || []).filter(function (x) { return x.n === n; })[0];
    return (index.title || index.file) + ' p.' + (p && p.label ? p.label : n);
  }
  function excerpt(text, maxChars) {
    maxChars = maxChars || 1800;
    var s = String(text || '').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
      .filter(Boolean).join('\n');
    return s.length > maxChars ? s.slice(0, maxChars) + '\n…(이하 생략)' : s;
  }
  // picks: [{ index, n }] → 프롬프트 끝에 붙일 글. 근거 표기를 그대로 쓰도록 요청합니다.
  function groundingBlock(picks, maxChars) {
    if (!picks || !picks.length) return '';
    var lines = ['', '## 매뉴얼 발췌 (근거 후보 — 사용자가 불러온 매뉴얼에서 고른 쪽)',
      '아래 발췌 안에서 근거를 찾아 답해줘. [근거]에는 각 발췌 머리의 표기(매뉴얼 이름 p.쪽)를 그대로 적어줘.',
      '발췌에 없는 내용은 추측하지 말고, 발췌로 답할 수 없으면 [답변불가]로 답해줘.'];
    picks.forEach(function (pk) {
      var p = (pk.index.pages || []).filter(function (x) { return x.n === pk.n; })[0];
      if (!p) return;
      var sec = sectionOf(pk.index, pk.n);
      lines.push('');
      lines.push('### [' + refLabel(pk.index, pk.n) + ']' + (sec ? ' ' + sec : '') + ' (PDF ' + pk.n + '쪽)');
      lines.push(excerpt(p.text, maxChars));
    });
    return lines.join('\n');
  }

  // 회신의 근거 표기('매뉴얼 이름 p.6-17')로 불러온 매뉴얼의 쪽을 찾습니다. 못 찾으면 null
  function findRef(indexes, ref) {
    var m = String(ref || '').match(/^(.*?)\s*p\.?\s*([0-9A-Z]+(?:-\d+){0,2})\s*$/i);
    if (!m) return null;
    var name = normKey(m[1]), lab = m[2].toUpperCase();
    for (var i = 0; i < (indexes || []).length; i++) {
      var ix = indexes[i];
      if (name && normKey(ix.title).indexOf(name) === -1 && name.indexOf(normKey(ix.title)) === -1 &&
          normKey(ix.file).indexOf(name) === -1) continue;
      var hit = ix.pages.filter(function (p) { return String(p.label).toUpperCase() === lab; })[0];
      if (!hit && /^\d+$/.test(lab)) hit = ix.pages.filter(function (p) { return p.n === Number(lab); })[0];
      if (hit) return { index: ix, n: hit.n };
    }
    return null;
  }

  // ── 색인 만들기·읽기 ─────────────────────────────────────────────
  // pages: [{ n, text, label? }] — label 이 없으면 텍스트에서 찾습니다.
  function makeIndex(meta, pages) {
    meta = meta || {};
    var ps = (pages || []).map(function (p, i) {
      var text = String(p.text || '');
      return { n: Number(p.n) || i + 1, label: p.label != null && p.label !== '' ? String(p.label) : pageLabel(text), text: text };
    });
    var g = guessTitle(meta.file);
    var ix = {
      format: FORMAT, version: 1, file: meta.file || '', title: meta.title || g.title, kind: meta.kind || g.kind,
      models: meta.models != null ? meta.models : guessModels(meta.file), created: meta.created || '', pages: ps
    };
    ix.toc = buildToc(ps);
    return ix;
  }
  // JSON(파이썬 스크립트 결과·내보낸 색인)을 읽습니다. 형식이 다르면 { ok:false, code }
  function readIndexJson(obj) {
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { return { ok: false, code: 'bad_json' }; } }
    if (!obj || obj.format !== FORMAT) return { ok: false, code: 'bad_format' };
    if (!Array.isArray(obj.pages) || !obj.pages.length) return { ok: false, code: 'no_pages' };
    var bad = obj.pages.some(function (p) { return !p || typeof p.text !== 'string'; });
    if (bad) return { ok: false, code: 'bad_pages' };
    return { ok: true, index: makeIndex(obj, obj.pages) };
  }
  // 목차를 빼고(다시 계산 가능) 저장용으로 줄인 사본
  function toStorable(ix) {
    return { format: FORMAT, version: 1, file: ix.file, title: ix.title, kind: ix.kind, models: ix.models, created: ix.created, pages: ix.pages };
  }

  var api = {
    FORMAT: FORMAT, itemsToText: itemsToText, pageLabel: pageLabel, buildToc: buildToc, sectionOf: sectionOf,
    guessModels: guessModels, guessTitle: guessTitle, modelMatch: modelMatch, pickManuals: pickManuals,
    tokenize: tokenize, search: search, snippet: snippet, keywordsFromRequest: keywordsFromRequest, GLOSSARY: GLOSSARY,
    refLabel: refLabel, excerpt: excerpt, groundingBlock: groundingBlock, findRef: findRef,
    makeIndex: makeIndex, readIndexJson: readIndexJson, toStorable: toStorable
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TSManual = api;
})(typeof window !== 'undefined' ? window : this);
