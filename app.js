// 대드론 학습 — 잠금 해제 → 홈(검색·진도·목차) · 핵심 노트 · 용어집 · 보관함. 내용은 data.enc.json(AES-GCM)에만 있다.
(() => {
  const KEY = "cd_study_key";
  const $ = s => document.querySelector(s);
  const app = $("#app");
  let D = null, IDX = [], BIP = null, CT = "", RAW = null;
  const fetchEnc = async () => (await fetch("data.enc.json?t=" + Date.now(), {cache: "no-store"})).json();  // 서버·CDN 캐시를 건너뛰고 최신 판
  // ---- 화면 모드: 자동(폰 설정) → 라이트 → 다크 순환 · 기기에 기억
  const TH = ["auto", "light", "dark"], THL = {auto: "◐ 자동", light: "☀ 라이트", dark: "☾ 다크"};
  const getTh = () => { try { return localStorage.getItem("cd_theme") || "auto"; } catch (e) { return "auto"; } };
  function setTh(t) {
    try { t === "auto" ? localStorage.removeItem("cd_theme") : localStorage.setItem("cd_theme", t); } catch (e) {}
    t === "auto" ? document.documentElement.removeAttribute("data-theme") : document.documentElement.setAttribute("data-theme", t);
    document.querySelectorAll(".tbtn").forEach(b => { b.textContent = THL[t]; b.setAttribute("aria-label", "화면 모드: " + THL[t].slice(2)); });
    const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", dark ? "#10151d" : "#f7f9fc");
  }
  const tbtn = () => `<button class="tbtn" type="button" data-th aria-label="화면 모드">${THL[getTh()]}</button>`;
  document.addEventListener("click", e => { if (e.target.closest("#updtop")) applyUpd(); });
  document.addEventListener("click", e => { if (e.target.closest("[data-th]")) { const c = getTh(); setTh(TH[(TH.indexOf(c) + 1) % 3]); } });
  // ---- 설치(안드로이드 크롬 등): 브라우저가 설치 가능하다고 알려 주면 홈에 '설치' 버튼
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // ---- 설치 팝업: 맨 위 한쪽에 작게 · 닫으면 14일간 안 뜸 · 설치된 앱 안에서는 안 뜸
  const DISMISS = "cd_inst_dismiss";
  const dismissed = () => { try { return Date.now() < +(localStorage.getItem(DISMISS) || 0); } catch (e) { return false; } };
  function showInstall() {
    if (!BIP || standalone() || dismissed() || document.getElementById("inst")) return;
    const el = document.createElement("div"); el.id = "inst"; el.className = "instpop"; el.setAttribute("role", "dialog");
    el.innerHTML = `<span>📲 앱으로 설치할까요?</span><button type="button" class="go">설치</button><button type="button" class="no" aria-label="닫기">×</button>`;
    document.body.appendChild(el);
    el.querySelector(".go").onclick = async () => { const b = BIP; hideInstall(); if (!b) return; b.prompt(); try { await b.userChoice; } catch (e) {} BIP = null; };
    el.querySelector(".no").onclick = () => { try { localStorage.setItem(DISMISS, Date.now() + 14 * 864e5); } catch (e) {} hideInstall(); };
  }
  const hideInstall = () => { const el = document.getElementById("inst"); if (el) el.remove(); };
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); BIP = e; if (window.__cdReady) showInstall(); });
  window.addEventListener("appinstalled", () => { BIP = null; hideInstall(); });

  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const ub64 = a => btoa(String.fromCharCode(...new Uint8Array(a)));
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} },
    del() { try { localStorage.removeItem(KEY); } catch (e) {} }
  };
  async function deriveRaw(pw, enc) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({name: "PBKDF2", hash: "SHA-256", salt: b64(enc.salt), iterations: enc.iter}, base, 256);
  }
  async function decrypt(raw, enc) {
    const k = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({name: "AES-GCM", iv: b64(enc.iv)}, k, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async function boot() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    let enc;
    try { enc = await fetchEnc(); }
    catch (e) { app.innerHTML = '<div class="boot">자료를 불러오지 못했습니다. 연결을 확인해 주세요.</div>'; return; }
    const saved = store.get();
    if (saved) {
      const [salt, k] = saved.split(".");
      if (salt === enc.salt) { try { RAW = b64(k); D = await decrypt(RAW, enc); CT = enc.ct; await loadAdmin(); return start(); } catch (e) {} }
      store.del();  // 비밀번호가 바뀌면 저장 열쇠 무효
    }
    lock(enc);
  }
  function lock(enc) {
    app.innerHTML = `<div class="lock"><form id="lf">
      <img src="icon-192.png" alt=""><h1>대드론 학습 노트</h1><p>비밀번호를 한 번 입력하면 이 기기가 기억합니다.</p>
      <input id="pw" type="password" autocomplete="current-password" placeholder="비밀번호" aria-label="비밀번호">
      <div class="err" id="er"></div><button>열기</button></form>${tbtn()}</div>`;
    $("#lf").onsubmit = async ev => {
      ev.preventDefault(); $("#er").textContent = "여는 중…";
      try {
        const raw = await deriveRaw($("#pw").value, enc);
        D = await decrypt(raw, enc); RAW = raw; CT = enc.ct;
        store.set(enc.salt + "." + ub64(raw)); await loadAdmin(); start();
      } catch (e) { $("#er").textContent = "비밀번호가 맞지 않습니다."; }
    };
    $("#pw").focus();
  }

  // ------------------------------------------------------------ 검색
  const norm = s => (s || "").toLowerCase().replace(/[·\-‐–—_/()\[\]「」"'`]/g, " ").replace(/\s+/g, " ").trim();
  const escH = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  function buildIndex() {
    IDX = [];
    for (const [pid, pg] of Object.entries(D.pages))
      for (const s of pg.secs) IDX.push({pid, sid: s.id, arc: !!pg.archive, pt: pg.title, st: s.title, raw: s.title + " " + s.text, n: norm(s.title + " " + s.text)});
    for (const t of D.topics) if (!t.has_note && !t.has_rec)
      IDX.push({pid: "", sid: "", arc: false, pt: t.part.replace(/^(\d)\s*/, "$1부 "), st: `${t.code} ${t.title} (예정)`, raw: t.title + " " + t.point, n: norm(t.code + " " + t.title + " " + t.point)});
  }
  function search(q) {
    const terms = norm(q).split(" ").filter(Boolean);
    if (!terms.length) return [];
    const qn = terms.join(" ");
    const sc = e => (norm(e.st).startsWith(qn) ? 4 : 0) + (norm(e.st).includes(qn) ? 2 : 0) + (e.pid === "glossary" ? 1 : 0) + (e.arc ? -3 : 0);
    return IDX.filter(e => terms.every(t => e.n.includes(t))).sort((a, b) => sc(b) - sc(a)).slice(0, 40);
  }
  function snippet(raw, q) {
    const t = raw.replace(/\s+/g, " ");
    const ws = norm(q).split(" ").filter(Boolean);
    let i = t.toLowerCase().indexOf(ws[0]); if (i < 0) i = 0;
    const s = Math.max(0, i - 30);
    let h = escH(t.slice(s, s + 110));
    for (const w of ws) h = h.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), m => `<span class="hl">${m}</span>`);
    return (s > 0 ? "… " : "") + h + " …";
  }

  // ------------------------------------------------------------ 공통 틀
  // 하단 메뉴 = 홈 · 용어집 · (관리자 모드에서 켠 것: 이력 · 보관함 · 문제) · ⚙ 설정
  const nav = on => {
    const items = [["home", "#/", "⌂", "홈"], ["glossary", "#/p/glossary", "가", "용어집"]];
    if (on3("history")) items.push(["history", "#/p/history", "◷", "이력"]);
    if (on3("archive")) items.push(["archive", "#/archive", "▤", "보관함"]);
    if (on3("quiz")) items.push(["quiz", "#/quiz", "✎", "문제"]);
    items.push(["settings", "#/settings", "⚙", "설정"]);
    return `<nav class="nav" aria-label="주요 메뉴" style="grid-template-columns:repeat(${items.length},1fr)">${items.map(([k, h, i, t]) => `<a href="${h}" class="${k === on ? "on" : ""}"><i>${i}</i>${t}</a>`).join("")}</nav>`;
  };
  const bar = (title, back) => `<header class="top"><div class="in">${back ? `<a class="back" href="${back}" aria-label="뒤로">‹</a><div class="t">${escH(title)}</div>` : `<div class="brand">대드론 학습 노트</div>`}</div></header>`;

  // ------------------------------------------------------------ 관리자 모드 (26.10.03)
  // 관리자 묶음(data.admin.enc.json)은 관리자 비밀번호로 따로 잠겨 있다 — 직원 비밀번호로는 풀 수 없다.
  const AKEY = "cd_admin_key", AMENU = "cd_admin_menu", QLOG = "cd_quiz_log";
  let A = null, ACT = "";
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const fetchAdm = async () => { const r = await fetch("data.admin.enc.json?t=" + Date.now(), {cache: "no-store"}); return r.ok ? r.json() : null; };
  function mergeAdmin() {
    Object.assign(D.pages, A.pages);
    for (const t of D.topics) t.has_rec = ("rec-" + t.id) in D.pages;
  }
  async function loadAdmin() {
    const saved = ls.get(AKEY, ""); if (!saved) return;
    let enc; try { enc = await fetchAdm(); } catch (e) { return; }
    if (!enc) return;
    const [salt, k] = saved.split(".");
    if (salt !== enc.salt) { ls.del(AKEY); return; }  // 관리자 비밀번호가 바뀌면 다시 묻는다
    try { A = await decrypt(b64(k), enc); ACT = enc.ct; mergeAdmin(); } catch (e) { ls.del(AKEY); A = null; }
  }
  const menus = () => { try { return Object.assign({history: true, archive: true, quiz: true}, JSON.parse(ls.get(AMENU, "{}"))); } catch (e) { return {history: true, archive: true, quiz: true}; } };
  const on3 = k => !!A && menus()[k];

  // ---- 지식 수준(채점 v2 · 26.10.03) = 학습 세션 확정 기록(PC) + 이 기기 가채점(아직 확정 전) · 숙달도 = 최근 3회 가중(3:2:1) ÷ 4 · 30일마다 -10%p
  // 지식 수준 = 물어본 개념만의 평균(새 회차를 열어도 떨어지지 않음) · 진도 = 물어본 개념 / 배운 개념
  const qlog = () => { try { return JSON.parse(ls.get(QLOG, "[]")).filter(r => r && r.v === 2); } catch (e) { return []; } };
  const saveLog = L => ls.set(QLOG, JSON.stringify(L.slice(-2000)));
  const DAY = 864e5;
  const cm = (rs, now) => {
    if (!rs || !rs.length) return 0;
    const last = rs.slice(-3).reverse(), w = [3, 2, 1].slice(0, last.length);
    let m = last.reduce((a, x, i) => a + x.s * w[i], 0) / (4 * w.reduce((a, b) => a + b, 0));
    m -= 0.1 * Math.floor((now - rs[rs.length - 1].t) / (30 * DAY));
    return Math.max(0, Math.min(1, m));
  };
  const pending = () => { const done = new Set(A.phone_done || []); return qlog().filter(r => !(r.sent && done.has(r.sent))); };
  function devMastery() {
    const now = Date.now(), by = {};
    for (const r of (A.pc.recs || [])) (by[r.q] = by[r.q] || []).push({s: r.s, t: Date.parse(r.d + "T12:00:00")});
    let asked = 0, all = 0;
    const topics = A.bank.map(t => {
      const items = t.items.map(i => { const rs = (by[i.id] || []).sort((a, b) => a.t - b.t); return {i, m: cm(rs, now), n: rs.length, p: rs.some(x => x.p)}; });
      const ak = items.filter(x => x.n); asked += ak.length; all += items.length;
      const pc = (A.pc.topics || []).find(x => x.id === t.id) || {};
      return {id: t.id, title: t.title, items, asked: ak.length, know: ak.length ? ak.reduce((a, x) => a + x.m, 0) / ak.length : null, lv: pc.lv, prov: items.some(x => x.p)};
    });
    const kt = topics.filter(t => t.know != null);
    return {topics, know: kt.length ? kt.reduce((a, t) => a + t.know, 0) / kt.length : 0, asked, all, prov: topics.some(t => t.prov)};
  }
  const pct = x => Math.round((x || 0) * 100);
  function rateCard() {  // 홈 상단 — 지식 수준(큰 숫자) · 진도(작게) → 누르면 회차별
    const dm = devMastery();
    const rows = dm.topics.map(t => `<div class="rrow"><span class="t">${escH(t.id.replace(/^(\d)-/, "$1부 "))} ${escH(t.title.split(" — ")[0])}</span><span class="v">${t.know == null ? "—" : pct(t.know) + "%"}</span><div class="track"><i style="width:${pct(t.know)}%"></i></div><span class="muted small">${t.lv != null ? "수준 L" + t.lv + " · " : ""}확인 ${t.asked}/${t.items.length} 개념</span></div>`).join("");
    return `<details class="card rate"><summary><div class="rrow top"><span class="t">지식 수준</span><span class="v big">${pct(dm.know)}%</span><div class="track"><i style="width:${pct(dm.know)}%"></i></div><span class="muted small">확인한 개념 ${dm.asked}/${dm.all} · 학습 세션 채점 · 누르면 회차별</span></div></summary>${rows}<a class="go" href="#/quiz">오늘의 문제 ›</a></details>`;
  }

  // ---- 설정(⚙): 화면 보기(누구나) · 관리자 모드(관리자 비밀번호)
  function settings() {
    const m = menus();
    app.innerHTML = bar("설정", "#/") + `<div class="wrap">
      <div class="card set"><h2>화면 보기</h2><div class="seg">${TH.map(t => `<button type="button" class="segb${getTh() === t ? " on" : ""}" data-set-th="${t}">${THL[t]}</button>`).join("")}</div></div>
      <div class="card set"><h2>관리자 모드</h2>${A
        ? `<p class="muted small">관리자 메뉴 보이기 / 감추기</p>${[["history", "이력"], ["archive", "보관함"], ["quiz", "문제은행 · 문제 풀이"]].map(([k, l]) => `<label class="chk"><input type="checkbox" data-menu="${k}"${m[k] ? " checked" : ""}> ${l}</label>`).join("")}<button type="button" class="ghost" id="aoff">관리자 모드 끄기</button>
          <h2 style="margin-top:16px">학습 세션 제출함</h2><p class="muted small" id="tokst">확인 중…</p>
          <form id="tf"><input id="tok" type="password" autocomplete="off" placeholder="깃허브 토큰 붙여넣기" aria-label="제출함 토큰"><button>열쇠 저장</button></form>
          <button type="button" class="ghost" id="tokchk">연결 시험</button> <button type="button" class="ghost" id="tokdel">열쇠 지우기</button><div class="muted small" id="tokres"></div>`
        : `<form id="af"><input id="apw" type="password" autocomplete="off" placeholder="관리자 비밀번호" aria-label="관리자 비밀번호"><div class="err" id="aer"></div><button>열기</button></form>`}</div>
      <div class="card set"><button type="button" class="ghost" id="lo">이 기기에서 잠그기</button></div></div>` + nav("settings");
    document.querySelectorAll("[data-set-th]").forEach(b => b.onclick = () => { setTh(b.dataset.setTh); settings(); });
    document.querySelectorAll("[data-menu]").forEach(c => c.onchange = () => { const mm = menus(); mm[c.dataset.menu] = c.checked; ls.set(AMENU, JSON.stringify(mm)); settings(); });
    const off = $("#aoff"); if (off) off.onclick = () => { ls.del(AKEY); location.reload(); };
    if ($("#tokst")) getTok().then(t => { $("#tokst").textContent = t ? "열쇠 있음 — 문제를 풀고 '학습 세션에 보내기'를 누르면 비공개 제출함으로 암호화해 올립니다" : "열쇠 없음 — 깃허브 토큰(제출함 저장소 하나 · 내용 쓰기만)을 붙여넣어 주세요"; });
    const tf = $("#tf"); if (tf) tf.onsubmit = async ev => { ev.preventDefault(); const v = $("#tok").value.trim(); if (!v) return; await setTok(v); $("#tok").value = ""; toast("열쇠를 이 기기에 암호화해 저장했습니다"); settings(); };
    const tc = $("#tokchk"); if (tc) tc.onclick = async () => {
      const t = await getTok(), out = $("#tokres"); if (!t) { out.textContent = "열쇠가 없습니다"; return; }
      out.textContent = "확인 중…";
      try {
        const r = await fetch(`https://api.github.com/repos/${A.sync.repo}`, {headers: {Authorization: "Bearer " + t, Accept: "application/vnd.github+json"}});
        if (!r.ok) { out.textContent = `연결 실패 HTTP ${r.status} — 열쇠가 이 저장소(${A.sync.repo})에 권한이 없거나 만료됨`; return; }
        const j = await r.json(); out.textContent = `연결 성공 — ${j.full_name} · ${j.private ? "비공개" : "공개(!)"} 저장소에 닿습니다`;
      } catch (e) { out.textContent = "연결 실패 — " + e.message; }
    };
    const td = $("#tokdel"); if (td) td.onclick = async () => { await setTok(""); toast("열쇠를 지웠습니다"); settings(); };
    $("#lo").onclick = () => { store.del(); ls.del(AKEY); ls.del(TOK); location.hash = "#/"; location.reload(); };
    const af = $("#af");
    if (af) af.onsubmit = async ev => {
      ev.preventDefault(); $("#aer").textContent = "여는 중…";
      let enc; try { enc = await fetchAdm(); } catch (e) { enc = null; }
      if (!enc) { $("#aer").textContent = "관리자 자료가 아직 준비되지 않았습니다."; return; }
      try {
        const raw = await deriveRaw($("#apw").value, enc);
        A = await decrypt(raw, enc); ACT = enc.ct; mergeAdmin();
        ls.set(AKEY, enc.salt + "." + ub64(raw)); buildIndex(); settings();
      } catch (e) { A = null; $("#aer").textContent = "관리자 비밀번호가 맞지 않습니다."; }
    };
    window.scrollTo(0, 0);
  }

  // ---- 문제 풀이(채점 v2): ① 오늘의 문제(학습 세션이 고름 · '왜' 한 줄) ② 자유 연습(회차 선택 · 약한 개념 우선 3문제)
  // 서술형 = 상황형이 있으면 상황형 · 자기 평가는 학습 세션과 같은 축(사실 0-2 · 근거 0-1 · 이유 0-1 · 단정 오답 -1 · 모름 -1) → 가채점
  // 객관식 = 사실 축만(정답 2 · 오답 0 · 모름 -1) · 다 풀면 '학습 세션에 보내기'(비공개 제출함 · 관리자 키로 암호화)
  let QZ = null;
  // 문항의 시각(대표님 26.10.04 "다양한 시각에서의 접근") — 배지 이름
  const VLAB = {"개념": "개념", "상황": "상황", "역할": "역할 바꾸기", "반론": "반론", "오류": "틀린 곳 찾기", "우선순위": "우선순위", "비교": "비교", "연결": "연결", "연구": "연구 질문"};
  const ITEMS = () => { const m = {}; for (const t of A.bank) for (const i of t.items) m[i.id] = Object.assign({}, i, {ttl: t.title}); return m; };
  function pick3(sel) {
    const pool = []; for (const t of devMastery().topics) if (sel === "all" || sel === t.id) pool.push(...t.items);
    const w = x => (1 - x.m) * 2 + (x.n ? 0 : 0.5) + 0.2, out = [];
    while (out.length < 3 && pool.length) {
      let r = Math.random() * pool.reduce((a, x) => a + w(x), 0), k = 0;
      for (; k < pool.length - 1; k++) { r -= w(pool[k]); if (r <= 0) break; }
      const it = pool.splice(k, 1)[0].i, vs = it.vars || [], v = vs.length ? vs[Math.floor(Math.random() * vs.length)] : null;
      out.push({it, why: "", vt: v ? v.t : "", vq: v ? v.q : ""});
    }
    return out;
  }
  const todaySet = () => { const M = ITEMS(); return (A.today || []).filter(x => M[x.q]).map(x => ({it: M[x.q], why: x.why, vt: x.vt || "", vq: x.vq || ""})); };
  // 풀던 문제 보관(이 기기 안 · 새 판 반영·앱 재시작에도 이어서) — 대표님 26.10.04 "풀고 있던 문제가 그냥 사라졌어"
  const QDRAFT = "cd_quiz_draft";
  function saveDraft() {
    if (!QZ || !QZ.qs || !QZ.qs.length) { ls.del(QDRAFT); return; }
    ls.set(QDRAFT, JSON.stringify(Object.assign({}, QZ, {qs: QZ.qs.map(x => ({q: x.it.id, why: x.why, vt: x.vt || "", vq: x.vq || ""})), at: Date.now()})));
  }
  function loadDraft() {
    try {
      const d = JSON.parse(ls.get(QDRAFT, "null")); if (!d || Date.now() - d.at > 3 * 864e5) return null;
      const M = ITEMS(), qs = d.qs.filter(x => M[x.q]).map(x => ({it: M[x.q], why: x.why, vt: x.vt || "", vq: x.vq || ""}));
      return qs.length ? Object.assign(d, {qs}) : null;
    } catch (e) { return null; }
  }
  const busy = () => /^#\/quiz/.test(location.hash) && QZ && QZ.qs && QZ.qs.length && !(QZ.sub && !pending().some(r => !r.sent));
  const newSet = (kind, sel, mode) => ({kind, sel, mode, qs: kind === "today" ? todaySet() : pick3(sel), res: [], pick: [], text: [], ev: [], sub: false});
  function record(it, mode, o) {
    const uid = Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const L = qlog(); L.push(Object.assign({v: 2, uid, q: it.id, m: mode, t: Date.now(), sent: ""}, o)); saveLog(L); return uid;
  }
  function patchRec(uid, o) { const L = qlog(); const r = L.find(x => x.uid === uid); if (r) Object.assign(r, o); saveLog(L); }
  const opH = it => it.op ? `<div class="op"><b>지난번 대표님 생각</b> — ${escH(it.op)}</div>` : "";
  function quiz() {
    if (!on3("quiz")) { location.hash = "#/"; return; }
    if (!QZ) { const d = loadDraft(); if (d) { QZ = d; setTimeout(() => toast("풀던 문제를 이어서 보여 드립니다"), 50); } }
    const sel = (QZ && QZ.sel) || "all", mode = (QZ && QZ.mode) || "sa", kind = (QZ && QZ.kind) || "today";
    const chips = [["all", "전체"], ...A.bank.map(t => [t.id, t.id.replace(/^(\d)-/, "$1부 ")])].map(([k, l]) => `<button type="button" class="segb${sel === k ? " on" : ""}" data-qsel="${k}">${escH(l)}</button>`).join("");
    const modes = [["sa", "서술"], ["mc", "객관식"]].map(([k, l]) => `<button type="button" class="segb${mode === k ? " on" : ""}" data-qmode="${k}">${l}</button>`).join("");
    let body = "";
    if (QZ && QZ.qs) {
      body = QZ.qs.map(({it, why, vt, vq}, n) => {
        const r = QZ.res[n], whyH = "";
        if (QZ.mode === "mc") {
          const opts = [...it.opts, "모름"].map((o, j) => `<label class="opt${r ? (j + 1 === it.ans ? " ok" : (QZ.pick[n] === j + 1 ? " bad" : "")) : ""}"><input type="radio" name="q${n}" value="${j + 1}"${QZ.pick[n] === j + 1 ? " checked" : ""}${r ? " disabled" : ""}> ${escH(o)}</label>`).join("");
          return `<div class="card qz">${whyH}<div class="qn">${n + 1}. ${escH(it.mq)}</div>${opts}${r ? `<div class="ex"><b>${r.s === 2 ? "맞음" : r.s === -1 ? "모름" : "틀림"}</b> · 정답은 ${it.ans}번<div class="concept">${escH(it.a)}</div>${opH(it)}<div class="muted small">점수는 학습 세션이 확정합니다 · ${escH(it.ttl)}</div></div>` : ""}</div>`;
        }
        const qtext = vq || it.sq || it.q, vlab = vt || (it.sq ? "상황" : "개념");
        return `<div class="card qz">${whyH}<div class="qn">${n + 1}. ${escH(qtext)} <span class="lvb">${escH(VLAB[vlab] || vlab)}</span></div><textarea data-sa="${n}" rows="4" placeholder="노트를 보지 말고 기억나는 대로 써 보세요"${QZ.sub ? " disabled" : ""}>${escH(QZ.text[n] || "")}</textarea>${QZ.sub ? `<div class="ex"><b>개념 정리</b><div class="concept">${escH(it.a)}</div>${opH(it)}<div class="muted small">답은 저장됐습니다 · 채점은 학습 세션이 합니다 · ${escH(it.ttl)}</div></div>` : `<button type="button" class="ghost dk" data-dk="${n}">모름</button>`}<a class="askq" href="#/ask/${encodeURIComponent(it.id)}">이 문제에 대해 질문하기 ›</a></div>`;
      }).join("");
      const all = QZ.qs.length && (QZ.mode === "sa" ? QZ.sub : QZ.qs.every((_, n) => QZ.res[n]));
      if (!QZ.qs.length) body = `<div class="card muted">오늘의 문제가 아직 없습니다. 자유 연습을 골라 주세요.</div>`;
      else if (all) body += `<button type="button" class="big-btn" id="qsend">학습 세션에 보내기</button><button type="button" class="ghost" id="qnew">${QZ.kind === "today" ? "오늘의 문제 다시" : "다시 3문제"}</button>`;
      else if (!QZ.sub) body += `<button type="button" class="big-btn" id="qsub">답 확인하기 (아직 안 보냄)</button>`;
    } else body = `<button type="button" class="big-btn" id="qnew">${kind === "today" ? "오늘의 문제 시작" : "3문제 시작"}</button>`;
    const dm = devMastery(), P = pending(), wait = new Set(P.filter(r => r.sent).map(r => r.sent)).size, unsent = P.filter(r => !r.sent).length;
    app.innerHTML = bar("문제 풀이", "#/") + `<div class="wrap">
      <div class="muted small" style="margin:2px 2px 8px">지식 수준 ${pct(dm.know)}% · 확인한 개념 ${dm.asked}/${dm.all}(배운 회차 개념 중 한 번이라도 물어본 것)</div>
      <div class="card sendbox"><div><b>학습 세션에 보내지 않은 답 ${unsent}개</b> · 채점 기다리는 제출 ${wait}건</div>${lastSend()}${unsent ? `<button type="button" class="big-btn" id="qsend2">지금 학습 세션에 보내기</button>` : ""}<a class="askq" href="#/ask">질문함 · 학습 세션에 질문하기 ›</a></div>
      <div class="seg">${[["today", "오늘의 문제"], ["free", "자유 연습"]].map(([k, l]) => `<button type="button" class="segb${kind === k ? " on" : ""}" data-qkind="${k}">${l}</button>`).join("")}</div>
      ${kind === "free" ? `<div class="seg wrapseg">${chips}</div>` : ""}
      <div class="seg">${modes}</div>${body}</div>` + nav("quiz");
    saveDraft();
    const reset = o => { QZ = Object.assign({sel, mode, kind}, o); quiz(); };
    document.querySelectorAll("[data-qkind]").forEach(b => b.onclick = () => reset({kind: b.dataset.qkind}));
    document.querySelectorAll("[data-qsel]").forEach(b => b.onclick = () => reset({sel: b.dataset.qsel}));
    document.querySelectorAll("[data-qmode]").forEach(b => b.onclick = () => reset({mode: b.dataset.qmode}));
    const nw = $("#qnew"); if (nw) nw.onclick = () => { QZ = newSet(kind, sel, mode); quiz(); window.scrollTo(0, 0); };
    document.querySelectorAll("textarea[data-sa]").forEach(t => t.oninput = () => { QZ.text[+t.dataset.sa] = t.value; saveDraft(); });
    document.querySelectorAll(".qz input[type=radio]").forEach(r => r.onchange = () => { QZ.pick[+r.name.slice(1)] = +r.value; saveDraft(); });
    document.querySelectorAll("[data-dk]").forEach(b => b.onclick = () => { const n = +b.dataset.dk; QZ.text[n] = "(모름)"; QZ.ev[n] = {dk: 1}; const it = QZ.qs[n].it; QZ.res[n] = {s: -1, dk: 1}; record(it, "sa", {text: "(모름)", dk: 1, s: null, ask: QZ.qs[n].vq || it.sq || it.q, vt: QZ.qs[n].vt || ""}); quiz(); });
    const sb = $("#qsub");
    if (sb) sb.onclick = () => {
      if (QZ.mode === "mc") {
        if (QZ.qs.some((_, n) => !QZ.pick[n])) { toast("모든 문제를 고른 뒤 제출하세요"); return; }
        QZ.qs.forEach(({it}, n) => { const c = QZ.pick[n], s = c === 5 ? -1 : c === it.ans ? 2 : 0; QZ.res[n] = {s}; record(it, "mc", {choice: c, dk: c === 5 ? 1 : 0, s: null}); });
      }
      if (QZ.mode === "sa") {
        QZ.uid = QZ.uid || [];
        QZ.qs.forEach(({it, vt, vq}, n) => { if (QZ.res[n]) return; QZ.uid[n] = record(it, "sa", {text: QZ.text[n] || "", dk: 0, s: null, ask: vq || it.sq || it.q, vt: vt || ""}); });
      }
      QZ.sub = true; quiz();
    };
    const sd = $("#qsend"); if (sd) sd.onclick = () => sendPhone();
    const sd2 = $("#qsend2"); if (sd2) sd2.onclick = () => sendPhone();
  }

  // ---- 폰 → 학습 세션: 보내지 않은 답을 관리자 키로 암호화해 비공개 제출함에 올린다(토큰은 이 기기에만 · 관리자 키로 암호화)
  const TOK = "cd_sync_tok";
  const akeyRaw = () => { const v = ls.get(AKEY, ""); return v ? b64(v.split(".")[1]) : null; };
  async function sealA(obj) {
    const k = await crypto.subtle.importKey("raw", akeyRaw(), "AES-GCM", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({name: "AES-GCM", iv}, k, new TextEncoder().encode(JSON.stringify(obj)));
    return {v: 1, iv: ub64(iv), ct: ub64(ct)};
  }
  async function openA(o) {
    const k = await crypto.subtle.importKey("raw", akeyRaw(), "AES-GCM", false, ["decrypt"]);
    return new TextDecoder().decode(await crypto.subtle.decrypt({name: "AES-GCM", iv: b64(o.iv)}, k, b64(o.ct)));
  }
  async function getTok() { try { return JSON.parse(await openA(JSON.parse(ls.get(TOK, "")))).t || ""; } catch (e) { return ""; } }
  async function setTok(t) { if (!t) { ls.del(TOK); return; } ls.set(TOK, JSON.stringify(await sealA({t}))); }
  const b64u = s => btoa(unescape(encodeURIComponent(s)));
  function stamp() { const d = new Date(), p = x => String(x).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`; }
  const LSEND = "cd_last_send";
  function lastSend() {
    let o = null; try { o = JSON.parse(ls.get(LSEND, "null")); } catch (e) {}
    if (!o) return `<div class="muted small">아직 보낸 적 없음</div>`;
    const t = new Date(o.t).toLocaleString("ko-KR", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"});
    return o.ok ? `<div class="muted small">마지막 보내기 ${t} · ${o.n}문항 · <b>깃허브 확인 번호 ${escH(o.sha)}</b></div>` : `<div class="err">마지막 보내기 실패 ${t} · ${escH(o.err)}</div>`;
  }
  async function sendPhone() {
    const L = qlog(), un = L.filter(r => !r.sent);
    if (!un.length) { toast("보낼 답이 없습니다"); return; }
    const name = stamp(), M = ITEMS();
    const payload = {v: 2, name, at: new Date().toISOString(), items: un.map(r => ({q: r.q, m: r.m, t: new Date(r.t).toISOString(), text: r.text || "", choice: r.choice || 0, f: r.f, g: r.g, a: r.a, x: r.x, dk: r.dk, s: r.s, ask: r.ask || (M[r.q] ? (r.m === "mc" ? M[r.q].mq : (M[r.q].sq || M[r.q].q)) : ""), vt: r.vt || ""}))};
    const tok = await getTok();
    if (!tok) { toast("⚙ 설정 › 관리자 모드에서 제출함 열쇠를 먼저 넣어 주세요"); return; }
    try {
      const body = JSON.stringify(await sealA(payload));
      const r = await fetch(`https://api.github.com/repos/${A.sync.repo}/contents/${A.sync.dir}/${name}.json`, {method: "PUT",
        headers: {Authorization: "Bearer " + tok, Accept: "application/vnd.github+json"},
        body: JSON.stringify({message: "폰 제출 " + name, content: b64u(body)})});
      if (!r.ok) { let m = ""; try { m = (await r.json()).message || ""; } catch (e2) {} throw new Error("HTTP " + r.status + (m ? " " + m : "")); }
      let sha = ""; try { const j = await r.json(); sha = ((j.commit && j.commit.sha) || "").slice(0, 7); } catch (e2) {}
      if (!sha) throw new Error("깃허브 응답에 확인 번호가 없음");
      for (const x of L) if (!x.sent) x.sent = name;
      saveLog(L); ls.set(LSEND, JSON.stringify({ok: 1, t: Date.now(), n: un.length, sha, name}));
      toast(`보냈습니다 · ${un.length}문항 · 확인 번호 ${sha}`); quiz();
    } catch (e) { ls.set(LSEND, JSON.stringify({ok: 0, t: Date.now(), err: e.message})); toast("보내지 못했습니다(" + e.message + ")"); quiz(); }
  }

  // ---- 폰 질문 창구(대표님 26.10.04 "문제를 풀다가 추가 질문을 하는 창구") — 답안 제출과 같은 통로(비공개 제출함 · 관리자 키 암호화)
  // 질문은 이 기기에 먼저 저장 → 보내기 · 답은 학습 세션이 원문을 확인한 뒤 관리자 묶음(A.qa)에 실어 이 화면에 보인다(실시간 대화 아님)
  const QASK = "cd_ask_log";
  const askLog = () => { try { return JSON.parse(ls.get(QASK, "[]")); } catch (e) { return []; } };
  const saveAsk = L => ls.set(QASK, JSON.stringify(L));
  function askCtx(ref) {
    if (!ref) return {label: "", text: ""};
    const M = ITEMS();
    if (M[ref]) return {label: `${ref} · ${M[ref].concept}`, text: (M[ref].sq || M[ref].q)};
    const pg = D.pages[ref];
    return pg ? {label: pg.title, text: ""} : {label: ref, text: ""};
  }
  function ask(ref) {
    if (!A) { location.hash = "#/"; return; }
    ref = ref || ""; const c = askCtx(ref), L = askLog(), QA = {};
    for (const x of (A.qa || [])) QA[x.uid] = x;
    const mine = L.slice().reverse().map(x => {
      const ans = QA[x.uid];
      return `<div class="card askitem"><div class="muted small">${escH(new Date(x.t).toLocaleString("ko-KR", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}))} · ${escH(x.ctx || "일반 질문")} · ${x.sent ? "보냄" + (x.sha ? " · 확인 번호 " + escH(x.sha) : "") : "<b>아직 안 보냄</b>"}</div>
        <div class="askq-t">${escH(x.text)}</div>${ans ? `<div class="ex"><b>학습 세션의 답</b><div class="concept">${escH(ans.a)}</div><div class="muted small">근거 · ${escH(ans.src)}${ans.d ? " · " + escH(ans.d) : ""}</div></div>` : (x.sent ? `<div class="muted small">답을 준비 중입니다 — 학습 세션이 원문을 확인한 뒤 올립니다</div>` : "")}</div>`;
    }).join("");
    const unsent = L.filter(x => !x.sent).length;
    app.innerHTML = bar("질문하기", ref && /^\d-[BIAE]\d\d$/.test(ref) ? "#/p/" + ref : "#/quiz") + `<div class="wrap">
      ${c.label ? `<div class="card"><div class="muted small">어디서 묻나</div><b>${escH(c.label)}</b>${c.text ? `<div class="muted small" style="margin-top:4px">${escH(c.text)}</div>` : ""}</div>` : ""}
      <div class="card"><textarea id="askt" rows="5" placeholder="궁금한 점을 자유롭게 적어 주세요 — 어느 문제·노트에서 물었는지는 함께 보냅니다"></textarea>
        <button type="button" class="big-btn" id="askgo">질문 보내기</button>
        <div class="muted small">실시간 대화는 아닙니다 · 학습 세션이 원문을 확인한 뒤 이 화면에 답을 올립니다(관리자 판에만)</div></div>
      ${unsent ? `<button type="button" class="ghost" id="askre">보내지 못한 질문 ${unsent}개 다시 보내기</button>` : ""}
      <h3 class="sec">내 질문 ${L.length ? L.length + "개" : ""}</h3>${mine || '<div class="card muted">아직 보낸 질문이 없습니다.</div>'}</div>` + nav("quiz");
    $("#askgo").onclick = async () => {
      const t = $("#askt").value.trim(); if (!t) { toast("질문을 적어 주세요"); return; }
      const L2 = askLog(); L2.push({uid: "q" + stamp(), t: Date.now(), ref, ctx: c.label, text: t, sent: "", sha: ""}); saveAsk(L2);
      await sendAsk(ref);
    };
    const re = $("#askre"); if (re) re.onclick = () => sendAsk(ref);
    window.scrollTo(0, 0);
  }
  async function sendAsk(ref) {
    const L = askLog(), un = L.filter(x => !x.sent);
    if (!un.length) { ask(ref); return; }
    const tok = await getTok();
    if (!tok) { toast("⚙ 설정 › 관리자 모드에서 제출함 열쇠를 먼저 넣어 주세요 · 질문은 이 기기에 저장해 두었습니다"); ask(ref); return; }
    const name = "q-" + stamp();
    const payload = {v: 2, kind: "ask", name, at: new Date().toISOString(), asks: un.map(x => ({uid: x.uid, t: new Date(x.t).toISOString(), ref: x.ref, ctx: x.ctx, text: x.text}))};
    try {
      const body = JSON.stringify(await sealA(payload));
      const r = await fetch(`https://api.github.com/repos/${A.sync.repo}/contents/${A.sync.dir}/${name}.json`, {method: "PUT",
        headers: {Authorization: "Bearer " + tok, Accept: "application/vnd.github+json"},
        body: JSON.stringify({message: "폰 질문 " + name, content: b64u(body)})});
      if (!r.ok) { let m = ""; try { m = (await r.json()).message || ""; } catch (e2) {} throw new Error("HTTP " + r.status + (m ? " " + m : "")); }
      let sha = ""; try { const j = await r.json(); sha = ((j.commit && j.commit.sha) || "").slice(0, 7); } catch (e2) {}
      if (!sha) throw new Error("깃허브 응답에 확인 번호가 없음");
      for (const x of L) if (!x.sent) { x.sent = name; x.sha = sha; }
      saveAsk(L); toast(`질문을 보냈습니다 · ${un.length}개 · 확인 번호 ${sha}`);
    } catch (e) { toast("보내지 못했습니다(" + e.message + ") · 질문은 이 기기에 남아 있습니다"); }
    ask(ref);
  }

  // ------------------------------------------------------------ 홈
  function home() {
    const LV = D.levels || {B: "초급", I: "중급", A: "고급", E: "전문"};
    const parts = [];
    for (const t of D.topics) { let p = parts.find(x => x.name === t.part); if (!p) parts.push(p = {name: t.part, items: []}); p.items.push(t); }
    const toc = parts.map((p, i) => {
      const open = p.items.some(t => t.has_note || t.status) || i === 0 ? " open" : "";
      const nm = p.name.replace(/^(\d)\s*/, "$1부 ");
      return `<details class="part"${open}><summary>${escH(nm)}</summary>${p.items.map(t => {
        // 목차 줄 = 배지 + 짧은 제목만(폰에서 한두 줄) · ' — ' 뒤 설명과 끝 괄호는 펼친 칸의 '다루는 범위'로
        const [head, ...rest] = t.title.split(" — ");
        const short = head.replace(/\s*\([^)]*\)\s*$/, "") || head;
        const scope = [rest.join(" — "), head !== short ? head.slice(short.length).trim().replace(/^\(|\)$/g, "") : ""].filter(Boolean).join(" · ");
        // 펼침 = 이 회차가 다루는 내용만(날짜·안내문·'열기' 단추 없음) · 노트가 있으면 펼친 칸을 누르면 노트로
        const body = t.has_note
          ? `<a class="sum" href="#/p/${t.id}">${t.summary ? `<p>${escH(t.summary)}</p>` : ""}${t.keys.length ? `<ul>${t.keys.map(h => `<li>${escH(h)}</li>`).join("")}</ul>` : ""}${t.heads.length ? `<p class="more">${t.heads.map(escH).join(" · ")}</p>` : ""}</a>`
          : `<div class="sum">${scope ? `<p>${escH(scope)}</p>` : ""}<p>${escH(t.point)}</p></div>`;
        return `<details class="topic${t.has_note ? "" : " wait"}"><summary><span class="rk rk-${t.has_note ? t.lvl : "off"}">${escH(t.code)}</span><span class="tt"><span class="tx">${escH(short)}</span></span></summary>${body}</details>`;
      }).join("")}</details>`;
    }).join("");

    app.innerHTML = bar() + `<div class="wrap">${updTop()}
      <div class="hello">한 회차씩,<br>대드론 체계를 쌓아갑니다.</div>
      ${on3("quiz") ? rateCard() : ""}
      <div class="search"><input id="q" type="search" placeholder="용어·주제·회차 검색 (예: C-UAS)" aria-label="검색" enterkeyhint="search"><button class="x" id="qx" aria-label="지우기" hidden>×</button></div>
      <div id="res"></div><div id="main">
      <div class="muted small meta-line">용어 ${D.stats.terms}개 · 논문 포인트 ${D.stats.points}개 · 정리 ${escH(D.built)}</div>

      <h2 class="h-sec">전체 목차</h2>${toc}
      </div></div>` + nav("home");
    const q = $("#q"), qx = $("#qx");
    const run = () => {
      const v = q.value.trim(); qx.hidden = !v; $("#main").hidden = !!v;
      try { sessionStorage.setItem("q", v); } catch (e) {}
      if (!v) { $("#res").innerHTML = ""; return; }
      const hs = search(v);
      $("#res").innerHTML = `<div class="card res">${hs.length ? hs.map(h => `<a class="hit" ${h.pid ? `href="#/p/${h.pid}/${h.sid}"` : ""}><div class="w">${h.arc ? '<span class="arc">보관 · </span>' : ""}${escH(h.pt)} › ${escH(h.st.replace(/\s*\(.*$/, ""))}</div><div class="s">${snippet(h.raw, v)}</div></a>`).join("") : `<div class="empty">찾는 내용이 없습니다.</div>`}</div>`;
    };
    q.oninput = run; qx.onclick = () => { q.value = ""; run(); q.focus(); };
    try { const s = sessionStorage.getItem("q"); if (s) { q.value = s; run(); } } catch (e) {}
  }

  // ------------------------------------------------------------ 노트·용어집·보관 문서
  function page(pid, sid) {
    const pg = D.pages[pid];
    if (!pg) { location.hash = "#/"; return; }
    const chips = pg.secs.filter(s => s.level === 2).map(s => `<a href="#/p/${pid}/${s.id}">${escH(s.title.replace(/\s*\(.*$/, ""))}</a>`).join("");
    const tid = /^\d-(?:[BIAE]\d\d|CHK)$/.test(pid) ? pid : null;
    const rec = tid && D.pages["rec-" + tid] ? `<a class="recnote" href="#/p/rec-${tid}">이 회차를 공부한 과정(문답·첨삭·교재 재료·논문 포인트)은 <b>보관함 › 학습 기록</b>에 있습니다 ›</a>` : "";
    const back = pg.archive ? "#/archive" : "#/";
    const on = pid === "glossary" ? "glossary" : pid === "history" ? "history" : pg.archive ? "archive" : "home";
    if (pg.archive && !A) { location.hash = "#/"; return; }
    const au = A && tid && A.audio && A.audio[tid];
    const audH = au ? `<div class="card aud"><div><b>🎧 듣기</b> <span class="muted small">두 진행자 대화 · 약 ${Math.round(au.dur / 60)}분 · 화면을 꺼도 이어집니다</span></div>
      <button type="button" class="big-btn" id="aplay">${AUD.tid === tid && !AUD.el.paused ? "❚❚ 일시정지" : "▶ 듣기"}</button>
      <div class="aud-r"><button type="button" class="ghost" data-ask="-10">« 10초</button><input type="range" id="aseek" min="0" max="${au.dur}" value="0" aria-label="재생 위치"><button type="button" class="ghost" data-ask="10">10초 »</button></div>
      <div class="aud-r"><span class="muted small" id="atime">0:00 / ${fmtT(au.dur)}</span><select id="arate" aria-label="속도">${[0.8, 1, 1.25, 1.5].map(r => `<option value="${r}"${(+ls.get("cd_aud_rate", "1")) === r ? " selected" : ""}>${r}배</option>`).join("")}</select></div></div>` : "";
    app.innerHTML = bar(pg.title, back) + `<div class="wrap">${chips && pid !== "glossary" ? `<div class="chips">${chips}</div>` : ""}${audH}<article class="doc">${pg.html}</article>${rec}${A && tid ? `<a class="askq" href="#/ask/${tid}">이 노트에 대해 학습 세션에 질문하기 ›</a>` : ""}
      ${pid === "about" ? `<div class="foot"><button id="lo">이 기기에서 잠그기</button></div>` : ""}</div>` + nav(on);
    if (pid === "about") $("#lo").onclick = () => { store.del(); location.hash = "#/"; location.reload(); };
    if (au) audBind(tid, pg.title, au);
    if (sid) {
      const el = document.getElementById(sid);
      if (el) { const box = el.closest("section.cs,tr") || el; box.scrollIntoView({block: "start"}); window.scrollBy(0, -64); box.classList.add("flash"); }
    } else window.scrollTo(0, 0);
  }
  // ---- 회차 음성 듣기(대표님 26.10.04 · 대표님만) — 관리자 키로 암호화된 음성을 받아 이 기기 보관함(cd-audio)에 두고, 풀어서 재생
  // 재생기는 하나(AUD)라 다른 화면으로 옮겨도 계속 들림 · 들은 위치·속도 기억 · 잠금 화면·블루투스 조작(Media Session)
  const AUD = {el: new Audio(), tid: "", url: ""};
  const fmtT = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  async function audLoad(tid, au) {
    let buf;
    try {
      const c = await caches.open("cd-audio"); let r = await c.match(au.f);
      if (!r) {
        r = await fetch(au.f, {cache: "no-store"}); if (!r.ok) throw new Error("HTTP " + r.status);
        for (const k of await c.keys()) if (new URL(k.url).pathname.includes("/aud/" + tid + "-")) await c.delete(k);  // 옛 판 정리
        await c.put(au.f, r.clone());
      }
      buf = new Uint8Array(await r.arrayBuffer());
    } catch (e) { const r = await fetch(au.f, {cache: "no-store"}); if (!r.ok) throw new Error("HTTP " + r.status); buf = new Uint8Array(await r.arrayBuffer()); }
    const k = await crypto.subtle.importKey("raw", akeyRaw(), "AES-GCM", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({name: "AES-GCM", iv: buf.slice(0, 12)}, k, buf.slice(12));
    return URL.createObjectURL(new Blob([pt], {type: "audio/mpeg"}));
  }
  function audBind(tid, title, au) {
    const el = AUD.el, pb = $("#aplay"), sk = $("#aseek"), tm = $("#atime"), rt = $("#arate"), pk = "cd_aud_pos_" + tid;
    const sync = () => { if (AUD.tid !== tid) return; sk.value = Math.floor(el.currentTime); tm.textContent = `${fmtT(el.currentTime)} / ${fmtT(au.dur)}`; pb.textContent = el.paused ? "▶ 이어 듣기" : "❚❚ 일시정지"; };
    if (AUD.tid !== tid) { const p = +ls.get(pk, "0"); sk.value = p; tm.textContent = `${fmtT(p)} / ${fmtT(au.dur)}`; if (p > 5) pb.textContent = "▶ 이어 듣기"; } else sync();
    el.ontimeupdate = () => { sync(); if (AUD.tid && Math.floor(el.currentTime) % 5 === 0) ls.set("cd_aud_pos_" + AUD.tid, String(Math.floor(el.currentTime))); };
    el.onplay = el.onpause = sync;
    el.onended = () => { ls.set("cd_aud_pos_" + AUD.tid, "0"); sync(); };
    const start = async () => {
      if (AUD.tid !== tid) {
        pb.textContent = "받는 중…"; pb.disabled = true;
        try { if (AUD.url) URL.revokeObjectURL(AUD.url); AUD.url = await audLoad(tid, au); }
        catch (e) { pb.disabled = false; pb.textContent = "▶ 듣기"; toast("음성을 받지 못했습니다(" + e.message + ")"); return; }
        pb.disabled = false; AUD.tid = tid; el.src = AUD.url; el.currentTime = +ls.get(pk, "0");
      }
      el.playbackRate = +rt.value; await el.play().catch(() => {});
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({title, artist: "대드론 학습 노트", album: "두 진행자 대화"});
        navigator.mediaSession.setActionHandler("play", () => el.play());
        navigator.mediaSession.setActionHandler("pause", () => el.pause());
        navigator.mediaSession.setActionHandler("seekbackward", () => { el.currentTime = Math.max(0, el.currentTime - 10); });
        navigator.mediaSession.setActionHandler("seekforward", () => { el.currentTime = Math.min(el.duration || au.dur, el.currentTime + 10); });
      }
    };
    pb.onclick = () => { if (AUD.tid === tid && !el.paused) el.pause(); else start(); };
    document.querySelectorAll("[data-ask]").forEach(b => b.onclick = () => { if (AUD.tid === tid) el.currentTime = Math.max(0, Math.min(el.duration || au.dur, el.currentTime + (+b.dataset.ask))); });
    sk.oninput = () => { if (AUD.tid === tid) el.currentTime = +sk.value; else ls.set(pk, sk.value); tm.textContent = `${fmtT(+sk.value)} / ${fmtT(au.dur)}`; };
    rt.onchange = () => { ls.set("cd_aud_rate", rt.value); el.playbackRate = +rt.value; };
  }
  function archive() {
    const recs = D.topics.filter(t => t.has_rec).map(t => `<a class="item" href="#/p/rec-${t.id}"><span class="rk rk-${t.lvl}">${t.code}</span><span>${escH(D.pages["rec-" + t.id].title)}<small>문답 · 설명과 첨삭 · 교재 재료 · 논문 포인트</small></span></a>`).join("");
    app.innerHTML = bar("보관함", "#/") + `<div class="wrap">
      <p class="muted small" style="margin:4px 2px 12px">공부한 과정과 연구·교재용 자료입니다. 복습은 홈의 핵심 노트로 하세요.</p>
      <div class="card" style="padding:0">${recs || '<div class="empty">아직 없습니다.</div>'}</div>
      <div class="card" style="padding:0">
        <a class="item" href="#/p/points"><span class="ic">논</span><span>논문 포인트 모음<small>연구 공백 · 분석 틀 · 근거와 반론 (${D.stats.points}개)</small></span></a>
        <a class="item" href="#/p/history"><span class="ic">이</span><span>학습이력<small>회차별 기록 · 도달 수준</small></span></a>
        <a class="item" href="#/p/about"><span class="ic">방</span><span>공부 방식<small>목표 · 수준 사다리 L1–L4 · 회차 진행</small></span></a>
      </div></div>` + nav("archive");
    window.scrollTo(0, 0);
  }

  function route() {
    const h = location.hash.replace(/^#\/?/, "").split("/");
    if (h[0] === "p" && h[1]) page(decodeURIComponent(h[1]), h[2] && decodeURIComponent(h[2]));
    else if (h[0] === "archive") { if (on3("archive")) archive(); else location.hash = "#/"; }
    else if (h[0] === "settings") settings();
    else if (h[0] === "quiz") quiz();
    else if (h[0] === "ask") ask(h[1] && decodeURIComponent(h[1]));
    else { home(); window.scrollTo(0, 0); }
  }
  function start() {
    buildIndex();
    window.addEventListener("hashchange", route);
    route();
    const top = $("#top");
    window.addEventListener("scroll", () => { top.hidden = window.scrollY < 500; }, {passive: true});
    top.onclick = () => window.scrollTo({top: 0, behavior: "smooth"});
    try { if (sessionStorage.getItem("cd_upd")) { sessionStorage.removeItem("cd_upd"); toast("새 정리가 반영됐습니다 · " + D.built); } } catch (e) {}
    window.__cdReady = true;
    showInstall();
    // 앱이 백그라운드에 있다가 다시 열리면 새 정리가 있는지 확인해 바로 반영
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(true); });
    setInterval(() => { if (document.visibilityState === "visible") refresh(false); }, 10 * 60 * 1000);
  }
  async function refresh(resumed) {
    try {
      const enc = await fetchEnc();
      let changed = enc.ct && enc.ct !== CT;
      if (!changed && A) { try { const a = await fetchAdm(); changed = !!(a && a.ct !== ACT); } catch (e) {} }
      if (!changed) return;
      if (enc.salt !== (store.get() || "").split(".")[0]) { location.reload(); return; }  // 비밀번호가 바뀜 → 잠금 화면
      // 새 정리 → 자료만 바꾸지 않고 다시 불러온다(화면 코드 app.js·app.css 도 최신으로)
      if (resumed && !busy()) { applyUpd(); return; }   // 뒤에 있다가 돌아옴 + 푸는 중 아님 → 바로
      askUpd();                                           // 화면에 떠 있음 또는 푸는 중 → 묻는다
    } catch (e) {}
  }
  let UPD = false;
  function applyUpd() { try { sessionStorage.setItem("cd_upd", "1"); } catch (e) {} saveDraft(); location.reload(); }
  function askUpd() {
    if (UPD || $("#updask")) return;
    const el = document.createElement("div"); el.id = "updask"; el.className = "updask"; el.setAttribute("role", "dialog");
    el.innerHTML = `<div class="box"><b>새 정리가 있습니다</b><p>지금 받으면 최신 내용으로 다시 열립니다. 푸는 문제는 그대로 보관됩니다.</p><div class="row"><button type="button" class="big-btn" data-u="now">지금 받기</button><button type="button" class="ghost" data-u="later">나중에</button></div></div>`;
    document.body.appendChild(el);
    el.querySelector('[data-u="now"]').onclick = applyUpd;
    el.querySelector('[data-u="later"]').onclick = () => { UPD = true; el.remove(); if (/^#\/?$/.test(location.hash) || !location.hash) home(); };
  }
  const updTop = () => UPD ? `<button type="button" class="updtop" id="updtop">⟳ 새 정리가 있습니다 · 눌러서 받기</button>` : "";
  function toast(t) {
    const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  setTh(getTh());
  boot();
})();
