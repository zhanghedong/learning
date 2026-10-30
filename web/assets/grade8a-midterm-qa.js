(function () {
  "use strict";

  const DATA_URL = "../../../assets/data/pep-chinese-grade8a-midterm-qa.json";
  const STORAGE_KEY = "pep_chinese_grade8a_midterm_qa_v1";
  const DECK_KEY = "textbooks/pep/chinese/grade8a-midterm-qa";
  const SESSION_SIZE = 12;
  const MAX_REQUEUE = 2;              // 同一次练习里，一题最多再出现 2 次
  const REQUEUE_GAP = 3;              // 没答好的题隔 3 题再出现
  const INTERVALS = [0, 1, 2, 4, 7];  // 盒子 0-4 对应的复习间隔（天）
  const MASTERED_BOX = 3;
  const TAG_ORDER = ["通假字", "使动用法", "词类活用", "古今异义", "特殊句式", "重点词语"];
  const PATTERN_TAG = "特殊句式";
  const KIND_LABEL = { wenyan: "文言翻译", qa: "问答", judge: "体裁辨析" };
  const RATE_LABEL = { good: "会", fuzzy: "模糊", bad: "不会" };

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  let model = null;
  let state = emptyState();
  let view = "today";
  let bankFilter = "";
  let expanded = "";
  let onlyWrongWords = false;
  let session = null;
  let step = null;      // 当前这一题的作答进度
  let toastTimer = null;

  function emptyState() { return { version: 1, cards: {}, words: {} }; }

  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function addDays(day, n) {
    const d = new Date(day + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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

  // ---------- 内容模型 ----------

  // 关键词在句中的字位置；“其如……何”这类格式按顺序分段查找。
  function locate(chars, word, label) {
    const out = [];
    let pos = 0;
    for (const part of word.split("……")) {
      const p = Array.from(part);
      let found = -1;
      for (let i = pos; i + p.length <= chars.length && found < 0; i++) {
        if (p.every((ch, k) => chars[i + k] === ch)) found = i;
      }
      if (found < 0) throw new Error(label + " 中找不到关键词“" + word + "”");
      for (let k = 0; k < p.length; k++) out.push(found + k);
      pos = found + p.length;
    }
    return out;
  }

  function buildModel(data) {
    const cards = data.cards.map(raw => {
      const card = Object.assign({}, raw);
      if (card.kind === "wenyan") {
        card.chars = Array.from(card.sentence);
        card.keys = card.keys.map((k, i) => Object.assign({}, k, {
          id: card.id + "-k" + i, index: i, card, at: locate(card.chars, k.word, card.source)
        }));
      }
      return card;
    });
    const words = cards.filter(c => c.kind === "wenyan").flatMap(c => c.keys);
    const genreNames = data.genres.headers.slice(1);
    return {
      genres: data.genres, genreNames, cards, words,
      cardMap: new Map(cards.map(c => [c.id, c])),
      wordMap: new Map(words.map(w => [w.id, w]))
    };
  }

  // ---------- 进度 ----------

  function normalize(raw) {
    const out = emptyState();
    const obj = v => v && typeof v === "object";
    if (!obj(raw)) return out;
    const rec = r => ({ box: Math.max(0, Math.min(4, +r.box || 0)), due: r.due || "", good: +r.good || 0, bad: +r.bad || 0, last: r.last || "" });
    if (obj(raw.cards)) for (const [id, r] of Object.entries(raw.cards)) if (model.cardMap.has(id) && obj(r)) out.cards[id] = rec(r);
    if (obj(raw.words)) for (const [id, r] of Object.entries(raw.words)) if (model.wordMap.has(id) && obj(r)) out.words[id] = rec(r);
    return out;
  }

  function load() {
    try { state = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) { state = emptyState(); }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // 会：升一盒、按间隔推后；模糊：降一盒、明天再来；不会：回到 0 盒、今天就要再练。
  function schedule(table, id, rating) {
    const r = table[id] || (table[id] = { box: 0, due: "", good: 0, bad: 0, last: "" });
    const day = today();
    if (rating === "good") { r.box = Math.min(4, r.box + 1); r.due = addDays(day, INTERVALS[r.box]); r.good++; }
    else if (rating === "fuzzy") { r.box = Math.max(0, r.box - 1); r.due = addDays(day, 1); r.bad++; }
    else { r.box = 0; r.due = day; r.bad++; }
    r.last = day;
  }

  function cardStatus(card) {
    const r = state.cards[card.id];
    if (!r) return { cls: "status-new", label: "未学" };
    if (r.due && r.due <= today()) return { cls: "status-review", label: "今天复习" };
    if (r.box >= MASTERED_BOX) return { cls: "status-mastered", label: "已掌握" };
    return { cls: "status-learning", label: "学习中" };
  }

  function isDue(table, id) {
    const r = table[id];
    return !!r && r.due <= today();
  }

  function wrongWords() {
    return model.words.filter(w => { const r = state.words[w.id]; return r && r.bad > 0 && r.box < MASTERED_BOX; });
  }

  function todayPlan() {
    const due = model.cards.filter(c => isDue(state.cards, c.id))
      .sort((a, b) => state.cards[a.id].box - state.cards[b.id].box);
    const fresh = model.cards.filter(c => !state.cards[c.id]);
    const room = Math.max(0, SESSION_SIZE - due.length);
    return { due, fresh: fresh.slice(0, room), all: due.concat(fresh.slice(0, room)) };
  }

  // ---------- 练习 ----------

  function cardItem(card) { return { type: "card", card, id: card.id }; }
  function wordItem(word) { return { type: "word", word, card: word.card, id: word.id }; }

  function startSession(items, title) {
    if (!items.length) { toast("没有需要练的题"); return; }
    session = { title, queue: items, idx: 0, seen: {}, tally: { good: 0, fuzzy: 0, bad: 0 }, misses: [], finished: false };
    beginItem();
    render();
    window.scrollTo({ top: 0 });
  }

  function beginItem() {
    const item = session.queue[session.idx];
    const card = item.card;
    step = { item, rating: null };
    if (item.type === "word") step.stage = "ask";
    else if (card.kind === "wenyan") Object.assign(step, { stage: "words", marks: card.keys.map(() => null), shown: card.keys.map(() => false) });
    else if (card.kind === "qa") Object.assign(step, { stage: card.choice ? "choice" : "recall", picked: null, checks: card.points.map(() => false) });
    else Object.assign(step, { stage: "ask", picked: null });
  }

  // 每题在本次练习的第一次作答决定复习安排；重做答对只把它挪到明天。
  function finishItem(rating) {
    const item = step.item;
    const table = item.type === "word" ? state.words : state.cards;
    const repeat = !!session.seen[item.id];
    if (!repeat) {
      schedule(table, item.id, rating);
      session.tally[rating]++;
      if (rating !== "good") session.misses.push(item);
    } else if (rating === "good") {
      table[item.id].due = addDays(today(), 1);
    }
    session.seen[item.id] = (session.seen[item.id] || 0) + 1;
    if (rating !== "good" && session.seen[item.id] <= MAX_REQUEUE) {
      session.queue.splice(Math.min(session.idx + 1 + REQUEUE_GAP, session.queue.length), 0, item);
      toast(rating === "bad" ? "没关系，过几题再来一次" : "稍后再巩固一次");
    }
    save();
    step.rating = rating;
  }

  function markWord(word, ok) {
    schedule(state.words, word.id, ok ? "good" : "bad");
  }

  function nextItem() {
    session.idx++;
    if (session.idx >= session.queue.length) { session.finished = true; step = null; }
    else beginItem();
    render();
    window.scrollTo({ top: 0 });
  }

  function endSession() {
    session = null;
    step = null;
    render();
  }

  // ---------- 渲染 ----------

  function sentenceHtml(card, opts) {
    opts = opts || {};
    const marks = card.chars.map(() => ({ cls: [], num: "" }));
    card.keys.forEach(k => {
      if (opts.only && opts.only !== k) return;
      const pattern = k.tag === PATTERN_TAG;
      k.at.forEach((pos, n) => {
        marks[pos].cls.push(pattern ? "kp-pattern" : "kp-word");
        if (opts.active === k) marks[pos].cls.push("kp-active");
        if (opts.marks && opts.marks[k.index] === false) marks[pos].cls.push("kp-miss");
        if (n === 0 && opts.numbers) marks[pos].num = circled(k.index);
      });
    });
    return card.chars.map((ch, i) => {
      const m = marks[i];
      const num = m.num ? `<sup class="kp-num">${m.num}</sup>` : "";
      return m.cls.length ? `<span class="${m.cls.join(" ")}">${num}${escapeHtml(ch)}</span>` : escapeHtml(ch);
    }).join("");
  }

  function circled(i) { return String.fromCharCode(0x2460 + i); }

  function genresTable() {
    const g = model.genres;
    return `<table class="qa-genres">
      <thead><tr>${g.headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${g.rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${escapeHtml(c)}</td>` : `<th>${escapeHtml(c)}</th>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  }

  function render() {
    if (!model) return;
    document.body.classList.toggle("qa-practicing", !!session);
    if (session) app.innerHTML = session.finished ? renderSessionDone() : renderPractice();
    else if (view === "bank") app.innerHTML = renderBank();
    else if (view === "words") app.innerHTML = renderWords();
    else app.innerHTML = renderToday();
  }

  function statsBar() {
    const total = model.cards.length;
    const mastered = model.cards.filter(c => cardStatus(c).cls === "status-mastered").length;
    const touched = model.cards.filter(c => state.cards[c.id]).length;
    const due = model.cards.filter(c => isDue(state.cards, c.id)).length;
    const wrong = wrongWords().length;
    return `<div class="stats-grid">
      <div class="stat"><span class="stat-value">${mastered} / ${total}</span><span class="stat-label">题已掌握（连续答对 3 次）</span><span class="stat-bar"><i style="width:${mastered / total * 100}%"></i></span></div>
      <div class="stat"><span class="stat-value">${touched} / ${total}</span><span class="stat-label">题练过至少一次</span><span class="stat-bar"><i style="width:${touched / total * 100}%"></i></span></div>
      <div class="stat"><span class="stat-value">${due}</span><span class="stat-label">题今天要复习 · ${wrong} 个易错字词</span></div>
    </div>`;
  }

  function recommendations() {
    const plan = todayPlan();
    const recs = [];
    if (plan.all.length) {
      const parts = [];
      if (plan.due.length) parts.push(plan.due.length + " 道复习");
      if (plan.fresh.length) parts.push(plan.fresh.length + " 道新题");
      recs.push({ primary: true, title: "今天的练习 · " + plan.all.length + " 题", text: parts.join(" + ") + "。先复习到期的，再学新的。", go: "开始 ⏎",
        run: () => startSession(plan.all.map(cardItem), "今天的练习") });
    } else {
      recs.push({ primary: true, title: "今天的题都完成了", text: "到期的复习和新题都练完了。想多练可以随机抽 12 题。", go: "随机抽 12 题 ⏎",
        run: () => startSession(shuffle(model.cards).slice(0, SESSION_SIZE).map(cardItem), "随机抽题") });
    }
    const ww = wrongWords();
    if (ww.length) recs.push({ title: "易错字词 · " + ww.length + " 个", text: "只练翻译里没记住的关键字，一个字一张卡。", go: "开始速记",
      run: () => startSession(shuffle(ww).map(wordItem), "易错字词") });
    const wenyan = model.cards.filter(c => c.kind === "wenyan");
    recs.push({ title: "文言翻译专练 · " + wenyan.length + " 句", text: "先逐个说出关键字的意思，再完整翻译整句。", go: "开始专练",
      run: () => startSession(shuffle(wenyan).map(cardItem), "文言翻译专练") });
    if (!ww.length) recs.push({ title: "全部字词过一遍 · " + model.words.length + " 个", text: "把所有关键字词按通假、使动、古今异义等混在一起考一遍。", go: "开始速记",
      run: () => startSession(shuffle(model.words).map(wordItem), "全部字词") });
    return recs;
  }

  let currentRecs = [];

  function renderToday() {
    currentRecs = recommendations();
    const cards = currentRecs.map((r, i) => `<button class="qa-rec${r.primary ? " primary" : ""}" data-action="rec" data-index="${i}">
        <span class="qa-rec-title">${escapeHtml(r.title)}</span>
        <span class="qa-rec-text">${escapeHtml(r.text)}</span>
        <span class="qa-rec-go">${escapeHtml(r.go)}</span>
      </button>`).join("");
    return `<section class="qa-lead">
        <p class="eyebrow">期中复习 · 新闻 / 名著 / 课文 / 文言翻译</p>
        <h2 class="lead-title">先自己想，再对答案</h2>
        <p class="lead-text">每题都先回想、说出来，再看答案自评。答错或模糊的题过几题会再出现，之后按 1、2、4、7 天的间隔复习，<b>连续答对 3 次</b>就算掌握。</p>
      </section>
      ${statsBar()}
      <div class="qa-rec-grid">${cards}</div>`;
  }

  function cardTitle(card) {
    if (card.kind === "wenyan") return card.sentence;
    if (card.kind === "judge") return card.material;
    return card.question;
  }

  function renderBank() {
    const filters = [["", "全部"], ["wenyan", "文言翻译"], ["qa", "问答"], ["judge", "体裁辨析"]];
    const chips = filters.map(([k, label]) => {
      const n = k ? model.cards.filter(c => c.kind === k).length : model.cards.length;
      return `<button class="qa-chip${bankFilter === k ? " active" : ""}" data-action="bank-filter" data-kind="${k}">${label} <span>${n}</span></button>`;
    }).join("");
    const list = model.cards.filter(c => !bankFilter || c.kind === bankFilter);
    const groups = [];
    for (const c of list) {
      let g = groups.find(x => x.source === c.source);
      if (!g) groups.push(g = { source: c.source, unit: c.unit, cards: [] });
      g.cards.push(c);
    }
    const showTable = !bankFilter || bankFilter === "judge";
    return `<div class="section-heading qa-bank-head"><h2>题库</h2><p>点开一题可以先看答案学习，也可以单独练。</p></div>
      <div class="qa-chips">${chips}</div>
      ${showTable ? `<details class="qa-genre-box"${bankFilter === "judge" ? " open" : ""}><summary>消息 · 新闻特写 · 通讯 对比表</summary>${genresTable()}</details>` : ""}
      <div class="lesson-catalog">${groups.map(g => `<section class="lesson-group">
          <div class="group-head"><span class="group-title">${escapeHtml(g.source)}</span><span class="group-count">${escapeHtml(g.unit)} · ${g.cards.length} 题</span></div>
          ${g.cards.map(renderBankRow).join("")}
        </section>`).join("")}</div>`;
  }

  function renderBankRow(card) {
    const st = cardStatus(card);
    const open = expanded === card.id;
    const r = state.cards[card.id];
    const meta = r ? `答对 ${r.good} 次 · 答错 ${r.bad} 次` : "";
    return `<button class="piece-row qa-row" data-action="expand" data-card="${card.id}" aria-expanded="${open}">
        <span class="qa-row-kind">${KIND_LABEL[card.kind]}</span>
        <span class="qa-row-title${card.kind === "wenyan" ? " kai" : ""}">${escapeHtml(cardTitle(card))}</span>
        <span class="status-chip ${st.cls}">${st.label}</span>
      </button>
      ${open ? `<div class="qa-detail">${answerHtml(card)}
        <div class="qa-detail-foot"><span>${meta}</span><button class="primary-button button-small" data-action="practice-one" data-card="${card.id}">练这一题</button></div>
      </div>` : ""}`;
  }

  function answerHtml(card) {
    if (card.kind === "wenyan") {
      return `<p class="qa-sentence small">${sentenceHtml(card, { numbers: true })}</p>
        <p class="qa-translation">${escapeHtml(card.translation)}</p>
        <ol class="qa-keylist">${card.keys.map(k => `<li><b>${circled(k.index)} ${escapeHtml(k.word)}</b>${escapeHtml(k.meaning)}<span class="qa-tag">${escapeHtml(k.tag)}</span></li>`).join("")}</ol>`;
    }
    if (card.kind === "judge") {
      return `<p class="qa-answer-line">答案：<b>${escapeHtml(card.answer)}</b></p><p class="qa-note">${escapeHtml(card.why)}</p>`;
    }
    return `<ol class="qa-points-static">${card.points.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ol>
      ${card.note ? `<p class="qa-note">${escapeHtml(card.note)}</p>` : ""}
      ${card.showGenres ? genresTable() : ""}`;
  }

  function renderWords() {
    const ww = new Set(wrongWords().map(w => w.id));
    const list = model.words.filter(w => !onlyWrongWords || ww.has(w.id));
    const groups = TAG_ORDER.map(tag => ({ tag, words: list.filter(w => w.tag === tag) })).filter(g => g.words.length);
    return `<div class="view-head qa-words-head">
        <div><h2 class="view-title">字词本</h2><p class="qa-sub">文言翻译里的关键字词，按考点归类。通假字、使动用法、古今异义放在一起记更不容易混。</p></div>
        <div class="qa-words-tools">
          <label class="toggle-label"><input type="checkbox" data-action="only-wrong"${onlyWrongWords ? " checked" : ""}> 只看易错（${ww.size}）</label>
          <button class="secondary-button button-small" data-action="drill-words"${list.length ? "" : " disabled"}>练这些字词</button>
          <button class="secondary-button button-small" data-action="print">打印</button>
        </div>
      </div>
      ${groups.length ? groups.map(g => `<section class="qa-word-group">
          <h3>${escapeHtml(g.tag)} <span>${g.words.length}</span></h3>
          <ul class="qa-word-list">${g.words.map(w => renderWordRow(w, ww.has(w.id))).join("")}</ul>
        </section>`).join("") : `<div class="qa-empty">还没有易错字词。做文言翻译时标了“没记住”的字会出现在这里。</div>`}`;
  }

  function renderWordRow(w, wrong) {
    const r = state.words[w.id];
    return `<li class="qa-word${wrong ? " wrong" : ""}">
        <span class="qa-word-chip">${escapeHtml(w.word.replace("……", "…"))}</span>
        <span class="qa-word-body">
          <span class="qa-word-meaning">${escapeHtml(w.meaning)}</span>
          <span class="qa-word-context">${sentenceHtml(w.card, { only: w })}</span>
          <span class="qa-word-meta">${escapeHtml(w.card.source)}${r && r.bad ? ` · 没记住 ${r.bad} 次` : ""}</span>
        </span>
      </li>`;
  }

  // ---------- 练习界面 ----------

  function renderPractice() {
    const item = step.item;
    const card = item.card;
    const n = session.idx + 1;
    const total = session.queue.length;
    const kicker = item.type === "word" ? "字词速记 · " + item.word.tag : KIND_LABEL[card.kind];
    let body;
    if (item.type === "word") body = renderWordStep();
    else if (card.kind === "wenyan") body = renderWenyanStep();
    else if (card.kind === "qa") body = renderQaStep();
    else body = renderJudgeStep();
    return `<div class="qa-practice">
        <div class="view-head">
          <div class="view-head-main"><div class="view-kicker">${escapeHtml(session.title)}</div></div>
          <div class="view-tools"><button class="secondary-button button-small" data-action="end">结束</button></div>
        </div>
        <div class="quiz-progress"><span>${n} / ${total}</span><div class="progress-track"><i style="width:${(n - 1) / total * 100}%"></i></div></div>
        <article class="qa-card">
          <div class="question-label">${escapeHtml(kicker)} · ${escapeHtml(card.source)} <span class="qa-unit">${escapeHtml(card.unit)}</span></div>
          ${body}
        </article>
      </div>`;
  }

  function rateRow(labels) {
    return `<div class="review-rate-row qa-rate">
        <button class="rate-button good" data-action="rate" data-rate="good" data-hotkey="1">${labels ? labels[0] : "会"} <kbd>1</kbd></button>
        <button class="rate-button hint" data-action="rate" data-rate="fuzzy" data-hotkey="2">${labels ? labels[1] : "模糊"} <kbd>2</kbd></button>
        <button class="rate-button bad" data-action="rate" data-rate="bad" data-hotkey="3">${labels ? labels[2] : "不会"} <kbd>3</kbd></button>
      </div>`;
  }

  function nextButton() {
    return `<div class="question-actions"><button class="primary-button" data-action="next" data-primary>下一题 ⏎</button></div>`;
  }

  function renderWenyanStep() {
    const card = step.item.card;
    const cur = step.marks.indexOf(null);
    const active = cur >= 0 ? card.keys[cur] : null;
    const rows = card.keys.map((k, i) => {
      const m = step.marks[i];
      const st = m === true ? "ok" : m === false ? "miss" : i === cur ? "current" : "wait";
      let right = "";
      if (i === cur && !step.shown[i]) right = `<button class="secondary-button button-small" data-action="show-word" data-primary>显示 ⏎</button>`;
      else if (i === cur) right = `<span class="qa-mark-btns"><button class="rate-button good button-small" data-action="mark-word" data-ok="1" data-hotkey="1">记得 <kbd>1</kbd></button><button class="rate-button bad button-small" data-action="mark-word" data-ok="0" data-hotkey="2">没记住 <kbd>2</kbd></button></span>`;
      else if (m !== null) right = `<span class="qa-mark ${st}">${m ? "✓" : "✗"}</span>`;
      const meaning = step.shown[i] ? `<span class="qa-key-meaning">${escapeHtml(k.meaning)}</span>` : i === cur ? `<span class="qa-key-ask">${k.tag === PATTERN_TAG ? "这是什么句式？怎么理解？" : "是什么意思？"}说出来再点显示</span>` : "";
      return `<li class="qa-key ${st}"><span class="qa-key-word"><b>${circled(i)}</b> ${escapeHtml(k.word)}<span class="qa-tag">${escapeHtml(k.tag)}</span></span>${meaning}<span class="qa-key-right">${right}</span></li>`;
    }).join("");
    let translate = "";
    if (cur < 0) {
      const missed = step.marks.filter(m => m === false).length;
      if (step.stage === "words") step.stage = "translate";
      translate = `<section class="qa-step">
          <h3 class="qa-step-title">第二步 · 整句翻译</h3>
          ${step.stage === "translate"
            ? `<p class="qa-hint">把整句翻译完整说出来（关键字都要落实），再看参考译文。</p>
               <div class="question-actions"><button class="primary-button" data-action="show-translation" data-primary>显示译文 ⏎</button></div>`
            : `<p class="qa-translation">${escapeHtml(card.translation)}</p>
               ${step.rating ? rateResult() : `<p class="qa-hint">和你说的对比一下：${missed ? `有 ${missed} 个关键字没记住，最多只能选“模糊”。` : "意思对、关键字都落实了才算“会”。"}</p>${rateRow()}`}`}
        </section>`;
    }
    return `<p class="qa-sentence">${sentenceHtml(card, { numbers: true, active, marks: step.marks })}</p>
      <section class="qa-step">
        <h3 class="qa-step-title">第一步 · 关键字词</h3>
        <ol class="qa-keys">${rows}</ol>
      </section>
      ${translate}`;
  }

  function rateResult() {
    const msg = { good: "记为“会”，过几天再复习。", fuzzy: "记为“模糊”，明天再复习。", bad: "记为“不会”，今天还会再练。" }[step.rating];
    return `<div class="feedback ${step.rating === "good" ? "correct" : "wrong"}">${msg}</div>${nextButton()}`;
  }

  function renderQaStep() {
    const card = step.item.card;
    let html = `<p class="question-prompt">${escapeHtml(card.question)}</p>`;
    if (step.stage === "choice") {
      const c = card.choice;
      return html + `<p class="qa-hint">${escapeHtml(c.prompt)}</p>
        <div class="choices">${c.options.map((o, i) => `<button class="choice-button" data-action="pick" data-index="${i}" data-hotkey="${i + 1}"><kbd>${i + 1}</kbd> ${escapeHtml(o)}</button>`).join("")}</div>`;
    }
    if (step.picked != null) {
      const ok = step.picked === card.choice.answer;
      html += `<div class="feedback ${ok ? "correct" : "wrong"} qa-choice-fb">${ok ? "选对了。" : "选错了，正确答案是“" + escapeHtml(card.choice.options[card.choice.answer]) + "”。"}接下来把完整答案说出来。</div>`;
    }
    if (step.stage === "recall") {
      return html + `<p class="qa-hint">先在心里或说出来回答，${card.points.length} 个要点都想一想，再看答案。</p>
        <div class="question-actions"><button class="primary-button" data-action="show-points" data-primary>看要点 ⏎</button></div>`;
    }
    const hit = step.checks.filter(Boolean).length;
    const points = card.points.map((p, i) => step.stage === "check"
      ? `<li><button class="qa-point${step.checks[i] ? " on" : ""}" data-action="check" data-index="${i}" data-hotkey="${i + 1}"><span class="qa-box">${step.checks[i] ? "✓" : ""}</span><span>${escapeHtml(p)}</span><kbd>${i + 1}</kbd></button></li>`
      : `<li class="qa-point static${step.checks[i] ? " on" : " off"}"><span class="qa-box">${step.checks[i] ? "✓" : "✗"}</span><span>${escapeHtml(p)}</span></li>`).join("");
    html += `<p class="qa-hint">${step.stage === "check" ? "点一下你答到的要点（意思对就算）：" : `答到 ${hit} / ${card.points.length} 个要点`}</p>
      <ul class="qa-points">${points}</ul>`;
    if (step.stage === "check") {
      return html + `<div class="question-actions"><button class="primary-button" data-action="confirm-points" data-primary>确认 ⏎</button></div>`;
    }
    return html + (card.note ? `<p class="qa-note">${escapeHtml(card.note)}</p>` : "")
      + (card.showGenres ? genresTable() : "") + rateResult();
  }

  function renderJudgeStep() {
    const card = step.item.card;
    const names = model.genreNames;
    let html = `<blockquote class="question-context">${escapeHtml(card.material)}</blockquote>
      <p class="question-prompt small">这段描述最符合哪种新闻体裁？</p>`;
    html += `<div class="choices qa-judge">${names.map((g, i) => {
      let cls = "";
      if (step.picked != null) {
        if (g === card.answer) cls = " selected correct";
        else if (i === step.picked) cls = " selected wrong";
      }
      return `<button class="choice-button${cls}" data-action="judge" data-index="${i}" data-hotkey="${i + 1}"${step.picked != null ? " disabled" : ""}><kbd>${i + 1}</kbd> ${escapeHtml(g)}</button>`;
    }).join("")}</div>`;
    if (step.picked == null) return html;
    const ok = names[step.picked] === card.answer;
    return html + `<div class="feedback ${ok ? "correct" : "wrong"}"><strong>${ok ? "对了" : "应该是“" + escapeHtml(card.answer) + "”"}</strong>${escapeHtml(card.why)}</div>
      ${genresTable()}${nextButton()}`;
  }

  function renderWordStep() {
    const w = step.item.word;
    const shown = step.stage !== "ask";
    let html = `<p class="qa-sentence">${sentenceHtml(w.card, { only: w, active: w })}</p>
      <p class="question-prompt small">“${escapeHtml(w.word)}”${w.tag === PATTERN_TAG ? "是什么句式？怎么理解？" : "在这里是什么意思？"}</p>`;
    if (!shown) return html + `<div class="question-actions"><button class="primary-button" data-action="show-word-card" data-primary>显示 ⏎</button></div>`;
    html += `<div class="recall-answer"><span class="qa-tag">${escapeHtml(w.tag)}</span> ${escapeHtml(w.meaning)}</div>`;
    if (step.rating) return html + rateResult();
    return html + `<div class="review-rate-row qa-rate two">
        <button class="rate-button good" data-action="rate" data-rate="good" data-hotkey="1">记得 <kbd>1</kbd></button>
        <button class="rate-button bad" data-action="rate" data-rate="bad" data-hotkey="2">没记住 <kbd>2</kbd></button>
      </div>`;
  }

  function itemLabel(item) {
    if (item.type === "word") return "“" + item.word.word + "” · " + item.card.source;
    const t = cardTitle(item.card);
    return (t.length > 28 ? t.slice(0, 28) + "…" : t) + " · " + item.card.source;
  }

  function renderSessionDone() {
    const t = session.tally;
    const n = t.good + t.fuzzy + t.bad;
    const misses = session.misses;
    return `<div class="qa-practice">
        <h2 class="view-title">${escapeHtml(session.title)} · 完成</h2>
        <div class="summary-grid">
          <div class="summary-item"><strong class="c-good">${t.good}</strong><span>会</span></div>
          <div class="summary-item"><strong class="c-amber">${t.fuzzy}</strong><span>模糊</span></div>
          <div class="summary-item"><strong class="c-red">${t.bad}</strong><span>不会</span></div>
        </div>
        <p class="qa-done-msg">${n} 题里第一次就答“会”的有 ${t.good} 题。${misses.length ? "下面这些已经安排了复习：不会的今天还会出现，模糊的明天再来。" : "全部一次答对！"}</p>
        ${misses.length ? `<ul class="qa-miss-list">${misses.map(it => `<li>${escapeHtml(itemLabel(it))}</li>`).join("")}</ul>` : ""}
        <div class="lead-actions"><button class="primary-button" data-action="end" data-primary>返回 ⏎</button></div>
      </div>`;
  }

  // ---------- 交互 ----------

  function handleAction(el) {
    const a = el.dataset.action;
    if (a === "rec") return currentRecs[+el.dataset.index].run();
    if (a === "bank-filter") { bankFilter = el.dataset.kind; expanded = ""; return render(); }
    if (a === "expand") { expanded = expanded === el.dataset.card ? "" : el.dataset.card; return render(); }
    if (a === "practice-one") return startSession([cardItem(model.cardMap.get(el.dataset.card))], "单题练习");
    if (a === "drill-words") {
      const ww = new Set(wrongWords().map(w => w.id));
      const list = model.words.filter(w => !onlyWrongWords || ww.has(w.id));
      return startSession(shuffle(list).map(wordItem), onlyWrongWords ? "易错字词" : "全部字词");
    }
    if (a === "print") return window.print();
    if (a === "end") {
      if (session && !session.finished && session.idx > 0 && !confirm("结束这次练习？已答的题会保存。")) return;
      return endSession();
    }
    if (!step && a !== "next") return;
    const card = step && step.item.card;
    if (a === "show-word") { step.shown[step.marks.indexOf(null)] = true; return render(); }
    if (a === "mark-word") {
      const i = step.marks.indexOf(null);
      step.marks[i] = el.dataset.ok === "1";
      markWord(card.keys[i], step.marks[i]);
      save();
      return render();
    }
    if (a === "show-translation") { step.stage = "rate"; return render(); }
    if (a === "show-word-card") { step.stage = "rate"; return render(); }
    if (a === "rate") {
      if (step.rating) return;
      let r = el.dataset.rate;
      if (step.item.type === "card" && card.kind === "wenyan" && r === "good" && step.marks.includes(false)) r = "fuzzy";
      finishItem(r);
      return render();
    }
    if (a === "pick") { step.picked = +el.dataset.index; step.stage = "recall"; return render(); }
    if (a === "show-points") { step.stage = "check"; return render(); }
    if (a === "check") { step.checks[+el.dataset.index] = !step.checks[+el.dataset.index]; return render(); }
    if (a === "confirm-points") {
      const hit = step.checks.filter(Boolean).length;
      let r = hit === card.points.length ? "good" : hit * 2 >= card.points.length ? "fuzzy" : "bad";
      if (card.choice && step.picked !== card.choice.answer && r === "good") r = "fuzzy";
      step.stage = "result";
      finishItem(r);
      return render();
    }
    if (a === "judge") {
      if (step.picked != null) return;
      step.picked = +el.dataset.index;
      finishItem(model.genreNames[step.picked] === card.answer ? "good" : "bad");
      return render();
    }
    if (a === "next") return nextItem();
  }

  function setView(v) {
    view = v;
    document.querySelectorAll(".tab-button").forEach(b => {
      const on = b.dataset.view === v;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    render();
  }

  function bind() {
    app.addEventListener("click", e => {
      const el = e.target.closest("[data-action]");
      if (el && !el.disabled && el.tagName !== "INPUT") handleAction(el);
    });
    app.addEventListener("change", e => {
      if (e.target.dataset.action === "only-wrong") { onlyWrongWords = e.target.checked; render(); }
    });
    document.querySelectorAll(".tab-button").forEach(b => b.addEventListener("click", () => {
      if (session && !session.finished && session.idx > 0 && !confirm("结束这次练习？已答的题会保存。")) return;
      session = null;
      step = null;
      setView(b.dataset.view);
    }));
    const menu = document.getElementById("moreMenu");
    document.querySelector('[data-action="more"]').addEventListener("click", e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
    document.querySelector('[data-action="reset"]').addEventListener("click", () => {
      menu.hidden = true;
      if (!confirm("清除全部答题记录和易错字词？这个操作不可撤销。")) return;
      state = emptyState();
      save();
      session = null;
      step = null;
      render();
      toast("已重置");
    });
    // ⏎ / 空格 点主按钮，数字键点对应选项
    document.addEventListener("keydown", e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest("input, textarea, select")) return;
      if (document.querySelector(".modal.show")) return;
      if (e.key === "Enter" || e.key === " ") {
        const primary = app.querySelector("[data-primary]:not(:disabled)") || (!session && app.querySelector(".qa-rec.primary"));
        if (primary) { e.preventDefault(); primary.click(); }
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const btn = app.querySelector(`[data-hotkey="${e.key}"]:not(:disabled)`);
        if (btn) { e.preventDefault(); btn.click(); }
      }
    });
  }

  function applySyncData(data) {
    state = normalize(data && data.status);
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
        title: "八上语文期中知识点",
        app: "pep-chinese-grade8a-midterm-qa",
        getData: () => ({ status: state, pref: { version: 1 } }),
        applyData: applySyncData
      });
    }
  }

  init();
})();
