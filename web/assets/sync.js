(function () {
  const AUTH_KEY = "review_auth_v1";
  const META_PREFIX = "review_sync_meta_v2:";
  const LEGACY_KEYS = ["review_sync_code_v1"];
  const API_BASE = "/api/v1";

  LEGACY_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  function writeJson(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  // 登录态：{token, expiresAt(Unix 秒), user}
  function getAuth() {
    const auth = readJson(AUTH_KEY);
    if (!auth || !auth.token || !auth.user || !(auth.expiresAt * 1000 > Date.now())) return null;
    return auth;
  }

  function setAuth(auth) {
    writeJson(AUTH_KEY, auth);
    window.dispatchEvent(new CustomEvent("review-auth-change"));
  }

  function accountLabel(user) {
    const phone = String((user && user.phone) || "").replace(/^\+86/, "");
    if (/^\d{11}$/.test(phone)) return phone.slice(0, 3) + "****" + phone.slice(7);
    return (user && (user.phone || user.email)) || "已登录";
  }

  function randomId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }

  async function request(path, options) {
    options = options || {};
    const headers = { "Content-Type": "application/json" };
    const auth = options.auth === false ? null : getAuth();
    if (auth) headers.Authorization = "Bearer " + auth.token;
    let res;
    try {
      res = await fetch(API_BASE + path, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined, cache: "no-store" });
    } catch (e) {
      const err = new Error("网络连接失败，进度先保存在本机");
      err.network = true;
      throw err;
    }
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data.error && data.error.message) || "请求失败（" + res.status + "）");
      err.status = res.status;
      err.code = data.error && data.error.code;
      err.data = data;
      if (res.status === 401 && auth) setAuth(null);
      throw err;
    }
    return data;
  }

  async function login(phone, password) {
    const res = await request("/auth/login", { method: "POST", body: { identifier: phone, password }, auth: false });
    setAuth({ token: res.token, expiresAt: res.expiresAt, user: res.user });
    return res.user;
  }

  async function logout() {
    try { if (getAuth()) await request("/auth/logout", { method: "POST", body: {} }); } catch (e) {}
    setAuth(null);
  }

  // ---------- 登录弹窗 ----------

  let ui = null;
  let onSyncNow = null;

  function ensureUi() {
    if (ui) return ui;
    const style = document.createElement("style");
    style.textContent = `
      .rs-modal{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(27,31,29,.48)}
      .rs-modal.show{display:flex}
      .rs-dialog{width:min(380px,100%);padding:24px;border-radius:12px;background:#fffefa;color:#252724;box-shadow:0 24px 60px rgba(0,0,0,.22);font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
      .rs-title{margin:0 0 6px;font-size:20px;font-weight:700}
      .rs-sub{margin:0 0 16px;color:#68706c;font-size:13px;line-height:1.7}
      .rs-field{display:block;margin-bottom:12px;font-size:13px;color:#68706c}
      .rs-input{display:block;width:100%;height:44px;margin-top:6px;padding:0 12px;border:1px solid #bfc3bc;border-radius:8px;background:#fff;color:#252724;font:500 17px/1 system-ui,sans-serif;box-sizing:border-box}
      .rs-input:focus{outline:none;border-color:#315f7b;box-shadow:0 0 0 3px rgba(49,95,123,.18)}
      .rs-account{margin:4px 0 14px;padding:14px;border:1px solid #d8d9d3;border-radius:8px;background:#f8f7f2;font-size:18px;font-weight:700;text-align:center;letter-spacing:1px}
      .rs-note{min-height:20px;margin:4px 0 0;color:#68706c;font-size:13px;line-height:1.6}
      .rs-note.ok{color:#347052}.rs-note.err{color:#a6382d}
      .rs-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:16px}
      .rs-btn{min-height:40px;padding:8px 16px;border:1px solid #bfc3bc;border-radius:8px;background:#fffefa;color:#252724;font-size:14px;font-weight:600;cursor:pointer}
      .rs-btn.primary{border-color:#a6382d;background:#a6382d;color:#fff}
      .rs-btn:disabled{opacity:.55;cursor:default}
      .rs-account-btn{position:fixed;top:14px;right:14px;z-index:50;min-height:36px;padding:6px 14px;border:1px solid rgba(99,85,67,.25);border-radius:99px;background:rgba(255,253,248,.92);color:#3f3a33;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 18px rgba(65,48,28,.1)}
    `;
    document.head.appendChild(style);
    const modal = document.createElement("div");
    modal.className = "rs-modal";
    modal.innerHTML = `
      <form class="rs-dialog" novalidate>
        <h2 class="rs-title"></h2>
        <p class="rs-sub"></p>
        <div class="rs-login">
          <label class="rs-field">手机号<input class="rs-input" name="phone" type="tel" inputmode="numeric" autocomplete="username" maxlength="16" placeholder="11 位手机号"></label>
          <label class="rs-field">密码<input class="rs-input" name="password" type="password" autocomplete="current-password" maxlength="64" placeholder="密码"></label>
        </div>
        <div class="rs-account" hidden></div>
        <p class="rs-note" role="status"></p>
        <div class="rs-actions"></div>
      </form>`;
    document.body.appendChild(modal);
    const form = modal.querySelector("form");
    ui = {
      modal, form,
      title: modal.querySelector(".rs-title"),
      sub: modal.querySelector(".rs-sub"),
      loginBox: modal.querySelector(".rs-login"),
      account: modal.querySelector(".rs-account"),
      note: modal.querySelector(".rs-note"),
      actions: modal.querySelector(".rs-actions"),
      phone: form.elements.phone,
      password: form.elements.password
    };
    modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && modal.classList.contains("show")) closeModal(); });
    form.addEventListener("submit", e => { e.preventDefault(); submitLogin(); });
    form.addEventListener("click", e => {
      const btn = e.target.closest("[data-rs]");
      if (!btn) return;
      if (btn.dataset.rs === "close") closeModal();
      if (btn.dataset.rs === "logout") logout().then(renderModal);
      if (btn.dataset.rs === "sync" && onSyncNow) onSyncNow();
    });
    return ui;
  }

  function setNote(text, type) {
    if (!ui) return;
    ui.note.className = "rs-note" + (type ? " " + type : "");
    ui.note.textContent = text || "";
  }

  function renderModal() {
    const auth = getAuth();
    ui.loginBox.hidden = !!auth;
    ui.account.hidden = !auth;
    if (auth) {
      ui.title.textContent = "账号";
      ui.sub.textContent = onSyncNow ? "已登录，学习进度会自动保存到云端，换设备登录同一个账号即可继续。" : "已登录，打开任意学习卡片都会自动同步进度。";
      ui.account.textContent = accountLabel(auth.user);
      ui.actions.innerHTML = (onSyncNow ? `<button type="button" class="rs-btn" data-rs="sync">立即同步</button>` : "")
        + `<button type="button" class="rs-btn" data-rs="logout">退出登录</button><button type="button" class="rs-btn primary" data-rs="close">完成</button>`;
    } else {
      ui.title.textContent = "登录";
      ui.sub.textContent = "登录后学习进度会保存到云端，换设备也能接着学。";
      ui.actions.innerHTML = `<button type="button" class="rs-btn" data-rs="close">取消</button><button type="submit" class="rs-btn primary">登录</button>`;
    }
  }

  function openModal() {
    ensureUi();
    setNote("");
    renderModal();
    ui.modal.classList.add("show");
    if (!getAuth()) setTimeout(() => (ui.phone.value ? ui.password : ui.phone).focus(), 50);
  }

  function closeModal() {
    if (ui) ui.modal.classList.remove("show");
  }

  async function submitLogin() {
    const phone = ui.phone.value.replace(/[\s-]/g, "");
    const password = ui.password.value;
    if (!/^(\+?86)?1\d{10}$/.test(phone)) return setNote("请输入 11 位手机号", "err");
    if (!password) return setNote("请输入密码", "err");
    const submit = ui.form.querySelector('[type="submit"]');
    submit.disabled = true;
    setNote("正在登录…");
    try {
      await login(phone.replace(/^\+?86(?=1\d{10}$)/, ""), password);
      ui.password.value = "";
      renderModal();
      setNote(onSyncNow ? "登录成功，正在同步…" : "登录成功", "ok");
    } catch (e) {
      setNote(e.status === 401 ? "手机号或密码不正确" : e.message, "err");
    } finally {
      submit.disabled = false;
    }
  }

  function bindButton(button) {
    if (!button) return;
    const update = () => {
      const auth = getAuth();
      button.textContent = auth ? "☁ " + accountLabel(auth.user) : "☁ 登录";
      button.title = auth ? "已登录，进度自动同步" : "登录后同步学习进度";
    };
    button.onclick = e => { e.preventDefault(); openModal(); };
    window.addEventListener("review-auth-change", update);
    window.addEventListener("storage", e => { if (e.key === AUTH_KEY) update(); });
    update();
  }

  // ---------- 卡片进度同步 ----------
  // payload 直接使用页面 getData() 的结果；服务端按 deckKey 校验结构，revision 做乐观并发控制。

  function init(config) {
    const deckKey = config.deckKey;
    let lastSnapshot = "";
    let uploadTimer = null;
    let busy = false;
    let pending = false;
    let applyingRemote = false;

    function metaKey() {
      const auth = getAuth();
      return auth ? META_PREFIX + auth.user.id + ":" + deckKey : "";
    }
    function getMeta() { return readJson(metaKey()) || { revision: 0, synced: "" }; }
    function setMeta(meta) { if (metaKey()) writeJson(metaKey(), meta); }

    function report(text, type) {
      if (ui && ui.modal.classList.contains("show") && getAuth()) setNote(text, type);
    }

    function handleError(e) {
      if (e.status === 401) report("登录已过期，请重新登录", "err");
      else report(e.message, e.network ? "" : "err");
    }

    function applyRemote(snapshot) {
      applyingRemote = true;
      try {
        config.applyData(snapshot.payload);
        lastSnapshot = JSON.stringify(config.getData());
      } finally {
        applyingRemote = false;
      }
      setMeta({ revision: snapshot.revision, synced: lastSnapshot });
    }

    async function push(reason) {
      const meta = getMeta();
      const payload = config.getData();
      const body = JSON.stringify(payload);
      const put = base => request("/progress?deckKey=" + encodeURIComponent(deckKey), {
        method: "PUT",
        body: { baseRevision: base, mutationId: randomId(), schemaVersion: 1, payload, reason: reason || "update" }
      });
      let res;
      try {
        res = await put(meta.revision);
      } catch (e) {
        // 别的设备先写了一版：本机这次改动更新，基于最新版本再写一次。
        if (e.code !== "revision_conflict" || !e.data || !e.data.current) throw e;
        res = await put(e.data.current.revision);
      }
      setMeta({ revision: res.revision, synced: body });
    }

    // 登录后或打开页面时：云端有新版本就载入；没有云端进度或本机有未上传的改动就上传。
    async function syncNow(showNote) {
      if (!getAuth() || busy) { pending = busy; return; }
      busy = true;
      try {
        const meta = getMeta();
        const remote = await request("/progress?deckKey=" + encodeURIComponent(deckKey));
        const local = JSON.stringify(config.getData());
        if (remote.revision > 0 && remote.payload && remote.revision !== meta.revision) {
          applyRemote(remote);
          if (showNote) report("已载入云端进度", "ok");
        } else if (remote.revision === 0 || local !== meta.synced) {
          await push(remote.revision === 0 ? "import" : "update");
          if (showNote) report("已上传本机进度", "ok");
        } else if (showNote) {
          report("已是最新进度", "ok");
        }
      } catch (e) {
        handleError(e);
      } finally {
        busy = false;
      }
      if (pending) { pending = false; scheduleUpload(); }
    }

    async function uploadChanges() {
      if (!getAuth()) return;
      if (busy) { pending = true; return; }
      busy = true;
      try {
        await push("update");
      } catch (e) {
        handleError(e);
      } finally {
        busy = false;
      }
      if (pending) { pending = false; scheduleUpload(); }
    }

    function scheduleUpload() {
      if (applyingRemote || !getAuth()) return;
      clearTimeout(uploadTimer);
      uploadTimer = setTimeout(uploadChanges, 900);
    }

    onSyncNow = () => syncNow(true);
    ensureUi();
    bindButton(document.getElementById("syncBtn"));
    lastSnapshot = JSON.stringify(config.getData());
    let wasLoggedIn = !!getAuth();
    window.addEventListener("review-auth-change", () => {
      const now = !!getAuth();
      if (now && !wasLoggedIn) syncNow(true);
      wasLoggedIn = now;
    });
    if (wasLoggedIn) syncNow(false);
    window.addEventListener("online", () => syncNow(false));
    setInterval(() => {
      const current = JSON.stringify(config.getData());
      if (current !== lastSnapshot) {
        lastSnapshot = current;
        scheduleUpload();
      }
    }, 1200);
  }

  // 没有卡片的页面（首页）只显示登录入口。
  function initAccount(button) {
    ensureUi();
    if (!button) {
      button = document.createElement("button");
      button.className = "rs-account-btn";
      document.body.appendChild(button);
    }
    bindButton(button);
  }

  window.ReviewSync = { init, initAccount, getAuth, login, logout };
})();
