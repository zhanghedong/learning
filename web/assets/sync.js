(function () {
  const CODE_KEY = "review_sync_code_v1";
  const META_PREFIX = "review_sync_meta:";
  const API_BASE = "/api/sync";

  function normalizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function displayCode(code) {
    const raw = normalizeCode(code);
    return raw.length === 8 ? raw.slice(0, 4) + "-" + raw.slice(4) : raw;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  function getStoredCode() {
    return normalizeCode(localStorage.getItem(CODE_KEY));
  }

  function setStoredCode(code) {
    const raw = normalizeCode(code);
    if (raw) localStorage.setItem(CODE_KEY, raw);
    else localStorage.removeItem(CODE_KEY);
  }

  async function request(path, options) {
    const res = await fetch(API_BASE + path, Object.assign({
      headers: { "Content-Type": "application/json" },
      cache: "no-store"
    }, options || {}));
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || "同步请求失败");
    return data;
  }

  function ensureUi() {
    if (document.getElementById("syncModal")) return;
    const style = document.createElement("style");
    style.textContent = `
      .sync-code-box{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:22px;font-weight:700;letter-spacing:2px;text-align:center;padding:12px;margin:8px 0 12px;border:1px dashed var(--line);border-radius:12px;background:#fbfaf5;color:var(--ink)}
      .sync-input{width:100%;height:42px;margin:6px 0 10px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:#fffdf8;color:var(--ink);font:700 18px ui-monospace,Menlo,Consolas,monospace;letter-spacing:2px;text-align:center;text-transform:uppercase}
      .sync-input:focus{outline:none;border-color:var(--accent-soft,var(--seal-soft))}
      .sync-actions{margin-top:10px;flex-wrap:wrap}
      .sync-actions .btn{min-width:96px}
    `;
    document.head.appendChild(style);
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "syncModal";
    modal.innerHTML = `
      <div class="dialog">
        <div class="dlg-title">同步学习进度</div>
        <div class="dlg-body" id="syncBody"></div>
        <div class="sync-code-box" id="syncCodeBox">未开启</div>
        <input class="sync-input" id="syncCodeInput" maxlength="9" autocomplete="off" placeholder="输入同步码">
        <div class="note" id="syncNote"></div>
        <div class="dlg-actions sync-actions">
          <button class="btn primary" id="syncCreate">生成同步码</button>
          <button class="btn primary" id="syncBind">绑定已有码</button>
        </div>
        <div class="dlg-actions sync-actions">
          <button class="btn" id="syncPull">拉取</button>
          <button class="btn" id="syncPush">上传</button>
          <button class="btn" id="syncCopy">复制码</button>
          <button class="btn" id="syncClose">关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function init(config) {
    ensureUi();
    const syncBtn = document.getElementById("syncBtn");
    const modal = document.getElementById("syncModal");
    const body = document.getElementById("syncBody");
    const codeBox = document.getElementById("syncCodeBox");
    const codeInput = document.getElementById("syncCodeInput");
    const note = document.getElementById("syncNote");
    const deckKey = config.deckKey;
    const metaKey = META_PREFIX + deckKey;
    let code = getStoredCode();
    let uploadTimer = null;
    let lastSnapshot = "";
    let applyingRemote = false;

    function setNote(text, type) {
      note.className = "note" + (type ? " " + type : "");
      note.textContent = text || "";
    }

    function updateUi() {
      code = getStoredCode();
      codeBox.textContent = code ? displayCode(code) : "未开启";
      if (syncBtn) syncBtn.textContent = code ? "☁ 已同步" : "☁ 同步";
      body.innerHTML = code
        ? `当前卡片: <b>${escapeHtml(config.title || deckKey)}</b><br>换设备时输入这个同步码即可恢复进度。`
        : `系统会生成 8 位同步码。请保存它,换设备时输入即可恢复进度。`;
    }

    function getPayload() {
      const data = config.getData();
      return {
        app: config.app || "review-card",
        deckKey,
        status: data.status && typeof data.status === "object" ? data.status : {},
        pref: data.pref && typeof data.pref === "object" ? data.pref : {},
        updatedAt: new Date().toISOString()
      };
    }

    function saveMeta(value) {
      try { localStorage.setItem(metaKey, JSON.stringify(value)); } catch (e) {}
    }

    function scheduleUpload() {
      if (applyingRemote || !code) return;
      clearTimeout(uploadTimer);
      uploadTimer = setTimeout(() => upload(false), 900);
    }

    async function upload(showNote) {
      code = getStoredCode();
      if (!code) {
        if (showNote) setNote("还没有同步码。", "err");
        return;
      }
      const res = await request("/progress", {
        method: "PUT",
        body: JSON.stringify({ code, deck_key: deckKey, data: getPayload() })
      });
      saveMeta({ lastUploadedAt: res.updated_at });
      if (showNote) setNote("已上传当前进度。", "ok");
    }

    async function pull(showNote) {
      code = getStoredCode();
      if (!code) {
        if (showNote) setNote("还没有同步码。", "err");
        return;
      }
      const res = await request("/progress?code=" + encodeURIComponent(code) + "&deck_key=" + encodeURIComponent(deckKey));
      if (!res.data) {
        if (showNote) setNote("这个卡片还没有云端进度,已保留本机进度。", "ok");
        return;
      }
      applyingRemote = true;
      try {
        config.applyData(res.data);
        saveMeta({ lastPulledAt: res.updated_at });
        lastSnapshot = JSON.stringify(config.getData());
      } finally {
        applyingRemote = false;
      }
      if (showNote) setNote("已拉取云端进度。", "ok");
    }

    async function createCode() {
      try {
        setNote("正在生成同步码...");
        const res = await request("/create", { method: "POST", body: "{}" });
        setStoredCode(res.raw_code || res.code);
        updateUi();
        await upload(false);
        setNote("同步码已生成,并已上传当前进度。", "ok");
      } catch (e) {
        setNote(e.message, "err");
      }
    }

    async function bindCode() {
      const raw = normalizeCode(codeInput.value);
      if (raw.length !== 8) {
        setNote("请输入 8 位同步码。", "err");
        return;
      }
      try {
        setStoredCode(raw);
        updateUi();
        await pull(true);
      } catch (e) {
        setStoredCode("");
        updateUi();
        setNote(e.message, "err");
      }
    }

    async function copyCode() {
      code = getStoredCode();
      if (!code) return setNote("还没有同步码。", "err");
      const text = displayCode(code);
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch (e) {}
      setNote(ok ? "同步码已复制。" : "无法自动复制,请手动记录: " + text, ok ? "ok" : "err");
    }

    document.getElementById("syncCreate").onclick = createCode;
    document.getElementById("syncBind").onclick = bindCode;
    document.getElementById("syncPull").onclick = () => pull(true).catch(e => setNote(e.message, "err"));
    document.getElementById("syncPush").onclick = () => upload(true).catch(e => setNote(e.message, "err"));
    document.getElementById("syncCopy").onclick = copyCode;
    document.getElementById("syncClose").onclick = () => modal.classList.remove("show");
    modal.addEventListener("click", e => { if (e.target === modal) modal.classList.remove("show"); });
    codeInput.addEventListener("input", () => {
      const raw = normalizeCode(codeInput.value).slice(0, 8);
      codeInput.value = raw.length > 4 ? raw.slice(0, 4) + "-" + raw.slice(4) : raw;
    });
    if (syncBtn) syncBtn.onclick = () => { updateUi(); setNote(""); modal.classList.add("show"); setTimeout(() => codeInput.focus(), 50); };

    lastSnapshot = JSON.stringify(config.getData());
    updateUi();
    if (code) pull(false).catch(e => setNote(e.message, "err"));
    setInterval(() => {
      const current = JSON.stringify(config.getData());
      if (current !== lastSnapshot) {
        lastSnapshot = current;
        scheduleUpload();
      }
    }, 1200);
  }

  window.ReviewSync = { init };
})();
