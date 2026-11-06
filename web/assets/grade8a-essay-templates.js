(function () {
  "use strict";

  // 八上、四上共用本脚本：body 上的 data-src / data-key 指定数据和存档，缺省为八上
  const DATA_URL = document.body.dataset.src || "../../../assets/data/pep-chinese-grade8a-essay-templates.json";
  const STORAGE_KEY = document.body.dataset.key || "pep_chinese_grade8a_essay_templates_v1";
  const NUM = "一二三四五六七八";
  let SECTIONS = [["essay", "范文"], ["swaps", "换题表"], ["skeleton", "骨架"], ["lines", "好句"]];
  const PEEK = 8;  // 遮住背时露出的字数

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  let data = null;
  let state = { learned: {} };   // learned["a.2"] = true：范文 a 第 3 段背会了
  let view = "home";
  let section = "essay";
  let cover = false;
  let revealed = new Set();
  let toastTimer = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function rich(text) {
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
  }

  function plain(text) { return text.replace(/\*\*/g, ""); }

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && raw.learned && typeof raw.learned === "object") state.learned = raw.learned;
    } catch (e) {}
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function learnedCount(t) { return t.essay.paras.filter((_, i) => state.learned[t.id + "." + i]).length; }
  function charCount(t) { return t.essay.paras.reduce((n, p) => n + plain(p.text).replace(/\s/g, "").length, 0); }

  // ---------- 渲染 ----------

  function render() {
    app.innerHTML = view === "home" ? renderHome() : renderTheme(data.themes.find(t => t.id === view));
  }

  function renderHome() {
    const cards = data.themes.map(t => {
      const n = learnedCount(t);
      const total = t.essay.paras.length;
      return `<button class="et-theme" data-action="open" data-id="${t.id}">
          <span class="et-theme-head"><span class="et-theme-name">${escapeHtml(t.name)}</span><span class="status-chip ${n === total ? "status-mastered" : n ? "status-learning" : "status-new"}">${n === total ? "已背会" : "背了 " + n + "/" + total + " 段"}</span></span>
          <span class="et-theme-essay">${t.unit ? escapeHtml(t.unit) + " · " : ""}范文：《${escapeHtml(t.essay.title)}》</span>
          <span class="et-theme-titles">能写：${t.titles.map(escapeHtml).join("、")}</span>
        </button>`;
    }).join("");
    return `<section class="et-intro">
        <h2 class="lead-title">${escapeHtml(data.ui.lead)}</h2>
        <ul class="et-howto">${data.howto.map(h => `<li>${rich(h)}</li>`).join("")}</ul>
      </section>
      <div class="et-theme-grid">${cards}</div>
      <section class="et-plan">
        <h3 class="et-h3">${escapeHtml(data.ui.planTitle)}</h3>
        <table class="et-table"><tbody>${data.plan.map(r => `<tr><th>${escapeHtml(r[0])}</th><td>${escapeHtml(r[1])}</td></tr>`).join("")}</tbody></table>
      </section>
      <section class="et-plan">
        <h3 class="et-h3">拿到题目，用哪一篇？</h3>
        <table class="et-table">
          <thead><tr><th>题目里有……</th><th>用</th></tr></thead>
          <tbody>${data.pick.map(r => `<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td></tr>`).join("")}</tbody>
        </table>
        <p class="et-note">${escapeHtml(data.ui.pickNote)}</p>
      </section>`;
  }

  function renderTheme(t) {
    const idx = data.themes.indexOf(t);
    const tabs = SECTIONS.map(([k, label]) => `<button class="et-seg${section === k ? " active" : ""}" data-action="section" data-k="${k}">${label}</button>`).join("");
    let body = "";
    if (section === "essay") body = renderEssay(t);
    else if (section === "swaps") body = renderSwaps(t);
    else if (section === "skeleton") body = renderSkeleton(t);
    else body = renderLines(t);
    return `<div class="et-wrap">
        <p class="eyebrow">范文${NUM[idx]} · ${escapeHtml(t.name)}${t.unit ? " · " + escapeHtml(t.unit) : ""}</p>
        <p class="et-fits">能写的题目：${t.titles.map(x => `<span class="et-chip">${escapeHtml(x)}</span>`).join("")}</p>
        <div class="et-segs">${tabs}</div>
        ${body}
      </div>`;
  }

  function renderEssay(t) {
    const n = learnedCount(t);
    const paras = t.essay.paras.map((p, i) => {
      const key = t.id + "." + i;
      const hidden = cover && !revealed.has(key);
      const txt = plain(p.text);
      const text = hidden
        ? `<p class="et-para hidden" data-action="reveal" data-key="${key}">${escapeHtml(txt.slice(0, PEEK))}<span class="et-dots">……（先背，再点开对照）</span></p>`
        : p.text.split("\n").map(s => `<p class="et-para"${cover ? ` data-action="reveal" data-key="${key}"` : ""}>${rich(s)}</p>`).join("");
      return `<div class="et-row">
          <div class="et-row-head"><span class="et-label">${escapeHtml(p.label)}</span>
            <label class="et-learn"><input type="checkbox" data-learn="${key}"${state.learned[key] ? " checked" : ""}> 背会了</label></div>
          ${text}
        </div>`;
    }).join("");
    return `<div class="et-toolbar">
        <span class="et-meta">约 ${charCount(t)} 字 · 已背会 <b>${n}</b>/${t.essay.paras.length} 段</span>
        <button class="${cover ? "primary-button" : "secondary-button"} button-small" data-action="cover">${cover ? "显示全文" : "遮住背"}</button>
      </div>
      <article class="et-essay">
        <h3 class="et-essay-title">${escapeHtml(t.essay.title)}</h3>
        ${paras}
      </article>
      <p class="et-note">${escapeHtml(t.essay.tip || data.ui.essayTip)}</p>`;
  }

  function renderSwaps(t) {
    return `<p class="et-note top">${escapeHtml(t.swapNote || data.ui.swapNote)}</p>
      ${t.swaps.map(s => `<div class="et-swap">
          <h4>《${escapeHtml(s.title)}》</h4>
          ${swapRows(s).map(r => `<div class="et-swap-row"><span>${escapeHtml(r[0])}</span><p>${escapeHtml(r[1])}</p></div>`).join("")}
          ${s.note ? `<p class="et-note">${escapeHtml(s.note)}</p>` : ""}
        </div>`).join("")}`;
  }

  function renderSkeleton(t) {
    return `<p class="et-note top">${escapeHtml(data.ui.skeletonNote)}</p>
      <ol class="et-skeleton">${t.skeleton.map(s => `<li>${escapeHtml(s.replace(/^[①②③④⑤]\s*/, ""))}</li>`).join("")}</ol>`;
  }

  function renderLines(t) {
    return `<p class="et-note top">这几句换到别的作文里也能用。</p>
      <ul class="et-lines">${t.lines.map(l => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
  }

  // 换题表每行：默认是开头＋结尾，也可在数据里用 rows 自定义 [[标签, 内容], ...]
  function swapRows(s) { return s.rows || [["开头改成", s.open], ["结尾改成", s.close]]; }

  // 打印：全部范文＋换题表＋骨架，一个主题一组
  function renderPrint() {
    return `<h1 class="pr-title">${escapeHtml(data.title)}</h1>
      ${data.themes.map((t, i) => `<section class="pr-theme">
          <h2>范文${NUM[i]} · ${escapeHtml(t.name)}：《${escapeHtml(t.essay.title)}》</h2>
          <p class="pr-fits">能写：${t.titles.map(escapeHtml).join("、")}</p>
          ${t.essay.paras.map(p => `<p class="pr-label">${escapeHtml(p.label)}</p>` + p.text.split("\n").map(s => `<p class="pr-para">${rich(s)}</p>`).join("")).join("")}
          <h3>${escapeHtml(SECTIONS[1][1])}</h3>
          ${t.swaps.map(s => `<p class="pr-swap"><b>《${escapeHtml(s.title)}》</b>${swapRows(s).map(r => escapeHtml(r[0].replace(/改成$/, "")) + "：" + escapeHtml(r[1])).join("<br>")}${s.note ? `<br><i>${escapeHtml(s.note)}</i>` : ""}</p>`).join("")}
          <h3>骨架</h3>
          <ol class="pr-skeleton">${t.skeleton.map(s => `<li>${escapeHtml(s.replace(/^[①②③④⑤]\s*/, ""))}</li>`).join("")}</ol>
        </section>`).join("")}`;
  }

  // ---------- 交互 ----------

  function setView(v) {
    view = v;
    section = "essay";
    cover = false;
    revealed = new Set();
    document.querySelectorAll(".tab-button").forEach(b => {
      const on = b.dataset.view === v;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    render();
    window.scrollTo(0, 0);
  }

  function bind() {
    const nav = document.querySelector(".tabs");
    nav.insertAdjacentHTML("beforeend", data.themes.map(t => `<button class="tab-button" data-view="${t.id}" role="tab" aria-selected="false">${escapeHtml(t.short)}</button>`).join(""));
    nav.addEventListener("click", e => {
      const b = e.target.closest(".tab-button");
      if (b) setView(b.dataset.view);
    });
    app.addEventListener("click", e => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const a = el.dataset.action;
      if (a === "open") return setView(el.dataset.id);
      if (a === "section") { section = el.dataset.k; return render(); }
      if (a === "cover") { cover = !cover; revealed = new Set(); return render(); }
      if (a === "reveal") {
        const k = el.dataset.key;
        if (revealed.has(k)) revealed.delete(k); else revealed.add(k);
        return render();
      }
    });
    app.addEventListener("change", e => {
      const k = e.target.dataset.learn;
      if (!k) return;
      if (e.target.checked) state.learned[k] = true; else delete state.learned[k];
      save();
      const t = data.themes.find(x => x.id === k.split(".")[0]);
      render();
      if (learnedCount(t) === t.essay.paras.length) toast("《" + t.essay.title + "》整篇背会了！");
    });
    document.querySelector('[data-action="print"]').addEventListener("click", () => window.print());
  }

  async function init() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("数据加载失败（" + response.status + "）");
      data = await response.json();
    } catch (error) {
      app.innerHTML = `<div class="fatal-error">${escapeHtml(error.message)}<br>请通过网站地址打开本页，而不是直接双击文件。</div>`;
      return;
    }
    if (data.ui.sections) SECTIONS = SECTIONS.map(([k, label]) => [k, data.ui.sections[k] || label]);
    load();
    bind();
    render();
    document.getElementById("printAll").innerHTML = renderPrint();
  }

  init();
})();
