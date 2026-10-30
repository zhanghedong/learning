(function () {
  "use strict";

  const DATA_URL = "../../../assets/data/pep-chinese-grade8a-midterm-firstletter.json";
  const STORAGE_KEY = "pep_chinese_grade8a_firstletter_v1";
  const DECK_KEY = "textbooks/pep/chinese/grade8a-midterm-firstletter";
  const MAX_WRONG = 3;          // 第 3 次输错就显示红字
  const CLEAN_DAYS = 2;         // 红字句要在不同的 2 天各背对一次才出列
  const MAX_REDO = 3;           // 同一次练习里一句最多连续重背 3 次
  const STALE_DAYS = 2;
  const FINAL_FROM = "2026-11-05";
  const SEGMENT_MIN = 40;
  // 多音字、通假字：除课本读音外也接受这些首字母，不因读音卡住背诵。
  const ALT_LETTERS = {
    "说": "sy", "拂": "bf", "曾": "zc", "见": "jx", "属": "zs", "骑": "jq", "降": "jx",
    "乘": "cs", "朝": "zc", "长": "cz", "重": "zc", "便": "bp", "还": "hx", "将": "jq",
    "少": "s", "间": "j", "更": "g", "胜": "s", "燕": "y", "应": "y", "为": "w"
  };
  const SENTENCE_END = /[。？！；]/;
  const CLOSE_QUOTE = /[”’"」]/;
  const isHan = ch => /[一-鿿]/.test(ch);

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  let model = null;
  let state = emptyState();
  let view = "today";
  let practice = null;       // 当前练习
  let session = null;        // 一组练习任务
  let expanded = "";
  let mistakeFilter = "";
  let toastTimer = null;
  let showKeyboard = window.matchMedia("(pointer: coarse)").matches;

  function emptyState() { return { version: 1, chars: {}, sentences: {}, pieces: {} }; }

  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function daysBetween(a, b) {
    return Math.round((Date.parse(b + "T00:00:00") - Date.parse(a + "T00:00:00")) / 86400000);
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

  // ---------- 内容模型 ----------

  function buildModel(data) {
    const pieces = data.pieces.map(raw => {
      const tokens = [];
      let n = 0;
      for (const ch of raw.content) {
        if (isHan(ch)) {
          tokens.push({ ch, han: true, id: raw.id + "-c" + n, letter: raw.letters[n] });
          n++;
        } else {
          tokens.push({ ch, han: false });
        }
      }
      if (n !== raw.letters.length) throw new Error(raw.title + " 的首字母数量与字数不一致");

      const sentences = [];
      let start = 0;
      for (let i = 0; i < tokens.length; i++) {
        if (!SENTENCE_END.test(tokens[i].ch)) continue;
        let end = i + 1;
        while (end < tokens.length && CLOSE_QUOTE.test(tokens[end].ch)) end++;
        sentences.push({ start, end });
        start = end;
        i = end - 1;
      }
      if (start < tokens.length) sentences.push({ start, end: tokens.length });
      sentences.forEach((s, k) => {
        s.id = raw.id + "-s" + k;
        s.index = k;
        s.han = tokens.slice(s.start, s.end).filter(t => t.han).length;
        s.text = raw.content.slice(s.start, s.end);
        for (let i = s.start; i < s.end; i++) tokens[i].sentence = k;
      });

      // 有课本分段就按课本段落（词按上下片）；诗整首为一段；其余按句子累积到约 40 字为一段，太短的尾段并入上一段。
      const segments = [];
      if (raw.paragraphs && raw.paragraphs.length) {
        let start = 0;
        for (const para of raw.paragraphs) {
          if (!sentences.some(s => s.end === para.end)) throw new Error(raw.title + " 的分段没有落在句末");
          segments.push({ start, end: para.end, label: para.label, summary: para.summary });
          start = para.end;
        }
        if (start !== tokens.length) throw new Error(raw.title + " 的分段没有覆盖全文");
      } else if (raw.poem) {
        segments.push({ start: 0, end: tokens.length });
      } else {
        let seg = null;
        for (const s of sentences) {
          if (!seg) seg = { start: s.start, end: s.end, han: 0 };
          seg.end = s.end;
          seg.han += s.han;
          if (seg.han >= SEGMENT_MIN) { segments.push(seg); seg = null; }
        }
        if (seg) {
          if (seg.han < 15 && segments.length) segments[segments.length - 1].end = seg.end;
          else segments.push(seg);
        }
      }

      const keys = raw.keys.map((k, i) => {
        const at = raw.content.indexOf(k.sentence);
        return { id: raw.id + "-k" + i, prompt: k.prompt, sentence: k.sentence, start: at, end: at + k.sentence.length };
      });

      // 分段方式变了，旧的分段记录就对不上了；用分段签名区分。
      const segSig = segments.map(s => s.end).join(",");
      return Object.assign({}, raw, { tokens, sentences, segments, segSig, keys, hanCount: n });
    });
    const pieceMap = new Map(pieces.map(p => [p.id, p]));
    const sentenceMap = new Map();
    const charMap = new Map();
    for (const p of pieces) {
      for (const s of p.sentences) sentenceMap.set(s.id, { piece: p, sentence: s });
      p.tokens.forEach((t, i) => { if (t.han) charMap.set(t.id, { piece: p, token: t, index: i }); });
    }
    const units = [];
    for (const p of pieces) {
      let unit = units.find(u => u.title === p.unit);
      if (!unit) units.push(unit = { title: p.unit, pieces: [] });
      unit.pieces.push(p);
    }
    return { pieces, pieceMap, sentenceMap, charMap, units, keys: pieces.flatMap(p => p.keys.map(k => Object.assign({ piece: p }, k))) };
  }

  // ---------- 进度 ----------

  function obj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function normalize(raw) {
    const out = emptyState();
    if (!obj(raw)) return out;
    if (obj(raw.chars)) for (const [id, r] of Object.entries(raw.chars)) if (model.charMap.has(id) && obj(r)) out.chars[id] = { w: +r.w || 0, r: +r.r || 0, d: r.d || "" };
    if (obj(raw.sentences)) for (const [id, r] of Object.entries(raw.sentences)) if (model.sentenceMap.has(id) && obj(r)) out.sentences[id] = { reds: +r.reds || 0, due: !!r.due, streak: +r.streak || 0, day: r.day || "", cleanDay: r.cleanDay || "" };
    if (obj(raw.pieces)) for (const [id, r] of Object.entries(raw.pieces)) if (model.pieceMap.has(id) && obj(r)) {
      const piece = model.pieceMap.get(id);
      const sig = piece.segSig;
      // 没有签名的旧记录：只有分段方式没变（没有课本分段）的篇目才保留。
      const keep = obj(r.segs) && (r.sig === sig || (r.sig === undefined && !(piece.paragraphs && piece.paragraphs.length)));
      out.pieces[id] = { day: r.day || "", sig, segs: keep ? r.segs : {}, keys: obj(r.keys) ? r.keys : {} };
    }
    return out;
  }

  function load() {
    try { state = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) { state = emptyState(); }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function pieceRec(id) {
    return state.pieces[id] || (state.pieces[id] = { day: "", sig: model.pieceMap.get(id).segSig, segs: {}, keys: {} });
  }

  function dueSentences(pieceId) {
    return Object.entries(state.sentences)
      .filter(([id, r]) => r.due && (!pieceId || model.sentenceMap.get(id).piece.id === pieceId))
      .map(([id, r]) => Object.assign({ id, rec: r }, model.sentenceMap.get(id)))
      .sort((a, b) => b.rec.reds - a.rec.reds || a.piece.id.localeCompare(b.piece.id, "en", { numeric: true }) || a.sentence.index - b.sentence.index);
  }

  function pieceStatus(p) {
    const rec = state.pieces[p.id];
    const done = rec ? p.segments.filter((_, i) => rec.segs[i]).length : 0;
    const due = dueSentences(p.id).length;
    if (due) return { cls: "status-review", label: "待重背 " + due + " 句", done, due };
    if (!done) return { cls: "status-new", label: "未背", done, due };
    if (done < p.segments.length) return { cls: "status-learning", label: "已背 " + done + "/" + p.segments.length + " 段", done, due };
    return { cls: "status-mastered", label: "已过关", done, due };
  }

  function lastAccuracy(p) {
    const rec = state.pieces[p.id];
    if (!rec) return null;
    const segs = Object.values(rec.segs);
    if (!segs.length) return null;
    return Math.round(segs.reduce((sum, s) => sum + s.acc, 0) / segs.length);
  }

  // ---------- 任务 ----------

  function segmentTask(p, i) {
    const seg = p.segments[i];
    return { kind: "seg", piece: p, segIndex: i, start: seg.start, end: seg.end,
      label: p.segments.length > 1 ? segmentName(p, i) + " / 共 " + p.segments.length + " 段" + (seg.summary ? " · " + seg.summary : "") : "全篇" };
  }

  function segmentName(p, i) {
    return p.segments[i].label || "第 " + (i + 1) + " 段";
  }

  function keyTask(k) {
    return { kind: "key", piece: k.piece, keyId: k.id, start: k.start, end: k.end, prompt: k.prompt, label: "名句默写" };
  }

  // 相邻的待重背句合并成一个任务，前后句作上下文。
  function redoTasks(sentenceIds) {
    const byPiece = new Map();
    for (const id of sentenceIds) {
      const { piece, sentence } = model.sentenceMap.get(id);
      if (!byPiece.has(piece)) byPiece.set(piece, []);
      byPiece.get(piece).push(sentence.index);
    }
    const tasks = [];
    for (const [piece, list] of byPiece) {
      const idx = [...new Set(list)].sort((a, b) => a - b);
      let run = [idx[0]];
      const flush = () => {
        const a = piece.sentences[run[0]], b = piece.sentences[run[run.length - 1]];
        tasks.push({ kind: "redo", piece, start: a.start, end: b.end, label: "重背红字句", sentenceIds: run.map(k => piece.sentences[k].id) });
      };
      for (let i = 1; i < idx.length; i++) {
        if (idx[i] === run[run.length - 1] + 1) run.push(idx[i]);
        else { flush(); run = [idx[i]]; }
      }
      flush();
    }
    return tasks;
  }

  function pickKeys(count) {
    const d = today();
    return model.keys
      .map((k, i) => {
        const r = state.pieces[k.piece.id] && state.pieces[k.piece.id].keys[k.id];
        const score = !r ? 0 : r.d === d ? 9e9 : (r.ok ? 1000 : 0) - daysBetween(r.d, d) * 10;
        return { k, score, i };
      })
      .filter(x => x.score < 9e9)
      .sort((a, b) => a.score - b.score || a.i - b.i)
      .slice(0, count)
      .map(x => x.k);
  }

  function recommendations() {
    const d = today();
    const list = [];
    const due = dueSentences();
    if (d >= FINAL_FROM) {
      list.push({ title: "考前总复习", text: "所有待重背句（" + due.length + " 句）+ 全部 " + model.keys.length + " 句名句默写。",
        tasks: () => redoTasks(due.map(x => x.id)).concat(model.keys.map(keyTask)), primary: true });
    }
    if (due.length) {
      const top = due.slice(0, 8);
      const titles = [...new Set(top.map(x => "《" + x.piece.title + "》"))].slice(0, 3).join("");
      list.push({ title: "重背红字句 · " + top.length + " 句", text: "红字多的先背。" + titles + (due.length > top.length ? " 等，共 " + due.length + " 句待重背。" : ""),
        tasks: () => redoTasks(top.map(x => x.id)), primary: !list.length });
    }
    const keys = pickKeys(2);
    if (keys.length) {
      list.push({ title: "名句默写 · " + keys.length + " 句", text: keys.map(k => k.prompt).join("；"), tasks: () => keys.map(keyTask) });
    }
    const fresh = model.pieces.find(p => pieceStatus(p).done < p.segments.length);
    if (fresh) {
      const from = fresh.segments.findIndex((_, i) => !(state.pieces[fresh.id] && state.pieces[fresh.id].segs[i]));
      list.push({ title: (from > 0 ? "接着背" : "开始背") + "《" + fresh.title + "》", text: fresh.author + " · " + fresh.hanCount + " 字" + (fresh.segments.length > 1 ? "，从第 " + (from + 1) + " 段开始" : ""),
        tasks: () => fresh.segments.slice(from).map((_, i) => segmentTask(fresh, from + i)), primary: !list.length });
    }
    const stale = model.pieces
      .filter(p => state.pieces[p.id] && state.pieces[p.id].day && daysBetween(state.pieces[p.id].day, d) > STALE_DAYS && pieceStatus(p).done === p.segments.length)
      .sort((a, b) => state.pieces[a.id].day.localeCompare(state.pieces[b.id].day))[0];
    if (stale) {
      list.push({ title: "复习《" + stale.title + "》", text: daysBetween(state.pieces[stale.id].day, d) + " 天没背了。", tasks: () => stale.segments.map((_, i) => segmentTask(stale, i)) });
    }
    return list;
  }

  // ---------- 练习 ----------

  function startSession(tasks, origin) {
    if (!tasks.length) return;
    session = { tasks, index: 0, redoCount: {}, origin: origin || view, total: { han: 0, first: 0, amber: 0, red: 0, reds: [] } };
    startTask(tasks[0]);
  }

  function startTask(task) {
    const tokens = task.piece.tokens;
    let pos = task.start;
    while (pos < task.end && !tokens[pos].han) pos++;
    practice = { task, pos, wrongs: 0, redPending: false, marks: {}, done: false, shake: false };
    render();
  }

  function accepts(token, letter) {
    return token.letter === letter || (ALT_LETTERS[token.ch] || "").includes(letter);
  }

  function charRec(id) {
    return state.chars[id] || (state.chars[id] = { w: 0, r: 0, d: "" });
  }

  function markRed() {
    const p = practice;
    const token = p.task.piece.tokens[p.pos];
    const rec = charRec(token.id);
    rec.r++;
    rec.w += p.wrongs;
    rec.d = today();
    p.marks[p.pos] = "red";
    p.redPending = true;
    save();
  }

  function advance() {
    const p = practice;
    const tokens = p.task.piece.tokens;
    p.wrongs = 0;
    p.redPending = false;
    p.pos++;
    while (p.pos < p.task.end && !tokens[p.pos].han) p.pos++;
    if (p.pos >= p.task.end) finishTask();
  }

  function onLetter(letter) {
    const p = practice;
    if (!p || p.done) return;
    const token = p.task.piece.tokens[p.pos];
    if (accepts(token, letter)) {
      if (!p.redPending) {
        p.marks[p.pos] = p.wrongs ? "amber" : "ok";
        if (p.wrongs) { charRec(token.id).w += p.wrongs; save(); }
      }
      advance();
      render();
      return;
    }
    if (p.redPending) { shake(); return; }
    p.wrongs++;
    if (p.wrongs >= MAX_WRONG) markRed();
    render();
    if (!p.redPending) shake();
  }

  function shake() {
    const slot = app.querySelector(".fl-slot.current");
    if (!slot) return;
    slot.classList.remove("shake");
    void slot.offsetWidth;
    slot.classList.add("shake");
  }

  function useHint() {
    const p = practice;
    if (!p || p.done || p.redPending) return;
    markRed();
    render();
  }

  function speak(text) {
    if (!window.speechSynthesis) return toast("这个浏览器不支持朗读");
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.8;
    speechSynthesis.speak(u);
  }

  function readAloud() {
    const p = practice;
    if (!p || p.done) return;
    const piece = p.task.piece;
    const s = piece.sentences[piece.tokens[p.pos].sentence];
    speak(piece.content.slice(Math.max(s.start, p.task.start), p.pos + 1));
    if (!p.redPending) markRed();
    render();
  }

  function finishTask() {
    const p = practice;
    const { task } = p;
    const piece = task.piece;
    const d = today();
    p.done = true;
    let han = 0, first = 0, amber = 0;
    const reds = [];
    for (let i = task.start; i < task.end; i++) {
      if (!piece.tokens[i].han) continue;
      han++;
      if (p.marks[i] === "ok") first++;
      else if (p.marks[i] === "amber") amber++;
      else if (p.marks[i] === "red") reds.push(i);
    }
    p.result = { han, first, amber, red: reds.length, reds, acc: han ? Math.round(first / han * 100) : 100 };

    const redSentences = [];
    for (const s of piece.sentences) {
      if (s.end <= task.start || s.start >= task.end) continue;
      const redCount = reds.filter(i => i >= s.start && i < s.end).length;
      const covered = s.start >= task.start && s.end <= task.end;
      const rec = state.sentences[s.id] || { reds: 0, due: false, streak: 0, day: "", cleanDay: "" };
      if (redCount) {
        rec.reds += redCount;
        rec.due = true;
        rec.streak = 0;
        rec.cleanDay = "";
        rec.day = d;
        redSentences.push(s.id);
      } else if (covered) {
        rec.day = d;
        if (rec.due && rec.cleanDay !== d) {
          rec.streak++;
          rec.cleanDay = d;
          if (rec.streak >= CLEAN_DAYS) { rec.due = false; rec.streak = 0; }
        }
      } else continue;
      state.sentences[s.id] = rec;
    }
    p.result.redSentences = redSentences;

    const pr = pieceRec(piece.id);
    pr.day = d;
    if (task.kind === "seg") pr.segs[task.segIndex] = { d, acc: p.result.acc };
    if (task.kind === "key") pr.keys[task.keyId] = { d, ok: !reds.length };
    save();

    const t = session.total;
    t.han += han; t.first += first; t.amber += amber; t.red += reds.length;
    for (const i of reds) t.reds.push(piece.tokens[i].id);
  }

  function redoNow() {
    const ids = practice.result.redSentences.filter(id => (session.redoCount[id] || 0) < MAX_REDO);
    ids.forEach(id => { session.redoCount[id] = (session.redoCount[id] || 0) + 1; });
    const tasks = redoTasks(ids);
    session.tasks.splice(session.index + 1, 0, ...tasks);
    nextTask();
  }

  function canRedo() {
    const r = practice && practice.result;
    return !!r && r.redSentences.some(id => (session.redoCount[id] || 0) < MAX_REDO);
  }

  function nextTask() {
    session.index++;
    if (session.index < session.tasks.length) startTask(session.tasks[session.index]);
    else { practice = null; session.finished = true; render(); }
  }

  // 中途结束：已背部分不计入段落记录，但出过红字的句子照样进入重背。
  function abandonPractice() {
    const p = practice;
    if (!p || p.done) return;
    const piece = p.task.piece;
    const d = today();
    for (const [i, mark] of Object.entries(p.marks)) {
      if (mark !== "red") continue;
      const s = piece.sentences[piece.tokens[i].sentence];
      const rec = state.sentences[s.id] || { reds: 0, due: false, streak: 0, day: "", cleanDay: "" };
      rec.reds++;
      rec.due = true;
      rec.streak = 0;
      rec.cleanDay = "";
      rec.day = d;
      state.sentences[s.id] = rec;
    }
    save();
  }

  function endSession() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    abandonPractice();
    const origin = session ? session.origin : view;
    practice = null;
    session = null;
    setView(origin);
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
    document.body.classList.toggle("fl-practicing", !!session);
    if (session) app.innerHTML = session.finished ? renderSessionDone() : practice.done ? renderTaskDone() : renderPractice();
    else if (view === "pieces") app.innerHTML = renderPieces();
    else if (view === "mistakes") app.innerHTML = renderMistakes();
    else app.innerHTML = renderToday();
    if (practice && !practice.done) {
      const cur = app.querySelector(".fl-slot.current");
      if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function statsBar() {
    const totalSeg = model.pieces.reduce((n, p) => n + p.segments.length, 0);
    const doneSeg = model.pieces.reduce((n, p) => n + pieceStatus(p).done, 0);
    const passed = model.pieces.filter(p => pieceStatus(p).cls === "status-mastered").length;
    const due = dueSentences().length;
    const redChars = Object.values(state.chars).filter(r => r.r > 0).length;
    return `<div class="stats-grid fl-stats">
      <div class="stat"><span class="stat-value">${passed} / ${model.pieces.length}</span><span class="stat-label">篇已过关</span><span class="stat-bar"><i style="width:${passed / model.pieces.length * 100}%"></i></span></div>
      <div class="stat"><span class="stat-value">${doneSeg} / ${totalSeg}</span><span class="stat-label">段背过至少一次</span><span class="stat-bar"><i style="width:${doneSeg / totalSeg * 100}%"></i></span></div>
      <div class="stat"><span class="stat-value">${due}</span><span class="stat-label">句待重背 · ${redChars} 个易错字</span></div>
    </div>`;
  }

  function renderToday() {
    const recs = recommendations();
    const cards = recs.map((r, i) => `<button class="fl-rec${r.primary ? " primary" : ""}" data-action="rec" data-index="${i}">
        <span class="fl-rec-title">${escapeHtml(r.title)}</span>
        <span class="fl-rec-text">${escapeHtml(r.text)}</span>
        <span class="fl-rec-go">开始 →</span>
      </button>`).join("");
    return `<section class="fl-lead">
        <p class="eyebrow">期中背诵 · 第三、六单元 18 篇</p>
        <h2 class="lead-title">想起下一个字，输入它的拼音首字母</h2>
        <p class="lead-text">按对了字就出现；错 1–2 次后想起是<b class="c-amber">橙色</b>，第 ${MAX_WRONG} 次错会显示<b class="c-red">红字</b>。红字所在的句子要在两天里各背对一次才算过。</p>
      </section>
      ${statsBar()}
      <div class="section-heading"><h2>今天先背</h2><p>红字句优先，其次是没背过的篇目</p></div>
      <div class="fl-rec-grid">${cards || '<p class="fl-empty">全部过关了，去“篇目”里挑一篇再背一遍吧。</p>'}</div>`;
  }

  function renderPieces() {
    const groups = model.units.map(u => `<section class="lesson-group">
        <div class="group-head"><span class="group-title">${escapeHtml(u.title)}</span><span class="group-count">${u.pieces.length} 篇</span></div>
        ${u.pieces.map(renderPieceRow).join("")}
      </section>`).join("");
    return `${statsBar()}
      <div class="section-heading"><h2>篇目</h2><p><button class="text-button" data-action="all-keys">名句默写 · 全部 ${model.keys.length} 句</button></p></div>
      <div class="lesson-catalog">${groups}</div>`;
  }

  function renderPieceRow(p) {
    const st = pieceStatus(p);
    const acc = lastAccuracy(p);
    const rec = state.pieces[p.id];
    const open = expanded === p.id;
    let detail = "";
    if (open) {
      const segs = p.segments.map((s, i) => {
        const r = rec && rec.segs[i];
        const preview = p.content.slice(s.start, Math.min(s.end, s.start + 8));
        return `<button class="secondary-button button-small" data-action="seg" data-piece="${p.id}" data-index="${i}">${p.segments.length > 1 ? escapeHtml(segmentName(p, i)) + " · " : ""}${escapeHtml(s.summary || preview + "…")}${r ? ` <span class="fl-acc">${r.acc}%</span>` : ""}</button>`;
      }).join("");
      const due = st.due ? `<button class="primary-button button-small" data-action="redo-piece" data-piece="${p.id}">重背 ${st.due} 句红字句</button>` : "";
      detail = `<div class="fl-piece-detail">
          <div class="fl-detail-actions"><button class="primary-button button-small" data-action="whole" data-piece="${p.id}">从头背全篇</button>${due}
          ${p.keys.length ? `<button class="secondary-button button-small" data-action="piece-keys" data-piece="${p.id}">名句默写 ${p.keys.length} 句</button>` : ""}</div>
          ${p.segments.length > 1 ? `<div class="fl-detail-segs">${segs}</div>` : ""}
        </div>`;
    }
    return `<button class="piece-row" data-action="expand" data-piece="${p.id}" aria-expanded="${open}">
        <span><span class="piece-title">${escapeHtml(p.title)}</span> <span class="piece-author">${escapeHtml(p.author)} · ${p.hanCount} 字</span></span>
        <span class="piece-meta">${acc == null ? "" : "一次对 " + acc + "%"}</span>
        <span class="status-chip ${st.cls}">${st.label}</span>
      </button>${detail}`;
  }

  function mistakeList() {
    return Object.entries(state.chars)
      .filter(([id, r]) => r.r > 0 && (!mistakeFilter || model.charMap.get(id).piece.id === mistakeFilter))
      .map(([id, r]) => Object.assign({ id, rec: r }, model.charMap.get(id)))
      .sort((a, b) => b.rec.r - a.rec.r || b.rec.w - a.rec.w || a.index - b.index);
  }

  function renderMistakes() {
    const list = mistakeList();
    const options = model.pieces.filter(p => Object.entries(state.chars).some(([id, r]) => r.r > 0 && id.startsWith(p.id + "-")))
      .map(p => `<option value="${p.id}"${mistakeFilter === p.id ? " selected" : ""}>${escapeHtml(p.title)}</option>`).join("");
    const rows = list.map(x => {
      const s = x.piece.sentences[x.token.sentence];
      const before = x.piece.content.slice(s.start, x.index), after = x.piece.content.slice(x.index + 1, s.end);
      return `<li class="fl-mistake">
          <span class="fl-mistake-char">${escapeHtml(x.token.ch)}</span>
          <span class="fl-mistake-body">
            <span class="fl-mistake-context">${escapeHtml(before)}<b>${escapeHtml(x.token.ch)}</b>${escapeHtml(after)}</span>
            <span class="fl-mistake-meta">《${escapeHtml(x.piece.title)}》 · 红 ${x.rec.r} 次${x.rec.w ? " · 共错 " + x.rec.w + " 次" : ""}</span>
          </span>
        </li>`;
    }).join("");
    return `<div class="section-heading fl-mistake-head">
        <div><h2>易错字</h2><p>首字母默背只能检验记不记得是哪个字。对着清单在纸上把每个字写 3 遍，才能防住默写错别字。</p></div>
        <div class="fl-mistake-tools">
          <select class="piece-select" data-action="filter" aria-label="按篇筛选"><option value="">全部篇目</option>${options}</select>
          <button class="secondary-button button-small" data-action="redo-mistakes"${list.length ? "" : " disabled"}>重背这些字所在的句子</button>
          <button class="secondary-button button-small" data-action="print"${list.length ? "" : " disabled"}>打印</button>
        </div>
      </div>
      ${list.length ? `<ol class="fl-mistakes">${rows}</ol>` : '<p class="fl-empty">还没有红字。背诵时第 3 次输错的字会出现在这里。</p>'}`;
  }

  function renderPractice() {
    const p = practice;
    const { task } = p;
    const piece = task.piece;
    const tokens = piece.tokens;
    let html = "";
    // 上下文：分段背诵显示本篇前面的内容；重背显示前一句和后一句；名句默写不给上下文。
    let ctxBefore = "", ctxAfter = "";
    if (task.kind === "seg") ctxBefore = piece.content.slice(Math.max(0, task.start - 60), task.start);
    if (task.kind === "redo") {
      const first = tokens[task.start].sentence, last = tokens[task.end - 1].sentence;
      if (first > 0) ctxBefore = piece.sentences[first - 1].text;
      if (last < piece.sentences.length - 1) ctxAfter = piece.sentences[last + 1].text;
    }
    if (ctxBefore) html += `<span class="fl-ctx">${task.kind === "seg" && task.start > 60 ? "…" : ""}${escapeHtml(ctxBefore)}</span>`;
    for (let i = task.start; i < task.end; i++) {
      const t = tokens[i];
      if (!t.han) { html += `<span class="fl-punct">${escapeHtml(t.ch)}</span>`; continue; }
      if (i < p.pos) { html += `<span class="fl-char ${p.marks[i] || "ok"}">${escapeHtml(t.ch)}</span>`; continue; }
      if (i === p.pos) {
        const dots = p.redPending ? "" : "<i></i>".repeat(p.wrongs);
        html += p.redPending
          ? `<span class="fl-slot current revealed">${escapeHtml(t.ch)}</span>`
          : `<span class="fl-slot current">${dots ? `<span class="fl-dots">${dots}</span>` : ""}</span>`;
        continue;
      }
      html += `<span class="fl-slot"></span>`;
    }
    if (ctxAfter) html += `<span class="fl-ctx">${escapeHtml(ctxAfter)}</span>`;

    let typed = 0, first = 0, red = 0, total = 0;
    for (let i = task.start; i < task.end; i++) {
      if (!tokens[i].han) continue;
      total++;
      if (i < p.pos) typed++;
      if (p.marks[i] === "ok") first++;
      if (p.marks[i] === "red") red++;
    }
    const cur = tokens[p.pos];
    const hint = p.redPending
      ? `<p class="fl-hint red">记住这个字，按 <kbd>${cur.letter.toUpperCase()}</kbd> 继续</p>`
      : p.wrongs ? `<p class="fl-hint">再想想，还有 ${MAX_WRONG - p.wrongs} 次机会</p>` : `<p class="fl-hint">&nbsp;</p>`;
    const progress = session.tasks.length > 1 ? ` · 第 ${session.index + 1} / ${session.tasks.length} 项` : "";
    return `<section class="fl-practice">
        <div class="view-head">
          <div class="view-head-main">
            <p class="view-kicker">${escapeHtml(task.label)}${progress}</p>
            <h2 class="view-title">${escapeHtml(piece.title)}</h2>
            <p class="view-byline">${escapeHtml(piece.author)} · ${escapeHtml(piece.lesson)}</p>
          </div>
          <div class="view-tools"><button class="secondary-button button-small" data-action="end">结束</button></div>
        </div>
        ${task.prompt ? `<p class="fl-prompt">${escapeHtml(task.prompt)}</p>` : ""}
        <div class="fl-text">${html}</div>
        ${hint}
        <div class="fl-bar">
          <span>${typed} / ${total} 字 · 一次对 ${first} · 红字 ${red}</span>
          <span class="fl-bar-tools">
            <button class="secondary-button button-small" data-action="hint"${p.redPending ? " disabled" : ""} title="显示这个字（记为红字）">提示</button>
            <button class="secondary-button button-small" data-action="read" title="朗读到这个字（记为红字）">读一遍</button>
            <button class="text-button button-small" data-action="keyboard">${showKeyboard ? "收起键盘" : "屏幕键盘"}</button>
          </span>
        </div>
        ${showKeyboard ? renderKeyboard() : ""}
      </section>`;
  }

  function renderKeyboard() {
    return `<div class="fl-keyboard">${["qwertyuiop", "asdfghjkl", "zxcvbnm"].map(row =>
      `<div class="fl-key-row">${[...row].map(k => `<button class="fl-key" data-action="key" data-key="${k}">${k}</button>`).join("")}</div>`).join("")}</div>`;
  }

  function redChips(ids) {
    return [...new Set(ids)].map(id => `<span class="fl-red-chip">${escapeHtml(model.charMap.get(id).token.ch)}</span>`).join("");
  }

  function renderTaskDone() {
    const p = practice;
    const r = p.result;
    const piece = p.task.piece;
    const more = session.index < session.tasks.length - 1;
    const redo = canRedo();
    const nextLabel = more ? (session.tasks[session.index + 1].kind === "seg" ? "下一段" : "下一项") : "完成";
    const msg = !r.red ? (r.amber ? "全部背出，有 " + r.amber + " 个字差一点忘。" : "一个错字都没有！")
      : redo ? "红字所在的句子再背一遍，趁热记牢。" : "这几句已经连背了 " + MAX_REDO + " 次，先休息一下，明天会再出现。";
    const text = piece.tokens.slice(p.task.start, p.task.end).map((t, i) => {
      const k = p.task.start + i;
      return t.han ? `<span class="fl-char ${p.marks[k] || "ok"}">${escapeHtml(t.ch)}</span>` : escapeHtml(t.ch);
    }).join("");
    return `<section class="fl-practice fl-done">
        <p class="view-kicker">${escapeHtml(p.task.label)} · 完成</p>
        <h2 class="view-title">${escapeHtml(piece.title)}</h2>
        <div class="fl-result">
          <div><b>${r.han}</b><span>字</span></div>
          <div><b>${r.first}</b><span>一次对</span></div>
          <div class="c-amber"><b>${r.amber}</b><span>橙字</span></div>
          <div class="c-red"><b>${r.red}</b><span>红字</span></div>
        </div>
        ${r.red ? `<p class="fl-red-line">红字：${redChips(r.reds.map(i => piece.tokens[i].id))}</p>` : ""}
        <p class="fl-done-msg">${msg}</p>
        <div class="fl-text fl-review">${text}</div>
        <div class="lead-actions">
          ${redo ? `<button class="primary-button" data-action="redo-now">重背红字所在的句子 ⏎</button><button class="secondary-button" data-action="next">${nextLabel}</button>`
                 : `<button class="primary-button" data-action="next">${nextLabel} ⏎</button>`}
          <button class="text-button" data-action="end">结束练习</button>
        </div>
      </section>`;
  }

  function renderSessionDone() {
    const t = session.total;
    const acc = t.han ? Math.round(t.first / t.han * 100) : 100;
    return `<section class="fl-practice fl-done">
        <p class="view-kicker">本次练习完成</p>
        <h2 class="view-title">${t.red ? "辛苦了，红字明天会再出现" : "太棒了，全部背出！"}</h2>
        <div class="fl-result">
          <div><b>${t.han}</b><span>字</span></div>
          <div><b>${acc}%</b><span>一次对</span></div>
          <div class="c-amber"><b>${t.amber}</b><span>橙字</span></div>
          <div class="c-red"><b>${t.red}</b><span>红字</span></div>
        </div>
        ${t.red ? `<p class="fl-red-line">本次红字：${redChips(t.reds)}</p><p class="fl-done-msg">在纸上把这些字各写 3 遍。</p>` : ""}
        <div class="lead-actions"><button class="primary-button" data-action="end">返回 ⏎</button></div>
      </section>`;
  }

  // ---------- 事件 ----------

  function handleAction(el) {
    const a = el.dataset.action;
    const piece = el.dataset.piece && model.pieceMap.get(el.dataset.piece);
    if (a === "rec") return startSession(recommendations()[+el.dataset.index].tasks());
    if (a === "expand") { expanded = expanded === piece.id ? "" : piece.id; return render(); }
    if (a === "whole") return startSession(piece.segments.map((_, i) => segmentTask(piece, i)));
    if (a === "seg") return startSession(piece.segments.slice(+el.dataset.index).map((_, i) => segmentTask(piece, +el.dataset.index + i)));
    if (a === "redo-piece") return startSession(redoTasks(dueSentences(piece.id).map(x => x.id)));
    if (a === "piece-keys") return startSession(piece.keys.map(k => keyTask(Object.assign({ piece }, k))));
    if (a === "all-keys") return startSession(model.keys.map(keyTask));
    if (a === "redo-mistakes") {
      const ids = [...new Set(mistakeList().map(x => x.piece.sentences[x.token.sentence].id))];
      return startSession(redoTasks(ids));
    }
    if (a === "print") return window.print();
    if (a === "key") return onLetter(el.dataset.key);
    if (a === "hint") return useHint();
    if (a === "read") return readAloud();
    if (a === "keyboard") { showKeyboard = !showKeyboard; return render(); }
    if (a === "redo-now") return redoNow();
    if (a === "next") return nextTask();
    if (a === "end") return endSession();
  }

  function bind() {
    app.addEventListener("click", e => {
      const el = e.target.closest("[data-action]");
      if (el && !el.disabled) handleAction(el);
    });
    app.addEventListener("change", e => {
      if (e.target.dataset.action === "filter") { mistakeFilter = e.target.value; render(); }
    });
    document.querySelectorAll(".tab-button").forEach(b => b.addEventListener("click", () => {
      if (session && !session.finished && !confirm("结束当前练习？已背的部分会保存。")) return;
      abandonPractice();
      practice = null;
      session = null;
      setView(b.dataset.view);
    }));
    const menu = document.getElementById("moreMenu");
    document.querySelector('[data-action="more"]').addEventListener("click", e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
    document.querySelector('[data-action="reset"]').addEventListener("click", () => {
      menu.hidden = true;
      if (!confirm("清除默背的全部红字、错句和篇目记录？这个操作不可撤销。")) return;
      state = emptyState();
      save();
      practice = null;
      session = null;
      render();
      toast("已重置");
    });
    document.addEventListener("keydown", e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest("input, textarea, select, .modal.show")) return;
      if (document.querySelector(".modal.show")) return;
      if (!session) return;
      if (practice && !practice.done && !session.finished) {
        if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); onLetter(e.key.toLowerCase()); }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const primary = app.querySelector(".lead-actions .primary-button");
        if (primary) primary.click();
      }
    });
  }

  function applySyncData(data) {
    const status = data && data.status;
    state = normalize(status);
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
        title: "八上语文期中首字母默背",
        app: "pep-chinese-grade8a-midterm-firstletter",
        getData: () => ({ status: state, pref: { version: 1 } }),
        applyData: applySyncData
      });
    }
  }

  init();
})();
