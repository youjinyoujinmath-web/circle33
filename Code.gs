/**
 * 원의 현 탐구실 · 학생 기록 저장소 (구글 앱스 스크립트)
 *
 * 1) 아래 TEACHER_ID 와 PASSWORD 를 교사 페이지 로그인에 쓰는 것과 똑같이 바꾸세요.
 * 2) 저장(디스크 아이콘) → 배포 → 새 배포 → 유형: 웹 앱
 *    - 실행 사용자: 나
 *    - 액세스 권한이 있는 사용자: 모든 사용자
 * 3) 나온 "웹 앱 URL"을 config.js 에 붙여 넣으세요.
 *
 * 비밀번호를 바꾼 뒤에는 배포 → 배포 관리 → (연필) → 버전: 새 버전 → 배포 를 해야 적용됩니다.
 */
const TEACHER_ID = '여기에-교사-아이디';
const PASSWORD = '여기에-교사-비밀번호';

const SHEET_NAME = '학생기록';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange('A1:D1').setValues([['학번이름', '학생 번호', '마지막 저장', '기록(JSON)']]).setFontWeight('bold');
    sh.getRange('B:B').setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 300);
  }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function pin_(v) {
  return String(v).replace(/\D/g, '').padStart(4, '0');
}

function doGet() {
  return out_({ ok: true, msg: '원의 현 탐구실 저장소가 작동 중입니다.' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad' }); }

  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) { return out_({ ok: false, error: 'busy' }); }
  try {
    const sh = sheet_();
    const data = sh.getDataRange().getValues();
    const findRow = function (name) {
      for (let i = 1; i < data.length; i++) if (String(data[i][0]).trim() === name) return i + 1;
      return 0;
    };
    const validName = function (n) { return /^\d{4}[가-힣]{2,5}$/.test(n); };

    if (req.action === 'save' || req.action === 'load') {
      const name = String(req.name || '').trim();
      const pin = String(req.pin || '');
      if (!validName(name) || !/^\d{4}$/.test(pin)) return out_({ ok: false, error: 'name' });
      const row = findRow(name);
      if (row && pin_(data[row - 1][1]) !== pin) return out_({ ok: false, error: 'pin' });

      if (req.action === 'load') {
        if (!row) return out_({ ok: true, rec: null });
        let rec = null;
        try { rec = JSON.parse(data[row - 1][3]); } catch (err) {}
        return out_({ ok: true, rec: rec });
      }

      const json = JSON.stringify(req.rec || {});
      if (json.length > 45000) return out_({ ok: false, error: 'size' });
      if (row) {
        sh.getRange(row, 3, 1, 2).setValues([[new Date(), json]]);
      } else {
        sh.appendRow([name, pin, new Date(), json]);
        sh.getRange(sh.getLastRow(), 2).setNumberFormat('@').setValue(pin);
      }
      return out_({ ok: true });
    }

    if (req.action === 'list' || req.action === 'import') {
      if (String(req.id || '').trim() !== TEACHER_ID || String(req.password || '') !== PASSWORD) return out_({ ok: false, error: 'password' });

      if (req.action === 'list') {
        const rows = [];
        for (let i = 1; i < data.length; i++) {
          if (!data[i][0]) continue;
          let rec = null;
          try { rec = JSON.parse(data[i][3]); } catch (err) { continue; }
          rows.push({ name: String(data[i][0]), pin: data[i][1] === '' ? '' : pin_(data[i][1]), rec: rec });
        }
        return out_({ ok: true, rows: rows });
      }

      // import: 학생이 보낸 제출 코드로 기록 추가 (학생 번호는 그대로 둠)
      const rec = req.rec || {};
      const name = String(rec.name || '').trim();
      if (!name) return out_({ ok: false, error: 'name' });
      const json = JSON.stringify(rec);
      if (json.length > 45000) return out_({ ok: false, error: 'size' });
      const row = findRow(name);
      if (row) sh.getRange(row, 3, 1, 2).setValues([[new Date(), json]]);
      else sh.appendRow([name, '', new Date(), json]);
      return out_({ ok: true });
    }

    return out_({ ok: false, error: 'action' });
  } finally {
    lock.releaseLock();
  }
}
