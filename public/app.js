/* JUKEBOX front end — plain JS, no build step. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const arr = v => (Array.isArray(v) ? v : (v ? [v] : []));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const MIN = { music: 5, film: 3 }, MAX = 100;
  const KIND_LBL = { album: 'Album', track: 'Song' };

  const AXES = {
    music: ['장르', '프로듀서·엔지니어', '세션·참여진', '레이블', '씬·지역', '시대·영향 관계'],
    film: ['감독', '촬영감독', '각본가', '배우', '음악감독', '편집', '제작사·배급사', '국가·사조'],
  };
  const REGIONS = { music: ['영미권', '한국', '일본', '유럽 (비영어권)', '라틴·아프리카·기타'], film: ['한국', '일본', '중화권', '유럽', '미국·영국', '기타 지역'] };
  const FTYPES = ['극영화', '다큐멘터리', '애니메이션', '단편'];
  const ERAS = { music: [1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020], film: [1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020] };
  const SIM_LBL = ['', '아주 비슷한 결', '비슷한 결 중심', '비슷함과 새로움 반반', '새로운 방향 위주', '의외의 발견'];
  const POP_LBL = ['', '널리 알려진 대표작', '대표작 중심', '알려진 작품과 숨은 작품 반반', '숨은 작품 위주', '평가 수가 적은 숨은 작품'];
  const PRESETS = { safe: [1, 2], balance: [3, 3], dig: [3, 5], leap: [5, 4] };
  const PRESET_DESC = {
    safe: '지금 취향과 아주 가까운 결의 잘 알려진 작품을 추천합니다.',
    balance: '비슷한 결과 새로운 방향, 알려진 작품과 숨은 작품을 고르게 섞습니다.',
    dig: '비슷한 결 안에서 덜 알려진 숨은 작품을 깊게 파고듭니다.',
    leap: '연결고리 하나를 따라 의외의 장르와 시대로 넘어갑니다.',
  };
  const EXAMPLES = {
    music: [
      { type: 'album', artist: 'Radiohead', title: 'In Rainbows', rating: 5 },
      { type: 'album', artist: 'Portishead', title: 'Dummy', rating: 4.5 },
      { type: 'album', artist: 'Massive Attack', title: 'Mezzanine', rating: 4.5 },
      { type: 'album', artist: 'Cocteau Twins', title: 'Heaven or Las Vegas', rating: 4 },
      { type: 'track', artist: 'Björk', title: 'Jóga', rating: 5 },
      { type: 'album', artist: '검정치마', title: 'Team Baby', rating: 4 },
    ],
    film: [
      { title: '시네마 천국', year: '1988', why: '극장에 대한 향수, 모리코네의 음악', rating: 5 },
      { title: '화양연화', year: '2000', why: '색과 음악, 억눌린 감정', rating: 4.5 },
      { title: '파리, 텍사스', year: '1984', why: '', rating: 4.5 },
      { title: '버닝', year: '2018', why: '모호함과 긴장', rating: 4 },
    ],
  };

  /* ---------------- state ---------------- */
  const emptyRes = () => ({ profile: null, recs: [], people: [] });
  const blank = mode => ({ items: EXAMPLES[mode].map(x => ({ ...x })), isExample: true, results: emptyRes(), feedback: {} });
  const defOpts = () => ({
    music: { type: 'album', format: 'both', vocal: 'any', n: '12', preset: 'balance', axes: AXES.music.slice(0, 5), region: [] },
    film: { n: '10', p: '3', runtime: 'any', preset: 'balance', axes: AXES.film.slice(0, 6), region: [], types: ['극영화'] },
  });
  const STORE = 'jukebox.site.v1';
  let state = { mode: 'music', music: blank('music'), film: blank('film'), opts: defOpts() };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && saved.music && saved.film) {
      const d = defOpts();
      state = { ...state, ...saved, opts: { ...(saved.opts || {}), music: { ...d.music, ...(saved.opts && saved.opts.music) }, film: { ...d.film, ...(saved.opts && saved.opts.film) } } };
      ['music', 'film'].forEach(m => { state[m].results = state[m].results || emptyRes(); state[m].feedback = state[m].feedback || {}; });
    }
  } catch (e) { /* ignore */ }
  const O = state.opts;
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ } };

  let auth = null;
  try { auth = JSON.parse(localStorage.getItem('jukebox.auth') || 'null'); } catch (e) { auth = null; }
  const saveAuth = () => { try { auth ? localStorage.setItem('jukebox.auth', JSON.stringify(auth)) : localStorage.removeItem('jukebox.auth'); } catch (e) { /* ignore */ } };

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }
  function timeAgo(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    if (s < 86400 * 7) return Math.floor(s / 86400) + '일 전';
    const d = new Date(ms); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  }
  const hashN = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const avatar = (nick, cls = '') => `<span class="av ${cls}" style="background:hsl(${hashN(nick) % 360} 55% 42%)" aria-hidden="true">${esc(String(nick || '?').slice(0, 1).toUpperCase())}</span>`;

  /* ---------------- api ---------------- */
  async function api(path, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    if (auth && auth.token) headers.authorization = 'Bearer ' + auth.token;
    let r;
    try { r = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
    catch (e) { const er = new Error('서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.'); er.status = 0; throw er; }
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (!r.ok) {
      const er = new Error((data && data.error && data.error.message) || '요청을 처리하지 못했습니다.');
      er.status = r.status; er.code = data && data.error && data.error.code;
      if (r.status === 401 && er.code === 'login_required' && auth) { auth = null; saveAuth(); renderAcct(); }
      throw er;
    }
    return data;
  }

  /* ---------------- covers: iTunes (JSONP), TMDB proxy, Wikipedia ---------------- */
  let jsonpN = 0;
  function jsonp(url, timeout = 7000) {
    return new Promise((res, rej) => {
      const cb = '__jb' + (++jsonpN) + '_' + Date.now().toString(36);
      const s = document.createElement('script');
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; window[cb] = () => {}; s.remove(); rej(new Error('timeout')); } }, timeout);
      window[cb] = d => { if (done) return; done = true; clearTimeout(t); s.remove(); try { delete window[cb]; } catch (e) { window[cb] = undefined; } res(d); };
      s.onerror = () => { if (done) return; done = true; clearTimeout(t); s.remove(); rej(new Error('jsonp')); };
      s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(s);
    });
  }
  const bigArt = u => (u || '').replace(/\/\d+x\d+bb\.(jpg|png|webp)$/i, '/600x600bb.jpg');
  const tidy = t => String(t || '').replace(/\s+-\s+(Single|EP)$/i, '').trim();
  function normItunes(r) {
    const song = r.wrapperType === 'track';
    return {
      type: song ? 'track' : 'album', title: tidy(song ? r.trackName : r.collectionName), artist: r.artistName || '',
      album: song ? tidy(r.collectionName) : '', year: String(r.releaseDate || '').slice(0, 4),
      cover: bigArt(r.artworkUrl100), link: (song ? r.trackViewUrl : r.collectionViewUrl) || '',
    };
  }
  const itunesCache = new Map();
  function itunes(term, entity, limit = 8) {
    const key = entity + '|' + term.toLowerCase();
    if (itunesCache.has(key)) return itunesCache.get(key);
    const call = country => jsonp(`https://itunes.apple.com/search?term=${enc(term)}&media=music&entity=${entity}&limit=${limit}&country=${country}`).then(d => arr(d && d.results).map(normItunes));
    const p = call('KR').then(list => (list.length ? list : call('US'))).catch(e => { itunesCache.delete(key); throw e; });
    itunesCache.set(key, p);
    return p;
  }
  let tmdbOn = null; // null = unknown, false = not configured
  const filmCache = new Map();
  async function filmSearch(q, year) {
    const key = q.toLowerCase() + '|' + (year || '');
    if (filmCache.has(key)) return filmCache.get(key);
    const p = (async () => {
      if (tmdbOn !== false) {
        try {
          const d = await api('/api/tmdb/search?q=' + enc(q) + (year ? '&year=' + enc(year) : ''));
          tmdbOn = true;
          return arr(d.results).map(x => ({ ...x, src: 'tmdb' }));
        } catch (e) { if (e.status === 404 || e.status === 0 || e.status === 500) tmdbOn = false; }
      }
      return wikiFilm(q, year);
    })();
    filmCache.set(key, p);
    return p;
  }
  async function wikiFilm(q, year) {
    const lang = /[가-힣]/.test(q) ? 'ko' : 'en';
    const suffix = lang === 'ko' ? ' 영화' : ' film';
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${enc(q + (year ? ' ' + year : '') + suffix)}&gsrlimit=8&prop=pageimages|description&piprop=thumbnail&pithumbsize=500`;
    try {
      const d = await fetch(url).then(r => r.json());
      const pages = Object.values((d.query && d.query.pages) || {}).sort((a, b) => a.index - b.index);
      return pages.map(p => {
        const y = (String(p.description || '').match(/(18|19|20)\d{2}/) || [])[0] || '';
        return { title_ko: p.title.replace(/\s*\((?:\d{4}년 )?(?:영화|film|\d{4} film)\)$/i, ''), title: '', year: y, poster: p.thumbnail ? p.thumbnail.source : null, link: `https://${lang}.wikipedia.org/wiki/${enc(p.title.replace(/ /g, '_'))}`, src: 'wiki' };
      });
    } catch (e) { return []; }
  }

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').replace(/[^0-9a-z\uac00-\ud7a3\u3040-\u30ff\u4e00-\u9fff]/g, '');
  const loose = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
  function bestMusic(list, artist, title) {
    return list.find(x => loose(x.artist, artist) && loose(x.title, title))
      || list.find(x => loose(x.artist, artist) && norm(x.album) && loose(x.album, title))
      || null;
  }
  function bestFilm(list, title, orig, year) {
    const y = parseInt(year, 10);
    const near = x => !y || !x.year || Math.abs(parseInt(x.year, 10) - y) <= 1;
    return list.find(x => (loose(x.title_ko, title) || loose(x.title, orig || title) || loose(x.title, title)) && near(x))
      || list.find(x => near(x) && (loose(x.title_ko, orig) || loose(x.title, orig)))
      || null;
  }

  // gentle scheduler for iTunes (≈20 calls/minute per visitor)
  let gap = 600, qBusy = false;
  const queue = [];
  function schedule(task) { return new Promise((res) => { queue.push({ task, res }); pump(); }); }
  async function pump() {
    if (qBusy) return; qBusy = true;
    while (queue.length) {
      const { task, res } = queue.shift();
      try { res(await task()); gap = Math.max(600, gap * 0.9); }
      catch (e) { gap = Math.min(6000, gap * 2); res(null); }
      await sleep(gap);
    }
    qBusy = false;
  }
  async function lookupMusic(o) {
    const entity = o.type === 'track' ? 'song' : 'album';
    const list = await itunes(`${o.artist} ${o.title}`, entity, 10);
    return bestMusic(list, o.artist, o.title);
  }
  async function lookupFilm(o) {
    const list = await filmSearch(o.title_ko || o.title, o.year);
    return bestFilm(list, o.title_ko || o.title, o.orig || o.title, o.year);
  }

  // fill covers for my list items that lack one
  const pendingLookup = new Set();
  function queueItemCovers(mode) {
    state[mode].items.forEach(it => {
      if (it.cover || it.looked || pendingLookup.has(it)) return;
      pendingLookup.add(it);
      const run = async () => {
        const m = mode === 'music' ? await lookupMusic(it) : await lookupFilm(it);
        return m;
      };
      (mode === 'music' ? schedule(run) : run().catch(() => null)).then(m => {
        pendingLookup.delete(it);
        it.looked = true;
        if (m) {
          it.cover = mode === 'music' ? m.cover : m.poster;
          it.link = m.link || it.link;
          if (!it.year && m.year) it.year = m.year;
          if (mode === 'film' && m.title && !it.orig && m.title !== it.title) it.orig = m.title;
        }
        save(); renderList(mode); scheduleSync(mode);
      });
    });
  }

  function artHTML(o, extra = '') {
    if (o.cover) return `<img class="real" src="${esc(o.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
    const h = hashN((o.artist || o.director || '') + (o.title || o.title_ko || ''));
    return `<div class="art ${extra}" style="--c0:hsl(${h % 360} 45% 22%);--c1:hsl(${(h + 40) % 360} 70% 55%);--c2:hsl(${(h + 200) % 360} 65% 70%)"></div>`;
  }
  document.addEventListener('error', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.classList.contains('real')) {
      const d = document.createElement('div'); d.className = 'art';
      d.style.cssText = '--c0:hsl(250 40% 22%);--c1:hsl(290 60% 50%);--c2:hsl(200 60% 65%)';
      t.replaceWith(d);
    }
  }, true);

  /* ---------------- mode + backdrop ---------------- */
  function setMode(m) {
    if (m !== 'music' && m !== 'film') m = 'music';
    state.mode = m; document.body.dataset.mode = m;
    $('#view-music').hidden = m !== 'music';
    $('#view-film').hidden = m !== 'film';
    ['music', 'film'].forEach(x => $('#tab-' + x).removeAttribute('aria-current'));
    $('#tab-' + m).setAttribute('aria-current', 'page');
    hideAc('music'); hideAc('film');
    onScroll(); save();
    if (rail.tab === 'feed') loadFeed();
    else if (rail.tab === 'profile') { rail.kind = m; renderProfile(); }
  }
  window.addEventListener('hashchange', () => setMode(location.hash.slice(1)));
  const filmBg = $('.bg-film'); let ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const t = Math.min(1, Math.max(0, (scrollY / max - 0.12) / 0.55));
      filmBg.style.setProperty('--p', (t * t * (3 - 2 * t)).toFixed(3));
    });
  }
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll);

  /* ---------------- settings controls ---------------- */
  function seg(el, get, set) {
    const paint = () => $$('button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === get())));
    paint();
    el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; set(b.dataset.v); paint(); save(); });
    return paint;
  }
  seg($('#music-type'), () => O.music.type, v => { O.music.type = v; acInput('music'); });
  seg($('#music-format'), () => O.music.format, v => (O.music.format = v));
  seg($('#music-vocal'), () => O.music.vocal, v => (O.music.vocal = v));
  seg($('#music-n'), () => O.music.n, v => (O.music.n = v));
  seg($('#film-n'), () => O.film.n, v => (O.film.n = v));
  seg($('#film-p'), () => O.film.p, v => (O.film.p = v));
  seg($('#film-runtime'), () => O.film.runtime, v => (O.film.runtime = v));
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
  chipSet($('#music-axes'), AXES.music, () => O.music.axes, v => (O.music.axes = v));
  chipSet($('#film-axes'), AXES.film, () => O.film.axes, v => (O.film.axes = v));
  chipSet($('#music-region'), REGIONS.music, () => O.music.region, v => (O.music.region = v));
  chipSet($('#film-region'), REGIONS.film, () => O.film.region, v => (O.film.region = v));
  chipSet($('#film-types'), FTYPES, () => O.film.types, v => (O.film.types = v));
  ['music', 'film'].forEach(mode => {
    $('#' + mode + '-era-from').innerHTML = '<option value="">처음부터</option>' + ERAS[mode].map(y => `<option value="${y}">${y}년대</option>`).join('');
    $('#' + mode + '-era-to').innerHTML = '<option value="">지금까지</option>' + ERAS[mode].map(y => `<option value="${y}">${y}년대</option>`).join('');
  });
  ['music-sim', 'music-pop', 'music-same', 'music-exclude', 'music-note', 'music-era-from', 'music-era-to',
    'film-sim', 'film-pop', 'film-exclude', 'film-note', 'film-era-from', 'film-era-to'].forEach(id => {
    const el = $('#' + id); const v = O[id];
    if (v !== undefined) { if (el.type === 'checkbox') el.checked = v; else el.value = v; }
    el.addEventListener('change', () => { O[id] = el.type === 'checkbox' ? el.checked : el.value; save(); });
  });
  ['music', 'film'].forEach(mode => {
    const d = $('#' + mode + '-settings');
    if (O[mode + '-settings-open']) d.open = true;
    d.addEventListener('toggle', () => { O[mode + '-settings-open'] = d.open; save(); });
  });
  const presetPaint = {};
  function presetDesc(mode, s, p) {
    const k = O[mode].preset;
    $('#' + mode + '-preset-desc').textContent = k ? PRESET_DESC[k] : `직접 조절한 설정입니다 (유사도 ${s} · 인지도 ${p}).`;
  }
  ['music', 'film'].forEach(mode => {
    const ranges = {};
    ['sim', 'pop'].forEach(k => {
      const r = $(`#${mode}-${k}`), out = $(`#${mode}-${k}-out`), ticks = $$(`[data-range="${mode}-${k}"] .ticks span`);
      const L = k === 'sim' ? SIM_LBL : POP_LBL;
      const upd = () => { const v = +r.value; out.textContent = `${v} / 5 · ${L[v]}`; ticks.forEach((t, i) => t.classList.toggle('on', i + 1 === v)); };
      r.addEventListener('input', () => { upd(); sync(); });
      ranges[k] = { r, upd }; upd();
    });
    const sync = () => {
      const s = +ranges.sim.r.value, p = +ranges.pop.r.value;
      O[mode].preset = Object.keys(PRESETS).find(k => PRESETS[k][0] === s && PRESETS[k][1] === p) || '';
      presetPaint[mode] && presetPaint[mode]();
      presetDesc(mode, s, p);
    };
    presetPaint[mode] = seg($('#' + mode + '-preset'), () => O[mode].preset, v => {
      O[mode].preset = v; const [s, p] = PRESETS[v];
      ranges.sim.r.value = s; ranges.pop.r.value = p; O[mode + '-sim'] = String(s); O[mode + '-pop'] = String(p);
      ranges.sim.upd(); ranges.pop.upd(); presetDesc(mode, s, p);
    });
    sync();
  });

  /* ---------------- my list ---------------- */
  const itemKey = (mode, it) => (mode === 'music' ? (it.artist + '|' + it.title) : (it.title + '|' + (it.year || ''))).toLowerCase();
  function addItems(mode, items, quiet) {
    const s = state[mode];
    if (s.isExample) { s.items = []; s.isExample = false; }
    let added = 0;
    for (const it of items) {
      if (s.items.length >= MAX) { toast('최대 100개까지 넣을 수 있습니다'); break; }
      if (!s.items.some(x => itemKey(mode, x) === itemKey(mode, it))) { s.items.push(it); added++; }
      else if (!quiet) toast('이미 목록에 있습니다');
    }
    renderList(mode); save(); scheduleSync(mode); queueItemCovers(mode);
    return added;
  }
  function starsHTML(i, v) {
    let h = '';
    for (let s = 1; s <= 5; s++) h += `<button type="button" class="star ${v >= s ? 'on' : (v >= s - 0.5 ? 'half' : '')}" data-i="${i}" data-s="${s}" aria-label="별점 ${s}점" title="같은 별을 한 번 더 누르면 반 개, 세 번째는 지우기">★</button>`;
    return `<div class="rate"><span class="stars" role="group" aria-label="별점 ${v || '없음'}">${h}</span>${v ? `<span class="rv">${v}</span>` : ''}</div>`;
  }
  function renderList(mode) {
    const s = state[mode], list = $('#' + mode + '-list');
    list.innerHTML = s.items.length ? s.items.map((it, i) => {
      const loading = !it.cover && !it.looked ? 'loading' : '';
      const meta = mode === 'music'
        ? `<span class="kind">${KIND_LBL[it.type] || 'Album'}</span>${it.year ? `<span>${esc(it.year)}</span>` : ''}`
        : `${it.year ? `<span>${esc(it.year)}</span>` : ''}${it.orig ? `<span>${esc(it.orig)}</span>` : ''}`;
      return `<li class="mi ${mode}">
        <div class="mi-cover">${artHTML(it, loading)}</div>
        <div class="mi-t">
          <h4 title="${esc(it.title)}">${esc(it.title)}</h4>
          ${mode === 'music' ? `<p class="a">${esc(it.artist)}</p>` : (it.why ? `<p class="mi-why">${esc(it.why)}</p>` : '')}
          <p class="m">${meta}</p>
          ${starsHTML(i, it.rating || 0)}
        </div>
        <button class="x" type="button" data-i="${i}" aria-label="${esc(it.title)} 삭제">×</button>
      </li>`;
    }).join('') : `<li class="list-empty">아직 비어 있습니다. 위 입력칸에 아티스트나 제목을 적어 보세요.</li>`;
    const n = s.items.length;
    $('#' + mode + '-count').textContent = n;
    $('#' + mode + '-meter').style.width = (n / MAX * 100) + '%';
    $('#' + mode + '-need').textContent = n < MIN[mode] ? `${MIN[mode] - n}개가 더 필요합니다` : '분석할 수 있습니다';
    $('#' + mode + '-example').hidden = !s.isExample;
    $('#' + mode + '-go').disabled = n < MIN[mode] || !!busy[mode];
  }
  ['music', 'film'].forEach(mode => {
    $('#' + mode + '-list').addEventListener('click', e => {
      const st = e.target.closest('.star');
      if (st) {
        const it = state[mode].items[+st.dataset.i], v = +st.dataset.s, cur = it.rating || 0;
        it.rating = cur === v ? v - 0.5 : (cur === v - 0.5 ? 0 : v);
        if (!it.rating) delete it.rating;
        state[mode].isExample = false; renderList(mode); save(); scheduleSync(mode); return;
      }
      const b = e.target.closest('.x'); if (!b) return;
      state[mode].items.splice(+b.dataset.i, 1); state[mode].isExample = false; renderList(mode); save(); scheduleSync(mode);
    });
    const clear = () => { state[mode].items = []; state[mode].isExample = false; renderList(mode); save(); scheduleSync(mode); };
    $('#' + mode + '-clear').addEventListener('click', clear);
    $(`[data-clear="${mode}"]`).addEventListener('click', clear);
  });
  const takeRating = l => { const m = l.match(/\s*[★*]\s*([0-5](?:\.5)?)\s*$/); return m ? [l.slice(0, m.index), +m[1]] : [l, 0]; };
  $('#music-bulk-add').addEventListener('click', () => {
    const items = $('#music-bulk').value.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      let [l, rating] = takeRating(line), type = O.music.type;
      const m = l.match(/\s*[\[(](곡|싱글|song|track|앨범|album|ep|lp)[\])]\s*$/i);
      if (m) { type = /곡|싱글|song|track/i.test(m[1]) ? 'track' : 'album'; l = l.slice(0, m.index); }
      if (!rating) [l, rating] = takeRating(l);
      const parts = l.split(/\s+[-–—]\s+|\s*[–—]\s*/);
      if (parts.length < 2) return null;
      const it = { type, artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
      if (rating) it.rating = rating;
      return it;
    }).filter(Boolean);
    if (items.length) { const n = addItems('music', items, true); $('#music-bulk').value = ''; toast(`${n}개를 추가했습니다. 커버를 찾고 있습니다`); }
    else toast('“아티스트 - 제목” 형식으로 적어 주세요');
  });
  $('#film-bulk-add').addEventListener('click', () => {
    const items = $('#film-bulk').value.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const [l, rating] = takeRating(line);
      const m = l.match(/^(.*?)[\s,]*[(\[]?((?:18|19|20)\d{2})[)\]]?\s*$/);
      const it = m && m[1] ? { title: m[1].trim(), year: m[2], why: '' } : { title: l.trim(), year: '', why: '' };
      if (rating) it.rating = rating;
      return it;
    });
    if (items.length) { const n = addItems('film', items, true); $('#film-bulk').value = ''; toast(`${n}편을 추가했습니다. 포스터를 찾고 있습니다`); }
  });

  /* ---------------- autocomplete ---------------- */
  const ac = { music: { list: [], idx: -1, t: 0, seq: 0 }, film: { list: [], idx: -1, t: 0, seq: 0 } };
  function hideAc(mode) { $('#' + mode + '-ac').hidden = true; ac[mode].idx = -1; }
  function acQuery(mode) {
    if (mode === 'music') return ($('#music-artist').value + ' ' + $('#music-title').value).trim();
    return $('#film-title').value.trim();
  }
  function acInput(mode) {
    clearTimeout(ac[mode].t);
    const q = acQuery(mode);
    if (q.length < 2) { hideAc(mode); return; }
    ac[mode].t = setTimeout(() => acSearch(mode, q), 320);
  }
  async function acSearch(mode, q) {
    const seq = ++ac[mode].seq;
    const box = $('#' + mode + '-ac');
    box.hidden = false;
    if (!ac[mode].list.length) box.innerHTML = `<div class="ac-empty">검색하고 있습니다…</div>`;
    let list = [];
    try {
      list = mode === 'music'
        ? await itunes(q, O.music.type === 'track' ? 'song' : 'album', 8)
        : await filmSearch(q, $('#film-year').value.trim());
    } catch (e) { list = []; }
    if (seq !== ac[mode].seq) return;
    const seen = new Set();
    list = list.filter(x => { const k = ((x.title || x.title_ko) + '|' + (x.artist || x.year)).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
    ac[mode].list = list; ac[mode].idx = -1;
    const src = mode === 'music' ? 'Apple Music' : (tmdbOn ? 'TMDB' : '위키백과');
    box.innerHTML = `<div class="ac-head"><span>${src} 검색 결과 · 고르면 바로 목록에 담깁니다</span><button class="btn btn-ghost btn-sm" type="button" data-ac-close>닫기</button></div>` + (list.length ? list.map((x, i) => mode === 'music'
      ? `<button type="button" class="ac-item" role="option" data-i="${i}"><span class="ac-cover">${artHTML(x)}</span><span class="ac-t"><b>${esc(x.title)}</b><span>${esc(x.artist)} · ${KIND_LBL[x.type]}${x.year ? ' · ' + esc(x.year) : ''}</span></span><span class="ac-add">담기</span></button>`
      : `<button type="button" class="ac-item film" role="option" data-i="${i}"><span class="ac-cover">${artHTML({ cover: x.poster, title: x.title_ko })}</span><span class="ac-t"><b>${esc(x.title_ko || x.title)}</b><span>${[x.year, x.title && x.title !== x.title_ko ? x.title : ''].filter(Boolean).map(esc).join(' · ')}</span></span><span class="ac-add">담기</span></button>`
    ).join('') : `<div class="ac-empty">검색 결과가 없습니다. [추가]를 누르면 입력한 그대로 담깁니다.</div>`);
  }
  function acPick(mode, i) {
    const x = ac[mode].list[i]; if (!x) return;
    if (mode === 'music') {
      addItems('music', [{ type: x.type, artist: x.artist, title: x.title, year: x.year, cover: x.cover, link: x.link, looked: true }]);
      $('#music-title').value = ''; $('#music-artist').value = ''; $('#music-artist').focus();
    } else {
      addItems('film', [{ title: x.title_ko || x.title, orig: x.title && x.title !== x.title_ko ? x.title : '', year: x.year, why: $('#film-why').value.trim(), cover: x.poster, link: x.link, looked: true }]);
      ['#film-title', '#film-year', '#film-why'].forEach(s => ($(s).value = '')); $('#film-title').focus();
    }
    ac[mode].list = []; hideAc(mode);
  }
  function acKeys(mode, e) {
    const box = $('#' + mode + '-ac'); const a = ac[mode];
    if (box.hidden || !a.list.length) { if (e.key === 'Escape') hideAc(mode); return; }
    const items = $$('.ac-item', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      a.idx = (a.idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((b, i) => b.classList.toggle('on', i === a.idx));
      items[a.idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && a.idx >= 0) { e.preventDefault(); acPick(mode, a.idx); }
    else if (e.key === 'Escape') hideAc(mode);
  }
  ['music-artist', 'music-title'].forEach(id => { $('#' + id).addEventListener('input', () => acInput('music')); $('#' + id).addEventListener('keydown', e => acKeys('music', e)); });
  $('#film-title').addEventListener('input', () => acInput('film'));
  $('#film-year').addEventListener('input', () => acInput('film'));
  $('#film-title').addEventListener('keydown', e => acKeys('film', e));
  ['music', 'film'].forEach(mode => {
    $('#' + mode + '-ac').addEventListener('click', e => {
      if (e.target.closest('[data-ac-close]')) { hideAc(mode); return; }
      const b = e.target.closest('.ac-item'); if (b) acPick(mode, +b.dataset.i);
    });
  });
  document.addEventListener('click', e => { ['music', 'film'].forEach(m => { if (!e.target.closest('#' + m + '-entry')) hideAc(m); }); });
  $('#music-form').addEventListener('submit', e => {
    e.preventDefault();
    const artist = $('#music-artist').value.trim(), title = $('#music-title').value.trim();
    if (!artist || !title) { (artist ? $('#music-title') : $('#music-artist')).focus(); toast('아티스트와 제목을 모두 적거나 검색 결과에서 골라 주세요'); return; }
    addItems('music', [{ type: O.music.type, artist, title }]);
    $('#music-title').value = ''; $('#music-artist').value = ''; hideAc('music'); $('#music-artist').focus();
  });
  $('#film-form').addEventListener('submit', e => {
    e.preventDefault();
    const title = $('#film-title').value.trim(); if (!title) { $('#film-title').focus(); return; }
    addItems('film', [{ title, year: $('#film-year').value.trim(), why: $('#film-why').value.trim() }]);
    ['#film-title', '#film-year', '#film-why'].forEach(s => ($(s).value = '')); hideAc('film'); $('#film-title').focus();
  });

  /* ---------------- sync my lists to the server ---------------- */
  const syncT = {};
  function scheduleSync(mode) {
    if (!auth) return;
    clearTimeout(syncT[mode]);
    syncT[mode] = setTimeout(async () => {
      const s = state[mode]; if (s.isExample) return;
      const items = s.items.map(it => ({ title: it.title, artist: mode === 'music' ? it.artist : (it.orig || ''), year: it.year, type: mode === 'music' ? it.type : 'film', cover: it.cover, link: it.link, rating: it.rating }));
      try { await api('/api/items', { method: 'PUT', body: { kind: mode, items } }); if (rail.tab === 'feed') loadFeed(); }
      catch (e) { /* silent; next change retries */ }
    }, 1200);
  }
  async function pullMyLists() {
    for (const mode of ['music', 'film']) {
      try {
        const d = await api('/api/items?kind=' + mode);
        const local = state[mode];
        if (!d.items.length) { if (!local.isExample && local.items.length) scheduleSync(mode); continue; }
        const server = d.items.map(x => mode === 'music'
          ? { type: x.type === 'track' ? 'track' : 'album', artist: x.artist, title: x.title, year: x.year, cover: x.cover, link: x.link, rating: x.rating || undefined, looked: !!x.cover }
          : { title: x.title, orig: x.artist, year: x.year, cover: x.cover, link: x.link, rating: x.rating || undefined, looked: !!x.cover, why: '' });
        // keep anything added on this device before logging in
        const keys = new Set(server.map(x => itemKey(mode, x)));
        const extra = local.isExample ? [] : local.items.filter(x => !keys.has(itemKey(mode, x)));
        local.items = server.concat(extra).slice(0, MAX);
        local.isExample = false;
        if (extra.length) scheduleSync(mode);
        renderList(mode); queueItemCovers(mode);
      } catch (e) { /* offline */ }
    }
    save();
  }

  /* ---------------- recommendations ---------------- */
  const busy = { music: false, film: false };
  const recKey = (mode, r) => (mode === 'music' ? ((r.artist || '') + '|' + (r.title || '')) : ((r.title || r.title_ko || '') + '|' + (r.year || ''))).toLowerCase();
  const recLabel = (mode, r) => (mode === 'music' ? `${r.artist} — ${r.title}` : `${r.title || r.title_ko}${r.year ? ' (' + r.year + ')' : ''}`);
  function collectOpts(mode) {
    const o = { ...O[mode] };
    o.sim = $('#' + mode + '-sim').value; o.pop = $('#' + mode + '-pop').value;
    o.eraFrom = $('#' + mode + '-era-from').value; o.eraTo = $('#' + mode + '-era-to').value;
    o.exclude = $('#' + mode + '-exclude').value; o.note = $('#' + mode + '-note').value;
    if (mode === 'music') o.same = $('#music-same').checked;
    return o;
  }
  function musicLinks(r) {
    const q = `${r.artist} ${r.title}`;
    return `<nav class="outlinks" aria-label="찾아 듣기">
      ${r.link ? `<a class="apple" href="${esc(r.link)}" target="_blank" rel="noopener">Apple Music</a>` : ''}
      <a href="https://open.spotify.com/search/${enc(q)}" target="_blank" rel="noopener">Spotify</a>
      <a href="https://www.youtube.com/results?search_query=${enc(q)}" target="_blank" rel="noopener">YouTube</a>
      <a href="https://rateyourmusic.com/search?searchterm=${enc(q)}&searchtype=${r.type === 'track' ? 'z' : 'l'}" target="_blank" rel="noopener">RYM</a></nav>`;
  }
  function filmLinks(r) {
    const q = `${r.title || r.title_ko} ${r.year || ''}`.trim();
    return `<nav class="outlinks" aria-label="찾아 보기">
      <a href="https://letterboxd.com/search/films/${enc(q)}/" target="_blank" rel="noopener">Letterboxd</a>
      <a href="https://www.imdb.com/find/?q=${enc(q)}&s=tt" target="_blank" rel="noopener">IMDb</a>
      <a href="https://pedia.watcha.com/ko-KR/search?query=${enc(r.title_ko || r.title)}" target="_blank" rel="noopener">왓챠피디아</a>
      ${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${r.link.includes('themoviedb') ? 'TMDB' : '위키백과'}</a>` : ''}</nav>`;
  }
  function personLinks(p) {
    return `<nav class="outlinks" aria-label="찾아 보기">
      <a href="https://letterboxd.com/search/cast-crew/${enc(p.name)}/" target="_blank" rel="noopener">Letterboxd</a>
      <a href="https://www.imdb.com/find/?q=${enc(p.name)}&s=nm" target="_blank" rel="noopener">IMDb</a>
      <a href="https://pedia.watcha.com/ko-KR/search?query=${enc(p.name_ko || p.name)}" target="_blank" rel="noopener">왓챠피디아</a></nav>`;
  }
  function fbButtons(mode, r, sample) {
    if (sample) return '';
    const v = state[mode].feedback[recKey(mode, r)];
    return `<div class="fb" data-key="${esc(recKey(mode, r))}"><button type="button" class="up" aria-pressed="${v === 'up'}">취향 맞음</button><button type="button" class="down" aria-pressed="${v === 'down'}">아님</button></div>`;
  }
  const axisHTML = r => (r.axis && (r.axis.axis || r.axis.detail) ? `<p class="axis"><b>${esc(r.axis.axis)}</b>${esc(r.axis.detail)}</p>` : '');
  function coverBlock(r, opt) {
    const v = r.checked === true ? `<span class="pill v-ok">${state.mode === 'film' ? (tmdbOn ? 'TMDB 확인' : '확인됨') : 'Apple Music 확인'}</span>` : (r.checked === false ? '<span class="pill v-miss">카탈로그에 없음</span>' : '<span></span>');
    return `<div class="cover">${artHTML(r, r.checked === undefined && !opt.sample ? 'loading' : '')}
      <div class="flags">${opt.sample ? '<span class="sample-flag">예시</span>' : v}${r.match ? `<span class="pill match">match score ${esc(r.match)}</span>` : ''}</div></div>`;
  }
  function musicCard(r, opt = {}) {
    const el = document.createElement('article');
    el.className = 'card music' + (state.music.feedback[recKey('music', r)] === 'down' ? ' disliked' : '') + (opt.fresh ? ' fresh' : '');
    const extra = r.type !== 'track' && r.start_with ? `<p class="start">먼저 들어볼 곡 <b>${esc(r.start_with)}</b></p>` : (r.type === 'track' && r.album ? `<p class="start">수록 앨범 <b>${esc(r.album)}</b></p>` : '');
    el.innerHTML = `${coverBlock(r, opt)}
      <div class="card-body">
        <div class="titles"><h4>${esc(r.title)}</h4><p class="l2">${esc(r.artist)}</p><p class="l3">${esc(r.year || '')} <small>· ${KIND_LBL[r.type] || 'Album'}</small></p></div>
        ${arr(r.primary).length ? `<p class="genre">${arr(r.primary).map(esc).join(' · ')}</p>` : ''}
        <p class="why">${esc(r.why)}</p>
        ${axisHTML(r)}${extra}
        <div class="card-foot">${musicLinks(r)}${fbButtons('music', r, opt.sample)}</div>
      </div>`;
    return el;
  }
  function filmCard(r, opt = {}) {
    const el = document.createElement('article');
    el.className = 'card film' + (state.film.feedback[recKey('film', r)] === 'down' ? ' disliked' : '') + (opt.fresh ? ' fresh' : '');
    const orig = r.title && r.title !== r.title_ko ? ` <small>· ${esc(r.title)}</small>` : '';
    el.innerHTML = `${coverBlock(r, opt)}
      <div class="card-body">
        <div class="titles"><h4>${esc(r.title_ko || r.title)}</h4><p class="l2">감독 ${esc(r.director)}</p><p class="l3">${esc(r.year || '')}${orig}</p></div>
        <p class="why">${esc(r.why)}</p>
        ${axisHTML(r)}
        <div class="card-foot">${filmLinks(r)}${fbButtons('film', r, opt.sample)}</div>
      </div>`;
    return el;
  }
  function personCard(p) {
    const el = document.createElement('article'); el.className = 'card film person';
    const sw = arr(p.start_with).map(f => `${f.title}${f.year ? ' (' + f.year + ')' : ''}`);
    el.innerHTML = `<div class="card-body">
      <div class="titles"><p class="genre">${esc(p.role)}</p><h4>${esc(p.name_ko || p.name)}</h4>${p.name_ko && p.name && p.name_ko !== p.name ? `<p class="l3">${esc(p.name)}</p>` : ''}</div>
      <p class="why">${esc(p.why)}</p>
      ${sw.length ? `<p class="start">입문작 <b>${sw.map(esc).join(', ')}</b></p>` : ''}
      <div class="card-foot">${personLinks(p)}</div></div>`;
    return el;
  }
  function profileBlock(mode, p) {
    const el = document.createElement('section'); el.className = 'profile';
    const chips = arr(p.keywords).length ? `<ul class="chips big">${arr(p.keywords).map(d => `<li class="tag">${esc(d)}</li>`).join('')}</ul>` : '';
    if (mode === 'music') {
      const g = arr(p.genres).slice(0, 5);
      el.innerHTML = `<p class="eyebrow" style="margin:0">당신의 취향 · listening profile</p><p class="summary">${esc(p.summary)}</p>
        <div class="prof-grid">${g.length ? `<ul class="gbars">${g.map(x => `<li><span>${esc(x.name)}</span><span class="bar"><i style="width:${Math.max(4, Math.min(100, +x.weight || 0))}%"></i></span></li>`).join('')}</ul>` : ''}${chips}</div>`;
    } else {
      const ppl = arr(p.people).slice(0, 4);
      el.innerHTML = `<p class="eyebrow" style="margin:0">당신의 취향 · viewing profile</p><p class="summary">${esc(p.summary)}</p>
        <div class="prof-grid">${ppl.length ? `<ul class="people">${ppl.map(x => `<li><span>${esc(x.role)}</span><b>${esc(x.name)}</b></li>`).join('')}</ul>` : ''}${chips}</div>`;
    }
    return el;
  }
  function section(mode, kind, title) {
    const s = document.createElement('section'); s.style.cssText = 'display:grid;gap:16px'; s.id = mode + '-' + kind + '-sec';
    const tools = kind === 'recs' ? `<div class="sec-tools"><button class="btn btn-ghost" type="button" data-copy="list">목록 복사</button><button class="btn btn-ghost" type="button" data-copy="full">이유까지 복사</button></div>` : '';
    s.innerHTML = `<div class="sec-head"><h3>${title}</h3>${tools}</div><div class="cards" id="${mode}-${kind}"></div>`;
    return s;
  }
  function renderResults(mode) {
    const R = state[mode].results, root = $('#' + mode + '-results');
    root.innerHTML = '<div class="status" id="' + mode + '-status"></div>';
    if (!R.profile && !R.recs.length) { root.append(emptyState(mode)); return; }
    if (R.profile) root.append(profileBlock(mode, R.profile));
    root.append(section(mode, 'recs', mode === 'music' ? '추천 음악' : '추천 영화'));
    R.recs.forEach(r => $('#' + mode + '-recs').append(mode === 'music' ? musicCard(r) : filmCard(r)));
    if (mode === 'film' && R.people.length) { root.append(section('film', 'people', '따라가 볼 영화인')); R.people.forEach(p => $('#film-people').append(personCard(p))); }
    const more = document.createElement('div'); more.className = 'more-bar';
    more.innerHTML = `<button class="btn" type="button" data-more ${busy[mode] ? 'disabled' : ''}>표시한 피드백을 반영해 더 추천받기</button><button class="btn btn-ghost" type="button" data-reset>결과 지우기</button>`;
    root.append(more);
  }
  function emptyState(mode) {
    const el = document.createElement('div'); el.className = 'empty';
    const info = document.createElement('div'); info.style.cssText = 'display:grid;gap:10px';
    info.innerHTML = `<h3>분석 결과는 여기에 나타납니다</h3><p class="empty-p">${mode === 'music' ? '취향 요약과 함께, 큰 커버 아래에 제목 · 아티스트 · 발매연도와 추천 이유를 보여 드립니다.' : '취향 요약과 함께, 큰 포스터 아래에 제목 · 감독 · 개봉연도와 추천 이유를 보여 드립니다.'}</p>`;
    el.append(info, mode === 'music'
      ? musicCard({ type: 'album', title: 'Tender Buttons', artist: 'Broadcast', year: 2005, primary: ['Indietronica', 'Dream Pop'], axis: { axis: '장르', detail: 'Dummy와 같은 빈티지한 질감' }, why: 'Dummy처럼 바랜 듯한 질감 위에 담담한 여성 보컬이 흐릅니다. 반복되는 신스가 만드는 최면적인 분위기가 Mezzanine과 닮았습니다.', start_with: "America's Boy", match: 91 }, { sample: true })
      : filmCard({ title_ko: '밀레니엄 맘보', title: 'Millennium Mambo', year: 2001, director: '허우샤오시엔', axis: { axis: '촬영감독', detail: '리핑빈 — 화양연화 공동 촬영' }, why: '화양연화의 빛과 색을 함께 만든 리핑빈이 촬영했습니다. 네온 속을 천천히 떠도는 카메라가 줄거리보다 감정의 온도를 먼저 전합니다.', match: 89 }, { sample: true }));
    return el;
  }
  function setStatus(mode, msg, loading) {
    const st = $('#' + mode + '-status'); if (!st) return;
    st.innerHTML = `<span class="msg">${esc(msg)}</span>${loading ? '<span class="loadbar" aria-hidden="true"></span>' : ''}`;
  }
  function setBusy(mode, b) {
    busy[mode] = b;
    document.body.dataset.busy = (busy.music || busy.film) ? '1' : '0';
    $('#' + mode + '-go').disabled = b || state[mode].items.length < MIN[mode];
    $('#' + mode + '-go').textContent = b ? '분석하고 있습니다…' : '취향 분석하고 추천받기';
  }

  async function enrichRecs(mode, recs) {
    for (const r of recs) {
      if (r.checked !== undefined) continue;
      let m = null;
      try {
        m = mode === 'music' ? await schedule(() => lookupMusic(r)) : await lookupFilm({ title_ko: r.title_ko, orig: r.title, title: r.title_ko || r.title, year: r.year });
      } catch (e) { m = null; }
      if (m) {
        r.cover = mode === 'music' ? m.cover : m.poster; r.link = m.link || r.link;
        if (m.year && /^\d{4}$/.test(m.year) && mode === 'music') r.year = m.year;
        r.checked = mode === 'music' || tmdbOn ? true : undefined;
        if (mode === 'film' && !tmdbOn) r.checked = null;
      } else r.checked = mode === 'music' || tmdbOn ? false : null;
      save();
      if (state.mode === mode || true) {
        const idx = state[mode].results.recs.indexOf(r);
        const cards = $$('#' + mode + '-recs .card');
        if (cards[idx]) cards[idx].replaceWith(mode === 'music' ? musicCard(r) : filmCard(r));
      }
    }
  }

  async function run(mode, more) {
    if (busy[mode]) return;
    const s = state[mode];
    if (s.items.length < MIN[mode]) return;
    if (!more) { s.results = emptyRes(); s.feedback = {}; }
    setBusy(mode, true);
    renderResults(mode);
    $('#' + mode + '-results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    setStatus(mode, mode === 'music' ? '목록을 분석하고 있습니다. 보통 15~40초가 걸립니다.' : '크레딧을 대조하고 있습니다. 보통 15~40초가 걸립니다.', true);
    const fb = s.feedback;
    const body = {
      mode,
      items: s.items.map(it => ({ type: it.type, artist: it.artist, title: it.title, year: it.year, rating: it.rating, why: it.why })),
      opts: collectOpts(mode),
      more: more ? {
        prev: s.results.recs.map(r => recLabel(mode, r)),
        up: s.results.recs.filter(r => fb[recKey(mode, r)] === 'up').map(r => recLabel(mode, r)),
        down: s.results.recs.filter(r => fb[recKey(mode, r)] === 'down').map(r => recLabel(mode, r)),
      } : null,
    };
    try {
      const d = await api('/api/recommend', { method: 'POST', body });
      const seen = new Set(s.results.recs.map(r => recKey(mode, r)));
      const fresh = d.recs.filter(r => { const k = recKey(mode, r); if (seen.has(k)) return false; seen.add(k); return true; });
      if (!more && d.profile) s.results.profile = d.profile;
      s.results.recs.push(...fresh);
      if (mode === 'film') s.results.people.push(...arr(d.people));
      save(); setBusy(mode, false); renderResults(mode);
      setStatus(mode, `${fresh.length}개를 추천했습니다. 커버를 불러오며 실제 발매 정보를 확인합니다.`, false);
      await enrichRecs(mode, fresh);
      setStatus(mode, `${fresh.length}개를 추천했습니다. 마음에 드는 작품에 “취향 맞음”을 누르면 다음 추천에 반영되고${auth ? ' 커뮤니티에도 공유됩니다.' : ', 로그인하면 커뮤니티에 공유됩니다.'}`, false);
    } catch (e) {
      setBusy(mode, false); renderResults(mode);
      setStatus(mode, e.message || '추천을 받지 못했습니다. 다시 시도해 주세요.', false);
    }
  }

  function buildCopy(mode, full) {
    const R = state[mode].results, fb = state[mode].feedback;
    const L = [`JUKEBOX · ${mode === 'music' ? '음악' : '영화'} 추천`, ''];
    R.recs.filter(r => fb[recKey(mode, r)] !== 'down').forEach((r, i) => {
      L.push(mode === 'music' ? `${i + 1}. ${r.title} / ${r.artist} / ${r.year || ''}` : `${i + 1}. ${r.title_ko || r.title}${r.title && r.title !== r.title_ko ? ' (' + r.title + ')' : ''} / 감독 ${r.director || ''} / ${r.year || ''}`);
      if (full && r.why) L.push('   ' + r.why);
    });
    return L.join('\n');
  }
  function copyText(mode, text) {
    const fallback = () => {
      let box = $('#' + mode + '-copybox');
      if (!box) { box = document.createElement('div'); box.className = 'copybox panel'; box.id = mode + '-copybox'; $('#' + mode + '-results').append(box); }
      box.innerHTML = `<p class="hint">자동 복사가 막혀 있습니다. 아래 텍스트를 선택해 복사해 주세요.</p><textarea readonly></textarea>`;
      const ta = $('textarea', box); ta.value = text; ta.focus(); ta.select();
    };
    try { navigator.clipboard.writeText(text).then(() => toast('복사했습니다'), fallback); } catch (e) { fallback(); }
  }
  function foundPayload(mode, r) {
    return mode === 'music'
      ? { title: r.title, artist: r.artist, year: r.year, type: r.type, cover: r.cover, link: r.link }
      : { title: r.title_ko || r.title, artist: r.director || '', year: r.year, type: 'film', cover: r.cover, link: r.link };
  }
  ['music', 'film'].forEach(mode => {
    $('#' + mode + '-go').addEventListener('click', () => run(mode, false));
    $('#' + mode + '-results').addEventListener('click', async e => {
      if (e.target.closest('[data-more]')) { run(mode, true); return; }
      const cp = e.target.closest('[data-copy]'); if (cp) { copyText(mode, buildCopy(mode, cp.dataset.copy === 'full')); return; }
      if (e.target.closest('[data-reset]')) { state[mode].results = emptyRes(); state[mode].feedback = {}; save(); renderResults(mode); return; }
      const fbBtn = e.target.closest('.fb button'); if (!fbBtn) return;
      const key = fbBtn.parentElement.dataset.key, dir = fbBtn.classList.contains('up') ? 'up' : 'down';
      const fb = state[mode].feedback, before = fb[key];
      if (fb[key] === dir) delete fb[key]; else fb[key] = dir;
      $$('button', fbBtn.parentElement).forEach(b => b.setAttribute('aria-pressed', String(fb[key] === (b.classList.contains('up') ? 'up' : 'down'))));
      fbBtn.closest('.card').classList.toggle('disliked', fb[key] === 'down');
      save();
      const r = state[mode].results.recs.find(x => recKey(mode, x) === key);
      if (auth && r) {
        const p = foundPayload(mode, r);
        try {
          if (fb[key] === 'up') { await api('/api/found', { method: 'POST', body: { kind: mode, item: p } }); toast('커뮤니티에 “찾은 작품”으로 공유했습니다'); }
          else if (before === 'up') await api('/api/found', { method: 'DELETE', body: { kind: mode, title: p.title, artist: p.artist } });
          if (rail.tab === 'feed') loadFeed();
        } catch (er) { toast(er.message); }
      }
    });
  });

  /* ---------------- community rail ---------------- */
  const rail = { tab: 'feed', nick: null, kind: null, data: null, q: '' };
  function renderAcct() {
    const box = $('#acct');
    if (auth) {
      box.innerHTML = `<div class="me">${avatar(auth.nickname)}<div class="who"><b>${esc(auth.nickname)}</b><span>내 목록이 커뮤니티에 공유됩니다</span></div>
        <div class="btns"><button class="btn btn-sm" type="button" data-myprof>내 프로필</button><button class="btn btn-ghost btn-sm" type="button" data-logout>로그아웃</button></div></div>`;
    } else {
      box.innerHTML = `<h3>커뮤니티 입장</h3>
        <form id="login-form" autocomplete="off">
          <input type="text" id="login-nick" placeholder="닉네임 (2~12자)" maxlength="12" aria-label="닉네임">
          <div class="pin-row"><input class="pin" type="password" id="login-pin" placeholder="••••" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" aria-label="숫자 4자리 코드"><button class="btn btn-primary" type="submit">입장</button></div>
          <p class="err" id="login-err" hidden></p>
          <p class="hint">처음 쓰는 닉네임이면 새로 만들어집니다. 코드는 잊으면 찾을 수 없으니 꼭 기억해 주세요.</p>
        </form>`;
      $('#login-form').addEventListener('submit', async e => {
        e.preventDefault();
        const nickname = $('#login-nick').value.trim(), pin = $('#login-pin').value.trim(), err = $('#login-err');
        err.hidden = true;
        if (!/^[0-9A-Za-z가-힣_]{2,12}$/.test(nickname)) { err.textContent = '닉네임은 한글·영문·숫자·밑줄로 2~12자여야 합니다.'; err.hidden = false; return; }
        if (!/^\d{4}$/.test(pin)) { err.textContent = '코드는 숫자 4자리여야 합니다.'; err.hidden = false; return; }
        try {
          const d = await api('/api/login', { method: 'POST', body: { nickname, pin } });
          auth = { token: d.token, nickname: d.user.nickname }; saveAuth();
          toast(d.created ? `${d.user.nickname}님, 환영합니다. 새 계정을 만들었습니다` : `${d.user.nickname}님, 다시 오신 것을 환영합니다`);
          renderAcct(); await pullMyLists(); loadRail();
        } catch (er) { err.textContent = er.message; err.hidden = false; }
      });
    }
  }
  $('#acct').addEventListener('click', async e => {
    if (e.target.closest('[data-logout]')) {
      try { await api('/api/logout', { method: 'POST' }); } catch (er) { /* ignore */ }
      auth = null; saveAuth(); renderAcct(); toast('로그아웃했습니다'); loadRail(); return;
    }
    if (e.target.closest('[data-myprof]') && auth) openProfile(auth.nickname);
  });
  $$('.rail-tabs button').forEach(b => b.addEventListener('click', () => { rail.tab = b.dataset.rail; rail.nick = null; loadRail(); }));
  function paintTabs() { $$('.rail-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rail === rail.tab))); }
  function loadRail() { paintTabs(); if (rail.tab === 'feed') loadFeed(); else if (rail.tab === 'people') loadPeople(); else renderProfile(); }
  const railBody = () => $('#rail-body');
  function railError(msg) { railBody().innerHTML = `<p class="rail-empty">${esc(msg)}</p>`; }
  function miniCover(mode, it, cls) { return `<span class="${cls}">${artHTML({ cover: it.cover, title: it.title, artist: it.artist })}</span>`; }

  async function loadFeed() {
    if (rail.tab !== 'feed') return;
    const mode = state.mode;
    if (!railBody().querySelector('.feed')) railBody().innerHTML = '<p class="rail-empty">불러오고 있습니다…</p>';
    try {
      const d = await api('/api/feed?kind=' + mode);
      if (rail.tab !== 'feed' || state.mode !== mode) return;
      // group bursts: same person, same action, within 10 minutes
      const groups = [];
      for (const it of d.items) {
        const g = groups[groups.length - 1];
        if (g && g.nickname === it.nickname && g.source === it.source && g.last - it.created_at < 600000) { g.items.push(it); g.last = it.created_at; }
        else groups.push({ nickname: it.nickname, source: it.source, at: it.created_at, last: it.created_at, items: [it] });
      }
      railBody()._items = d.items;
      const word = mode === 'music' ? '음악' : '영화';
      railBody().innerHTML = `<div class="rail-sub"><span>사람들이 담은 ${word}</span><button class="btn btn-ghost btn-sm" type="button" data-refresh>새로고침</button></div>` +
        (groups.length ? `<ul class="feed">${groups.map(g => {
          const head = `<div class="fi-top">${avatar(g.nickname, 'sm')}<button class="nick" type="button" data-user="${esc(g.nickname)}">${esc(g.nickname)}</button><span class="act">${g.source === 'found' ? '추천에서 찾음' : (g.items.length > 1 ? word + ' ' + g.items.length + '개를 담음' : '좋아함')}</span><time>${timeAgo(g.at)}</time></div>`;
          if (g.items.length === 1) {
            const it = g.items[0], i = d.items.indexOf(it);
            return `<li class="fi">${head}<div class="fi-body ${mode}">${miniCover(mode, it, 'fi-cover')}<div class="fi-t"><b>${esc(it.title)}</b><span>${esc(mode === 'music' ? it.artist + ' · ' + (KIND_LBL[it.type] || 'Album') : [it.year, it.artist].filter(Boolean).join(' · '))}</span></div><button class="btn btn-sm" type="button" data-take="${i}">담기</button></div></li>`;
          }
          const shown = g.items.slice(0, 4);
          return `<li class="fi">${head}<div class="fi-strip ${mode}">${shown.map(it => miniCover(mode, it, 'fi-cover')).join('')}${g.items.length > 4 ? `<span class="fi-more">+${g.items.length - 4}</span>` : ''}</div><p class="hint" style="margin:0">${shown.map(it => esc(it.title)).join(', ')}${g.items.length > 4 ? ' 외' : ''}</p></li>`;
        }).join('')}</ul>`
          : '<p class="rail-empty">아직 공유된 작품이 없습니다. 로그인하고 목록을 채우면 가장 먼저 소개됩니다.</p>');
    } catch (e) { railError(e.status === 0 || e.status === 404 ? '커뮤니티 서버에 연결할 수 없습니다.' : e.message); }
  }
  async function loadPeople() {
    railBody().innerHTML = `<input type="search" id="people-q" placeholder="닉네임 검색" value="${esc(rail.q)}" aria-label="닉네임 검색"><ul class="people-list" id="people-list"><li class="rail-empty">불러오고 있습니다…</li></ul>`;
    const q = $('#people-q'); let t;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { rail.q = q.value.trim(); fillPeople(); }, 300); });
    fillPeople();
  }
  async function fillPeople() {
    try {
      const d = await api('/api/users' + (rail.q ? '?q=' + enc(rail.q) : ''));
      const ul = $('#people-list'); if (!ul) return;
      ul.innerHTML = d.users.length ? d.users.map(u => `<li><button class="pl" type="button" data-user="${esc(u.nickname)}">${avatar(u.nickname)}<span class="who"><b>${esc(u.nickname)}</b><span>음악 ${u.music} · 영화 ${u.film} · ${timeAgo(u.last)}</span></span></button></li>`).join('')
        : '<li class="rail-empty">찾는 사람이 없습니다.</li>';
    } catch (e) { const ul = $('#people-list'); if (ul) ul.innerHTML = `<li class="rail-empty">${esc(e.status === 0 || e.status === 404 ? '커뮤니티 서버에 연결할 수 없습니다.' : e.message)}</li>`; }
  }
  async function openProfile(nick) {
    rail.tab = 'profile'; rail.nick = nick; rail.kind = state.mode; rail.data = null; paintTabs();
    railBody().innerHTML = '<p class="rail-empty">불러오고 있습니다…</p>';
    try { rail.data = await api('/api/users/' + enc(nick)); renderProfile(); }
    catch (e) { railError(e.message); }
  }
  function renderProfile() {
    const d = rail.data; if (!d) return;
    const kind = rail.kind || state.mode;
    const favs = d.items.filter(x => x.kind === kind && x.source === 'fav');
    const found = d.items.filter(x => x.kind === kind && x.source === 'found');
    const gi = (list, tag) => list.length ? `<div class="grid3">${list.map((it, i) => `<div class="gi ${kind}"><div class="gi-cover">${artHTML({ cover: it.cover, title: it.title, artist: it.artist })}<button class="btn btn-sm take" type="button" data-ptake="${tag}:${i}">담기</button></div><b title="${esc(it.title)}">${esc(it.title)}</b><span>${esc(kind === 'music' ? it.artist : it.year)}</span></div>`).join('')}</div>` : '<p class="rail-empty">아직 없습니다.</p>';
    const own = auth && auth.nickname.toLowerCase() === d.user.nickname.toLowerCase();
    railBody().innerHTML = `
      <button class="btn btn-ghost btn-sm" type="button" data-back style="justify-self:start">← 새 소식으로</button>
      <div class="prof-head">${avatar(d.user.nickname, 'lg')}<div><h3>${esc(d.user.nickname)}</h3><span>${timeAgo(d.user.created_at)} 가입</span></div></div>
      <div class="rail-tabs" role="group" aria-label="분야"><button type="button" data-pkind="music" aria-pressed="${kind === 'music'}">음악</button><button type="button" data-pkind="film" aria-pressed="${kind === 'film'}">영화</button></div>
      <div class="prof-sec"><h4>좋아하는 ${kind === 'music' ? '음악' : '영화'} <small>${favs.length}</small></h4>${gi(favs, 'f')}</div>
      <div class="prof-sec"><h4>추천에서 찾은 ${kind === 'music' ? '음악' : '영화'} <small>${found.length}</small></h4>${gi(found, 'n')}</div>
      <div class="prof-sec"><h4>방명록 <small>${d.messages.length}</small></h4>
        ${auth ? `<form class="msg-form" id="msg-form"><input type="text" id="msg-body" maxlength="200" placeholder="${own ? '내 방명록에 한마디' : esc(d.user.nickname) + '님께 한마디'}" aria-label="방명록 내용"><button class="btn btn-sm btn-primary" type="submit">남기기</button></form>` : '<p class="hint">로그인하면 방명록을 남길 수 있습니다.</p>'}
        ${d.messages.length ? `<ul class="msgs">${d.messages.map(m => `<li class="msg"><div class="msg-top"><b>${esc(m.from_nickname)}</b><span>${timeAgo(m.created_at)}</span>${auth && (own || auth.nickname.toLowerCase() === m.from_nickname.toLowerCase()) ? `<button class="del" type="button" data-delmsg="${m.id}">지우기</button>` : ''}</div><p>${esc(m.body)}</p></li>`).join('')}</ul>` : ''}
      </div>`;
    railBody()._fav = favs; railBody()._found = found;
    const f = $('#msg-form');
    if (f) f.addEventListener('submit', async e => {
      e.preventDefault();
      const body = $('#msg-body').value.trim(); if (!body) return;
      try { const r = await api('/api/users/' + enc(d.user.nickname) + '/messages', { method: 'POST', body: { body } }); d.messages.unshift(r.message); renderProfile(); }
      catch (er) { toast(er.message); }
    });
  }
  function takeItem(kind, it) {
    const mine = kind === 'music'
      ? { type: it.type === 'track' ? 'track' : 'album', artist: it.artist, title: it.title, year: it.year, cover: it.cover, link: it.link, looked: !!it.cover }
      : { title: it.title, orig: '', year: it.year, cover: it.cover, link: it.link, looked: !!it.cover, why: '' };
    if (addItems(kind, [mine], true)) toast(`“${it.title}”을(를) 내 목록에 담았습니다`);
    else toast('이미 내 목록에 있습니다');
    if (state.mode !== kind) location.hash = kind;
  }
  railBody().addEventListener('click', async e => {
    const u = e.target.closest('[data-user]'); if (u) { openProfile(u.dataset.user); return; }
    if (e.target.closest('[data-refresh]')) { loadFeed(); return; }
    if (e.target.closest('[data-back]')) { rail.tab = 'feed'; rail.nick = null; loadRail(); return; }
    const pk = e.target.closest('[data-pkind]'); if (pk) { rail.kind = pk.dataset.pkind; renderProfile(); return; }
    const tk = e.target.closest('[data-take]'); if (tk) { const it = railBody()._items[+tk.dataset.take]; if (it) takeItem(state.mode, it); return; }
    const pt = e.target.closest('[data-ptake]');
    if (pt) { const [tag, i] = pt.dataset.ptake.split(':'); const it = (tag === 'f' ? railBody()._fav : railBody()._found)[+i]; if (it) takeItem(rail.kind || state.mode, it); return; }
    const dm = e.target.closest('[data-delmsg]');
    if (dm) {
      try { await api('/api/messages/' + dm.dataset.delmsg, { method: 'DELETE' }); rail.data.messages = rail.data.messages.filter(m => String(m.id) !== dm.dataset.delmsg); renderProfile(); }
      catch (er) { toast(er.message); }
    }
  });
  setInterval(() => { if (document.visibilityState === 'visible' && rail.tab === 'feed') loadFeed(); }, 90000);

  // mobile drawer
  const setSide = open => { document.body.classList.toggle('side-open', open); $('#side-toggle').setAttribute('aria-expanded', String(open)); };
  $('#side-toggle').addEventListener('click', () => setSide(!document.body.classList.contains('side-open')));
  $('#scrim').addEventListener('click', () => setSide(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setSide(false); });

  /* ---------------- boot ---------------- */
  renderList('music'); renderList('film');
  renderResults('music'); renderResults('film');
  setMode(location.hash ? location.hash.slice(1) : state.mode);
  renderAcct();
  loadRail();
  if (auth) api('/api/me').then(d => { if (!d.user) { auth = null; saveAuth(); renderAcct(); } else pullMyLists(); }).catch(() => {});
  queueItemCovers('music'); queueItemCovers('film');
  ['music', 'film'].forEach(mode => { const pend = state[mode].results.recs.filter(r => r.checked === undefined); if (pend.length) enrichRecs(mode, pend); });
})();
