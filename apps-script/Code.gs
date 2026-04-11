// ============================================================
//  직원 보고 시스템 – Google Apps Script Backend
//  파일: Code.gs
//
//  설정 방법: SETUP.md 참고
// ============================================================

// ── 설정값 (배포 전 반드시 수정하세요) ────────────────────────
const SHEET_ID       = 'YOUR_GOOGLE_SHEET_ID';   // 구글 시트 ID
const SHEET_NAME     = '직원보고';                 // 시트 탭 이름
const TELEGRAM_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN'; // 텔레그램 봇 토큰
const TELEGRAM_CHAT_ID = 'YOUR_TELEGRAM_CHAT_ID'; // 텔레그램 채팅 ID (그룹은 음수)
// ─────────────────────────────────────────────────────────────


/**
 * GET 요청 핸들러 – 연결 테스트용
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Staff Report API is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * POST 요청 핸들러 – 모든 액션의 진입점
 */
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;

    let result;
    switch (action) {
      case 'submit': result = submitReport(body);  break;
      case 'fetch':  result = fetchReports(body);  break;
      case 'update': result = updateReport(body);  break;
      case 'delete': result = deleteReport(body);  break;
      default:       result = { success: false, error: '알 수 없는 액션입니다.' };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ── 시트 가져오기 (없으면 생성 + 헤더 추가) ──────────────────
function getSheet() {
  const ss   = SpreadsheetApp.openById(SHEET_ID);
  let sheet  = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ['ID', '이름', '이메일', '날짜', '유형', '사유', '외근지', '제출시간', '마지막수정시간'];
    sheet.appendRow(headers);

    // 헤더 스타일
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#2D5016');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    headerRange.setFontSize(11);
    sheet.setFrozenRows(1);

    // 열 너비 설정
    sheet.setColumnWidth(1, 160);  // ID
    sheet.setColumnWidth(2, 90);   // 이름
    sheet.setColumnWidth(3, 180);  // 이메일
    sheet.setColumnWidth(4, 100);  // 날짜
    sheet.setColumnWidth(5, 70);   // 유형
    sheet.setColumnWidth(6, 200);  // 사유
    sheet.setColumnWidth(7, 150);  // 외근지
    sheet.setColumnWidth(8, 160);  // 제출시간
    sheet.setColumnWidth(9, 160);  // 마지막수정시간
  }

  return sheet;
}


// ── 고유 ID 생성 ──────────────────────────────────────────────
function generateId() {
  const ts   = new Date().getTime().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substr(2, 4).toUpperCase();
  return 'SR-' + ts + rand;
}


// ── 현재 시간 (라오스 시간대) ─────────────────────────────────
function nowStr() {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Vientiane' });
}


// ============================================================
//  SUBMIT – 새 보고서 등록
// ============================================================
function submitReport(body) {
  const { name, email, date, type, reason, location } = body;

  if (!name || !email || !date || !type) {
    return { success: false, error: '필수 항목(이름, 이메일, 날짜, 유형)을 입력해주세요.' };
  }

  // 간단한 이메일 형식 검증
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: '올바른 이메일 형식이 아닙니다.' };
  }

  const sheet = getSheet();
  const id    = generateId();
  const now   = nowStr();

  sheet.appendRow([
    id,
    name,
    email.toLowerCase(),
    date,
    type,
    reason   || '-',
    location || '-',
    now,
    now
  ]);

  // 텔레그램 알림
  const locationLine = type === '외근' ? `\n🏢 외근지: ${location || '-'}` : '';
  const msg =
    `🔔 [직원 보고 - 신규]\n` +
    `👤 이름: ${name}\n` +
    `📋 유형: ${type}\n` +
    `📅 날짜: ${date}\n` +
    `📍 사유: ${reason || '-'}` +
    locationLine + '\n' +
    `⏰ 제출: ${now}`;
  sendTelegram(msg);

  return { success: true, id: id };
}


// ============================================================
//  FETCH – 이메일로 내 보고 목록 조회
// ============================================================
function fetchReports(body) {
  const { email } = body;
  if (!email) return { success: false, error: '이메일을 입력해주세요.' };

  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  // 첫 행은 헤더이므로 slice(1)
  const rows = data.slice(1)
    .filter(row => row[0] && row[2] && row[2].toString().toLowerCase() === email.toLowerCase())
    .map(row => ({
      id:          row[0],
      name:        row[1],
      email:       row[2],
      date:        row[3],
      type:        row[4],
      reason:      row[5],
      location:    row[6],
      submittedAt: row[7],
      updatedAt:   row[8]
    }));

  return { success: true, rows: rows };
}


// ============================================================
//  UPDATE – 기존 보고서 수정 (이메일 본인 확인 필요)
// ============================================================
function updateReport(body) {
  const { id, email, date, type, reason, location } = body;

  if (!id || !email || !date || !type) {
    return { success: false, error: '필수 항목 누락' };
  }

  const sheet    = getSheet();
  const data     = sheet.getDataRange().getValues();
  let rowIndex   = -1;
  let storedEmail = '';
  let storedName  = '';

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      rowIndex    = i + 1; // 시트는 1-indexed
      storedEmail = data[i][2].toString().toLowerCase();
      storedName  = data[i][1];
      break;
    }
  }

  if (rowIndex === -1) return { success: false, error: '보고서를 찾을 수 없습니다.' };
  if (storedEmail !== email.toLowerCase()) {
    return { success: false, error: '이메일이 일치하지 않습니다. 본인 이메일을 확인하세요.' };
  }

  const now = nowStr();

  // 날짜(D), 유형(E), 사유(F), 외근지(G) 업데이트
  sheet.getRange(rowIndex, 4, 1, 4).setValues([[date, type, reason || '-', location || '-']]);
  // 마지막수정시간(I) 업데이트
  sheet.getRange(rowIndex, 9).setValue(now);

  // 텔레그램 알림
  const locationLine = type === '외근' ? `\n🏢 외근지: ${location || '-'}` : '';
  const msg =
    `✏️ [직원 보고 - 수정]\n` +
    `👤 이름: ${storedName}\n` +
    `📋 유형: ${type}\n` +
    `📅 날짜: ${date}\n` +
    `📍 사유: ${reason || '-'}` +
    locationLine + '\n' +
    `⏰ 수정: ${now}`;
  sendTelegram(msg);

  return { success: true };
}


// ============================================================
//  DELETE – 보고서 삭제 (이메일 본인 확인 필요)
// ============================================================
function deleteReport(body) {
  const { id, email } = body;

  if (!id || !email) return { success: false, error: '필수 항목 누락' };

  const sheet    = getSheet();
  const data     = sheet.getDataRange().getValues();
  let rowIndex   = -1;
  let storedEmail = '';
  let storedName  = '';
  let storedType  = '';
  let storedDate  = '';

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      rowIndex    = i + 1;
      storedEmail = data[i][2].toString().toLowerCase();
      storedName  = data[i][1];
      storedType  = data[i][4];
      storedDate  = data[i][3];
      break;
    }
  }

  if (rowIndex === -1) return { success: false, error: '보고서를 찾을 수 없습니다.' };
  if (storedEmail !== email.toLowerCase()) {
    return { success: false, error: '이메일이 일치하지 않습니다. 본인 이메일을 확인하세요.' };
  }

  sheet.deleteRow(rowIndex);

  const now = nowStr();
  const msg =
    `🗑️ [직원 보고 - 삭제]\n` +
    `👤 이름: ${storedName}\n` +
    `📋 유형: ${storedType}\n` +
    `📅 날짜: ${storedDate}\n` +
    `⏰ 삭제: ${now}`;
  sendTelegram(msg);

  return { success: true };
}


// ============================================================
//  TELEGRAM 메시지 전송
// ============================================================
function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') return;
  if (!TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === 'YOUR_TELEGRAM_CHAT_ID') return;

  try {
    const url     = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const payload = {
      chat_id:    TELEGRAM_CHAT_ID,
      text:       message,
      parse_mode: 'HTML'
    };
    UrlFetchApp.fetch(url, {
      method:           'post',
      contentType:      'application/json',
      payload:          JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    // 텔레그램 실패는 무시하고 메인 동작은 계속
    console.error('Telegram error:', err.toString());
  }
}
