
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const arr = v => (Array.isArray(v) ? v : (v ? [v] : []));
  const MIN = 5, MAX = 100;
  const KIND_LBL = { album: 'Album', track: 'Song' };
  const AXES = ['장르', '프로듀서·엔지니어', '세션·참여진', '레이블', '씬·지역', '시대·영향 관계'];
  const REGIONS = ['영미권', '한국', '일본', '유럽 (비영어권)', '라틴·아프리카·기타'];
  const ERAS = [1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
  const SIM_LBL = ['', '아주 비슷한 결', '비슷한 결 중심', '비슷함과 새로움 반반', '새로운 방향 위주', '의외의 발견'];
  const POP_LBL = ['', '널리 알려진 대표작', '대표작 중심', '알려진 작품과 숨은 작품 반반', '숨은 작품 위주', '평가 수가 적은 숨은 작품'];
  const SIM_TXT = ['', '사용자 목록과 사운드·분위기·형식이 아주 가까운 작품만', '가까운 작품 중심에 약간 다른 결을 섞어서', '가까운 작품과 새로운 방향을 반반으로', '연결고리는 분명하되 장르·시대·형식이 다른 작품 위주로', '연결고리 하나를 따라 의외의 장르·시대·지역으로 넘어가는 발견 위주로'];
  const POP_TXT = ['', '대중적으로 널리 알려진 대표작 위주로', '잘 알려진 작품 중심에 덜 알려진 작품을 조금 섞어서', '잘 알려진 작품과 숨은 작품을 반반 정도로', '덜 알려진 작품 위주로, 잘 알려진 작품은 소수만', '평가 수가 적은 숨은 작품 위주로 (단, 실존이 확실한 것만)'];
  const PRESETS = { safe: [1, 2], balance: [3, 3], dig: [3, 5], leap: [5, 4] };
  const PRESET_DESC = {
    safe: '지금 취향과 아주 가까운 결의 잘 알려진 작품을 추천합니다.',
    balance: '비슷한 결과 새로운 방향, 알려진 작품과 숨은 작품을 고르게 섞습니다.',
    dig: '비슷한 결 안에서 덜 알려진 숨은 작품을 깊게 파고듭니다.',
    leap: '연결고리 하나를 따라 의외의 장르와 시대로 넘어갑니다.',
  };
  const EXAMPLES = [
    { type: 'album', artist: "D'Angelo and The Vanguard", title: 'Black Messiah', year: '2014', genre: 'Neo-Soul, Funk', country: '미국', colors: ['#111111', '#2b2b2b', '#e9e4dc'], style: 'minimal', rating: 5 },
    { type: 'album', artist: 'Radiohead', title: 'In Rainbows', year: '2007', genre: 'Art Rock', country: '영국', colors: ['#121212', '#e8502e', '#f2c14e'], style: 'mesh', rating: 5 },
    { type: 'album', artist: 'Portishead', title: 'Dummy', year: '1994', genre: 'Trip Hop', country: '영국', colors: ['#0e2a3b', '#c49a3c', '#e8e2d2'], style: 'mesh', rating: 4.5 },
    { type: 'album', artist: 'Massive Attack', title: 'Mezzanine', year: '1998', genre: 'Trip Hop', country: '영국', colors: ['#0b0b0b', '#8a8a8a', '#d9d9d9'], style: 'minimal', rating: 4.5 },
    { type: 'album', artist: 'Cocteau Twins', title: 'Heaven or Las Vegas', year: '1990', genre: 'Dream Pop', country: '영국', colors: ['#c94b6d', '#f2b5c4', '#2d1b4e'], style: 'type', rating: 4 },
    { type: 'track', artist: 'Björk', title: 'Jóga', album: 'Homogenic', year: '1997', genre: 'Art Pop', country: '아이슬란드', colors: ['#1c2a4a', '#d94f70', '#f0d6c2'], style: 'mesh', rating: 5 },
  ];

  /* ---------------- local state ---------------- */
  const emptyRes = () => ({ profile: null, recs: [] });
  const STORE = 'jukebox.v2';
  let state = { items: EXAMPLES.map(x => ({ ...x })), isExample: true, results: emptyRes(), feedback: {}, opts: { type: 'album', format: 'both', vocal: 'any', n: '5', preset: 'balance', axes: AXES.slice(0, 5), region: [] } };
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && Array.isArray(s.items)) state = { ...state, ...s, opts: { ...state.opts, ...(s.opts || {}) }, results: s.results || emptyRes(), feedback: s.feedback || {} };
  } catch (e) { /* ignore */ }
  state.items.forEach(it => delete it.pending);
  const O = state.opts;
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ } };
  let auth = null;
  try { auth = JSON.parse(localStorage.getItem('jukebox.v2.auth') || 'null'); } catch (e) { auth = null; }
  const saveAuth = () => { try { auth ? localStorage.setItem('jukebox.v2.auth', JSON.stringify(auth)) : localStorage.removeItem('jukebox.v2.auth'); } catch (e) { /* ignore */ } };

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800); }
  const today = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  function timeAgo(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    if (s < 86400 * 7) return Math.floor(s / 86400) + '일 전';
    const d = new Date(ms); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  }
  const hashN = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const avatar = (name, cls = '') => `<span class="av ${cls}" style="background:hsl(${hashN(String(name).toLowerCase()) % 360} 55% 42%)" aria-hidden="true">${esc(String(name || '?').slice(0, 1).toUpperCase())}</span>`;
  const HEX = /^#[0-9a-f]{6}$/i;
  function artHTML(o, extra = '') {
    o = o || {};
    const c = arr(o.colors).filter(x => HEX.test(String(x)));
    let c0, c1, c2;
    if (c.length >= 2) [c0, c1, c2] = [c[0], c[1], c[2] || c[0]];
    else { const h = hashN((o.artist || '') + (o.title || '')); c0 = `hsl(${h % 360} 45% 22%)`; c1 = `hsl(${(h + 40) % 360} 70% 55%)`; c2 = `hsl(${(h + 200) % 360} 65% 70%)`; }
    const style = ['minimal', 'type'].includes(o.style) ? o.style : 'mesh';
    const t = String(o.title || ''), cov = coverOf(o);
    const ref = o.artist && o.title ? ` data-ck="${esc(ck(o))}" data-a="${esc(o.artist)}" data-t="${esc(o.title)}" data-y="${o.type === 'track' ? 'track' : 'album'}"` : '';
    return `<div class="art art-${style} ${extra}"${ref} style="--c0:${c0};--c1:${c1};--c2:${c2}">${style === 'type' ? `<span class="tx">${esc(t.length > 24 ? t.slice(0, 22) + '…' : t)}</span>` : ''}</div>${cov ? coverImg(cov) : ''}`;
  }
  const coverImg = u => `<img class="art-img" src="${esc(u)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="window.__jbCoverFail&&window.__jbCoverFail(this)">`;
  const compact = it => ({ type: it.type === 'track' ? 'track' : 'album', title: String(it.title || '').slice(0, 160), artist: String(it.artist || '').slice(0, 120), album: String(it.album || '').slice(0, 160), year: String(it.year || '').slice(0, 6), genre: String(it.genre || arr(it.primary).join(', ') || '').slice(0, 80), country: String(it.country || '').slice(0, 40), colors: arr(it.colors).filter(x => HEX.test(String(x))).slice(0, 3), style: ['mesh', 'minimal', 'type'].includes(it.style) ? it.style : 'mesh', cover: /^https:\/\//.test(it.cover || '') ? it.cover : '', link: /^https:\/\//.test(it.link || '') ? it.link : '' });
  const itemKey = it => ((it.artist || '') + '|' + (it.title || '')).toLowerCase();

  /* ---------------- server API ---------------- */
  async function api(path, opts = {}) {
    const headers = { accept: 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (auth && auth.token) headers.authorization = 'Bearer ' + auth.token;
    let r;
    try { r = await fetch('/api/' + path, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: opts.signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw Object.assign(new Error('멈췄습니다.'), { code: 'cancelled' }); throw Object.assign(new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'), { code: 'network' }); }
    let d = null; try { d = await r.json(); } catch (e) { /* not json */ }
    if (!r.ok) {
      const err = Object.assign(new Error((d && d.error && d.error.message) || `서버 오류 (${r.status})`), { code: d && d.error && d.error.code, status: r.status });
      if (r.status === 401 && auth && path !== 'login') { auth = null; saveAuth(); renderAllComm(); }
      throw err;
    }
    return d;
  }
  const sErr = e => (e && e.message) || '연결이 끊겼습니다. 다시 시도해 주세요.';

  /* ---------------- Apple catalogue in the browser (JSONP, no key) ---------------- */
  let jsonpN = 0;
  function jsonp(url, ms = 7000) {
    return new Promise(resolve => {
      const cb = '__jb' + Date.now().toString(36) + (jsonpN++), s = document.createElement('script');
      const done = v => { clearTimeout(t); delete window[cb]; s.remove(); resolve(v); };
      const t = setTimeout(() => done(null), ms);
      window[cb] = d => done(d); s.onerror = () => done(null);
      s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb; document.head.append(s);
    });
  }
  const art600 = u => String(u || '').replace(/\/\d+x\d+bb\./, '/600x600bb.');
  const fromItunes = x => x.wrapperType === 'track'
    ? { type: 'track', title: x.trackName, artist: x.artistName, album: x.collectionName || '', year: String(x.releaseDate || '').slice(0, 4), genre: x.primaryGenreName || '', cover: art600(x.artworkUrl100), link: x.trackViewUrl || '' }
    : { type: 'album', title: String(x.collectionName || '').replace(/ - (Single|EP)$/, ''), artist: x.artistName, year: String(x.releaseDate || '').slice(0, 4), genre: x.primaryGenreName || '', cover: art600(x.artworkUrl100), link: x.collectionViewUrl || '' };
  async function itunesSearch(term, type, limit = 8) {
    const q = `https://itunes.apple.com/search?media=music&entity=${type === 'track' ? 'song' : 'album'}&limit=${limit}&term=${enc(term)}`;
    const res = await Promise.all(['US', 'KR'].map(c => jsonp(q + '&country=' + c)));
    const seen = new Set(), out = [];
    res.forEach(d => arr(d && d.results).forEach(x => { const it = fromItunes(x); const k = itemKey(it); if (it.title && it.artist && !seen.has(k)) { seen.add(k); out.push(it); } }));
    return out;
  }
  const regionName = (() => { try { const dn = new Intl.DisplayNames(['ko'], { type: 'region' }); return c => { try { return c ? dn.of(c) : ''; } catch (e) { return ''; } }; } catch (e) { return () => ''; } })();
  const infoCache2 = new Map();
  async function catalogInfo(it) {
    const k = itemKey(it) + '|' + it.type;
    if (!infoCache2.has(k)) infoCache2.set(k, api(`info?type=${it.type}&artist=${enc(it.artist)}&title=${enc(it.title)}`).then(x => { if (x && x.countryCode) x.country = regionName(x.countryCode); return x || {}; }).catch(() => ({})));
    return infoCache2.get(k);
  }

  /* ---------------- covers: find a missing or broken cover, remember it ---------------- */
  // loose title matching: accents, brackets, "- Single", deluxe/remaster tags and "the" don't matter
  const fold = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[’'`´]/g, '');
  const core = s => fold(s).replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s[-–—]\s.*$/, ' ').replace(/\b(feat|ft|with)\b\.?.*$/, ' ')
    .replace(/\b(deluxe|expanded|edition|remaster(ed)?|anniversary|version|bonus|tracks?|reissue|mono|stereo)\b/g, ' ').replace(/^\s*the\s+/, '')
    .replace(/[^a-z0-9぀-ヿ㐀-鿿가-힣]+/g, '');
  const looseEq = (a, b) => {
    const x = core(a), y = core(b); if (!x || !y) return false; if (x === y) return true;
    const n = Math.min(x.length, y.length);
    return (n >= 3 && (x.startsWith(y) || y.startsWith(x))) || (n >= 5 && (x.includes(y) || y.includes(x)));
  };
  const ck = o => (o.type === 'track' ? 't|' : 'a|') + itemKey(o);
  const COVERS = 'jukebox.v2.covers';
  let coverMap = {}, badCover = new Set();
  try { const s = JSON.parse(localStorage.getItem(COVERS) || 'null'); if (s) { coverMap = s.map || {}; badCover = new Set(arr(s.bad)); } } catch (e) { /* ignore */ }
  const saveCovers = () => {
    try {
      const ks = Object.keys(coverMap); if (ks.length > 800) ks.slice(0, ks.length - 800).forEach(k => delete coverMap[k]);
      localStorage.setItem(COVERS, JSON.stringify({ map: coverMap, bad: [...badCover].slice(-300) }));
    } catch (e) { /* ignore */ }
  };
  function coverOf(o) {
    const own = /^https:\/\//.test(o.cover || '') && !badCover.has(o.cover) ? o.cover : '';
    const c = o.artist && o.title ? coverMap[ck(o)] : null;
    return own || (c && c.u) || '';
  }
  const imgOk = url => new Promise(res => {
    const im = new Image(), t = setTimeout(() => res(false), 7000);
    im.referrerPolicy = 'no-referrer';
    im.onload = () => { clearTimeout(t); res(im.naturalWidth > 1); }; im.onerror = () => { clearTimeout(t); res(false); };
    im.src = url;
  });
  const dz = (path, ms = 4500) => jsonp(`https://api.deezer.com/${path}${path.includes('?') ? '&' : '?'}output=jsonp`, ms).then(d => (d && !d.error ? d : null));
  const dzCover = a => (a && (a.cover_xl || a.cover_big || a.cover_medium)) || '';
  // returns { u: cover url or '', answered: did any catalogue actually reply }
  async function findCover(o) {
    const track = o.type === 'track', a = o.artist, t = o.title, okA = x => looseEq(x, a);
    let answered = false;
    const seen = d => { if (d) answered = true; return d; };
    // 1) our server: Apple (US, KR) → Deezer → Cover Art Archive, cached at the edge for everyone
    const s = seen(await api(`cover?type=${track ? 'track' : 'album'}&artist=${enc(a)}&title=${enc(t)}`).catch(() => null));
    if (s && s.cover && await imgOk(s.cover)) return { u: s.cover, answered };
    // 2) Deezer straight from the browser
    const d1 = seen(await dz(`search/${track ? 'track' : 'album'}?limit=10&q=${enc(`artist:"${a}" ${track ? 'track' : 'album'}:"${t}"`)}`));
    const d2 = d1 && arr(d1.data).length ? d1 : seen(await dz(`search/${track ? 'track' : 'album'}?limit=10&q=${enc(a + ' ' + t)}`));
    const dh = d2 && arr(d2.data).find(x => okA(x.artist && x.artist.name) && looseEq(x.title, t));
    const du = dh ? dzCover(track ? dh.album : dh) : '';
    if (du && await imgOk(du)) return { u: du, answered };
    // 3) Apple straight from the browser (both storefronts), then by title alone
    const q = `https://itunes.apple.com/search?media=music&entity=${track ? 'song' : 'album'}&limit=12&term=${enc(a + ' ' + t)}`;
    const ap = (await Promise.all(['US', 'KR'].map(c => jsonp(q + '&country=' + c, 5000).then(seen)))).flatMap(d => arr(d && d.results));
    let hit = ap.find(x => okA(x.artistName) && looseEq(track ? x.trackName : x.collectionName, t));
    if (!hit) {
      const ap2 = seen(await jsonp(`https://itunes.apple.com/search?media=music&entity=${track ? 'song' : 'album'}&limit=25&country=US&term=${enc(t)}`, 5000));
      hit = arr(ap2 && ap2.results).find(x => looseEq(track ? x.trackName : x.collectionName, t) && (okA(x.artistName) || core(x.artistName).slice(0, 4) === core(a).slice(0, 4)));
    }
    if (hit && await imgOk(art600(hit.artworkUrl100))) return { u: art600(hit.artworkUrl100), answered };
    return { u: '', answered };
  }
  // does this recommendation exist? Deezer first, then Apple Music (US, KR) — straight from the browser
  async function existsInBrowser(r) {
    const track = r.type === 'track'; let answered = false;
    const seen = d => { if (d) answered = true; return d; };
    const d = seen(await dz(`search/${track ? 'track' : 'album'}?limit=10&q=${enc(`artist:"${r.artist}" ${track ? 'track' : 'album'}:"${r.title}"`)}`));
    const d2 = d && arr(d.data).length ? d : seen(await dz(`search/${track ? 'track' : 'album'}?limit=15&q=${enc(r.artist + ' ' + r.title)}`));
    const h = d2 && arr(d2.data).find(x => looseEq(x.artist && x.artist.name, r.artist) && looseEq(x.title, r.title));
    if (h) return { found: true, cover: dzCover(track ? h.album : h), year: String(h.release_date || '').slice(0, 4) };
    const q = `https://itunes.apple.com/search?media=music&entity=${track ? 'song' : 'album'}&limit=15&term=${enc(r.artist + ' ' + r.title)}`;
    const ap = (await Promise.all(['US', 'KR'].map(c => jsonp(q + '&country=' + c, 6000).then(seen)))).flatMap(x => arr(x && x.results));
    const a = ap.find(x => looseEq(x.artistName, r.artist) && looseEq(track ? x.trackName : x.collectionName, r.title));
    if (a) return { found: true, cover: art600(a.artworkUrl100), link: (track ? a.trackViewUrl : a.collectionViewUrl) || '', year: String(a.releaseDate || '').slice(0, 4) };
    return { found: false, answered };
  }
  const repairQ = new Map(), triedAt = new Map(); let repairing = false;
  function scanCovers() {
    $$('.art[data-ck]').forEach(a => {
      if (a.classList.contains('pending')) return;
      const n = a.nextElementSibling; if (n && n.classList.contains('art-img')) return;
      const k = a.dataset.ck, c = coverMap[k];
      if (c && (c.u || Date.now() - c.t < 20 * 60000)) { if (c.u) a.insertAdjacentHTML('afterend', coverImg(c.u)); return; }
      if (Date.now() - (triedAt.get(k) || 0) < 120000) return;
      if (!repairQ.has(k)) repairQ.set(k, { type: a.dataset.y, artist: a.dataset.a, title: a.dataset.t });
    });
    pumpCovers();
  }
  async function pumpCovers() {
    if (repairing) return; repairing = true;
    try {
      while (repairQ.size) {
        // three at a time
        const batch = [...repairQ.entries()].slice(0, 3);
        await Promise.all(batch.map(async ([k, o]) => {
          let r = { u: '', answered: false }; try { r = await findCover(o); } catch (e) { /* keep r */ }
          repairQ.delete(k); triedAt.set(k, Date.now());
          // remember a miss only briefly, and not at all when no catalogue could be reached
          if (r.u || r.answered) { coverMap[k] = { u: r.u, t: Date.now() }; saveCovers(); }
          if (r.u) applyCover(k, o, r.u);
        }));
        await new Promise(r => setTimeout(r, 250));
      }
    } finally { repairing = false; }
  }
  function applyCover(k, o, u) {
    $$('.art[data-ck]').forEach(a => {
      if (a.dataset.ck !== k) return;
      const n = a.nextElementSibling; if (n && n.classList.contains('art-img')) n.remove();
      a.insertAdjacentHTML('afterend', coverImg(u));
    });
    // keep the found cover on the saved list too, so it travels with your library and posts
    let touched = false;
    const fix = it => { if (it && ck(it) === k && (!it.cover || badCover.has(it.cover))) { it.cover = u; touched = true; } };
    state.items.forEach(fix); state.results.recs.forEach(fix);
    if (touched) { save(); if (!state.isExample) scheduleLibSync(); }
  }
  window.__jbCoverFail = img => {
    const a = img.previousElementSibling, src = img.getAttribute('src');
    img.remove();
    if (src && !/^data:/.test(src)) { badCover.add(src); }
    if (!a || !a.dataset.ck) return;
    const c = coverMap[a.dataset.ck]; if (c && c.u === src) delete coverMap[a.dataset.ck];
    saveCovers(); scheduleScan();
  };
  let scanT = 0;
  const scheduleScan = () => { clearTimeout(scanT); scanT = setTimeout(scanCovers, 500); };
  new MutationObserver(muts => { if (muts.some(m => m.addedNodes.length)) scheduleScan(); }).observe(document.body, { childList: true, subtree: true });

  /* ---------------- save the receipt as an image ---------------- */
  $$('.print-bar').forEach(b => { b.hidden = false; });
  const PARTS = ['list', 'profile', 'recs'];
  if (!Array.isArray(O.printParts)) O.printParts = PARTS.slice();
  const partReady = { list: () => state.items.length > 0, profile: () => !!state.results.profile, recs: () => state.results.recs.length > 0 };
  function paintParts() {
    $$('#print-parts [data-part]').forEach(b => {
      const k = b.dataset.part, ok = partReady[k]();
      b.setAttribute('aria-disabled', String(!ok));
      b.setAttribute('aria-pressed', String(ok && O.printParts.includes(k)));
    });
  }
  const PART_LBL = { list: '담은 음악', profile: '취향 분석', recs: '추천 음악' };
  // [영수증 출력] on the music receipt opens a small slip: pick the parts, then print
  function openPrintDlg() {
    openModal(`<section class="print-dlg" aria-labelledby="print-dlg-t">
      <p class="x2 b c" id="print-dlg-t">PRINT</p>
      <p class="c">출력할 부분을 고르세요. 여러 개를 함께 고를 수 있습니다.</p>
      <p class="hr" aria-hidden="true"></p>
      <div class="print-parts" id="print-parts" role="group" aria-label="출력할 부분">${PARTS.map(k => `<button type="button" class="chip-toggle" data-part="${k}" aria-pressed="false">${PART_LBL[k]}</button>`).join('')}</div>
      <p class="hr" aria-hidden="true"></p>
      <div class="print-go"><button class="btn" type="button" data-print-go>영수증 출력</button><button class="btn" type="button" data-print-cancel>취소</button></div>
    </section>`, { kind: 'print' });
    paintParts();
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('#print-parts [data-part]');
    if (b) {
      const k = b.dataset.part;
      if (!partReady[k]()) { toast(k === 'list' ? '담은 음악이 없습니다' : '먼저 ANALYZE & RECOMMEND로 결과를 받아 주세요'); return; }
      O.printParts = O.printParts.includes(k) ? O.printParts.filter(x => x !== k) : [...O.printParts, k];
      paintParts(); save(); return;
    }
    if (e.target.closest('[data-print-cancel]')) { closeModal(); return; }
    if (e.target.closest('[data-print-go]')) {
      if (!PARTS.some(k => O.printParts.includes(k) && partReady[k]())) { toast('출력할 부분을 하나 이상 골라 주세요'); return; }
      closeModal(); printReceipt('jpg', true);
    }
  });
  let printing = false;
  async function printReceipt(kind, chosen) {
    if (printing) return;
    const comm = document.body.dataset.view === 'community', el = comm ? $('#view-community') : $('#view-music');
    if (!comm && !chosen) { openPrintDlg(); return; }
    let parts = null;
    if (!comm) {
      parts = PARTS.filter(k => O.printParts.includes(k) && partReady[k]());
      if (!parts.length) { toast('출력할 부분을 하나 이상 골라 주세요'); return; }
    }
    printing = true; hideAc(); el.classList.add('printing'); toast('영수증을 출력하고 있습니다…');
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const blob = await receiptImage(el, kind, parts);
      const stamp = STAMP.replace(/\D/g, '').slice(0, 12);
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `jukebox-${comm ? 'community' : 'receipt'}-${stamp.slice(0, 8)}-${stamp.slice(8)}.${kind}`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast('영수증 이미지를 저장했습니다');
    } catch (e) { toast('이미지로 출력하지 못했습니다'); }
    finally { printing = false; el.classList.remove('printing'); }
  }
  // keep only the chosen parts, and drop every control that isn't a printed line
  function prunePrint(rc, parts) {
    const rm = sel => rc.querySelectorAll(sel).forEach(n => n.remove());
    rm('.headline,.desc,#music-entry,.kv.stack,#music-preset-desc,#music-settings,#music-go,#music-example,#music-status,.more-bar,.sec-tools,.fb,.mi .x,.results>.empty,#share-row,.counter .meter,.counter .hint,.counter .r');
    rc.querySelectorAll('.counter .ln').forEach((ln, i) => { if (i > 0) ln.remove(); });
    if (!parts.includes('list')) rm(':scope>.cols,#music-list,.counter');
    if (!parts.includes('profile')) rm('.results>.profile');
    if (!parts.includes('recs')) { rc.querySelectorAll('#music-recs').forEach(n => (n.closest('section') || n).remove()); rm('.results>.totals'); }
    const res = rc.querySelector('.results'); if (res && !res.children.length) res.remove();
    let prev = null;
    [...rc.children].forEach(n => { const rule = n.matches('.hr,.hr2'); if (rule && (!prev || prev.matches('.hr,.hr2'))) n.remove(); else prev = n; });
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-print]'); if (b) printReceipt(b.dataset.print); });
  const toDataURL = blob => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(blob); });
  const fetchData = async url => { const r = await fetch(url, { mode: 'cors', credentials: 'omit' }); if (!r.ok) throw new Error('fetch'); return await toDataURL(await r.blob()); };
  let exportCssP = null;
  function exportCSS() {
    // the site's stylesheets with the fonts inlined, @media rules dropped (the export is laid out at its own size)
    if (!exportCssP) exportCssP = (async () => {
      let css = (await Promise.all(['/fonts.css', '/style.css'].map(u => fetch(u).then(r => r.text())))).join('\n');
      for (const m of [...new Set(css.match(/url\(\/fonts\/[^)]+\)/g) || [])]) {
        try { css = css.split(m).join(`url(${await fetchData(m.slice(4, -1))})`); } catch (e) { /* fall back to system fonts */ }
      }
      let out = '', i = 0;
      for (;;) {
        const j = css.indexOf('@media', i); if (j < 0) { out += css.slice(i); break; }
        out += css.slice(i, j);
        let k = css.indexOf('{', j) + 1, depth = 1;
        while (depth && k < css.length) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
        i = k;
      }
      return out.split(']]>').join(']] >');
    })().catch(e => { exportCssP = null; throw e; });
    return exportCssP;
  }
  async function receiptImage(el, kind, parts) {
    const M = 44, cs = getComputedStyle(el), bs = getComputedStyle(document.body), w = el.offsetWidth;
    const clone = el.cloneNode(true);
    const oi = [...el.querySelectorAll('input,textarea,select')], ci = [...clone.querySelectorAll('input,textarea,select')];
    oi.forEach((o, i) => {
      const c = ci[i]; if (!c) return;
      if (o.type === 'checkbox' || o.type === 'radio') { if (o.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
      else if (o.tagName === 'TEXTAREA') c.textContent = o.value;
      else if (o.tagName === 'SELECT') [...c.options].forEach((op, k) => { if (k === o.selectedIndex) op.setAttribute('selected', ''); else op.removeAttribute('selected'); });
      else c.setAttribute('value', o.value);
    });
    clone.querySelectorAll('canvas').forEach(c => c.remove());
    if (parts) prunePrint(clone, parts);
    clone.querySelectorAll('.no-print,script,.ac,.outlinks').forEach(n => n.remove());
    clone.removeAttribute('hidden'); clone.classList.remove('printing');
    clone.style.margin = '0'; clone.style.width = w + 'px'; clone.style.fontSize = cs.fontSize; clone.style.padding = cs.padding; clone.style.transform = 'none';
    // lay the copy out off screen: measure it and give it its own crumpled paper
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:absolute;left:-30000px;top:0;width:${w}px;visibility:hidden;pointer-events:none`;
    el.parentNode.append(host); host.append(clone);
    let h;
    try {
      await Promise.all([...clone.querySelectorAll('img.art-img')].map(async img => {
        const src = img.getAttribute('src');
        try { img.src = await fetchData(src); } catch (e) { try { img.src = await fetchData('/api/img?u=' + enc(src)); } catch (e2) { img.remove(); return; } }
        img.removeAttribute('loading'); img.removeAttribute('onerror');
      }));
      h = clone.offsetHeight;
      const P = window.__jbPaper && window.__jbPaper.paint(clone, 23);
      if (P) [P.sh, P.cv].forEach(c => {
        if (!c.width) return;
        const img = document.createElement('img'); img.className = c.className;
        img.setAttribute('style', c.getAttribute('style') || ''); if (!img.style.height) img.style.height = c.height + 'px';
        try { img.src = c.toDataURL('image/png'); clone.append(img); } catch (e) { /* skip */ }
      });
    } finally { host.remove(); }
    const W = w + 2 * M, H = h + 2 * M;
    const body = ['font-family', 'color', 'line-height', 'text-shadow', 'word-break', 'overflow-wrap', 'font-synthesis', '-webkit-font-smoothing'].map(p => `${p}:${bs.getPropertyValue(p)}`).join(';');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;box-sizing:border-box;width:${W}px;height:${H}px;padding:${M}px;background:#fff;${body.replace(/"/g, "'")}"><style><![CDATA[${await exportCSS()}]]></style>${new XMLSerializer().serializeToString(clone)}<div style="position:absolute;inset:0;pointer-events:none;opacity:.14;background:var(--grain) 0 0/220px 220px"></div></div></foreignObject></svg>`;
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('svg')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    await new Promise(r => setTimeout(r, 150));
    const pr = Math.max(1, Math.min(2, Math.sqrt(15e6 / (W * H))));
    const cv = document.createElement('canvas'); cv.width = Math.round(W * pr); cv.height = Math.round(H * pr);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.scale(pr, pr); g.drawImage(img, 0, 0, W, H);
    return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('blob')), kind === 'jpg' ? 'image/jpeg' : 'image/png', 0.92));
  }

  /* ---------------- views ---------------- */
  function setView(v) {
    if (v !== 'music' && v !== 'community') v = 'music';
    $('#view-music').hidden = v !== 'music';
    $('#view-community').hidden = v !== 'community';
    ['music', 'community'].forEach(x => $('#tab-' + x).removeAttribute('aria-current'));
    $('#tab-' + v).setAttribute('aria-current', 'page');
    if (document.body.dataset.view && document.body.dataset.view !== v) window.scrollTo(0, 0);
    document.body.dataset.view = v;
    hideAc(); setSide(false);
    if (v === 'community') renderCommunity();
  }
  window.addEventListener('hashchange', () => setView(location.hash.slice(1)));

  /* ---------------- music settings ---------------- */
  function seg(el, get, set) {
    const paint = () => $$('button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === get())));
    paint();
    el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; set(b.dataset.v); paint(); save(); });
    return paint;
  }
  seg($('#music-type'), () => O.type, v => { O.type = v; });
  seg($('#music-format'), () => O.format, v => (O.format = v));
  seg($('#music-vocal'), () => O.vocal, v => (O.vocal = v));
  if (!['3', '5', '7'].includes(String(O.n))) O.n = '5';
  seg($('#music-n'), () => O.n, v => (O.n = v));
  function chipSet(ul, list, getArr, setArr) {
    list.forEach(a => {
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" class="chip-toggle" aria-pressed="${getArr().includes(a)}">${esc(a)}</button>`;
      li.firstChild.addEventListener('click', ev => {
        const on = !getArr().includes(a);
        setArr(on ? [...getArr(), a] : getArr().filter(x => x !== a));
        ev.currentTarget.setAttribute('aria-pressed', String(on)); save();
      });
      ul.append(li);
    });
  }
  chipSet($('#music-axes'), AXES, () => O.axes, v => (O.axes = v));
  chipSet($('#music-region'), REGIONS, () => O.region, v => (O.region = v));
  $('#music-era-from').innerHTML = '<option value="">처음부터</option>' + ERAS.map(y => `<option value="${y}">${y}년대</option>`).join('');
  $('#music-era-to').innerHTML = '<option value="">지금까지</option>' + ERAS.map(y => `<option value="${y}">${y}년대</option>`).join('');
  ['music-sim', 'music-pop', 'music-same', 'music-exclude', 'music-note', 'music-era-from', 'music-era-to', 'music-deep', 'music-share'].forEach(id => {
    const el = $('#' + id); const v = O[id];
    if (v !== undefined) { if (el.type === 'checkbox') el.checked = v; else el.value = v; }
    el.addEventListener('change', () => { O[id] = el.type === 'checkbox' ? el.checked : el.value; save(); });
  });
  const setDet = $('#music-settings');
  if (O.settingsOpen) setDet.open = true;
  setDet.addEventListener('toggle', () => { O.settingsOpen = setDet.open; save(); });
  let presetPaint = null;
  function presetDesc(s, p) { $('#music-preset-desc').textContent = O.preset ? PRESET_DESC[O.preset] : `직접 조절한 설정입니다 (유사도 ${s} · 인지도 ${p}).`; }
  const ranges = {};
  ['sim', 'pop'].forEach(k => {
    const r = $(`#music-${k}`), out = $(`#music-${k}-out`), ticks = $$(`[data-range="music-${k}"] .ticks span`);
    const L = k === 'sim' ? SIM_LBL : POP_LBL;
    const upd = () => { const v = +r.value; out.textContent = `${v} / 5 · ${L[v]}`; ticks.forEach((t, i) => t.classList.toggle('on', i + 1 === v)); };
    r.addEventListener('input', () => { upd(); syncPreset(); });
    ticks.forEach((t, i) => t.addEventListener('click', () => { r.value = String(i + 1); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }));
    ranges[k] = { r, upd }; upd();
  });
  function syncPreset() {
    const s = +ranges.sim.r.value, p = +ranges.pop.r.value;
    O.preset = Object.keys(PRESETS).find(k => PRESETS[k][0] === s && PRESETS[k][1] === p) || '';
    presetPaint && presetPaint(); presetDesc(s, p);
  }
  presetPaint = seg($('#music-preset'), () => O.preset, v => {
    O.preset = v; const [s, p] = PRESETS[v];
    ranges.sim.r.value = s; ranges.pop.r.value = p; O['music-sim'] = String(s); O['music-pop'] = String(p);
    ranges.sim.upd(); ranges.pop.upd(); presetDesc(s, p);
  });
  syncPreset();

  const STAMP = (() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; })();
  $$('.close-stamp').forEach(e => { e.textContent = STAMP; });
  $$('.cust-code').forEach((e, i) => { e.textContent = 'CUSTOMER CODE: ' + STAMP.replace(/\D/g, '').slice(2, 12).replace(/(\d{4})(?=\d)/g, '$1 ') + (i ? ' 02' : ' 01'); });
  /* ---------------- my list ---------------- */
  function addItems(items, opts = {}) {
    if (state.isExample) { state.items = []; state.isExample = false; }
    const added = [];
    for (const it of items) {
      if (state.items.length >= MAX) { toast('최대 100개까지 넣을 수 있습니다'); break; }
      if (!state.items.some(x => itemKey(x) === itemKey(it))) { state.items.push(it); added.push(it); }
      else if (!opts.quiet) toast('이미 목록에 있습니다');
    }
    renderList(); save(); scheduleLibSync();
    const need = added.filter(x => !arr(x.colors).length || !x.genre || !x.year || !x.cover);
    if (need.length) enrich(need);
    return added.length;
  }
  function starsHTML(i, v) {
    let h = '';
    for (let s = 1; s <= 5; s++) h += `<button type="button" class="star ${v >= s ? 'on' : (v >= s - 0.5 ? 'half' : '')}" data-i="${i}" data-s="${s}" aria-label="별점 ${s}점" title="같은 별을 한 번 더 누르면 반 개, 세 번째는 지우기">★</button>`;
    return `<div class="rate"><span class="stars" role="group" aria-label="별점 ${v || '없음'}">${h}</span>${v ? `<span class="rv">${v}</span>` : ''}</div>`;
  }
  function renderList() {
    const list = $('#music-list');
    const code = i => String(i + 1).padStart(2, '0');
    list.innerHTML = state.items.length ? state.items.map((it, i) => `<li class="mi">
        <span class="code" aria-hidden="true">${code(i)}</span>
        <button class="mi-cover" type="button" data-ref="my:${i}" aria-label="${esc(it.title)} 자세히 보기">${artHTML(it, it.pending ? 'pending' : '')}</button>
        <div class="mi-t">
          <div class="ln"><h4 title="${esc(it.title)}">${esc(it.title)}</h4><i class="lead"></i><span class="yr">${esc(it.year || '----')}</span></div>
          <div class="ln sub"><span class="a">${esc(it.artist)}</span></div>
          <div class="ln sub"><span class="g">${KIND_LBL[it.type] || 'Album'}${it.genre ? ' · ' + esc(it.genre) : ''}</span></div>
          <div class="ln sub rate-ln">${starsHTML(i, it.rating || 0)}</div>
        </div>
        <button class="x" type="button" data-i="${i}" aria-label="${esc(it.title)} 삭제">×</button>
      </li>`).join('') : `<li class="list-empty">아직 비어 있습니다. 위 SEARCH 칸에 두 글자만 적어 보세요.</li>`;
    const n = state.items.length;
    $('#music-count').textContent = n;
    $('#meta-music').innerHTML = `<span>CHK ${String(n).padStart(4, '0')}</span><span>${STAMP}</span>`;
    $('#music-meter').style.width = (n / MAX * 100) + '%';
    $('#music-need').textContent = n < MIN ? `${MIN - n}개가 더 필요합니다` : '분석할 수 있습니다';
    $('#music-example').hidden = !state.isExample;
    $('#music-go').disabled = n < MIN || busy;
    paintParts();
  }
  $('#music-list').addEventListener('click', e => {
    const st = e.target.closest('.star');
    if (st) {
      const it = state.items[+st.dataset.i], v = +st.dataset.s, cur = it.rating || 0;
      it.rating = cur === v ? v - 0.5 : (cur === v - 0.5 ? 0 : v);
      if (!it.rating) delete it.rating;
      state.isExample = false; renderList(); save(); scheduleLibSync(); return;
    }
    const b = e.target.closest('.x'); if (!b) return;
    state.items.splice(+b.dataset.i, 1); state.isExample = false; renderList(); save(); scheduleLibSync();
  });
  const clearList = () => { state.items = []; state.isExample = false; renderList(); save(); scheduleLibSync(); };
  $('#music-clear').addEventListener('click', clearList);
  $('#music-clear2').addEventListener('click', clearList);
  const takeRating = l => { const m = l.match(/\s*[★*]\s*([0-5](?:\.5)?)\s*$/); return m ? [l.slice(0, m.index), +m[1]] : [l, 0]; };

  // fill cover / year / genre / country for items typed without picking a search result
  async function enrich(items) {
    for (const it of items) {
      try {
        if (!it.cover) {
          const hit = (await itunesSearch(`${it.artist} ${it.title}`, it.type, 8)).find(x => looseEq(x.artist, it.artist) && looseEq(x.title, it.title)) || null;
          if (hit) { it.cover = hit.cover; it.link = hit.link; if (!it.year) it.year = hit.year; if (!it.genre) it.genre = hit.genre; if (hit.album && it.type === 'track') it.album = hit.album; }
        }
        if (!it.cover || !it.year) {
          // the browser couldn't reach Apple (or found nothing): ask through our server
          const s = await api(`cover?type=${it.type === 'track' ? 'track' : 'album'}&artist=${enc(it.artist)}&title=${enc(it.title)}`).catch(() => null);
          if (s) { if (s.cover && !it.cover) it.cover = s.cover; if (s.year && !it.year) it.year = s.year; if (s.genre && !it.genre) it.genre = s.genre; if (s.link && !it.link) it.link = s.link; }
        }
        const x = await catalogInfo(it);
        if (x.year) it.year = x.year;
        if (x.genre) it.genre = x.genre;
        if (x.country) it.country = x.country;
        if (x.album && it.type === 'track' && !it.album) it.album = x.album;
        if (x.cover && !it.cover) it.cover = x.cover;
      } catch (e) { /* keep what we have */ }
      delete it.pending; renderList();
    }
    save(); scheduleLibSync();
  }

  /* ---------------- search: type a couple of letters, tap to add (Apple Music + Deezer) ---------------- */
  const S = { srv: new Map(), q: '', seq: 0, t: 0, view: '', rows: [], idx: -1, cache: new Map(), pool: new Map(), artists: new Map(), artistName: '', showSingles: false, chart: null, quick: null };
  const qEl = $('#music-q'), acEl = $('#music-ac');
  const inList = it => state.items.some(x => itemKey(x) === itemKey(it));
  const isCJK = s => /[぀-ヿ㐀-鿿가-힣]/.test(s);
  const words = s => fold(s).split(/[^a-z0-9぀-ヿ㐀-鿿가-힣]+/).filter(Boolean);
  const COMPIL = /\b(collection|greatest hits|best of|anthology|essentials?|the very best|gold|definitive|playlist|hits)\b/i;
  const JUNK = /karaoke|tribute|made famous|in the style of|cover version|lullaby|8-?bit|piano version|instrumental version/i;
  function textScore(q, it) {
    const toks = words(q); if (!toks.length) return 0;
    const tw = words(it.title), aw = words(it.artist), tc = core(it.title), ac = core(it.artist), qc = core(q);
    let s = 0;
    for (const k of toks) {
      if (tw.some(w => w.startsWith(k))) s += 3;
      else if (aw.some(w => w.startsWith(k))) s += 2.5;
      else if (tc.includes(k)) s += 1.5;
      else if (ac.includes(k)) s += 1.2;
      else if (it.album && core(it.album).includes(k)) s += .8;
      else return -1;
    }
    if (qc && tc === qc) s += 4; else if (qc && tc.startsWith(qc)) s += 2.5;
    if (qc && ac === qc) s += 2;
    return s;
  }
  // one shape for every catalogue
  const fromApple = x => {
    const out = [];
    if (x.wrapperType === 'track' && x.kind === 'song') {
      out.push({ type: 'track', title: x.trackName, artist: x.artistName, album: String(x.collectionName || '').replace(/ - (Single|EP)$/, ''), year: String(x.releaseDate || '').slice(0, 4), genre: x.primaryGenreName || '', cover: art600(x.artworkUrl100), link: x.trackViewUrl || '' });
    }
    if (x.collectionName) {
      const single = / - Single$/.test(x.collectionName) || x.trackCount && x.trackCount <= 3, ep = / - EP$/.test(x.collectionName);
      out.push({ type: 'album', title: String(x.collectionName).replace(/ - (Single|EP)$/, ''), artist: x.collectionArtistName || x.artistName, year: String(x.releaseDate || '').slice(0, 4), genre: x.primaryGenreName || '', cover: art600(x.artworkUrl100), link: x.collectionViewUrl || '', single: !!single, ep, derived: x.wrapperType === 'track' });
    }
    return out;
  };
  const fromDzAlbum = x => ({ type: 'album', title: x.title, artist: x.artist && x.artist.name, cover: dzCover(x), year: String(x.release_date || '').slice(0, 4), single: x.record_type === 'single', ep: x.record_type === 'ep' });
  const fromDzTrack = x => [{ type: 'track', title: x.title_short || x.title, artist: x.artist && x.artist.name, album: x.album && x.album.title || '', cover: dzCover(x.album) }, x.album ? { ...fromDzAlbum({ ...x.album, artist: x.artist }), derived: true } : null].filter(Boolean);
  function remember(it) {
    if (!it.title || !it.artist) return null;
    const k = ck(it), old = S.pool.get(k);
    if (old) { ['year', 'genre', 'cover', 'link', 'album'].forEach(f => { if (!old[f] && it[f]) old[f] = it[f]; }); if (!it.derived) old.derived = false; return old; }
    S.pool.set(k, it); if (S.pool.size > 700) S.pool.delete(S.pool.keys().next().value);
    return it;
  }
  function sources(q) {
    let s = S.cache.get(q);
    if (!s) {
      s = {
        apple: jsonp(`https://itunes.apple.com/search?media=music&entity=song&limit=30&country=KR&term=${enc(q)}`, 5000),
        al: dz(`search/album?limit=12&q=${enc(q)}`),
        tr: dz(`search/track?limit=15&q=${enc(q)}`),
        ar: dz(`search/artist?limit=5&q=${enc(q)}`),
        // our server asks Apple's US store (the fullest catalogue; the KR store lacks many older Western albums) and Deezer
        srv: q.length >= 2 ? api('search?q=' + enc(q)).catch(() => null) : Promise.resolve(null),
      };
      S.cache.set(q, s); if (S.cache.size > 80) S.cache.delete(S.cache.keys().next().value);
    }
    return s;
  }
  function merge(q, got) {
    const rank = new Map(), bump = (it, r) => { const k = ck(it); rank.set(k, (rank.get(k) || 0) + r); };
    const add = (list, w) => list.forEach((it, i, a) => { const m = remember(it); if (m) bump(m, w * (1 - i / Math.max(8, a.length))); });
    if (got.apple) add(arr(got.apple.results).flatMap(fromApple), 2);
    if (got.al) add(arr(got.al.data).map(fromDzAlbum), 1.6);
    if (got.tr) add(arr(got.tr.data).flatMap(fromDzTrack), 1.2);
    if (got.srv) { add(arr(got.srv.apple).flatMap(fromApple), 1.8); add(arr(got.srv.deezer).map(fromDzAlbum), 1.4); }
    const artists = new Map();
    const artistAdd = (name, w, dzId) => { if (!name) return; const k = core(name); if (!k) return; const a = artists.get(k) || { name, w: 0, dzId: 0 }; a.w += w; if (dzId) a.dzId = dzId; artists.set(k, a); };
    if (got.ar) arr(got.ar.data).forEach((x, i) => artistAdd(x.name, 2 + Math.log10((x.nb_fan || 0) + 1) * .4 - i * .3, x.id));
    return { rank, artists };
  }
  function results(q, m) {
    const qc = core(q), scored = [];
    S.pool.forEach((it, k) => {
      const s = textScore(q, it); if (s < 0) return;
      let v = s + (m && m.rank.get(k) || 0);
      if (it.type === 'album' && (it.single || it.ep)) v -= it.single ? 1.6 : .6;
      if (it.derived) v -= .8;
      if (JUNK.test(it.title + ' ' + it.artist)) v -= 4;
      if (it.type === 'album' && COMPIL.test(it.title)) v -= 1.5;   // originals before compilations
      scored.push([v, it]);
    });
    scored.sort((a, b) => b[0] - a[0]);
    const albums = [], songs = [], seenA = new Set(), seenS = new Set();
    for (const [, it] of scored) {
      const sig = core(it.artist) + '|' + core(it.title);
      if (it.type === 'album') { if (albums.length < 6 && !seenA.has(sig)) { seenA.add(sig); albums.push(it); } }
      else if (songs.length < 5 && !seenS.has(sig)) { seenS.add(sig); songs.push(it); }
    }
    // artists: names that the query starts, weighted by how often they came back
    const cand = new Map(m ? m.artists : []);
    scored.slice(0, 40).forEach(([v, it]) => { const k = core(it.artist); const a = cand.get(k) || { name: it.artist, w: 0, dzId: 0 }; a.w += .25; cand.set(k, a); });
    const arts = [...cand.entries()].map(([k, a]) => {
      const ws = words(a.name), toks = words(q);
      let s = toks.every(t => ws.some(w => w.startsWith(t)) || k.includes(t)) ? 2 : -9;
      if (k === qc) s += 4; else if (k.startsWith(qc)) s += 2;
      return { ...a, s: s + a.w };
    }).filter(a => a.s >= 2.6).sort((x, y) => y.s - x.s).slice(0, 3);
    arts.forEach(a => S.artists.set(core(a.name), a));
    return { albums, songs, arts };
  }

  // drawing
  const kindLbl = it => it.type === 'track' ? 'Song' : it.single ? 'Single' : it.ep ? 'EP' : 'Album';
  function rowItem(it) {
    const n = S.rows.push({ kind: 'item', it }) - 1;
    return `<button type="button" class="ac-item" role="option" id="aco-${n}" data-n="${n}" aria-selected="${inList(it)}"><span class="ac-cover">${artHTML(it)}</span><span class="ac-t"><b>${esc(it.title)}</b><span>${esc(it.artist)} · ${kindLbl(it)}${it.year ? ' · ' + esc(it.year) : ''}${it.type === 'track' && it.album ? ' · ' + esc(it.album) : ''}</span></span><span class="ac-tk" aria-hidden="true"></span></button>`;
  }
  function rowArtist(a) {
    const n = S.rows.push({ kind: 'artist', a }) - 1;
    return `<button type="button" class="ac-art" role="option" id="aco-${n}" data-n="${n}"><span>${esc(a.name)}</span><span>앨범 전체 보기</span></button>`;
  }
  const head = (l, r = '') => `<div class="ac-h"><span>${l}</span>${r}</div>`;
  const closeBtn = '<button type="button" class="ac-close" data-ac-close>닫기</button>';
  const foot = '<p class="ac-rule" aria-hidden="true"></p><div class="ac-foot"><span>누르면 담기고, 다시 누르면 빠집니다</span><span>APPLE MUSIC · DEEZER</span></div>';
  function paint(html) {
    acEl.innerHTML = html; acEl.hidden = false; qEl.setAttribute('aria-expanded', 'true');
    S.idx = -1; qEl.removeAttribute('aria-activedescendant');
  }
  function hideAc() {
    if (!acEl) return;
    acEl.hidden = true; S.view = ''; S.idx = -1; qEl.setAttribute('aria-expanded', 'false'); qEl.removeAttribute('aria-activedescendant');
  }
  function drawSearch(q, m, loading) {
    S.rows = [];
    const r = results(q, m);
    let h = head(`“${esc(q)}”`, closeBtn) + '<p class="ac-rule" aria-hidden="true"></p>';
    if (r.arts.length) h += head('ARTISTS') + r.arts.map(rowArtist).join('');
    if (r.albums.length) h += head('ALBUMS') + r.albums.map(rowItem).join('');
    if (r.songs.length) h += head('SONGS') + r.songs.map(rowItem).join('');
    if (!r.arts.length && !r.albums.length && !r.songs.length) h += loading ? '<div class="ac-loading"><span class="dots">찾고 있습니다</span></div>' : '<div class="ac-empty">찾지 못했습니다. 철자를 바꾸거나 아래 [+] 직접 입력을 써 주세요.</div>';
    else if (loading) h += '<div class="ac-loading"><span class="dots">더 찾고 있습니다</span></div>';
    paint(h + foot);
  }
  async function runSearch(q) {
    const seq = ++S.seq; S.view = 'search'; S.q = q;
    drawSearch(q, null, true); // instant: what we already know
    const s = sources(q), got = {};
    let left = Object.keys(s).length;
    await Promise.all(Object.entries(s).map(([k, p]) => p.then(d => {
      got[k] = d; left--;
      if (seq === S.seq && S.view === 'search') drawSearch(q, merge(q, got), left > 0);
    })));
  }
  // one artist's albums and best-known songs
  async function artistData(a) {
    const key = core(a.name);
    if (!a.p) a.p = (async () => {
      const srvP = api(`artist?name=${enc(a.name)}${a.dzId ? '&dz=' + a.dzId : ''}`).catch(() => null);
      const [al, so, dzA] = await Promise.all([
        jsonp(`https://itunes.apple.com/search?media=music&entity=album&attribute=artistTerm&limit=80&country=KR&term=${enc(a.name)}`, 6000),
        jsonp(`https://itunes.apple.com/search?media=music&entity=song&attribute=artistTerm&limit=25&country=KR&term=${enc(a.name)}`, 6000),
        a.dzId ? Promise.all([dz(`artist/${a.dzId}/albums?limit=60`), dz(`artist/${a.dzId}/top?limit=10`)]) : Promise.resolve([null, null]),
      ]);
      const mine = it => core(it.artist) === key || looseEq(it.artist, a.name);
      let albums = arr(al && al.results).flatMap(fromApple).filter(it => it.type === 'album' && mine(it)).map(remember).filter(Boolean);
      let songs = arr(so && so.results).flatMap(fromApple).filter(it => it.type === 'track' && mine(it)).map(remember).filter(Boolean);
      const srv = await srvP;
      arr(srv && srv.albums).map(remember).filter(Boolean).forEach(it => { if (!albums.some(x => core(x.title) === core(it.title))) albums.push(it); });
      arr(srv && srv.songs).map(remember).filter(Boolean).forEach(it => { if (!songs.some(x => core(x.title) === core(it.title))) songs.push(it); });
      const [dAl, dTop] = dzA;
      arr(dAl && dAl.data).map(x => fromDzAlbum({ ...x, artist: { name: a.name } })).map(remember).filter(Boolean).forEach(it => { if (!albums.some(x => core(x.title) === core(it.title))) albums.push(it); });
      if (songs.length < 5) arr(dTop && dTop.data).flatMap(fromDzTrack).filter(it => it.type === 'track').map(remember).filter(Boolean).forEach(it => { if (!songs.some(x => core(x.title) === core(it.title))) songs.push(it); });
      const seen = new Set(); albums = albums.filter(it => { const k = core(it.title); if (seen.has(k)) return false; seen.add(k); return true; });
      const seenS = new Set(); songs = songs.filter(it => { const k = core(it.title); if (seenS.has(k)) return false; seenS.add(k); return true; }).slice(0, 8);
      return { full: albums.filter(x => !x.single && !x.ep), small: albums.filter(x => x.single || x.ep), songs };
    })();
    const p = a.p;
    p.then(d => { if (a.p === p && !d.full.length && !d.small.length && !d.songs.length) a.p = null; }, () => { if (a.p === p) a.p = null; });  // nothing came back: try again next time
    return p;
  }
  async function openArtist(a) {
    const seq = ++S.seq; S.view = 'artist'; S.artistName = a.name; S.showSingles = false;
    S.rows = [];
    paint(head(`<button type="button" class="ac-back" data-ac-back>‹ 뒤로</button>&nbsp;${esc(a.name.toUpperCase())}`, closeBtn) + '<p class="ac-rule" aria-hidden="true"></p><div class="ac-loading"><span class="dots">앨범을 모으고 있습니다</span></div>');
    const d = await artistData(a);
    if (seq !== S.seq) return;
    drawArtist(a, d);
  }
  function drawArtist(a, d) {
    S.rows = [];
    let h = head(`<button type="button" class="ac-back" data-ac-back>‹ 뒤로</button>&nbsp;${esc(a.name.toUpperCase())}`, closeBtn) + '<p class="ac-rule" aria-hidden="true"></p>';
    if (d.full.length) h += head('ALBUMS', `<span>${d.full.length}</span>`) + d.full.slice(0, 24).map(rowItem).join('');
    if (d.small.length) h += head('SINGLES · EP', `<button type="button" class="ac-more" data-ac-singles>${S.showSingles ? '접기' : d.small.length + '개 보기'}</button>`) + (S.showSingles ? d.small.slice(0, 30).map(rowItem).join('') : '');
    if (d.songs.length) h += head('TOP SONGS') + d.songs.map(rowItem).join('');
    if (!d.full.length && !d.small.length && !d.songs.length) h += head('이 아티스트의 작품을 불러오지 못했습니다.', '<button type="button" class="ac-more" data-ac-retry>다시 시도</button>');
    const keep = acEl.scrollTop; paint(h + foot); acEl.scrollTop = keep;
  }
  // empty box: shortcuts that need no typing at all
  async function chartAlbums() {
    if (!S.chart) S.chart = api('charts').then(d => arr(d && d.albums).map(remember).filter(Boolean)).catch(() => { S.chart = null; return []; });
    return S.chart;
  }
  async function openQuick() {
    const seq = ++S.seq; S.view = 'quick';
    const mine = [...new Set(state.isExample ? [] : state.items.slice().reverse().map(it => it.artist))].slice(0, 2);
    const drawQ = (more, chart) => {
      S.rows = [];
      let h = head('QUICK ADD · 타자 없이 담기', closeBtn) + '<p class="ac-rule" aria-hidden="true"></p>';
      more.forEach(({ a, list }) => { if (list.length) h += head(`${esc(a.toUpperCase())}의 다른 앨범`, `<button type="button" class="ac-more" data-ac-artist="${esc(a)}">전체</button>`) + list.map(rowItem).join(''); });
      if (chart && chart.length) h += head('지금 많이 듣는 앨범 · KR') + chart.slice(0, 8).map(rowItem).join('');
      if (!more.some(x => x.list.length) && !(chart && chart.length)) h += chart ? '<div class="ac-empty">두 글자만 입력해 보세요. 예: radio, 아이유</div>' : '<div class="ac-loading"><span class="dots">불러오는 중입니다</span></div>';
      paint(h + foot);
    };
    let more = [], chart = null;
    drawQ(more, chart);
    const tasks = [chartAlbums().then(c => { chart = c; })];
    mine.forEach(name => {
      const a = S.artists.get(core(name)) || { name, w: 0, dzId: 0 }; S.artists.set(core(name), a);
      tasks.push(artistData(a).then(d => { more.push({ a: name, list: d.full.filter(it => !inList(it)).slice(0, 3) }); }).catch(() => {}));
    });
    await Promise.all(tasks.map(t => t.then(() => { if (seq === S.seq && S.view === 'quick' && !qEl.value.trim()) drawQ(more.slice().sort((x, y) => mine.indexOf(x.a) - mine.indexOf(y.a)), chart); })));
  }
  function onQ() {
    clearTimeout(S.t);
    const q = qEl.value.trim();
    $('#music-q-x').hidden = !qEl.value;
    if (!q) { openQuick(); return; }
    if (q.length < 2 && !isCJK(q)) { hideAc(); return; }
    // what we already have answers at once; the catalogues fill in a moment later
    S.seq++; S.view = 'search'; drawSearch(q, null, true);
    S.t = setTimeout(() => runSearch(q), 220);
  }
  function toggleRow(n) {
    const r = S.rows[n]; if (!r) return;
    if (r.kind === 'artist') { openArtist(r.a); return; }
    const it = r.it;
    if (inList(it)) {
      const i = state.items.findIndex(x => itemKey(x) === itemKey(it));
      state.items.splice(i, 1); renderList(); save(); scheduleLibSync();
      toast(`뺐습니다 · ${state.items.length}개`);
    } else {
      const { single, ep, derived, p, ...clean } = it;
      if (addItems([{ ...clean }], { quiet: true })) toast(`담았습니다 · ${state.items.length}개${state.items.length < MIN ? ` (${MIN - state.items.length}개 더)` : ''}`);
    }
    $$(`#music-ac [data-n]`).forEach(b => { const x = S.rows[+b.dataset.n]; if (x && x.kind === 'item') b.setAttribute('aria-selected', String(inList(x.it))); });
  }
  function moveIdx(d) {
    const btns = $$('#music-ac [data-n]'); if (!btns.length) return;
    S.idx = (S.idx + d + btns.length) % btns.length;
    btns.forEach((b, k) => b.classList.toggle('on', k === S.idx));
    btns[S.idx].scrollIntoView({ block: 'nearest' });
    qEl.setAttribute('aria-activedescendant', btns[S.idx].id);
  }
  qEl.addEventListener('input', onQ);
  qEl.addEventListener('focus', () => { if (acEl.hidden) onQ(); });
  qEl.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (acEl.hidden) onQ(); else moveIdx(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const btns = $$('#music-ac [data-n]');
      if (S.idx >= 0 && btns[S.idx]) toggleRow(+btns[S.idx].dataset.n);
      else {
        // Enter with nothing highlighted adds the top result (never removes)
        const first = btns.find(b => b.classList.contains('ac-item'));
        if (first && first.getAttribute('aria-selected') === 'true') toast('이미 담겨 있습니다');
        else if (first) { toggleRow(+first.dataset.n); qEl.select(); }
      }
    } else if (e.key === 'Escape') { if (S.view === 'artist') { S.q ? runSearch(S.q) : openQuick(); } else hideAc(); }
  });
  $('#music-q-x').addEventListener('click', () => { qEl.value = ''; qEl.focus(); onQ(); });
  acEl.addEventListener('click', e => {
    if (e.target.closest('[data-ac-close]')) { hideAc(); return; }
    if (e.target.closest('[data-ac-back]')) { const q = qEl.value.trim(); q ? runSearch(q) : openQuick(); return; }
    if (e.target.closest('[data-ac-singles]')) { S.showSingles = !S.showSingles; const a = S.artists.get(core(S.artistName)); if (a && a.p) a.p.then(d => drawArtist(a, d)); return; }
    if (e.target.closest('[data-ac-retry]')) { openArtist(S.artists.get(core(S.artistName)) || { name: S.artistName, w: 0, dzId: 0 }); return; }
    const ma = e.target.closest('[data-ac-artist]');
    if (ma) { const name = ma.dataset.acArtist; openArtist(S.artists.get(core(name)) || { name, w: 0, dzId: 0 }); return; }
    const b = e.target.closest('[data-n]'); if (b) toggleRow(+b.dataset.n);
  });
  // a tap keeps the list open; keep the phone keyboard down while picking
  acEl.addEventListener('mousedown', e => { if (e.target.closest('button') && matchMedia('(pointer:fine)').matches) e.preventDefault(); });
  document.addEventListener('click', e => { if (!e.target.closest('#music-entry') && !e.target.closest('#toast')) hideAc(); });
  $('#music-form').addEventListener('submit', e => {
    e.preventDefault();
    const artist = $('#music-artist').value.trim(), title = $('#music-title').value.trim();
    if (!artist || !title) { (artist ? $('#music-title') : $('#music-artist')).focus(); toast('아티스트와 제목을 모두 적어 주세요'); return; }
    addItems([{ type: O.type, artist, title, pending: true }]);
    $('#music-title').value = ''; $('#music-artist').value = ''; $('#music-artist').focus();
  });

  /* ---------------- recommendations ---------------- */
  let busy = false, runCtl = null;
  const recKey = r => ((r.artist || '') + '|' + (r.title || '')).toLowerCase();
  const recLabel = r => `${r.artist} — ${r.title}`;
  let runT0 = 0;
  const elapsed = () => `· ${Math.max(0, Math.round((Date.now() - runT0) / 1000))}초`;
  function setStatus(msg, loading) {
    const st = $('#music-status'); if (!st) return;
    st.innerHTML = `<span class="msg">${esc(msg)}${loading ? ` <span class="el">${elapsed()}</span>` : ''}</span>${loading ? '<span class="loadbar" aria-hidden="true"></span><button class="btn btn-ghost btn-sm" type="button" data-stop>멈추기</button>' : ''}`;
  }
  function setBusy(b) {
    busy = b; document.body.dataset.busy = b ? '1' : '0';
    $('#music-go').disabled = b || state.items.length < MIN;
    $('#music-go .bar-lbl').textContent = b ? 'ANALYZING…' : 'ANALYZE & RECOMMEND';
  }
  // each service's own site icon (its favicon) stands for the link; a text mark shows if the icon can't load
  const SITES = [
    ['Apple Music', 'music.apple.com', 'AM', (q, r) => (/^https:\/\/(music|itunes)\.apple\.com\//.test(r.link || '') ? r.link : `https://music.apple.com/search?term=${enc(q)}`)],
    ['Spotify', 'open.spotify.com', 'SP', q => `https://open.spotify.com/search/${enc(q)}`],
    ['YouTube Music', 'music.youtube.com', 'YT', q => `https://music.youtube.com/search?q=${enc(q)}`],
    ['Rate Your Music', 'rateyourmusic.com', 'RYM', (q, r) => `https://rateyourmusic.com/search?searchterm=${enc(q)}&searchtype=${r.type === 'track' ? 'z' : 'l'}`],
  ];
  const links = r => {
    const q = `${r.artist} ${r.title}`;
    return `<nav class="outlinks" aria-label="찾아 듣기">${SITES.map(([name, host, mk, url]) => `<a href="${esc(url(q, r))}" target="_blank" rel="noopener" title="${name}에서 찾기" aria-label="${name}에서 찾기"><img class="site-ic" src="https://www.google.com/s2/favicons?domain=${host}&sz=64" alt="" width="64" height="64" loading="lazy" referrerpolicy="no-referrer" onerror="this.nextElementSibling.hidden=false;this.remove()"><i class="mk" aria-hidden="true" hidden>${mk}</i></a>`).join('')}</nav>`;
  };
  const isPicked = r => { const p = live.picks.find(x => auth && x.uname === auth.key); return !!(p && p.item && itemKey(p.item) === itemKey(r)); };
  function recCard(r, i, opt = {}) {
    const el = document.createElement('article');
    el.className = 'card' + (state.feedback[recKey(r)] === 'down' ? ' disliked' : '') + (opt.fresh ? ' fresh' : '');
    const extra = r.type !== 'track' && r.start_with ? `<p class="start">먼저 들어볼 곡 <b>${esc(r.start_with)}</b></p>` : (r.type === 'track' && r.album ? `<p class="start">수록 앨범 <b>${esc(r.album)}</b></p>` : '');
    const v = state.feedback[recKey(r)];
    const vu = r.match ? `<div class="vu" style="--v:${Math.max(50, Math.min(99, +r.match || 75))}" role="img" aria-label="match score ${esc(r.match)}"><span class="ndl"></span><b>${esc(r.match)}</b></div>` : '';
    el.innerHTML = `<button class="cover" type="button" ${opt.sample ? '' : `data-ref="rec:${i}"`} aria-label="${esc(r.title)} 자세히 보기">${artHTML(r)}${opt.sample ? '<span class="flags"><span class="sample-flag">예시</span></span>' : ''}</button>
      <div class="card-body">
        <div class="titles"><div class="ln"><h4><span class="qt" aria-hidden="true">「</span>${esc(r.title)}<span class="qt" aria-hidden="true">」</span></h4><i class="lead"></i>${r.match ? `<b class="price" aria-label="match score ${esc(r.match)}">${esc(r.match)}</b>` : ''}</div><p class="l2">${esc(r.artist)}</p><p class="l3">${esc(r.year || '')} · ${KIND_LBL[r.type] || 'Album'}${r.country ? ' · ' + esc(r.country) : ''}</p></div>
        ${r.genre ? `<p class="genre">${esc(r.genre)}</p>` : ''}
        ${r._chk ? '<p class="chk">* 음원 사이트에서 실제로 있는지 확인하고 있습니다</p>' : ''}
        <p class="why">${esc(r.why)}</p>
        ${r.axis && (r.axis.axis || r.axis.detail) ? `<p class="axis"><b>${esc(r.axis.axis)}</b>${esc(r.axis.detail)}</p>` : ''}${extra}
        <div class="card-foot">${links(r)}${opt.sample ? '' : `<div class="fb" data-key="${esc(recKey(r))}" data-i="${i}"><button type="button" class="up" aria-pressed="${v === 'up'}">취향 맞음</button><button type="button" class="down" aria-pressed="${v === 'down'}">아님</button><button type="button" class="pk" aria-pressed="${isPicked(r)}">오늘의 추천</button></div>`}</div>
      </div>`;
    return el;
  }
  function profileBlock(p) {
    const el = document.createElement('section'); el.className = 'profile';
    const g = arr(p.genres).slice(0, 5);
    el.innerHTML = `<h3 class="sec">TASTE PROFILE</h3><p class="summary">${esc(p.summary)}</p>
      <div class="prof-grid">${g.length ? `<ul class="gbars">${g.map(x => `<li><span>${esc(x.name)}</span><span class="bar"><i style="width:${Math.max(4, Math.min(100, +x.weight || 0))}%"></i></span><b class="gv">${Math.round(Math.max(0, Math.min(100, +x.weight || 0)))}</b></li>`).join('')}</ul>` : '<span></span>'}${arr(p.keywords).length ? `<ul class="chips big">${arr(p.keywords).map(d => `<li class="tag">${esc(d)}</li>`).join('')}</ul>` : ''}</div>`;
    return el;
  }
  function renderResults() {
    const R = state.results, root = $('#music-results');
    paintParts();
    root.innerHTML = '<div class="status" id="music-status"></div>';
    if (!R.profile && !R.recs.length) {
      const el = document.createElement('div'); el.className = 'empty';
      const info = document.createElement('div'); info.style.cssText = 'display:grid;gap:10px';
      info.innerHTML = `<h3>분석 결과는 여기에 나타납니다</h3><p class="empty-p">취향 요약과 추천 음악이 영수증 항목처럼 한 줄씩 찍힙니다.</p>`;
      el.append(info, recCard({ type: 'album', title: 'Voodoo', artist: "D'Angelo", year: '2000', genre: 'Neo-Soul', country: '미국', axis: { axis: '세션·참여진', detail: 'Questlove · Pino Palladino' }, why: 'Black Messiah 이전, 느슨하게 밀고 당기는 그루브를 완성한 앨범입니다. 드럼과 베이스가 만드는 끈적한 리듬이 그대로 이어집니다.', start_with: 'Untitled (How Does It Feel)', match: 94, colors: ['#1a1410', '#8a5a3c', '#e2c8a8'], style: 'mesh' }, 0, { sample: true }));
      root.append(el); return;
    }
    if (R.profile) root.append(profileBlock(R.profile));
    const sec = document.createElement('section'); sec.style.cssText = 'display:grid;gap:16px';
    sec.innerHTML = `<div class="sec-head"><h3>RECOMMENDED</h3></div><div class="cols"><span>NO ITEM</span><span>MATCH SCORE / 100</span></div><div class="cards" id="music-recs"></div>`;
    root.append(sec);
    R.recs.forEach((r, i) => $('#music-recs').append(recCard(r, i)));
    const ms = R.recs.map(r => +r.match || 0).filter(Boolean);
    if (R.recs.length) {
      const tot = document.createElement('div'); tot.className = 'totals';
      tot.innerHTML = `<p class="hr" aria-hidden="true"></p><div class="ln"><span>SUBTOTAL</span><i class="lead"></i><span>${R.recs.length} ITEMS</span></div><div class="ln"><span>AVG MATCH</span><i class="lead"></i><span>${ms.length ? (ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1) : '-'}</span></div><div class="ln"><span>TOP MATCH</span><i class="lead"></i><span>${ms.length ? Math.max(...ms) : '-'}</span></div><div class="ln big"><span>TOTAL</span><span>${String(R.recs.length).padStart(2, '0')}</span></div><p class="hr" aria-hidden="true"></p>`;
      root.append(tot);
    }
    const more = document.createElement('div'); more.className = 'more-bar';
    more.innerHTML = `<button class="btn" type="button" data-more ${busy ? 'disabled' : ''}>피드백 반영해 더 추천받기</button><button class="btn btn-ghost" type="button" data-reset>결과 지우기</button>`;
    root.append(more);
  }
  function payload(more) {
    const R = state.results.recs, fb = state.feedback;
    return {
      items: state.items.map(it => ({ type: it.type, artist: it.artist, title: it.title, year: it.year || '', rating: it.rating || 0 })),
      opts: { n: O.n, format: O.format, vocal: O.vocal, sim: $('#music-sim').value, pop: $('#music-pop').value, eraFrom: $('#music-era-from').value, eraTo: $('#music-era-to').value, region: O.region, axes: O.axes, same: $('#music-same').checked, deep: $('#music-deep').checked, exclude: $('#music-exclude').value.trim(), note: $('#music-note').value.trim() },
      more: more ? { prev: R.map(recLabel), up: R.filter(r => fb[recKey(r)] === 'up').map(recLabel), down: R.filter(r => fb[recKey(r)] === 'down').map(recLabel) } : undefined,
    };
  }
  async function run(more) {
    if (busy || state.items.length < MIN) return;
    if (!more) { state.results = emptyRes(); state.feedback = {}; }
    setBusy(true);
    const before = state.results.recs.length;
    if (more) renderResults(); else { $('#music-results').innerHTML = '<div class="status" id="music-status"></div>'; }
    $('#music-results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    runT0 = Date.now();
    setStatus('목록을 분석하고 있습니다. 첫 추천은 보통 10초 안팎에 찍힙니다.', true);
    const ctl = runCtl = new AbortController();
    const tick = setInterval(() => { const e = $('#music-status .el'); if (e) e.textContent = elapsed(); }, 1000);
    let late = false; const guard = setTimeout(() => { late = true; ctl.abort(); }, 95000);
    const byI = new Map(), spare = [], gone = [], want = Math.max(1, +O.n || 5); let got = 0, dropped = 0, failed = null, done = null, round = 0;
    const ensureSec = () => {
      if ($('#music-recs')) return;
      const sec = document.createElement('section');
      sec.innerHTML = `<div class="sec-head"><h3>RECOMMENDED</h3></div><div class="cols"><span>NO ITEM</span><span>MATCH SCORE / 100</span></div><div class="cards" id="music-recs"></div>`;
      $('#music-results').append(sec);
    };
    const showRec = r => { r._chk = !r.verified; const at = state.results.recs.push(r) - 1; got++; ensureSec(); $('#music-recs').append(recCard(r, at, { fresh: true })); };
    const redraw = r => { const at = state.results.recs.indexOf(r), old = at >= 0 && $('#music-recs') && $('#music-recs').children[at]; if (old) old.replaceWith(recCard(r, at)); };
    // a recommendation no music service knows is almost always made up: take it out, bring in a spare
    const dropRec = r => {
      dropped++; gone.push(`${r.artist} — ${r.title}`);
      const sp = spare.findIndex(x => x.r === r); if (sp >= 0) { spare.splice(sp, 1); return; }
      const at = state.results.recs.indexOf(r); if (at < 0) return;
      state.results.recs.splice(at, 1); got--;
      const box = $('#music-recs'); if (box) { box.innerHTML = ''; state.results.recs.forEach((x, n) => box.append(recCard(x, n))); }
      const next = spare.shift(); if (next) showRec(next.r);
      save();
    };
    const onEvent = ev => {
      const key = round + ':' + ev.i;
      if (ev.t === 'profile' && !more && !round) {
        state.results.profile = ev.profile;
        $('#music-results .profile')?.remove();
        $('#music-status').after(profileBlock(ev.profile));
      } else if (ev.t === 'rec') {
        const r = ev.rec, k = recKey(r);
        if (state.results.recs.some(x => recKey(x) === k) || spare.some(x => recKey(x.r) === k) || gone.includes(`${r.artist} — ${r.title}`)) return;
        byI.set(key, r);
        if (got >= want) { spare.push({ i: key, r }); return; }   // spares wait unseen in case one gets dropped
        showRec(r);
        setStatus(`${got}개가 도착했습니다 · 음원 사이트에서 실제로 있는지 확인하고 있습니다`, true); save();
      } else if (ev.t === 'fix') {
        const r = byI.get(key); if (!r) return;
        Object.assign(r, ev.patch); if (r.verified) r._chk = false;
        redraw(r); save();
      } else if (ev.t === 'drop') {
        const r = byI.get(key); if (r) dropRec(r);
      } else if (ev.t === 'done') done = ev;
      else if (ev.t === 'error') failed = ev;
    };
    const pump = async body => {
      const headers = { 'content-type': 'application/json', accept: 'application/x-ndjson' };
      if (auth && auth.token) headers.authorization = 'Bearer ' + auth.token;
      const r = await fetch('/api/recommend', { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) { let d = null; try { d = await r.json(); } catch (e) { /* not json */ } return (d && d.error) || { message: `서버 오류 (${r.status})` }; }
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read(); if (end) break;
        buf += dec.decode(value, { stream: true });
        let k; while ((k = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1); if (line) { try { onEvent(JSON.parse(line)); } catch (e) { /* skip */ } } }
      }
      if (buf.trim()) { try { onEvent(JSON.parse(buf)); } catch (e) { /* skip */ } }
      return null;
    };
    // what the server couldn't confirm, the browser checks itself on Deezer and Apple Music
    const browserCheck = async () => {
      const todo = state.results.recs.slice(before).filter(r => !r.verified);
      for (let k = 0; k < todo.length; k += 2) {
        await Promise.all(todo.slice(k, k + 2).map(async r => {
          const x = await existsInBrowser(r).catch(() => ({ found: false, answered: false }));
          if (x.found) { r.verified = true; r._chk = false; ['cover', 'link', 'year'].forEach(f => { if (x[f] && !r[f]) r[f] = x[f]; }); redraw(r); }
          else if (x.answered) dropRec(r);
          else { r._chk = false; redraw(r); }
        }));
      }
    };
    try {
      failed = await pump(payload(more));
      if (!failed) {
        await browserCheck();
        // still short: ask again for real works, telling the engine which titles were made up
        while (!failed && got < want && round < 2 && Date.now() - runT0 < 80000 && got + dropped > 0) {
          round++; spare.length = 0;
          setStatus(`음원 사이트에 없는 작품 ${dropped}개를 빼고, 실제로 있는 작품으로 다시 채우고 있습니다`, true);
          const body = payload(true);
          body.more.fill = want - got; body.more.gone = gone.slice(-40);
          failed = await pump(body);
          if (!failed) await browserCheck();
        }
        failed = null;
      }
    } catch (e) { failed = late ? { message: '추천 엔진의 응답이 너무 늦어 멈췄습니다. 잠시 뒤 다시 시도해 주세요.' } : e && e.name === 'AbortError' ? { code: 'cancelled' } : { message: '서버와 연결이 끊겼습니다. 다시 시도해 주세요.' }; }
    state.results.recs.forEach(r => { delete r._chk; });
    clearInterval(tick); clearTimeout(guard);
    setBusy(false); save(); renderResults();
    if (failed && failed.code === 'cancelled') setStatus(got ? `멈췄습니다. ${got}개까지 받았습니다.` : '멈췄습니다.', false);
    else if (failed && !got) setStatus(failed.message || '추천을 받지 못했습니다. 다시 시도해 주세요.', false);
    else if (!got) setStatus('새로운 추천을 받지 못했습니다. 설정을 바꿔 다시 시도해 주세요.', false);
    else {
      setStatus((dropped ? `음원 사이트에 없는(지어낸) 작품 ${dropped}개는 빼고 실제 작품으로 채웠습니다. ` : '') + (done && done.fixed > 0 ? `수록곡 확인에서 ${done.fixed}건을 바로잡았습니다. ` : '') + `${got}개를 추천했습니다. “취향 맞음”을 누르면 다음 추천에 반영되고${auth ? ' Community에도 공유됩니다.' : ', 로그인하면 Community에 공유됩니다.'}`, false);
      if (auth && $('#music-share').checked) postAnalysis(state.results.recs.slice(before), more ? null : state.results.profile);
      else if (!auth && $('#music-share').checked) {
        pendingShare = { recs: state.results.recs.slice(before), profile: more ? null : state.results.profile };
        const st = $('#music-status');
        st.innerHTML = `<span class="msg">${esc(st.textContent.replace(/\s*“취향 맞음”.*$/, ''))} 아직 Join하지 않아 Community에는 올라가지 않았습니다.</span><button class="btn" type="button" data-join-share>JOIN하고 공유하기</button>`;
      }
    }
  }
  $('#music-go').addEventListener('click', () => run(false));
  function buildCopy(full) {
    const L = ['JUKEBOX · 음악 추천', ''];
    state.results.recs.filter(r => state.feedback[recKey(r)] !== 'down').forEach((r, i) => { L.push(`${i + 1}. ${r.title} / ${r.artist} / ${r.year || ''}`); if (full && r.why) L.push('   ' + r.why); });
    return L.join('\n');
  }
  function copyText(text) {
    const fallback = () => {
      let box = $('#copybox');
      if (!box) { box = document.createElement('div'); box.className = 'copybox panel'; box.id = 'copybox'; $('#music-results').append(box); }
      box.innerHTML = `<p class="hint">자동 복사가 막혀 있습니다. 아래 텍스트를 선택해 복사해 주세요.</p><textarea readonly></textarea>`;
      const ta = $('textarea', box); ta.value = text; ta.focus(); ta.select();
    };
    try { navigator.clipboard.writeText(text).then(() => toast('복사했습니다'), fallback); } catch (e) { fallback(); }
  }
  $('#music-results').addEventListener('click', async e => {
    if (e.target.closest('[data-stop]')) { runCtl && runCtl.abort(); return; }
    if (e.target.closest('[data-join-share]')) { setSide(true); const n = $('#join-name'); if (n) { n.scrollIntoView({ block: 'center' }); n.focus(); } toast('왼쪽 Community 칸에서 Join하면 이번 결과가 바로 공유됩니다'); return; }
    if (e.target.closest('[data-more]')) { run(true); return; }
    const cp = e.target.closest('[data-copy]'); if (cp) { copyText(buildCopy(cp.dataset.copy === 'full')); return; }
    if (e.target.closest('[data-reset]')) { state.results = emptyRes(); state.feedback = {}; save(); renderResults(); return; }
    const b = e.target.closest('.fb button'); if (!b) return;
    const box = b.parentElement, key = box.dataset.key, r = state.results.recs[+box.dataset.i];
    if (b.classList.contains('pk')) { if (r) await setPick(r); return; }
    const dir = b.classList.contains('up') ? 'up' : 'down', fb = state.feedback;
    if (fb[key] === dir) delete fb[key]; else fb[key] = dir;
    $$('button.up, button.down', box).forEach(x => x.setAttribute('aria-pressed', String(fb[key] === (x.classList.contains('up') ? 'up' : 'down'))));
    b.closest('.card').classList.toggle('disliked', fb[key] === 'down');
    save();
  });

  /* ---------------- community data (server) ---------------- */
  const live = { feed: [], accounts: new Map(), picks: [], admins: [], ready: false, error: '' };
  // older posts fetched with [더보기]; merged with the newest page that refresh() brings
  const older = new Map(); let feedMoreSrv = false, myMoreSrv = true, feedShown = 10, myShown = 10;
  const postNo = f => +String(f.id).slice(1) || 0;
  function allFeed() {
    const m = new Map(live.feed.map(f => [f.id, f]));
    older.forEach((f, id) => { if (!m.has(id)) m.set(id, f); });
    return [...m.values()].filter(f => f.kind !== 'add').sort((x, y) => (y.createdAt - x.createdAt) || (postNo(y) - postNo(x)));
  }
  async function loadOlder(user) {
    const src = allFeed().filter(f => !user || f.uname === user), last = src[src.length - 1];
    const d = await api(`feed?${last ? `before=${last.createdAt}&bid=${enc(last.id)}` : ''}${user ? '&user=' + enc(user) : ''}`);
    arr(d.feed).forEach(f => older.set(f.id, f));
    if (user) myMoreSrv = !!d.more; else feedMoreSrv = !!d.more;
  }
  const moreBtn = (attr, label = '더보기') => `<div class="list-more"><button class="btn" type="button" ${attr}>${label}</button></div>`;
  const nameOf = key => (live.accounts.get(key) || {}).username || '탈퇴한 유저';
  const isAdmin = () => !!(auth && (auth.admin || live.admins.includes(auth.key)));
  const canAct = () => !!auth;
  function dbFail(e) { toast(sErr(e)); }
  let renderQ = false;
  function renderAllComm() {
    if (renderQ) return; renderQ = true;
    requestAnimationFrame(() => {
      renderQ = false; renderAcct(); renderRail(); if (!$('#view-community').hidden) renderCommunity(); if (modalCtx && modalCtx.kind === 'profile') renderProfileModal();
      if ($('#music-recs')) $$('#music-recs .fb').forEach(box => { const r = state.results.recs[+box.dataset.i]; const p = $('button.pk', box); if (r && p) p.setAttribute('aria-pressed', String(isPicked(r))); });
    });
  }
  let refreshT = 0;
  async function refresh() {
    clearTimeout(refreshT);
    try {
      const d = await api('community');
      live.feed = arr(d.feed); live.picks = arr(d.picks); live.admins = arr(d.admins);
      if (!older.size) feedMoreSrv = !!d.feedMore;
      if (!d.feedMore && !older.size) myMoreSrv = false;
      live.accounts = new Map(arr(d.users).map(u => [u.key, u]));
      if (auth && !d.me) { auth = null; saveAuth(); toast('로그인이 만료되었습니다. 다시 Join해 주세요'); }
      else if (auth && d.me) { auth.admin = d.me.admin; auth.username = d.me.nickname; saveAuth(); }
      live.ready = true; live.error = '';
    } catch (e) { live.error = e.code || 'error'; }
    renderAllComm();
    refreshT = setTimeout(() => { if (document.visibilityState === 'visible') refresh(); else refreshT = setTimeout(refresh, 30000); }, 30000);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

  // account
  let pendingShare = null, toldFound = false;
  async function join(username, pin) {
    const d = await api('login', { method: 'POST', body: { nickname: username, pin } });
    auth = { token: d.token, key: d.user.key, username: d.user.nickname, admin: d.user.admin }; saveAuth();
    toast(d.created ? `${auth.username}님, 환영합니다. 새 계정을 만들었습니다` : `${auth.username}님, 다시 오신 것을 환영합니다`);
    await pullLib();
    if (pendingShare && pendingShare.recs.length) { const ps = pendingShare; pendingShare = null; await postAnalysis(ps.recs, ps.profile); toast('방금 받은 추천 결과를 Community에 공유했습니다'); }
    await refresh(); renderResults();
  }
  function renderAcct() {
    const box = $('#acct');
    if (auth) {
      box.innerHTML = `<div class="me"><div class="who"><b>${esc(auth.username)} ${isAdmin() ? '<span class="badge">ADMIN</span>' : ''}</b><span>Community에 공유 중</span></div>
        <div class="btns"><button class="btn btn-sm" type="button" data-myprof>내 프로필</button><button class="btn btn-ghost btn-sm" type="button" data-logout>로그아웃</button></div></div>`;
      return;
    }
    if ($('#join-form')) return; // keep what the viewer is typing
    box.innerHTML = `<h3>Community</h3>
      <form id="join-form" autocomplete="off">
        <div class="kv"><label class="k" for="join-name">NAME</label><input type="text" id="join-name" placeholder="Username" maxlength="12" aria-label="Username"></div>
        <div class="kv"><label class="k" for="join-pin">CODE</label><div class="pin-row"><input class="pin" type="password" id="join-pin" placeholder="0000" inputmode="numeric" maxlength="4" aria-label="숫자 4자리 코드"><button class="btn" type="submit">JOIN</button></div></div>
        <p class="err" id="join-err" hidden></p>
        <p class="hint">* 처음 쓰는 이름이면 자동으로 가입됩니다.<br>* 4자리 코드는 잊으면 찾을 수 없습니다.</p>
      </form>`;
    $('#join-form').addEventListener('submit', async e => {
      e.preventDefault();
      const username = $('#join-name').value.trim(), pin = $('#join-pin').value.trim(), err = $('#join-err');
      err.hidden = true;
      if (!/^[0-9A-Za-z가-힣_]{2,12}$/.test(username)) { err.textContent = 'Username은 한글·영문·숫자·밑줄로 2~12자여야 합니다.'; err.hidden = false; return; }
      if (!/^\d{4}$/.test(pin)) { err.textContent = '코드는 숫자 4자리여야 합니다.'; err.hidden = false; return; }
      const btn = $('#join-form button[type=submit]'); btn.disabled = true;
      try { await join(username, pin); }
      catch (er) { if ($('#join-err')) { $('#join-err').textContent = sErr(er); $('#join-err').hidden = false; } }
      finally { if ($('#join-form button[type=submit]')) $('#join-form button[type=submit]').disabled = false; }
    });
  }
  $('#acct').addEventListener('click', async e => {
    if (e.target.closest('[data-logout]')) { api('logout', { method: 'POST' }).catch(() => {}); auth = null; saveAuth(); toast('로그아웃했습니다'); renderAllComm(); renderResults(); return; }
    if (e.target.closest('[data-myprof]') && auth) { openProfile(auth.key); return; }
  });

  // library sync (my list ↔ server)
  let libT = 0;
  function scheduleLibSync() {
    if (!canAct()) return;
    clearTimeout(libT);
    libT = setTimeout(async () => {
      if (state.isExample || !auth) return;
      try { await api('library', { method: 'PUT', body: { items: state.items.slice(0, MAX).map(it => ({ ...compact(it), rating: it.rating || 0 })) } }); }
      catch (e) { /* next change retries */ }
    }, 1500);
  }
  async function pullLib() {
    if (!auth) return;
    try {
      const server = arr((await api('library')).items);
      if (!server.length) { if (!state.isExample && state.items.length) scheduleLibSync(); return; }
      const keys = new Set(server.map(itemKey));
      const extra = state.isExample ? [] : state.items.filter(x => !keys.has(itemKey(x)));
      state.items = server.map(x => ({ ...x, rating: x.rating || undefined })).concat(extra).slice(0, MAX);
      state.isExample = false; save(); renderList();
      if (extra.length) scheduleLibSync();
    } catch (e) { /* offline */ }
  }

  // posts: after ANALYZE & RECOMMEND only — "취향 및 추천" and "담은 음악" (that day's list); adding to your list posts nothing
  async function postAnalysis(recs, profile) {
    if (!canAct() || !recs.length) return;
    try {
      // 담은 음악: the list exactly as it was when ANALYZE & RECOMMEND ran (one set per day)
      const mine = state.isExample ? [] : state.items;
      if (mine.length >= MIN) await api('posts', { method: 'POST', body: { kind: 'list', items: mine.slice(0, 100).map(compact) } }).catch(() => {});
      await api('posts', { method: 'POST', body: { kind: 'analysis', profile: profile ? { summary: profile.summary, genres: arr(profile.genres).slice(0, 5), keywords: arr(profile.keywords).slice(0, 5) } : null, items: recs.slice(0, 16).map(r => ({ ...compact(r), match: r.match || 0, why: String(r.why || '').slice(0, 200) })) } });
      refresh();
    } catch (e) { dbFail(e); }
  }
  async function setPick(item) {
    if (!auth) { toast('오늘의 추천을 올리려면 먼저 Community에 Join해 주세요'); setSide(true); return; }
    const mine = live.picks.find(p => p.uname === auth.key);
    try {
      if (mine && mine.item && itemKey(mine.item) === itemKey(item)) { await api('picks', { method: 'DELETE' }); toast('오늘의 추천을 내렸습니다'); }
      else { await api('picks', { method: 'PUT', body: { item: compact(item) } }); toast(`“${item.title}”을(를) 오늘의 추천으로 올렸습니다`); }
      await refresh();
    } catch (e) { dbFail(e); }
  }
  async function deletePost(id) { try { await api('posts/' + enc(id), { method: 'DELETE' }); older.delete(id); toast('삭제했습니다'); refresh(); } catch (e) { dbFail(e); } }
  async function adminDeleteUser(key) {
    const name = nameOf(key);
    try { await api('users/' + enc(key), { method: 'DELETE' }); toast(`${name} 계정과 활동을 삭제했습니다`); refresh(); } catch (e) { dbFail(e); }
  }

  /* ---------------- rail ---------------- */
  let railTab = 'feed';
  $$('.rail-tabs button').forEach(b => b.addEventListener('click', () => { railTab = b.dataset.rail; $$('.rail-tabs button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderRail(); }));
  const visitCount = key => (live.accounts.get(key) || {}).visits || 0;
  const postCount = key => (live.accounts.get(key) || {}).posts || 0;
  function usersSorted() {
    return [...live.accounts.values()].sort((a, b) => (b.last || 0) - (a.last || 0));
  }
  const userRow = u => `<li><button class="pl" type="button" data-user="${esc(u.key)}">${avatar(u.username)}<span class="who"><b>${esc(u.username)}${live.admins.includes(u.key) ? ' <span class="badge">ADMIN</span>' : ''}</b><span>소식 ${postCount(u.key)} · ${timeAgo(u.last)}</span></span><span class="visits">방문 ${visitCount(u.key)}</span></button></li>`;
  function feedLine(f) {
    const it = arr(f.items)[0] || {};
    const head = f.kind === 'analysis' ? `${esc(nameOf(f.uname))}님의 취향 및 추천` : `${esc(nameOf(f.uname))}님이 담은 음악 · ${arr(f.items).length}개`;
    return `<li><button class="rf" type="button" data-ref="feed:${esc(f.id)}:0"><span class="rf-cover">${artHTML(it)}</span><span class="rf-t"><b>${head}</b><span>${esc(it.title || '')}${it.artist ? ' — ' + esc(it.artist) : ''} · ${timeAgo(f.createdAt)}</span></span></button></li>`;
  }
  function renderRail() {
    const picks = live.picks;
    $('#mini-picks-n').textContent = picks.length ? picks.length + '장' : '';
    $('#mini-picks').innerHTML = (picks.length ? `<div class="mini-picks">${picks.slice(0, 8).map(p => `<button type="button" data-ref="pick:${esc(p.id)}" title="${esc(p.item && p.item.title)} · ${esc(nameOf(p.uname))}">${artHTML(p.item)}</button>`).join('')}</div>` : '<p class="rail-empty">아직 오늘 고른 앨범이 없습니다.</p>');
    const body = $('#rail-body');
    if (!live.ready) { body.innerHTML = `<p class="rail-empty">${live.error ? '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '불러오고 있습니다…'}</p>`; return; }
    if (railTab === 'feed') body.innerHTML = live.feed.length ? `<ul class="rfeed">${live.feed.slice(0, 10).map(feedLine).join('')}</ul>` : `<p class="rail-empty">${live.ready ? '아직 소식이 없습니다. Join하고 ANALYZE & RECOMMEND를 누르면 첫 소식이 됩니다.' : '불러오고 있습니다…'}</p>`;
    else { const us = usersSorted(); body.innerHTML = us.length ? `<ul class="people-list">${us.slice(0, 30).map(userRow).join('')}</ul>` : '<p class="rail-empty">아직 가입한 유저가 없습니다.</p>'; }
  }

  /* ---------------- community page ---------------- */
  let feedFilter = 'all';
  seg($('#feed-filter'), () => feedFilter, v => { feedFilter = v; feedShown = 10; renderCommunity(); });
  const tile = (it, ref, extra = '') => `<button class="tile" type="button" data-ref="${esc(ref)}"><span class="tc">${artHTML(it)}${extra}</span><b title="${esc(it.title)}">${esc(it.title)}</b><span>${esc(it.artist)}${it.year ? ' · ' + esc(it.year) : ''}</span></button>`;
  function postHTML(f) {
    const mine = auth && f.uname === auth.key, canDel = mine || isAdmin();
    const items = arr(f.items);
    let what = '', body = '';
    if (f.kind === 'analysis') {
      what = `${esc(nameOf(f.uname))}님의 취향 및 추천`;
      const p = f.profile;
      body = `${p && p.summary ? `<p class="summary">${esc(p.summary)}</p>` : ''}${p && arr(p.keywords).length ? `<ul class="chips">${arr(p.keywords).map(k => `<li class="tag">${esc(k)}</li>`).join('')}</ul>` : ''}
        <p class="hint">추천받은 음악 ${items.length}개</p><div class="tiles">${items.map((it, i) => tile(it, `feed:${f.id}:${i}`, it.match ? `<span class="pill match ms">${esc(it.match)}</span>` : '')).join('')}</div>`;
    } else if (f.kind === 'list') {
      what = `${esc(nameOf(f.uname))}님이 담은 음악`;
      const open = openLists.has(f.id);
      body = `<div class="set-ln"><button class="date-box" type="button" data-listdate="${esc(f.id)}" aria-expanded="${open}">${ymd(f.createdAt)}</button><span>${items.length}개 · ANALYZE &amp; RECOMMEND 때의 목록</span></div>
        ${open ? `<div class="tiles">${items.map((it, i) => tile(it, `feed:${f.id}:${i}`)).join('')}</div>`
          : `<button class="set-strip" type="button" data-listdate="${esc(f.id)}" aria-label="${ymd(f.createdAt)}에 담은 음악 ${items.length}개 보기">${items.slice(0, 8).map(it => `<span class="ss">${artHTML(it)}</span>`).join('')}${items.length > 8 ? `<span class="ss-more">+${items.length - 8}</span>` : ''}</button>`}`;
    } else return '';
    return `<li class="post"><div class="post-top">${avatar(nameOf(f.uname), 'sm')}<button class="nick" type="button" data-user="${esc(f.uname)}">${esc(nameOf(f.uname))}</button><time>${timeAgo(f.createdAt)}</time></div><p class="act">* ${what}</p>${body}
      ${canDel ? `<div class="post-foot"><button class="btn btn-sm btn-danger" type="button" data-delpost="${esc(f.id)}">${mine ? '내 소식 삭제' : '관리자 삭제'}</button></div>` : ''}</li>`;
  }
  const openLists = new Set();
  const ymd = t => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
  function renderCommunity() {
    const note = $('#comm-notice');
    if (!live.ready) { note.hidden = false; note.textContent = live.error ? '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '불러오고 있습니다…'; }
    else if (!auth) { note.hidden = false; note.textContent = '왼쪽에서 Username과 숫자 4자리 코드로 Join하면 ANALYZE & RECOMMEND 결과가 “취향 및 추천”으로 이곳에 올라가고, 오늘의 추천도 고를 수 있습니다.'; }
    else note.hidden = true;
    const picks = live.picks;
    $('#picks').innerHTML = picks.length ? picks.map((p, i) => `<article class="pick"><span class="pcode" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><button class="pc" type="button" data-ref="pick:${esc(p.id)}" aria-label="${esc(p.item && p.item.title)} 자세히 보기">${artHTML(p.item)}</button>
        <div class="strip"><b title="${esc(p.item && p.item.title)}">${esc(p.item && p.item.title)}</b><span class="a">${esc(p.item && p.item.artist)}${p.item && p.item.year ? ' · ' + esc(p.item.year) : ''}</span></div>
        <div class="by">${avatar(nameOf(p.uname), 'sm')}<button type="button" data-user="${esc(p.uname)}">${esc(nameOf(p.uname))}</button></div></article>`).join('')
      : '<p class="rail-empty">오늘은 아직 아무도 고르지 않았습니다. 내 목록이나 소식의 앨범을 누른 뒤 “오늘의 추천으로 올리기”를 눌러 보세요.</p>';
    const list = allFeed().filter(f => feedFilter === 'all' || f.kind === feedFilter);
    $('#cfeed').innerHTML = (list.length ? list.slice(0, feedShown).map(postHTML).join('') : `<li class="rail-empty">${live.ready ? '해당하는 소식이 없습니다.' : '불러오고 있습니다…'}</li>`)
      + (list.length > feedShown || (feedMoreSrv && list.length >= feedShown) ? `<li class="more-li">${moreBtn('data-feed-more', `더보기 (${Math.min(feedShown, list.length)}개 보는 중)`)}</li>` : '');
    const us = usersSorted();
    $('#users-n').textContent = us.length ? us.length + '명' : '';
    $('#meta-comm').innerHTML = `<span>USERS ${us.length} · PICKS ${picks.length}</span><span>${STAMP}</span>`;
    $('#comm-users').innerHTML = us.length ? us.map(userRow).join('') : '<li class="rail-empty">아직 가입한 유저가 없습니다.</li>';
    const my = $('#my-activity-body');
    if (!auth) my.innerHTML = '<p class="hint">Join하면 내가 올린 소식을 여기서 확인하고 지울 수 있습니다.</p>';
    else {
      const mine = allFeed().filter(f => f.uname === auth.key), shown = mine.slice(0, myShown);
      const pick = live.picks.find(p => p.uname === auth.key);
      const lbl = f => f.kind === 'analysis' ? '취향 및 추천' : `담은 음악 ${ymd(f.createdAt)}`;
      my.innerHTML = `<p class="hint">내 소식은 나만 지울 수 있습니다.</p>
        <ul class="mine-list">${pick ? `<li><span>오늘의 추천 · ${esc(pick.item.title)}</span><button class="btn btn-sm btn-danger" type="button" data-delpick="${esc(pick.id)}">내리기</button></li>` : ''}
        ${mine.length ? shown.map(f => `<li><span>${lbl(f)} · ${esc(arr(f.items).map(x => x.title).slice(0, 3).join(', '))} · ${timeAgo(f.createdAt)}</span><button class="btn btn-sm btn-danger" type="button" data-delpost="${esc(f.id)}">삭제</button></li>`).join('') : (pick ? '' : '<li><span>아직 올린 소식이 없습니다.</span></li>')}</ul>
        ${mine.length > myShown || (myMoreSrv && mine.length >= myShown) ? moreBtn('data-my-more') : ''}
        ${mine.length > 1 ? '<button class="btn btn-sm btn-danger" type="button" data-delall>내 소식 모두 삭제</button>' : ''}`;
    }
    const ap = $('#admin-panel');
    ap.hidden = !isAdmin();
    if (isAdmin()) {
      $('#admin-body').innerHTML = `<p class="hint">유저 삭제 시 계정, 목록, 소식, 오늘의 추천, 방명록이 모두 지워집니다. 소식 하나만 지우려면 피드의 “관리자 삭제”를 누르세요.</p>
        <div class="tbl-wrap"><table class="admin-tbl"><thead><tr><th>Username</th><th>소식</th><th>방문</th><th></th></tr></thead><tbody>
        ${us.map(u => `<tr><td>${esc(u.username)}${live.admins.includes(u.key) ? ' <span class="badge">ADMIN</span>' : ''}${(u.lockedUntil || 0) > Date.now() ? ' <span class="hint">잠김</span>' : ''}</td><td>${postCount(u.key)}</td><td>${visitCount(u.key)}</td>
          <td>${(u.lockedUntil || 0) > Date.now() ? `<button class="btn btn-sm" type="button" data-unlock="${esc(u.key)}">잠금 해제</button> ` : ''}${auth && u.key === auth.key ? '' : `<button class="btn btn-sm btn-danger" type="button" data-deluser="${esc(u.key)}">삭제</button>`}</td></tr>`).join('')}
        </tbody></table></div>`;
    }
  }
  function armed(btn, label) {
    if (btn.classList.contains('armed')) return true;
    btn.classList.add('armed'); const old = btn.textContent; btn.textContent = label;
    setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = old; } }, 4000);
    return false;
  }
  document.addEventListener('click', async e => {
    const u = e.target.closest('[data-user]'); if (u) { openProfile(u.dataset.user); return; }
    const ref = e.target.closest('[data-ref]'); if (ref) { openDetail(ref.dataset.ref); return; }
    const dp = e.target.closest('[data-delpost]'); if (dp) { if (armed(dp, '한 번 더 누르면 삭제')) deletePost(dp.dataset.delpost); return; }
    const dk = e.target.closest('[data-delpick]'); if (dk) { try { await api('picks', { method: 'DELETE' }); toast('오늘의 추천을 내렸습니다'); refresh(); } catch (er) { dbFail(er); } return; }
    const da = e.target.closest('[data-delall]'); if (da && auth) { if (armed(da, '한 번 더 누르면 모두 삭제')) { try { await api('posts', { method: 'DELETE' }); older.forEach((f, id) => { if (f.uname === auth.key) older.delete(id); }); toast('내 소식을 모두 삭제했습니다'); refresh(); } catch (er) { dbFail(er); } } return; }
    const du = e.target.closest('[data-deluser]'); if (du && isAdmin()) { if (armed(du, '정말 삭제')) adminDeleteUser(du.dataset.deluser); return; }
    const ld = e.target.closest('[data-listdate]');
    if (ld && !ld.closest('#modal')) { const id = ld.dataset.listdate; openLists.has(id) ? openLists.delete(id) : openLists.add(id); renderCommunity(); return; }
    const fm = e.target.closest('[data-feed-more]');
    if (fm) {
      const list = allFeed().filter(f => feedFilter === 'all' || f.kind === feedFilter);
      fm.disabled = true;
      if (list.length < feedShown + 10 && feedMoreSrv) { try { await loadOlder(); } catch (er) { dbFail(er); } }
      feedShown += 10; renderCommunity(); return;
    }
    const mm = e.target.closest('[data-my-more]');
    if (mm && auth) {
      const mine = allFeed().filter(f => f.uname === auth.key);
      mm.disabled = true;
      if (mine.length < myShown + 10 && myMoreSrv) { try { await loadOlder(auth.key); } catch (er) { dbFail(er); } }
      myShown += 10; renderCommunity(); return;
    }
    const ul = e.target.closest('[data-unlock]'); if (ul && isAdmin()) { try { await api('users/' + enc(ul.dataset.unlock) + '/unlock', { method: 'POST' }); toast('잠금을 해제했습니다'); refresh(); } catch (er) { dbFail(er); } }
  });

  /* ---------------- modal: detail + profile ---------------- */
  let modalCtx = null;
  const infoCache = new Map();
  function openModal(html, ctx) { modalCtx = ctx; $('#modal-body').innerHTML = html; $('#modal').hidden = false; $('#modal-x').focus(); }
  function closeModal() { $('#modal').hidden = true; modalCtx = null; }
  $('#modal-x').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); setSide(false); } });
  let profLib = [];
  function resolveRef(ref) {
    const [kind, a, b] = ref.split(':');
    if (kind === 'my') { const it = state.items[+a]; return it ? { item: it, by: auth ? auth.key : null } : null; }
    if (kind === 'rec') { const it = state.results.recs[+a]; return it ? { item: it } : null; }
    if (kind === 'feed') { const f = allFeed().find(x => x.id === a) || (modalCtx && arr(modalCtx.lists).find(x => x.id === a)); const it = f && arr(f.items)[+b]; return it ? { item: it, by: f.uname, at: f.createdAt, kind: f.kind } : null; }
    if (kind === 'pick') { const p = live.picks.find(x => x.id === a); return p && p.item ? { item: p.item, by: p.uname, at: p.createdAt, kind: 'pick' } : null; }
    if (kind === 'lib') { const it = profLib[+a]; return it ? { item: it } : null; }
    if (kind === 'pa') { const f = modalCtx && arr(modalCtx.analyses).find(x => x.id === a); const it = f && arr(f.items)[+b]; return it ? { item: it, by: f.uname, at: f.createdAt, kind: 'analysis' } : null; }
    return null;
  }
  function detailHTML(ctx) {
    const it = { ...ctx.item, ...(infoCache.get(itemKey(ctx.item)) || {}) };
    const by = ctx.by && live.accounts.has(ctx.by) ? `<p class="hint">${esc(nameOf(ctx.by))}님이 ${ctx.kind === 'pick' ? '오늘의 추천으로 골랐습니다' : (ctx.kind === 'analysis' ? '추천받았습니다' : (ctx.kind === 'list' ? '담았습니다' : '담았습니다'))}${ctx.at ? ' · ' + timeAgo(ctx.at) : ''}</p>` : '';
    const inMine = state.items.some(x => itemKey(x) === itemKey(it));
    const loading = ctx.loading ? '<span class="dots">불러오는 중</span>' : '정보 없음';
    return `<div class="detail"><div class="dc">${artHTML(it)}</div><div style="display:grid;gap:14px;align-content:start;min-width:0">
      <div style="padding-right:40px"><p class="eyebrow">${KIND_LBL[it.type] || 'Album'}</p><h3>${esc(it.title)}</h3><p class="art-name">${esc(it.artist)}</p></div>
      <dl class="meta">
        ${it.type === 'track' ? `<dt>수록 앨범</dt><dd>${it.album ? esc(it.album) : loading}</dd>` : `<dt>앨범명</dt><dd>${esc(it.title)}</dd>`}
        <dt>아티스트</dt><dd>${esc(it.artist)}</dd>
        <dt>장르</dt><dd>${it.genre ? esc(it.genre) : loading}</dd>
        <dt>발매연도</dt><dd>${it.year ? esc(it.year) : loading}</dd>
        <dt>국가</dt><dd>${it.country ? esc(it.country) : loading}</dd>
        ${it.match ? `<dt>match score</dt><dd>${esc(it.match)}</dd>` : ''}
      </dl>
      ${it.why ? `<p class="why">${esc(it.why)}</p>` : ''}
      ${by}
      <div class="d-actions">${inMine ? '<span class="tag">내 목록에 있습니다</span>' : '<button class="btn" type="button" data-d-take>내 목록에 담기</button>'}<button class="btn tickable" type="button" data-d-pick aria-pressed="${isPicked(it)}">${isPicked(it) ? '오늘의 추천 (선택됨 · 다시 누르면 내림)' : '오늘의 추천으로 올리기'}</button></div>
      ${links(it)}
    </div></div>`;
  }
  async function openDetail(ref) {
    const ctx = resolveRef(ref); if (!ctx) return;
    hideAc();
    const it = { ...ctx.item, ...(infoCache.get(itemKey(ctx.item)) || {}) };
    const missing = !it.genre || !it.year || !it.country || (it.type === 'track' && !it.album);
    ctx.loading = missing;
    openModal(detailHTML(ctx), { kind: 'detail', ref, ctx });
    if (!missing) return;
    try {
      const x = await catalogInfo(it);
      infoCache.set(itemKey(it), Object.fromEntries(['album', 'year', 'genre', 'country', 'cover'].map(k => [k, String(x[k] || '').slice(0, 160)]).filter(([k, v]) => v && !it[k])));
    } catch (e) { /* keep "정보 없음" */ }
    ctx.loading = false;
    if (modalCtx && modalCtx.ref === ref) $('#modal-body').innerHTML = detailHTML(ctx);
  }
  $('#modal-body').addEventListener('click', e => {
    const t = e.target.closest('[data-ptab]');
    if (t && modalCtx && modalCtx.kind === 'profile') { modalCtx.tab = t.dataset.ptab; renderProfileModal(); return; }
    const ps = e.target.closest('[data-pset]');
    if (ps && modalCtx && modalCtx.kind === 'profile') { modalCtx.set = ps.dataset.pset; renderProfileModal(); }
  });
  $('#modal-body').addEventListener('click', async e => {
    if (!modalCtx) return;
    if (modalCtx.kind === 'detail') {
      const it = { ...modalCtx.ctx.item, ...(infoCache.get(itemKey(modalCtx.ctx.item)) || {}) };
      if (e.target.closest('[data-d-take]')) { if (addItems([compact(it)], { quiet: true })) toast(`“${it.title}”을(를) 내 목록에 담았습니다`); $('#modal-body').innerHTML = detailHTML(modalCtx.ctx); return; }
      if (e.target.closest('[data-d-pick]')) { await setPick(it); setTimeout(() => { if (modalCtx && modalCtx.kind === 'detail') $('#modal-body').innerHTML = detailHTML(modalCtx.ctx); }, 400); return; }
    }
    if (modalCtx.kind === 'profile') {
      const dm = e.target.closest('[data-delmsg]');
      if (dm) { try { await api('messages/' + enc(dm.dataset.delmsg), { method: 'DELETE' }); modalCtx.messages = modalCtx.messages.filter(m => m.id !== dm.dataset.delmsg); renderProfileModal(); } catch (er) { dbFail(er); } }
    }
  });
  async function openProfile(key) {
    setSide(false);
    modalCtx = { kind: 'profile', key, lib: null, messages: [], analyses: null, lists: [], tab: 'lib', set: 'now' };
    $('#modal').hidden = false; renderProfileModal(); $('#modal-x').focus();
    try {
      const d = await api('users/' + enc(key));
      if (!modalCtx || modalCtx.key !== key) return;
      modalCtx.lib = arr(d.library); modalCtx.messages = arr(d.messages); modalCtx.analyses = arr(d.analyses); modalCtx.lists = arr(d.lists);
      renderProfileModal();
      if (auth && auth.key !== key) refresh();
    } catch (e) { if (modalCtx && modalCtx.key === key) { modalCtx.lib = []; modalCtx.analyses = []; renderProfileModal(); } }
  }
  function renderProfileModal() {
    if (!modalCtx || modalCtx.kind !== 'profile') return;
    const key = modalCtx.key, a = live.accounts.get(key);
    if (!a) { $('#modal-body').innerHTML = '<p class="rail-empty">이 유저는 더 이상 없습니다.</p>'; return; }
    const own = auth && auth.key === key;
    profLib = modalCtx.lib || [];
    const posts = allFeed().filter(f => f.uname === key);
    const loading = modalCtx.lib === null, an = arr(modalCtx.analyses), tab = modalCtx.tab || 'lib';
    const date = t => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
    const pick = live.picks.find(p => p.uname === key);
    let pane = '';
    if (loading) pane = '<p class="rail-empty">불러오고 있습니다…</p>';
    else if (tab === 'lib') {
      const sets = arr(modalCtx.lists), cur = sets.find(f => f.id === modalCtx.set);
      const boxes = `<div class="date-boxes"><button class="date-box" type="button" data-pset="now" aria-pressed="${!cur}">지금</button>${sets.map(f => `<button class="date-box" type="button" data-pset="${esc(f.id)}" aria-pressed="${cur === f}">${ymd(f.createdAt)}</button>`).join('')}</div>`;
      const list = cur ? arr(cur.items) : profLib;
      pane = boxes + (cur ? `<p class="hint">${ymd(cur.createdAt)}에 ANALYZE &amp; RECOMMEND를 누를 때 담겨 있던 음악 ${list.length}개</p>` : `<p class="hint">지금 목록 ${list.length}개</p>`)
        + (list.length ? `<div class="tiles">${list.map((it, i) => tile(it, cur ? `feed:${cur.id}:${i}` : 'lib:' + i)).join('')}</div>` : '<p class="rail-empty">아직 담은 음악이 없습니다.</p>');
    }
    else if (tab === 'taste') {
      const withP = an.filter(f => f.profile && f.profile.summary), last = withP[0];
      pane = last ? `<p class="hint">최근 분석 · ${date(last.createdAt)}</p><p class="summary">${esc(last.profile.summary)}</p>
        ${arr(last.profile.genres).length ? `<ul class="gbars">${arr(last.profile.genres).slice(0, 5).map(x => `<li><span>${esc(x.name)}</span><span class="bar"><i style="width:${Math.max(4, Math.min(100, +x.weight || 0))}%"></i></span><b class="gv">${Math.round(Math.max(0, Math.min(100, +x.weight || 0)))}</b></li>`).join('')}</ul>` : ''}
        ${arr(last.profile.keywords).length ? `<ul class="chips">${arr(last.profile.keywords).map(k => `<li class="tag">${esc(k)}</li>`).join('')}</ul>` : ''}
        ${withP.length > 1 ? `<p class="hr" aria-hidden="true"></p><p class="hint">이전 분석</p><ul class="prev-an">${withP.slice(1, 6).map(f => `<li><b>${date(f.createdAt)}</b> ${esc(f.profile.summary)}</li>`).join('')}</ul>` : ''}`
        : '<p class="rail-empty">아직 취향 분석 기록이 없습니다.</p>';
    } else {
      pane = an.length ? an.map(f => `<p class="hint">${date(f.createdAt)} · ${arr(f.items).length}개</p><div class="tiles">${arr(f.items).map((it, i) => tile(it, `pa:${f.id}:${i}`, it.match ? `<span class="pill match ms">${esc(it.match)}</span>` : '')).join('')}</div>`).join('')
        : '<p class="rail-empty">아직 추천받은 음악이 없습니다.</p>';
    }
    const tabs = [['lib', '담은 음악'], ['taste', '취향 분석'], ['recs', '추천 음악']];
    $('#modal-body').innerHTML = `<div class="prof-top">${avatar(a.username, 'lg')}<div><h3>${esc(a.username)} ${live.admins.includes(key) ? '<span class="badge">ADMIN</span>' : ''}</h3>
        <div class="stats"><span><b>${visitCount(key)}</b>방문</span><span><b>${profLib.length}</b>담은 음악</span><span><b>${postCount(key)}</b>소식</span><span>${timeAgo(a.createdAt || 0)} 가입</span></div></div></div>
      ${pick ? `<section style="display:grid;gap:8px"><h4>오늘의 추천</h4><div class="tiles">${tile(pick.item, 'pick:' + pick.id)}</div></section>` : ''}
      <p class="hr" aria-hidden="true"></p>
      <div class="seg prof-tabs" role="group" aria-label="보기">${tabs.map(([k, l]) => `<button type="button" data-ptab="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</div>
      <section class="prof-pane" aria-live="polite">${pane}</section>
      <p class="hr" aria-hidden="true"></p>
      <section style="display:grid;gap:10px"><h4>방명록 <span class="hint">${modalCtx.messages.length}</span></h4>
        ${canAct() ? `<form class="msg-form" id="msg-form"><input type="text" id="msg-body" maxlength="200" placeholder="${own ? '내 방명록에 한마디' : esc(a.username) + '님께 한마디'}" aria-label="방명록 내용"><button class="btn btn-sm btn-primary" type="submit">남기기</button></form>` : '<p class="hint">Join하면 방명록을 남길 수 있습니다.</p>'}
        ${modalCtx.messages.length ? `<ul class="msgs">${modalCtx.messages.map(m => `<li class="msg"><div class="msg-top"><b>${esc(nameOf(m.from))}</b><span>${timeAgo(m.createdAt)}</span>${auth && (own || m.from === auth.key || isAdmin()) ? `<button class="del" type="button" data-delmsg="${esc(m.id)}">지우기</button>` : ''}</div><p>${esc(m.body)}</p></li>`).join('')}</ul>` : ''}
      </section>`;
    const f = $('#msg-form');
    if (f) f.addEventListener('submit', async e => {
      e.preventDefault();
      const body = $('#msg-body').value.trim(); if (!body) return;
      try {
        const d = await api('users/' + enc(key) + '/messages', { method: 'POST', body: { body: body.slice(0, 200) } });
        modalCtx.messages.unshift(d.message); renderProfileModal();
      } catch (er) { dbFail(er); }
    });
  }

  /* ---------------- drawer ---------------- */
  function setSide(open) { document.body.classList.toggle('side-open', open); $('#side-toggle').setAttribute('aria-expanded', String(open)); }
  $('#side-toggle').addEventListener('click', () => setSide(!document.body.classList.contains('side-open')));
  $('#scrim').addEventListener('click', () => setSide(false));

  /* ---------------- boot ---------------- */
  renderList(); renderResults(); renderAcct(); renderRail();
  setView(location.hash ? location.hash.slice(1) : 'music');
  if (auth) pullLib();
  refresh();
  if (state.items.some(it => it.pending || !it.cover)) enrich(state.items.filter(it => !it.cover).slice(0, 30));
  setInterval(() => { if (document.visibilityState === 'visible') renderRail(); }, 60000);
})();
