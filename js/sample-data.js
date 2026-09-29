/*
 * 예시 데이터 — 시연용으로 만든 가상의 기록입니다. 실제 기술지원 기록이 아닙니다.
 * 30BRP-X · 에러코드 219 문의는 수강생 화면 설계서(화면구성.xlsx)의 예시 문구를 옮겼고,
 * 나머지 모델·호기·사람·딜러·회신은 모두 지어낸 값입니다(이름에 「예시」를 붙였습니다).
 * 날짜는 불러오는 날을 기준으로 며칠 전으로 계산합니다(후속 요청의 「최근 1달」 팝업이 바로 보이도록).
 */
(function (root) {
  'use strict';
  function day(now, back) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function refOf(date, n) { return date.replace(/-/g, '') + ('000' + n).slice(-4); }

  function build(now) {
    now = now || new Date();
    var d20 = day(now, 20), d12 = day(now, 12), d5 = day(now, 5), d3 = day(now, 3), d1 = day(now, 1), d0 = day(now, 0);
    var r1 = refOf(d20, 1), r2 = refOf(d12, 1), r3 = refOf(d5, 1), r4 = refOf(d3, 1), r5 = refOf(d1, 1);
    return {
      users: [
        { reg_id: 'demo_user01', req_name: '예시 정비사1', e_mail: 'user01@example.com', phone: '010-0000-0001', country_cd: 'KR', dealer: '예시딜러 경기북부', join_date: day(now, 60), user_type: 'USER', territory_cd: '경기', approval: 'Approved', approved_by: 'demo_admin', approved_date: day(now, 60), manage_territory: '' },
        { reg_id: 'demo_user02', req_name: '예시 정비사2', e_mail: 'user02@example.com', phone: '010-0000-0002', country_cd: 'KR', dealer: '예시딜러 경남', join_date: day(now, 45), user_type: 'USER', territory_cd: '경남', approval: 'Approved', approved_by: 'demo_admin', approved_date: day(now, 45), manage_territory: '' },
        { reg_id: 'demo_eu01', req_name: 'Sample Mechanic EU', e_mail: 'eu01@example.com', phone: '+00-000-0003', country_cd: 'DE', dealer: 'Sample Dealer Europe', join_date: day(now, 40), user_type: 'USER', territory_cd: 'Europe', approval: 'Approved', approved_by: 'demo_admin_gl', approved_date: day(now, 40), manage_territory: '' },
        { reg_id: 'demo_admin', req_name: '예시 PS담당자', e_mail: 'ps@example.com', phone: '010-0000-0009', country_cd: 'KR', dealer: '본사 PS팀(예시)', join_date: day(now, 90), user_type: 'ADMIN', territory_cd: 'Direct Sales', approval: 'Approved', approved_by: '(첫 관리자 자동 승인)', approved_date: day(now, 90), manage_territory: '경기; 경남; 전라; 충청; 강원; Direct Sales' },
        // 해외 지역 담당 관리자 — 지역별 PS 메일 배정(관리 지역) 시연용
        { reg_id: 'demo_admin_gl', req_name: '예시 해외PS담당자', e_mail: 'ps-global@example.com', phone: '010-0000-0008', country_cd: 'KR', dealer: '본사 PS팀(예시)', join_date: day(now, 80), user_type: 'ADMIN', territory_cd: 'Direct Sales', approval: 'Approved', approved_by: 'demo_admin', approved_date: day(now, 80), manage_territory: 'Europe; North America; South America; Middle East; Africa; Asia; Oceania' },
        // 가입 신청 후 승인 대기 중인 계정 — 관리자 「회원 관리」에서 승인해야 로그인됩니다
        { reg_id: 'demo_new01', req_name: '예시 신규정비사', e_mail: 'new01@example.com', phone: '010-0000-0010', country_cd: 'KR', dealer: '예시딜러 충청', join_date: day(now, 0), user_type: 'USER', territory_cd: '충청', approval: 'Pending', approved_by: '', approved_date: '', manage_territory: '' }
      ],
      sources: [
        { notebook_name: '30BRP-X 정비매뉴얼(예시)', model: '30BRP-X', files: '30BRP-X_Service_Manual_예시.pdf' },
        { notebook_name: 'DEMO-25D 정비매뉴얼(예시)', model: 'DEMO-25D', files: 'DEMO-25D_Service_Manual_예시.pdf' },
        { notebook_name: 'DEMO-50E 정비매뉴얼(예시)', model: 'DEMO-50E', files: '' },
        // 수강생 제출 「Manual Medel Name.xlsx」(2026-09-29) — 모델 ↔ 매뉴얼 파일 대응표. 제품 모델명·매뉴얼 파일명뿐이라 그대로 싣습니다.
        // 매뉴얼 PDF 자체는 리포에 없습니다(사용자가 「매뉴얼 근거」에서 자기 PC 의 파일을 불러옴).
        { notebook_name: '15/18/20/23BRP-9', model: '15BRP-9', files: 'BRP-9_OM.pdf; BRP-9_SM' },
        { notebook_name: '15/18/20/23BRP-9', model: '18BRP-9', files: 'BRP-9_OM.pdf; BRP-9_SM' },
        { notebook_name: '15/18/20/23BRP-9', model: '20BRP-9', files: 'BRP-9_OM.pdf; BRP-9_SM' },
        { notebook_name: '15/18/20/23BRP-9', model: '23BRP-9', files: 'BRP-9_OM.pdf; BRP-9_SM' },
        { notebook_name: '15/18/20/23BRP-X', model: '15BRP-X', files: '15BRP-X SM_EXP.pdf; 15182023BRP-X OM' },
        { notebook_name: '15/18/20/23BRP-X', model: '18BRP-X', files: '15BRP-X SM_EXP.pdf; 15182023BRP-X OM' },
        { notebook_name: '15/18/20/23BRP-X', model: '20BRP-X', files: '15BRP-X SM_EXP.pdf; 15182023BRP-X OM' },
        { notebook_name: '15/18/20/23BRP-X', model: '23BRP-X', files: '15BRP-X SM_EXP.pdf; 15182023BRP-X OM' },
        { notebook_name: '100D-9V', model: '100D-9V', files: '100D-9V OM EXP.pdf; 100D-9V SM ENG' },
        { notebook_name: '25/30/35DE-7', model: '25DE-7', files: '253035DE-7 OM; 253035DE-7 SM' },
        { notebook_name: '25/30/35DE-7', model: '30DE-7', files: '253035DE-7 OM; 253035DE-7 SM' },
        { notebook_name: '25/30/35DE-7', model: '35DE-7', files: '253035DE-7 OM; 253035DE-7 SM' },
        { notebook_name: '25/30/35LE-7', model: '25LE-7', files: '253035LE-7 OM; 253035LE-7 SM' },
        { notebook_name: '25/30/35LE-7', model: '30LE-7', files: '253035LE-7 OM; 253035LE-7 SM' },
        { notebook_name: '25/30/35LE-7', model: '35LE-7', files: '253035LE-7 OM; 253035LE-7 SM' }
      ],
      mains: [
        { ref_no: r1, status: 'Completed', reg_date: d20, reg_id: 'demo_user01', model: '30BRP-X', serial_no: 'UNFCFB18CF0000452', o_hour: 1234.5, type_cd: 'Troubleshooting', system_cat: 'Engine', action_content: '(예시) 스텝핑 모터 커넥터 접촉 불량 확인 — 커넥터 재체결 후 에러코드 219 해제, 조향 정상 확인.', complete_date: day(now, 19), complete_image: r1 + '_C1.jpg' },
        { ref_no: r2, status: 'Answered', reg_date: d12, reg_id: 'demo_user01', model: 'DEMO-25D', serial_no: 'DEMO25D-000101', o_hour: 3050, type_cd: 'Maintenance', system_cat: 'Engine', action_content: '', complete_date: '', complete_image: '' },
        { ref_no: r3, status: 'Submitted', reg_date: d5, reg_id: 'demo_user02', model: 'DEMO-50E', serial_no: 'DEMO50E-000077', o_hour: 812.3, type_cd: 'Specification', system_cat: 'Drive Axle', action_content: '', complete_date: '', complete_image: '' },
        { ref_no: r4, status: 'Submitted', reg_date: d3, reg_id: 'demo_user01', model: '30BRP-X', serial_no: 'UNFCFB18CF0000510', o_hour: 420, type_cd: 'Troubleshooting', system_cat: 'Hydraulic', action_content: '', complete_date: '', complete_image: '' },
        { ref_no: r5, status: 'Answered', reg_date: d1, reg_id: 'demo_eu01', model: 'DEMO-25D', serial_no: 'DEMO25D-000233', o_hour: 5210.8, type_cd: 'Troubleshooting', system_cat: 'Electric', action_content: '', complete_date: '', complete_image: '' }
      ],
      inquiries: [
        { ref_no: r1, s_turn: 1, reg_date: d20, reg_id: 'demo_user01', phenomenon: '클러스터에 에러코드 219, Stepper mot Mism 이라고 뜨며 스티어링 휠이 잠긴 상태임.', requirement: '하자원인, 점검사항 및 조치 사항에 대해 알려주세요.', s_image: r1 + '_1.jpg; ' + r1 + '_2.jpg' },
        { ref_no: r2, s_turn: 1, reg_date: d12, reg_id: 'demo_user01', phenomenon: '(예시) 엔진오일 교환 주기를 고객이 문의함.', requirement: '(예시) 가동시간 기준 엔진오일·필터 교환 주기를 알려주세요.', s_image: '' },
        { ref_no: r2, s_turn: 2, reg_date: d5, reg_id: 'demo_user01', phenomenon: '(예시) 엔진오일 교환 주기를 고객이 문의함. 분진이 많은 현장에서 운행 중.', requirement: '(예시) 분진이 많은 가혹 조건일 때 교환 주기가 달라지는지 알려주세요.', s_image: r2 + '_1.jpg' },
        { ref_no: r3, s_turn: 1, reg_date: d5, reg_id: 'demo_user02', phenomenon: '(예시) 구동축 휠 너트 교체 후 재조립 예정.', requirement: '(예시) 휠 너트 조임 토크 값을 알려주세요.', s_image: '' },
        { ref_no: r4, s_turn: 1, reg_date: d3, reg_id: 'demo_user01', phenomenon: '(예시) 마스트 상승 속도가 평소보다 느림.', requirement: '(예시) 점검 순서를 알려주세요.', s_image: r4 + '_1.mp4' },
        { ref_no: r5, s_turn: 1, reg_date: d1, reg_id: 'demo_eu01', phenomenon: '(Sample) Dashboard lamps flicker when the engine starts.', requirement: '(Sample) Please tell me what to check first.', s_image: '' }
      ],
      replies: [
        { ref_no: r1, r_turn: 1, r_reply_date: d20, r_title: '에러코드 219 (Stepper mot Mism) 표출 및 스티어링 휠 잠김', req_summary: '클러스터에 에러코드 219가 뜨고 스티어링 휠이 잠김. 하자 원인과 점검·조치 사항 요청.', reply_content: '클러스터 디스플레이에 에러코드 219 (STEPPER MOTOR MISM / Stepper mot Mism)이 표출되며 스티어링 휠이 잠기는 현상은, ZAPI EPS-AC0(조향 컨트롤러)가 조향 핸들 하단의 스텝핑 모터 신호 이상을 감지하여 안전을 위해 조향 구동을 즉시 차단(Steer Cut-off)했기 때문에 발생합니다.\n(예시 회신 — 점검·조치 절차는 실제 매뉴얼로 확인해야 합니다.)', ref_info: '30BRP-X 정비매뉴얼(예시) p.000' },
        { ref_no: r2, r_turn: 1, r_reply_date: d12, r_title: '(예시) 엔진오일·필터 교환 주기', req_summary: '(예시) 가동시간 기준 엔진오일·필터 교환 주기 문의.', reply_content: '(예시 회신) 정기 점검표의 교환 주기를 확인하세요. 이 문장은 시연용이며 실제 값이 아닙니다.', ref_info: 'DEMO-25D 정비매뉴얼(예시) p.000' },
        { ref_no: r2, r_turn: 2, r_reply_date: d5, r_title: '(예시) 가혹 조건 교환 주기', req_summary: '(예시) 분진이 많은 현장에서의 교환 주기 문의.', reply_content: '(예시 회신) 가혹 조건 항목을 확인하세요. 이 문장은 시연용이며 실제 값이 아닙니다.', ref_info: 'DEMO-25D 정비매뉴얼(예시) p.000; DEMO-25D 정비매뉴얼(예시) p.001' },
        { ref_no: r5, r_turn: 1, r_reply_date: d0, r_title: '(Sample) Dashboard lamp flicker at start', req_summary: '(Sample) Lamps flicker when starting the engine.', reply_content: '(Sample reply) Check the battery and ground connections first. This text is for demonstration only.', ref_info: 'DEMO-25D Manual (sample) p.000' }
      ],
      logs: [
        { reg_id: 'demo_user01', login_date: d20 + ' 09:10', logout_date: d20 + ' 09:42' },
        { reg_id: 'demo_admin', login_date: d20 + ' 10:05', logout_date: d20 + ' 11:30' },
        { reg_id: 'demo_user01', login_date: d5 + ' 14:00', logout_date: d5 + ' 14:12' },
        { reg_id: 'demo_user02', login_date: d5 + ' 15:20', logout_date: d5 + ' 15:31' },
        { reg_id: 'demo_eu01', login_date: d1 + ' 08:03', logout_date: d1 + ' 08:15' }
      ],
      mails: [],
      _sample: true
    };
  }
  var api = { build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TSSample = api;
})(typeof window !== 'undefined' ? window : this);
