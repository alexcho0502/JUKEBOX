// JUKEBOX API — Cloudflare Pages Functions (one router for /api/*)
// Bindings: DB (D1). Secrets: GEMINI_API_KEY, PIN_PEPPER. Vars: GEMINI_MODEL, REC_DAILY_LIMIT, ADMIN_USERS.
// Every rule that protects someone else's data is enforced here, never in the browser.

const DAY = 86400000;
const SESSION_DAYS = 60;
const NICK_RE = /^[0-9A-Za-z가-힣_]{2,12}$/;
const COVER_HOST = /(^|\.)mzstatic\.com$|^coverartarchive\.org$|(^|\.)archive\.org$|(^|\.)dzcdn\.net$/;
const LINK_HOST = /^(music|itunes)\.apple\.com$|^musicbrainz\.org$|^(www\.)?deezer\.com$/;
const UA = 'JUKEBOX/2.0 (music taste receipts; https://pages.dev)';

const now = () => Date.now();
const enc = new TextEncoder();
const kstDay = (t = now()) => new Date(t + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
const fail = (status, code, message) => json({ error: { code, message } }, status);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function safeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const arr = v => (Array.isArray(v) ? v : []);
const strList = (v, max, n) => arr(v).map(x => clip(x, n)).filter(Boolean).slice(0, max);
const clientIp = req => req.headers.get('cf-connecting-ip') || 'local';
const HEX = /^#[0-9a-f]{6}$/i;
const okUrl = (u, re) => { try { const x = new URL(String(u)); return x.protocol === 'https:' && re.test(x.hostname) ? x.toString() : ''; } catch { return ''; } };
async function readJson(req) { try { return await req.json(); } catch { return null; } }
const keyOf = id => 'u' + id;
const idOf = key => { const m = /^u(\d{1,12})$/.exec(String(key || '')); return m ? +m[1] : 0; };
const admins = env => String(env.ADMIN_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const isAdmin = (env, me) => !!(me && admins(env).includes(String(me.nickname).toLowerCase()));

// one stored music item (list entry, post item, pick)
function cleanItem(it) {
  if (!it || typeof it !== 'object') return null;
  const title = clip(it.title, 160), artist = clip(it.artist, 120);
  if (!title || !artist) return null;
  const o = { type: it.type === 'track' ? 'track' : 'album', title, artist };
  const album = clip(it.album, 160), year = clip(it.year, 6), genre = clip(it.genre, 80), country = clip(it.country, 40);
  if (album) o.album = album; if (year) o.year = year; if (genre) o.genre = genre; if (country) o.country = country;
  const cover = okUrl(it.cover, COVER_HOST), link = okUrl(it.link, LINK_HOST);
  if (cover) o.cover = cover; if (link) o.link = link;
  const colors = arr(it.colors).filter(c => HEX.test(String(c))).slice(0, 3); if (colors.length) o.colors = colors;
  if (['mesh', 'minimal', 'type'].includes(it.style)) o.style = it.style;
  const r = Number(it.rating); if (Number.isFinite(r) && r > 0) o.rating = Math.min(5, Math.round(r * 2) / 2);
  const m = int(it.match, 0, 99, 0); if (m) o.match = m;
  const why = clip(it.why, 300); if (why) o.why = why;
  return o;
}
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    summary: clip(p.summary, 400),
    genres: arr(p.genres).slice(0, 5).map(g => ({ name: clip(g && g.name, 40), weight: int(g && g.weight, 0, 100, 50) })).filter(g => g.name),
    keywords: strList(p.keywords, 5, 20),
  };
}

async function bump(env, key, windowMs) {
  const row = await env.DB.prepare('INSERT INTO usage (k, n, exp) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n').bind(key, now() + windowMs).first();
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM usage WHERE exp < ?').bind(now()).run();
  return row ? row.n : 1;
}
async function currentUser(req, env) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || token.length > 128) return null;
  return await env.DB.prepare('SELECT u.id, u.nickname FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(await sha256(token), now()).first() || null;
}
const meOut = (env, u) => ({ key: keyOf(u.id), nickname: u.nickname, admin: isAdmin(env, u) });

/* ---------------- auth ---------------- */
async function login(req, env) {
  if (!env.PIN_PEPPER) return fail(500, 'config', '서버 설정(PIN_PEPPER)이 비어 있습니다.');
  const b = await readJson(req);
  const nickname = clip(b && b.nickname, 40), pin = String(b && b.pin || '');
  if (!NICK_RE.test(nickname)) return fail(400, 'bad_nickname', 'Username은 한글·영문·숫자·밑줄로 2~12자여야 합니다.');
  if (!/^\d{4}$/.test(pin)) return fail(400, 'bad_pin', '코드는 숫자 4자리여야 합니다.');
  if (await bump(env, 'login:' + clientIp(req) + ':' + Math.floor(now() / 3600000), 3600000) > 30) return fail(429, 'too_many', '로그인 시도가 너무 많습니다. 1시간 뒤에 다시 시도해 주세요.');
  let user = await env.DB.prepare('SELECT * FROM users WHERE nickname = ?').bind(nickname).first();
  let created = false;
  if (!user) {
    const salt = randHex(16);
    try { user = await env.DB.prepare('INSERT INTO users (nickname, salt, pin_hash, created_at) VALUES (?, ?, ?, ?) RETURNING *').bind(nickname, salt, await hmac(env.PIN_PEPPER, salt + ':' + pin), now()).first(); created = true; }
    catch { return fail(409, 'taken', '방금 같은 Username이 만들어졌습니다. 다시 시도해 주세요.'); }
  } else {
    if (user.locked_until > now()) return fail(429, 'locked', `코드를 여러 번 틀려 잠겼습니다. ${Math.ceil((user.locked_until - now()) / 60000)}분 뒤에 다시 시도해 주세요.`);
    if (!safeEqual(await hmac(env.PIN_PEPPER, user.salt + ':' + pin), user.pin_hash)) {
      const failed = user.failed + 1;
      if (failed >= 5) { await env.DB.prepare('UPDATE users SET failed = 0, locked_until = ? WHERE id = ?').bind(now() + 15 * 60000, user.id).run(); return fail(429, 'locked', '코드를 5번 틀려 15분 동안 잠겼습니다.'); }
      await env.DB.prepare('UPDATE users SET failed = ? WHERE id = ?').bind(failed, user.id).run();
      return fail(401, 'wrong_pin', `코드가 맞지 않습니다. ${5 - failed}번 더 틀리면 15분 동안 잠깁니다.`);
    }
    if (user.failed) await env.DB.prepare('UPDATE users SET failed = 0 WHERE id = ?').bind(user.id).run();
  }
  const token = randHex(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), user.id, now(), now() + SESSION_DAYS * DAY).run();
  return json({ token, user: meOut(env, user), created });
}
async function logout(req, env) {
  const h = req.headers.get('authorization') || '', token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true });
}

/* ---------------- community snapshot ---------------- */
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const postOut = r => ({ id: 'p' + r.id, uname: keyOf(r.user_id), kind: r.kind, items: arr(parse(r.items)), profile: parse(r.profile), why: r.why || '', createdAt: r.created_at });
const FEED_PAGE = 60;
const FEED_KINDS = "('analysis', 'list')";   // 취향 및 추천 + 담은 음악 (the list as it was when ANALYZE & RECOMMEND ran)
// GET /api/feed?before=<createdAt>&bid=<post key>&user=<user key> — older posts, page by page ([더보기])
async function feedPage(req, env) {
  const p = new URL(req.url).searchParams, before = int(p.get('before'), 0, 9e15, 0), bid = /^p(\d{1,12})$/.exec(p.get('bid') || ''), uid = idOf(p.get('user'));
  const where = [`kind IN ${FEED_KINDS}`], args = [];
  if (before) { where.push('(created_at < ? OR (created_at = ? AND id < ?))'); args.push(before, before, bid ? +bid[1] : 0); }
  if (uid) { where.push('user_id = ?'); args.push(uid); }
  const { results } = await env.DB.prepare(`SELECT * FROM posts WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ${FEED_PAGE}`).bind(...args).all();
  return json({ feed: results.map(postOut), more: results.length === FEED_PAGE });
}
async function community(req, env) {
  const me = await currentUser(req, env), admin = isAdmin(env, me);
  const day = kstDay();
  const [posts, users, picks] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM posts WHERE kind IN ${FEED_KINDS} ORDER BY created_at DESC, id DESC LIMIT ${FEED_PAGE}`),
    env.DB.prepare(`SELECT u.id, u.nickname, u.created_at, u.locked_until,
        (SELECT COUNT(*) FROM visits v WHERE v.target_id = u.id) AS visits,
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.kind IN ${FEED_KINDS}) AS posts,
        COALESCE((SELECT MAX(created_at) FROM posts p WHERE p.user_id = u.id), u.created_at) AS last
      FROM users u ORDER BY last DESC LIMIT 500`),
    env.DB.prepare('SELECT * FROM picks WHERE day = ? ORDER BY created_at DESC').bind(day),
  ]);
  const adm = admins(env);
  return json({
    me: me ? meOut(env, me) : null,
    feed: posts.results.map(postOut), feedMore: posts.results.length === FEED_PAGE,
    users: users.results.map(u => ({ key: keyOf(u.id), username: u.nickname, createdAt: u.created_at, last: u.last, visits: u.visits, posts: u.posts, lockedUntil: admin ? u.locked_until : 0 })),
    picks: picks.results.map(p => ({ id: 'k' + p.user_id, uname: keyOf(p.user_id), day: p.day, item: parse(p.item), createdAt: p.created_at })).filter(p => p.item),
    admins: users.results.filter(u => adm.includes(String(u.nickname).toLowerCase())).map(u => keyOf(u.id)),
    day,
  });
}

/* ---------------- my list ---------------- */
async function getLibrary(env, me) {
  const row = await env.DB.prepare('SELECT items FROM library WHERE user_id = ?').bind(me.id).first();
  return json({ items: row ? arr(parse(row.items)) : [] });
}
async function putLibrary(req, env, me) {
  const b = await readJson(req);
  if (!b || !Array.isArray(b.items)) return fail(400, 'bad_items', '목록 형식이 올바르지 않습니다.');
  const seen = new Set();
  const items = b.items.slice(0, 100).map(cleanItem).filter(x => x && !seen.has((x.artist + '|' + x.title).toLowerCase()) && seen.add((x.artist + '|' + x.title).toLowerCase()));
  await env.DB.prepare('INSERT INTO library (user_id, items, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET items = ?2, updated_at = ?3').bind(me.id, JSON.stringify(items), now()).run();
  return json({ ok: true, count: items.length });
}

/* ---------------- posts, picks, visits, messages ---------------- */
async function addPost(req, env, me) {
  const b = await readJson(req);
  const kind = ['list', 'analysis'].includes(b && b.kind) ? b.kind : null;
  if (!kind) return fail(400, 'bad_kind', '소식 종류가 올바르지 않습니다.');
  const items = arr(b.items).slice(0, kind === 'list' ? 100 : 16).map(cleanItem).filter(Boolean);
  if (!items.length) return fail(400, 'empty', '올릴 음악이 없습니다.');
  if (kind === 'list' && items.length < 5) return fail(400, 'too_few', '담은 음악은 5개 이상일 때 올라갑니다.');
  // one list per user per day: the newest replaces that day's earlier one
  if (kind === 'list') { const t = now(), d0 = Date.parse(kstDay(t).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') + 'T00:00:00+09:00'); await env.DB.prepare("DELETE FROM posts WHERE user_id = ? AND kind = 'list' AND created_at >= ?").bind(me.id, d0).run(); }
  if (await bump(env, 'post:' + me.id + ':' + Math.floor(now() / 3600000), 3600000) > 60) return fail(429, 'too_many', '소식은 1시간에 60개까지 올릴 수 있습니다.');
  const profile = kind === 'analysis' ? cleanProfile(b.profile) : null;
  const row = await env.DB.prepare('INSERT INTO posts (user_id, kind, items, profile, why, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(me.id, kind, JSON.stringify(items), profile ? JSON.stringify(profile) : null, '', now()).first();
  return json({ post: postOut(row) });
}
async function deletePost(env, me, key) {
  const id = int(String(key || '').replace(/^p/, ''), 1, 1e12, 0);
  const p = await env.DB.prepare('SELECT user_id FROM posts WHERE id = ?').bind(id).first();
  if (!p) return fail(404, 'gone', '이미 지워진 소식입니다.');
  if (p.user_id !== me.id && !isAdmin(env, me)) return fail(403, 'forbidden', '내 소식만 지울 수 있습니다.');
  await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
async function deleteMyPosts(env, me) { await env.DB.prepare('DELETE FROM posts WHERE user_id = ?').bind(me.id).run(); return json({ ok: true }); }
async function putPick(req, env, me) {
  const b = await readJson(req), item = cleanItem(b && b.item);
  if (!item) return fail(400, 'bad_item', '앨범 정보가 올바르지 않습니다.');
  delete item.rating;
  await env.DB.prepare('INSERT INTO picks (user_id, day, item, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(user_id, day) DO UPDATE SET item = ?3, created_at = ?4').bind(me.id, kstDay(), JSON.stringify(item), now()).run();
  return json({ ok: true });
}
async function deletePick(env, me) { await env.DB.prepare('DELETE FROM picks WHERE user_id = ? AND day = ?').bind(me.id, kstDay()).run(); return json({ ok: true }); }

async function profile(req, env, key) {
  const id = idOf(key);
  const user = id && await env.DB.prepare('SELECT id, nickname, created_at FROM users WHERE id = ?').bind(id).first();
  if (!user) return fail(404, 'no_user', '이 유저는 더 이상 없습니다.');
  const me = await currentUser(req, env);
  if (me && me.id !== user.id) await env.DB.prepare('INSERT OR IGNORE INTO visits (target_id, visitor_id, day) VALUES (?, ?, ?)').bind(user.id, me.id, kstDay()).run();
  const [lib, msgs, posts, lists] = await env.DB.batch([
    env.DB.prepare('SELECT items FROM library WHERE user_id = ?').bind(user.id),
    env.DB.prepare('SELECT id, from_user_id, body, created_at FROM messages WHERE to_user_id = ? ORDER BY created_at DESC LIMIT 40').bind(user.id),
    env.DB.prepare("SELECT * FROM posts WHERE user_id = ? AND kind = 'analysis' ORDER BY created_at DESC, id DESC LIMIT 10").bind(user.id),
    env.DB.prepare("SELECT * FROM posts WHERE user_id = ? AND kind = 'list' ORDER BY created_at DESC, id DESC LIMIT 12").bind(user.id),
  ]);
  return json({
    user: { key: keyOf(user.id), username: user.nickname, createdAt: user.created_at },
    library: lib.results[0] ? arr(parse(lib.results[0].items)) : [],
    messages: msgs.results.map(m => ({ id: 'm' + m.id, from: keyOf(m.from_user_id), body: m.body, createdAt: m.created_at })),
    analyses: posts.results.map(postOut),
    lists: lists.results.map(postOut),
  });
}
async function postMessage(req, env, me, key) {
  const to = idOf(key) && await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(idOf(key)).first();
  if (!to) return fail(404, 'no_user', '이 유저는 더 이상 없습니다.');
  const b = await readJson(req), text = clip(b && b.body, 200);
  if (!text) return fail(400, 'empty', '내용을 적어 주세요.');
  if (await bump(env, 'msg:' + me.id + ':' + Math.floor(now() / 3600000), 3600000) > 15) return fail(429, 'too_many', '방명록은 1시간에 15개까지 남길 수 있습니다.');
  const row = await env.DB.prepare('INSERT INTO messages (to_user_id, from_user_id, body, created_at) VALUES (?, ?, ?, ?) RETURNING id, created_at').bind(to.id, me.id, text, now()).first();
  return json({ message: { id: 'm' + row.id, from: keyOf(me.id), body: text, createdAt: row.created_at } });
}
async function deleteMessage(env, me, key) {
  const id = int(String(key || '').replace(/^m/, ''), 1, 1e12, 0);
  const m = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
  if (!m) return fail(404, 'gone', '이미 지워진 글입니다.');
  if (m.from_user_id !== me.id && m.to_user_id !== me.id && !isAdmin(env, me)) return fail(403, 'forbidden', '내가 쓰거나 받은 글만 지울 수 있습니다.');
  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
async function adminDeleteUser(env, me, key) {
  if (!isAdmin(env, me)) return fail(403, 'forbidden', '관리자만 할 수 있습니다.');
  const id = idOf(key);
  if (!id || id === me.id) return fail(400, 'bad_user', '이 계정은 지울 수 없습니다.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM library WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM posts WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM picks WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM visits WHERE target_id = ? OR visitor_id = ?').bind(id, id),
    env.DB.prepare('DELETE FROM messages WHERE to_user_id = ? OR from_user_id = ?').bind(id, id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}
async function adminUnlock(env, me, key) {
  if (!isAdmin(env, me)) return fail(403, 'forbidden', '관리자만 할 수 있습니다.');
  await env.DB.prepare('UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?').bind(idOf(key)).run();
  return json({ ok: true });
}

/* ---------------- catalogue helpers (Apple iTunes Search + MusicBrainz) ---------------- */
const norm = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/(^|\s)['’]?n['’]?(?=\s)/g, ' and ').replace(/[’'`]/g, '')
  .replace(/\(.*?\)|\[.*?\]|\s-\s(single|ep)$|feat\..*$|-\s*(\d{4}\s*)?remaster.*$/g, '').replace(/^the\s+/, '').replace(/[^a-z0-9가-힣]+/g, '');
const same = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (x.length > 4 && y.length > 4 && (x.includes(y) || y.includes(x)))); };
const art600 = u => okUrl(String(u || '').replace(/\/\d+x\d+bb\./, '/600x600bb.'), COVER_HOST);
// Cloudflare runs each request in its own context: a promise or timer made while serving one visitor must not be
// waited on while serving another (it can hang forever). So nothing here is shared between requests except plain values.
// MusicBrainz asks for about one request a second; each request makes at most a couple, Cloudflare caches the answers,
// and a "busy" (503) answer is retried once after a second.
// Deezer's search only covers the catalogue licensed where the request comes from (Cloudflare usually serves Korean
// visitors from Seoul, where Deezer isn't open); the answer is remembered as a plain value for an hour.
let dzOpenKnown = null, dzOpenAt = 0;
async function deezerOpen() {
  if (dzOpenKnown && now() - dzOpenAt < 3600000) return dzOpenKnown;
  try {
    const r = await fetch('https://api.deezer.com/infos', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    const d = r.ok ? await r.json() : null;
    dzOpenKnown = { open: !!(d && d.open), country: (d && d.country_iso) || '' };
  } catch { dzOpenKnown = { open: false, country: '' }; }
  dzOpenAt = now(); return dzOpenKnown;
}
// Apple sometimes refuses cloud servers: after two failures in a row, leave it alone for ten minutes
let appleFails = 0, appleDownUntil = 0;
async function getJson(url, headers = {}, ttl = 86400) {
  if (url.startsWith('https://api.deezer.com/search') && !(await deezerOpen()).open) return null;
  try {
    const { 'x-priority': _p, ...hdrs } = headers;
    const go = () => fetch(url, { headers: { accept: 'application/json', ...hdrs }, cf: { cacheTtl: ttl, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
    let r = await go();
    // MusicBrainz answers 503 when it's busy (it shares limits across Cloudflare's addresses): wait a moment, try once more
    if (r.status === 503 && url.startsWith('https://musicbrainz.org/')) { await new Promise(res => setTimeout(res, 1200)); r = await go(); }
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function itunesRaw(params, country = 'US') {
  if (now() < appleDownUntil) return null;
  const u = new URL('https://itunes.apple.com/search');
  Object.entries({ media: 'music', limit: '8', country, ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  const d = await getJson(u.toString());
  if (!d) { if (++appleFails >= 2) appleDownUntil = now() + 600000; return null; }
  appleFails = 0; return arr(d.results);
}
async function itunes(params, country = 'US') { return arr(await itunesRaw(params, country)); }
async function albumTracks(album) {
  const u = new URL('https://itunes.apple.com/lookup'); u.searchParams.set('id', album.id); u.searchParams.set('entity', 'song'); u.searchParams.set('country', album.country);
  const d = await getJson(u.toString());
  return d ? arr(d.results).filter(x => x.wrapperType === 'track').map(x => x.trackName) : [];
}
// MusicBrainz knows nearly every released record: true = exists, false = no such record, null = couldn't ask
async function mbExists(type, artist, title) {
  const a = artist.replace(/"/g, ''), t = title.replace(/"/g, '');
  const ent = type === 'track' ? 'recording' : 'release-group';
  const q = type === 'track' ? `recording:"${t}" AND artist:"${a}"` : `releasegroup:"${t}" AND artist:"${a}"`;
  const s = await getJson(`https://musicbrainz.org/ws/2/${ent}?fmt=json&limit=10&query=${encodeURIComponent(q)}`, { 'user-agent': UA, 'x-priority': 'high' }, 604800);
  if (!s) return { mb: null };
  const list = arr(type === 'track' ? s.recordings : s['release-groups']);
  const hit = list.find(x => same(x.title, title) && arr(x['artist-credit']).some(c => same(c.name || (c.artist && c.artist.name), artist) || same(c.artist && c.artist.name, artist)));
  return hit ? { mb: true, cover: type === 'track' ? '' : `https://coverartarchive.org/release-group/${hit.id}/front-500`, year: String(hit['first-release-date'] || '').slice(0, 4) } : { mb: false };
}
// GET /api/exists?type=&artist=&title= — the browser's last check before it drops a recommendation
async function existsLookup(req) {
  const p = new URL(req.url).searchParams, artist = clip(p.get('artist'), 120), title = clip(p.get('title'), 160);
  if (!artist || !title) return json({ mb: null });
  return cached(req, 86400 * 7, async () => { const r = await mbExists(p.get('type') === 'track' ? 'track' : 'album', artist, title); return { ...r, partial: r.mb === null }; });
}
async function findSong(artist, title) {
  const raw = await itunesRaw({ term: `${artist} ${title}`, entity: 'song', limit: '15' });
  const list = arr(raw).filter(x => same(x.artistName, artist) && same(x.trackName, title));
  const original = list.find(x => !/greatest|best of|hits|collection|anthology|essential|live/i.test(x.collectionName)) || list[0];
  return { answered: !!raw, albums: list.map(x => x.collectionName), first: original ? original.collectionName : '', cover: original ? art600(original.artworkUrl100) : '', link: original ? okUrl(original.trackViewUrl, LINK_HOST) : '' };
}

// responses the browser may keep for a while (and Cloudflare caches at the edge)
async function cached(req, ttl, make) {
  const cache = typeof caches !== 'undefined' ? caches.default : null, key = new Request(new URL(req.url).toString());
  if (cache) { const hit = await cache.match(key).catch(() => null); if (hit) return hit; }
  const data = await make();
  const res = new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${ttl}` } });
  if (cache && data && !data.partial) await cache.put(key, res.clone()).catch(() => {});
  return res;
}
// GET /api/cover?type=&artist=&title= — a cover from Apple (US, KR), Deezer or the Cover Art Archive
async function coverLookup(req) {
  const p = new URL(req.url).searchParams, artist = clip(p.get('artist'), 120), title = clip(p.get('title'), 160), track = p.get('type') === 'track';
  if (!artist || !title) return json({ cover: '' });
  return cached(req, 86400 * 7, async () => {
    const tried = { ok: 0 };
    const seen = r => { if (r) tried.ok++; return r; };
    for (const c of ['US', 'KR']) {
      const list = seen(await itunesRaw({ term: `${artist} ${title}`, entity: track ? 'song' : 'album', limit: '10' }, c));
      const hit = arr(list).find(x => same(x.artistName, artist) && same(track ? x.trackName : x.collectionName, title));
      if (hit) return { cover: art600(hit.artworkUrl100), from: 'apple', year: String(hit.releaseDate || '').slice(0, 4), genre: hit.primaryGenreName || '', link: okUrl(track ? hit.trackViewUrl : hit.collectionViewUrl, LINK_HOST) };
    }
    const q = track ? `artist:"${artist.replace(/"/g, '')}" track:"${title.replace(/"/g, '')}"` : `artist:"${artist.replace(/"/g, '')}" album:"${title.replace(/"/g, '')}"`;
    const d = seen(await getJson(`https://api.deezer.com/search/${track ? 'track' : 'album'}?limit=10&q=${encodeURIComponent(q)}`));
    const dh = d && arr(d.data).find(x => same(x.artist && x.artist.name, artist) && same(x.title, title));
    const dc = dh && okUrl((track ? dh.album : dh) && ((track ? dh.album : dh).cover_xl || (track ? dh.album : dh).cover_big), COVER_HOST);
    if (dc) return { cover: dc, from: 'deezer' };
    if (!track) {
      const s = seen(await getJson(`https://musicbrainz.org/ws/2/release-group?fmt=json&limit=5&query=${encodeURIComponent(`releasegroup:"${title.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`)}`, { 'user-agent': UA, 'x-priority': 'mid' }, 604800));
      const rg = s && arr(s['release-groups']).find(x => same(x.title, title));
      if (rg) return { cover: `https://coverartarchive.org/release-group/${rg.id}/front-250`, from: 'caa', year: String(rg['first-release-date'] || '').slice(0, 4) };
    }
    return { cover: '', partial: !tried.ok };
  });
}
// MusicBrainz release groups sort records the way RYM's discography does: Album / EP / Single, with Live, Compilation
// and the like as secondary types. kind 'album' = a plain studio album (RYM "Album").
const mbCredit = ac => arr(ac).map(c => (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || '')).join('').trim();
const mbKind = rg => { const p = rg['primary-type'] || '', s = arr(rg['secondary-types']); if (p === 'Album') return s.length ? String(s[0]).toLowerCase() : 'album'; return p === 'EP' ? 'ep' : p === 'Single' ? 'single' : 'other'; };
const fromMbRg = (rg, artist) => { const kind = mbKind(rg); return { type: 'album', title: clip(rg.title, 160), artist: clip(artist || mbCredit(rg['artist-credit']), 120), year: String(rg['first-release-date'] || '').slice(0, 4), cover: `https://coverartarchive.org/release-group/${rg.id}/front-250`, mbid: rg.id, kind, single: kind === 'single', ep: kind === 'ep' }; };
const luceneWords = q => String(q).replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim();

// GET /api/artist?name= — one artist's discography: MusicBrainz (RYM-style, in release order) + Apple when reachable
async function artistLookup(req) {
  const p = new URL(req.url).searchParams, name = clip(p.get('name'), 120);
  if (!name) return json({ mb: [], albums: [], songs: [] });
  return cached(req, 86400, async () => {
    const mine = a => same(a, name) || norm(a) === norm(name);
    const [usA, usS, mbA] = await Promise.all([
      itunesRaw({ term: name, entity: 'album', attribute: 'artistTerm', limit: '100' }, 'US'),
      itunesRaw({ term: name, entity: 'song', attribute: 'artistTerm', limit: '25' }, 'US'),
      getJson(`https://musicbrainz.org/ws/2/artist?fmt=json&limit=5&query=${encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`)}`, { 'user-agent': UA, 'x-priority': 'high' }, 604800),
    ]);
    const ar = arr(mbA && mbA.artists).find(x => mine(x.name)) || arr(mbA && mbA.artists).find(x => (x.score || 0) >= 98);
    const rgs = ar ? await getJson(`https://musicbrainz.org/ws/2/release-group?fmt=json&limit=100&artist=${ar.id}&type=album|ep`, { 'user-agent': UA, 'x-priority': 'high' }, 86400) : null;
    const mb = arr(rgs && rgs['release-groups']).map(rg => fromMbRg(rg, ar.name)).filter(x => x.title)
      .sort((x, y) => (x.year || '9999').localeCompare(y.year || '9999'));
    const albums = [], seenA = new Set();
    arr(usA).filter(x => mine(x.artistName)).forEach(x => { const o = { type: 'album', title: String(x.collectionName || '').replace(/ - (Single|EP)$/, ''), artist: x.artistName, year: String(x.releaseDate || '').slice(0, 4), genre: x.primaryGenreName || '', cover: art600(x.artworkUrl100), link: okUrl(x.collectionViewUrl, LINK_HOST), single: / - Single$/.test(x.collectionName) || (x.trackCount || 9) <= 3, ep: / - EP$/.test(x.collectionName) }; const k = norm(o.title); if (k && !seenA.has(k)) { seenA.add(k); albums.push(o); } });
    const songs = [], seenS = new Set();
    arr(usS).filter(x => mine(x.artistName)).forEach(x => { const k = norm(x.trackName); if (!k || seenS.has(k) || songs.length >= 10) return; seenS.add(k); songs.push({ type: 'track', title: x.trackName, artist: x.artistName, album: String(x.collectionName || '').replace(/ - (Single|EP)$/, ''), year: String(x.releaseDate || '').slice(0, 4), genre: x.primaryGenreName || '', cover: art600(x.artworkUrl100), link: okUrl(x.trackViewUrl, LINK_HOST) }); });
    return { mb, albums, songs, partial: !mbA && !usA };
  });
}
// GET /api/search?q= — albums from MusicBrainz (reachable from our server; Apple and Deezer refuse it)
async function searchLookup(req) {
  const q = luceneWords(clip(new URL(req.url).searchParams.get('q'), 80)).toLowerCase();   // lower case: AND/OR/NOT stay plain words
  if (q.length < 2) return json({ items: [] });
  return cached(req, 3600, async () => {
    const query = `(releasegroup:(${q}) OR artist:(${q})) AND (primarytype:album OR primarytype:ep)`;
    const s = await getJson(`https://musicbrainz.org/ws/2/release-group?fmt=json&limit=40&query=${encodeURIComponent(query)}`, { 'user-agent': UA, 'x-priority': 'high' }, 86400);
    return { items: arr(s && s['release-groups']).filter(rg => (rg.score || 0) >= 40).map(rg => fromMbRg(rg)).filter(x => x.title && x.artist), partial: !s };
  });
}

// GET /api/charts — what's being played most in Korea right now (Apple Music, cached for hours)
async function charts() {
  const d = await getJson('https://rss.applemarketingtools.com/api/v2/kr/music/most-played/25/albums.json', {}, 21600);
  const albums = arr(d && d.feed && d.feed.results).map(x => ({ type: 'album', title: clip(x.name, 160), artist: clip(x.artistName, 120), year: clip(String(x.releaseDate || '').slice(0, 4), 6), genre: clip(arr(x.genres).map(g => g.name).filter(g => g !== 'Music')[0] || '', 80), cover: art600(x.artworkUrl100), link: okUrl(x.url, LINK_HOST) })).filter(x => x.title && x.artist);
  return new Response(JSON.stringify({ albums }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
// GET /api/img?u= — album art relayed for "영수증 출력" when the image host doesn't allow it directly (art hosts only)
async function img(req) {
  const u = okUrl(new URL(req.url).searchParams.get('u'), COVER_HOST);
  if (!u) return fail(400, 'bad_url', '허용되지 않은 주소입니다.');
  try {
    const r = await fetch(u, { cf: { cacheTtl: 604800, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//.test(type)) return fail(502, 'img', '이미지를 가져오지 못했습니다.');
    return new Response(r.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*' } });
  } catch { return fail(502, 'img', '이미지를 가져오지 못했습니다.'); }
}

// GET /api/info?artist=&title=&type= — year, genres and country from MusicBrainz (cached a week)
async function info(req, env) {
  const p = new URL(req.url).searchParams, artist = clip(p.get('artist'), 120), title = clip(p.get('title'), 160), type = p.get('type') === 'track' ? 'track' : 'album';
  if (!artist) return json({});
  const out = {};
  const a = await getJson(`https://musicbrainz.org/ws/2/artist?fmt=json&limit=3&query=${encodeURIComponent(`artist:"${artist.replace(/"/g, '')}"`)}`, { 'user-agent': UA }, 604800);
  const ar = a && arr(a.artists).find(x => same(x.name, artist));
  if (ar) out.countryCode = ar.country || (ar.area && ar.area['iso-3166-1-codes'] && ar.area['iso-3166-1-codes'][0]) || '';
  if (title) {
    const q = type === 'track' ? `recording:"${title.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"` : `releasegroup:"${title.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`;
    const s = await getJson(`https://musicbrainz.org/ws/2/${type === 'track' ? 'recording' : 'release-group'}?fmt=json&limit=5&query=${encodeURIComponent(q)}`, { 'user-agent': UA }, 604800);
    const list = s ? arr(type === 'track' ? s.recordings : s['release-groups']) : [];
    const hit = list.find(x => same(x.title, title));
    if (hit) {
      const date = hit['first-release-date'] || ''; if (date) out.year = date.slice(0, 4);
      const tags = arr(hit.tags).sort((x, y) => (y.count || 0) - (x.count || 0)).map(t => t.name).slice(0, 2);
      if (tags.length) out.genre = tags.map(t => t.replace(/\b\w/g, c => c.toUpperCase())).join(', ');
      if (type === 'track') { const rel = arr(hit.releases).find(r => r['release-group'] && r['release-group']['primary-type'] === 'Album'); if (rel) out.album = rel.title; }
      else out.cover = `https://coverartarchive.org/release-group/${hit.id}/front-500`;
    }
  }
  return json(out);
}

/* ---------------- recommendations (Gemini free tier) ---------------- */
const AXES = ['장르', '프로듀서·엔지니어', '세션·참여진', '레이블', '씬·지역', '시대·영향 관계'];
const SIM_TXT = ['', '사용자 목록과 사운드·분위기·형식이 아주 가까운 작품만', '가까운 작품 중심에 약간 다른 결을 섞어서', '가까운 작품과 새로운 방향을 반반으로', '연결고리는 분명하되 장르·시대·형식이 다른 작품 위주로', '연결고리 하나를 따라 의외의 장르·시대·지역으로 넘어가는 발견 위주로'];
const POP_TXT = ['', '대중적으로 널리 알려진 대표작 위주로', '잘 알려진 작품 중심에 덜 알려진 작품을 조금 섞어서', '잘 알려진 작품과 숨은 작품을 반반 정도로', '덜 알려진 작품 위주로, 잘 알려진 작품은 소수만', '평가 수가 적은 숨은 작품 위주로 (단, 실존이 확실한 것만)'];
const TONE = `[문체 — 반드시 지킬 것]
summary, why, detail을 포함한 모든 한국어 문장은 존댓말 합쇼체('~합니다', '~입니다', '~습니다')로 끝내라.
'~한다', '~이다', '~했다' 같은 반말 평서문과 '~해요', '~예요' 체는 절대 쓰지 마라.`;
function buildPrompt(items, o, more) {
  const list = items.map((it, i) => `${i + 1}. [${it.type === 'track' ? '곡' : '앨범'}] ${it.artist} — ${it.title}${it.year ? ' (' + it.year + ')' : ''}${it.rating ? ` — 별점 ${it.rating}/5` : ''}`).join('\n');
  const fill = more && more.fill ? int(more.fill, 1, 7, 0) : 0;
  const n0 = fill || ([3, 5, 7].includes(+o.n) ? +o.n : 5), n = n0 + (fill ? 1 : n0 >= 5 ? 2 : 1);  // spares: anything the catalogues don't know is dropped
  const fmt = { both: '앨범과 곡을 섞어서', album: '앨범만', track: '곡(싱글 또는 수록곡)만' }[o.format] || '앨범과 곡을 섞어서';
  const axes = strList(o.axes, 8, 20).filter(a => AXES.includes(a)), region = strList(o.region, 6, 20);
  const f = int(o.eraFrom, 1900, 2030, 0), t = int(o.eraTo, 1900, 2030, 0);
  const era = f && t ? `- ${Math.min(f, t)}년대부터 ${Math.max(f, t)}년대까지 발매된 작품만 추천하라.` : f ? `- ${f}년대 이후에 발매된 작품만 추천하라.` : t ? `- ${t}년대까지 발매된 작품만 추천하라.` : '';
  const prev = more ? strList(more.prev, 120, 160) : [], up = more ? strList(more.up, 60, 160) : [], down = more ? strList(more.down, 60, 160) : [], gone = more ? strList(more.gone, 40, 160) : [];
  const lines = [
    `- 이 취향에 맞는 음악을 ${n}개 추천하라. 형식: ${fmt}.`,
    `- 유사도: ${SIM_TXT[int(o.sim, 1, 5, 3)]}.`, `- 인지도: ${POP_TXT[int(o.pop, 1, 5, 3)]}.`, era,
    region.length ? `- 다음 지역의 작품을 중심으로 추천하라: ${region.join(', ')}.` : '',
    o.vocal === 'vocal' ? '- 보컬이 중심인 음악 위주로.' : (o.vocal === 'inst' ? '- 연주곡(인스트루멘털) 위주로.' : ''),
    o.same ? '- 목록에 있는 아티스트의 다른 작품도 추천해도 된다.' : '- 목록에 이미 있는 아티스트의 작품은 추천하지 마라.',
    '- 목록에 있는 작품 자체는 추천하지 마라. 한 아티스트당 최대 1개.',
    clip(o.exclude, 300) ? `- 다음 아티스트는 추천하지 마라: ${clip(o.exclude, 300)}` : '',
    clip(o.note, 300) ? '- 사용자의 추가 요청: ' + clip(o.note, 300) : '',
    prev.length ? '- 이미 추천한 다음 작품은 다시 추천하지 마라: ' + prev.join('; ') : '',
    gone.length ? '- 다음 작품은 Apple Music·Deezer 어디에도 없어 지어낸 것으로 판정돼 뺐다. 이런 실수를 반복하지 말고, 디스코그래피가 잘 알려진 아티스트의 실제 정규 앨범이나 대표곡만 써라: ' + gone.join('; ') : '',
    up.length ? '- 사용자가 "취향에 맞다"고 표시한 추천: ' + up.join('; ') + ' → 이 방향을 더 반영하라.' : '',
    down.length ? '- 사용자가 "아니다"라고 표시한 추천: ' + down.join('; ') + ' → 이런 방향은 피하라.' : '',
  ].filter(Boolean).join('\n');
  return `${TONE}

너는 위키피디아와 RateYourMusic(RYM)에 정리된 음반 정보(장르 체계, 크레딧, 레이블, 씬)에 정통한 음악 큐레이터다.
아래는 사용자가 좋아하는 음악 목록이다.

${list}

[분석 방법]
- 각 작품의 RYM 장르, 프로듀서·엔지니어, 세션 참여진, 레이블, 씬, 시대와 영향 관계를 떠올리고 반복되거나 서로 이어지는 연결을 찾아라.
- 다음 축을 우선해서 연결고리를 찾아라: ${(axes.length ? axes : AXES).join(', ')}.
- 별점이 높을수록 취향의 중심으로 보고 더 무겁게 반영하라. 3 이하는 주변적인 취향으로 다뤄라.

[요청]
${lines}

[사실 확인 — 가장 중요]
- 추천한 작품은 서버가 Apple Music·Deezer 카탈로그에서 하나하나 찾아본다. 찾지 못한 작품은 지어낸 것으로 보고 버린다.
- 그러니 제목이 정확히 떠오르지 않는 작품, 존재 여부가 애매한 작품은 절대 쓰지 마라. 숨은 작품을 추천할 때도 실제로 발매된 것을 확실히 아는 것만 써라.
- 아티스트의 다른 앨범 제목, 수록곡 제목, 다른 아티스트의 앨범 제목을 섞어 새 제목을 만들지 마라.
① 실제로 존재하는 작품인가 ② 아티스트와 제목 철자가 원어 표기 그대로인가 ③ 연도가 재발매·리마스터가 아닌 최초 발매 연도인가 ④ 곡이 그 앨범에 실제로 수록됐는가 ⑤ 연결 근거로 든 사람·레이블이 실제로 참여했는가. 하나라도 확신이 없으면 그 작품은 빼라.
⑥ start_with는 반드시 '바로 그 앨범'의 실제 트랙리스트에 있는 곡이어야 한다. 같은 아티스트의 다른 앨범에 실린 곡, 그 아티스트가 다른 앨범에서 커버한 곡, 다른 아티스트의 원곡은 안 된다. 확실하지 않으면 빈 문자열.
⑦ 곡을 추천할 때 album은 그 곡이 처음 실린 '그 아티스트의' 앨범이어야 한다. 확실하지 않으면 빈 문자열.

[작성 규칙 — 짧고 핵심만]
- why: 존댓말 2문장, 합쳐서 110자 이내. 사용자 목록의 작품을 하나 이상 짚고 소리·분위기의 공통점을 구체적으로. 뻔한 칭찬 금지.
- axis: 가장 강한 연결 축 하나. detail은 25자 이내 근거.
- genre: RYM 영어 장르명 1~2개, 쉼표로. country: 아티스트 출신 국가(한국어).
- match: 취향 적합도(50~99 정수). 높은 순으로.

[출력 형식]
JSON Lines로만 답하라. 한 줄에 JSON 객체 하나. 코드펜스나 다른 문장은 쓰지 마라. 문자열 안에 줄바꿈 금지.
${more ? '' : `첫 줄은 취향 프로필:
{"kind":"profile","summary":"존댓말 2문장, 합쳐서 120자 이내로 취향의 핵심 해석","genres":[{"name":"Trip Hop","weight":85}],"keywords":["몽환적","야행성","빈티지","멜랑콜리"]}
(genres 상위 5개, keywords 한국어 4개)
그다음 줄부터 `}추천 하나당 한 줄:
{"kind":"rec","type":"album 또는 track","title":"...","artist":"...","year":"1998","album":"곡이면 수록 앨범","genre":"...","country":"...","axis":{"axis":"프로듀서","detail":"..."},"why":"...습니다. ...입니다.","start_with":"앨범이면 먼저 들어볼 곡","match":88}`;
}

// Gemini, streamed — tuned for speed.
// • The quick model goes first (the stronger one only for "깊게 분석" or as a backup).
// • Hedging: if no text has arrived after a few seconds, the next model starts alongside and the first to answer wins.
// • A stream that goes quiet is dropped instead of being waited on.
// New AI Studio keys ("AQ.") use the Interactions endpoint, older "AIza" keys use generateContent.
const fastModel = env => env.GEMINI_FAST_MODEL || 'gemini-3.6-flash';
const deepModel = env => env.GEMINI_MODEL || 'gemini-3.8-flash';
const modelList = (env, deep = false) => {
  const extra = String(env.GEMINI_FALLBACKS ?? 'gemini-3.5-flash-lite').split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(deep ? [deepModel(env), fastModel(env), ...extra] : [fastModel(env), ...extra, deepModel(env)])];
};
const thinkingFor = m => (/3\.8-flash$|3\.6-flash$/.test(m) ? 'low' : /^gemini-3-flash/.test(m) ? 'minimal' : '');
async function* sse(body, onAny) {
  const reader = body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    onAny && onAny();
    buf += dec.decode(value, { stream: true });
    let k;
    while ((k = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, k).replace(/\r$/, ''); buf = buf.slice(k + 1);
      if (line.startsWith('data:')) { const d = line.slice(5).trim(); if (d && d !== '[DONE]') yield d; }
    }
  }
}
function deltaText(api, d) {
  const o = parse(d); if (!o) return '';
  if (api === 'interactions') return o.delta && o.delta.type === 'text' && typeof o.delta.text === 'string' ? o.delta.text : '';
  const parts = o.candidates && o.candidates[0] && o.candidates[0].content && o.candidates[0].content.parts;
  return Array.isArray(parts) ? parts.filter(p => !p.thought).map(p => p.text || '').join('') : '';
}
// open one model's stream (tries the other endpoint / no thinking level when the first is refused)
async function openModel(key, model, prompt, signal, notes) {
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const apis = /^AIza/.test(key) ? ['generateContent', 'interactions'] : ['interactions', 'generateContent'];
  let think = thinkingFor(model);
  for (let a = 0; a < apis.length; a++) {
    const api = apis[a];
    const url = api === 'interactions' ? `${base}/interactions` : `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const body = api === 'interactions'
      ? { model, input: prompt, stream: true, ...(think ? { generation_config: { thinking_level: think } } : {}) }
      : { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, ...(think ? { thinkingConfig: { thinkingLevel: think } } : {}) } };
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key, ...(api === 'interactions' ? { 'Api-Revision': '2026-05-20' } : {}) }, body: JSON.stringify(body), signal }); }
    catch (e) { notes.push(`${model}: ${signal.aborted ? '시간 초과' : '응답 없음'}`); return { fail: 'net' }; }
    if (r.ok) return { r, api };
    const raw = await r.text().catch(() => ''), j = parse(raw), msg = String(j && j.error && (j.error.message || j.error.status) || raw).slice(0, 140);
    notes.push(`${model} ${api}: ${r.status} ${msg}`);
    if (r.status === 400 && think) { think = ''; a--; continue; }
    if (r.status === 429) return { fail: 'quota' };
    if ([401, 403, 404].includes(r.status) && a === 0) continue;
    return { fail: String(r.status) };
  }
  return { fail: 'endpoint' };
}
async function geminiStream(env, prompt, onText, opt = {}) {
  const { hedgeMs = 12000, firstTextMs = 25000, idleMs = 14000, totalMs = 75000, deep = false, models: only } = opt;
  const key = String(env.GEMINI_API_KEY || '').trim(), models = only || modelList(env, deep), notes = [];
  let quota = 0, next = 0, live = 0, winner = null, finished = false, hedgeT = 0, totalT = 0;
  const runs = [];
  return await new Promise(resolve => {
    const finish = res => {
      if (finished) return; finished = true; clearTimeout(hedgeT); clearTimeout(totalT);
      runs.forEach(x => { if (x !== winner) x.ctl.abort(); clearTimeout(x.t); });
      resolve(res);
    };
    const failAll = () => {
      if (quota && quota === models.length) return finish({ error: { status: 429, code: 'ai_quota', message: '오늘 무료 추천 한도가 모두 사용되었습니다. 내일 다시 이용해 주세요.' }, notes });
      if (notes.some(n => / 40[13] /.test(n))) return finish({ error: { status: 502, code: 'ai_auth', message: 'Gemini API 키가 거부되었습니다. GEMINI_API_KEY 값을 확인해 주세요.' }, notes });
      finish({ error: { status: 503, code: 'ai_busy', message: '추천 엔진이 지금 붐빕니다. 1~2분 뒤 다시 시도해 주세요.' }, notes });
    };
    const launch = () => {
      clearTimeout(hedgeT);
      if (finished || winner) return;
      if (next >= models.length) { if (!live) failAll(); return; }
      const run = { model: models[next++], ctl: new AbortController(), t: 0 };
      runs.push(run); live++;
      const arm = ms => { clearTimeout(run.t); run.t = setTimeout(() => run.ctl.abort(), ms); };
      arm(firstTextMs);
      hedgeT = setTimeout(launch, hedgeMs);         // nothing yet → start the next model alongside
      (async () => {
        const o = await openModel(key, run.model, prompt, run.ctl.signal, notes);
        if (!o.r) { if (o.fail === 'quota') quota++; return false; }
        let got = 0;
        try {
          for await (const d of sse(o.r.body, () => { if (got) arm(idleMs); })) {
            const txt = deltaText(o.api, d); if (!txt) continue;
            if (!winner) { winner = run; clearTimeout(hedgeT); runs.forEach(x => { if (x !== run) x.ctl.abort(); }); }
            if (winner !== run) { run.ctl.abort(); return false; }
            got += txt.length; arm(idleMs); onText(txt);
          }
        } catch (e) { notes.push(`${run.model}: ${got ? '응답이 중간에 멈춤' : '첫 응답이 늦음'}`); }
        clearTimeout(run.t);
        if (got) { finish({ ok: true, model: run.model, notes }); return true; }
        notes.push(`${run.model}: 빈 응답`); return false;
      })().then(ok => { live--; if (!ok && !winner && !finished) launch(); }, () => { live--; if (!winner && !finished) launch(); });
    };
    totalT = setTimeout(() => { if (winner) { winner.ctl.abort(); finish({ ok: true, model: winner.model, notes: [...notes, '시간 제한으로 일부만 받음'] }); } else { notes.push('시간 초과'); runs.forEach(x => x.ctl.abort()); failAll(); } }, totalMs);
    launch();
  });
}
async function askGemini(env, prompt, opt = {}) { let text = ''; const r = await geminiStream(env, prompt, t => { text += t; }, { firstTextMs: 15000, totalMs: 30000, ...opt }); return r.ok ? { text, model: r.model, notes: r.notes } : r; }

// hands over each complete {...} as soon as its closing brace arrives (one per line or pretty-printed — either works)
function objects(onObj) {
  let cur = '', depth = 0, inStr = false, esc = false;
  return txt => {
    for (const c of txt) {
      if (!depth) { if (c === '{') { depth = 1; cur = '{'; } continue; }
      cur += c;
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && !--depth) { onObj(cur); cur = ''; }
    }
  };
}
function recLine(line) {
  const o = parse(line.trim().replace(/,$/, '')); if (!o || typeof o !== 'object') return null;
  if (o.kind === 'profile') return { profile: cleanProfile(o) };
  if (o.kind !== 'rec') return null;
  const r = cleanItem(o); if (!r) return null;
  r.axis = o.axis && typeof o.axis === 'object' ? { axis: clip(o.axis.axis, 20), detail: clip(o.axis.detail, 60) } : null;
  r.start_with = r.type === 'track' ? '' : clip(o.start_with, 120);
  return { rec: r };
}

// check one recommendation against Apple's catalogue (MusicBrainz as a fallback) and return what changed
// check one recommendation against the catalogues and return what changed.
// missing: at least two catalogues answered and none of them knows this work → it's dropped (spares and a top-up replace it)
async function appleAlbum(artist, title, c) {
  const list = await itunesRaw({ term: `${artist} ${title}`, entity: 'album', limit: '10' }, c);
  const hit = arr(list).find(x => same(x.artistName, artist) && same(x.collectionName, title));
  return hit ? { id: hit.collectionId, country: c, cover: art600(hit.artworkUrl100), link: okUrl(hit.collectionViewUrl, LINK_HOST), answered: true } : { answered: !!list };
}
// Fast and strict: confirmed (verified) only by a catalogue hit; dropped (missing) only when Apple answered "no" AND MusicBrainz
// answered "no". When the server can't reach Apple, nothing is decided here: the browser checks Apple itself.
async function verifyOne(r, budget) {
  const patch = {}; let fixed = false;
  const take = n => { if (budget.n < n) return false; budget.n -= n; return true; };
  if (now() < appleDownUntil || !take(1)) return { patch, fixed };
  if (r.type === 'track') {
    const s = await findSong(r.artist, r.title);
    if (!s.answered) return { patch, fixed };
    if (s.albums.length) {
      patch.verified = true;
      if (s.cover) patch.cover = s.cover; if (s.link) patch.link = s.link;
      if (!s.albums.some(a => same(a, r.album)) && s.first && s.first !== r.album) { patch.album = s.first; fixed = true; }
      return { patch, fixed };
    }
    if (take(1)) {
      const m = await mbExists('track', r.artist, r.title);
      if (m.mb === true) { patch.verified = true; patch.album = ''; fixed = true; }      // real, but we can't vouch for the album name
      else if (m.mb === false) return { patch, fixed, missing: true };
    }
    return { patch, fixed };
  }
  let al = await appleAlbum(r.artist, r.title, 'US');
  if (!al.answered) return { patch, fixed };
  if (!al.id && take(1)) { const kr = await appleAlbum(r.artist, r.title, 'KR'); if (kr.id) al = kr; }
  if (!al.id) {
    if (!take(1)) return { patch, fixed };
    const m = await mbExists('album', r.artist, r.title);
    if (m.mb === false) return { patch, fixed, missing: true };
    if (m.mb === true) { patch.verified = true; if (m.cover) patch.cover = m.cover; if (r.start_with) { patch.start_with = ''; fixed = true; } }  // no tracklist to check the song against: hide it
    return { patch, fixed };
  }
  patch.verified = true;
  if (al.cover) patch.cover = al.cover; if (al.link) patch.link = al.link;
  const tracks = take(1) ? await albumTracks(al) : [];
  if (!tracks.length) return { patch, fixed };
  const exact = r.start_with && tracks.find(t => same(t, r.start_with));
  if (exact) { if (exact !== r.start_with) patch.start_with = exact; return { patch, fixed }; }
  // not on this album: take the album's most popular song (Apple ranks song results by popularity)
  let pick = '';
  if (take(1)) {
    const songs = await itunes({ term: r.artist, entity: 'song', limit: '50' }, al.country);
    const hit = songs.find(x => x.collectionId === al.id) || songs.find(x => same(x.collectionName, r.title));
    if (hit) pick = tracks.find(t => same(t, hit.trackName)) || hit.trackName;
  }
  if (pick) { patch.start_with = pick; return { patch, fixed: true }; }
  patch.start_with = ''; return { patch, fixed: true, needPick: [...new Set(tracks)].slice(0, 30) };
}

// POST /api/pick — { items: [{ artist, title, tracks }] } → the song to start with, always one of the given tracks
async function pickTracks(req, env) {
  const b = await readJson(req);
  const items = arr(b && b.items).slice(0, 8).map(x => ({ artist: clip(x && x.artist, 120), title: clip(x && x.title, 160), tracks: strList(x && x.tracks, 40, 160) })).filter(x => x.artist && x.title && x.tracks.length);
  if (!items.length || !env.GEMINI_API_KEY) return json({ picks: [] });
  if (await bump(env, 'pick:' + clientIp(req) + ':' + kstDay(), DAY) > 60) return json({ picks: [] });
  let txt = '';
  const ask = items.map((x, n) => `${n}. ${x.artist} — ${x.title}\n   실제 트랙리스트: ${x.tracks.join(' / ')}`).join('\n');
  const q = await geminiStream(env, `다음 앨범마다 처음 듣는 사람에게 권할 대표곡 하나를 반드시 주어진 실제 트랙리스트 안에서 골라라.\n${ask}\nJSON 배열만 출력: [{"n":0,"track":"트랙리스트에 적힌 그대로"}]`, t => { txt += t; }, { models: ['gemini-3.5-flash-lite', 'gemini-3.6-flash'], hedgeMs: 3000, firstTextMs: 6000, totalMs: 9000 });
  const out = q.ok ? parse(txt.replace(/```(?:json)?/g, '').trim().replace(/^[^[]*/, '').replace(/[^\]]*$/, '')) : null;
  return json({ picks: items.map((x, n) => { const o = arr(out).find(v => v && +v.n === n); return (o && x.tracks.find(tr => same(tr, o.track))) || ''; }) });
}

// POST /api/recommend → a stream of JSON lines: profile, each rec as it is written, then fixes from the catalogue check
async function recommend(req, env) {
  if (!env.GEMINI_API_KEY) return fail(500, 'config', '서버 설정(GEMINI_API_KEY)이 비어 있습니다.');
  const b = await readJson(req);
  const items = arr(b && b.items).slice(0, 100).map(cleanItem).filter(Boolean);
  if (items.length < 5) return fail(400, 'too_few', '음악을 5개 이상 담아 주세요.');
  const limit = int(env.REC_DAILY_LIMIT, 1, 1000, 20);
  if (await bump(env, 'rec:' + clientIp(req) + ':' + kstDay(), DAY) > limit) return fail(429, 'daily_limit', `오늘 받을 수 있는 추천 ${limit}회를 모두 사용했습니다. 내일 다시 이용해 주세요.`);
  const prompt = buildPrompt(items, (b && b.opts) || {}, b && b.more);
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter(), te = new TextEncoder();
  const send = o => w.write(te.encode(JSON.stringify(o) + '\n')).catch(() => {});
  (async () => {
    const budget = { n: 36 }, checks = [], recs = [], seen = new Set(), picks = [], gone = [], t0 = now();
    const want = b && b.more && b.more.fill ? int(b.more.fill, 1, 7, 1) : [3, 5, 7].includes(+(b && b.opts && b.opts.n)) ? +b.opts.n : 5;
    let fixed = 0, dropped = 0, profiled = false;
    send({ t: 'meta', verify: now() >= appleDownUntil });
    const onLine = line => {
      const x = recLine(line); if (!x) return;
      if (x.profile) { if (!profiled) { profiled = true; send({ t: 'profile', profile: x.profile }); } return; }
      const r = x.rec, k = (r.artist + '|' + r.title).toLowerCase(); if (seen.has(k)) return; seen.add(k);
      const i = recs.push(r) - 1; send({ t: 'rec', i, rec: r });
      checks.push(verifyOne(r, budget).then(({ patch, fixed: f, needPick, missing }) => { if (missing) { dropped++; gone.push(`${r.artist} — ${r.title}`); send({ t: 'drop', i }); return; } if (f) fixed++; if (needPick) picks.push({ i, r, tracks: needPick }); if (Object.keys(patch).length) send({ t: 'fix', i, patch }); }).catch(() => {}));
    };
    try {
      const deep = !!(b && b.opts && b.opts.deep);
      const res = await geminiStream(env, prompt, objects(onLine), deep ? { deep, hedgeMs: 14000, firstTextMs: 40000, totalMs: 85000 } : {});
      if (!res.ok) { if (!recs.length) await send({ t: 'error', ...res.error, notes: res.notes }); }
      else if (!recs.length) await send({ t: 'error', code: 'ai_format', message: '추천 결과를 읽지 못했습니다. 다시 시도해 주세요.' });
      await Promise.race([Promise.all(checks), new Promise(r => setTimeout(r, 8000))]);
      // too many were made up: ask once more for real, well-documented works to fill the gap
      const short = want - (recs.length - dropped);
      if (res.ok && short > 0 && now() - t0 < 50000) {
        const extra = `\n\n[추가 요청 — 반드시 지킬 것]\n- 다음 작품은 Apple Music·Deezer에서 찾을 수 없어 실존하지 않는 것으로 보고 뺐다: ${gone.join('; ')}\n- 이미 추천한 작품도 다시 쓰지 마라: ${recs.map(x => `${x.artist} — ${x.title}`).join('; ')}\n- 대신 음원 사이트에 확실히 있는 잘 알려진 정규 앨범이나 곡만 ${short + 1}개 더 추천하라. 프로필 줄은 쓰지 말고 rec 줄만 써라.`;
        const before = checks.length;
        await geminiStream(env, prompt + extra, objects(onLine), { hedgeMs: 8000, firstTextMs: 20000, totalMs: 35000 });
        await Promise.race([Promise.all(checks.slice(before)), new Promise(r => setTimeout(r, 8000))]);
      }
      if (picks.length) {
        // albums only MusicBrainz knows: one quick call on the lightest model chooses a song from the real tracklist
        const ask = picks.map((x, n) => `${n}. ${x.r.artist} — ${x.r.title}\n   실제 트랙리스트: ${x.tracks.join(' / ')}`).join('\n');
        let txt = '';
        const q = await geminiStream(env, `다음 앨범마다 처음 듣는 사람에게 권할 대표곡 하나를 반드시 주어진 실제 트랙리스트 안에서 골라라.\n${ask}\nJSON 배열만 출력: [{"n":0,"track":"트랙리스트에 적힌 그대로"}]`, t => { txt += t; }, { models: ['gemini-3.5-flash-lite', 'gemini-3.6-flash'], hedgeMs: 3000, firstTextMs: 6000, totalMs: 9000 });
        const out = q.ok ? parse(txt.replace(/```(?:json)?/g, '').trim().replace(/^[^[]*/, '').replace(/[^\]]*$/, '')) : null;
        picks.forEach((x, n) => { const o = arr(out).find(v => v && +v.n === n); const t = o && x.tracks.find(tr => same(tr, o.track)); if (t) send({ t: 'fix', i: x.i, patch: { start_with: t } }); });
      }
      if (recs.length) await send({ t: 'done', fixed, dropped, model: res.model || '' });
    } catch (e) { await send({ t: 'error', code: 'server_error', message: '서버에서 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.' }); }
    finally { await w.close().catch(() => {}); }
  })();
  return new Response(readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

// open /api/health in a browser — reports yes/no only, never secret values
async function health(env, req) {
  let db = 'missing';
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      const lack = ['users', 'sessions', 'library', 'posts', 'picks', 'visits', 'messages', 'usage'].filter(n => !results.some(r => r.name === n));
      db = lack.length ? 'tables_missing: ' + lack.join(', ') : 'ok';
    } catch (e) { db = 'error: ' + String(e && e.message || e).slice(0, 120); }
  }
  const k = env.GEMINI_API_KEY || '';
  return json({
    version: 2, db, gemini_key: !!k,
    gemini_key_format: k ? (k.trim() !== k ? 'has_spaces' : /^AQ\./.test(k) ? 'AQ' : /^AIza/.test(k) ? 'AIza' : 'unknown') : null,
    pin_pepper: !!env.PIN_PEPPER, admins: admins(env).length, models: modelList(env),
    deezer_here: new URL(req.url).searchParams.get('up') === '1' ? await deezerOpen() : undefined,
    catalogues: new URL(req.url).searchParams.get('up') === '1'
      ? Object.fromEntries(await Promise.all([
        ['apple', 'https://itunes.apple.com/search?media=music&entity=album&limit=1&term=radiohead'],
        ['deezer', 'https://api.deezer.com/search/album?limit=1&q=radiohead'],
        ['musicbrainz', 'https://musicbrainz.org/ws/2/artist?fmt=json&limit=1&query=radiohead'],
      ].map(async ([k, u]) => { try { const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); return [k, r.status]; } catch (e) { return [k, 'error']; } })))
      : '주소 끝에 ?up=1 을 붙이면 Apple·Deezer·MusicBrainz 연결을 시험합니다',
    ai_test: new URL(req.url).searchParams.get('ai') === '1' && k
      ? await (async () => { const r = await askGemini(env, 'Reply with the single word: ok'); return r.text ? { ok: true, model: r.model, reply: r.text.slice(0, 40), notes: r.notes } : { ok: false, notes: r.notes }; })()
      : '주소 끝에 ?ai=1 을 붙이면 Gemini 연결을 실제로 시험합니다',
  });
}

/* ---------------- router ---------------- */
export async function onRequest(context) {
  const { request: req, env, params } = context;
  const parts = [].concat(params.path || []).map(decodeURIComponent);
  const route = parts.join('/'), m = req.method;
  if (route === 'health' && m === 'GET') return await health(env, req);
  if (!env.DB) return fail(500, 'config', '데이터베이스(DB) 연결이 설정되지 않았습니다. Pages 설정의 Bindings에서 D1을 변수 이름 DB로 연결한 뒤 다시 배포해 주세요.');
  try {
    if (route === 'login' && m === 'POST') return await login(req, env);
    if (route === 'logout' && m === 'POST') return await logout(req, env);
    if (route === 'me' && m === 'GET') { const me = await currentUser(req, env); return json({ user: me ? meOut(env, me) : null }); }
    if (route === 'community' && m === 'GET') return await community(req, env);
    if (route === 'info' && m === 'GET') return await info(req, env);
    if (route === 'charts' && m === 'GET') return await charts();
    if (route === 'feed' && m === 'GET') return await feedPage(req, env);
    if (route === 'cover' && m === 'GET') return await coverLookup(req);
    if (route === 'exists' && m === 'GET') return await existsLookup(req);
    if (route === 'pick' && m === 'POST') return await pickTracks(req, env);
    if (route === 'artist' && m === 'GET') return await artistLookup(req);
    if (route === 'search' && m === 'GET') return await searchLookup(req);
    if (route === 'img' && m === 'GET') return await img(req);
    if (route === 'recommend' && m === 'POST') return await recommend(req, env);
    if (parts[0] === 'users' && parts.length === 2 && m === 'GET') return await profile(req, env, parts[1]);

    const me = await currentUser(req, env);
    if (!me) return fail(401, 'login_required', '로그인이 필요합니다.');
    if (route === 'library' && m === 'GET') return await getLibrary(env, me);
    if (route === 'library' && m === 'PUT') return await putLibrary(req, env, me);
    if (route === 'posts' && m === 'POST') return await addPost(req, env, me);
    if (route === 'posts' && m === 'DELETE') return await deleteMyPosts(env, me);
    if (parts[0] === 'posts' && parts.length === 2 && m === 'DELETE') return await deletePost(env, me, parts[1]);
    if (route === 'picks' && m === 'PUT') return await putPick(req, env, me);
    if (route === 'picks' && m === 'DELETE') return await deletePick(env, me);
    if (parts[0] === 'users' && parts[2] === 'messages' && m === 'POST') return await postMessage(req, env, me, parts[1]);
    if (parts[0] === 'users' && parts[2] === 'unlock' && m === 'POST') return await adminUnlock(env, me, parts[1]);
    if (parts[0] === 'users' && parts.length === 2 && m === 'DELETE') return await adminDeleteUser(env, me, parts[1]);
    if (parts[0] === 'messages' && parts.length === 2 && m === 'DELETE') return await deleteMessage(env, me, parts[1]);
    return fail(404, 'not_found', '없는 주소입니다.');
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/no such table/i.test(msg)) return fail(500, 'no_tables', '데이터베이스 표가 아직 만들어지지 않았습니다. D1 Console에서 schema.sql 내용을 실행해 주세요.');
    return fail(500, 'server_error', '서버에서 문제가 생겼습니다. 잠시 후 다시 시도해 주세요. (' + msg.slice(0, 120) + ')');
  }
}
