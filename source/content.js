// YouTube Abo-Lesezeichen - Content Script
// Läuft auf: youtube.com/feed/subscriptions

const STORAGE_KEY = "yt_bookmarks";
const SEEN_KEY = "yt_seen_after_bookmark";

// ─── Storage ───────────────────────────────────────────────────────────────

async function getBookmarks() {
  return new Promise((resolve) => {
    browser.storage.local.get(STORAGE_KEY, (r) => resolve(r[STORAGE_KEY] || {}));
  });
}
async function saveBookmarks(bm) {
  return new Promise((resolve) => browser.storage.local.set({ [STORAGE_KEY]: bm }, resolve));
}
async function getSeenVideos() {
  return new Promise((resolve) => {
    browser.storage.local.get(SEEN_KEY, (r) => resolve(r[SEEN_KEY] || {}));
  });
}
async function saveSeenVideos(seen) {
  return new Promise((resolve) => browser.storage.local.set({ [SEEN_KEY]: seen }, resolve));
}

// ─── DOM Helpers ───────────────────────────────────────────────────────────

function isShorts(el) {
  return !!el.querySelector("ytm-shorts-lockup-view-model, [is-shorts]");
}

function getVideoId(el) {
  const link = el.querySelector("a[href*='/watch?v='], a[href*='watch?v=']");
  if (!link) return null;
  const m = (link.getAttribute("href") || "").match(/[?&]v=([^&]+)/);
  return m ? m[1] : null;
}

function getVideoTitle(el) {
  return el.querySelector(".ytLockupMetadataViewModelTitle")?.textContent.trim() || "Unbekanntes Video";
}

function getChannelHref(el) {
  return el.querySelector("a[href^='/@'], a[href*='/channel/']")?.getAttribute("href") || "";
}

function getVideoChannel(el) {
  return el.querySelector("a[href^='/@'], a[href*='/channel/']")?.textContent.trim() || "";
}

function getVideoThumbnail(el) {
  return el.querySelector("img")?.src || "";
}

function getMetadataContainer(el) {
  return el.querySelector(".ytLockupViewModelMetadata");
}

function getVideoPageOrder(el) {
  return Array.from(document.querySelectorAll("ytd-rich-item-renderer")).indexOf(el);
}

// ─── Icons ─────────────────────────────────────────────────────────────────

function getBookmarkIcon(filled) {
  const path = filled
    ? "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"
    : "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22">
    <path fill="currentColor" d="${path}"/>
  </svg>`;
}

// ─── Render: einzelnes Video aktualisieren ─────────────────────────────────
// Wird sowohl beim ersten Durchlauf als auch bei Updates aufgerufen.
// Anstatt "return wenn Button schon da" – Button-Zustand immer aktualisieren.

async function renderVideoElement(el, bookmarks, seen, feedOrder) {
  if (isShorts(el)) return;

  const videoId = getVideoId(el);
  if (!videoId) return;

  const isBookmarked = !!bookmarks[videoId];

  // ── Button: anlegen oder vorhandenen aktualisieren ──
  let btn = el.querySelector(".ytbm-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.className = "ytbm-btn";
    btn.title = "";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleBookmark(videoId, el, btn);
    });

    const menuContainer = el.querySelector(".ytLockupMetadataViewModelMenuButton");
    if (menuContainer) {
      menuContainer.appendChild(btn);
    } else {
      getMetadataContainer(el)?.appendChild(btn);
    }
  }

  // Zustand setzen
  btn.innerHTML = getBookmarkIcon(isBookmarked);
  btn.classList.toggle("ytbm-bookmarked", isBookmarked);

  // ── NEU-Badge: entfernen und ggf. neu setzen ──
  el.querySelector(".ytbm-new-badge")?.remove();

  if (shouldShowNewBadge(el, videoId, bookmarks, seen, feedOrder)) {
    const badge = document.createElement("span");
    badge.className = "ytbm-new-badge";
    badge.textContent = "NEU";
    // Badge im Avatar-Container absolut positionieren
    const avatarEl = el.querySelector(".ytLockupMetadataViewModelAvatar");
    if (avatarEl) {
      avatarEl.style.position = "relative";
      avatarEl.appendChild(badge);
    } else {
      getMetadataContainer(el)?.prepend(badge);
    }
  }
}

// ─── NEU-Badge Logik ───────────────────────────────────────────────────────
// Ein Video bekommt NEU wenn es im Feed OBERHALB des Lesezeichen-Videos
// desselben Kanals erscheint – unabhängig von Index oder Datum.
// Dazu wird die aktuelle DOM-Reihenfolge live ausgewertet.

function buildFeedOrder() {
  // Gibt eine Map zurück: videoId → position (0 = ganz oben)
  const order = new Map();
  const all = document.querySelectorAll("ytd-rich-item-renderer");
  let pos = 0;
  for (const el of all) {
    const id = getVideoId(el);
    if (id) order.set(id, pos++);
  }
  return order;
}

// badgeMode: "global" = alles vor dem neuesten Lesezeichen (kanalunabhängig)
//             "channel" = nur Videos des gleichen Kanals vor dessen Lesezeichen

function shouldShowNewBadge(el, videoId, bookmarks, seen, feedOrder) {
  if (seen.__badgesDisabled) return false;
  if (seen[videoId] !== undefined) return false;

  const mode = seen.__badgeMode || "global";
  const currentPos = feedOrder.get(videoId);
  if (currentPos === undefined) return false;

  if (mode === "global") {
    // Neuestes sichtbares Lesezeichen finden (am weitesten oben im Feed)
    let newestPos = Infinity;
    let newestId = null;
    for (const bm of Object.values(bookmarks)) {
      const pos = feedOrder.get(bm.videoId);
      if (pos !== undefined && pos < newestPos) {
        newestPos = pos;
        newestId = bm.videoId;
      }
    }
    if (newestId === null) return false;
    if (videoId === newestId) return false;
    return currentPos < newestPos;

  } else {
    // channel-Modus: nur Videos desselben Kanals vor dem Kanal-Lesezeichen
    const channelHref = getChannelHref(el);
    if (!channelHref) return false;
    const channelBookmark = Object.values(bookmarks).find(b => b.channelHref === channelHref);
    if (!channelBookmark) return false;
    if (videoId === channelBookmark.videoId) return false;
    const bookmarkPos = feedOrder.get(channelBookmark.videoId);
    if (bookmarkPos === undefined) return false;
    return currentPos < bookmarkPos;
  }
}

// ─── Alle Videos rendern ───────────────────────────────────────────────────

async function renderAllVideos() {
  const bookmarks = await getBookmarks();
  const seen = await getSeenVideos();
  const feedOrder = buildFeedOrder();
  const els = document.querySelectorAll("ytd-rich-item-renderer");
  for (const el of els) {
    await renderVideoElement(el, bookmarks, seen, feedOrder);
  }
}

// ─── Toggle Lesezeichen ───────────────────────────────────────────────────

async function toggleBookmark(videoId, el, btn) {
  const bookmarks = await getBookmarks();
  const seen = await getSeenVideos();

  if (bookmarks[videoId]) {
    // Lesezeichen entfernen
    delete bookmarks[videoId];
  } else {
    // Lesezeichen setzen
    bookmarks[videoId] = {
      videoId,
      title: getVideoTitle(el),
      channel: getVideoChannel(el),
      channelHref: getChannelHref(el),
      thumbnail: getVideoThumbnail(el),
      savedAt: Date.now(),
    };

    // Alle Videos ab dem Lesezeichen abwärts (gleiche Position oder weiter unten)
    // als gesehen markieren – egal welcher Kanal
    const fo = buildFeedOrder();
    const bmPos = fo.get(videoId) ?? 0;
    fo.forEach((pos, id) => {
      if (pos >= bmPos) {
        seen[id] = Date.now();
      }
    });
  }

  await saveBookmarks(bookmarks);
  await saveSeenVideos(seen);
  await renderAllVideos();
}

// ─── MutationObserver ─────────────────────────────────────────────────────

let debounce = null;
const observer = new MutationObserver(() => {
  clearTimeout(debounce);
  debounce = setTimeout(renderAllVideos, 500);
});
observer.observe(document.body, { childList: true, subtree: true });

// ─── Init ─────────────────────────────────────────────────────────────────

setTimeout(renderAllVideos, 1500);

browser.runtime.onMessage.addListener((message) => {
  if (message.action === "getBookmarks") return getBookmarks();

  if (message.action === "scrollToVideo") {
    const videoId = message.videoId;
    const els = document.querySelectorAll("ytd-rich-item-renderer");
    for (const el of els) {
      if (getVideoId(el) === videoId) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Kurz hervorheben
        el.classList.add("ytbm-highlight");
        setTimeout(() => el.classList.remove("ytbm-highlight"), 2000);
        return Promise.resolve({ success: true });
      }
    }
    return Promise.resolve({ success: false, reason: "not_found" });
  }
  if (message.action === "getSeenVideos") return getSeenVideos();

  if (message.action === "removeBookmark") {
    return (async () => {
      const bm = await getBookmarks();
      delete bm[message.videoId];
      await saveBookmarks(bm);
      await renderAllVideos();
      return { success: true };
    })();
  }

  if (message.action === "clearSeen") {
    return (async () => {
      const seen = await getSeenVideos();
      // Einstellungen beibehalten, nur gesehene Videos löschen
      const preserved = {};
      if (seen.__badgesDisabled) preserved.__badgesDisabled = true;
      if (seen.__badgeMode) preserved.__badgeMode = seen.__badgeMode;
      await saveSeenVideos(preserved);
      await renderAllVideos();
      return { success: true };
    })();
  }

  if (message.action === "disableBadges") {
    return (async () => {
      const seen = await getSeenVideos();
      seen.__badgesDisabled = true;
      await saveSeenVideos(seen);
      await renderAllVideos();
      return { success: true };
    })();
  }

  if (message.action === "setBadgeMode") {
    return (async () => {
      const seen = await getSeenVideos();
      seen.__badgeMode = message.mode; // "global" or "channel"
      await saveSeenVideos(seen);
      await renderAllVideos();
      return { success: true };
    })();
  }

  if (message.action === "enableBadges") {
    return (async () => {
      const seen = await getSeenVideos();
      delete seen.__badgesDisabled;
      await saveSeenVideos(seen);
      await renderAllVideos();
      return { success: true };
    })();
  }
});
