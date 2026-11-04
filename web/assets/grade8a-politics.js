(function () {
  "use strict";

  const DATA_URL = "../../../assets/data/pep-politics-grade8a-midterm.json";
  const STORAGE_KEY = "pep_politics_grade8a_midterm_v1";
  const DECK_KEY = "textbooks/pep/politics/grade8a-midterm";
  const SESSION_SIZE = 10;
  const SORT_SIZE = 12;
  const MAX_REQUEUE = 2;              // 同一次练习里，一题最多再出现 2 次
  const REQUEUE_GAP = 3;              // 没答好的题隔 3 题再出现
  const INTERVALS = [0, 1, 2, 4, 7];  // 盒子 0-4 对应的复习间隔（天）
  const MASTERED_BOX = 3;
  const KIND_LABEL = { card: "问答", material: "材料题", sort: "易混辨析" };

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  let model = null;
  let state = emptyState();
  let view = "today";
  let bankFilter = "";
  let expanded = "";
  let sheetStar = false;
  let sheetHide = false;
  let revealed = new Set();
  let session = null;
  let step = null;      // 当前这一题的作答进度
  let toastTimer = null;

  function emptyState() { return { version: 1, cards: {}, mats: {} }; }

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

  function buildModel(data) {
    const lessonMap = new Map(data.lessons.map(l => [l.id, l]));
    const cards = data.cards.map(c => Object.assign({}, c, { lessonInfo: lessonMap.get(c.lesson) }));
    const cardMap = new Map(cards.map(c => [c.id, c]));
    const check = (id, where) => { if (!cardMap.has(id)) throw new Error(where + " 引用了不存在的题目 " + id); return cardMap.get(id); };
    const groups = data.groups.map(g => Object.assign({}, g, { cards: g.cards.map(id => check(id, g.id)) }));
    const materials = data.materials.map(m => Object.assign({}, m, {
      lessonInfo: lessonMap.get(m.lesson),
      options: m.options.map(id => check(id, m.id)),
      answer: check(m.answer, m.id)
    }));
    return { title: data.title, lessons: data.lessons, cards, cardMap, groups, materials, matMap: new Map(materials.map(m => [m.id, m])) };
  }

  // ---------- 进度 ----------

  function normalize(raw) {
    const out = emptyState();
    const obj = v => v && typeof v === "object";
    if (!obj(raw)) return out;
    const rec = r => ({ box: Math.max(0, Math.min(4, +r.box || 0)), due: r.due || "", good: +r.good || 0, bad: +r.bad || 0, last: r.last || "" });
    if (obj(raw.cards)) for (const [id, r] of Object.entries(raw.cards)) if (model.cardMap.has(id) && obj(r)) out.cards[id] = rec(r);
    if (obj(raw.mats)) for (const [id, r] of Object.entries(raw.mats)) if (model.matMap.has(id) && obj(r)) out.mats[id] = rec(r);
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

  function status(table, id) {
    const r = table[id];
    if (!r) return { cls: "status-new", label: "未学" };
    if (r.due && r.due <= today()) return { cls: "status-review", label: "今天复习" };
    if (r.box >= MASTERED_BOX) return { cls: "status-mastered", label: "已掌握" };
    return { cls: "status-learning", label: "学习中" };
  }

  function isMastered(card) { return status(state.cards, card.id).cls === "status-mastered"; }
  function isDue(table, id) { const r = table[id]; return !!r && r.due <= today(); }

  function todayPlan() {
    const due = model.cards.filter(c => isDue(state.cards, c.id))
      .sort((a, b) => state.cards[a.id].box - state.cards[b.id].box);
    const fresh = model.cards.filter(c => !state.cards[c.id]);
    const room = Math.max(0, SESSION_SIZE - due.length);
    return { due, fresh: fresh.slice(0, room), all: due.concat(fresh.slice(0, room)) };
  }

  // ---------- 练习 ----------

  function cardItem(card) { return { type: "card", card, id: card.id }; }
  function matItem(mat) { return { type: "material", mat, card: mat.answer, id: mat.id }; }

  // 易混辨析：从一组题里抽一个要点，问它属于哪道题。
  function sortItems(groups, size) {
    const pool = [];
    for (const g of groups) for (const c of g.cards) c.points.forEach((p, i) => pool.push({ type: "sort", group: g, card: c, point: p, id: "sort-" + c.id + "-" + i }));
    return shuffle(pool).slice(0, size || pool.length);
  }

  function startSession(items, title) {
    if (!items.length) { toast("没有需要练的题"); return; }
    session = { title, queue: items, idx: 0, seen: {}, tally: { good: 0, fuzzy: 0, bad: 0 }, misses: [], finished: false };
    beginItem();
    render();
    window.scrollTo({ top: 0 });
  }

  function beginItem() {
    const item = session.queue[session.idx];
    step = { item, rating: null, hint: false, picked: null };
    if (item.type === "card") Object.assign(step, { stage: "recall", checks: item.card.points.map(() => false) });
    else if (item.type === "material") Object.assign(step, { stage: "pick", checks: item.card.points.map(() => false) });
    else step.stage = "pick";
  }

  // 每题在本次练习的第一次作答决定复习安排；重做答对只把它挪到明天。
  function finishItem(rating) {
    const item = step.item;
    const repeat = !!session.seen[item.id];
    if (!repeat) {
      if (item.type === "card") schedule(state.cards, item.id, rating);
      else if (item.type === "material") schedule(state.mats, item.id, rating);
      else if (rating !== "good") schedule(state.cards, item.card.id, "fuzzy");
      session.tally[rating]++;
      if (rating !== "good") session.misses.push(item);
    } else if (rating === "good" && item.type !== "sort") {
      (item.type === "card" ? state.cards : state.mats)[item.id].due = addDays(today(), 1);
    }
    session.seen[item.id] = (session.seen[item.id] || 0) + 1;
    if (rating !== "good" && session.seen[item.id] <= MAX_REQUEUE) {
      session.queue.splice(Math.min(session.idx + 1 + REQUEUE_GAP, session.queue.length), 0, item);
      toast(rating === "bad" ? "没关系，过几题再来一次" : "稍后再巩固一次");
    }
    save();
    step.rating = rating;
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

  function star(card) { return card.star ? `<span class="pz-star" title="重点">★</span>` : ""; }

  // 要点里把关键词加粗；关键词不在原句里时放在句首。
  function pointHtml(p) {
    const i = p.text.indexOf(p.key);
    if (i < 0) return `<b class="pz-k">${escapeHtml(p.key)}</b>：${escapeHtml(p.text)}`;
    return escapeHtml(p.text.slice(0, i)) + `<b class="pz-k">${escapeHtml(p.key)}</b>` + escapeHtml(p.text.slice(i + p.key.length));
  }

  function hintText(key) {
    const chars = Array.from(key.replace(/[，、：]/g, ""));
    return chars[0] + "□".repeat(chars.length - 1);
  }

  function render() {
    if (!model) return;
    document.body.classList.toggle("qa-practicing", !!session);
    if (session) app.innerHTML = session.finished ? renderSessionDone() : renderPractice();
    else if (view === "bank") app.innerHTML = renderBank();
    else if (view === "compare") app.innerHTML = renderCompare();
    else if (view === "sheet") app.innerHTML = renderSheet();
    else app.innerHTML = renderToday();
  }

  function statsBar() {
    const total = model.cards.length;
    const mastered = model.cards.filter(isMastered).length;
    const stars = model.cards.filter(c => c.star);
    const starDone = stars.filter(isMastered).length;
    const due = model.cards.filter(c => isDue(state.cards, c.id)).length;
    const touched = model.cards.filter(c => state.cards[c.id]).length;
    return `<div class="stats-grid">
      <div class="stat"><span class="stat-value">${mastered} / ${total}</span><span class="stat-label">题已掌握（连续答对 3 次）</span><span class="stat-bar"><i style="width:${mastered / total * 100}%"></i></span></div>
      <div class="stat"><span class="stat-value">${starDone} / ${stars.length}</span><span class="stat-label">★ 重点题已掌握</span><span class="stat-bar"><i style="width:${starDone / stars.length * 100}%"></i></span></div>
      <div class="stat"><span class="stat-value">${due}</span><span class="stat-label">题今天要复习 · 已练过 ${touched} 题</span></div>
    </div>`;
  }

  function recommendations() {
    const plan = todayPlan();
    const recs = [];
    if (plan.all.length) {
      const parts = [];
      if (plan.due.length) parts.push(plan.due.length + " 道复习");
      if (plan.fresh.length) parts.push(plan.fresh.length + " 道新题");
      recs.push({ primary: true, title: "今天的练习 · " + plan.all.length + " 题", text: parts.join(" + ") + "。新题按课本顺序推进，先复习到期的再学新的。", go: "开始 ⏎",
        run: () => startSession(plan.all.map(cardItem), "今天的练习") });
    } else {
      recs.push({ primary: true, title: "今天的题都完成了", text: "到期的复习和新题都练完了。想多练可以随机抽 10 题。", go: "随机抽 10 题 ⏎",
        run: () => startSession(shuffle(model.cards).slice(0, SESSION_SIZE).map(cardItem), "随机抽题") });
    }
    const stars = model.cards.filter(c => c.star);
    const starLeft = stars.filter(c => !isMastered(c));
    recs.push({ title: "★ 重点题专练 · " + (starLeft.length || stars.length) + " 题", text: starLeft.length ? "提纲里标★的题中还没掌握的，考试最常考。" : "★题都掌握了，再整体过一遍。", go: "开始专练",
      run: () => startSession(shuffle(starLeft.length ? starLeft : stars).map(cardItem), "★ 重点题专练") });
    recs.push({ title: "易混辨析 · " + SORT_SIZE + " 题", text: "给出一个答案要点，判断它属于哪道题。专治“遵守规则”和“维护规则”分不清。", go: "开始辨析",
      run: () => startSession(sortItems(model.groups, SORT_SIZE), "易混辨析") });
    const matLeft = model.materials.filter(m => status(state.mats, m.id).cls !== "status-mastered");
    recs.push({ title: "材料题 · " + model.materials.length + " 道", text: "读一段生活材料，先判断该用哪道题的答案，再把要点说出来。", go: "开始练",
      run: () => startSession(shuffle(matLeft.length ? matLeft : model.materials).map(matItem), "材料题") });
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
        <p class="eyebrow">期中复习 · 第一、二单元 · 6 课 ${model.cards.length} 题</p>
        <h2 class="lead-title">先说关键词，再展开成句</h2>
        <p class="lead-text">每题先自己回想有几点、每点的关键词是什么，想不起来可以看首字提示（用了提示最多算“模糊”）。对照答案勾出答到的要点，答错或模糊的题过几题会再出现，之后按 1、2、4、7 天复习，<b>连续答对 3 次</b>算掌握。</p>
      </section>
      ${statsBar()}
      <div class="qa-rec-grid">${cards}</div>`;
  }

  function lessonGroups(cards) {
    return model.lessons.map(l => ({ lesson: l, cards: cards.filter(c => c.lesson === l.id) })).filter(g => g.cards.length);
  }

  function renderBank() {
    const filters = [["", "全部"], ["star", "★ 重点"], ["todo", "未掌握"]];
    const match = c => !bankFilter || (bankFilter === "star" ? c.star : !isMastered(c));
    const chips = filters.map(([k, label]) => {
      const n = model.cards.filter(c => !k || (k === "star" ? c.star : !isMastered(c))).length;
      return `<button class="qa-chip${bankFilter === k ? " active" : ""}" data-action="bank-filter" data-kind="${k}">${label} <span>${n}</span></button>`;
    }).join("");
    const groups = lessonGroups(model.cards.filter(match));
    return `<div class="section-heading qa-bank-head"><h2>题库</h2><p>按课排列。点开一题先看答案学习，也可以单独练或整课练。</p></div>
      <div class="qa-chips">${chips}</div>
      <div class="lesson-catalog">${groups.map(g => `<section class="lesson-group">
          <div class="group-head"><span class="group-title">${escapeHtml(g.lesson.name)}</span>
            <span class="group-count">${g.cards.length} 题 <button class="secondary-button button-small pz-lesson-go" data-action="practice-lesson" data-lesson="${g.lesson.id}">练这一课</button></span></div>
          ${g.cards.map(renderBankRow).join("")}
        </section>`).join("")}</div>`;
  }

  function renderBankRow(card) {
    const st = status(state.cards, card.id);
    const open = expanded === card.id;
    const r = state.cards[card.id];
    const meta = r ? `答对 ${r.good} 次 · 答错 ${r.bad} 次` : "";
    return `<button class="piece-row qa-row" data-action="expand" data-card="${card.id}" aria-expanded="${open}">
        <span class="qa-row-kind">${escapeHtml(card.page)}</span>
        <span class="qa-row-title">${star(card)}${escapeHtml(card.question)}</span>
        <span class="status-chip ${st.cls}">${st.label}</span>
      </button>
      ${open ? `<div class="qa-detail">${answerHtml(card)}
        <div class="qa-detail-foot"><span>${meta}</span><button class="primary-button button-small" data-action="practice-one" data-card="${card.id}">练这一题</button></div>
      </div>` : ""}`;
  }

  function answerHtml(card) {
    return `<p class="pz-memo">口诀：${escapeHtml(card.memo)}</p>
      <ol class="qa-points-static">${card.points.map(p => `<li>${pointHtml(p)}</li>`).join("")}</ol>`;
  }

  function renderCompare() {
    return `<div class="view-head qa-words-head">
        <div><h2 class="view-title">易混题对比</h2><p class="qa-sub">这些题的答案很像，考试时最容易张冠李戴。先看对比和区分方法，再做辨析：给一个要点，选它属于哪道题。</p></div>
        <div class="qa-words-tools"><button class="primary-button button-small" data-action="sort-all">全部混在一起辨析</button></div>
      </div>
      ${model.groups.map(g => `<section class="pz-group">
          <div class="pz-group-head"><h3>${escapeHtml(g.title)}</h3><button class="secondary-button button-small" data-action="sort-group" data-group="${g.id}">辨析这一组</button></div>
          <p class="pz-tip">${escapeHtml(g.tip)}</p>
          <div class="pz-compare" style="--cols:${g.cards.length}">${g.cards.map(c => `<div class="pz-col">
              <h4>${star(c)}${escapeHtml(c.question)}</h4>
              <p class="pz-memo">${escapeHtml(c.memo)}</p>
              <ol>${c.points.map(p => `<li>${escapeHtml(p.key)}</li>`).join("")}</ol>
            </div>`).join("")}</div>
        </section>`).join("")}`;
  }

  function renderSheet() {
    const groups = lessonGroups(model.cards.filter(c => !sheetStar || c.star));
    return `<div class="view-head qa-words-head">
        <div><h2 class="view-title">关键词提纲</h2><p class="qa-sub">每题只列要点的关键词，一页看完全部。打开“遮住要点”可以当默写卷用：先说出来，再点题目看答案。</p></div>
        <div class="qa-words-tools">
          <label class="toggle-label"><input type="checkbox" data-action="sheet-star"${sheetStar ? " checked" : ""}> 只看★</label>
          <label class="toggle-label"><input type="checkbox" data-action="sheet-hide"${sheetHide ? " checked" : ""}> 遮住要点</label>
          <button class="secondary-button button-small" data-action="print">打印</button>
        </div>
      </div>
      <div class="pz-sheet">${groups.map(g => `<section class="pz-sheet-lesson">
          <h3>${escapeHtml(g.lesson.name)}<span>${escapeHtml(g.lesson.unit)}</span></h3>
          ${g.cards.map(c => {
            const hidden = sheetHide && !revealed.has(c.id);
            return `<div class="pz-sheet-q${hidden ? " hidden" : ""}" data-action="reveal" data-card="${c.id}">
              <div class="pz-sheet-title">${star(c)}${escapeHtml(c.question)} <span class="pz-page">${escapeHtml(c.page)}</span><span class="pz-count">${c.points.length} 点</span></div>
              <ol class="pz-sheet-keys">${c.points.map(p => `<li>${hidden ? "　" : escapeHtml(p.key)}</li>`).join("")}</ol>
            </div>`;
          }).join("")}
        </section>`).join("")}</div>`;
  }

  // ---------- 练习界面 ----------

  function renderPractice() {
    const item = step.item;
    const n = session.idx + 1;
    const total = session.queue.length;
    const lesson = (item.type === "material" ? item.mat : item.card).lessonInfo;
    let body;
    if (item.type === "card") body = renderCardStep();
    else if (item.type === "material") body = renderMaterialStep();
    else body = renderSortStep();
    return `<div class="qa-practice">
        <div class="view-head">
          <div class="view-head-main"><div class="view-kicker">${escapeHtml(session.title)}</div></div>
          <div class="view-tools"><button class="secondary-button button-small" data-action="end">结束</button></div>
        </div>
        <div class="quiz-progress"><span>${n} / ${total}</span><div class="progress-track"><i style="width:${(n - 1) / total * 100}%"></i></div></div>
        <article class="qa-card">
          <div class="question-label">${escapeHtml(KIND_LABEL[item.type])} · ${escapeHtml(lesson.name)}</div>
          ${body}
        </article>
      </div>`;
  }

  function nextButton() {
    return `<div class="question-actions"><button class="primary-button" data-action="next" data-primary>下一题 ⏎</button></div>`;
  }

  function rateResult() {
    const msg = { good: "记为“会”，过几天再复习。", fuzzy: "记为“模糊”，明天再复习。", bad: "记为“不会”，今天还会再练。" }[step.rating];
    return `<div class="feedback ${step.rating === "good" ? "correct" : "wrong"}">${msg}</div>${nextButton()}`;
  }

  // 问答的回想 → 勾要点 → 结果三步，材料题选对题目后也走这三步。
  function recallBlock(card) {
    let html = "";
    if (step.stage === "recall") {
      html += `<p class="qa-hint">这题有 <b>${card.points.length} 个要点</b>。先说出每点的关键词，再尽量展开成完整的句子，然后看答案。</p>`;
      if (step.hint) html += `<div class="pz-hints"><span>首字提示</span>${card.points.map((p, i) => `<b>${i + 1}. ${escapeHtml(hintText(p.key))}</b>`).join("")}</div>`;
      return html + `<div class="question-actions">
          ${step.hint ? "" : `<button class="secondary-button" data-action="hint" data-hotkey="0">看首字提示</button>`}
          <button class="primary-button" data-action="show-points" data-primary>看答案 ⏎</button>
        </div>`;
    }
    const hit = step.checks.filter(Boolean).length;
    const points = card.points.map((p, i) => step.stage === "check"
      ? `<li><button class="qa-point${step.checks[i] ? " on" : ""}" data-action="check" data-index="${i}" data-hotkey="${i + 1}"><span class="qa-box">${step.checks[i] ? "✓" : ""}</span><span>${pointHtml(p)}</span><kbd>${i + 1}</kbd></button></li>`
      : `<li class="qa-point static${step.checks[i] ? " on" : " off"}"><span class="qa-box">${step.checks[i] ? "✓" : "✗"}</span><span>${pointHtml(p)}</span></li>`).join("");
    html += `<p class="qa-hint">${step.stage === "check" ? "点一下你答到的要点（关键词说对、意思对就算）：" : `答到 ${hit} / ${card.points.length} 个要点${step.hint ? "（用了提示）" : ""}`}</p>
      <ul class="qa-points">${points}</ul>`;
    if (step.stage === "check") {
      return html + `<div class="question-actions"><button class="primary-button" data-action="confirm-points" data-primary>确认 ⏎</button></div>`;
    }
    return html + `<p class="pz-memo">口诀：${escapeHtml(card.memo)}</p>` + rateResult();
  }

  function renderCardStep() {
    const card = step.item.card;
    return `<p class="question-prompt">${star(card)}${escapeHtml(card.question)} <span class="pz-page">${escapeHtml(card.page)}</span></p>` + recallBlock(card);
  }

  function renderMaterialStep() {
    const m = step.item.mat;
    let html = `<blockquote class="question-context">${escapeHtml(m.material)}</blockquote>
      <p class="question-prompt small">${escapeHtml(m.ask)}先判断该用哪道题的答案：</p>
      <div class="choices pz-choices">${m.options.map((c, i) => {
        let cls = "";
        if (step.picked != null) {
          if (c === m.answer) cls = " selected correct";
          else if (i === step.picked) cls = " selected wrong";
        }
        return `<button class="choice-button${cls}" data-action="pick-mat" data-index="${i}" data-hotkey="${i + 1}"${step.picked != null ? " disabled" : ""}><kbd>${i + 1}</kbd> ${escapeHtml(c.question)}</button>`;
      }).join("")}</div>`;
    if (step.picked == null) return html;
    const ok = m.options[step.picked] === m.answer;
    html += `<div class="feedback ${ok ? "correct" : "wrong"} qa-choice-fb"><strong>${ok ? "对了。" : "应该用“" + escapeHtml(m.answer.question) + "”。"}</strong>${escapeHtml(m.why)}</div>`;
    return html + `<section class="qa-step"><h3 class="qa-step-title">第二步 · 把这道题的要点说出来</h3>${recallBlock(m.answer)}</section>`;
  }

  function renderSortStep() {
    const it = step.item;
    let html = `<blockquote class="question-context pz-point-q">${escapeHtml(it.point.text)}</blockquote>
      <p class="question-prompt small">这一点是哪道题的答案？</p>
      <div class="choices pz-choices">${it.group.cards.map((c, i) => {
        let cls = "";
        if (step.picked != null) {
          if (c === it.card) cls = " selected correct";
          else if (i === step.picked) cls = " selected wrong";
        }
        return `<button class="choice-button${cls}" data-action="pick-sort" data-index="${i}" data-hotkey="${i + 1}"${step.picked != null ? " disabled" : ""}><kbd>${i + 1}</kbd> ${escapeHtml(c.question)}</button>`;
      }).join("")}</div>`;
    if (step.picked == null) return html;
    const ok = it.group.cards[step.picked] === it.card;
    return html + `<div class="feedback ${ok ? "correct" : "wrong"}"><strong>${ok ? "对了。" : "是“" + escapeHtml(it.card.question) + "”。"}</strong>${escapeHtml(it.group.tip)}</div>${nextButton()}`;
  }

  function itemLabel(item) {
    if (item.type === "material") return "材料：" + item.mat.material.slice(0, 22) + "…";
    if (item.type === "sort") return "“" + item.point.key + "” → " + item.card.question;
    return item.card.question;
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
    if (a === "practice-lesson") {
      const l = model.lessons.find(x => x.id === el.dataset.lesson);
      return startSession(model.cards.filter(c => c.lesson === l.id).map(cardItem), l.name);
    }
    if (a === "sort-all") return startSession(sortItems(model.groups), "易混辨析 · 全部");
    if (a === "sort-group") {
      const g = model.groups.find(x => x.id === el.dataset.group);
      return startSession(sortItems([g]), "易混辨析 · " + g.title);
    }
    if (a === "reveal") {
      if (!sheetHide) return;
      const id = el.dataset.card;
      revealed.has(id) ? revealed.delete(id) : revealed.add(id);
      return render();
    }
    if (a === "print") return window.print();
    if (a === "end") {
      if (session && !session.finished && session.idx > 0 && !confirm("结束这次练习？已答的题会保存。")) return;
      return endSession();
    }
    if (!step && a !== "next") return;
    const card = step && step.item.card;
    if (a === "hint") { step.hint = true; return render(); }
    if (a === "show-points") { step.stage = "check"; return render(); }
    if (a === "check") { step.checks[+el.dataset.index] = !step.checks[+el.dataset.index]; return render(); }
    if (a === "confirm-points") {
      const hit = step.checks.filter(Boolean).length;
      let r = hit === card.points.length ? "good" : hit * 2 >= card.points.length ? "fuzzy" : "bad";
      // 考场上没有提示，选错题目也说明还不会用，最多算“模糊”。
      const wrongPick = step.item.type === "material" && step.item.mat.options[step.picked] !== step.item.mat.answer;
      if (r === "good" && (step.hint || wrongPick)) r = "fuzzy";
      step.stage = "result";
      finishItem(r);
      return render();
    }
    if (a === "pick-mat") {
      if (step.picked != null) return;
      step.picked = +el.dataset.index;
      step.stage = "recall";
      return render();
    }
    if (a === "pick-sort") {
      if (step.picked != null) return;
      step.picked = +el.dataset.index;
      finishItem(step.item.group.cards[step.picked] === step.item.card ? "good" : "bad");
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
      if (el && !el.disabled && el.tagName !== "INPUT" && el.tagName !== "LABEL") handleAction(el);
    });
    app.addEventListener("change", e => {
      const a = e.target.dataset.action;
      if (a === "sheet-star") { sheetStar = e.target.checked; render(); }
      if (a === "sheet-hide") { sheetHide = e.target.checked; revealed = new Set(); render(); }
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
      if (!confirm("清除全部答题记录？这个操作不可撤销。")) return;
      state = emptyState();
      save();
      session = null;
      step = null;
      render();
      toast("已重置");
    });
    // ⏎ / 空格 点主按钮，数字键点对应选项，0 看提示
    document.addEventListener("keydown", e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest("input, textarea, select")) return;
      if (e.key === "Enter" || e.key === " ") {
        const primary = app.querySelector("[data-primary]:not(:disabled)") || (!session && app.querySelector(".qa-rec.primary"));
        if (primary) { e.preventDefault(); primary.click(); }
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
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
        title: "八上道德与法治期中提纲",
        app: "pep-politics-grade8a-midterm",
        getData: () => ({ status: state, pref: { version: 1 } }),
        applyData: applySyncData
      });
    }
  }

  init();
})();
