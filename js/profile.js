/*
 * 회원 기본 정보(온보딩) — 순수 로직 (화면·서버와 무관, Node 테스트 가능)
 *
 * 2026-09-30 강사 결정: 「구글·카카오로 가입 → 이름, 전화번호, 딜러 여부, 국가, 지역을 추가로 받는다」
 *   - 가입·로그인은 공용 Supabase(구글·카카오), 이 사이트 회원 정보는 표 data0901_profiles
 *   - 이 모듈은 입력 검증, 국가 목록(ISO 3166-1 alpha-2, 국문/영문 이름), 지역 제안,
 *     국가·지역 → 관리 지역(territory_cd) 짐작, 서버 행 → 도구의 사용자 행 변환을 맡습니다.
 * 브라우저에서는 window.TSProfile, Node 에서는 module.exports.
 */
(function (root) {
  'use strict';

  // 전화번호: + 로 시작할 수 있고 숫자·빈칸·-·() 만, 숫자는 7~15자리(국제 표준 E.164 최대 15)
  // DB 제약(supabase/2026-09-30_data0901_auth.sql)과 같은 규칙입니다.
  var PHONE_RE = /^\+?[0-9][0-9 ()-]{5,24}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var MAX = { name: 50, dealer_name: 60, region: 60 };

  // 국내 관리 지역(수강생 사용자 시트의 territory_cd 중 국내분)
  var KR_TERRITORIES = ['경기', '경남', '전라', '충청', '강원', 'Direct Sales'];
  // 관리 지역 영문 표기 (국내 코드는 한글 값이 코드라 영어 화면에서 이 이름으로 보입니다)
  var TERRITORY_EN = {
    '경기': 'Gyeonggi', '경남': 'Gyeongnam', '전라': 'Jeolla', '충청': 'Chungcheong', '강원': 'Gangwon'
  };

  // [ISO, 국문, 영문, 해외 관리 지역]. 한국은 지역 입력으로 관리 지역을 정합니다.
  // 목록은 지게차 수출이 많은 나라 위주의 기본값입니다 — 빠진 나라는 추가 요청(기획서 12장 확인 질문).
  var COUNTRIES = [
    ['KR', '대한민국', 'Korea, Republic of', ''],
    ['US', '미국', 'United States', 'North America'],
    ['CA', '캐나다', 'Canada', 'North America'],
    ['MX', '멕시코', 'Mexico', 'North America'],
    ['BR', '브라질', 'Brazil', 'South America'],
    ['AR', '아르헨티나', 'Argentina', 'South America'],
    ['CL', '칠레', 'Chile', 'South America'],
    ['CO', '콜롬비아', 'Colombia', 'South America'],
    ['PE', '페루', 'Peru', 'South America'],
    ['GB', '영국', 'United Kingdom', 'Europe'],
    ['DE', '독일', 'Germany', 'Europe'],
    ['FR', '프랑스', 'France', 'Europe'],
    ['IT', '이탈리아', 'Italy', 'Europe'],
    ['ES', '스페인', 'Spain', 'Europe'],
    ['PT', '포르투갈', 'Portugal', 'Europe'],
    ['NL', '네덜란드', 'Netherlands', 'Europe'],
    ['BE', '벨기에', 'Belgium', 'Europe'],
    ['CH', '스위스', 'Switzerland', 'Europe'],
    ['AT', '오스트리아', 'Austria', 'Europe'],
    ['PL', '폴란드', 'Poland', 'Europe'],
    ['CZ', '체코', 'Czechia', 'Europe'],
    ['HU', '헝가리', 'Hungary', 'Europe'],
    ['RO', '루마니아', 'Romania', 'Europe'],
    ['SE', '스웨덴', 'Sweden', 'Europe'],
    ['NO', '노르웨이', 'Norway', 'Europe'],
    ['DK', '덴마크', 'Denmark', 'Europe'],
    ['FI', '핀란드', 'Finland', 'Europe'],
    ['GR', '그리스', 'Greece', 'Europe'],
    ['UA', '우크라이나', 'Ukraine', 'Europe'],
    ['RU', '러시아', 'Russia', 'Europe'],
    ['TR', '튀르키예', 'Türkiye', 'Middle East'],
    ['SA', '사우디아라비아', 'Saudi Arabia', 'Middle East'],
    ['AE', '아랍에미리트', 'United Arab Emirates', 'Middle East'],
    ['QA', '카타르', 'Qatar', 'Middle East'],
    ['KW', '쿠웨이트', 'Kuwait', 'Middle East'],
    ['OM', '오만', 'Oman', 'Middle East'],
    ['IL', '이스라엘', 'Israel', 'Middle East'],
    ['JO', '요르단', 'Jordan', 'Middle East'],
    ['IR', '이란', 'Iran', 'Middle East'],
    ['IQ', '이라크', 'Iraq', 'Middle East'],
    ['EG', '이집트', 'Egypt', 'Africa'],
    ['ZA', '남아프리카공화국', 'South Africa', 'Africa'],
    ['NG', '나이지리아', 'Nigeria', 'Africa'],
    ['KE', '케냐', 'Kenya', 'Africa'],
    ['MA', '모로코', 'Morocco', 'Africa'],
    ['DZ', '알제리', 'Algeria', 'Africa'],
    ['GH', '가나', 'Ghana', 'Africa'],
    ['ET', '에티오피아', 'Ethiopia', 'Africa'],
    ['JP', '일본', 'Japan', 'Asia'],
    ['CN', '중국', 'China', 'Asia'],
    ['TW', '대만', 'Taiwan', 'Asia'],
    ['HK', '홍콩', 'Hong Kong', 'Asia'],
    ['MN', '몽골', 'Mongolia', 'Asia'],
    ['VN', '베트남', 'Viet Nam', 'Asia'],
    ['TH', '태국', 'Thailand', 'Asia'],
    ['MY', '말레이시아', 'Malaysia', 'Asia'],
    ['SG', '싱가포르', 'Singapore', 'Asia'],
    ['ID', '인도네시아', 'Indonesia', 'Asia'],
    ['PH', '필리핀', 'Philippines', 'Asia'],
    ['MM', '미얀마', 'Myanmar', 'Asia'],
    ['KH', '캄보디아', 'Cambodia', 'Asia'],
    ['IN', '인도', 'India', 'Asia'],
    ['PK', '파키스탄', 'Pakistan', 'Asia'],
    ['BD', '방글라데시', 'Bangladesh', 'Asia'],
    ['LK', '스리랑카', 'Sri Lanka', 'Asia'],
    ['KZ', '카자흐스탄', 'Kazakhstan', 'Asia'],
    ['UZ', '우즈베키스탄', 'Uzbekistan', 'Asia'],
    ['AU', '호주', 'Australia', 'Oceania'],
    ['NZ', '뉴질랜드', 'New Zealand', 'Oceania']
  ].map(function (r) { return { code: r[0], ko: r[1], en: r[2], territory: r[3] }; });

  // 지역 제안(자유 입력 칸의 목록). 국내는 수강생 관리 지역 이름, 해외는 대표 지역 몇 개만.
  var REGION_SUGGEST = {
    KR: KR_TERRITORIES.concat(['서울', '인천', '부산', '대구', '광주', '대전', '울산', '세종', '제주']),
    US: ['California', 'Texas', 'Illinois', 'Georgia', 'New York', 'Ohio', 'Florida'],
    DE: ['Bavaria', 'Baden-Württemberg', 'North Rhine-Westphalia', 'Hesse', 'Lower Saxony'],
    GB: ['England', 'Scotland', 'Wales', 'Northern Ireland'],
    JP: ['Tokyo', 'Osaka', 'Aichi', 'Kanagawa', 'Fukuoka'],
    CN: ['Shanghai', 'Beijing', 'Guangdong', 'Jiangsu', 'Shandong', 'Zhejiang'],
    AU: ['New South Wales', 'Victoria', 'Queensland', 'Western Australia', 'South Australia'],
    BR: ['São Paulo', 'Rio de Janeiro', 'Minas Gerais', 'Paraná', 'Rio Grande do Sul'],
    IN: ['Maharashtra', 'Tamil Nadu', 'Karnataka', 'Gujarat', 'Delhi'],
    VN: ['Ho Chi Minh City', 'Hanoi', 'Binh Duong', 'Dong Nai', 'Hai Phong']
  };

  function trim(v) { return String(v == null ? '' : v).trim(); }
  function findCountry(code) {
    var c = trim(code).toUpperCase();
    return COUNTRIES.filter(function (x) { return x.code === c; })[0] || null;
  }
  function countryName(code, lang) {
    var c = findCountry(code);
    return c ? (lang === 'en' ? c.en : c.ko) : trim(code);
  }
  // 화면 언어 순서로 정렬한 국가 목록 (대한민국은 맨 위)
  function countryOptions(lang) {
    var first = COUNTRIES[0];
    var rest = COUNTRIES.slice(1).slice().sort(function (a, b) {
      var x = lang === 'en' ? a.en : a.ko, y = lang === 'en' ? b.en : b.ko;
      return x.localeCompare(y, lang === 'en' ? 'en' : 'ko');
    });
    return [first].concat(rest).map(function (c) { return { code: c.code, label: (lang === 'en' ? c.en : c.ko) + ' (' + c.code + ')' }; });
  }
  function regionSuggestions(code) { return (REGION_SUGGEST[trim(code).toUpperCase()] || []).slice(); }
  function territoryLabel(code, lang) { return lang === 'en' && TERRITORY_EN[code] ? TERRITORY_EN[code] : code; }

  // 관리 지역(territory_cd) — PS 메일을 받을 관리자를 고르는 기준.
  // 한국: 지역 칸이 국내 관리 지역 이름과 같을 때만(예 「경기」). 서울·부산처럼 다르면 비워 두고
  //       관리자가 「회원 관리」에서 정합니다(비어 있으면 메일은 관리자 전원에게 갑니다).
  // 해외: 국가의 대륙 구분(Europe 등).
  function territoryFor(countryCd, region) {
    var c = findCountry(countryCd);
    if (!c) return '';
    if (c.code === 'KR') {
      var r = trim(region);
      var hit = KR_TERRITORIES.filter(function (x) {
        return x.toLowerCase() === r.toLowerCase() || (TERRITORY_EN[x] || '').toLowerCase() === r.toLowerCase();
      })[0];
      return hit || '';
    }
    return c.territory || '';
  }

  function phoneDigits(p) { return trim(p).replace(/[^0-9]/g, ''); }
  function isPhone(p) {
    var s = trim(p);
    var n = phoneDigits(s).length;
    return PHONE_RE.test(s) && n >= 7 && n <= 15;
  }

  // 입력 검증. form: { name, phone, e_mail, is_dealer('Y'|'N'|true|false), dealer_name, country_cd, region }
  // 결과: { ok, errors: [{ field, code }], value } — value 는 서버에 보낼 정리된 값
  function validateOnboarding(form) {
    form = form || {};
    var errors = [];
    function err(f, c) { errors.push({ field: f, code: c }); }
    var name = trim(form.name), phone = trim(form.phone), mail = trim(form.e_mail);
    var dealerRaw = form.is_dealer;
    var isDealer = dealerRaw === true || dealerRaw === 'Y' ? true : dealerRaw === false || dealerRaw === 'N' ? false : null;
    var dealerName = trim(form.dealer_name), country = trim(form.country_cd).toUpperCase(), region = trim(form.region);

    if (!name) err('name', 'required'); else if (name.length > MAX.name) err('name', 'too_long_50');
    if (!phone) err('phone', 'required'); else if (!isPhone(phone)) err('phone', 'bad_phone');
    if (!mail) err('e_mail', 'required'); else if (!EMAIL_RE.test(mail)) err('e_mail', 'bad_email');
    if (isDealer === null) err('is_dealer', 'required');
    if (dealerName.length > MAX.dealer_name) err('dealer_name', 'too_long_60');
    if (!country) err('country_cd', 'required'); else if (!findCountry(country)) err('country_cd', 'bad_code');
    if (!region) err('region', 'required'); else if (region.length > MAX.region) err('region', 'too_long_60');
    if (errors.length) return { ok: false, errors: errors };
    return {
      ok: true, errors: [],
      value: {
        name: name, phone: phone, e_mail: mail, is_dealer: isDealer,
        dealer_name: isDealer ? dealerName : '', country_cd: country, region: region,
        territory_cd: territoryFor(country, region)
      }
    };
  }

  // 딜러 칸 표시값(도구의 사용자 시트 dealer) — 딜러사명이 있으면 그것, 없으면 구분만
  function dealerText(p) {
    if (!p) return '';
    if (p.is_dealer) return trim(p.dealer_name) || 'Dealer';
    return 'HQ/Staff';
  }

  // 서버 회원 행 → 도구의 사용자 행(사용자 시트 형식). 이 행을 로컬 사용자 목록에 두어
  // 조회·상세·PS 메일 받는 사람 고르기(관리 지역) 같은 기존 로직을 그대로 씁니다.
  function toLocalUser(p, isAdmin) {
    var approval = p.approval || 'Pending';
    var admin = !!isAdmin || p.role === 'ADMIN';
    return {
      reg_id: p.reg_id, req_name: p.name, e_mail: p.e_mail, phone: p.phone,
      country_cd: p.country_cd, dealer: dealerText(p),
      join_date: String(p.created_at || '').slice(0, 10), user_type: admin ? 'ADMIN' : 'USER',
      territory_cd: p.territory_cd || '', approval: approval,
      approved_by: p.approved_by_name || '', approved_date: String(p.approved_at || '').slice(0, 10),
      manage_territory: p.manage_territory || '',
      region: p.region || '', user_id: p.user_id, _server: true
    };
  }

  // www_profiles(전 사이트 공용 회원) 에 넣을 값 — 비어 있는 칸만 채우고, 가입 출처는 처음 한 번만.
  // 가입 출처는 도메인 첫 라벨 규칙(www_norm_site)과 같은 'hdx-ps' 를 명시합니다.
  var SITE_ID = 'hdx-ps';
  function wwwPatch(www, value) {
    www = www || {};
    var patch = { name: value.name, phone: value.phone, email: value.e_mail };
    if (!trim(www.org)) patch.org = value.is_dealer ? (value.dealer_name || 'Dealer') : 'HQ/Staff';
    if (!trim(www.signup_site)) patch.signup_site = SITE_ID;
    return patch;
  }

  var api = {
    SITE_ID: SITE_ID, PHONE_RE: PHONE_RE, COUNTRIES: COUNTRIES, KR_TERRITORIES: KR_TERRITORIES, TERRITORY_EN: TERRITORY_EN,
    findCountry: findCountry, countryName: countryName, countryOptions: countryOptions, regionSuggestions: regionSuggestions,
    territoryFor: territoryFor, territoryLabel: territoryLabel, isPhone: isPhone, validateOnboarding: validateOnboarding,
    dealerText: dealerText, toLocalUser: toLocalUser, wwwPatch: wwwPatch
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TSProfile = api;
})(typeof window !== 'undefined' ? window : this);
