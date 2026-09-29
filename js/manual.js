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
  // 2026-09-29 추가 매뉴얼(25/30/35 DE-7·LE-7)은 쪽 표기가 '30 / 210'(PDF 쪽/전체) 또는 그냥 '26' 입니다
  var LABEL_OF_RE = /^(\d{1,4})\s*\/\s*\d{1,4}$/;
  var LABEL_NUM_RE = /^\d{1,4}$/;

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
      // 일부 PDF(LE-7 운전자 매뉴얼)는 빈칸을 NUL 문자로 넣어 둡니다
      row.parts.push({ x: x, w: it.width || 0, s: it.str.replace(/\u0000/g, ' '), h: h });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    // 줄 앞 들여쓰기를 공백으로 남깁니다 — 목차에서 큰 제목(들여쓰기 없음)과 항목을 가르는 데 씁니다
    var minX = Infinity;
    rows.forEach(function (r) { r.parts.forEach(function (p) { if (p.s.trim() && p.x < minX) minX = p.x; }); });
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      var firstP = r.parts.filter(function (p) { return p.s.trim(); })[0] || r.parts[0];
      var indent = isFinite(minX) ? Math.min(200, Math.max(0, Math.round((firstP.x - minX) / (firstP.h * 0.5)))) : 0;
      var line = new Array(indent + 1).join(' '), end = null;
      var prev = null;
      r.parts.forEach(function (p) {
        // 굵게 보이려고 같은 글자를 겹쳐 두 번 찍은 PDF 가 있어(BRP-9 SM 제목) 겹친 같은 조각은 건너뜁니다
        if (prev && p.s === prev.s && Math.abs(p.x - prev.x) < Math.max(1, p.h * 0.5)) return;
        prev = p;
        // 넓은 빈칸(두 단 목차의 단 사이 등)은 빈칸 수로 남기고, 보통 낱말 사이는 한 칸
        if (end != null && p.x - end > p.h * 1.8) line += new Array(Math.min(200, Math.round((p.x - end) / (p.h * 0.5))) + 1).join(' ');
        else if (end != null && p.x - end > p.h * 0.2 && !/\s$/.test(line) && !/^\s/.test(p.s)) line += ' ';
        line += p.s;
        // 빈칸만 있는 조각은 폭이 단 사이 빈칸 전체를 덮기도 해서, 끝 위치를 옮기지 않습니다(두 단 목차)
        if (p.s.trim()) end = p.x + p.w;
        else if (end == null) end = p.x;
      });
      return line.replace(/\s+$/, '');
    }).filter(function (l) { return l.trim() !== ''; }).join('\n');
  }
  function isPageMark(s) { return LABEL_RE.test(s) || LABEL_OF_RE.test(s) || LABEL_NUM_RE.test(s); }

  // 페이지 텍스트에서 인쇄된 쪽 표기를 찾습니다(따로 떨어진 줄 중 마지막 것)
  // '6-17' 형식을 먼저 찾고, 없으면 맨 아래 두 줄에서 '30 / 210'(→ 30)·'26' 형식을 봅니다
  function pageLabel(text) {
    var lines = String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    for (var i = lines.length - 1; i >= 0; i--) if (LABEL_RE.test(lines[i])) return lines[i];
    for (var j = lines.length - 1; j >= Math.max(0, lines.length - 2); j--) {
      var m = lines[j].match(LABEL_OF_RE);
      if (m) return String(Number(m[1]));
      if (LABEL_NUM_RE.test(lines[j])) return String(Number(lines[j]));
    }
    return '';
  }

  // ── 목차 (CONTENTS 쪽의 SECTION·Group 또는 1. 2. 항목) ──────────────
  // 쪽 표기로 끝나는 줄(점선·대시 리더 포함)을 항목으로, 쪽 표기가 없는 굵은 제목 줄을 큰 제목으로 봅니다.
  // 정규식을 잘게 나눈 이유: 점선 리더를 한 식으로 잡으면(중첩 반복) 리더가 긴 줄에서 역추적이 폭발합니다.
  // 쪽 표기는 '6-17' 또는 숫자만('121'). 숫자만인 것은 점선 리더가 있을 때만 목차 항목으로 봅니다(본문 숫자 오인 방지)
  var TOC_LABEL_END = /\s*((?:\d{1,2}|[A-Z])-\d{1,3}|\d{1,4})$/;
  var TOC_LEADER = /[.\-·–—]\s?[.\-·–—]\s?[.\-·–—]/;
  var TOC_NUMBERED = /^(?:Group\s*\d+|\d{1,2}\.)\s*\S/i;
  function tocEntry(s) {
    var m = s.match(TOC_LABEL_END);
    if (!m) return null;
    var head = s.slice(0, m.index);
    if (!/[A-Za-z]/.test(head)) return null;
    var leader = TOC_LEADER.test(head);
    if (!leader && (!TOC_NUMBERED.test(head) || LABEL_NUM_RE.test(m[1]))) return null;
    return [s, head, m[1]];
  }
  // SECTION2·GROUP1 처럼 붙여 쓴 표기도 받습니다(DE-7·LE-7 정비 매뉴얼)
  var TOC_HEAD = /^(?:SECTION\s*\d+\s*\S.*|\d{1,2}\.\s+[A-Z][A-Z0-9 &\/,'()-]{2,}|FOREWORDS?|APPENDIX.*|INDEX)$/;
  var TOC_TOP = /^(?:SECTION\s*\d|APPENDIX|FOREWORD)/i;
  function cleanTitle(s) {
    return String(s).replace(/[\s.\-·–—]+$/, '').replace(/\s{2,}/g, ' ').trim();
  }
  // 한 줄 → 단 조각 [{ text, col(시작 칸) }]. 넓은 빈칸(5칸 이상, 쪽 표기 뒤면 3칸 이상)에서 자르되, 'GROUP1   SAFETY HINTS' 처럼
  // 왼쪽이 번호뿐이거나 오른쪽이 리더·쪽 표기뿐이면 한 조각으로 둡니다.
  var BARE_NUM = /^(?:GROUP\s*\d+|SECTION\s*\d+|\d{1,2}\.?)$/i;
  var ONLY_LABEL = /^[.\-·–—\s]*(?:(?:\d{1,2}|[A-Z])-\d{1,3}|\d{1,4})$/;
  function tocSegments(raw) {
    var segs = [], re = /\S+(?: {1,2}\S+)*/g, m;
    while ((m = re.exec(String(raw || '')))) segs.push({ text: m[0], col: m.index });
    for (var i = segs.length - 1; i > 0; i--) {
      var gap = segs[i].col - (segs[i - 1].col + segs[i - 1].text.length);
      // 3~4칸 빈칸은 왼쪽 조각이 쪽 표기로 끝날 때만 단 경계로 봅니다('15. Step --- 1-17    5. Starting …')
      var narrow = gap < 5 && !TOC_LABEL_END.test(segs[i - 1].text);
      if (narrow || BARE_NUM.test(segs[i - 1].text) || ONLY_LABEL.test(segs[i].text)) {
        segs[i - 1].text += ' ' + segs[i].text;
        segs.splice(i, 1);
      }
    }
    return segs;
  }
  function buildToc(pages, maxScan) {
    var entries = [], tocPages = [];
    var scan = (pages || []).slice(0, maxScan || 8);
    var started = false;
    scan.forEach(function (p) {
      var found = 0;
      var lines = String(p.text || '').split('\n');
      var local = [];
      // 두 단 목차(100D-9V 운전자 매뉴얼): 한 줄에 왼쪽 단 항목과 오른쪽 단 항목이 넓은 빈칸(5칸 이상)을 두고 붙어 있습니다.
      // 줄을 단 조각으로 나눠 왼쪽 단을 다 읽은 뒤 오른쪽 단을 읽습니다.
      var segsByLine = lines.map(tocSegments);
      var rightStart = Infinity;
      segsByLine.forEach(function (segs) { if (segs.length > 1) rightStart = Math.min(rightStart, segs[1].col); });
      var cols = [[], []];
      segsByLine.forEach(function (segs) {
        segs.forEach(function (sg) {
          var right = isFinite(rightStart) && sg.col >= rightStart - 3;
          cols[right ? 1 : 0].push({ text: sg.text, indent: right ? sg.col - rightStart : sg.col });
        });
      });
      cols.forEach(function (list) {
        list.forEach(function (sg) {
          var s = sg.text.replace(/\s+/g, ' ').trim();
          if (!s || isPageMark(s) || /^CONTENTS$/i.test(s)) return;
          var m = tocEntry(s);
          if (m) {
            local.push({ level: 2, title: cleanTitle(m[1]), label: m[2], indent: sg.indent, col: list });
            found++;
            return;
          }
          if (TOC_HEAD.test(s)) local.push({ level: 1, title: cleanTitle(s), label: '', indent: sg.indent, col: list });
        });
      });
      // 큰 제목 가르기: SECTION·APPENDIX·FOREWORD 는 큰 제목. 쪽 표기 없는 제목 줄이나 SECTION 이 있는 쪽이면
      // 나머지는 항목. 둘 다 없는 쪽(DE-7·LE-7 운전자 매뉴얼처럼 모든 줄에 쪽 표기)은 단마다 들여쓰기가 가장 얕은 줄이 큰 제목
      var hasHead = local.some(function (e) { return !e.label || TOC_TOP.test(e.title); });
      cols.forEach(function (list) {
        var labeled = local.filter(function (e) { return e.label && e.col === list; });
        var minIndent = labeled.reduce(function (a, e) { return Math.min(a, e.indent); }, Infinity);
        labeled.forEach(function (e) {
          if (TOC_TOP.test(e.title)) e.level = 1;
          else if (!hasHead && e.indent <= minIndent + 1) e.level = 1;
        });
      });
      local.forEach(function (e) { delete e.indent; delete e.col; });
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
    // 숫자만인 쪽 표기가 그 쪽에 찍혀 있지 않으면(장 표지 등) 가장 가까운 앞 쪽 표기에서 쪽 수를 더해 찾습니다
    var nums = Object.keys(map).filter(function (k) { return LABEL_NUM_RE.test(k); }).map(Number).sort(function (a, b) { return a - b; });
    var total = (pages || []).length;
    entries.forEach(function (e) {
      e.page = e.label && map[e.label] != null ? map[e.label] : null;
      if (e.page == null && LABEL_NUM_RE.test(e.label) && nums.length) {
        var t = Number(e.label), k = null;
        nums.forEach(function (x) { if (x <= t) k = x; });
        if (k != null && map[k] + (t - k) <= total) e.page = map[k] + (t - k);
      }
    });
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
    var big = base.match(/^(\d{2,3}[A-Z]{1,3}-[0-9A-Z]+)/i); // 100D-9V
    if (big) return big[1].toUpperCase();
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
  // 소스 등록(모델 ↔ 매뉴얼 파일명 대응표)에서 이 모델의 매뉴얼을 찾습니다.
  // 대응표의 파일명은 '.pdf' 가 빠져 있기도 하고 ', ' 로 이어져 있어(Manual Medel Name.xlsx) 둘 다 받습니다.
  function normFile(s) { return String(s || '').trim().replace(/\.pdf$/i, '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, ''); }
  function sourceFiles(sources, model) {
    var k = normKey(model);
    if (!k) return [];
    var src = (sources || []).filter(function (x) { return normKey(x.model) === k; })[0];
    return src ? String(src.files || '').split(/[;,\n]/).map(normFile).filter(Boolean) : [];
  }
  function manualsBySource(indexes, sources, model) {
    var files = sourceFiles(sources, model);
    return (indexes || []).filter(function (ix) { return files.indexOf(normFile(ix.file)) !== -1; });
  }
  // 검색 대상 매뉴얼: 소스 등록 대응표에 연결된 것 → 적용 모델이 맞는 것 → 같은 계열 → 전부
  function pickManuals(indexes, model, sources) {
    indexes = indexes || [];
    if (!model) return { list: indexes, match: 'all' };
    var bySrc = manualsBySource(indexes, sources, model);
    if (bySrc.length) return { list: bySrc, match: 'source' };
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
    var pick = pickManuals(indexes, opts.model, opts.sources);
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

  // 모델 ↔ 매뉴얼 대응표(엑셀 행 배열) → 소스 등록 행. 머리행에서 model·notebook_name·파일명(files) 열을 찾습니다.
  // 결과: { rows: [{ model, notebook_name, files }], problem }
  function sourcesFromRows(rows) {
    rows = rows || [];
    var hi = -1, col = {};
    for (var i = 0; i < Math.min(rows.length, 5); i++) {
      var h = (rows[i] || []).map(function (c) { return String(c == null ? '' : c).trim().toLowerCase(); });
      if (h.indexOf('model') !== -1) {
        hi = i;
        col.model = h.indexOf('model');
        col.nb = h.indexOf('notebook_name');
        col.files = h.indexOf('files') !== -1 ? h.indexOf('files') : h.indexOf('파일명');
        break;
      }
    }
    if (hi === -1) return { rows: [], problem: 'no_header' };
    var out = [];
    rows.slice(hi + 1).forEach(function (r) {
      var model = String((r || [])[col.model] == null ? '' : r[col.model]).trim();
      if (!model) return;
      var nb = col.nb === -1 ? '' : String(r[col.nb] == null ? '' : r[col.nb]).trim();
      var files = col.files === -1 ? '' : String(r[col.files] == null ? '' : r[col.files]).split(/[;,\n]/)
        .map(function (x) { return x.trim(); }).filter(Boolean).join('; ');
      out.push({ model: model, notebook_name: nb || model, files: files });
    });
    return { rows: out, problem: out.length ? '' : 'no_rows' };
  }

  var api = {
    FORMAT: FORMAT, itemsToText: itemsToText, pageLabel: pageLabel, buildToc: buildToc, sectionOf: sectionOf,
    guessModels: guessModels, guessTitle: guessTitle, modelMatch: modelMatch, pickManuals: pickManuals,
    normFile: normFile, sourceFiles: sourceFiles, manualsBySource: manualsBySource, sourcesFromRows: sourcesFromRows,
    tokenize: tokenize, search: search, snippet: snippet, keywordsFromRequest: keywordsFromRequest, GLOSSARY: GLOSSARY,
    refLabel: refLabel, excerpt: excerpt, groundingBlock: groundingBlock, findRef: findRef,
    makeIndex: makeIndex, readIndexJson: readIndexJson, toStorable: toStorable
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TSManual = api;
})(typeof window !== 'undefined' ? window : this);
