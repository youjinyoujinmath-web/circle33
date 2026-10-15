// 원의 현 탐구실 · 학생 기록 저장소 (Vercel 서버 함수)
// 필요한 환경 변수
//   KV_REST_API_URL, KV_REST_API_TOKEN  (Vercel → Storage → Upstash Redis 연결 시 자동 생성)
//     ※ 이름이 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 이어도 됩니다.
//   TEACHER_HASH  (계정설정.html 에서 만든 64자리 값, 따옴표 없이)
const crypto = require('crypto');

const KEY = 'chordlab:records';      // 선생님께 제출한 기록
const DKEY = 'chordlab:drafts';      // 로그인한 학생이 하던 기록(자동 저장)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function loginHash(id, pw) {
  let x = 'circle-chord-lab|' + String(id).trim() + '|' + pw;
  for (let i = 0; i < 20000; i++) x = crypto.createHash('sha256').update(x + '|' + i).digest('hex');
  return x;
}
function teacherOk(req) {
  const h = String(process.env.TEACHER_HASH || '').trim().replace(/^"|"$/g, '');
  if (!/^[0-9a-f]{64}$/.test(h) || !req.id || !req.password) return false;
  const a = Buffer.from(loginHash(req.id, String(req.password)));
  return crypto.timingSafeEqual(a, Buffer.from(h));
}
const validName = (n) => /^\d{4}[가-힣]{2,5}$/.test(n);
// 학생 번호는 처음 로그인(또는 제출)할 때 정해진다
async function pinOf(name) {
  for (const k of [KEY, DKEY]) {
    const v = await redis(['HGET', k, name]);
    if (v) { try { const p = JSON.parse(v).pin; if (p) return p; } catch (e) {} }
  }
  return '';
}

module.exports = async (request, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') return res.status(200).json({ ok: true, msg: '원의 현 탐구실 저장소', store: !!(URL_ && TOKEN) });
  if (!URL_ || !TOKEN) return res.status(200).json({ ok: false, error: 'nostore' });

  let req = request.body;
  try { if (typeof req === 'string') req = JSON.parse(req); } catch (e) { return res.status(200).json({ ok: false, error: 'bad' }); }
  req = req || {};

  try {
    if (req.action === 'draftLoad' || req.action === 'draftSave') {
      const name = String(req.name || '').trim();
      const pin = String(req.pin || '');
      if (!validName(name) || !/^\d{4}$/.test(pin)) return res.json({ ok: false, error: 'name' });
      const known = await pinOf(name);
      if (known && known !== pin) return res.json({ ok: false, error: 'pin' });
      if (req.action === 'draftLoad') {
        const v = await redis(['HGET', DKEY, name]);
        let rec = null;
        if (v) { try { rec = JSON.parse(v).rec; } catch (e) {} }
        if (!known) await redis(['HSET', DKEY, name, JSON.stringify({ pin, t: Date.now(), rec: null })]);
        return res.json({ ok: true, rec });
      }
      const json = JSON.stringify({ pin, t: Date.now(), rec: req.rec || {} });
      if (json.length > 100000) return res.json({ ok: false, error: 'size' });
      await redis(['HSET', DKEY, name, json]);
      return res.json({ ok: true });
    }

    if (req.action === 'submit') {
      const name = String(req.name || '').trim();
      const pin = String(req.pin || '');
      const tab = String(req.tab || '');
      if (!validName(name) || !/^\d{4}$/.test(pin)) return res.json({ ok: false, error: 'name' });
      if (!/^t[1-5]$/.test(tab)) return res.json({ ok: false, error: 'tab' });
      const known = await pinOf(name);
      if (known && known !== pin) return res.json({ ok: false, error: 'pin' });
      const cur = await redis(['HGET', KEY, name]);
      const row = cur ? JSON.parse(cur) : null;
      const rec = (row && row.rec) || {};
      const at = Date.now();
      rec.name = name;
      rec[tab] = req.data || {};
      rec.sub = rec.sub || {};
      rec.sub[tab] = at;
      rec.updatedAt = at;
      const json = JSON.stringify({ pin, t: at, rec });
      if (json.length > 100000) return res.json({ ok: false, error: 'size' });
      await redis(['HSET', KEY, name, json]);
      return res.json({ ok: true, at });
    }

    if (req.action === 'save' || req.action === 'load') {
      const name = String(req.name || '').trim();
      const pin = String(req.pin || '');
      if (!validName(name) || !/^\d{4}$/.test(pin)) return res.json({ ok: false, error: 'name' });
      const cur = await redis(['HGET', KEY, name]);
      const row = cur ? JSON.parse(cur) : null;
      if (row && row.pin && row.pin !== pin) return res.json({ ok: false, error: 'pin' });
      if (req.action === 'load') return res.json({ ok: true, rec: row ? row.rec : null });
      const json = JSON.stringify({ pin, t: Date.now(), rec: req.rec || {} });
      if (json.length > 60000) return res.json({ ok: false, error: 'size' });
      await redis(['HSET', KEY, name, json]);
      return res.json({ ok: true });
    }

    if (req.action === 'list' || req.action === 'import') {
      if (!teacherOk(req)) return res.json({ ok: false, error: 'password' });
      if (req.action === 'list') {
        const flat = (await redis(['HGETALL', KEY])) || [];
        const rows = [];
        for (let i = 0; i < flat.length; i += 2) {
          try { const r = JSON.parse(flat[i + 1]); rows.push({ name: flat[i], pin: r.pin || '', rec: r.rec }); } catch (e) {}
        }
        return res.json({ ok: true, rows });
      }
      const rec = req.rec || {};
      const name = String(rec.name || '').trim();
      if (!name) return res.json({ ok: false, error: 'name' });
      const cur = await redis(['HGET', KEY, name]);
      const pin = cur ? (JSON.parse(cur).pin || '') : '';
      await redis(['HSET', KEY, name, JSON.stringify({ pin, t: Date.now(), rec })]);
      return res.json({ ok: true });
    }
    return res.json({ ok: false, error: 'action' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'store' });
  }
};
