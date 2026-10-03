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

  // ------------------------------------------------------------ 관리자 모드 (대표님 26.10.03)
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

  // ---- 문제 풀이 기록(이 기기에만) · 숙달도 = 최근 3회 가중(3:2:1) ÷ 3 · 안 푼 개념 0%
  const qlog = () => { try { return JSON.parse(ls.get(QLOG, "[]")); } catch (e) { return []; } };
  const cm = s => { if (!s || !s.length) return 0; const last = s.slice(-3).reverse(), w = [3, 2, 1].slice(0, last.length); return last.reduce((a, x, i) => a + x * w[i], 0) / (3 * w.reduce((a, b) => a + b, 0)); };
  function devMastery() {
    const by = {}; for (const r of qlog()) (by[r.q] = by[r.q] || []).push(r.s);
    const topics = A.bank.map(t => {
      const items = t.items.map(i => ({i, m: cm(by[i.id]), n: (by[i.id] || []).length}));
      return {id: t.id, title: t.title, items, rate: items.length ? items.reduce((a, x) => a + x.m, 0) / items.length : 0, asked: items.filter(x => x.n).length};
    });
    return {topics, overall: topics.length ? topics.reduce((a, t) => a + t.rate, 0) / topics.length : 0};
  }
  const pct = x => Math.round(x * 100);
  const pcRate = id => { const t = (A.pc.topics || []).find(x => x.id === id); return t ? t.rate : 0; };
  function rateCard() {  // 홈 상단 — 종합 도달률(이 기기 풀이 기준) → 누르면 회차별
    const dm = devMastery();
    const rows = dm.topics.map(t => `<div class="rrow"><span class="t">${escH(t.id.replace(/^(\d)-/, "$1부 "))} ${escH(t.title.split(" — ")[0])}</span><span class="v">${pct(t.rate)}%</span><div class="track"><i style="width:${pct(t.rate)}%"></i></div><span class="muted small">이 기기 ${t.asked}/${t.items.length} 개념 풀이 · 학습 세션 기록 ${pct(pcRate(t.id))}%</span></div>`).join("");
    return `<details class="card rate"><summary><div class="rrow top"><span class="t">종합 도달률</span><span class="v big">${pct(dm.overall)}%</span><div class="track"><i style="width:${pct(dm.overall)}%"></i></div><span class="muted small">이 기기 풀이 기준 · 학습 세션 기록 ${pct(A.pc.overall)}% · 누르면 회차별</span></div></summary>${rows}<a class="go" href="#/quiz">문제 풀기 ›</a></details>`;
  }

  // ---- 설정(⚙): 화면 보기(누구나) · 관리자 모드(관리자 비밀번호)
  function settings() {
    const m = menus();
    app.innerHTML = bar("설정", "#/") + `<div class="wrap">
      <div class="card set"><h2>화면 보기</h2><div class="seg">${TH.map(t => `<button type="button" class="segb${getTh() === t ? " on" : ""}" data-set-th="${t}">${THL[t]}</button>`).join("")}</div></div>
      <div class="card set"><h2>관리자 모드</h2>${A
        ? `<p class="muted small">관리자 메뉴 보이기 / 감추기</p>${[["history", "이력"], ["archive", "보관함"], ["quiz", "문제은행 · 문제 풀이"]].map(([k, l]) => `<label class="chk"><input type="checkbox" data-menu="${k}"${m[k] ? " checked" : ""}> ${l}</label>`).join("")}<button type="button" class="ghost" id="aoff">관리자 모드 끄기</button>`
        : `<form id="af"><input id="apw" type="password" autocomplete="off" placeholder="관리자 비밀번호" aria-label="관리자 비밀번호"><div class="err" id="aer"></div><button>열기</button></form>`}</div>
      <div class="card set"><button type="button" class="ghost" id="lo">이 기기에서 잠그기</button></div></div>` + nav("settings");
    document.querySelectorAll("[data-set-th]").forEach(b => b.onclick = () => { setTh(b.dataset.setTh); settings(); });
    document.querySelectorAll("[data-menu]").forEach(c => c.onchange = () => { const mm = menus(); mm[c.dataset.menu] = c.checked; ls.set(AMENU, JSON.stringify(mm)); settings(); });
    const off = $("#aoff"); if (off) off.onclick = () => { ls.del(AKEY); location.reload(); };
    $("#lo").onclick = () => { store.del(); ls.del(AKEY); location.hash = "#/"; location.reload(); };
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

  // ---- 문제 풀이: 회차 선택 또는 전체 → 무작위 3문제(약한·안 푼 개념 우선) → 제출 → 채점·해설 → 이 기기에 기록
  let QZ = null;
  function pick3(sel) {
    const pool = []; for (const t of devMastery().topics) if (sel === "all" || sel === t.id) pool.push(...t.items);
    const w = x => (1 - x.m) * 2 + (x.n ? 0 : 1) + 0.2, out = [];
    while (out.length < 3 && pool.length) {
      let r = Math.random() * pool.reduce((a, x) => a + w(x), 0), k = 0;
      for (; k < pool.length - 1; k++) { r -= w(pool[k]); if (r <= 0) break; }
      out.push(pool.splice(k, 1)[0].i);
    }
    return out;
  }
  function saveScore(q, s, mode) { const L = qlog(); L.push({q, s, m: mode, t: Date.now()}); ls.set(QLOG, JSON.stringify(L.slice(-2000))); }
  function quiz() {
    if (!on3("quiz")) { location.hash = "#/"; return; }
    const sel = (QZ && QZ.sel) || "all", mode = (QZ && QZ.mode) || "mc";
    const chips = [["all", "전체"], ...A.bank.map(t => [t.id, t.id.replace(/^(\d)-/, "$1부 ")])].map(([k, l]) => `<button type="button" class="segb${sel === k ? " on" : ""}" data-qsel="${k}">${escH(l)}</button>`).join("");
    const modes = [["mc", "객관식"], ["sa", "주관식"]].map(([k, l]) => `<button type="button" class="segb${mode === k ? " on" : ""}" data-qmode="${k}">${l}</button>`).join("");
    let body = "";
    if (QZ && QZ.qs) {
      body = QZ.qs.map((it, n) => {
        const r = QZ.res[n];
        if (QZ.mode === "mc") {
          const opts = it.opts.map((o, j) => `<label class="opt${r ? (j + 1 === it.ans ? " ok" : (QZ.pick[n] === j + 1 ? " bad" : "")) : ""}"><input type="radio" name="q${n}" value="${j + 1}"${QZ.pick[n] === j + 1 ? " checked" : ""}${r ? " disabled" : ""}> ${escH(o)}</label>`).join("");
          return `<div class="card qz"><div class="qn">${n + 1}. ${escH(it.mq)}</div>${opts}${r ? `<div class="ex"><b>${r.s === 3 ? "정답" : "오답"}</b> · 정답은 ${it.ans}번 — ${escH(it.a)}<div class="muted small">근거: ${escH(it.src)} · ${escH(it.topic)}</div></div>` : ""}</div>`;
        }
        return `<div class="card qz"><div class="qn">${n + 1}. ${escH(it.q)}</div><textarea data-sa="${n}" rows="3" placeholder="기억나는 대로 써 보세요"${QZ.sub ? " disabled" : ""}>${escH(QZ.text[n] || "")}</textarea>${QZ.sub ? `<div class="ex"><b>모범 답안</b> — ${escH(it.a)}<div class="muted small">근거: ${escH(it.src)} · ${escH(it.topic)}</div>${r ? `<div class="self done">스스로 평가: ${["모름", "일부", "맞음"][r.s]}</div>` : `<div class="self">스스로 평가 <button type="button" data-self="${n}" data-s="2">맞음</button><button type="button" data-self="${n}" data-s="1">일부</button><button type="button" data-self="${n}" data-s="0">모름</button></div>`}</div>` : ""}</div>`;
      }).join("");
      const all = QZ.qs.every((_, n) => QZ.res[n]);
      body += QZ.sub || QZ.mode === "mc" && all ? (all ? `<button type="button" class="big-btn" id="qnew">다시 3문제</button>` : "") : `<button type="button" class="big-btn" id="qsub">제출</button>`;
    } else body = `<button type="button" class="big-btn" id="qnew">3문제 시작</button>`;
    const dm = devMastery();
    app.innerHTML = bar("문제 풀이", "#/") + `<div class="wrap">
      <div class="muted small" style="margin:2px 2px 8px">이 기기 종합 ${pct(dm.overall)}% · 문항 ${A.bank.reduce((a, t) => a + t.items.length, 0)}개 · 기록은 이 기기에만 남습니다</div>
      <div class="seg wrapseg">${chips}</div><div class="seg">${modes}</div>${body}</div>` + nav("quiz");
    document.querySelectorAll("[data-qsel]").forEach(b => b.onclick = () => { QZ = {sel: b.dataset.qsel, mode}; quiz(); });
    document.querySelectorAll("[data-qmode]").forEach(b => b.onclick = () => { QZ = {sel, mode: b.dataset.qmode}; quiz(); });
    const nw = $("#qnew"); if (nw) nw.onclick = () => { QZ = {sel, mode, qs: pick3(sel), res: [], pick: [], text: [], sub: false}; quiz(); window.scrollTo(0, 0); };
    document.querySelectorAll("textarea[data-sa]").forEach(t => t.oninput = () => { QZ.text[+t.dataset.sa] = t.value; });
    document.querySelectorAll(".qz input[type=radio]").forEach(r => r.onchange = () => { QZ.pick[+r.name.slice(1)] = +r.value; });
    const sb = $("#qsub");
    if (sb) sb.onclick = () => {
      if (QZ.mode === "mc") {
        if (QZ.qs.some((_, n) => !QZ.pick[n])) { toast("세 문제 모두 고른 뒤 제출하세요"); return; }
        QZ.qs.forEach((it, n) => { const s = QZ.pick[n] === it.ans ? 3 : 0; QZ.res[n] = {s}; saveScore(it.id, s, "mc"); });
      }
      QZ.sub = true; quiz();
    };
    document.querySelectorAll("[data-self]").forEach(b => b.onclick = () => { const n = +b.dataset.self, s = +b.dataset.s; QZ.res[n] = {s}; saveScore(QZ.qs[n].id, s, "sa"); quiz(); });
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

    app.innerHTML = bar() + `<div class="wrap">
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
    const tid = /^\d-[BIAE]\d\d$/.test(pid) ? pid : null;
    const rec = tid && D.pages["rec-" + tid] ? `<a class="recnote" href="#/p/rec-${tid}">이 회차를 공부한 과정(문답·첨삭·교재 재료·논문 포인트)은 <b>보관함 › 학습 기록</b>에 있습니다 ›</a>` : "";
    const back = pg.archive ? "#/archive" : "#/";
    const on = pid === "glossary" ? "glossary" : pid === "history" ? "history" : pg.archive ? "archive" : "home";
    if (pg.archive && !A) { location.hash = "#/"; return; }
    app.innerHTML = bar(pg.title, back) + `<div class="wrap">${chips && pid !== "glossary" ? `<div class="chips">${chips}</div>` : ""}<article class="doc">${pg.html}</article>${rec}
      ${pid === "about" ? `<div class="foot"><button id="lo">이 기기에서 잠그기</button></div>` : ""}</div>` + nav(on);
    if (pid === "about") $("#lo").onclick = () => { store.del(); location.hash = "#/"; location.reload(); };
    if (sid) {
      const el = document.getElementById(sid);
      if (el) { const box = el.closest("section.cs,tr") || el; box.scrollIntoView({block: "start"}); window.scrollBy(0, -64); box.classList.add("flash"); }
    } else window.scrollTo(0, 0);
  }
  function archive() {
    const recs = D.topics.filter(t => t.has_rec).map(t => `<a class="item" href="#/p/rec-${t.id}"><span class="rk rk-${t.lvl}">${t.code}</span><span>${escH(D.pages["rec-" + t.id].title)}<small>문답 · 대표님 설명과 첨삭 · 교재 재료 · 논문 포인트</small></span></a>`).join("");
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
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
    setInterval(refresh, 10 * 60 * 1000);
  }
  async function refresh() {
    try {
      const enc = await fetchEnc();
      let changed = enc.ct && enc.ct !== CT;
      if (!changed && A) { try { const a = await fetchAdm(); changed = !!(a && a.ct !== ACT); } catch (e) {} }
      if (!changed) return;
      if (enc.salt !== (store.get() || "").split(".")[0]) { location.reload(); return; }  // 비밀번호가 바뀜 → 잠금 화면
      // 새 정리 → 자료만 바꾸지 않고 다시 불러온다(화면 코드 app.js·app.css 도 최신으로)
      try { sessionStorage.setItem("cd_upd", "1"); } catch (e) {}
      location.reload();
    } catch (e) {}
  }
  function toast(t) {
    const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  setTh(getTh());
  boot();
})();
