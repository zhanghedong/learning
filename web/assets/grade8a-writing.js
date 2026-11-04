(function () {
  "use strict";

  const DATA_URL = "../../../assets/data/pep-chinese-grade8a-writing.json";
  const STORAGE_KEY = "pep_chinese_grade8a_writing_v1";
  const DECK_KEY = "textbooks/pep/chinese/grade8a-writing";
  const SESSION_SIZE = 12;
  const MAX_REQUEUE = 2;              // 同一次练习里，一张卡最多再出现 2 次
  const REQUEUE_GAP = 3;              // 没记住的卡隔 3 张再出现
  const INTERVALS = [0, 1, 2, 4, 7];  // 盒子 0-4 对应的复习间隔（天）
  const MASTERED_BOX = 3;

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  let model = null;
  let state = emptyState();
  let view = "today";
  let lessonId = "";      // 课程页里正在看的课
  let session = null;     // 背诵卡练习
  let timer = null;       // { key, total, left, running }
  let toastTimer = null;
  let saveTimer = null;

  function emptyState() { return { version: 1, lessons: {}, texts: {}, checks: {}, cards: {} }; }

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
    return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
  }

  function shortDate(day) {
    const [, m, d] = day.split("-");
    return +m + "月" + +d + "日";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  // 内容里的 **粗体** 和换行
  function rich(text) {
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
  }

  // 作文按格子算字数：去掉空白，标点也算
  function countChars(text) { return String(text || "").replace(/\s/g, "").length; }

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

  // ---------- 内容模型 ----------

  function buildModel(data) {
    const lessons = data.lessons.map((l, i) => Object.assign({}, l, { index: i, date: addDays(data.startDate, i) }));
    const fieldKeys = new Set();
    const checkKeys = new Set();
    for (const l of lessons) {
      for (const b of l.blocks) {
        if (b.type === "write") b.fields.forEach(f => fieldKeys.add(b.id + "." + f.id));
        if (b.type === "checklist") b.items.forEach((_, i) => checkKeys.add(b.id + "." + i));
      }
    }
    const groups = [];
    for (const c of data.cards) if (!groups.includes(c.group)) groups.push(c.group);
    return {
      title: data.title, startDate: data.startDate, examDate: data.examDate,
      lessons, lessonMap: new Map(lessons.map(l => [l.id, l])),
      cards: data.cards, cardMap: new Map(data.cards.map(c => [c.id, c])), groups,
      fieldKeys, checkKeys
    };
  }

  // ---------- 进度 ----------

  function normalize(raw) {
    const out = emptyState();
    const obj = v => v && typeof v === "object";
    if (!obj(raw)) return out;
    if (obj(raw.lessons)) for (const [id, r] of Object.entries(raw.lessons)) if (model.lessonMap.has(id) && obj(r) && r.done) out.lessons[id] = { done: true, at: r.at || "" };
    if (obj(raw.texts)) for (const [k, v] of Object.entries(raw.texts)) if (model.fieldKeys.has(k) && typeof v === "string" && v) out.texts[k] = v;
    if (obj(raw.checks)) for (const [k, v] of Object.entries(raw.checks)) if (model.checkKeys.has(k) && v === true) out.checks[k] = true;
    if (obj(raw.cards)) for (const [id, r] of Object.entries(raw.cards)) {
      if (model.cardMap.has(id) && obj(r)) out.cards[id] = { box: Math.max(0, Math.min(4, +r.box || 0)), due: r.due || "", good: +r.good || 0, bad: +r.bad || 0, last: r.last || "" };
    }
    return out;
  }

  function load() {
    try { state = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) { state = emptyState(); }
  }

  function save() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  // 会：升一盒、按间隔推后；模糊：降一盒、明天再来；不会：回到 0 盒、今天就要再练。
  function schedule(id, rating) {
    const r = state.cards[id] || (state.cards[id] = { box: 0, due: "", good: 0, bad: 0, last: "" });
    const day = today();
    if (rating === "good") { r.box = Math.min(4, r.box + 1); r.due = addDays(day, INTERVALS[r.box]); r.good++; }
    else if (rating === "fuzzy") { r.box = Math.max(0, r.box - 1); r.due = addDays(day, 1); r.bad++; }
    else { r.box = 0; r.due = day; r.bad++; }
    r.last = day;
  }

  function cardsOf(group) { return model.cards.filter(c => !group || c.group === group); }
  function isDue(c) { const r = state.cards[c.id]; return !!r && !!r.due && r.due <= today(); }
  function isNew(c) { return !state.cards[c.id]; }
  function isMastered(c) { const r = state.cards[c.id]; return !!r && r.box >= MASTERED_BOX && !isDue(c); }

  // 今天的卡片：先到期复习，再按课程顺序补新卡（只补已经上过的课里的组）
  function todayCards() {
    const due = model.cards.filter(isDue);
    const openGroups = new Set();
    for (const l of model.lessons) {
      if (!lessonDone(l)) continue;
      l.blocks.filter(b => b.type === "cards").forEach(b => openGroups.add(b.group));
    }
    const fresh = model.cards.filter(c => isNew(c) && openGroups.has(c.group));
    return due.concat(fresh).slice(0, SESSION_SIZE);
  }

  function lessonDone(l) { return !!state.lessons[l.id]; }

  function writeBlocks(l) { return l.blocks.filter(b => b.type === "write"); }
  function blockWritten(b) { return b.fields.some(f => countChars(state.texts[b.id + "." + f.id]) > 0); }

  function nextLesson() {
    return model.lessons.find(l => !lessonDone(l)) || null;
  }

  // ---------- 渲染 ----------

  function render() {
    document.body.classList.toggle("wr-practicing", !!session);
    if (session) app.innerHTML = renderSession();
    else if (view === "today") app.innerHTML = renderToday();
    else if (view === "lessons") app.innerHTML = lessonId ? renderLesson(model.lessonMap.get(lessonId)) : renderLessonList();
    else if (view === "cards") app.innerHTML = renderCards();
    else app.innerHTML = renderBook();
    paintTimer();
  }

  function renderToday() {
    const left = daysBetween(today(), model.examDate);
    const doneN = model.lessons.filter(lessonDone).length;
    const next = nextLesson();
    const plannedIdx = Math.max(0, Math.min(model.lessons.length - 1, daysBetween(model.startDate, today())));
    const behind = next && next.index < plannedIdx ? plannedIdx - next.index : 0;
    const due = todayCards();
    const countdown = left > 0 ? `距期中考试还有 <b>${left}</b> 天` : left === 0 ? "<b>今天考试</b>，加油！" : "期中考试已结束";
    const nextCard = next
      ? `<button class="wr-rec primary" data-action="open-lesson" data-id="${next.id}" data-primary>
          <span class="wr-rec-kicker">第 ${next.index + 1} 课 · 约 ${next.minutes} 分钟</span>
          <span class="wr-rec-title">${escapeHtml(next.title)}</span>
          <span class="wr-rec-text">${escapeHtml(next.goal)}</span>
          <span class="wr-rec-go">开始上课 →</span>
        </button>`
      : `<div class="wr-rec primary">
          <span class="wr-rec-title">9 节课全部完成</span>
          <span class="wr-rec-text">考前每天读一遍素材本，背一轮卡片就够了。</span>
          <button class="wr-rec-go text-button" data-action="go" data-view="book">打开素材本 →</button>
        </div>`;
    const cardsCard = `<button class="wr-rec" data-action="start-today"${due.length ? "" : " disabled"}>
        <span class="wr-rec-kicker">背诵卡 · 约 ${Math.max(3, Math.ceil(due.length * 0.7))} 分钟</span>
        <span class="wr-rec-title">${due.length ? "今天要背 " + due.length + " 张" : "今天没有要背的卡片"}</span>
        <span class="wr-rec-text">${due.length ? "结构、慢镜头、开头结尾、景物好句……没记住的会自动再出现。" : "上完一节课会解锁这节课的卡片，背过的卡片会按记忆情况隔几天再出现。"}</span>
        ${due.length ? `<span class="wr-rec-go">开始背 →</span>` : ""}
      </button>`;
    const steps = model.lessons.map(l => {
      const cls = lessonDone(l) ? "done" : next && l.id === next.id ? "current" : "";
      return `<button class="wr-dot ${cls}" data-action="open-lesson" data-id="${l.id}" title="第 ${l.index + 1} 课 ${escapeHtml(l.title)}">${lessonDone(l) ? "✓" : l.index + 1}</button>`;
    }).join("");
    return `<section class="wr-hero">
        <div>
          <p class="eyebrow">${countdown}</p>
          <h2 class="lead-title">每天 30 分钟，从三类文写到二类文</h2>
          <p class="lead-text">先上今天的课（学方法、写练习），再背 10 分钟卡片。写下的素材、片段和作文都会收进“素材本”，考前读它就够了。</p>
        </div>
        <div class="wr-progress">
          <div class="wr-progress-head"><span>课程进度</span><b>${doneN} / ${model.lessons.length}</b></div>
          <div class="wr-dots">${steps}</div>
          ${behind ? `<p class="wr-behind">按计划今天该上第 ${plannedIdx + 1} 课，落后 ${behind} 课。可以一天上两课，限时作文那两课别跳过。</p>` : ""}
        </div>
      </section>
      <div class="wr-rec-grid">${nextCard}${cardsCard}</div>`;
  }

  function lessonStatus(l) {
    if (lessonDone(l)) return { cls: "status-mastered", label: "已完成" };
    const w = writeBlocks(l);
    const n = w.filter(blockWritten).length;
    if (n) return { cls: "status-learning", label: "写了 " + n + "/" + w.length };
    if (l.date === today()) return { cls: "status-review", label: "今天" };
    return { cls: "status-new", label: "未开始" };
  }

  function renderLessonList() {
    const rows = model.lessons.map(l => {
      const s = lessonStatus(l);
      return `<button class="piece-row wr-row" data-action="open-lesson" data-id="${l.id}">
          <span class="wr-row-num">${l.index + 1}</span>
          <span class="wr-row-main"><span class="wr-row-title">${escapeHtml(l.title)}</span><span class="wr-row-meta">建议 ${shortDate(l.date)} · 约 ${l.minutes} 分钟</span></span>
          <span class="status-chip ${s.cls}">${s.label}</span>
        </button>`;
    }).join("");
    return `<div class="view-head"><div class="view-head-main"><h2 class="view-title">9 节课</h2><p class="view-byline">按顺序上，一天一课；第 7、8 课是限时整篇作文，最好用纸笔写。</p></div></div>
      <div class="wr-list">${rows}</div>`;
  }

  function renderLesson(l) {
    const prev = model.lessons[l.index - 1];
    const next = model.lessons[l.index + 1];
    const w = writeBlocks(l);
    const written = w.filter(blockWritten).length;
    const done = lessonDone(l);
    return `<article class="wr-lesson">
        <div class="wr-lesson-top">
          <button class="text-button" data-action="back">← 全部课程</button>
          <span class="wr-lesson-meta">第 ${l.index + 1} 课 · 建议 ${shortDate(l.date)} · 约 ${l.minutes} 分钟</span>
        </div>
        <h2 class="wr-lesson-title">${escapeHtml(l.title)}</h2>
        <p class="wr-goal"><b>本课目标</b>${escapeHtml(l.goal)}</p>
        ${l.parent ? `<p class="wr-parent"><b>给家长</b>${escapeHtml(l.parent)}</p>` : ""}
        ${l.blocks.map(renderBlock).join("")}
        <footer class="wr-lesson-foot">
          <p class="wr-foot-note">${w.length ? `本课 ${w.length} 个练习，已写 ${written} 个。` : ""}${done ? "这节课已完成。" : written < w.length ? "练习都写完再点完成，效果最好。" : "练习都写好了！"}</p>
          <div class="wr-foot-actions">
            ${prev ? `<button class="secondary-button" data-action="open-lesson" data-id="${prev.id}">← 上一课</button>` : ""}
            ${done
              ? `<button class="secondary-button" data-action="undone" data-id="${l.id}">标为未完成</button>${next ? `<button class="primary-button" data-action="open-lesson" data-id="${next.id}">下一课 →</button>` : ""}`
              : `<button class="primary-button" data-action="done" data-id="${l.id}">完成本课 ✓</button>`}
          </div>
        </footer>
      </article>`;
  }

  function renderBlock(b) {
    const title = b.title ? `<h3 class="wr-block-title">${escapeHtml(b.title)}</h3>` : "";
    if (b.type === "teach") {
      return `<section class="wr-block">${title}${b.paras.map(p => `<p class="wr-p">${rich(p)}</p>`).join("")}</section>`;
    }
    if (b.type === "list") {
      const tag = b.ordered ? "ol" : "ul";
      return `<section class="wr-block">${title}<${tag} class="wr-ul">${b.items.map(i => `<li>${rich(i)}</li>`).join("")}</${tag}></section>`;
    }
    if (b.type === "table") {
      return `<section class="wr-block">${title}<div class="wr-table-wrap"><table class="wr-table">
          <thead><tr>${b.head.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
          <tbody>${b.rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${rich(c)}</td>` : `<th>${rich(c)}</th>`).join("")}</tr>`).join("")}</tbody>
        </table></div>${b.note ? `<p class="wr-note">${rich(b.note)}</p>` : ""}</section>`;
    }
    if (b.type === "compare") {
      const badLabel = b.badLabel || "三类文写法";
      const goodLabel = b.goodLabel || "二类文写法";
      return `<section class="wr-block">${title}${b.pairs.map(p => `<div class="wr-compare">
          <div class="wr-bad"><span class="wr-tag">${escapeHtml(badLabel)}</span>${rich(p.bad)}</div>
          <div class="wr-good"><span class="wr-tag">${escapeHtml(goodLabel)}</span>${rich(p.good)}</div>
          ${p.note ? `<p class="wr-note">${rich(p.note)}</p>` : ""}
        </div>`).join("")}</section>`;
    }
    if (b.type === "model") {
      return `<section class="wr-block">${title}<div class="wr-model">
          ${b.essayTitle ? `<h4 class="wr-model-title">${escapeHtml(b.essayTitle)}</h4>` : ""}
          ${b.paras.map(p => `<div class="wr-model-row"><span class="wr-model-label">${escapeHtml(p.label)}</span><p>${rich(p.text)}</p></div>`).join("")}
        </div>${b.note ? `<p class="wr-note">${rich(b.note)}</p>` : ""}</section>`;
    }
    if (b.type === "write") return renderWrite(b, title);
    if (b.type === "checklist") {
      const n = b.items.filter((_, i) => state.checks[b.id + "." + i]).length;
      return `<section class="wr-block wr-check" data-check="${b.id}">${title}
          <p class="wr-check-score"><b data-check-score="${b.id}">${n}</b> / ${b.items.length}</p>
          <ul class="wr-checklist">${b.items.map((it, i) => {
            const k = b.id + "." + i;
            return `<li><label><input type="checkbox" data-check-key="${k}"${state.checks[k] ? " checked" : ""}><span>${rich(it)}</span></label></li>`;
          }).join("")}</ul></section>`;
    }
    if (b.type === "cards") {
      const list = cardsOf(b.group);
      const m = list.filter(isMastered).length;
      return `<section class="wr-block wr-cards-cta">
          <div><b>${escapeHtml(b.text)}</b><span>“${escapeHtml(b.group)}” ${list.length} 张，已掌握 ${m} 张</span></div>
          <button class="secondary-button" data-action="drill-group" data-group="${escapeHtml(b.group)}">背这组卡片</button>
        </section>`;
    }
    return "";
  }

  function renderWrite(b, title) {
    const fields = b.fields.map(f => {
      const k = b.id + "." + f.id;
      const v = state.texts[k] || "";
      const n = countChars(v);
      const target = f.target ? ` / ${f.target}` : "";
      const big = (f.rows || 2) >= 8;
      return `<label class="wr-field${big ? " big" : ""}">
          ${f.label ? `<span class="wr-field-label">${escapeHtml(f.label)}</span>` : ""}
          <textarea class="wr-input" rows="${f.rows || 2}" data-key="${k}" data-target="${f.target || 0}" spellcheck="false">${escapeHtml(v)}</textarea>
          <span class="wr-count${f.target && n >= f.target ? " ok" : ""}" data-count="${k}">${n}${target} 字</span>
        </label>`;
    }).join("");
    const timerHtml = b.timer ? renderTimer(b) : "";
    return `<section class="wr-block wr-write">${title}
        ${b.prompt ? `<p class="wr-prompt">${rich(b.prompt)}</p>` : ""}
        ${timerHtml}
        ${fields}
        ${b.ref ? `<details class="wr-ref"><summary>写完再看参考</summary><p>${rich(b.ref)}</p></details>` : ""}
      </section>`;
  }

  function renderTimer(b) {
    const mine = timer && timer.key === b.id;
    const label = mine ? (timer.running ? "暂停" : timer.left > 0 ? "继续" : "重来") : "开始计时";
    return `<div class="wr-timer${mine && timer.left <= 0 ? " over" : ""}">
        <span class="wr-timer-clock" data-timer="${b.id}">${fmt(mine ? timer.left : b.timer * 60)}</span>
        <span class="wr-timer-label">限时 ${b.timer} 分钟</span>
        <button class="secondary-button button-small" data-action="timer" data-id="${b.id}" data-min="${b.timer}">${label}</button>
        ${mine ? `<button class="text-button" data-action="timer-reset">重置</button>` : ""}
      </div>`;
  }

  function fmt(sec) {
    sec = Math.max(0, sec);
    return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
  }

  function paintTimer() {
    if (!timer) return;
    const el = app.querySelector(`[data-timer="${timer.key}"]`);
    if (el) el.textContent = fmt(timer.left);
  }

  function tick() {
    if (!timer || !timer.running) return;
    timer.left = Math.max(0, Math.round((timer.endAt - Date.now()) / 1000));
    paintTimer();
    if (timer.left === 0) {
      timer.running = false;
      clearInterval(timer.handle);
      toast("时间到！检查一下结尾写完没有");
      refreshTimerBox();
    }
  }

  // 只重画计时器这一小块，避免打断正在输入的文字
  function refreshTimerBox() {
    const el = timer && app.querySelector(`[data-timer="${timer.key}"]`);
    if (!el) return;
    const lesson = model.lessonMap.get(lessonId);
    const b = lesson && lesson.blocks.find(x => x.id === timer.key);
    if (!b) return;
    const box = el.closest(".wr-timer");
    box.outerHTML = renderTimer(b);
  }

  function toggleTimer(id, minutes) {
    if (!timer || timer.key !== id) {
      if (timer) clearInterval(timer.handle);
      timer = { key: id, total: minutes * 60, left: minutes * 60, running: false };
    }
    if (timer.running) {
      timer.running = false;
      clearInterval(timer.handle);
    } else {
      if (timer.left <= 0) timer.left = timer.total;
      timer.endAt = Date.now() + timer.left * 1000;
      timer.running = true;
      timer.handle = setInterval(tick, 500);
    }
    refreshTimerBox();
  }

  function renderCards() {
    const due = todayCards();
    const rows = model.groups.map(g => {
      const list = cardsOf(g);
      const m = list.filter(isMastered).length;
      const n = list.filter(isNew).length;
      return `<div class="piece-row wr-group-row">
          <span class="wr-row-main"><span class="wr-row-title">${escapeHtml(g)}</span><span class="wr-row-meta">${list.length} 张 · 已掌握 ${m} · 没背过 ${n}</span></span>
          <span class="wr-bar"><i style="width:${Math.round(m / list.length * 100)}%"></i></span>
          <button class="secondary-button button-small" data-action="drill-group" data-group="${escapeHtml(g)}">背这组</button>
        </div>`;
    }).join("");
    const all = model.cards.length;
    const m = model.cards.filter(isMastered).length;
    return `<div class="view-head"><div class="view-head-main"><h2 class="view-title">背诵卡</h2><p class="view-byline">先在心里回答，再翻看答案。会的隔几天再出现，不会的今天还会再来。</p></div>
        <div class="view-tools"><button class="primary-button" data-action="start-today"${due.length ? "" : " disabled"}>今天的 ${due.length} 张</button></div></div>
      <p class="wr-summary">共 ${all} 张，已掌握 <b>${m}</b> 张。</p>
      <div class="wr-list">${rows}</div>
      <div class="wr-list-foot"><button class="text-button" data-action="drill-all">全部 ${all} 张随机背一遍 →</button></div>`;
  }

  function renderBook() {
    const sections = new Map();
    for (const l of model.lessons) {
      for (const b of writeBlocks(l)) {
        if (!b.book) continue;
        if (!sections.has(b.book)) sections.set(b.book, []);
        sections.get(b.book).push({ lesson: l, block: b });
      }
    }
    let filled = 0;
    const html = Array.from(sections.entries()).map(([name, items]) => {
      const body = items.map(({ lesson, block }) => {
        const rows = block.fields.map(f => {
          const v = state.texts[block.id + "." + f.id] || "";
          if (v) filled++;
          return `<div class="wr-book-field">${f.label ? `<span class="wr-book-label">${escapeHtml(f.label)}</span>` : ""}${v ? `<p>${escapeHtml(v).replace(/\n/g, "<br>")}</p>` : `<p class="wr-empty">还没写</p>`}</div>`;
        }).join("");
        return `<div class="wr-book-item">
            <div class="wr-book-head"><h4>${escapeHtml(block.title)}</h4><button class="text-button no-print" data-action="open-lesson" data-id="${lesson.id}">去第 ${lesson.index + 1} 课修改</button></div>
            ${rows}
          </div>`;
      }).join("");
      return `<section class="wr-book-section"><h3 class="wr-block-title">${escapeHtml(name)}</h3>${body}</section>`;
    }).join("");
    return `<div class="view-head"><div class="view-head-main"><h2 class="view-title">我的素材本</h2><p class="view-byline">上课时写下的素材、慢镜头、开头结尾和作文都在这里。考前一天读一遍，比背别人的范文管用。</p></div>
        <div class="view-tools no-print"><button class="secondary-button button-small" data-action="print">打印</button></div></div>
      ${filled ? "" : `<div class="wr-empty-box">还没有内容。从“今天”开始上第 1 课吧。</div>`}
      ${html}`;
  }

  // ---------- 背诵卡练习 ----------

  function startSession(cards, title) {
    if (!cards.length) return toast("没有要背的卡片");
    session = { title, queue: cards.map(c => c.id), idx: 0, extra: {}, tally: { good: 0, fuzzy: 0, bad: 0 }, firstSeen: new Set(), misses: [], shown: false, finished: false };
    render();
  }

  function rateCard(rating) {
    const id = session.queue[session.idx];
    if (!session.firstSeen.has(id)) {
      session.firstSeen.add(id);
      session.tally[rating]++;
      if (rating !== "good") session.misses.push(id);
      schedule(id, rating);
      save();
    }
    if (rating !== "good" && (session.extra[id] || 0) < MAX_REQUEUE) {
      session.extra[id] = (session.extra[id] || 0) + 1;
      session.queue.splice(Math.min(session.queue.length, session.idx + 1 + REQUEUE_GAP), 0, id);
    }
    session.idx++;
    session.shown = false;
    if (session.idx >= session.queue.length) session.finished = true;
    render();
  }

  function renderSession() {
    if (session.finished) {
      const t = session.tally;
      return `<div class="wr-practice">
          <h2 class="view-title">${escapeHtml(session.title)} · 完成</h2>
          <div class="summary-grid">
            <div class="summary-item"><strong class="c-good">${t.good}</strong><span>会</span></div>
            <div class="summary-item"><strong class="c-amber">${t.fuzzy}</strong><span>模糊</span></div>
            <div class="summary-item"><strong class="c-red">${t.bad}</strong><span>不会</span></div>
          </div>
          <p class="wr-p">${session.misses.length ? "下面这些已经安排了复习：不会的今天还会出现，模糊的明天再来。" : "全部一次就会！"}</p>
          ${session.misses.length ? `<ul class="wr-ul">${session.misses.map(id => `<li>${escapeHtml(model.cardMap.get(id).q)}</li>`).join("")}</ul>` : ""}
          <div class="lead-actions"><button class="primary-button" data-action="end" data-primary>返回 ⏎</button></div>
        </div>`;
    }
    const c = model.cardMap.get(session.queue[session.idx]);
    return `<div class="wr-practice">
        <div class="view-head">
          <span class="view-kicker">${escapeHtml(session.title)} · ${session.idx + 1} / ${session.queue.length}</span>
          <div class="view-tools"><button class="secondary-button button-small" data-action="end">结束</button></div>
        </div>
        <div class="wr-flash">
          <span class="wr-tag">${escapeHtml(c.group)}</span>
          <p class="wr-flash-q">${escapeHtml(c.q)}</p>
          ${session.shown
            ? `<p class="wr-flash-a">${rich(c.a)}</p>
               <div class="review-rate-row">
                 <button class="rate-button good" data-action="rate" data-rate="good" data-hotkey="1">会 <kbd>1</kbd></button>
                 <button class="rate-button hint" data-action="rate" data-rate="fuzzy" data-hotkey="2">模糊 <kbd>2</kbd></button>
                 <button class="rate-button bad" data-action="rate" data-rate="bad" data-hotkey="3">不会 <kbd>3</kbd></button>
               </div>`
            : `<p class="wr-flash-hint">先在心里说出答案，或者小声背出来。</p>
               <div class="question-actions"><button class="primary-button" data-action="show" data-primary>看答案 ⏎</button></div>`}
        </div>
      </div>`;
  }

  // ---------- 交互 ----------

  function openLesson(id) {
    view = "lessons";
    lessonId = id;
    syncTabs();
    render();
    window.scrollTo(0, 0);
  }

  function handleAction(el) {
    const a = el.dataset.action;
    if (a === "open-lesson") return openLesson(el.dataset.id);
    if (a === "back") { lessonId = ""; render(); return window.scrollTo(0, 0); }
    if (a === "go") return setView(el.dataset.view);
    if (a === "done") {
      state.lessons[el.dataset.id] = { done: true, at: today() };
      save();
      const l = model.lessonMap.get(el.dataset.id);
      toast("第 " + (l.index + 1) + " 课完成！");
      render();
      return;
    }
    if (a === "undone") { delete state.lessons[el.dataset.id]; save(); return render(); }
    if (a === "timer") return toggleTimer(el.dataset.id, +el.dataset.min);
    if (a === "timer-reset") {
      clearInterval(timer.handle);
      const key = timer.key;
      timer = null;
      const lesson = model.lessonMap.get(lessonId);
      const b = lesson && lesson.blocks.find(x => x.id === key);
      const box = app.querySelector(`[data-timer="${key}"]`);
      if (b && box) box.closest(".wr-timer").outerHTML = renderTimer(b);
      return;
    }
    if (a === "drill-group") return startSession(shuffle(cardsOf(el.dataset.group)), el.dataset.group);
    if (a === "drill-all") return startSession(shuffle(model.cards), "全部卡片");
    if (a === "start-today") return startSession(todayCards(), "今天的卡片");
    if (a === "show") { session.shown = true; return render(); }
    if (a === "rate") return rateCard(el.dataset.rate);
    if (a === "end") {
      if (!session.finished && session.idx > 0 && !confirm("结束这次练习？已背的卡片会保存。")) return;
      session = null;
      return render();
    }
    if (a === "print") return window.print();
  }

  function syncTabs() {
    document.querySelectorAll(".tab-button").forEach(b => {
      const on = b.dataset.view === view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function setView(v) {
    view = v;
    lessonId = "";
    syncTabs();
    render();
    window.scrollTo(0, 0);
  }

  function bind() {
    app.addEventListener("click", e => {
      const el = e.target.closest("[data-action]");
      if (el && !el.disabled) handleAction(el);
    });
    app.addEventListener("input", e => {
      const k = e.target.dataset.key;
      if (!k) return;
      const v = e.target.value;
      if (v) state.texts[k] = v; else delete state.texts[k];
      const n = countChars(v);
      const target = +e.target.dataset.target;
      const counter = app.querySelector(`[data-count="${k}"]`);
      if (counter) {
        counter.textContent = n + (target ? " / " + target : "") + " 字";
        counter.classList.toggle("ok", !!target && n >= target);
      }
      saveSoon();
    });
    app.addEventListener("change", e => {
      const k = e.target.dataset.checkKey;
      if (!k) return;
      if (e.target.checked) state.checks[k] = true; else delete state.checks[k];
      save();
      const id = k.slice(0, k.lastIndexOf("."));
      const score = app.querySelector(`[data-check-score="${id}"]`);
      if (score) score.textContent = Array.from(app.querySelectorAll(`[data-check-key^="${id}."]`)).filter(x => x.checked).length;
    });
    document.querySelectorAll(".tab-button").forEach(b => b.addEventListener("click", () => {
      if (session && !session.finished && session.idx > 0 && !confirm("结束这次练习？已背的卡片会保存。")) return;
      session = null;
      setView(b.dataset.view);
    }));
    const menu = document.getElementById("moreMenu");
    document.querySelector('[data-action="more"]').addEventListener("click", e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
    document.querySelector('[data-action="reset"]').addEventListener("click", () => {
      menu.hidden = true;
      if (!confirm("清除全部课程进度、写过的文字和背诵记录？这个操作不可撤销。")) return;
      state = emptyState();
      save();
      session = null;
      render();
      toast("已重置");
    });
    // ⏎ / 空格 点主按钮，数字键点评分
    document.addEventListener("keydown", e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest("input, textarea, select, button")) return;
      if (!session) return;
      if (e.key === "Enter" || e.key === " ") {
        const primary = app.querySelector("[data-primary]:not(:disabled)");
        if (primary) { e.preventDefault(); primary.click(); }
        return;
      }
      if (/^[1-3]$/.test(e.key)) {
        const btn = app.querySelector(`[data-hotkey="${e.key}"]:not(:disabled)`);
        if (btn) { e.preventDefault(); btn.click(); }
      }
    });
    window.addEventListener("pagehide", save);
  }

  function applySyncData(data) {
    state = normalize(data && data.status);
    save();
    // 正在输入时不重画，免得光标跳走；下次切换页面时自然更新
    if (!session && !(document.activeElement && document.activeElement.matches("textarea"))) render();
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
        title: "八上语文作文提高",
        app: "pep-chinese-grade8a-writing",
        getData: () => ({ status: state, pref: { version: 1 } }),
        applyData: applySyncData
      });
    }
  }

  init();
})();
