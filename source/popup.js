// popup.js – YouTube Abo-Lesezeichen Popup

const app = document.getElementById("app");
let currentTab = null;

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function getCurrentTab() {
  return new Promise((resolve) => {
    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

async function getState() {
  let bookmarks = {}, seen = {};
  try {
    bookmarks = await browser.tabs.sendMessage(currentTab.id, { action: "getBookmarks" }) || {};
    seen = await browser.tabs.sendMessage(currentTab.id, { action: "getSeenVideos" }) || {};
  } catch (e) {}
  return { bookmarks, seen };
}

// ── Vollständiges initiales Rendern ───────────────────────────────────────

async function render() {
  app.innerHTML = "";
  currentTab = await getCurrentTab();
  const isOnSubsPage = currentTab?.url?.includes("youtube.com/feed/subscriptions");

  if (!isOnSubsPage) {
    app.innerHTML = `
      <div class="wrong-page">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
        <p>Diese Erweiterung funktioniert nur auf der<br/>YouTube-Abonnements-Seite.</p>
        <a class="btn-goto" href="https://www.youtube.com/feed/subscriptions" target="_blank">Zur Aboseite</a>
      </div>`;
    return;
  }

  const { bookmarks, seen } = await getState();
  const ok = Object.keys(bookmarks).length >= 0; // content script erreichbar
  if (!ok) {
    app.innerHTML = `<div class="empty"><p>Seite neu laden, damit die Erweiterung aktiv wird.</p></div>`;
    return;
  }

  const badgesDisabled = !!(seen.__badgesDisabled);
  const badgeMode = seen.__badgeMode || "global";
  const entries = Object.values(bookmarks).sort((a, b) => b.savedAt - a.savedAt);

  // ── Status-Bar ──
  const statusBar = document.createElement("div");
  statusBar.className = "status-bar";
  statusBar.innerHTML = `
    <span class="status-count"><span id="bm-count">${entries.length}</span> Lesezeichen</span>
    <button class="btn-clear-seen" id="btn-clear-seen">Neue zurücksetzen</button>
  `;
  app.appendChild(statusBar);

  // ── Badge Controls ──
  const badgeControls = document.createElement("div");
  badgeControls.className = "badge-controls";
  badgeControls.innerHTML = `
    <div class="badge-toggle">
      <span class="badge-toggle-label">NEU-Badges anzeigen</span>
      <button class="toggle-btn ${badgesDisabled ? "" : "active"}" id="btn-badge-toggle">
        <span class="toggle-knob"></span>
      </button>
    </div>
    <div class="badge-mode ${badgesDisabled ? "disabled" : ""}" id="badge-mode-row">
      <span class="badge-toggle-label">Badge-Modus</span>
      <div class="mode-switcher">
        <button class="mode-btn ${badgeMode === "global" ? "active" : ""}" id="btn-mode-global">Alle Videos</button>
        <button class="mode-btn ${badgeMode === "channel" ? "active" : ""}" id="btn-mode-channel">Pro Kanal</button>
      </div>
    </div>
  `;
  app.appendChild(badgeControls);

  // ── Lesezeichen-Liste ──
  const listWrap = document.createElement("div");
  listWrap.id = "bookmark-list-wrap";
  app.appendChild(listWrap);
  renderList(entries, listWrap);

  // ── Diagnose ──
  const debugBtn = document.createElement("button");
  debugBtn.id = "btn-debug";
  debugBtn.className = "btn-debug";
  debugBtn.textContent = "▸ Diagnose";
  app.appendChild(debugBtn);

  const debugOut = document.createElement("pre");
  debugOut.id = "debug-out";
  debugOut.style.display = "none";
  app.appendChild(debugOut);

  // ── Events ──
  document.getElementById("btn-clear-seen").addEventListener("click", async () => {
    await browser.tabs.sendMessage(currentTab.id, { action: "clearSeen" });
    // Nur Zähler/Badges neu laden, kein Flackern
    const { seen: newSeen } = await getState();
    // Badge-Mode Buttons bleiben, nur visuelles Feedback
    const btn = document.getElementById("btn-clear-seen");
    btn.textContent = "Zurückgesetzt ✓";
    btn.disabled = true;
    setTimeout(() => { btn.textContent = "Neue zurücksetzen"; btn.disabled = false; }, 1500);
  });

  document.getElementById("btn-badge-toggle").addEventListener("click", async () => {
    const btn = document.getElementById("btn-badge-toggle");
    const isActive = btn.classList.contains("active");
    await browser.tabs.sendMessage(currentTab.id, { action: isActive ? "disableBadges" : "enableBadges" });
    btn.classList.toggle("active", !isActive);
    document.getElementById("badge-mode-row").classList.toggle("disabled", !isActive);
  });

  document.getElementById("btn-mode-global").addEventListener("click", async () => {
    await browser.tabs.sendMessage(currentTab.id, { action: "setBadgeMode", mode: "global" });
    document.getElementById("btn-mode-global").classList.add("active");
    document.getElementById("btn-mode-channel").classList.remove("active");
  });

  document.getElementById("btn-mode-channel").addEventListener("click", async () => {
    await browser.tabs.sendMessage(currentTab.id, { action: "setBadgeMode", mode: "channel" });
    document.getElementById("btn-mode-channel").classList.add("active");
    document.getElementById("btn-mode-global").classList.remove("active");
  });

  document.getElementById("btn-debug").addEventListener("click", async () => {
    const out = document.getElementById("debug-out");
    if (out.style.display === "block") { out.style.display = "none"; return; }
    try {
      const bm = await browser.tabs.sendMessage(currentTab.id, { action: "getBookmarks" });
      const sv = await browser.tabs.sendMessage(currentTab.id, { action: "getSeenVideos" }) || {};
      const bmList = Object.values(bm || {});
      let txt = `LESEZEICHEN (${bmList.length}):\n`;
      bmList.forEach(b => { txt += `[${b.videoId}]\nKanal: ${b.channelHref}\n\n`; });
      txt += `SEEN: ${Object.keys(sv).filter(k => !k.startsWith("__")).length} Videos\n`;
      txt += `badgesDisabled: ${!!sv.__badgesDisabled}\n`;
      txt += `badgeMode: ${sv.__badgeMode || "global"}`;
      out.textContent = txt;
    } catch(e) { out.textContent = "Fehler: " + e.message; }
    out.style.display = "block";
  });
}

function renderList(entries, container) {
  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z"/>
        </svg>
        <p>Noch keine Lesezeichen gesetzt.<br/>Hover über ein Video → Lesezeichen-Symbol klicken.</p>
      </div>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "bookmark-list";

  entries.forEach((bm) => {
    const item = document.createElement("div");
    item.className = "bookmark-item";
    const thumbHtml = bm.thumbnail
      ? `<img class="bookmark-thumb" src="${escapeHtml(bm.thumbnail)}" alt="" loading="lazy" />`
      : `<div class="bookmark-thumb-placeholder"></div>`;

    item.innerHTML = `
      ${thumbHtml}
      <div class="bookmark-info">
        <a class="bookmark-title"
           href="https://www.youtube.com/watch?v=${escapeHtml(bm.videoId)}"
           target="_blank"
           title="${escapeHtml(bm.title)}">
          ${escapeHtml(bm.title)}
        </a>
        <div class="bookmark-channel">${escapeHtml(bm.channel)}</div>
        <div class="bookmark-date">Gesetzt am ${formatDate(bm.savedAt)}</div>
      </div>
      <div class="item-actions">
        <button class="btn-goto-video" data-videoid="${escapeHtml(bm.videoId)}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
          </svg>
        </button>
        <button class="btn-remove" data-videoid="${escapeHtml(bm.videoId)}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
    `;
    list.appendChild(item);
  });

  container.appendChild(list);

  // Events direkt auf Items – kein re-render
  container.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await browser.tabs.sendMessage(currentTab.id, { action: "removeBookmark", videoId: btn.dataset.videoid });
      // Item aus DOM entfernen statt alles neu zu rendern
      btn.closest(".bookmark-item").remove();
      const remaining = container.querySelectorAll(".bookmark-item").length;
      document.getElementById("bm-count").textContent = remaining;
      if (remaining === 0) renderList([], container);
    });
  });

  container.querySelectorAll(".btn-goto-video").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const result = await browser.tabs.sendMessage(currentTab.id, { action: "scrollToVideo", videoId: btn.dataset.videoid });
      if (result?.success) {
        window.close();
      } else {
        btn.style.color = "#ff4444";
        btn.title = "Video nicht sichtbar – weiter nach unten scrollen";
      }
    });
  });
}

render();
