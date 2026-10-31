(function () {
  "use strict";

  const DATA_URL = "../../../assets/data/renai-english-grade8s-midterm-spelling.json";
  const STORAGE_KEY = "renai_english_grade8s_spelling_v1";
  const DECK_KEY = "textbooks/renai/english/grade8s-midterm-spelling";
  const TARGET = "2026-11-07";   // 考前一天全部掌握
  const STEPS = [1, 2, 3];       // 拼错后隔 1、2、3 天各考一次，都对才算掌握
  const REQUEUE_GAP = 4;         // 拼错的词隔 4 个再考
  const MAX_REQUEUE = 3;
  const BATCH = 20;
  const RUSH_FROM = "2026-11-06";

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  let model = null;
  let state = emptyState();
  let view = "today";
  let session = null;
  let unitFilter = "";
  let statusFilter = "";
  let toastTimer = null;

  function emptyState() { return { version: 1, items: {}, pref: { mode: "write" } }; }

  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function addDays(day, n) {
    const d = new Date(day + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function daysBetween(a, b) {
    return Math.round((Date.parse(b + "T00:00:00") - Date.parse(a + "T00:00:00")) / 86400000);
  }

  // 复习日不晚于目标日，保证考前都轮到。
  function clampDue(day) {
    const d = today();
    return d < TARGET && day > TARGET ? TARGET : day;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 与 build_spelling_data.py 的 norm() 规则一致。
  function normAnswer(text) {
    return String(text).toLowerCase().replace(/[’‘]/g, "'").replace(/[….]/g, " ")
      .replace(/\bsomebody\b/g, "sb").replace(/\bsomething\b/g, "sth")
      .replace(/\s+/g, " ").trim();
  }

  // ---------- 语音 ----------

  let voices = [];
  function loadVoices() { try { voices = speechSynthesis.getVoices() || []; } catch (e) { voices = []; } }
  if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

  function speak(text) {
    if (!("speechSynthesis" in window)) return toast("这个浏览器不支持朗读");
    try {
      speechSynthesis.cancel();
      const said = text.replace(/\bsb\.?/g, " somebody ").replace(/\bsth\.?/g, " something ")
        .replace(/\.\.\.|…/g, " ").replace(/\//g, " or ").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
      const u = new SpeechSynthesisUtterance(said);
      u.lang = "en-US";
      u.rate = 0.85;
      const v = voices.find(v => /en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ---------- 内容 ----------

  function buildModel(data) {
    const items = data.items.map((raw, i) => Object.assign({}, raw, { order: i }));
    const itemMap = new Map(items.map(it => [it.id, it]));
    const byAnswer = new Map();
    for (const it of items) for (const a of it.answers) if (!byAnswer.has(a)) byAnswer.set(a, it);
    const units = [];
    for (const it of items) {
      let u = units.find(x => x.title === it.unit);
      if (!u) units.push(u = { title: it.unit, subtitle: it.unitTitle, items: [] });
      u.items.push(it);
    }
    return { items, itemMap, byAnswer, units };
  }

  // ---------- 进度 ----------

  function obj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function normalize(raw) {
    const out = emptyState();
    if (!obj(raw)) return out;
    if (obj(raw.items)) for (const [id, r] of Object.entries(raw.items)) {
      if (!model.itemMap.has(id) || !obj(r)) continue;
      out.items[id] = {
        step: Number.isFinite(+r.step) ? +r.step : 0, due: r.due || "", wrong: +r.wrong || 0, hint: +r.hint || 0,
        seen: +r.seen || 0, done: !!r.done, first: r.first || "", last: r.last || "",
        typos: Array.isArray(r.typos) ? r.typos.filter(t => typeof t === "string").slice(-3) : []
      };
    }
    if (obj(raw.pref) && (raw.pref.mode === "write" || raw.pref.mode === "listen")) out.pref.mode = raw.pref.mode;
    return out;
  }

  function load() {
    try { state = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) { state = emptyState(); }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function status(it) {
    const r = state.items[it.id];
    if (!r) return "new";
    if (r.done) return "mastered";
    if (r.due && r.due <= today()) return "due";
    return "learning";
  }

  const STATUS = {
    new: { cls: "status-new", label: "未学" },
    due: { cls: "status-review", label: "今天复习" },
    learning: { cls: "status-learning", label: "学习中" },
    mastered: { cls: "status-mastered", label: "已掌握" }
  };

  function dueItems() {
    return model.items.filter(it => status(it) === "due")
      .sort((a, b) => state.items[b.id].wrong - state.items[a.id].wrong || a.order - b.order);
  }

  function newItems() { return model.items.filter(it => !state.items[it.id]); }

  function wrongItems() {
    return model.items.filter(it => state.items[it.id] && state.items[it.id].wrong > 0)
      .sort((a, b) => state.items[b.id].wrong - state.items[a.id].wrong || a.order - b.order);
  }

  // 新词要在目标日前 2 天学完，留出最后一次复查。
  function newQuota() {
    const left = newItems().length;
    const days = Math.max(1, daysBetween(today(), TARGET) - 2);
    return Math.min(left, Math.max(BATCH, Math.ceil((left + learnedToday()) / days)));
  }

  function learnedToday() {
    const d = today();
    return Object.values(state.items).filter(r => r.first === d).length;
  }

  // 记录一次作答。kind: ok / hint / wrong；只有“默写”的对才推进掌握进度。
  function record(it, kind, typed, retry) {
    const d = today();
    const mode = session.mode;
    const r = state.items[it.id] || { step: -1, due: "", wrong: 0, hint: 0, seen: 0, done: false, first: "", last: "", typos: [] };
    const isNew = !state.items[it.id];
    if (kind !== "wrong" && mode === "listen" && isNew) return; // 听写拼对不算学过，默写时还会出现
    r.seen++;
    r.last = d;
    if (!r.first) r.first = d;
    if (kind === "wrong") {
      r.wrong++;
      if (typed) r.typos = r.typos.filter(t => t !== typed).concat(typed).slice(-3);
      r.step = 0;
      r.done = false;
      r.due = clampDue(addDays(d, STEPS[0]));
    } else if (retry || mode === "listen") {
      // 同一次练习里的重考、听写：只练不计。
    } else if (kind === "hint") {
      r.hint++;
      r.step = 0;
      r.done = false;
      r.due = clampDue(addDays(d, STEPS[0]));
    } else if (isNew) {
      r.step = STEPS.length - 1;
      r.due = clampDue(addDays(d, STEPS[STEPS.length - 1]));
    } else if (!r.done && r.due <= d) {
      r.step++;
      if (r.step >= STEPS.length) { r.done = true; r.due = ""; }
      else r.due = clampDue(addDays(d, STEPS[r.step]));
    }
    state.items[it.id] = r;
    save();
  }

  // ---------- 练习 ----------

  function startSession(items, label) {
    if (!items.length) return toast("没有要练的词");
    session = {
      label, mode: state.pref.mode, queue: items.map(it => ({ id: it.id, retry: 0 })), index: 0,
      results: {}, card: null, finished: false
    };
    startCard();
  }

  function current() { return model.itemMap.get(session.queue[session.index].id); }

  function startCard() {
    session.card = { phase: "answer", hinted: false, typed: "", kind: "", note: "" };
    render();
    if (session.mode === "listen") speak(current().text);
  }

  function submit(value) {
    const card = session.card;
    const it = current();
    const entry = session.queue[session.index];
    const typed = normAnswer(value);
    if (!typed) return focusInput();
    const ok = it.answers.includes(typed);
    if (!ok && session.mode === "write") {
      // 拼对了别的词（中文意思相近），不算错，提示换一个。
      const other = model.byAnswer.get(typed);
      if (other && other.id !== it.id) {
        card.note = `“${other.text}”是“${other.meaning}”，这里要的是另一个，看字母数再想想。`;
        render();
        return;
      }
    }
    card.typed = value.trim();
    card.kind = ok ? (card.hinted ? "hint" : "ok") : "wrong";
    card.phase = ok ? "done" : "copy";
    card.note = "";
    record(it, card.kind, ok ? "" : typed, entry.retry > 0);
    if (!entry.retry) session.results[it.id] = card.kind;
    else if (!ok && session.results[it.id] !== "wrong") session.results[it.id] = "wrong";
    if (!ok && entry.retry < MAX_REQUEUE) {
      session.queue.splice(Math.min(session.index + 1 + REQUEUE_GAP, session.queue.length), 0, { id: it.id, retry: entry.retry + 1 });
    }
    speak(it.text);
    render();
  }

  function giveUp() {
    const it = current();
    const entry = session.queue[session.index];
    const card = session.card;
    card.typed = "";
    card.kind = "wrong";
    card.phase = "copy";
    record(it, "wrong", "", entry.retry > 0);
    session.results[it.id] = "wrong";
    if (entry.retry < MAX_REQUEUE) {
      session.queue.splice(Math.min(session.index + 1 + REQUEUE_GAP, session.queue.length), 0, { id: it.id, retry: entry.retry + 1 });
    }
    speak(it.text);
    render();
  }

  // 拼错后照着正确拼写抄一遍才能继续。
  function copyCheck(value) {
    const it = current();
    if (it.answers.includes(normAnswer(value))) {
      session.card.phase = "done";
      session.card.copied = true;
      render();
    } else {
      session.card.note = "还不一样，对照上面的红字再写一遍。";
      render();
    }
  }

  function next() {
    session.index++;
    if (session.index >= session.queue.length) {
      session.finished = true;
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      render();
      return;
    }
    startCard();
  }

  function hint() {
    if (session.card.phase !== "answer") return;
    if (session.mode === "write") session.card.hinted = true;
    speak(current().text);
    render();
  }

  function setMode(mode) {
    state.pref.mode = mode;
    save();
    if (session && !session.finished && session.card.phase === "answer") {
      session.mode = mode;
      startCard();
    } else render();
  }

  function endSession() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    session = null;
    render();
  }

  // ---------- 拼写对比 ----------

  // 最长公共子序列：标出少写/写错的字母。
  function diff(typed, answer) {
    const a = typed, b = answer;
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        dp[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const keepA = new Array(a.length).fill(false), keepB = new Array(b.length).fill(false);
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i].toLowerCase() === b[j].toLowerCase()) { keepA[i++] = true; keepB[j++] = true; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const mark = (s, keep, cls) => [...s].map((ch, k) => keep[k] || ch === " " ? escapeHtml(ch) : `<b class="${cls}">${escapeHtml(ch)}</b>`).join("");
    return { typed: mark(a, keepA, "sp-extra"), answer: mark(b, keepB, "sp-miss"), same: dp[0][0] };
  }

  function closestAnswer(it, typed) {
    const t = normAnswer(typed);
    let best = it.answers[0], score = -1;
    for (const a of it.answers) {
      const s = diff(t, a).same;
      if (s > score) { score = s; best = a; }
    }
    return best;
  }

  // ---------- 渲染 ----------

  function setView(v) {
    view = v;
    document.querySelectorAll(".tab-button").forEach(b => {
      const on = b.dataset.view === v;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    if (!model) return;
    document.body.classList.toggle("sp-practicing", !!session);
    if (session) app.innerHTML = session.finished ? renderSessionDone() : renderCard();
    else if (view === "list") app.innerHTML = renderList();
    else if (view === "mistakes") app.innerHTML = renderMistakes();
    else app.innerHTML = renderToday();
    focusInput();
  }

  function focusInput() {
    const input = app.querySelector(".sp-input");
    if (input) input.focus();
  }

  function statsBar() {
    const total = model.items.length;
    const mastered = model.items.filter(it => status(it) === "mastered").length;
    const started = Object.keys(state.items).length;
    const left = daysBetween(today(), TARGET);
    return `<div class="stats-grid sp-stats">
      <div class="stat"><span class="stat-value">${mastered} / ${total}</span><span class="stat-label">已掌握</span><span class="stat-bar"><i style="width:${mastered / total * 100}%"></i></span></div>
      <div class="stat"><span class="stat-value">${started} / ${total}</span><span class="stat-label">学过至少一次</span><span class="stat-bar"><i style="width:${started / total * 100}%"></i></span></div>
      <div class="stat"><span class="stat-value">${dueItems().length} · ${wrongItems().length}</span><span class="stat-label">今天要复习 · 错过的词</span></div>
      <div class="stat"><span class="stat-value">${left > 0 ? left + " 天" : "今天"}</span><span class="stat-label">距 11 月 7 日全部掌握</span></div>
    </div>`;
  }

  function recommendations() {
    const d = today();
    const list = [];
    const due = dueItems();
    if (d >= RUSH_FROM) {
      const pending = model.items.filter(it => status(it) !== "mastered" || (state.items[it.id] && state.items[it.id].wrong));
      if (pending.length) list.push({ title: "考前过一遍 · " + pending.length + " 个", text: "没掌握的词和所有错过的词，各默写一遍。", items: () => shuffle(pending), primary: true });
    }
    if (due.length) {
      list.push({ title: "复习到期的词 · " + due.length + " 个", text: "错得多的先考。拼对一次往后推，拼错重新排。", items: () => due, primary: !list.length });
    }
    const fresh = newItems();
    if (fresh.length) {
      const quota = newQuota(), done = learnedToday();
      const n = Math.min(BATCH, fresh.length);
      list.push({ title: "新词一组 · " + n + " 个", text: `今天建议学 ${quota} 个新词，已学 ${done} 个；还剩 ${fresh.length} 个没学。`, items: () => shuffle(fresh.slice(0, n)), primary: !list.length });
    }
    const wrong = wrongItems().filter(it => status(it) !== "mastered");
    if (wrong.length) {
      list.push({ title: "错词加练 · " + wrong.length + " 个", text: "不等到期，把还没掌握的错词再默写一遍。加练拼对不推进进度，拼错照样记下。", items: () => shuffle(wrong) });
    }
    return list;
  }

  function renderToday() {
    const recs = recommendations();
    const cards = recs.map((r, i) => `<button class="sp-rec${r.primary ? " primary" : ""}" data-action="rec" data-index="${i}">
        <span class="sp-rec-title">${escapeHtml(r.title)}</span>
        <span class="sp-rec-text">${escapeHtml(r.text)}</span>
        <span class="sp-rec-go">开始 →</span>
      </button>`).join("");
    return `<section class="sp-lead">
        <p class="eyebrow">期中英语 · Unit 1–3 单词与词组 ${model.items.length} 个</p>
        <h2 class="lead-title">看中文，拼出英文</h2>
        <p class="lead-text">考试时没有发音，所以默认<b>先拼再听</b>：提交后不管对错都会读一遍。拼之前点“听一下”算提示，这个词明天再考。拼错的词要照着抄一遍，过几个再考；之后隔 1、2、3 天各考一次，都对才算掌握。</p>
      </section>
      ${statsBar()}
      <div class="section-heading"><h2>今天</h2><p>先复习，再学新词</p></div>
      <div class="sp-rec-grid">${cards || '<p class="sp-empty">全部掌握了！去“词表”里挑一个单元再默写一遍吧。</p>'}</div>`;
  }

  function lengthHint(it) {
    const words = it.answers[0].split(" ");
    return `<span class="sp-slots" aria-label="${words.map(w => w.length).join("、")} 个字母">${words.map(w => `<span class="sp-slot-word">${"<i></i>".repeat(w.length)}</span>`).join("")}</span>`;
  }

  function renderCard() {
    const it = current();
    const card = session.card;
    const listen = session.mode === "listen";
    const entry = session.queue[session.index];
    const showMeaning = !listen || card.phase !== "answer";
    const tag = (it.kind === "phrase" ? "词组" : "单词") + (it.quiz ? ' · <span class="sp-quiz">小测考点</span>' : "");
    let body = "";
    if (card.phase === "answer") {
      body = `<form class="sp-form" data-form="answer">
          <input class="sp-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="输入英文">
          <button class="primary-button" type="submit">提交 ⏎</button>
        </form>
        ${card.note ? `<p class="sp-note">${escapeHtml(card.note)}</p>` : ""}
        <div class="sp-tools">
          ${listen ? `<button class="secondary-button button-small" data-action="hint">🔊 再听一遍</button>`
                   : `<button class="secondary-button button-small" data-action="hint" title="听了发音再拼，这个词明天再考">🔊 听一下${card.hinted ? "（已提示）" : "（算提示）"}</button>`}
          <button class="text-button button-small" data-action="giveup">不会，看答案</button>
        </div>`;
    } else {
      const answer = card.kind === "wrong" && card.typed ? closestAnswer(it, card.typed) : it.answers[0];
      const d = card.kind === "wrong" && card.typed ? diff(card.typed, answer) : null;
      const verdict = card.kind === "ok" ? `<p class="sp-verdict ok">✓ 拼对了</p>`
        : card.kind === "hint" ? `<p class="sp-verdict hint">✓ 拼对了，但听了发音，明天再考一次</p>`
        : `<p class="sp-verdict wrong">✗ ${card.typed ? "拼错了" : "没关系，记住它"}</p>`;
      body = `${verdict}
        <div class="sp-answer">
          ${d ? `<p class="sp-typed">你写的：<span>${d.typed}</span></p><p class="sp-correct">正确：<span>${d.answer}</span></p>`
              : `<p class="sp-correct">${escapeHtml(it.text)}</p>`}
          ${d && answer !== normAnswer(it.text) ? `<p class="sp-full">${escapeHtml(it.text)}</p>` : ""}
          <p class="sp-phonetic">${it.phonetic ? escapeHtml(it.phonetic) + " · " : ""}<button class="text-button button-small" data-action="speak">🔊 再听</button></p>
        </div>
        ${card.phase === "copy" ? `<form class="sp-form" data-form="copy">
            <input class="sp-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="照着正确拼写输入一遍" aria-label="照着输入一遍">
            <button class="primary-button" type="submit">确认 ⏎</button>
          </form>
          ${card.note ? `<p class="sp-note">${escapeHtml(card.note)}</p>` : ""}`
        : `<div class="lead-actions"><button class="primary-button sp-next" data-action="next">下一个 ⏎</button></div>
           ${card.kind === "wrong" ? `<p class="sp-sub">隔几个会再考一次；明天起还会再出现。</p>` : ""}`}`;
    }
    const total = session.queue.length;
    return `<section class="sp-practice">
        <div class="view-head">
          <div class="view-head-main">
            <p class="view-kicker">${escapeHtml(session.label)} · 第 ${session.index + 1} / ${total} 个${entry.retry ? " · 重考" : ""}</p>
          </div>
          <div class="view-tools">
            <span class="sp-mode" role="group" aria-label="练习方式">
              <button class="${listen ? "" : "on"}" data-action="mode" data-mode="write" title="看中文拼写，和考试一样">默写</button>
              <button class="${listen ? "on" : ""}" data-action="mode" data-mode="listen" title="听发音拼写，练听音辨词">听写</button>
            </span>
            <button class="secondary-button button-small" data-action="end">结束</button>
          </div>
        </div>
        <div class="sp-card${card.phase === "answer" ? "" : " " + card.kind}">
          <p class="sp-tag">${tag}${listen ? " · 听写：拼错照样记下，拼对不计掌握" : ""}</p>
          ${showMeaning ? `<p class="sp-meaning">${escapeHtml(it.meaning)}</p>` : `<button class="sp-listen" data-action="hint" aria-label="再听一遍">🔊</button>`}
          ${card.phase === "answer" ? lengthHint(it) : ""}
          ${body}
        </div>
        <div class="sp-progress"><i style="width:${session.index / total * 100}%"></i></div>
      </section>`;
  }

  function renderSessionDone() {
    const ids = Object.keys(session.results);
    const count = k => ids.filter(id => session.results[id] === k).length;
    const wrong = ids.filter(id => session.results[id] === "wrong").map(id => model.itemMap.get(id));
    return `<section class="sp-practice sp-done">
        <p class="view-kicker">${escapeHtml(session.label)} · 完成</p>
        <h2 class="view-title">${wrong.length ? "辛苦了，错的词明天还会出现" : "全对，太棒了！"}</h2>
        <div class="sp-result">
          <div><b>${ids.length}</b><span>个词</span></div>
          <div class="c-good"><b>${count("ok")}</b><span>一次拼对</span></div>
          <div class="c-amber"><b>${count("hint")}</b><span>听了才拼对</span></div>
          <div class="c-red"><b>${wrong.length}</b><span>拼错</span></div>
        </div>
        ${wrong.length ? `<ul class="sp-done-list">${wrong.map(it => `<li><b>${escapeHtml(it.text)}</b> <span>${escapeHtml(it.meaning)}</span></li>`).join("")}</ul>
          <p class="sp-sub">把这些词在本子上各写 3 遍。</p>` : ""}
        <div class="lead-actions"><button class="primary-button sp-next" data-action="end">返回 ⏎</button></div>
      </section>`;
  }

  function itemRow(it, extra) {
    const st = STATUS[status(it)];
    const r = state.items[it.id];
    return `<li class="sp-row">
        <button class="sp-speak" data-action="speak-item" data-id="${it.id}" aria-label="朗读 ${escapeHtml(it.text)}">🔊</button>
        <span class="sp-row-main">
          <span class="sp-row-en">${escapeHtml(it.text)}${it.quiz ? ' <span class="sp-quiz">小测</span>' : ""}</span>
          <span class="sp-row-cn">${it.phonetic ? escapeHtml(it.phonetic) + " · " : ""}${escapeHtml(it.meaning)}</span>
          ${extra || ""}
        </span>
        <span class="sp-row-meta">${r && r.wrong ? `<span class="sp-wrong-count">错 ${r.wrong}</span>` : ""}<span class="status-chip ${st.cls}">${st.label}</span></span>
      </li>`;
  }

  function renderList() {
    const units = model.units.filter(u => !unitFilter || u.title === unitFilter);
    const unitOptions = model.units.map(u => `<option value="${escapeHtml(u.title)}"${u.title === unitFilter ? " selected" : ""}>${escapeHtml(u.title)} · ${escapeHtml(u.subtitle)}</option>`).join("");
    const statusOptions = Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === statusFilter ? " selected" : ""}>${v.label}</option>`).join("");
    const groups = units.map(u => {
      const items = u.items.filter(it => !statusFilter || status(it) === statusFilter);
      const left = u.items.filter(it => status(it) !== "mastered").length;
      if (!items.length) return "";
      return `<section class="lesson-group">
          <div class="group-head sp-group-head">
            <span class="group-title">${escapeHtml(u.title)} · ${escapeHtml(u.subtitle)}</span>
            <span class="sp-group-tools">
              <span class="group-count">${u.items.length - left} / ${u.items.length} 已掌握</span>
              ${left ? `<button class="secondary-button button-small" data-action="unit" data-unit="${escapeHtml(u.title)}">默写没掌握的 ${left} 个</button>` : ""}
            </span>
          </div>
          <ul class="sp-list">${items.map(it => itemRow(it)).join("")}</ul>
        </section>`;
    }).join("");
    return `${statsBar()}
      <div class="section-heading sp-filter">
        <h2>词表</h2>
        <span class="sp-filter-tools">
          <select class="piece-select" data-filter="unit" aria-label="按单元筛选"><option value="">全部单元</option>${unitOptions}</select>
          <select class="piece-select" data-filter="status" aria-label="按状态筛选"><option value="">全部状态</option>${statusOptions}</select>
        </span>
      </div>
      <div class="lesson-catalog">${groups || '<p class="sp-empty">没有符合条件的词。</p>'}</div>`;
  }

  function renderMistakes() {
    const list = wrongItems();
    const pending = list.filter(it => status(it) !== "mastered");
    const rows = list.map(it => {
      const r = state.items[it.id];
      const typos = r.typos.length ? `<span class="sp-typos">写错过：${r.typos.map(t => `<s>${escapeHtml(t)}</s>`).join(" ")}</span>` : "";
      return itemRow(it, typos);
    }).join("");
    return `<div class="section-heading sp-filter">
        <div><h2>错词本</h2><p>拼错过的词都在这里，错得多的排前面。拼错后要隔 1、2、3 天各拼对一次才算掌握。</p></div>
        <span class="sp-filter-tools">
          <button class="primary-button button-small" data-action="drill"${pending.length ? "" : " disabled"}>默写没掌握的 ${pending.length} 个</button>
          <button class="secondary-button button-small" data-action="print"${list.length ? "" : " disabled"}>打印</button>
        </span>
      </div>
      ${list.length ? `<ul class="sp-list sp-mistakes">${rows}</ul>` : '<p class="sp-empty">还没有拼错的词。</p>'}`;
  }

  // ---------- 事件 ----------

  function handleAction(el) {
    const a = el.dataset.action;
    if (a === "rec") { const r = recommendations()[+el.dataset.index]; return startSession(r.items(), r.title.split(" · ")[0]); }
    if (a === "unit") {
      const u = model.units.find(x => x.title === el.dataset.unit);
      return startSession(shuffle(u.items.filter(it => status(it) !== "mastered")), u.title);
    }
    if (a === "drill") return startSession(shuffle(wrongItems().filter(it => status(it) !== "mastered")), "错词默写");
    if (a === "print") return window.print();
    if (a === "speak-item") return speak(model.itemMap.get(el.dataset.id).text);
    if (a === "speak") return speak(current().text);
    if (a === "hint") return hint();
    if (a === "giveup") return giveUp();
    if (a === "next") return next();
    if (a === "mode") return setMode(el.dataset.mode);
    if (a === "end") return endSession();
  }

  function bind() {
    app.addEventListener("click", e => {
      const el = e.target.closest("[data-action]");
      if (el && !el.disabled) handleAction(el);
    });
    app.addEventListener("submit", e => {
      e.preventDefault();
      const value = e.target.querySelector(".sp-input").value;
      if (e.target.dataset.form === "answer") submit(value);
      else copyCheck(value);
    });
    app.addEventListener("change", e => {
      if (e.target.dataset.filter === "unit") { unitFilter = e.target.value; render(); }
      if (e.target.dataset.filter === "status") { statusFilter = e.target.value; render(); }
    });
    document.querySelectorAll(".tab-button").forEach(b => b.addEventListener("click", () => {
      if (session && !session.finished && !confirm("结束当前练习？已答的词会保存。")) return;
      session = null;
      setView(b.dataset.view);
    }));
    const menu = document.getElementById("moreMenu");
    document.querySelector('[data-action="more"]').addEventListener("click", e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
    document.querySelector('[data-action="reset"]').addEventListener("click", () => {
      menu.hidden = true;
      if (!confirm("清除全部单词进度和错词记录？这个操作不可撤销。")) return;
      state = emptyState();
      save();
      session = null;
      render();
      toast("已重置");
    });
    // 答完后输入框不在了，按回车进入下一个。
    document.addEventListener("keydown", e => {
      if (e.key !== "Enter" || !session || e.target.closest("input, select, textarea")) return;
      if (document.querySelector(".modal.show")) return;
      const btn = app.querySelector(".sp-next");
      if (btn) { e.preventDefault(); btn.click(); }
    });
  }

  function applySyncData(data) {
    state = normalize(data);
    save();
    if (!session) render();
  }

  async function init() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("数据加载失败（" + response.status + "）");
      model = buildModel(await response.json());
    } catch (error) {
      app.innerHTML = `<div class="fatal-error">${escapeHtml(error.message)}<br>请通过网站地址打开本页，而不是直接双击文件。</div>`;
      return;
    }
    load();
    bind();
    render();
    if (window.ReviewSync) {
      window.ReviewSync.init({
        deckKey: DECK_KEY,
        title: "八上英语期中拼写",
        app: "renai-english-grade8s-midterm-spelling",
        getData: () => state,
        applyData: applySyncData
      });
    }
  }

  init();
})();
