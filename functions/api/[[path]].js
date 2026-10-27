// JUKEBOX API — Cloudflare Pages Functions (one catch-all router for /api/*)
// Bindings: DB (D1). Secrets: GEMINI_API_KEY, PIN_PEPPER, TMDB_API_KEY (optional).
// Vars: GEMINI_MODEL, REC_DAILY_LIMIT.

const DAY = 86400000;
const SESSION_DAYS = 60;
const NICK_RE = /^[0-9A-Za-z가-힣_]{2,12}$/;
const COVER_HOSTS = [/\.mzstatic\.com$/, /^image\.tmdb\.org$/, /^upload\.wikimedia\.org$/];
const LINK_HOSTS = [/^music\.apple\.com$/, /^itunes\.apple\.com$/, /^www\.themoviedb\.org$/, /\.wikipedia\.org$/];

const now = () => Date.now();
const enc = new TextEncoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
const fail = (status, code, message) => json({ error: { code, message } }, status);

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const ukeyOf = (title, artist) => (clip(title, 200) + '|' + clip(artist, 200)).toLowerCase();
function okUrl(u, hosts) {
  try { const x = new URL(String(u)); return x.protocol === 'https:' && hosts.some(h => h.test(x.hostname)) ? x.toString() : null; }
  catch { return null; }
}
const clientIp = req => req.headers.get('cf-connecting-ip') || 'local';

async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

// fixed-window counter; returns the count after incrementing
async function bump(env, key, windowMs) {
  const exp = now() + windowMs;
  const row = await env.DB.prepare(
    'INSERT INTO usage (k, n, exp) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n'
  ).bind(key, exp).first();
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM usage WHERE exp < ?').bind(now()).run();
  return row ? row.n : 1;
}

async function currentUser(req, env) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || token.length > 128) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.nickname FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
  ).bind(await sha256(token), now()).first();
  return row || null;
}

function cleanItem(kind, it, i = 0) {
  const title = clip(it && it.title, 200);
  if (!title) return null;
  const artist = clip(kind === 'music' ? it.artist : (it.artist || it.director || ''), 200);
  let rating = Number(it.rating);
  rating = Number.isFinite(rating) && rating > 0 ? Math.min(5, Math.round(rating * 2) / 2) : null;
  const type = kind === 'film' ? 'film' : (it.type === 'track' ? 'track' : 'album');
  return {
    ukey: ukeyOf(title, artist), title, artist, year: clip(it.year, 8), type,
    cover: okUrl(it.cover, COVER_HOSTS), link: okUrl(it.link, LINK_HOSTS), rating, pos: i,
  };
}
const publicItem = r => ({ title: r.title, artist: r.artist, year: r.year, type: r.type, cover: r.cover, link: r.link, rating: r.rating, source: r.source, kind: r.kind, created_at: r.created_at, nickname: r.nickname });

/* ------------------------------------------------------------------ */
/* auth                                                               */
/* ------------------------------------------------------------------ */
async function login(req, env) {
  if (!env.PIN_PEPPER) return fail(500, 'config', '서버 설정(PIN_PEPPER)이 비어 있습니다.');
  const body = await readJson(req);
  const nickname = clip(body && body.nickname, 40);
  const pin = String(body && body.pin || '');
  if (!NICK_RE.test(nickname)) return fail(400, 'bad_nickname', '닉네임은 한글·영문·숫자·밑줄로 2~12자여야 합니다.');
  if (!/^\d{4}$/.test(pin)) return fail(400, 'bad_pin', '코드는 숫자 4자리여야 합니다.');
  if (await bump(env, 'login:' + clientIp(req) + ':' + Math.floor(now() / 3600000), 3600000) > 30)
    return fail(429, 'too_many', '로그인 시도가 너무 많습니다. 1시간 뒤에 다시 시도해 주세요.');

  let user = await env.DB.prepare('SELECT * FROM users WHERE nickname = ?').bind(nickname).first();
  let created = false;
  if (!user) {
    const salt = randHex(16);
    const pin_hash = await hmac(env.PIN_PEPPER, salt + ':' + pin);
    try {
      user = await env.DB.prepare('INSERT INTO users (nickname, salt, pin_hash, created_at) VALUES (?, ?, ?, ?) RETURNING *')
        .bind(nickname, salt, pin_hash, now()).first();
      created = true;
    } catch {
      return fail(409, 'taken', '방금 같은 닉네임이 만들어졌습니다. 다시 시도해 주세요.');
    }
  } else {
    if (user.locked_until > now()) {
      const min = Math.ceil((user.locked_until - now()) / 60000);
      return fail(429, 'locked', `코드를 여러 번 틀려 잠겼습니다. ${min}분 뒤에 다시 시도해 주세요.`);
    }
    const hash = await hmac(env.PIN_PEPPER, user.salt + ':' + pin);
    if (!safeEqual(hash, user.pin_hash)) {
      const failed = user.failed + 1;
      if (failed >= 5) {
        await env.DB.prepare('UPDATE users SET failed = 0, locked_until = ? WHERE id = ?').bind(now() + 15 * 60000, user.id).run();
        return fail(429, 'locked', '코드를 5번 틀려 15분 동안 잠겼습니다.');
      }
      await env.DB.prepare('UPDATE users SET failed = ? WHERE id = ?').bind(failed, user.id).run();
      return fail(401, 'wrong_pin', `코드가 맞지 않습니다. ${5 - failed}번 더 틀리면 15분 동안 잠깁니다.`);
    }
    if (user.failed) await env.DB.prepare('UPDATE users SET failed = 0 WHERE id = ?').bind(user.id).run();
  }
  const token = randHex(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), user.id, now(), now() + SESSION_DAYS * DAY).run();
  return json({ token, user: { nickname: user.nickname }, created });
}

async function logout(req, env) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* my lists                                                           */
/* ------------------------------------------------------------------ */
async function getMyItems(req, env, me) {
  const kind = new URL(req.url).searchParams.get('kind') === 'film' ? 'film' : 'music';
  const { results } = await env.DB.prepare(
    "SELECT * FROM items WHERE user_id = ? AND kind = ? AND source = 'fav' ORDER BY pos"
  ).bind(me.id, kind).all();
  return json({ items: results.map(publicItem) });
}

async function putMyItems(req, env, me) {
  const body = await readJson(req);
  const kind = body && body.kind === 'film' ? 'film' : 'music';
  const list = Array.isArray(body && body.items) ? body.items.slice(0, 100) : null;
  if (!list) return fail(400, 'bad_items', '목록 형식이 올바르지 않습니다.');
  const seen = new Set();
  const items = list.map((it, i) => cleanItem(kind, it, i)).filter(x => x && !seen.has(x.ukey) && seen.add(x.ukey));
  const { results: existing } = await env.DB.prepare(
    "SELECT id, ukey FROM items WHERE user_id = ? AND kind = ? AND source = 'fav'"
  ).bind(me.id, kind).all();
  const byKey = new Map(existing.map(r => [r.ukey, r.id]));
  const stmts = [];
  const keep = new Set();
  const t = now();
  items.forEach((it, i) => {
    const id = byKey.get(it.ukey);
    if (id) {
      keep.add(id);
      stmts.push(env.DB.prepare('UPDATE items SET title=?, artist=?, year=?, type=?, cover=?, link=?, rating=?, pos=? WHERE id=?')
        .bind(it.title, it.artist, it.year, it.type, it.cover, it.link, it.rating, it.pos, id));
    } else {
      stmts.push(env.DB.prepare("INSERT INTO items (user_id, kind, source, ukey, title, artist, year, type, cover, link, rating, pos, created_at) VALUES (?, ?, 'fav', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(me.id, kind, it.ukey, it.title, it.artist, it.year, it.type, it.cover, it.link, it.rating, it.pos, t - (items.length - i)));
    }
  });
  for (const r of existing) if (!keep.has(r.id)) stmts.push(env.DB.prepare('DELETE FROM items WHERE id = ?').bind(r.id));
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, count: items.length });
}

async function postFound(req, env, me) {
  const body = await readJson(req);
  const kind = body && body.kind === 'film' ? 'film' : 'music';
  const it = cleanItem(kind, body && body.item);
  if (!it) return fail(400, 'bad_item', '작품 정보가 올바르지 않습니다.');
  await env.DB.prepare(
    "INSERT INTO items (user_id, kind, source, ukey, title, artist, year, type, cover, link, pos, created_at) VALUES (?, ?, 'found', ?, ?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT(user_id, kind, source, ukey) DO UPDATE SET cover = excluded.cover, link = excluded.link"
  ).bind(me.id, kind, it.ukey, it.title, it.artist, it.year, it.type, it.cover, it.link, now()).run();
  return json({ ok: true });
}

async function deleteFound(req, env, me) {
  const body = await readJson(req);
  const kind = body && body.kind === 'film' ? 'film' : 'music';
  await env.DB.prepare("DELETE FROM items WHERE user_id = ? AND kind = ? AND source = 'found' AND ukey = ?")
    .bind(me.id, kind, ukeyOf(body && body.title, body && (body.artist || body.director))).run();
  return json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* community                                                          */
/* ------------------------------------------------------------------ */
async function feed(req, env) {
  const p = new URL(req.url).searchParams;
  const kind = p.get('kind') === 'film' ? 'film' : 'music';
  const before = Number(p.get('before')) || now() + DAY;
  const { results } = await env.DB.prepare(
    'SELECT i.*, u.nickname FROM items i JOIN users u ON u.id = i.user_id WHERE i.kind = ? AND i.created_at < ? ORDER BY i.created_at DESC, i.id DESC LIMIT 40'
  ).bind(kind, before).all();
  return json({ items: results.map(publicItem) });
}

async function users(req, env) {
  const q = clip(new URL(req.url).searchParams.get('q'), 12);
  const where = q ? 'WHERE u.nickname LIKE ?' : '';
  const stmt = env.DB.prepare(
    `SELECT u.nickname,
       (SELECT COUNT(*) FROM items WHERE user_id = u.id AND kind = 'music' AND source = 'fav') AS music,
       (SELECT COUNT(*) FROM items WHERE user_id = u.id AND kind = 'film' AND source = 'fav') AS film,
       COALESCE((SELECT MAX(created_at) FROM items WHERE user_id = u.id), u.created_at) AS last
     FROM users u ${where} ORDER BY last DESC LIMIT 60`
  );
  const { results } = await (q ? stmt.bind('%' + q.replace(/[%_]/g, '') + '%') : stmt).all();
  return json({ users: results });
}

async function profile(req, env, nick) {
  const user = await env.DB.prepare('SELECT id, nickname, created_at FROM users WHERE nickname = ?').bind(nick).first();
  if (!user) return fail(404, 'no_user', '그런 닉네임의 사용자가 없습니다.');
  const [{ results: items }, { results: messages }] = await Promise.all([
    env.DB.prepare("SELECT * FROM items WHERE user_id = ? ORDER BY source, pos, created_at DESC LIMIT 400").bind(user.id).all(),
    env.DB.prepare('SELECT m.id, m.body, m.created_at, u.nickname AS from_nickname FROM messages m JOIN users u ON u.id = m.from_user_id WHERE m.to_user_id = ? ORDER BY m.created_at DESC LIMIT 40').bind(user.id).all(),
  ]);
  return json({ user: { nickname: user.nickname, created_at: user.created_at }, items: items.map(publicItem), messages });
}

async function postMessage(req, env, me, nick) {
  const to = await env.DB.prepare('SELECT id FROM users WHERE nickname = ?').bind(nick).first();
  if (!to) return fail(404, 'no_user', '그런 닉네임의 사용자가 없습니다.');
  const body = await readJson(req);
  const text = clip(body && body.body, 200);
  if (!text) return fail(400, 'empty', '내용을 적어 주세요.');
  if (await bump(env, 'msg:' + me.id + ':' + Math.floor(now() / 3600000), 3600000) > 15)
    return fail(429, 'too_many', '방명록은 1시간에 15개까지 남길 수 있습니다.');
  const row = await env.DB.prepare('INSERT INTO messages (to_user_id, from_user_id, body, created_at) VALUES (?, ?, ?, ?) RETURNING id, body, created_at')
    .bind(to.id, me.id, text, now()).first();
  return json({ message: { ...row, from_nickname: me.nickname } });
}

async function deleteMessage(env, me, id) {
  const m = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
  if (!m) return fail(404, 'no_message', '이미 지워진 글입니다.');
  if (m.from_user_id !== me.id && m.to_user_id !== me.id) return fail(403, 'forbidden', '내가 쓰거나 받은 글만 지울 수 있습니다.');
  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* TMDB proxy (optional — only when TMDB_API_KEY is set)              */
/* ------------------------------------------------------------------ */
async function tmdbSearch(req, env) {
  if (!env.TMDB_API_KEY) return fail(404, 'tmdb_off', 'TMDB가 설정되지 않았습니다.');
  const p = new URL(req.url).searchParams;
  const q = clip(p.get('q'), 100);
  if (!q) return json({ results: [] });
  const year = /^\d{4}$/.test(p.get('year') || '') ? p.get('year') : '';
  const key = env.TMDB_API_KEY;
  const bearer = key.length > 40;
  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('query', q);
  url.searchParams.set('language', 'ko-KR');
  url.searchParams.set('include_adult', 'false');
  if (year) url.searchParams.set('year', year);
  if (!bearer) url.searchParams.set('api_key', key);
  const r = await fetch(url, { headers: bearer ? { authorization: 'Bearer ' + key, accept: 'application/json' } : { accept: 'application/json' }, cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!r.ok) return fail(502, 'tmdb_error', 'TMDB 응답을 받지 못했습니다.');
  const d = await r.json();
  const results = (d.results || []).slice(0, 8).map(m => ({
    title_ko: m.title, title: m.original_title, year: (m.release_date || '').slice(0, 4),
    poster: m.poster_path ? 'https://image.tmdb.org/t/p/w342' + m.poster_path : null,
    link: 'https://www.themoviedb.org/movie/' + m.id,
  }));
  return json({ results });
}

/* ------------------------------------------------------------------ */
/* recommendations (Gemini free tier)                                 */
/* ------------------------------------------------------------------ */
const AXES = {
  music: ['장르', '프로듀서·엔지니어', '세션·참여진', '레이블', '씬·지역', '시대·영향 관계'],
  film: ['감독', '촬영감독', '각본가', '배우', '음악감독', '편집', '제작사·배급사', '국가·사조'],
};
const SIM_TXT = ['', '사용자 목록과 사운드·분위기·형식이 아주 가까운 작품만', '가까운 작품 중심에 약간 다른 결을 섞어서', '가까운 작품과 새로운 방향을 반반으로', '연결고리는 분명하되 장르·시대·형식이 다른 작품 위주로', '연결고리 하나를 따라 의외의 장르·시대·지역으로 넘어가는 발견 위주로'];
const POP_TXT = ['', '대중적으로 널리 알려진 대표작 위주로', '잘 알려진 작품 중심에 덜 알려진 작품을 조금 섞어서', '잘 알려진 작품과 숨은 작품을 반반 정도로', '덜 알려진 작품 위주로, 잘 알려진 작품은 소수만', '평가 수가 적은 숨은 작품 위주로 (단, 실존이 확실한 것만)'];
const TONE = `[문체 — 반드시 지킬 것]
summary, why, detail을 포함한 모든 한국어 문장은 존댓말 합쇼체('~합니다', '~입니다', '~습니다')로 끝내라.
'~한다', '~이다', '~했다' 같은 반말 평서문과 '~해요', '~예요' 체는 절대 쓰지 마라.
좋은 예: "몽환적인 신스와 느린 비트가 Dummy와 닮았습니다."
나쁜 예: "몽환적인 신스와 느린 비트가 Dummy와 닮았다." / "Dummy와 닮았어요."`;
const RATING_RULE = '- 별점이 적힌 항목은 별점이 높을수록 취향의 중심으로 보고 더 무겁게 반영하라. 3 이하인 항목은 주변적인 취향으로 다뤄라.';
const lines = a => a.filter(Boolean).join('\n');
const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const strList = (v, max, n) => (Array.isArray(v) ? v : []).map(x => clip(x, n)).filter(Boolean).slice(0, max);

function factRules(mode) {
  return `[사실 확인 — 특히 과거 작품은 꼼꼼하게]
각 항목을 쓰기 전에 스스로 점검하라:
① 그 작품이 실제로 존재하는가
② ${mode === 'music' ? '아티스트' : '감독'}와 제목 철자가 정확한가 (원어 표기 기준)
③ 연도가 최초 ${mode === 'music' ? '발매' : '개봉(첫 공개·영화제 상영)'} 연도인가 (재발매·리마스터·국내 개봉 연도가 아님)
${mode === 'music' ? '④ 곡이 그 앨범·싱글에 실제로 수록됐는가\n⑤ 연결 근거로 든 사람·레이블이 실제로 그 작품에 참여했는가' : '④ 연결 근거로 든 사람이 실제로 그 영화에 그 역할로 참여했는가'}
하나라도 확신이 없으면 그 작품은 추천하지 마라.`;
}
function eraTxt(mode, o) {
  const f = int(o.eraFrom, 1900, 2030, 0), t = int(o.eraTo, 1900, 2030, 0);
  const what = mode === 'music' ? '발매' : '개봉';
  if (f && t) return `- ${Math.min(f, t)}년대부터 ${Math.max(f, t)}년대까지 ${what}된 작품만 추천하라.`;
  if (f) return `- ${f}년대 이후에 ${what}된 작품만 추천하라.`;
  if (t) return `- ${t}년대까지 ${what}된 작품만 추천하라.`;
  return '';
}
function moreLines(more) {
  if (!more) return '';
  const prev = strList(more.prev, 120, 160), up = strList(more.up, 60, 160), down = strList(more.down, 60, 160);
  return lines([
    prev.length ? '- 이미 추천한 다음 작품은 다시 추천하지 마라: ' + prev.join('; ') : '',
    up.length ? '- 사용자가 "취향에 맞다"고 표시한 추천: ' + up.join('; ') + ' → 이 방향을 더 반영하라.' : '',
    down.length ? '- 사용자가 "아니다"라고 표시한 추천: ' + down.join('; ') + ' → 이런 방향은 피하라.' : '',
  ]);
}

function buildPrompt(mode, items, o, more) {
  const rating = it => (Number(it.rating) > 0 ? ` — 별점 ${Math.min(5, Number(it.rating))}/5` : '');
  if (mode === 'music') {
    const list = items.map((it, i) => `${i + 1}. [${it.type === 'track' ? '곡' : '앨범'}] ${clip(it.artist, 120)} — ${clip(it.title, 160)}${rating(it)}`).join('\n');
    const n = [8, 12, 16, 20].includes(+o.n) ? +o.n : 12;
    const fmt = { both: '앨범과 곡을 섞어서', album: '앨범만', track: '곡(싱글 또는 수록곡)만' }[o.format] || '앨범과 곡을 섞어서';
    const axes = strList(o.axes, 8, 20).filter(a => AXES.music.includes(a));
    const region = strList(o.region, 6, 20);
    return `${TONE}

너는 위키피디아와 RateYourMusic(RYM)에 정리된 음반 정보(장르 체계, 크레딧, 레이블, 씬)에 정통한 음악 큐레이터다.
아래는 사용자가 좋아하는 음악 목록이다.

${list}

[분석 방법]
- 각 작품의 RYM 장르, 프로듀서·엔지니어, 세션 참여진, 레이블, 씬, 시대와 영향 관계를 떠올리고 반복되거나 서로 이어지는 연결을 찾아라.
- 다음 축을 우선해서 연결고리를 찾아라: ${(axes.length ? axes : AXES.music).join(', ')}.
${RATING_RULE}

[요청]
${lines([
  `- 이 취향에 맞는 음악을 ${n}개 추천하라. 형식: ${fmt}.`,
  `- 유사도: ${SIM_TXT[int(o.sim, 1, 5, 3)]}.`,
  `- 인지도: ${POP_TXT[int(o.pop, 1, 5, 3)]}.`,
  eraTxt('music', o),
  region.length ? `- 다음 지역의 작품을 중심으로 추천하라: ${region.join(', ')}.` : '',
  o.vocal === 'vocal' ? '- 보컬이 중심인 음악 위주로.' : (o.vocal === 'inst' ? '- 연주곡(인스트루멘털) 위주로.' : ''),
  o.same ? '- 목록에 있는 아티스트의 다른 작품도 추천해도 된다.' : '- 목록에 이미 있는 아티스트의 작품은 추천하지 마라.',
  '- 목록에 있는 작품 자체는 추천하지 마라. 한 아티스트당 최대 1개.',
  clip(o.exclude, 300) ? `- 다음 아티스트는 추천하지 마라: ${clip(o.exclude, 300)}` : '',
  clip(o.note, 300) ? '- 사용자의 추가 요청: ' + clip(o.note, 300) : '',
  moreLines(more),
])}

${factRules('music')}

[작성 규칙 — 짧고 핵심만]
- why: 존댓말 2문장, 합쳐서 110자 이내. 사용자 목록의 작품을 하나 이상 짚고, 소리·분위기의 공통점을 구체적으로 말하라. 뻔한 칭찬 금지.
- axis: 가장 강한 연결 축 하나. axis는 축 이름(예: 프로듀서, 레이블, 장르), detail은 25자 이내 근거(예: "Geoff Barrow가 프로듀싱").
- primary: RYM 영어 장르명 1~2개.
- start_with: 앨범이면 먼저 들어볼 곡 1개, 곡이면 빈 문자열.
- match: 취향 적합도(50~99 정수). 높은 순으로 정렬.

[출력 형식]
JSON 객체 하나만 출력하라. 코드펜스나 다른 문장은 쓰지 마라.
{
  ${more ? '' : `"profile": {"summary":"존댓말 2문장, 합쳐서 120자 이내로 취향의 핵심을 해석","genres":[{"name":"Trip Hop","weight":85}],"keywords":["몽환적","야행성"]},
  `}"recs": [{"type":"album 또는 track","title":"...","artist":"...","year":1998,"album":"곡이면 수록 앨범, 앨범이면 빈 문자열","primary":["..."],"axis":{"axis":"프로듀서","detail":"..."},"why":"...습니다. ...입니다.","start_with":"...","match":88}]
}
${more ? '' : '(profile.genres는 상위 5개, weight 0~100. keywords는 한국어 짧은 키워드 4개)'}
다시 강조한다: why와 summary는 반드시 '~습니다/~입니다'로 끝나는 존댓말이어야 한다.`;
  }

  const list = items.map((it, i) => `${i + 1}. ${clip(it.title, 160)}${it.year ? ' (' + clip(it.year, 6) + ')' : ''}${rating(it)}${it.why ? ' — 좋았던 점: ' + clip(it.why, 120) : ''}`).join('\n');
  const n = [6, 10, 14].includes(+o.n) ? +o.n : 10;
  const pp = more ? Math.min(int(o.p, 0, 5, 3), 2) : ([0, 3, 5].includes(+o.p) ? +o.p : 3);
  const axes = strList(o.axes, 8, 20).filter(a => AXES.film.includes(a));
  const region = strList(o.region, 6, 20), types = strList(o.types, 4, 20);
  return `${TONE}

너는 IMDb, Letterboxd, 왓챠피디아의 크레딧과 평판, 그리고 영화사를 깊이 아는 영화 큐레이터다.
아래는 사용자가 좋아하는 영화 목록이다.

${list}

[분석 방법]
- 목록의 영화들에서 감독, 촬영감독, 각본가, 주요 배우, 음악감독, 편집, 제작사, 국가와 사조를 떠올리고, 반복되거나 사용자의 '좋았던 점'과 이어지는 사람과 특징을 찾아라.
- 다음 축을 우선해서 연결고리를 찾아라: ${(axes.length ? axes : AXES.film.slice(0, 4)).join(', ')}.
${RATING_RULE}

[요청]
${lines([
  `- 이 취향에 맞는 영화 ${n}편을 추천하라.`,
  `- 유사도: ${SIM_TXT[int(o.sim, 1, 5, 3)]}.`,
  `- 인지도: ${POP_TXT[int(o.pop, 1, 5, 3)]}.`,
  eraTxt('film', o),
  region.length ? `- 다음 국가·지역의 영화를 중심으로 추천하라: ${region.join(', ')}.` : '',
  types.length ? `- 형식은 다음만: ${types.join(', ')}.` : '',
  o.runtime === 'short' ? '- 러닝타임 2시간 이내인 영화만.' : (o.runtime === 'long' ? '- 러닝타임이 긴 영화도 적극적으로 포함하라.' : ''),
  '- 목록에 있는 영화는 추천하지 마라. 한 감독당 최대 2편.',
  clip(o.exclude, 300) ? `- 다음 감독·영화는 추천하지 마라: ${clip(o.exclude, 300)}` : '',
  pp ? `- 추천 영화와 별도로, 따라가 볼 만한 영화인(감독뿐 아니라 촬영감독, 각본가, 배우, 음악감독 등) ${pp}명을 people에 추천하라.` : '',
  clip(o.note, 300) ? '- 사용자의 추가 요청: ' + clip(o.note, 300) : '',
  moreLines(more),
])}

${factRules('film')}

[작성 규칙 — 짧고 핵심만]
- why: 존댓말 2문장, 합쳐서 110자 이내. 사용자 목록의 영화를 하나 이상 짚고 연출·촬영·음악·연기 중 핵심 공통점을 말하라. 줄거리 요약 금지.
- axis: 가장 강한 연결 축 하나. axis는 축 이름(예: 촬영감독, 각본가, 배우), detail은 25자 이내 근거(예: "리핑빈 — 화양연화 공동 촬영").
- match: 취향 적합도(50~99 정수). 높은 순으로 정렬.

[출력 형식]
JSON 객체 하나만 출력하라. 코드펜스나 다른 문장은 쓰지 마라.
{
  ${more ? '' : `"profile": {"summary":"존댓말 2문장, 합쳐서 120자 이내로 취향의 핵심을 해석","keywords":["향수","느린 호흡"],"people":[{"name":"크리스토퍼 도일","role":"촬영감독"}]},
  `}"recs": [{"title_ko":"국내 개봉명(없으면 원제)","title":"원제","year":2001,"country":"...","director":"...","axis":{"axis":"촬영감독","detail":"..."},"why":"...습니다. ...입니다.","match":90}],
  "people": [${pp ? '{"name":"원어 또는 영문 이름","name_ko":"한국어 표기","role":"촬영감독","why":"존댓말 1~2문장, 80자 이내","start_with":[{"title":"...","year":1999}]}' : ''}]
}
${more ? '' : '(profile.keywords는 한국어 짧은 키워드 4개. profile.people은 목록에서 반복되거나 핵심인 인물 최대 4명, 참여가 확실한 경우만)'}
다시 강조한다: why와 summary는 반드시 '~습니다/~입니다'로 끝나는 존댓말이어야 한다.`;
}

function parseModelJson(text) {
  const t = String(text || '').trim();
  const tries = [t, t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) { try { return JSON.parse(s); } catch { /* next */ } }
  return null;
}

function cleanRecs(mode, out) {
  const arr = v => (Array.isArray(v) ? v : []);
  const axis = a => (a && (a.axis || a.detail) ? { axis: clip(a.axis, 20), detail: clip(a.detail, 60) } : null);
  const res = { profile: null, recs: [], people: [] };
  const p = out && out.profile;
  if (p && typeof p === 'object') {
    res.profile = {
      summary: clip(p.summary, 400),
      genres: arr(p.genres).slice(0, 5).map(g => ({ name: clip(g && g.name, 40), weight: int(g && g.weight, 0, 100, 50) })).filter(g => g.name),
      keywords: strList(p.keywords, 5, 20),
      people: arr(p.people).slice(0, 4).map(x => ({ name: clip(x && x.name, 60), role: clip(x && x.role, 20) })).filter(x => x.name),
    };
  }
  res.recs = arr(out && out.recs).slice(0, 24).map(r => mode === 'music'
    ? { type: r.type === 'track' ? 'track' : 'album', title: clip(r.title, 160), artist: clip(r.artist, 120), year: clip(r.year, 6), album: clip(r.album, 160), primary: strList(r.primary, 2, 40), axis: axis(r.axis), why: clip(r.why, 300), start_with: clip(r.start_with, 120), match: int(r.match, 0, 99, 0) }
    : { title_ko: clip(r.title_ko, 160), title: clip(r.title, 160), year: clip(r.year, 6), country: clip(r.country, 40), director: clip(r.director, 80), axis: axis(r.axis), why: clip(r.why, 300), match: int(r.match, 0, 99, 0) }
  ).filter(r => r.title || r.title_ko);
  if (mode === 'film') res.people = arr(out && out.people).slice(0, 5).map(x => ({
    name: clip(x && x.name, 60), name_ko: clip(x && x.name_ko, 60), role: clip(x && x.role, 20), why: clip(x && x.why, 240),
    start_with: arr(x && x.start_with).slice(0, 3).map(f => ({ title: clip(f && (f.title || f), 120), year: clip(f && f.year, 6) })).filter(f => f.title),
  })).filter(x => x.name);
  return res;
}

// Gemini call. New AI Studio keys ("AQ." auth keys) are documented with the Interactions endpoint,
// older "AIza" keys work with generateContent — try one, then the other.
function textFromGemini(d) {
  if (!d || typeof d !== 'object') return '';
  if (typeof d.output_text === 'string') return d.output_text;
  if (Array.isArray(d.steps)) return d.steps.filter(s => !s.type || s.type === 'model_output').flatMap(s => Array.isArray(s.content) ? s.content : []).map(c => (c && typeof c.text === 'string' ? c.text : '')).join('');
  if (Array.isArray(d.outputs)) return d.outputs.map(o => (o && typeof o.text === 'string' ? o.text : '')).join('');
  const parts = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
  return Array.isArray(parts) ? parts.map(p => p.text || '').join('') : '';
}
async function askGemini(env, model, prompt, timeoutMs = 50000) {
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': String(env.GEMINI_API_KEY).trim() };
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const attempts = [
    () => fetch(`${base}/interactions`, { method: 'POST', headers: { ...headers, 'Api-Revision': '2026-05-20' }, body: JSON.stringify({ model, input: prompt }), signal: AbortSignal.timeout(timeoutMs) }),
    () => fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8 } }), signal: AbortSignal.timeout(timeoutMs) }),
  ];
  let lastStatus = 0, reached = false;
  const notes = [];
  for (const [i, go] of attempts.entries()) {
    const label = i === 0 ? 'interactions' : 'generateContent';
    let r;
    try { r = await go(); reached = true; }
    catch (e) { notes.push(`${label}: ${e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? Math.round(timeoutMs / 1000) + '초 동안 응답 없음' : '연결 실패'}`); continue; }
    if (r.status === 429) return { error: fail(429, 'ai_quota', '오늘 무료 추천 한도가 모두 사용되었습니다. 내일 다시 이용해 주세요.') };
    const raw = await r.text().catch(() => '');
    let body = null; try { body = JSON.parse(raw); } catch { /* not json */ }
    if (r.ok) {
      const text = textFromGemini(body);
      if (text) return { text, notes };
      notes.push(`${label}: 200, 본문에서 글을 찾지 못함 (${raw.slice(0, 160)})`);
      lastStatus = 502;
      continue;
    }
    const gmsg = body && body.error && (body.error.message || body.error.status) || raw.slice(0, 160);
    notes.push(`${label}: ${r.status} ${String(gmsg).slice(0, 200)}`);
    lastStatus = r.status;
  }
  const detail = notes.length ? ' [' + notes.join(' | ') + ']' : '';
  if (!reached) return { error: fail(502, 'ai_unreachable', '추천 엔진에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' + detail), notes };
  if (lastStatus === 401 || lastStatus === 403) return { error: fail(502, 'ai_auth', 'Gemini API 키가 거부되었습니다. Cloudflare 설정의 GEMINI_API_KEY 값을 확인해 주세요.' + detail), notes };
  if (lastStatus === 404) return { error: fail(502, 'ai_model', `Gemini 모델(${model})을 찾지 못했습니다. GEMINI_MODEL 값을 AI Studio의 모델 이름으로 바꿔 주세요.` + detail), notes };
  return { error: fail(502, 'ai_error', '추천 엔진이 응답하지 않았습니다.' + detail), notes };
}

async function recommend(req, env) {
  if (!env.GEMINI_API_KEY) return fail(500, 'config', '서버 설정(GEMINI_API_KEY)이 비어 있습니다.');
  const body = await readJson(req);
  const mode = body && body.mode === 'film' ? 'film' : 'music';
  const items = (Array.isArray(body && body.items) ? body.items : []).slice(0, 100).filter(it => it && clip(it.title, 160));
  const min = mode === 'music' ? 5 : 3;
  if (items.length < min) return fail(400, 'too_few', `${mode === 'music' ? '음악은 5개' : '영화는 3편'} 이상 적어 주세요.`);
  const limit = int(env.REC_DAILY_LIMIT, 1, 1000, 20);
  const day = new Date().toISOString().slice(0, 10);
  if (await bump(env, 'rec:' + clientIp(req) + ':' + day, DAY) > limit)
    return fail(429, 'daily_limit', `오늘 받을 수 있는 추천 ${limit}회를 모두 사용했습니다. 내일 다시 이용해 주세요.`);

  const prompt = buildPrompt(mode, items, (body && body.opts) || {}, body && body.more);
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const ai = await askGemini(env, model, prompt);
  if (ai.error) return ai.error;
  const text = ai.text;
  const out = parseModelJson(text);
  if (!out) return fail(502, 'ai_format', '추천 결과를 읽지 못했습니다. 다시 시도해 주세요.');
  const res = cleanRecs(mode, out);
  if (!res.recs.length) return fail(502, 'ai_empty', '추천 결과가 비어 있습니다. 목록이나 설정을 바꿔 다시 시도해 주세요.');
  return json(res);
}

// setup check — open /api/health in a browser. Reports only yes/no, never secret values.
async function health(env, req) {
  let db = 'missing';
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      const names = results.map(r => r.name);
      const need = ['users', 'sessions', 'items', 'messages', 'usage'];
      const lack = need.filter(n => !names.includes(n));
      db = lack.length ? 'tables_missing: ' + lack.join(', ') : 'ok';
    } catch (e) { db = 'error: ' + String(e && e.message || e).slice(0, 120); }
  }
  return json({
    db,
    gemini_key: !!env.GEMINI_API_KEY,
    gemini_key_format: env.GEMINI_API_KEY ? (env.GEMINI_API_KEY.trim() !== env.GEMINI_API_KEY ? 'has_spaces' : (/^AQ\./.test(env.GEMINI_API_KEY) ? 'AQ' : (/^AIza/.test(env.GEMINI_API_KEY) ? 'AIza' : 'unknown'))) : null,
    pin_pepper: !!env.PIN_PEPPER,
    tmdb: !!env.TMDB_API_KEY,
    model: env.GEMINI_MODEL || 'gemini-3.8-flash (default)',
    ai_test: (req && new URL(req.url).searchParams.get('ai') === '1' && env.GEMINI_API_KEY)
      ? await (async () => { const r = await askGemini(env, env.GEMINI_MODEL || 'gemini-3.8-flash', 'Reply with the single word: ok', 15000); return r.text ? { ok: true, reply: r.text.slice(0, 40), notes: r.notes } : { ok: false, notes: r.notes }; })()
      : '주소 끝에 ?ai=1 을 붙이면 Gemini 연결을 실제로 시험합니다',
  });
}

/* ------------------------------------------------------------------ */
/* router                                                             */
/* ------------------------------------------------------------------ */
export async function onRequest(context) {
  const { request: req, env, params } = context;
  const parts = [].concat(params.path || []).map(decodeURIComponent);
  const route = parts.join('/');
  const m = req.method;
  if (route === 'health' && m === 'GET') return await health(env, req);
  if (!env.DB && !route.startsWith('tmdb')) return fail(500, 'config', '데이터베이스(DB) 연결이 설정되지 않았습니다. Cloudflare Pages 설정의 Bindings에서 D1을 변수 이름 DB로 연결한 뒤 다시 배포해 주세요.');
  try {
    if (route === 'login' && m === 'POST') return await login(req, env);
    if (route === 'logout' && m === 'POST') return await logout(req, env);
    if (route === 'me' && m === 'GET') { const me = await currentUser(req, env); return json({ user: me ? { nickname: me.nickname } : null }); }
    if (route === 'feed' && m === 'GET') return await feed(req, env);
    if (route === 'users' && m === 'GET') return await users(req, env);
    if (parts[0] === 'users' && parts[1] && parts.length === 2 && m === 'GET') return await profile(req, env, parts[1]);
    if (route === 'recommend' && m === 'POST') return await recommend(req, env);
    if (route === 'tmdb/search' && m === 'GET') return await tmdbSearch(req, env);

    const me = await currentUser(req, env);
    if (!me) return fail(401, 'login_required', '로그인이 필요합니다.');
    if (route === 'items' && m === 'GET') return await getMyItems(req, env, me);
    if (route === 'items' && m === 'PUT') return await putMyItems(req, env, me);
    if (route === 'found' && m === 'POST') return await postFound(req, env, me);
    if (route === 'found' && m === 'DELETE') return await deleteFound(req, env, me);
    if (parts[0] === 'users' && parts[2] === 'messages' && m === 'POST') return await postMessage(req, env, me, parts[1]);
    if (parts[0] === 'messages' && parts[1] && m === 'DELETE') return await deleteMessage(env, me, int(parts[1], 1, 1e12, 0));
    return fail(404, 'not_found', '없는 주소입니다.');
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/no such table/i.test(msg)) return fail(500, 'no_tables', '데이터베이스 표가 아직 만들어지지 않았습니다. Cloudflare D1의 Console에서 schema.sql 내용을 실행해 주세요.');
    return fail(500, 'server_error', '서버에서 문제가 생겼습니다. 잠시 후 다시 시도해 주세요. (' + msg.slice(0, 120) + ')');
  }
}
