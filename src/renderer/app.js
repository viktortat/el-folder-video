(() => {
  "use strict";

  const STRIP_COUNT = 10;
  const notesCore = window.NotesCore;
  const thumbnailQueue = new ThumbnailQueue(2);
  const supported = "MP4, WebM, MOV, AVI, MKV, M4V, OGV";
  const DEFAULT_SETTINGS = { version: 1, autoUpdate: true, theme: "dark", storage: { metadataDirectory: "", gitRepositoryUrl: "", obsidianInbox: "", transcriptDirectory: "" }, viewer: { columns: 3, seconds: 10, scroll: "center", panelWidth: 410 }, interface: { metadataCollapsed: false, gridCollapsed: false }, cut: { replaceOriginal: true }, transcription: { modelPath: "" }, ai: { model: "deepseek-flash", apiKey: "", keyConfigured: false, clearKey: false } };
  const SETTINGS_SECTIONS = [
    { id: "viewer", label: "Просмотр видео", hint: "Сетка кадров, временной шаг и прокрутка в плеере.", groups: ["Просмотр видео"], icon: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" },
    { id: "interface", label: "Интерфейс", hint: "Вид панелей при открытии видео.", groups: ["Интерфейс"], icon: "M3 4h18v16H3z M3 9h18 M9 9v11" },
    { id: "storage", label: "Хранилище", hint: "Метаданные видео, Git-репозиторий и статьи Obsidian.", groups: ["Хранилище"], icon: "M3 7V4h7l2 3h9v13H3z" },
    { id: "transcription", label: "Транскрибация", hint: "Локальная модель распознавания и папка субтитров, сводок и заметок.", groups: ["Транскрибация"], icon: "M4 10v4 M8 6v12 M12 3v18 M16 7v10 M20 10v4" },
    { id: "summary", label: "Суммаризация", hint: "Подключение DeepSeek для создания сводок по транскрипции.", groups: ["Суммаризация"], icon: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" },
    { id: "cut", label: "Вырезка и бэкапы", hint: "Сохранение результата вырезки и восстановление оригиналов.", groups: ["Вырезка фрагментов"], icon: "M20 4 8 16 M8 8l12 12 M14 14l-2-2 M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0" },
    { id: "updates", label: "Обновления", hint: "Проверка новых версий и установка обновлений приложения.", groups: ["Обновления"], icon: "M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 2 M18 18a8 8 0 0 1-13-2" }
  ];
  const SETTINGS_FIELDS = [
    { group: "Обновления", key: "autoUpdate", label: "Проверять при запуске", type: "checkbox", hint: "Проверка через 10 секунд после запуска. Установка — после нажатия «Обновить»." },
    { group: "Хранилище", key: "storage.metadataDirectory", label: "Каталог метаданных", type: "text", hint: "JSON-файлы и template.html" },
    { group: "Хранилище", key: "storage.gitRepositoryUrl", label: "Git-репозиторий", type: "text", hint: "URL удалённого репозитория" },
    { group: "Хранилище", key: "storage.obsidianInbox", label: "Папка статей Obsidian", type: "text", hint: "Сюда кнопка в шапке панели сохраняет сводную статью по видео" },
    { group: "Транскрибация", key: "storage.transcriptDirectory", label: "Папка транскрипций", type: "folder", hint: "Сюда сохраняются субтитры (.srt), сводки и заметки. Пустое значение — папка по умолчанию. Уже созданные файлы в новую папку не переносятся." },
    { group: "Транскрибация", key: "transcription.modelPath", label: "Модель Parakeet TDT", type: "text", hint: "Путь к GGUF-файлу; пустое значение — поиск в кэше HuggingFace" },
    { group: "Суммаризация", key: "ai.apiKey", label: "Ключ DeepSeek", type: "password", hint: "Текст транскрипции отправляется в DeepSeek. Ключ шифруется; пустое поле оставляет прежний." },
    { group: "Суммаризация", key: "ai.model", label: "Название модели", type: "text", hint: "По умолчанию deepseek-flash" },
    { group: "Суммаризация", key: "ai.clearKey", label: "Удалить сохранённый ключ", type: "checkbox" },
    { group: "Просмотр видео", key: "viewer.columns", label: "Колонки кадров", type: "select", options: [3, 4, 5, 6, 8] },
    { group: "Просмотр видео", key: "viewer.seconds", label: "Шаг кадров", type: "select", options: [5, 10, 15, 30, 60], suffix: "секунд" },
    { group: "Просмотр видео", key: "viewer.scroll", label: "Автопрокрутка", type: "select", options: [{ value: "center", label: "По центру" }, { value: "edge", label: "До ближайшего края" }, { value: "off", label: "Выключена" }] },
    { group: "Вырезка фрагментов", key: "cut.replaceOriginal", label: "Заменять оригинал", type: "checkbox", hint: "Включено: оригинал уходит в .fv-undo рядом с видео и возвращается по Ctrl+Z. Выключено: результат сохраняется как «имя (cut).ext»." },
    { group: "Интерфейс", key: "interface.metadataCollapsed", label: "Сворачивать панель метаданных", type: "checkbox" },
    { group: "Интерфейс", key: "interface.gridCollapsed", label: "Сворачивать панель кадров", type: "checkbox" }
  ];
  const state = {
    folderPath: "", files: [], skipped: 0, recursive: false, hideEmptyFiles: false, recentDaysEnabled: localStorage.getItem("folder-video-recent-days-enabled") === "true", recentDays: normalizeRecentDays(localStorage.getItem("folder-video-recent-days")), filterText: "", sort: "date", asc: false, page: 1, pageSize: 10,
    tabs: [{ id: "folder", type: "folder", label: "Видео" }], activeTab: "folder", cutJob: null, cutUndo: [], cutPreview: null,
    stripCache: new Map(), stripPending: new Map(), frameCache: new Map(), favoriteThumbnailCache: new Map(), durationCache: new Map(), youtubeSourceCache: new Map(), youtubeBusy: new Set(), captureVideos: new Map(), task: 0, thumbnailGeneration: 0, thumbnailPriority: 0,
    recentFolders: JSON.parse(localStorage.getItem("folder-video-recent") || "[]"),
    pinnedFolders: JSON.parse(localStorage.getItem("folder-video-pinned") || "[]"),
    favorites: JSON.parse(localStorage.getItem("folder-video-favorites") || "[]"), favoritesOpen: false, favoritesOnly: false, favoritesFolderOnly: false,
    recentVideos: JSON.parse(localStorage.getItem("folder-video-recent-videos") || "[]"), recentThumbnailCache: new Map(), recentVideosOpen: false,
    speedUp: null, transcript: null,
    metadataCollapsed: false, gridCollapsed: false,
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  };
  const $ = selector => document.querySelector(selector);
  const view = $("#view");
  const tabsEl = $("#tabs");
  const tabbarEl = $(".tabbar");
  const tabsListButton = $("#tabsListButton");
  const toastEl = $("#toast");
  const themeToggle = $("#themeToggle");
  const favoritesButton = $("#favoritesButton");
  const recentVideosButton = $("#recentVideosButton");
  const settingsButton = $("#settingsButton");
  const appVersion = $("#appVersion");
  let toastTimer;
  let resizeTimer;
  let updateStatus = { busy: false, message: "", error: false };
  let restoringSession = true;
  let lastSessionSave = 0;

  function saveSession() {
    if (restoringSession) return;
    try {
      localStorage.setItem("folder-video-session", JSON.stringify(window.SessionCore.snapshot(state)));
      lastSessionSave = Date.now();
    } catch (_) {}
  }

  async function restoreSession() {
    var session;
    try { session = window.SessionCore.parse(localStorage.getItem("folder-video-session")); } catch (_) { return; }
    if (!session) return;
    var unavailable = 0;
    var tabs = await Promise.all(session.tabs.map(async function(saved) {
      if (saved.type === "folder") return { id: "folder", type: "folder", label: "Видео" };
      if (saved.type === "settings") return { id: "settings", type: "settings", draft: clone(state.settings), dirty: false };
      try {
        var video = await window.folderVideo.readVideo(saved.path);
        if (video) {
          var tab = createPlayerTab(video);
          Object.keys(saved).forEach(function(key) { if (key !== "path") tab[key] = saved[key]; });
          return tab;
        }
      } catch (_) {}
      unavailable += 1;
      return null;
    }));
    state.tabs = tabs.filter(Boolean);
    state.activeTab = session.activeTab === null ? null : (state.tabs.some(function(tab) { return tab.id === session.activeTab; }) ? session.activeTab : (state.tabs[0] ? state.tabs[0].id : null));
    state.folderPath = session.folderPath;
    state.recursive = session.recursive;
    if (state.folderPath) {
      try {
        var result = await window.folderVideo.scan(state.folderPath, state.recursive);
        state.files = result.files; state.skipped = result.skipped;
        await window.folderVideo.setTitle(state.folderPath);
      } catch (_) { notice("Не удалось открыть сохранённую папку"); }
    }
    if (unavailable) notice("Недоступные видео пропущены: " + unavailable);
  }

  window.addEventListener("beforeunload", saveSession);

  function showUpdateStatus(status) {
    updateStatus = status;
    var button = $("#checkUpdates");
    if (button) {
      button.disabled = status.busy;
      button.textContent = status.busy ? "Подождите…" : "Проверить обновление";
      button.setAttribute("aria-busy", String(status.busy));
    }
    var text = $("#updateStatus");
    if (text) { text.textContent = status.message || "Проверить наличие новой версии Folder-video"; text.classList.toggle("error", status.error); }
    $("#updateActivity").textContent = status.busy ? status.message : "";
  }
  window.folderVideo.onUpdateStatus(showUpdateStatus);
  window.folderVideo.getUpdateState().then(showUpdateStatus).catch(function() {});
  window.folderVideo.onPrepareUpdate(async function() {
    if (state.cutJob || state.speedUp || state.transcript || state.youtubeBusy.size) throw new Error("Дождитесь завершения обработки видео и повторите обновление.");
    if (state.tabs.some(function(tab) { return tab.metadataDirty || (tab.type === "settings" && tab.dirty); })) throw new Error("Сохраните изменения метаданных и настроек перед обновлением.");
    var players = state.tabs.filter(function(tab) { return tab.type === "player"; });
    await Promise.all(players.map(flushPlayerNotes));
    if (players.some(function(tab) { return tab.notesDirty || tab.notesError; })) throw new Error("Не удалось сохранить заметки. Сохраните их перед обновлением.");
  });

  window.folderVideo.onSpeedUpProgress(function(progress) {
    if (!state.speedUp || progress.operationId !== state.speedUp.operationId) return;
    state.speedUp.progress = progress.percent;
    updateSpeedUpControl();
  });

  window.folderVideo.getAppInfo().then(function(info) {
    appVersion.textContent = "v" + info.version;
    document.title = "Folder-video-vik [v" + info.version + "]";
  }).catch(function() {});

  function escapeHtml(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
  function normalizeRecentDays(value) { var days = Number(value); return Number.isFinite(days) && days >= 1 ? Math.min(36500, Math.floor(days)) : 7; }
  function formatSize(bytes) { if (bytes < 1024) return bytes + " B"; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"; if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB"; return (bytes / 1073741824).toFixed(2) + " GB"; }
  function formatDate(value) { return new Date(value).toLocaleString([], { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  function formatTime(value) { if (!Number.isFinite(value)) return "—"; const h = Math.floor(value / 3600); const m = Math.floor((value % 3600) / 60); const s = Math.floor(value % 60); return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0"); }
  function notice(message, info, onClick, actionTitle) { if (info === undefined) info = false; toastEl.textContent = message; toastEl.className = "toast show" + (info ? " info" : "") + (onClick ? " clickable" : ""); toastEl.onclick = onClick ? function() { toastEl.className = "toast"; onClick(); } : null; if (onClick) { toastEl.title = actionTitle || "Открыть в Obsidian"; toastEl.setAttribute("role", "button"); } else { toastEl.removeAttribute("title"); toastEl.removeAttribute("role"); } clearTimeout(toastTimer); toastTimer = setTimeout(function() { toastEl.className = "toast"; }, onClick ? 9000 : 3900); }
  function fileKey(video) { return video.path + "|" + video.size + "|" + video.lastModified; }
  function active() { return state.tabs.find(function(tab) { return tab.id === state.activeTab; }); }
  function savePanelPreferences() {
    state.settings.interface.metadataCollapsed = state.metadataCollapsed;
    state.settings.interface.gridCollapsed = state.gridCollapsed;
    window.folderVideo.saveSettings(state.settings).catch(function() {});
  }

  function saveRecentFolders() {
    localStorage.setItem("folder-video-recent", JSON.stringify(state.recentFolders));
  }
  function savePinnedFolders() { localStorage.setItem("folder-video-pinned", JSON.stringify(state.pinnedFolders)); }
  function isPinnedFolder(folderPath) { return state.pinnedFolders.includes(folderPath); }
  function visibleRecentFolders() {
    return state.pinnedFolders.concat(state.recentFolders.filter(function(folderPath) { return !isPinnedFolder(folderPath); })).slice(0, 10);
  }
  function addRecentFolder(folderPath) {
    state.recentFolders = state.recentFolders.filter(function(p) { return p !== folderPath; });
    state.recentFolders.unshift(folderPath);
    if (state.recentFolders.length > 10) state.recentFolders.length = 10;
    saveRecentFolders();
  }
  function togglePinnedFolder(folderPath) {
    var index = state.pinnedFolders.indexOf(folderPath);
    if (index === -1) state.pinnedFolders.unshift(folderPath);
    else state.pinnedFolders.splice(index, 1);
    savePinnedFolders();
  }
  function bindRecentFolderControls(content) {
    content.querySelectorAll(".recent-open").forEach(function(el) {
      el.addEventListener("click", function() {
        var folder = el.dataset.folder;
        if (folder) loadFolder(folder);
      });
    });
    content.querySelectorAll(".recent-pin").forEach(function(button) {
      button.addEventListener("click", function() { togglePinnedFolder(button.dataset.folder); render(); });
    });
  }
  function updateFavoritesButton() { favoritesButton.querySelector("span").textContent = state.favorites.length; }
  function updateRecentVideosButton() { recentVideosButton.querySelector("span").textContent = state.recentVideos.length; }
  function saveFavorites() { localStorage.setItem("folder-video-favorites", JSON.stringify(state.favorites)); }
  function saveRecentVideos() { localStorage.setItem("folder-video-recent-videos", JSON.stringify(state.recentVideos)); }
  function removeRecentVideo(filePath) {
    state.recentVideos = state.recentVideos.filter(function(video) { return video.path !== filePath; });
    saveRecentVideos(); updateRecentVideosButton();
  }
  function favoriteIndex(filePath) { return state.favorites.findIndex(function(video) { return video.path === filePath; }); }
  function isFavorite(filePath) { return favoriteIndex(filePath) !== -1; }
  function toggleFavorite(video) {
    var index = favoriteIndex(video.path);
    if (index === -1) state.favorites.unshift({ path: video.path, name: video.name });
    else state.favorites.splice(index, 1);
    saveFavorites(); updateFavoritesButton();
  }
  function closeFavorites() {
    state.favoritesOpen = false;
    var overlay = $("#favoritesOverlay");
    if (overlay) overlay.remove();
  }
  function rememberRecentVideo(video) {
    state.recentVideos = state.recentVideos.filter(function(item) { return item.path !== video.path; });
    state.recentVideos.unshift({ path: video.path, name: video.name });
    if (state.recentVideos.length > 30) state.recentVideos.length = 30;
    saveRecentVideos(); updateRecentVideosButton();
  }
  function closeRecentVideos() {
    state.recentVideosOpen = false;
    var overlay = $("#recentVideosOverlay");
    if (overlay) overlay.remove();
  }
  async function hydrateRecentVideoThumbnail(item, video) {
    var thumb = item.querySelector(".favorite-thumb");
    if (!thumb || !item.isConnected) return;
    var key = favoriteThumbnailKey(video);
    var cached = state.recentThumbnailCache.get(key);
    if (!cached) {
      cached = await thumbnailQueue.enqueue(async function() {
        return (await captureMiddleFrame(video.url)) || (await captureFrame(video.url, 1)) || (await captureFrame(video.url, 0));
      }, 1);
      if (cached) state.recentThumbnailCache.set(key, cached);
    }
    if (cached && item.isConnected) {
      thumb.innerHTML = "<img src=\"" + escapeHtml(cached) + "\" alt=\"\" />";
      thumb.classList.add("ready");
    }
  }
  function renderRecentVideosPanel() {
    closeFavorites(); closeRecentVideos(); state.recentVideosOpen = true;
    var overlay = document.createElement("div"); overlay.id = "recentVideosOverlay"; overlay.className = "favorites-overlay";
    var items = state.recentVideos.map(function(video) {
      return "<li class=\"favorite-item\" data-path=\"" + escapeHtml(video.path) + "\"><button class=\"favorite-open\" data-path=\"" + escapeHtml(video.path) + "\" title=\"" + escapeHtml(video.name + "\n" + video.path) + "\" aria-label=\"Открыть видео: " + escapeHtml(video.name) + "\"><span class=\"favorite-thumb\" aria-hidden=\"true\"><span class=\"favorite-thumb-placeholder\">▶</span></span><span class=\"favorite-copy\"><strong>" + escapeHtml(video.name) + "</strong><span>" + escapeHtml(video.path) + "</span></span></button><button class=\"recent-video-remove\" data-path=\"" + escapeHtml(video.path) + "\" type=\"button\" title=\"Удалить из последних видео\" aria-label=\"Удалить из последних видео: " + escapeHtml(video.name) + "\">×</button></li>";
    }).join("");
    overlay.innerHTML = "<section class=\"favorites-panel\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Последние просмотренные видео\"><header><strong>Последние видео</strong><span>" + state.recentVideos.length + "</span><button id=\"closeRecentVideos\" title=\"Закрыть список\" aria-label=\"Закрыть список\">×</button></header>" + (items ? "<ul>" + items + "</ul>" : "<p class=\"favorites-empty\">Пока нет просмотренных видео.</p>") + "</section>";
    overlay.addEventListener("click", function(event) { if (event.target === overlay) closeRecentVideos(); });
    document.body.appendChild(overlay);
    $("#closeRecentVideos").addEventListener("click", closeRecentVideos);
    overlay.querySelectorAll(".recent-video-remove").forEach(function(button) {
      button.addEventListener("click", function() {
        removeRecentVideo(button.dataset.path);
        renderRecentVideosPanel();
      });
    });
    overlay.querySelectorAll(".favorite-open").forEach(function(button) {
      button.addEventListener("click", async function() {
        var video = await window.folderVideo.readVideo(button.dataset.path);
        if (video) { closeRecentVideos(); openVideo(video); return; }
        var item = state.recentVideos.find(function(entry) { return entry.path === button.dataset.path; });
        if (item && window.confirm("Видео не найдено по сохранённому пути.\n\nНазвание: " + item.name + "\nПуть: " + item.path + "\n\nУдалить эту запись из списка?")) {
          removeRecentVideo(item.path); renderRecentVideosPanel();
        }
      });
    });
    overlay.querySelectorAll(".favorite-item").forEach(function(item) {
      var recent = state.recentVideos.find(function(entry) { return entry.path === item.dataset.path; });
      if (!recent) return;
      window.folderVideo.readVideo(recent.path).then(function(video) {
        if (video) {
          hydrateRecentVideoThumbnail(item, video);
          return;
        }
        if (window.confirm("Видео не найдено по сохранённому пути.\n\nНазвание: " + recent.name + "\nПуть: " + recent.path + "\n\nУдалить эту запись из списка последних видео?")) {
          removeRecentVideo(recent.path); renderRecentVideosPanel();
        }
      });
    });
  }
  function favoriteThumbnailKey(video) { return video.path + "|" + (video.size || 0) + "|" + (video.lastModified || 0); }
  function removeMissingFavorite(filePath) {
    var index = favoriteIndex(filePath);
    if (index === -1) return;
    state.favorites.splice(index, 1);
    saveFavorites();
    updateFavoritesButton();
    renderActiveView();
    renderFavoritesPanel();
  }
  async function hydrateFavoriteThumbnail(item, video) {
    var thumb = item.querySelector(".favorite-thumb");
    if (!thumb || !item.isConnected) return;
    var key = favoriteThumbnailKey(video);
    var cached = state.favoriteThumbnailCache.get(key);
    if (!cached) {
      // Не запрашиваем metadata отдельным video-элементом: для некоторых кодеков
      // это возвращает 0 и преждевременно обрывает создание миниатюры.
      cached = await thumbnailQueue.enqueue(async function() {
        return (await captureMiddleFrame(video.url)) || (await captureFrame(video.url, 1)) || (await captureFrame(video.url, 0));
      }, 1);
      if (cached) state.favoriteThumbnailCache.set(key, cached);
    }
    if (cached && item.isConnected) {
      thumb.innerHTML = "<img src=\"" + escapeHtml(cached) + "\" alt=\"\" />";
      thumb.classList.add("ready");
    }
  }
  function inCurrentFolder(video) {
    var folder = (state.folderPath || "").replace(/[\\/]+$/, "").toLowerCase().replace(/\//g, "\\");
    var file = String(video.path).toLowerCase().replace(/\//g, "\\");
    return !!folder && file.indexOf(folder + "\\") === 0;
  }
  function renderFavoritesPanel() {
    closeFavorites(); state.favoritesOpen = true;
    var overlay = document.createElement("div");
    overlay.id = "favoritesOverlay"; overlay.className = "favorites-overlay";
    var folderOnly = state.favoritesFolderOnly && !!state.folderPath;
    var shown = folderOnly ? state.favorites.filter(inCurrentFolder) : state.favorites;
    var items = shown.map(function(video) {
      return "<li class=\"favorite-item\" data-path=\"" + escapeHtml(video.path) + "\"><button class=\"favorite-open\" data-path=\"" + escapeHtml(video.path) + "\" title=\"" + escapeHtml(video.name + "\n" + video.path) + "\" aria-label=\"Открыть видео: " + escapeHtml(video.name) + "\"><span class=\"favorite-thumb\" aria-hidden=\"true\"><span class=\"favorite-thumb-placeholder\">▶</span></span><span class=\"favorite-copy\"><strong>" + escapeHtml(video.name) + "</strong><span>" + escapeHtml(video.path) + "</span></span></button><button class=\"favorite-remove\" data-path=\"" + escapeHtml(video.path) + "\" title=\"Удалить из избранного\" aria-label=\"Удалить из избранного\">♥</button></li>";
    }).join("");
    overlay.innerHTML = "<section class=\"favorites-panel\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Избранные видео\"><header><strong>Избранное</strong><span>" + (folderOnly ? shown.length + " / " : "") + state.favorites.length + "</span><button id=\"favoritesFolderOnly\" class=\"favorites-folder-filter" + (folderOnly ? " is-active" : "") + "\" type=\"button\" title=\"" + (state.folderPath ? (folderOnly ? "Показать все избранные" : "Показать избранные только из текущей папки") : "Сначала откройте папку") + "\" aria-label=\"Только избранные из текущей папки\" aria-pressed=\"" + folderOnly + "\"" + (state.folderPath ? "" : " disabled") + ">▤</button><button id=\"closeFavorites\" title=\"Закрыть избранное\" aria-label=\"Закрыть избранное\">×</button></header>" + (items ? "<ul>" + items + "</ul>" : "<p class=\"favorites-empty\">" + (folderOnly ? "В этой папке нет избранных видео." : "Пока нет добавленных видео.") + "</p>") + "</section>";
    overlay.addEventListener("click", function(event) { if (event.target === overlay) closeFavorites(); });
    document.body.appendChild(overlay);
    $("#closeFavorites").addEventListener("click", closeFavorites);
    $("#favoritesFolderOnly").addEventListener("click", function() { state.favoritesFolderOnly = !state.favoritesFolderOnly; renderFavoritesPanel(); });
    overlay.querySelectorAll(".favorite-remove").forEach(function(button) { button.addEventListener("click", function() { toggleFavorite({ path: button.dataset.path }); renderActiveView(); renderFavoritesPanel(); }); });
    overlay.querySelectorAll(".favorite-open").forEach(function(button) { button.addEventListener("click", function() { openFavorite(button.dataset.path); }); });
    overlay.querySelectorAll(".favorite-item").forEach(function(item) {
      var favorite = state.favorites.find(function(video) { return video.path === item.dataset.path; });
      if (favorite) window.folderVideo.readVideo(favorite.path).then(function(video) {
        if (video) {
          hydrateFavoriteThumbnail(item, video);
          return;
        }
        if (window.confirm("Видео не найдено по сохранённому пути.\n\nНазвание: " + favorite.name + "\nПуть: " + favorite.path + "\n\nУдалить эту запись из избранного?")) removeMissingFavorite(favorite.path);
      });
    });
  }
  async function openFavorite(filePath) {
    var video = await window.folderVideo.readVideo(filePath);
    if (!video) { notice("Файл недоступен. Его можно удалить из избранного."); return; }
    closeFavorites(); openVideo(video);
  }

  function applyTheme(theme, persist) {
    document.body.classList.toggle("light", theme === "light");
    themeToggle.textContent = theme === "light" ? "☀" : "☾";
    themeToggle.title = theme === "light" ? "Включить тёмную тему" : "Включить светлую тему";
    state.settings.theme = theme;
    if (persist) window.folderVideo.saveSettings(state.settings).catch(function() {});
  }

  themeToggle.addEventListener("click", function() { applyTheme(document.body.classList.contains("light") ? "dark" : "light", true); });
  favoritesButton.addEventListener("click", renderFavoritesPanel);
  recentVideosButton.addEventListener("click", renderRecentVideosPanel);
  settingsButton.addEventListener("click", openSettings);
  const homeButton = $("#homeButton");
  homeButton.addEventListener("click", function() {
    state.activeTab = null;
    render();
  });
  function updateTabsOverflow() {
    tabbarEl.classList.toggle("tabs-overflow", tabsEl.scrollWidth - tabsEl.clientWidth > 1);
  }
  function tabTitle(tab) { return tab.type === "folder" ? "ВИДЕО" : tab.type === "settings" ? "НАСТРОЙКИ" : tab.video.name; }
  function activateTab(tid) {
    var previous = active(); if (previous && previous.type === "player" && previous.id !== tid) flushPlayerNotes(previous);
    state.activeTab = tid; render();
  }
  function cycleTab(step) {
    if (!state.tabs.length) return;
    var idx = state.tabs.findIndex(function(tab) { return tab.id === state.activeTab; });
    var next = idx < 0 ? (step > 0 ? 0 : state.tabs.length - 1) : (idx + step + state.tabs.length) % state.tabs.length;
    activateTab(state.tabs[next].id);
  }
  function showTabsList() {
    var wasOpen = ctxMenu && ctxMenu.classList.contains("tabs-list-menu");
    closeCtxMenu();
    if (wasOpen) return;
    var menu = document.createElement("div");
    menu.className = "ctx-menu tabs-list-menu";
    menu.setAttribute("role", "menu");
    state.tabs.forEach(function(tab) {
      var row = document.createElement("div");
      row.className = "tabs-list-item" + (tab.id === state.activeTab ? " active" : "");
      row.innerHTML = "<button class=\"tabs-list-open\" type=\"button\" role=\"menuitem\"></button><button class=\"tabs-list-close\" type=\"button\" title=\"Закрыть вкладку\" aria-label=\"Закрыть вкладку\">×</button>";
      var open = row.querySelector(".tabs-list-open");
      open.textContent = tabTitle(tab); open.title = tabTitle(tab);
      open.addEventListener("click", function() { closeCtxMenu(); activateTab(tab.id); });
      row.querySelector(".tabs-list-close").addEventListener("click", function(event) { event.stopPropagation(); closeCtxMenu(); closeTab(tab.id); });
      menu.appendChild(row);
    });
    menu.addEventListener("click", function(event) { event.stopPropagation(); });
    var rect = tabsListButton.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + "px";
    menu.style.right = Math.max(4, window.innerWidth - rect.right) + "px";
    document.body.appendChild(menu);
    ctxMenu = menu;
    tabsListButton.setAttribute("aria-expanded", "true");
    var activeRow = menu.querySelector(".tabs-list-item.active");
    if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
  }
  tabsListButton.addEventListener("click", function(event) { event.stopPropagation(); showTabsList(); });
  document.addEventListener("keydown", function(event) {
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    var step = event.key === "Tab" ? (event.shiftKey ? -1 : 1) : event.key === "PageDown" ? 1 : event.key === "PageUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    closeCtxMenu();
    cycleTab(step);
  });
  tabsEl.addEventListener("wheel", function(event) {
    if (tabsEl.scrollWidth <= tabsEl.clientWidth) return;
    var delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    tabsEl.scrollLeft += delta;
  }, { passive: false });
  if (window.ResizeObserver) new ResizeObserver(updateTabsOverflow).observe(tabsEl);
  else window.addEventListener("resize", updateTabsOverflow);
  window.folderVideo.onTranscriptProgress(function(progress) {
    if (!state.transcript || progress.operationId !== state.transcript.operationId) return;
    state.transcript.progress = progress.percent;
    var tab = state.tabs.find(function(item) { return item.type === 'player' && item.video.path === state.transcript.filePath; });
    if (tab) { tab.transcriptProgress = progress.percent; updateTranscriptControls(tab); }
  });
  document.addEventListener("keydown", function(event) { if (event.key === "Escape") { if (state.favoritesOpen) closeFavorites(); if (state.recentVideosOpen) closeRecentVideos(); closeCtxMenu(); } }); document.addEventListener("click", function() { closeCtxMenu(); });
  applyTheme("dark", false); updateFavoritesButton(); updateRecentVideosButton();
  const settingsReady = window.folderVideo.getSettings().then(function(result) {
    state.settings = result.settings;
    if (!result.hasConfig) {
      state.settings.theme = localStorage.getItem("folder-video-theme") || state.settings.theme;
      state.settings.interface.metadataCollapsed = localStorage.getItem("folder-video-metadata-collapsed") === "true";
      state.settings.interface.gridCollapsed = localStorage.getItem("folder-video-grid-collapsed") === "true";
    }
    state.metadataCollapsed = state.settings.interface.metadataCollapsed;
    state.gridCollapsed = state.settings.interface.gridCollapsed;
    applyTheme(state.settings.theme, false);
  }).catch(function() { notice("Не удалось загрузить настройки"); });

  function updatePageSizeFromLayout() {
    if (state._sizing) return; state._sizing = true;
    var tab = active();
    if (!tab || tab.type !== "folder") { state._sizing = false; return; }
    var content = $("#folderContent");
    var row = content ? content.querySelector(".row") : null;
    if (!content || !row) { state._sizing = false; return; }
    var pagerHeight = (content.querySelector(".pager") ? content.querySelector(".pager").getBoundingClientRect().height : 0);
    var rowHeight = row.getBoundingClientRect().height + 7;
    var nextPageSize = Math.max(1, Math.floor((content.clientHeight - pagerHeight - 8) / rowHeight));
    if (nextPageSize === state.pageSize) { state._sizing = false; return; }
    var firstVisibleIndex = (state.page - 1) * state.pageSize;
    state.pageSize = nextPageSize;
    state.page = Math.floor(firstVisibleIndex / nextPageSize) + 1;
    renderFolder();
    state._sizing = false;
  }

  window.addEventListener("resize", function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updatePageSizeFromLayout, 100);
  });

  function sortedFiles() {
    return [].concat(state.files).sort(function(a, b) {
      var result = state.sort === "name"
        ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        : state.sort === "size"
          ? a.size - b.size
          : a.lastModified - b.lastModified;
      return state.asc ? result : -result;
    });
  }
  function filteredFiles() {
    var query = state.filterText.toLowerCase();
    var earliestDate = Date.now() - state.recentDays * 86400000;
    return sortedFiles().filter(function(file) {
      return (!state.favoritesOnly || isFavorite(file.path)) && (!state.hideEmptyFiles || file.size > 0) && (!state.recentDaysEnabled || file.lastModified >= earliestDate) && (!query || file.name.toLowerCase().includes(query));
    });
  }

  /* context menu */
  var ctxMenu = null;
  function closeCtxMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } tabsListButton.removeAttribute("aria-expanded"); }
  function showCtxMenu(event, filePath, playerTab, player) {
    closeCtxMenu();
    var menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    var playerActions = playerTab && player
      ? '<button data-action="screenshot">Сделать скриншот текущего кадра</button><button data-action="go-to-video">Перейти на видео</button>'
      : '';
    menu.innerHTML = playerActions + '<button data-action="copy-name">Скопировать название без расширения</button><button data-action="copy">Скопировать полный путь к файлу</button><button data-action="shortcut">Сделать ссылку на файл в папке</button><div class="sep"></div><button data-action="move">Перенести в другую папку</button><button class="danger" data-action="delete">Удалить видео</button>';
    menu.querySelectorAll('button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        closeCtxMenu();
        if (btn.dataset.action === 'screenshot' && playerTab && player) {
          takeVideoScreenshot(playerTab, player);
        } else if (btn.dataset.action === 'copy-name') {
          copyVideoNameByPath(filePath);
        } else if (btn.dataset.action === 'copy') {
          window.folderVideo.copyPath(filePath);
          notice('Путь скопирован в буфер обмена', true);
        } else if (btn.dataset.action === 'shortcut') {
          createFileShortcut(filePath);
        } else if (btn.dataset.action === 'go-to-video') {
          goToVideoInFolder(filePath);
        } else if (btn.dataset.action === 'move') {
          moveFile(filePath);
        } else if (btn.dataset.action === 'delete') {
          deleteFile(filePath);
        }
      });
    });
    document.body.appendChild(menu);
    ctxMenu = menu;
    requestAnimationFrame(function() {
      var mr = menu.getBoundingClientRect();
      if (mr.right > window.innerWidth) menu.style.left = (window.innerWidth - mr.width - 4) + 'px';
      if (mr.bottom > window.innerHeight) menu.style.top = (window.innerHeight - mr.height - 4) + 'px';
    });
  }
  async function createFileShortcut(filePath) {
    var result = await window.folderVideo.createFileShortcut(filePath);
    if (!result || result.canceled) return;
    if (result.error) { notice('Не удалось создать ярлык: ' + result.error); return; }
    notice('Ярлык создан: ' + result.shortcutPath, true);
  }
  function focusVideoRow(filePath) {
    state.filterText = '';
    var index = sortedFiles().findIndex(function(item) { return item.path === filePath; });
    if (index === -1) { notice('Видео отсутствует в папке.'); return; }
    state.page = Math.floor(index / Math.max(1, state.pageSize)) + 1;
    state.activeTab = 'folder';
    render();
    requestAnimationFrame(function() {
      var row = document.querySelector('.row[data-path="' + CSS.escape(filePath) + '"]');
      if (!row) return;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.add('located');
      setTimeout(function() { row.classList.remove('located'); }, 1400);
    });
  }
  async function goToVideoInFolder(filePath) {
    if (state.files.some(function(item) { return item.path === filePath; })) { focusVideoRow(filePath); return; }
    var folderPath = await window.folderVideo.getParentFolder(filePath);
    if (!folderPath) { notice('Видео больше недоступно по исходному пути.'); return; }
    await loadFolder(folderPath, true);
    focusVideoRow(filePath);
  }
  async function moveFile(filePath) {
    var playerTab = active();
    var replacement = playerTab && playerTab.type === 'player' && playerTab.video.path === filePath
      ? adjacentPlayerVideo(playerTab, 1) || adjacentPlayerVideo(playerTab, -1)
      : null;
    await Promise.all(state.tabs.filter(function(tab) { return tab.type === "player" && tab.video.path === filePath; }).map(flushPlayerNotes));
    var result = await window.folderVideo.moveFile(filePath);
    if (!result) return;
    if (result.canceled) return;
    if (result.error) { notice('Ошибка: ' + result.error); return; }
    if (result.unchanged) { notice('Файл уже находится в выбранной папке', true); return; }
    if (result.sourceDeleted) {
      state.files = state.files.filter(function(file) { return file.path !== filePath; });
      if (isFavorite(filePath)) {
        state.favorites.splice(favoriteIndex(filePath), 1);
        saveFavorites(); updateFavoritesButton();
      }
      if (replacement) setPlayerVideo(playerTab, replacement);
      state.tabs = state.tabs.filter(function(tab) { return tab.type !== 'player' || tab.video.path !== filePath; });
      if (!active()) state.activeTab = 'folder';
      notice('Видео перемещено в корзину', true);
      render();
      return;
    }
    notice(result.warning || 'Файл перенесён', !result.warning);
    state.files = state.files.filter(function(f) { return f.path !== filePath; });
    if (replacement) setPlayerVideo(playerTab, replacement);
    state.tabs = state.tabs.filter(function(tab) { return tab.type !== 'player' || tab.video.path !== filePath; });
    if (!active()) state.activeTab = 'folder';
    render();
  }
  var YOUTUBE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10 9.5 5 2.5-5 2.5Z"/></svg>';
  function youtubeSourceKey(video) { return video.path + "|" + (video.size || 0) + "|" + (video.lastModified || 0); }
  function youtubeWritable(filePath) { return /\.(mp4|m4v|mov)$/i.test(filePath); }
  function currentYoutubeInfo(video) {
    if (state.youtubeBusy.has(video.path)) return { mode: "busy" };
    if (!youtubeWritable(video.path)) return { mode: "unsupported" };
    return state.youtubeSourceCache.get(youtubeSourceKey(video)) || { mode: "loading" };
  }
  function applyYoutubeButton(video) {
    var button = $("#playerYoutube"), tab = active();
    if (!button || !tab || tab.type !== "player" || tab.video.path !== video.path) return;
    var info = currentYoutubeInfo(video), title;
    if (info.mode === "linked") title = "Открыть исходник на YouTube";
    else if (info.mode === "none") title = "Найти исходник на YouTube и записать ссылку в свойства файла";
    else if (info.mode === "busy") title = "Идёт поиск исходника на YouTube…";
    else if (info.mode === "unsupported") title = "Формат файла не поддерживает запись ссылки в свойства (нужен mp4, m4v или mov)";
    else if (info.mode === "error") title = "Не удалось прочитать свойства файла: " + info.message + ". Нажмите, чтобы искать на YouTube";
    else title = "Читаю свойства файла…";
    button.title = title; button.setAttribute("aria-label", title);
    button.classList.toggle("is-linked", info.mode === "linked");
    button.classList.toggle("is-busy", info.mode === "busy");
    button.disabled = info.mode === "busy" || info.mode === "unsupported" || info.mode === "loading";
  }
  async function loadYoutubeSource(video) {
    if (youtubeWritable(video.path) && !state.youtubeSourceCache.has(youtubeSourceKey(video))) {
      var result = await window.folderVideo.readYoutubeSource(video.path);
      state.youtubeSourceCache.set(youtubeSourceKey(video), result && !result.error
        ? (result.url ? { mode: "linked", url: result.url } : { mode: "none" })
        : { mode: "error", message: result && result.error ? result.error : "нет ответа" });
    }
    applyYoutubeButton(video);
  }
  async function saveYoutubeSource(video, url) {
    state.youtubeBusy.add(video.path); applyYoutubeButton(video);
    var result = await window.folderVideo.writeYoutubeSource(video.path, url);
    state.youtubeBusy.delete(video.path);
    if (!result || result.error) { notice("Не удалось записать ссылку: " + (result && result.error ? result.error : "нет ответа")); applyYoutubeButton(video); return; }
    state.youtubeSourceCache.set(youtubeSourceKey(video), { mode: "linked", url: result.url });
    notice(result.warning ? "Ссылка записана. " + result.warning : "Ссылка на YouTube записана в свойства файла", !result.warning);
    applyYoutubeButton(video);
  }
  function closeYoutubePicker() { var overlay = $("#youtubePickerOverlay"); if (overlay) overlay.remove(); document.removeEventListener("keydown", youtubePickerKeydown); }
  function youtubePickerKeydown(event) { if (event.key === "Escape") closeYoutubePicker(); }
  function showYoutubePicker(video, search, fileDuration) {
    closeYoutubePicker();
    var overlay = document.createElement("div"); overlay.id = "youtubePickerOverlay"; overlay.className = "favorites-overlay";
    var items = search.candidates.map(function(candidate, index) {
      var meta = [candidate.channel, candidate.duration === null ? "длительность неизвестна" : formatTime(candidate.duration)];
      if (candidate.duration !== null && Number.isFinite(fileDuration) && Math.abs(candidate.duration - fileDuration) > 2) meta.push("файл: " + formatTime(fileDuration));
      return "<li class=\"favorite-item youtube-candidate\"><div class=\"youtube-candidate-text\"><strong>" + escapeHtml(candidate.title) + "</strong><span>" + escapeHtml(meta.filter(Boolean).join(" · ")) + "</span></div>" +
        "<button type=\"button\" class=\"youtube-candidate-button\" data-open=\"" + index + "\" title=\"Открыть ролик в браузере для проверки\" aria-label=\"Открыть ролик в браузере для проверки\">Открыть</button>" +
        "<button type=\"button\" class=\"youtube-candidate-button is-primary\" data-save=\"" + index + "\" title=\"Записать эту ссылку в свойства файла\" aria-label=\"Записать эту ссылку в свойства файла\">Записать</button></li>";
    }).join("");
    overlay.innerHTML = "<section class=\"favorites-panel youtube-picker\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Выбор исходника на YouTube\"><header><strong>Выберите исходник</strong><span>" + search.candidates.length + "</span><button id=\"closeYoutubePicker\" title=\"Закрыть\" aria-label=\"Закрыть\">×</button></header><p class=\"youtube-picker-note\">Точного совпадения по длительности нет. Запрос: «" + escapeHtml(search.query) + "»</p><ul>" + items + "</ul></section>";
    document.body.appendChild(overlay);
    document.addEventListener("keydown", youtubePickerKeydown);
    overlay.addEventListener("click", function(event) { if (event.target === overlay) closeYoutubePicker(); });
    $("#closeYoutubePicker").addEventListener("click", closeYoutubePicker);
    overlay.querySelectorAll("[data-open]").forEach(function(button) { button.addEventListener("click", function() { window.folderVideo.openYoutubeSource(search.candidates[Number(button.dataset.open)].url); }); });
    overlay.querySelectorAll("[data-save]").forEach(function(button) { button.addEventListener("click", function() { var candidate = search.candidates[Number(button.dataset.save)]; closeYoutubePicker(); saveYoutubeSource(video, candidate.url); }); });
  }
  async function findYoutubeSource(video, player) {
    if (!window.confirm("Искать исходник на YouTube по названию файла?\n\n" + video.name + "\n\nНазвание уйдёт в сеть (YouTube). Найденная ссылка будет записана в свойство «URL-адрес автора»; даты создания и изменения файла не изменятся.")) return;
    var fileDuration = player && Number.isFinite(player.duration) ? player.duration : NaN;
    state.youtubeBusy.add(video.path); applyYoutubeButton(video);
    var search = await window.folderVideo.searchYoutubeSource(video.path, fileDuration);
    state.youtubeBusy.delete(video.path); applyYoutubeButton(video);
    if (!search || search.error) { notice("Поиск на YouTube не удался: " + (search && search.error ? search.error : "нет ответа")); return; }
    if (!search.candidates.length) { notice("На YouTube ничего не найдено по запросу «" + search.query + "»"); return; }
    if (search.auto) saveYoutubeSource(video, search.auto.url);
    else showYoutubePicker(video, search, fileDuration);
  }
  function openYoutubeSource(video) {
    var info = state.youtubeSourceCache.get(youtubeSourceKey(video));
    if (info && info.mode === "linked") window.folderVideo.openYoutubeSource(info.url);
  }
  async function deleteFile(filePath) {
    var playerTab = active();
    var replacement = playerTab && playerTab.type === 'player' && playerTab.video.path === filePath
      ? adjacentPlayerVideo(playerTab, 1) || adjacentPlayerVideo(playerTab, -1)
      : null;
    await Promise.all(state.tabs.filter(function(tab) { return tab.type === "player" && tab.video.path === filePath; }).map(flushPlayerNotes));
    var result = await window.folderVideo.deleteFile(filePath);
    if (!result || result.canceled) return;
    if (result.error) { notice('Ошибка: ' + result.error); return; }
    state.files = state.files.filter(function(file) { return file.path !== filePath; });
    if (isFavorite(filePath)) {
      state.favorites.splice(favoriteIndex(filePath), 1);
      saveFavorites(); updateFavoritesButton();
    }
    if (replacement) setPlayerVideo(playerTab, replacement);
    state.tabs = state.tabs.filter(function(tab) { return tab.type !== 'player' || tab.video.path !== filePath; });
    if (!active()) state.activeTab = 'folder';
    notice('Видео перемещено в корзину', true);
    render();
  }
  function render() { renderTabs(); renderActiveView(); saveSession(); }
  function renderTabs() {
    var tabsScroll = tabsEl.scrollLeft;
    tabsEl.replaceChildren();
    for (var ti = 0; ti < state.tabs.length; ti++) {
      var tab = state.tabs[ti];
      var button = document.createElement("button");
      button.className = "tab" + (tab.id === state.activeTab ? " active" : "");
      var tabName = tabTitle(tab);
      button.title = tabName;
      button.innerHTML = "<span class=\"tab-dot\"></span><span class=\"tab-name\">" + escapeHtml(tabName) + "</span><span class=\"close-tab\" title=\"Закрыть вкладку\">×</span>";
      button.addEventListener("click", function(tid) {
        return function(event) {
          if (event.target.closest(".close-tab")) return closeTab(tid);
          activateTab(tid);
        };
      }(tab.id));
      button.addEventListener("auxclick", function(tid) {
        return function(event) { if (event.button === 1) { event.preventDefault(); closeTab(tid); } };
      }(tab.id));
      button.addEventListener("mousedown", function(event) { if (event.button === 1) event.preventDefault(); });
      tabsEl.appendChild(button);
    }
    tabsEl.scrollLeft = tabsScroll;
    var activeButton = tabsEl.querySelector(".tab.active");
    if (activeButton) {
      var tabRect = activeButton.getBoundingClientRect(), stripRect = tabsEl.getBoundingClientRect();
      if (tabRect.left < stripRect.left) tabsEl.scrollLeft += tabRect.left - stripRect.left;
      else if (tabRect.right > stripRect.right) tabsEl.scrollLeft += tabRect.right - stripRect.right;
    }
    updateTabsOverflow();
  }

  function renderActiveView() {
    var tab = active();
    if (!tab) renderHome();
    else if (tab.type === "folder") renderFolder();
    else if (tab.type === "settings") renderSettings(tab);
    else renderPlayer(tab);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function readSetting(object, key) { return key.split(".").reduce(function(value, part) { return value[part]; }, object); }
  function writeSetting(object, key, value) { var parts = key.split("."); var target = object; for (var i = 0; i < parts.length - 1; i++) target = target[parts[i]]; target[parts[parts.length - 1]] = value; }
  function openSettings() {
    var previous = active(); if (previous && previous.type === "player") flushPlayerNotes(previous);
    var tab = state.tabs.find(function(item) { return item.type === "settings"; });
    if (!tab) { tab = { id: "settings", type: "settings", draft: clone(state.settings), dirty: false }; state.tabs.push(tab); }
    state.activeTab = tab.id; render();
  }
  function settingsControlMarkup(field, value) {
    var id = "setting-" + field.key.split(".").join("-");
    var attributes = ' id="' + id + '" data-setting="' + field.key + '" title="' + escapeHtml(field.label) + '"' + (field.hint ? ' aria-describedby="' + id + '-hint"' : "");
    if (field.type === "password") return '<input' + attributes + ' type="password" autocomplete="off" placeholder="' + (state.settings.ai.keyConfigured ? "Ключ сохранён" : "Введите API-ключ") + '" value="' + escapeHtml(value || "") + '" />';
    if (field.type === "folder") return '<span class="settings-folder"><input' + attributes + ' type="text" value="' + escapeHtml(value) + '" /><button type="button" class="settings-reset" data-browse="' + field.key + '" title="Выбрать папку" aria-label="Выбрать папку: ' + escapeHtml(field.label) + '">Обзор…</button></span>';
    if (field.type === "text") return '<input' + attributes + ' type="text" value="' + escapeHtml(value) + '" />';
    if (field.type === "checkbox") return '<span class="settings-switch"><input' + attributes + ' type="checkbox"' + (value ? " checked" : "") + '/><span aria-hidden="true"></span></span>';
    var options = field.options.map(function(option) { var item = typeof option === "object" ? option : { value: option, label: String(option) + (field.suffix ? " " + field.suffix : "") }; return "<option value=\"" + escapeHtml(item.value) + "\"" + (String(item.value) === String(value) ? " selected" : "") + ">" + escapeHtml(item.label) + "</option>"; }).join("");
    return "<select" + attributes + ">" + options + "</select>";
  }
  function settingsFieldMarkup(field, tab) {
    var id = "setting-" + field.key.split(".").join("-");
    return '<div class="settings-row' + (field.type === "checkbox" ? ' settings-row--switch' : '') + '"><label class="settings-label" for="' + id + '"><strong>' + escapeHtml(field.label) + '</strong>' + (field.hint ? '<small id="' + id + '-hint">' + escapeHtml(field.hint) + '</small>' : '') + '</label><div class="settings-control">' + settingsControlMarkup(field, readSetting(tab.draft, field.key)) + '</div></div>';
  }
  function settingsIconMarkup(section) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + section.icon + '"></path></svg>';
  }
  function renderSettings(tab) {
    var restoreTop = tab.settingsScrollTop || 0;
    var navigation = SETTINGS_SECTIONS.map(function(section) {
      return '<a href="#settings-' + section.id + '" data-settings-section="' + section.id + '" title="' + escapeHtml(section.label) + '">' + settingsIconMarkup(section) + '<span>' + escapeHtml(section.label) + '</span></a>';
    }).join("");
    var markup = SETTINGS_SECTIONS.map(function(section) {
      var rows = SETTINGS_FIELDS.filter(function(field) { return section.groups.includes(field.group); }).map(function(field) { return settingsFieldMarkup(field, tab); }).join("");
      if (section.id === "updates") rows += '<div class="settings-row"><div class="settings-label"><strong>Проверка версии</strong><small id="updateStatus" class="update-status" role="status" aria-live="polite"></small></div><div class="settings-control"><button id="checkUpdates" class="settings-reset" type="button" title="Проверить наличие новой версии Folder-video" aria-label="Проверить обновление Folder-video">Проверить обновление</button></div></div>';
      var backups = section.id === "cut" ? '<div class="settings-group"><header class="settings-card-heading"><h3>Бэкапы вырезки</h3></header><div id="cutBackups" class="cut-backups">Загрузка…</div></div>' : "";
      return '<section id="settings-' + section.id + '" class="settings-section" aria-labelledby="settings-title-' + section.id + '"><header class="settings-section-heading"><h2 id="settings-title-' + section.id + '">' + escapeHtml(section.label) + '</h2><p>' + escapeHtml(section.hint) + '</p></header><div class="settings-group">' + rows + '</div>' + backups + '</section>';
    }).join("");
    view.innerHTML = '<section class="settings-view"><form id="settingsForm" class="settings-layout"><nav class="settings-nav" aria-label="Разделы настроек"><p class="settings-nav-title">Настройки</p><div class="settings-nav-links">' + navigation + '</div><p class="settings-save-hint">Изменения применяются<br>после сохранения.</p></nav><div class="settings-main"><div class="settings-body" id="settingsBody"><header class="settings-heading"><h1>Настройки</h1><p>Выберите раздел слева или прокрутите страницу.</p></header>' + markup + '</div><footer class="settings-footer"><span id="settingsState" role="status" aria-live="polite">' + (tab.dirty ? "Есть несохранённые изменения" : "Все изменения сохранены") + '</span><button id="resetSettings" type="button" class="settings-reset" title="Вернуть значения по умолчанию">Сбросить</button><button type="submit" class="settings-save" title="Сохранить все настройки">Сохранить изменения</button></footer></div></form></section>';
    var body = $("#settingsBody");
    var links = Array.from(view.querySelectorAll("[data-settings-section]"));
    function trackSection() {
      var top = body.getBoundingClientRect().top + 64;
      var current = SETTINGS_SECTIONS[0].id;
      SETTINGS_SECTIONS.forEach(function(section) { if ($("#settings-" + section.id).getBoundingClientRect().top <= top) current = section.id; });
      links.forEach(function(link) {
        if (link.dataset.settingsSection === current) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
      tab.settingsScrollTop = body.scrollTop;
    }
    links.forEach(function(link) {
      link.addEventListener("click", function(event) {
        event.preventDefault();
        var target = $("#settings-" + link.dataset.settingsSection);
        body.scrollTo({ top: body.scrollTop + target.getBoundingClientRect().top - body.getBoundingClientRect().top - 24 });
        trackSection();
      });
    });
    body.addEventListener("scroll", trackSection, { passive: true });
    body.scrollTop = restoreTop;
    trackSection();
    showUpdateStatus(updateStatus);
    $("#checkUpdates").addEventListener("click", async function() {
      showUpdateStatus({ busy: true, message: "Проверка обновлений…", error: false });
      try { showUpdateStatus(await window.folderVideo.checkForUpdate()); }
      catch (error) { showUpdateStatus({ busy: false, message: error.message || String(error), error: true }); }
    });
    $("#settingsForm").querySelectorAll("[data-setting]").forEach(function(control) { control.addEventListener(control.tagName === "INPUT" && control.type !== "checkbox" ? "input" : "change", function() { var field = SETTINGS_FIELDS.find(function(item) { return item.key === control.dataset.setting; }); var value = field.type === "checkbox" ? control.checked : field.type === "select" && typeof readSetting(tab.draft, field.key) === "number" ? Number(control.value) : control.value; writeSetting(tab.draft, field.key, value); tab.dirty = true; $("#settingsState").textContent = "Есть несохранённые изменения"; }); });
    $("#settingsForm").querySelectorAll("[data-browse]").forEach(function(button) { button.addEventListener("click", async function(event) { event.preventDefault(); var folder = await window.folderVideo.chooseFolder(); if (!folder) return; var input = $("#settingsForm").querySelector("input[data-setting=\"" + button.dataset.browse + "\"]"); input.value = folder; input.dispatchEvent(new Event("input")); }); });
    $("#resetSettings").addEventListener("click", async function() { if (!confirm("Сбросить настройки к значениям по умолчанию?")) return; var result = await window.folderVideo.getDefaultSettings(); tab.draft = result.settings; tab.dirty = true; renderSettings(tab); });
    $("#settingsForm").addEventListener("submit", function(event) { event.preventDefault(); saveSettingsTab(tab); });
    renderCutBackups();
  }
  async function renderCutBackups() {
    var box = $("#cutBackups");
    if (!box) return;
    var result = await window.folderVideo.listCutBackups();
    box = $("#cutBackups");
    if (!box) return;
    if (!result || result.error) { box.textContent = "Не удалось прочитать список бэкапов: " + ((result && result.error) || "неизвестная ошибка"); return; }
    var items = result.backups;
    if (!items.length) { box.textContent = "Бэкапов нет. Оригиналы после вырезки хранятся в папке .fv-undo рядом с видео 7 дней."; return; }
    box.innerHTML = '<ul class="cut-backup-list">' + items.map(function(item) {
      var name = item.sourcePath.split(/[\\/]/).pop();
      return '<li><span class="cut-backup-name" title="' + escapeHtml(item.sourcePath) + '">' + escapeHtml(name) + '</span><span class="cut-backup-meta">' + escapeHtml(formatDate(item.createdAt)) + ' · ' + formatSize(item.originalSize) + '</span><button type="button" class="settings-reset" data-restore="' + escapeHtml(item.id) + '"' + (item.available ? "" : " disabled") + ' title="Вернуть оригинал на место" aria-label="Восстановить ' + escapeHtml(name) + '">Восстановить</button></li>';
    }).join("") + '</ul><button type="button" id="clearCutBackups" class="settings-reset" title="Удалить все бэкапы оригиналов" aria-label="Очистить бэкапы">Очистить бэкапы</button>';
    box.querySelectorAll("[data-restore]").forEach(function(button) {
      button.addEventListener("click", async function() {
        var item = items.find(function(entry) { return entry.id === button.dataset.restore; });
        if (!item) return;
        button.disabled = true;
        var restored = await undoCutEntry({ undoId: item.id, filePath: item.sourcePath });
        if (restored) state.cutUndo = state.cutUndo.filter(function(entry) { return entry.undoId !== item.id; });
        renderCutBackups();
      });
    });
    $("#clearCutBackups").addEventListener("click", async function() {
      if (!confirm("Удалить все бэкапы оригиналов? Вернуть вырезанное после этого будет нельзя.")) return;
      var cleared = await window.folderVideo.clearCutBackups();
      if (cleared && cleared.error) notice("Не удалось очистить бэкапы: " + cleared.error);
      else { state.cutUndo = []; notice("Бэкапы удалены", true); }
      renderCutBackups();
    });
  }
  async function saveSettingsTab(tab) {
    var switchingDatabase = tab.draft.storage.metadataDirectory !== state.settings.storage.metadataDirectory;
    var changingSummaryModel = tab.draft.ai.model !== state.settings.ai.model;
    var dirtyPlayers = state.tabs.filter(function(item) { return item.type === "player" && item.metadataDirty; });
    if (switchingDatabase && dirtyPlayers.length && !confirm("В открытых вкладках есть несохранённые метаданные. Сменить каталог без сохранения?")) return;
    var result = await window.folderVideo.saveSettings(tab.draft);
    if (result.error) { notice(result.error); return; }
    state.settings = result.settings; state.metadataCollapsed = state.settings.interface.metadataCollapsed; state.gridCollapsed = state.settings.interface.gridCollapsed; applyTheme(state.settings.theme, false);
    tab.draft = clone(state.settings); tab.dirty = false;
    state.tabs.filter(function(item) { return item.type === "player" && (changingSummaryModel || !item.summaryData); }).forEach(function(item) { item.summaryStatus = null; if (changingSummaryModel) item.summaryData = null; });
    if (switchingDatabase) state.tabs.filter(function(item) { return item.type === "player"; }).forEach(function(item) { item.metadataStatus = "idle"; item.metadata = null; item.metadataDraft = null; item.metadataDirty = false; loadMetadata(item); });
    render(); notice("Настройки сохранены", true);
  }

  async function syncMetadata() { var result = await window.folderVideo.syncMetadata(); if (result.success) notice("Метаданные синхронизированы", true); else notice((result.error || "Ошибка синхронизации") + (result.details ? ": " + result.details.slice(0, 500) : "")); }
  function renderHome() {
    view.innerHTML = "<section class=\"folder-view\">" +
      "<header class=\"toolbar\">" +
        "<button id=\"choose\" class=\"primary\">Select Folder</button>" +
        "<button id=\"syncMetadata\" class=\"refresh-folder\" type=\"button\" title=\"Синхронизировать метаданные с Git\" aria-label=\"Синхронизировать метаданные с Git\">⇅</button>" +
        "<div class=\"path-field\">Выберите или перетащите папку с видео…</div>" +
      "</header>" +
      "<div id=\"folderContent\" class=\"folder-content\">" + (visibleRecentFolders().length ? recentFoldersMarkup() : emptyHomeMarkup()) + "</div>" +
    "</section>";
    $("#choose").addEventListener("click", chooseFolder);
    $("#syncMetadata").addEventListener("click", syncMetadata);
    var content = $("#folderContent");
    content.addEventListener("dragover", function(event) { event.preventDefault(); });
    content.addEventListener("drop", handleDrop);
    bindRecentFolderControls(content);
  }

  function emptyHomeMarkup() {
    return "<div class=\"empty\"><div class=\"empty-inner home-panel\"><div class=\"empty-icon\"><img src=\"../../assets/folder-video.png\" alt=\"\" /></div><p class=\"home-kicker\">Folder-video</p><strong>Быстрый обзор больших видеопапок без импорта и лишней суеты</strong><small>Локальный видеобраузер с покадровой сеткой, точным переходом по таймлайну и удобным отбором роликов прямо из папки.</small><div class=\"home-points\"><span>Кадры по всей длине видео</span><span>Мгновенный переход к сцене</span><span>Файлы остаются локально</span></div><p class=\"home-formats\">" + supported + "</p></div></div>";
  }

  function recentFoldersMarkup() {
    var items = visibleRecentFolders().map(function(f) {
      var pinned = isPinnedFolder(f);
      var label = pinned ? "Открепить папку" : "Закрепить папку";
      return "<div class=\"recent-folder\"><button class=\"recent-open\" data-folder=\"" + escapeHtml(f) + "\" title=\"" + escapeHtml(f) + "\"><span class=\"recent-icon\">▸</span><span>" + escapeHtml(f) + "</span></button><button class=\"recent-pin" + (pinned ? " is-pinned" : "") + "\" data-folder=\"" + escapeHtml(f) + "\" title=\"" + label + "\" aria-label=\"" + label + "\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7Z\"/></svg></button></div>";
    }).join("");
    return "<div class=\"empty\"><div class=\"empty-inner home-panel\"><div class=\"empty-icon\"><img src=\"../../assets/folder-video.png\" alt=\"\" /></div><p class=\"home-kicker\">Folder-video</p><strong>Вернитесь к папке и найдите нужный момент глазами</strong><small>Миниатюры по всей длине ролика превращают папку с видео в карту сцен: меньше перемотки, больше точных решений.</small><div class=\"home-recents\"><span>Последние папки</span><div class=\"recent-folder-grid\">" + items + "</div></div></div></div>";
  }

  function renderFolder() {
    var thumbnailPriority = ++state.thumbnailPriority;
    var files = filteredFiles();
    var pages = Math.max(1, Math.ceil(files.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    var start = (state.page - 1) * state.pageSize;
    var rows = files.slice(start, start + state.pageSize);
    view.innerHTML = "<section class=\"folder-view\">" +
      "<header class=\"toolbar\">" +
        "<button id=\"choose\" class=\"primary\">Select Folder</button>" +
        "<button id=\"refreshFolder\" class=\"refresh-folder\" type=\"button\" title=\"Обновить список файлов\" aria-label=\"Обновить список файлов\"" + (state.folderPath ? "" : " disabled") + ">↻</button>" +
        "<div class=\"path-field\" title=\"" + escapeHtml(state.folderPath) + "\">" + (state.folderPath ? escapeHtml(state.folderPath) : "Выберите или перетащите папку с видео…") + "</div>" +
        "<input id=\"filter\" class=\"filter\" type=\"search\" value=\"" + escapeHtml(state.filterText) + "\" placeholder=\"Фильтр файлов\" title=\"Фильтр по имени файла\" aria-label=\"Фильтр по имени файла\" autocomplete=\"off\" />" +
        "<button id=\"favoritesOnly\" class=\"favorites-filter" + (state.favoritesOnly ? " is-active" : "") + "\" type=\"button\" title=\"" + (state.favoritesOnly ? "Показать все видео этой папки" : "Показать только избранные видео этой папки") + "\" aria-label=\"" + (state.favoritesOnly ? "Показать все видео этой папки" : "Показать только избранные видео этой папки") + "\" aria-pressed=\"" + state.favoritesOnly + "\">" + (state.favoritesOnly ? "♥" : "♡") + "</button>" +
        "<label class=\"recent-days-filter\" title=\"Показывать видео, изменённые за указанное число дней\"><input id=\"recentDaysEnabled\" type=\"checkbox\" " + (state.recentDaysEnabled ? "checked" : "") + "/> За <input id=\"recentDays\" type=\"number\" min=\"1\" max=\"36500\" step=\"1\" value=\"" + state.recentDays + "\" inputmode=\"numeric\" aria-label=\"Количество дней для фильтра\" /> дней</label>" +
        "<div class=\"scan-options\"><label class=\"check\"><input id=\"recursive\" type=\"checkbox\" " + (state.recursive ? "checked" : "") + "/> Recursive</label>" +
        "<label class=\"check\" title=\"Скрыть видеофайлы с размером 0 КБ\"><input id=\"hideEmptyFiles\" type=\"checkbox\" " + (state.hideEmptyFiles ? "checked" : "") + "/> Не 0 КБ</label></div>" +
        "<div class=\"sort\"><span>Sort</span><select id=\"sort\" title=\"Сортировать видео по дате, имени или размеру файла\" aria-label=\"Сортировать видео по дате, имени или размеру файла\"><option value=\"date\" " + (state.sort === "date" ? "selected" : "") + ">Date</option><option value=\"name\" " + (state.sort === "name" ? "selected" : "") + ">Name</option><option value=\"size\" " + (state.sort === "size" ? "selected" : "") + ">Size</option></select><button id=\"direction\" title=\"Изменить направление\">" + (state.asc ? "▲" : "▼") + "</button></div>" +
        "<span class=\"count\">" + files.length + (state.filterText || state.favoritesOnly || state.hideEmptyFiles || state.recentDaysEnabled ? " / " + state.files.length : "") + " videos</span>" +
      "</header>" +
      "<div id=\"folderContent\" class=\"folder-content\">" + (rows.length ? rows.map(function(v) { return rowMarkup(v); }).join("") + pagination(pages) : emptyMarkup()) + "</div>" +
    "</section>";
    $("#choose").addEventListener("click", chooseFolder);
    $("#refreshFolder").addEventListener("click", async function() {
      var button = $("#refreshFolder");
      if (!state.folderPath || !button || button.disabled) return;
      button.disabled = true;
      button.classList.add("is-refreshing");
      try { await scanCurrentFolder(); } finally {
        var refreshedButton = $("#refreshFolder");
        if (refreshedButton) { refreshedButton.disabled = false; refreshedButton.classList.remove("is-refreshing"); }
      }
    });
    $("#recursive").addEventListener("change", function(event) { state.recursive = event.target.checked; scanCurrentFolder(); });
    $("#hideEmptyFiles").addEventListener("change", function(event) { state.hideEmptyFiles = event.target.checked; state.page = 1; renderFolder(); });
    $("#favoritesOnly").addEventListener("click", function() { state.favoritesOnly = !state.favoritesOnly; state.page = 1; renderFolder(); });
    $("#recentDaysEnabled").addEventListener("change", function(event) {
      state.recentDaysEnabled = event.target.checked; localStorage.setItem("folder-video-recent-days-enabled", String(state.recentDaysEnabled)); state.page = 1; renderFolder();
    });
    $("#recentDays").addEventListener("change", function(event) {
      state.recentDays = normalizeRecentDays(event.target.value); localStorage.setItem("folder-video-recent-days", String(state.recentDays)); state.page = 1; renderFolder();
    });
    $("#filter").addEventListener("input", function(event) {
      var selectionStart = event.target.selectionStart; var selectionEnd = event.target.selectionEnd;
      state.filterText = event.target.value; state.page = 1; renderFolder();
      var filter = $("#filter"); filter.focus(); filter.setSelectionRange(selectionStart, selectionEnd);
    });
    $("#sort").addEventListener("change", function(event) { state.sort = event.target.value; state.page = 1; renderFolder(); });
    $("#direction").addEventListener("click", function() { state.asc = !state.asc; state.page = 1; renderFolder(); });
    var content = $("#folderContent");
    content.addEventListener("dragover", function(event) { event.preventDefault(); });
    content.addEventListener("drop", handleDrop);
    content.querySelectorAll(".row").forEach(function(row) { row.addEventListener("click", function() { openVideoByPath(row.dataset.path); }); row.addEventListener("contextmenu", function(event) { event.preventDefault(); showCtxMenu(event, row.dataset.path); }); });
    content.querySelectorAll(".favorite-toggle").forEach(function(button) { button.addEventListener("click", function(event) { event.stopPropagation(); var video = state.files.find(function(item) { return item.path === button.dataset.path; }); if (!video) return; toggleFavorite(video); renderFolder(); }); });
    content.querySelectorAll(".page").forEach(function(button) { button.addEventListener("click", function() { state.page = Number(button.dataset.page); renderFolder(); }); });
    var pageJump = $("#pageJump");
    if (pageJump) {
      pageJump.addEventListener("focus", function() { pageJump.select(); });
      pageJump.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!/^\d+$/.test(pageJump.value)) { pageJump.value = state.page; return; }
        var targetPage = Math.min(pages, Math.max(1, Number(pageJump.value)));
        if (targetPage === state.page) { pageJump.value = targetPage; return; }
        state.page = targetPage; renderFolder();
      });
      pageJump.addEventListener("blur", function() { pageJump.value = state.page; });
    }
    bindRecentFolderControls(content);
    rows.forEach(function(v) { hydrateRow(v, thumbnailPriority); });
    requestAnimationFrame(updatePageSizeFromLayout);
  }

  function emptyMarkup() {
    if (!state.folderPath) return visibleRecentFolders().length ? recentFoldersMarkup() : emptyHomeMarkup();
    var message = state.filterText || state.favoritesOnly || state.hideEmptyFiles || state.recentDaysEnabled ? "По фильтру ничего не найдено" : "Видео не найдены";
    return "<div class=\"empty\"><div class=\"empty-inner\"><div class=\"empty-icon\"><img src=\"../../assets/folder-video.png\" alt=\"\" /></div><strong>" + message + "</strong><small>Измените фильтр или выберите другую папку<br>" + supported + "</small></div></div>";
  }
  function rowMarkup(video) {
    var cells = "";
    for (var ci = 0; ci < STRIP_COUNT; ci++) {
      cells += "<div class=\"thumb\" data-index=\"" + ci + "\"><span class=\"time\">—</span></div>";
    }
    var favorite = isFavorite(video.path);
    return "<article class=\"row\" data-path=\"" + escapeHtml(video.path) + "\"><div class=\"row-info\"><div class=\"row-name\" title=\"" + escapeHtml(video.name) + "\">" + escapeHtml(video.name) + "</div><div class=\"row-meta\"><span class=\"duration\">…</span><span>" + formatSize(video.size) + "</span><span>" + formatDate(video.lastModified) + "</span></div></div><div class=\"strip\">" + cells + "</div><button class=\"favorite-toggle" + (favorite ? " is-favorite" : "") + "\" data-path=\"" + escapeHtml(video.path) + "\" title=\"" + (favorite ? "Удалить из избранного" : "Добавить в избранное") + "\" aria-label=\"" + (favorite ? "Удалить из избранного" : "Добавить в избранное") + "\">" + (favorite ? "♥" : "♡") + "</button></article>";
  }
  function pagination(totalPages) {
    if (totalPages <= 1) return "";
    var selected = new Set([1, totalPages]);
    for (var pi = Math.max(1, state.page - 4); pi <= Math.min(totalPages, state.page + 4); pi++) selected.add(pi);
    var pages = [].concat(Array.from(selected)).sort(function(a, b) { return a - b; });
    var markup = "<div class=\"pager\"><button class=\"page page-previous\" data-page=\"" + Math.max(1, state.page - 1) + "\" " + (state.page === 1 ? "disabled" : "") + " title=\"Предыдущая страница\" aria-label=\"Предыдущая страница\">‹</button><div class=\"page-numbers\">";
    var previous = 0;
    for (var pi2 = 0; pi2 < pages.length; pi2++) {
      var page = pages[pi2];
      if (page - previous > 1) markup += "<span class=\"ellipsis\">…</span>";
      markup += "<button class=\"page" + (page === state.page ? " current" : "") + "\" data-page=\"" + page + "\">" + page + "</button>";
      previous = page;
    }
    return markup + "</div><label class=\"page-jump\" for=\"pageJump\">Стр. <input id=\"pageJump\" class=\"page-jump-input\" type=\"text\" value=\"" + state.page + "\" inputmode=\"numeric\" autocomplete=\"off\" title=\"Номер страницы; нажмите Enter для перехода\" aria-label=\"Перейти к странице\" /> <span>/ " + totalPages + "</span></label><button class=\"page page-next\" data-page=\"" + Math.min(totalPages, state.page + 1) + "\" " + (state.page === totalPages ? "disabled" : "") + " title=\"Следующая страница\" aria-label=\"Следующая страница\">›</button></div>";
  }

  async function chooseFolder() { var folder = await window.folderVideo.chooseFolder(); if (folder) loadFolder(folder); }
  async function handleDrop(event) {
    event.preventDefault(); var file = event.dataTransfer.files[0];
    if (!file) return;
    var folder = window.folderVideo.getPathForFile(file);
    if (folder) loadFolder(folder); else notice("Не удалось получить путь перетащенной папки.");
  }
  async function loadFolder(folder, preserveTabs) {
    if (!preserveTabs) await Promise.all(state.tabs.filter(function(tab) { return tab.type === "player"; }).map(flushPlayerNotes));
    addRecentFolder(folder);
    state.folderPath = folder; state.page = 1;
    if (preserveTabs) {
      if (!state.tabs.some(function(tab) { return tab.type === "folder"; })) state.tabs.unshift({ id: "folder", type: "folder", label: "Видео" });
    } else {
      state.tabs = [{ id: "folder", type: "folder", label: "Видео" }];
      state.frameCache.clear(); state.durationCache.clear(); state.youtubeSourceCache.clear();
    }
    state.activeTab = "folder"; state.thumbnailGeneration += 1; state.stripCache.clear(); state.stripPending.clear(); await window.folderVideo.setTitle(folder); render(); await scanCurrentFolder();
  }
  window.folderVideo.onOpenTarget(async function(target) {
    if (!target || typeof target.path !== "string") return;
    await startupReady;
    if (target.type === "folder") { await loadFolder(target.path); return; }
    if (target.type === "video") {
      if (typeof target.folderPath !== "string") return;
      await loadFolder(target.folderPath);
      openVideoByPath(target.path);
    }
  });
  async function scanCurrentFolder() {
    if (!state.folderPath) return;
    view.querySelector(".folder-content").innerHTML = "<div class=\"empty\"><div class=\"empty-inner\">Сканирование папки…</div></div>";
    try {
      var result = await window.folderVideo.scan(state.folderPath, state.recursive);
      state.files = result.files; state.skipped = result.skipped; state.page = 1; render();
      if (result.skipped) notice("Пропущено объектов: " + result.skipped, true);
    } catch (error) { notice("Не удалось прочитать папку: " + error.message); }
  }

  async function getDuration(video) {
    var key = fileKey(video); if (state.durationCache.has(key)) return state.durationCache.get(key);
    var duration = await videoMetadata(video.url); state.durationCache.set(key, duration); return duration;
  }
  function videoMetadata(url) { return new Promise(function(resolve) {
    var video = document.createElement("video"); var done = false;
    var timer = setTimeout(function() { finish(0); }, 10000);
    function finish(value) { if (done) return; done = true; clearTimeout(timer); video.remove(); resolve(Number.isFinite(value) ? value : 0); }
    video.preload = "metadata"; video.muted = true;
    video.onloadedmetadata = function() { finish(video.duration); };
    video.onerror = function() { finish(0); };
    video.src = url; video.load();
  }); }
  async function hydrateRow(video, priority) {
    var allRows = document.querySelectorAll(".row");
    var row = null;
    for (var ri = 0; ri < allRows.length; ri++) {
      if (allRows[ri].dataset.path === video.path) { row = allRows[ri]; break; }
    }
    if (!row) return;
    if (video.size < 1024) { row.querySelector(".duration").textContent = "—"; return; }
    var duration = await getDuration(video); if (!row.isConnected) return;
    row.querySelector(".duration").textContent = formatTime(duration);
    await loadStrip(video, duration, row.querySelectorAll(".thumb"), priority);
  }
  async function loadStrip(video, duration, cells, priority) {
    if (!duration || !cells.length) return;
    var key = fileKey(video); var frames = state.stripCache.get(key);
    if (!frames) {
      var pendingEntry = state.stripPending.get(key);
      if (!pendingEntry || pendingEntry.priority !== priority) {
        var generation = state.thumbnailGeneration;
        var pending = thumbnailQueue.enqueue(function() {
          return generation === state.thumbnailGeneration
            ? captureFrames(video.url, duration, STRIP_COUNT, function() { return priority === state.thumbnailPriority; }, function(frame, index, time) {
              var cell = cells[index];
              if (!cell || !cell.isConnected || priority !== state.thumbnailPriority) return;
              cell.querySelector(".time").textContent = formatTime(time);
              if (frame) { cell.classList.add("ready"); cell.insertAdjacentHTML("afterbegin", "<img src=\"" + frame + "\" alt=\"\" />"); }
            })
            : null;
        }, priority);
        pendingEntry = { promise: pending, priority: priority };
        state.stripPending.set(key, pendingEntry);
        pending.then(function(result) {
          if (result && state.stripPending.get(key) === pendingEntry) state.stripCache.set(key, result);
        }).finally(function() {
          if (state.stripPending.get(key) === pendingEntry) state.stripPending.delete(key);
        });
      }
      frames = await pendingEntry.promise;
    }
    if (!frames) return;
    cells.forEach(function(cell, index) {
      var frame = frames[index];
      var time = duration * (index / Math.max(1, STRIP_COUNT - 1));
      cell.querySelector(".time").textContent = formatTime(time);
      if (frame && !cell.querySelector("img")) { cell.classList.add("ready"); cell.insertAdjacentHTML("afterbegin", "<img src=\"" + frame + "\" alt=\"\" />"); }
    });
  }

  function openVideoByPath(filePath) { var video = state.files.find(function(item) { return item.path === filePath; }); if (video) openVideo(video); }
  function playerVideoList() { return filteredFiles(); }
  function playerVideoIndex(tab) { return playerVideoList().findIndex(function(item) { return item.path === tab.video.path; }); }
  function adjacentPlayerVideo(tab, direction) {
    var files = playerVideoList();
    var index = files.findIndex(function(item) { return item.path === tab.video.path; });
    if (index === -1) return null;
    return files[index + direction] || null;
  }
  function videoNameStem(video) { return video.name.replace(/\.[^/.]+$/, ""); }
  async function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(value); return; }
    var input = document.createElement("textarea");
    input.value = value; input.setAttribute("readonly", ""); input.style.position = "fixed"; input.style.opacity = "0";
    document.body.appendChild(input); input.select(); document.execCommand("copy"); input.remove();
  }
  async function copyVideoName(tab) {
    try { await copyText(videoNameStem(tab.video)); notice("Название скопировано", true); }
    catch (error) { notice("Не удалось скопировать название: " + error.message); }
  }
  async function copyVideoNameByPath(filePath) {
    var video = state.files.find(function(item) { return item.path === filePath; });
    if (!video) { notice("Видео отсутствует в текущем списке."); return; }
    try { await copyText(videoNameStem(video)); notice("Название скопировано", true); }
    catch (error) { notice("Не удалось скопировать название: " + error.message); }
  }
  function speedUpButtonMarkup(running, progress) {
    if (running) return '<span class="speed-up-value">' + Math.round(progress) + '%</span>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5 14h6l-1 7 9-12h-6l0-6Z"/></svg>';
  }
  function updateSpeedUpControl() {
    var button = $("#playerSpeed");
    if (!button || !state.speedUp) return;
    button.style.setProperty("--speed-progress", state.speedUp.progress + "%");
    button.title = "Ускорение: " + Math.round(state.speedUp.progress) + "%";
    button.setAttribute("aria-label", button.title);
    var value = button.querySelector(".speed-up-value");
    if (value) value.textContent = Math.round(state.speedUp.progress) + "%";
  }
  async function startSpeedUp(tab, player) {
    if (state.speedUp) return;
    if (!Number.isFinite(player.duration) || player.duration <= 0) { notice("Дождитесь загрузки длительности видео."); return; }
    var duration = player.duration;
    var operationId = "speed-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    state.speedUp = { operationId: operationId, filePath: tab.video.path, progress: 0 };
    renderPlayer(tab);
    var result = await window.folderVideo.speedUp(tab.video.path, operationId, duration);
    if (!state.speedUp || state.speedUp.operationId !== operationId) return;
    state.speedUp = null;
    if (!result || result.canceled) { if (active() === tab) renderPlayer(tab); return; }
    if (result.error) { notice("Не удалось ускорить видео: " + result.error); if (active() === tab) renderPlayer(tab); return; }
    var output = await window.folderVideo.readVideo(result.outputPath);
    if (!output) { notice("Ускоренный файл создан, но не удалось открыть его."); if (active() === tab) renderPlayer(tab); return; }
    state.files = state.files.filter(function(file) { return file.path !== output.path; });
    state.files.push(output);
    notice("Ускоренная копия создана", true);
    openVideo(output);
  }
  async function blobToDataUrl(blob) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }
  async function copyWebpImage(blob, canvas) {
    return window.folderVideo.copyImage({
      webpDataUrl: await blobToDataUrl(blob),
      bitmapDataUrl: canvas.toDataURL("image/png")
    });
  }
  async function takeVideoScreenshot(tab, player) {
    if (!player.videoWidth || !player.videoHeight) { notice("Кадр ещё не готов."); return; }
    var canvas = document.createElement("canvas");
    canvas.width = player.videoWidth; canvas.height = player.videoHeight;
    canvas.getContext("2d").drawImage(player, 0, 0, canvas.width, canvas.height);
    var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, "image/webp", 0.92); });
    if (!blob || blob.type !== "image/webp") { notice("Не удалось создать WebP-скрин."); return; }
    try {
      var result = await copyWebpImage(blob, canvas);
      if (result && result.error) { notice("Не удалось скопировать скрин: " + result.error); return; }
      notice("WebP-скрин скопирован", true);
    } catch (error) {
      notice("Не удалось скопировать WebP-скрин: " + error.message);
    }
  }
  function releaseVideoElement(video) {
    if (!video) return;
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch {}
  }
  function releaseCaptureVideos(url) {
    var videos = state.captureVideos.get(url);
    if (!videos) return;
    videos.forEach(releaseVideoElement);
    state.captureVideos.delete(url);
  }
  function releasePlayerResources(url) {
    releaseCaptureVideos(url);
    var player = $("#player");
    if (player && (player.src === url || player.currentSrc === url)) {
      state.task += 1;
      releaseVideoElement(player);
    }
  }
  function setPlayerVideo(tab, video) {
    if (state.transcript && state.transcript.filePath === tab.video.path) window.folderVideo.cancelTranscript(state.transcript.operationId);
    if (tab.summaryStatus === "running") window.folderVideo.cancelSummary(tab.video.path);
    releasePlayerResources(tab.video.url);
    if (tab.metadataRequestId) window.folderVideo.cancelMetadata(tab.metadataRequestId);
    tab.video = video; tab.label = video.name; tab.currentTime = 0; tab.cut = null; tab.isDragging = false; tab.panelMode = "frames"; tab.transcriptStatus = null; tab.transcriptSegments = []; tab.transcriptError = ""; tab.transcriptProgress = 0; tab.summaryStatus = null; tab.summaryData = null; tab.summaryError = "";
    tab.notesStatus = null; tab.notesText = ""; tab.notesDirty = false; tab.notesError = ""; tab.notesEditorCollapsed = true; tab.noteEditStart = null; tab.noteEditBlockIndex = null;
    tab.metadataStatus = "idle"; tab.metadata = null; tab.metadataDraft = null; tab.metadataDirty = false; tab.metadataRequestId = null; tab.markdownMode = "edit";
  }
  async function switchPlayerVideo(tab, direction) {
    var nextVideo = adjacentPlayerVideo(tab, direction);
    if (!nextVideo) return;
    await flushPlayerNotes(tab);
    setPlayerVideo(tab, nextVideo);
    render();
  }
  function openVideo(video) {
    var previous = active(); if (previous && previous.type === "player" && previous.video.path !== video.path) flushPlayerNotes(previous);
    rememberRecentVideo(video);
    for (var ti = 0; ti < state.tabs.length; ti++) {
      if (state.tabs[ti].type === "player" && state.tabs[ti].video.path === video.path) {
        state.activeTab = state.tabs[ti].id; render(); return;
      }
    }
    var tab = createPlayerTab(video);
    state.tabs.push(tab); state.activeTab = tab.id; render();
  }
  function createPlayerTab(video) {
    return { id: "player-" + Date.now() + "-" + Math.random().toString(16).slice(2), type: "player", label: video.name, video: video, columns: state.settings.viewer.columns, seconds: state.settings.viewer.seconds, scroll: state.settings.viewer.scroll, panelWidth: state.settings.viewer.panelWidth || 410, collapsed: state.gridCollapsed, metadataCollapsed: state.metadataCollapsed, panelMode: "frames", transcriptStatus: null, transcriptSegments: [], transcriptError: "", transcriptProgress: 0, summaryStatus: null, summaryData: null, summaryError: "", notesStatus: null, notesText: "", notesDirty: false, notesError: "", notesEditorCollapsed: true, noteEditStart: null, noteEditBlockIndex: null, currentTime: 0, metadataStatus: "idle", metadata: null, metadataDraft: null, metadataDirty: false, markdownMode: "edit" };
  }
  async function closeTab(id) {
    var idx = -1;
    for (var ti = 0; ti < state.tabs.length; ti++) {
      if (state.tabs[ti].id === id) { idx = ti; break; }
    }
    if (idx === -1) return;
    var tab = state.tabs[idx];
    if (tab.type === "settings" && tab.dirty) {
      var choice = await window.folderVideo.confirmCloseSettings();
      if (choice === "cancel") return;
      if (choice === "save") { await saveSettingsTab(tab); if (tab.dirty) return; }
    }
    if (tab.type === "player") await flushPlayerNotes(tab);
    if (tab.metadataRequestId) window.folderVideo.cancelMetadata(tab.metadataRequestId);
    if (tab.type === "player") { if (state.transcript && state.transcript.filePath === tab.video.path) window.folderVideo.cancelTranscript(state.transcript.operationId); if (tab.summaryStatus === "running") window.folderVideo.cancelSummary(tab.video.path); releasePlayerResources(tab.video.url); }
    state.tabs.splice(idx, 1);
    if (state.activeTab === id) {
      state.activeTab = state.tabs.length
        ? state.tabs[Math.min(idx, state.tabs.length - 1)].id
        : null;
    }
    render();
  }

  function metadataCopy(metadata) { return { contentHash: metadata.contentHash, title: metadata.title || "", originalFileName: metadata.originalFileName || "", youtubeUrl: metadata.youtubeUrl, obsidianUrl: metadata.obsidianUrl, projectFolder: metadata.projectFolder || "", descriptionMarkdown: metadata.descriptionMarkdown, tags: [].concat(metadata.tags || []), createdAt: metadata.createdAt || null, updatedAt: metadata.updatedAt || null }; }
  function metadataPanelMarkup(tab) { return "<aside id=\"metadataPanel\" class=\"metadata-panel" + (tab.metadataCollapsed ? " collapsed" : "") + "\"><header class=\"metadata-head\"><button id=\"metadataCollapse\" class=\"collapse\" title=\"" + (tab.metadataCollapsed ? "Развернуть метаданные" : "Свернуть метаданные") + "\">" + (tab.metadataCollapsed ? "▶" : "◀") + "</button><strong>METADATA</strong></header><div id=\"metadataContent\" class=\"metadata-content\"></div></aside>"; }
  function metadataFormMarkup(tab) {
    var data = tab.metadataDraft;
    var description = tab.markdownMode === "edit" ? "<textarea id=\"metadataDescription\" placeholder=\"Markdown-описание видео\">" + escapeHtml(data.descriptionMarkdown) + "</textarea>" : "<article id=\"metadataPreview\" class=\"metadata-preview\">Загрузка предпросмотра…</article>";
    return "<form id=\"metadataForm\"><p class=\"metadata-hash\" title=\"SHA-256\">" + data.contentHash.slice(0, 12) + "…</p><label class=\"metadata-label\">Название<input id=\"metadataTitle\" value=\"" + escapeHtml(data.title) + "\" /></label><label class=\"metadata-label\">YouTube<div class=\"metadata-input-row\"><input id=\"metadataYoutube\" type=\"url\" value=\"" + escapeHtml(data.youtubeUrl) + "\" placeholder=\"https://youtube.com/...\" /><button id=\"openYoutube\" type=\"button\" title=\"Открыть YouTube\" aria-label=\"Открыть YouTube\">↗</button></div></label><label class=\"metadata-label\">Obsidian<div class=\"metadata-input-row\"><input id=\"metadataObsidian\" type=\"url\" value=\"" + escapeHtml(data.obsidianUrl) + "\" placeholder=\"obsidian://open/...\" /><button id=\"openObsidian\" type=\"button\" title=\"Открыть в Obsidian\" aria-label=\"Открыть в Obsidian\">↗</button></div></label><label class=\"metadata-label\">Папка проекта<div class=\"metadata-input-row\"><input id=\"metadataProjectFolder\" value=\"" + escapeHtml(data.projectFolder) + "\" /><button id=\"openProjectFolder\" type=\"button\" title=\"Открыть папку проекта\" aria-label=\"Открыть папку проекта\">↗</button></div></label><div class=\"metadata-section-head\"><span>Описание</span><div class=\"metadata-mode\"><button type=\"button\" data-mode=\"edit\" class=\"" + (tab.markdownMode === "edit" ? "active" : "") + "\">Edit</button><button type=\"button\" data-mode=\"preview\" class=\"" + (tab.markdownMode === "preview" ? "active" : "") + "\">Preview</button></div></div>" + description + "<label class=\"metadata-label\">Теги<div id=\"metadataTags\" class=\"metadata-tags\"></div></label><footer class=\"metadata-footer\"><span id=\"metadataState\">" + (tab.metadataDirty ? "Не сохранено" : "Сохранено") + "</span><button class=\"metadata-save\" type=\"submit\">Сохранить</button></footer></form>";
  }
  function sanitizeMetadataTemplate(html) { var template = document.createElement("template"); template.innerHTML = html; template.content.querySelectorAll("script,iframe,object,embed,link").forEach(function(element) { element.remove(); }); template.content.querySelectorAll("*").forEach(function(element) { Array.from(element.attributes).forEach(function(attribute) { if (/^on/i.test(attribute.name) || (attribute.name === "src" && /^(https?:|javascript:)/i.test(attribute.value))) element.removeAttribute(attribute.name); }); }); return template.innerHTML; }
  function templateValue(value) { return escapeHtml(value == null ? "" : String(value)); }
  function metadataTemplateMarkup(tab, html) { var data = tab.metadataDraft; var description = tab.markdownMode === "edit" ? "<textarea id=\"metadataDescription\" placeholder=\"Markdown-описание видео\">" + escapeHtml(data.descriptionMarkdown) + "</textarea>" : "<article id=\"metadataPreview\" class=\"metadata-preview\">Загрузка предпросмотра…</article>"; var values = { title: data.title, contentHashShort: data.contentHash.slice(0, 12) + "…", youtubeUrl: data.youtubeUrl, obsidianUrl: data.obsidianUrl, projectFolder: data.projectFolder, editClass: tab.markdownMode === "edit" ? "active" : "", previewClass: tab.markdownMode === "preview" ? "active" : "", saveState: tab.metadataDirty ? "Не сохранено" : "Сохранено" }; var result = sanitizeMetadataTemplate(html).replace(/{{descriptionMarkup}}/g, description); Object.keys(values).forEach(function(key) { result = result.replace(new RegExp("{{" + key + "}}", "g"), templateValue(values[key])); }); return result; }
  function renderMetadataContent(tab) {
    var content = $("#metadataContent"); if (!content || active() !== tab) return;
    if (tab.metadataStatus !== "ready" && tab.metadataStatus !== "error") { content.innerHTML = "<p class=\"metadata-loading\">Идентифицируем файл…<small>Считаем SHA-256</small></p>"; return; }
    if (tab.metadataStatus === "error") { content.innerHTML = "<p class=\"metadata-loading error\">" + escapeHtml(tab.metadataError) + "<button id=\"metadataRetry\" type=\"button\">Повторить</button></p>"; $("#metadataRetry").addEventListener("click", function() { loadMetadata(tab); }); return; }
    content.innerHTML = metadataFormMarkup(tab); window.folderVideo.getMetadataTemplate().then(function(result) { if (!content.isConnected || active() !== tab || tab.metadataStatus !== "ready") return; if (result.template) content.innerHTML = metadataTemplateMarkup(tab, result.template); bindMetadataForm(tab); if (tab.markdownMode === "preview") renderMarkdownPreview(tab); });
  }
  function renderMetadataTags(tab) {
    var host = $("#metadataTags"); if (!host) return;
    host.innerHTML = tab.metadataDraft.tags.map(function(tag, index) { return "<span class=\"metadata-tag\">" + escapeHtml(tag) + "<button type=\"button\" data-tag-index=\"" + index + "\" title=\"Удалить тег\" aria-label=\"Удалить тег\">×</button></span>"; }).join("") + "<input id=\"metadataTagInput\" placeholder=\"тег,\" aria-label=\"Добавить тег\" />";
    host.querySelectorAll("[data-tag-index]").forEach(function(button) { button.addEventListener("click", function() { tab.metadataDraft.tags.splice(Number(button.dataset.tagIndex), 1); tab.metadataDirty = true; renderMetadataTags(tab); updateMetadataState(tab); }); });
    var input = $("#metadataTagInput");
    function addTags() { var values = input.value.split(",").map(function(value) { return value.trim(); }).filter(Boolean); if (!values.length) return; values.forEach(function(value) { if (tab.metadataDraft.tags.indexOf(value) === -1) tab.metadataDraft.tags.push(value); }); tab.metadataDirty = true; renderMetadataTags(tab); updateMetadataState(tab); }
    input.addEventListener("keydown", function(event) { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTags(); } }); input.addEventListener("blur", addTags);
  }
  function updateMetadataState(tab) { var stateEl = $("#metadataState"); if (stateEl) stateEl.textContent = tab.metadataDirty ? "Не сохранено" : "Сохранено"; }
  function bindMetadataForm(tab) {
    renderMetadataTags(tab);
    [["metadataTitle", "title"], ["metadataYoutube", "youtubeUrl"], ["metadataObsidian", "obsidianUrl"], ["metadataProjectFolder", "projectFolder"], ["metadataDescription", "descriptionMarkdown"]].forEach(function(pair) { var input = $("#" + pair[0]); if (input) input.addEventListener("input", function(event) { tab.metadataDraft[pair[1]] = event.target.value; tab.metadataDirty = true; updateMetadataState(tab); }); });
    $("#metadataForm").addEventListener("submit", function(event) { event.preventDefault(); saveMetadata(tab); });
    $("#openYoutube").addEventListener("click", function() { openMetadataLink(tab.metadataDraft.youtubeUrl); }); $("#openObsidian").addEventListener("click", function() { openMetadataLink(tab.metadataDraft.obsidianUrl); }); $("#openProjectFolder").addEventListener("click", async function() { var error = await window.folderVideo.openProjectFolder(tab.metadataDraft.projectFolder); if (error) notice(error); });
    $("#metadataForm").querySelectorAll("[data-mode]").forEach(function(button) { button.addEventListener("click", function() { tab.markdownMode = button.dataset.mode; renderMetadataContent(tab); }); });
  }
  async function openMetadataLink(url) { if (!url) return; var error = await window.folderVideo.openMetadataLink(url); if (error) notice(error); }
  async function loadMetadata(tab) {
    if (tab.metadataRequestId) window.folderVideo.cancelMetadata(tab.metadataRequestId);
    tab.metadataStatus = "loading"; tab.metadataError = ""; tab.metadataRequestId = tab.id + "-" + Date.now(); renderMetadataContent(tab);
    var requestId = tab.metadataRequestId; var result = await window.folderVideo.loadMetadata(requestId, tab.video.path);
    if (tab.metadataRequestId !== requestId || result.canceled) return;
    if (result.error) { tab.metadataStatus = "error"; tab.metadataError = result.error; if (active() === tab) renderMetadataContent(tab); return; }
    tab.metadataStatus = "ready"; tab.metadata = metadataCopy(result.metadata); tab.metadataDraft = metadataCopy(result.metadata); tab.metadataDirty = false; tab.metadataRequestId = null; if (active() === tab) renderMetadataContent(tab);
  }
  async function saveMetadata(tab) {
    var result = await window.folderVideo.saveMetadata(tab.metadataDraft); if (result.error) { notice(result.error); return; }
    var saved = metadataCopy(result.metadata);
    state.tabs.forEach(function(other) { if (other.type === "player" && other.metadata && other.metadata.contentHash === saved.contentHash) { other.metadata = metadataCopy(saved); other.metadataDraft = metadataCopy(saved); other.metadataDirty = false; } });
    notice("Метаданные сохранены", true); renderMetadataContent(tab);
  }
  function sanitizeMarkdown(html) {
    var template = document.createElement("template"); template.innerHTML = html;
    var allowed = new Set(["A", "P", "BR", "HR", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "STRONG", "EM", "DEL", "CODE", "PRE", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"]);
    template.content.querySelectorAll("*").forEach(function(element) { if (!allowed.has(element.tagName)) { element.replaceWith(...element.childNodes); return; } Array.from(element.attributes).forEach(function(attribute) { if (element.tagName !== "A" || (attribute.name !== "href" && attribute.name !== "title")) element.removeAttribute(attribute.name); }); if (element.tagName === "A") { try { var url = new URL(element.getAttribute("href")); if (url.protocol !== "https:" && url.protocol !== "http:") element.removeAttribute("href"); else { element.target = "_blank"; element.rel = "noreferrer"; } } catch { element.removeAttribute("href"); } } });
    return template.innerHTML;
  }
  async function renderMarkdownPreview(tab) { var preview = $("#metadataPreview"); if (!preview) return; var html = await window.folderVideo.renderMarkdown(tab.metadataDraft.descriptionMarkdown); if (preview.isConnected && active() === tab && tab.markdownMode === "preview") preview.innerHTML = sanitizeMarkdown(html); }
  function parseSrtTime(value) {
    var match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim());
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000 : null;
  }
  function parseSrt(source) {
    return source.replace(/^\uFEFF/, "").replace(/\r/g, "").trim().split(/\n{2,}/).map(function(block) {
      var lines = block.split("\n"); var timeLine = lines.findIndex(function(line) { return line.includes("-->"); });
      if (timeLine === -1) return null;
      var range = lines[timeLine].split("-->"); var start = parseSrtTime(range[0]); var end = parseSrtTime(range[1]);
      if (start === null || end === null) return null;
      return { start: start, end: end, text: lines.slice(timeLine + 1).join(" ").trim() };
    }).filter(Boolean);
  }
  function transcriptIconMarkup() {
    return '<svg class="transcript-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M5 10h14M5 15h9M5 20h12"/></svg>';
  }
  function transcriptButtonMarkup(tab) {
    var running = state.transcript && state.transcript.filePath === tab.video.path;
    if (running) return { icon: "×", title: "Отменить транскрибацию: " + Math.round(tab.transcriptProgress || 0) + "%", className: " is-running" };
    return { icon: transcriptIconMarkup(), title: tab.transcriptSegments && tab.transcriptSegments.length ? "Перетранскрибировать" : "Транскрибировать видео", className: "" };
  }
  function baseSidePanelMarkup(tab) {
    var action = transcriptButtonMarkup(tab);
    return "<aside id=\"gridPanel\" class=\"grid-panel" + (tab.collapsed ? " collapsed" : "") + "\"><button id=\"panelResizer\" class=\"panel-resizer\" type=\"button\" role=\"slider\" tabindex=\"0\" aria-valuemin=\"280\" aria-valuemax=\"720\" aria-valuenow=\"" + Math.round(tab.panelWidth || 410) + "\" title=\"Изменить ширину боковой панели\" aria-label=\"Изменить ширину боковой панели\" aria-orientation=\"vertical\"></button><header class=\"grid-head\"><button id=\"collapse\" class=\"collapse\" title=\"" + (tab.collapsed ? "Развернуть панель" : "Свернуть панель") + "\" aria-label=\"Показать или скрыть боковую панель\">" + (tab.collapsed ? "◀" : "▶") + "</button><div class=\"panel-modes\"><button data-panel-mode=\"frames\" class=\"" + ((tab.panelMode || "frames") === "frames" ? "active" : "") + "\" title=\"Показать миниатюры\" aria-label=\"Показать миниатюры\">▦</button><button data-panel-mode=\"transcript\" class=\"" + ((tab.panelMode || "frames") === "transcript" ? "active" : "") + "\" title=\"Показать транскрипцию\" aria-label=\"Показать транскрипцию\">" + transcriptIconMarkup() + "</button></div><button id=\"transcriptAction\" class=\"transcript-action" + action.className + "\" title=\"" + action.title + "\" aria-label=\"" + action.title + "\">" + action.icon + "</button><div id=\"frameControls\" class=\"frame-controls" + ((tab.panelMode || "frames") === "frames" ? "" : " is-hidden") + "\"><div class=\"grid-control\"><label>Col</label><select id=\"columns\">" + [3,4,5,6,8].map(function(v) { return "<option " + (v === tab.columns ? "selected" : "") + ">" + v + "</option>"; }).join("") + "</select></div><div class=\"grid-control\"><label>Sec</label><select id=\"seconds\">" + [5,10,15,30,60].map(function(v) { return "<option " + (v === tab.seconds ? "selected" : "") + ">" + v + "</option>"; }).join("") + "</select></div><div class=\"grid-control\"><label>Scroll</label><select id=\"scroll\"><option value=\"center\" " + (tab.scroll === "center" ? "selected" : "") + ">Center</option><option value=\"edge\" " + (tab.scroll === "edge" ? "selected" : "") + ">Edge</option><option value=\"off\" " + (tab.scroll === "off" ? "selected" : "") + ">OFF</option></select></div></div></header><div id=\"gridScroll\" class=\"grid-scroll" + ((tab.panelMode || "frames") === "frames" ? "" : " is-hidden") + "\"><div id=\"frameGrid\" class=\"frame-grid\"></div></div><div id=\"transcriptScroll\" class=\"transcript-scroll" + ((tab.panelMode || "frames") === "transcript" ? "" : " is-hidden") + "\"></div></aside>";
  }
  function sidePanelMarkup(tab) {
    return baseSidePanelMarkup(tab)
      .replace('</button></div><button id="transcriptAction"', '</button><button data-panel-mode="summary" class="' + (tab.panelMode === "summary" ? "active" : "") + '" title="Показать сводку" aria-label="Показать сводку">✦</button></div><button id="transcriptAction"')
      .replace('</button></div><button id="transcriptAction"', '</button><button data-panel-mode="notes" class="' + (tab.panelMode === "notes" ? "active" : "") + '" title="Показать заметки" aria-label="Показать заметки">✎</button></div><button id="transcriptAction"')
      .replace('<button id="transcriptAction"', '<div class="obsidian-split"><button id="obsidianExport" class="transcript-action obsidian-main" title="Пересоздать статью в Obsidian" aria-label="Пересоздать статью в Obsidian"><svg class="transcript-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/></svg></button><button id="obsidianMenuToggle" class="transcript-action obsidian-caret" type="button" title="Действия со статьёй" aria-label="Действия со статьёй" aria-haspopup="menu" aria-expanded="false"><svg class="transcript-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></button><div id="obsidianMenu" class="obsidian-menu is-hidden" role="menu"><button type="button" role="menuitem" data-article-action="append" title="Добавить текущую сводку в конец статьи" aria-label="Дополнить статью">Дополнить статью</button><button type="button" role="menuitem" data-article-action="open" title="Открыть статью в Obsidian" aria-label="Открыть статью">Открыть статью</button></div></div><button id="transcriptAction"')
      .replace('</div></aside>', '</div><div id="summaryScroll" class="summary-scroll' + (tab.panelMode === "summary" ? '' : ' is-hidden') + '"></div><div id="notesScroll" class="notes-scroll' + (tab.panelMode === "notes" ? '' : ' is-hidden') + '"></div></aside>');
  }
  async function flushPlayerNotes(tab) {
    clearTimeout(tab.notesSaveTimer);
    if (tab.notesSavePromise) await tab.notesSavePromise;
    if (!tab.notesDirty || tab.notesStatus !== "ready") return;
    var filePath = tab.video.path;
    var text = tab.notesText;
    tab.notesSavePromise = window.folderVideo.saveNotes(filePath, text);
    try {
      var result = await tab.notesSavePromise;
      if (result && result.error) throw new Error(result.error);
      if (tab.video.path === filePath && tab.notesText === text) tab.notesDirty = false;
      tab.notesError = "";
    } catch (error) {
      tab.notesError = error.message || String(error);
      notice("Не удалось сохранить заметки: " + tab.notesError);
    } finally {
      tab.notesSavePromise = null;
    }
  }
  function schedulePlayerNotesSave(tab) {
    tab.notesDirty = true;
    clearTimeout(tab.notesSaveTimer);
    tab.notesSaveTimer = setTimeout(function() { flushPlayerNotes(tab); }, 650);
  }
  function renderNotesPanel(tab, player) {
    var host = $("#notesScroll"); if (!host || active() !== tab) return;
    if (tab.notesStatus === "loading") { host.innerHTML = '<p class="transcript-empty">Открываем заметки…</p>'; return; }
    if (tab.notesStatus === "error") { host.innerHTML = '<p class="transcript-empty is-error">' + escapeHtml(tab.notesError) + '</p>'; return; }
    var focused = document.activeElement && document.activeElement.id === "notesSource";
    var source = host.querySelector("#notesSource");
    if (!source) {
      host.innerHTML = '<div class="notes-editor-head"><label class="notes-label" for="notesSource">Заметки по видео</label><button id="notesEditorToggle" class="notes-editor-toggle" type="button" aria-controls="notesEditorBody" aria-label="Развернуть редактор заметок" title="Развернуть редактор заметок" aria-expanded="false"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="m3.5 6 4.5 4 4.5-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div><div id="notesEditorBody" class="notes-editor-body"><textarea id="notesSource" class="notes-source" spellcheck="true" aria-label="Текст заметок по видео" title="Блоки вида [10:40], текст и разделитель ---" placeholder="[10:40]\nТекст заметки\n---"></textarea><div class="notes-help">Новый блок: [время], текст, затем --- на отдельной строке.</div></div><div class="notes-links" id="notesLinks"></div>';
      source = host.querySelector("#notesSource");
      host.querySelector("#notesEditorToggle").addEventListener("click", function() {
        tab.notesEditorCollapsed = !tab.notesEditorCollapsed;
        renderNotesPanel(tab, player);
      });
      source.addEventListener("input", function() {
        tab.notesText = source.value;
        schedulePlayerNotesSave(tab);
        renderNoteLinks(tab, player);
        if (player && player.paused) refreshVideoNote(tab, player, true);
        else refreshVideoNote(tab, player, false);
      });
    }
    if (!focused) source.value = tab.notesText || "";
    host.classList.toggle("notes-editor-collapsed", !!tab.notesEditorCollapsed);
    var toggle = host.querySelector("#notesEditorToggle");
    toggle.setAttribute("aria-expanded", String(!tab.notesEditorCollapsed));
    toggle.setAttribute("aria-label", tab.notesEditorCollapsed ? "Развернуть редактор заметок" : "Свернуть редактор заметок");
    toggle.title = toggle.getAttribute("aria-label");
    renderNoteLinks(tab, player);
  }
  function renderNoteLinks(tab, player) {
    var host = $("#notesLinks"); if (!host || active() !== tab) return;
    var notes = notesCore.parseNotes(tab.notesText).sort(function(first, second) { return first.start - second.start || first.blockIndex - second.blockIndex; });
    host.innerHTML = notes.length ? '<h3>Переходы</h3>' + notes.map(function(note, index) {
      var label = notesCore.formatNoteTime(note.start);
      return '<button class="note-link" type="button" data-index="' + index + '" title="Перейти к ' + label + '" aria-label="Перейти к заметке на ' + label + '"><time>' + label + '</time><span>' + escapeHtml(note.text).replace(/\n/g, '<br>') + '</span></button>';
    }).join('') : '<p class="transcript-empty">Заметок пока нет.</p>';
    host.querySelectorAll(".note-link").forEach(function(button) {
      button.addEventListener("click", function() {
        var note = notes[Number(button.dataset.index)];
        if (player && note) { player.currentTime = note.start; tab.currentTime = player.currentTime; player.play().catch(function() {}); focusPlaybackControl(); }
      });
    });
  }
  function focusPlaybackControl() {
    var control = $("#togglePlayback");
    if (control) control.focus({ preventScroll: true });
  }
  async function loadPlayerNotes(tab) {
    if (tab.notesStatus) return;
    var filePath = tab.video.path;
    tab.notesStatus = "loading"; renderNotesPanel(tab, $("#player"));
    try {
      var result = await window.folderVideo.loadNotes(filePath);
      if (tab.video.path !== filePath || !state.tabs.includes(tab)) return;
      if (result && result.error) throw new Error(result.error);
      tab.notesText = result.text || ""; tab.notesStatus = "ready"; tab.notesError = "";
    } catch (error) {
      if (tab.video.path !== filePath || !state.tabs.includes(tab)) return;
      tab.notesStatus = "error"; tab.notesError = error.message || String(error);
    }
    renderNotesPanel(tab, $("#player"));
    refreshVideoNote(tab, $("#player"), false);
  }
  function refreshVideoNote(tab, player, preserveInput) {
    var field = $("#videoNote"); var time = $("#videoNoteTime");
    if (!field || !time || !player || active() !== tab) return;
    if (tab.notesStatus !== "ready") { field.disabled = true; field.value = ""; time.textContent = "Заметки"; return; }
    field.disabled = false;
    var seconds = Math.max(0, player.currentTime || 0);
    var note = notesCore.activeNote(notesCore.parseNotes(tab.notesText), seconds);
    if (player.paused && !player.ended) {
      field.readOnly = false;
      if (preserveInput && document.activeElement === field) return;
      if (tab.noteEditStart !== (note ? note.start : Math.floor(seconds)) || tab.noteEditBlockIndex !== (note ? note.blockIndex : null)) {
        tab.noteEditStart = note ? note.start : Math.floor(seconds);
        tab.noteEditBlockIndex = note ? note.blockIndex : null;
        field.value = note ? note.text : "";
      } else if (document.activeElement !== field) field.value = note ? note.text : "";
      time.textContent = "[" + notesCore.formatNoteTime(tab.noteEditStart) + "]";
      field.placeholder = "Введите заметку для этого момента видео";
    } else {
      field.readOnly = true;
      tab.noteEditStart = null; tab.noteEditBlockIndex = null;
      field.value = note ? note.text : "";
      time.textContent = note ? "[" + notesCore.formatNoteTime(note.start) + "]" : "Заметки";
      field.placeholder = "Заметка появится здесь на 10 секунд видео";
    }
    field.closest(".video-note-box").classList.toggle("has-note", !!note);
  }
  function renderSummaryPanel(tab, player) {
    var host = $("#summaryScroll"); if (!host || active() !== tab) return;
    if (tab.summaryStatus === "loading") { host.innerHTML = '<p class="transcript-empty">Открываем сохранённую сводку…</p>'; return; }
    if (tab.summaryStatus === "running") { host.innerHTML = '<p class="transcript-empty is-running">DeepSeek создаёт сводку…</p>'; return; }
    if (tab.summaryError) { host.innerHTML = '<p class="transcript-empty is-error">' + escapeHtml(tab.summaryError) + '</p><button class="summary-retry" type="button">Повторить</button>'; host.querySelector("button").addEventListener("click", function() { startPlayerSummary(tab, true); }); return; }
    if (!tab.summaryData) { host.innerHTML = '<p class="transcript-empty">' + (tab.transcriptSegments && tab.transcriptSegments.length ? 'Для сводки укажите ключ DeepSeek в настройках.' : 'Сначала транскрибируйте видео.') + '</p>'; return; }
    var paragraphs = tab.summaryData.overview.split(/\n\s*\n/).map(function(value) { return '<p>' + escapeHtml(value).replace(/\n/g, '<br>') + '</p>'; }).join('');
    var topics = tab.summaryData.topics.map(function(topic, index) { return '<button class="summary-topic" type="button" data-index="' + index + '" title="Перейти к ' + escapeHtml(formatTime(topic.start)) + '" aria-label="Перейти к теме ' + escapeHtml(topic.title) + ' на ' + escapeHtml(formatTime(topic.start)) + '"><time>' + formatTime(topic.start) + '</time><span><strong>' + escapeHtml(topic.title) + '</strong>' + (topic.description ? '<small>' + escapeHtml(topic.description) + '</small>' : '') + '</span></button>'; }).join('');
    var fold = tab.summaryFold || (tab.summaryFold = {});
    function foldButton(key, label) { var closed = !!fold[key]; return '<button class="summary-fold" type="button" data-fold="' + key + '" aria-expanded="' + !closed + '" title="' + (closed ? 'Развернуть' : 'Свернуть') + ': ' + label + '" aria-label="' + (closed ? 'Развернуть' : 'Свернуть') + ': ' + label + '"><span class="summary-chevron" aria-hidden="true">▾</span>' + label + '</button>'; }
    host.innerHTML = '<div class="summary-head"><h2>' + foldButton("overview", "Сводка") + '</h2><button class="summary-retry" type="button" title="Создать сводку заново" aria-label="Создать сводку заново">↻</button></div><div class="summary-overview"' + (fold.overview ? ' hidden' : '') + '>' + paragraphs + '</div><h3>' + foldButton("topics", "Основные темы") + '</h3><div class="summary-topics"' + (fold.topics ? ' hidden' : '') + '>' + (topics || '<p class="transcript-empty">Темы не выделены.</p>') + '</div>';
    host.querySelectorAll(".summary-fold").forEach(function(button) { button.addEventListener("click", function() { var key = button.dataset.fold; fold[key] = !fold[key]; renderSummaryPanel(tab, player); }); });
    host.querySelector(".summary-retry").addEventListener("click", function() { startPlayerSummary(tab, true); });
    host.querySelectorAll(".summary-topic").forEach(function(button) { button.addEventListener("click", function() { var topic = tab.summaryData.topics[Number(button.dataset.index)]; if (player && topic) { player.currentTime = topic.start; tab.currentTime = player.currentTime; player.play().catch(function() {}); focusPlaybackControl(); } }); });
  }
  async function loadPlayerSummary(tab) {
    if (tab.summaryStatus === "running" || tab.summaryStatus === "loading") return;
    var filePath = tab.video.path;
    tab.summaryStatus = "loading"; tab.summaryError = ""; renderSummaryPanel(tab, $("#player"));
    var result = await window.folderVideo.loadSummary(filePath);
    if (tab.video.path !== filePath || !state.tabs.includes(tab)) return;
    if (result.available) { tab.summaryData = result.summary; tab.summaryStatus = "ready"; }
    else if (result.error) { tab.summaryError = result.error; tab.summaryStatus = "error"; }
    else if (tab.transcriptSegments && tab.transcriptSegments.length && state.settings.ai.keyConfigured) { startPlayerSummary(tab, false); return; }
    else tab.summaryStatus = "ready";
    renderSummaryPanel(tab, $("#player"));
  }
  async function openSummaryArticle(tab) {
    var info = await window.folderVideo.getObsidianArticle(tab.video.path);
    if (!info.exists) { notice("Статья ещё не создана: нажмите кнопку, чтобы создать её."); return; }
    window.folderVideo.openMetadataLink("obsidian://open?path=" + encodeURIComponent(info.path));
  }
  async function exportSummaryArticle(tab, mode) {
    if (tab.obsidianBusy) return;
    if (!tab.summaryData) { notice(tab.summaryStatus === "running" ? "Дождитесь завершения сводки." : "Сначала создайте сводку: нужны транскрипция и ключ DeepSeek."); return; }
    if (mode !== "append") {
      var existing = await window.folderVideo.getObsidianArticle(tab.video.path);
      if (existing.exists && !window.confirm("Статья уже существует:\n" + existing.path + "\n\nПерезаписать её и скриншоты? Ручные правки в статье будут потеряны.")) return;
      if (tab.obsidianBusy) return;
    }
    var filePath = tab.video.path; var player = $("#player"); var button = $("#obsidianExport");
    var duration = player && player.src && Number.isFinite(player.duration) ? player.duration : (state.durationCache.get(fileKey(tab.video)) || 0);
    tab.obsidianBusy = true; if (button) { button.disabled = true; button.classList.add("is-running"); }
    notice(mode === "append" ? "Дополняем статью в Obsidian…" : "Создаём статью в Obsidian…", true);
    try {
      var result = await window.folderVideo.exportSummaryToObsidian(filePath, duration, mode || "create");
      if (result.error) notice("Не удалось создать статью: " + result.error);
      else notice((result.appended ? "Статья дополнена. " : result.warning ? "Статья сохранена. " + result.warning + " " : "Статья сохранена в Obsidian: " + result.path + " ") + "Нажмите, чтобы открыть.", !result.warning, function() { window.folderVideo.openMetadataLink("obsidian://open?path=" + encodeURIComponent(result.path)); });
    } catch (error) { notice("Не удалось создать статью: " + (error.message || error)); }
    finally { tab.obsidianBusy = false; var current = $("#obsidianExport"); if (current && active() === tab) { current.disabled = false; current.classList.remove("is-running"); } }
  }
  async function startPlayerSummary(tab, force) {
    if (!tab.transcriptSegments || !tab.transcriptSegments.length) { tab.summaryError = "Сначала транскрибируйте видео."; renderSummaryPanel(tab, $("#player")); return; }
    if (!state.settings.ai.keyConfigured) { tab.summaryError = "Укажите ключ DeepSeek в настройках."; renderSummaryPanel(tab, $("#player")); return; }
    if (tab.summaryStatus === "running") return;
    var filePath = tab.video.path;
    tab.summaryStatus = "running"; tab.summaryError = ""; renderSummaryPanel(tab, $("#player"));
    var result = await window.folderVideo.startSummary(filePath, force === true);
    if (tab.video.path !== filePath || !state.tabs.includes(tab) || tab.summaryStatus !== "running") return;
    if (result.error) { tab.summaryStatus = "error"; tab.summaryError = result.error; }
    else { tab.summaryStatus = "ready"; tab.summaryData = result.summary; }
    renderSummaryPanel(tab, $("#player"));
  }
  function renderTranscriptPanel(tab, player) {
    var host = $("#transcriptScroll"); if (!host || active() !== tab) return;
    if (tab.transcriptStatus === "loading") { host.innerHTML = "<p class=\"transcript-empty\">Открываем сохранённую транскрипцию…</p>"; return; }
    if (tab.transcriptStatus === "running") { host.innerHTML = "<p class=\"transcript-empty is-running\">Транскрибация выполняется…<strong>" + Math.round(tab.transcriptProgress || 0) + "%</strong></p>"; return; }
    if (tab.transcriptError) { host.innerHTML = "<p class=\"transcript-empty is-error\">" + escapeHtml(tab.transcriptError) + "</p>"; return; }
    if (!tab.transcriptSegments || !tab.transcriptSegments.length) { host.innerHTML = "<p class=\"transcript-empty\">Транскрипции пока нет.<br>Нажмите кнопку транскрибации в шапке панели.</p>"; return; }
    host.innerHTML = tab.transcriptSegments.map(function(segment, index) { return "<button class=\"transcript-segment\" data-index=\"" + index + "\" data-start=\"" + segment.start + "\" data-end=\"" + segment.end + "\"><time>" + formatTime(segment.start) + "</time><span>" + escapeHtml(segment.text) + "</span></button>"; }).join("");
    host.querySelectorAll(".transcript-segment").forEach(function(button) { button.addEventListener("click", function() { player.currentTime = Number(button.dataset.start); tab.currentTime = player.currentTime; player.play().catch(function() {}); updateActiveTranscript(player.currentTime, tab, true); focusPlaybackControl(); }); });
    updateActiveTranscript(player.currentTime, tab, true);
  }
  async function loadPlayerTranscript(tab) {
    var filePath = tab.video.path;
    tab.transcriptStatus = "loading"; tab.transcriptError = ""; renderTranscriptPanel(tab, $("#player"));
    var result = await window.folderVideo.loadTranscript(filePath);
    if (!state.tabs.includes(tab) || tab.video.path !== filePath) return;
    if (result.error) { tab.transcriptError = result.error; tab.transcriptStatus = "error"; }
    else { tab.transcriptSegments = result.available ? parseSrt(result.srt) : []; tab.transcriptStatus = "ready"; tab.transcriptStale = Boolean(result.stale); }
    renderTranscriptPanel(tab, $("#player")); updateTranscriptControls(tab);
    if (result.available && tab.transcriptSegments.length) loadPlayerSummary(tab);
  }
  function updateTranscriptControls(tab) {
    var button = $("#transcriptAction"); if (!button || active() !== tab) return;
    var action = transcriptButtonMarkup(tab); button.className = "transcript-action" + action.className; button.innerHTML = action.icon; button.title = action.title; button.setAttribute("aria-label", action.title);
    var playerButton = $("#playerTranscript");
    if (playerButton) { var playerTitle = tab.transcriptSegments && tab.transcriptSegments.length ? "Открыть транскрипцию" : "Транскрибировать видео"; playerButton.title = playerTitle; playerButton.setAttribute("aria-label", playerTitle); }
    renderTranscriptPanel(tab, $("#player"));
  }
  async function startPlayerTranscript(tab) {
    if (state.transcript && state.transcript.filePath === tab.video.path) { await window.folderVideo.cancelTranscript(state.transcript.operationId); return; }
    if (state.transcript) { notice("Сначала дождитесь завершения другой транскрибации."); return; }
    var operationId = "transcript-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    var filePath = tab.video.path;
    state.transcript = { operationId: operationId, filePath: filePath, progress: 0 }; tab.transcriptStatus = "running"; tab.transcriptProgress = 0; tab.panelMode = "transcript"; setPlayerPanelMode(tab, $("#player")); updateTranscriptControls(tab);
    var result = await window.folderVideo.startTranscript(filePath, operationId);
    if (!state.transcript || state.transcript.operationId !== operationId) return;
    state.transcript = null;
    if (tab.video.path !== filePath) return;
    if (result.canceled) { tab.transcriptStatus = "ready"; updateTranscriptControls(tab); return; }
    if (result.error) { tab.transcriptStatus = "error"; tab.transcriptError = result.error; updateTranscriptControls(tab); return; }
    tab.transcriptSegments = parseSrt(result.srt || ""); tab.transcriptStatus = "ready"; tab.transcriptStale = false; tab.summaryData = null; tab.summaryStatus = null; tab.summaryError = ""; updateTranscriptControls(tab); notice("Транскрипция готова", true);
    if (tab.transcriptSegments.length) {
      if (state.settings.ai.keyConfigured) startPlayerSummary(tab, true);
      else renderSummaryPanel(tab, $("#player"));
    }
  }
  function updateActiveTranscript(time, tab, shouldScroll) {
    if ((tab.panelMode || "frames") !== "transcript" || !tab.transcriptSegments) return;
    var index = tab.transcriptSegments.findIndex(function(segment) { return time >= segment.start && time < segment.end; });
    var host = $("#transcriptScroll"); if (!host) return;
    var next = index >= 0 ? host.querySelector(".transcript-segment[data-index=\"" + index + "\"]") : null;
    var previous = host.querySelector(".transcript-segment.active");
    if (previous !== next) { if (previous) previous.classList.remove("active"); if (next) { next.classList.add("active"); if (shouldScroll) next.scrollIntoView({ block: "center" }); } }
  }
  function setPlayerPanelMode(tab, player) {
    var mode = tab.panelMode || "frames"; var frames = $("#gridScroll"); var transcript = $("#transcriptScroll"); var summary = $("#summaryScroll"); var notes = $("#notesScroll"); var controls = $("#frameControls");
    if (frames) frames.classList.toggle("is-hidden", mode !== "frames"); if (transcript) transcript.classList.toggle("is-hidden", mode !== "transcript"); if (summary) summary.classList.toggle("is-hidden", mode !== "summary"); if (notes) notes.classList.toggle("is-hidden", mode !== "notes"); if (controls) controls.classList.toggle("is-hidden", mode !== "frames");
    document.querySelectorAll("[data-panel-mode]").forEach(function(button) { button.classList.toggle("active", button.dataset.panelMode === mode); });
    if (mode === "transcript") renderTranscriptPanel(tab, player); else if (mode === "summary") renderSummaryPanel(tab, player); else if (mode === "notes") renderNotesPanel(tab, player); else if (player && Number.isFinite(player.duration) && !$("#frameGrid").children.length) renderFrameGrid(tab, player);
  }
  function renderPlayer(tab) { var gs = "";
    var playbackRate = tab.playbackRate || 1;
    var videoIndex = playerVideoIndex(tab);
    var prevDisabled = videoIndex <= 0;
    var nextDisabled = videoIndex === -1 || videoIndex >= playerVideoList().length - 1;
    var favorite = isFavorite(tab.video.path);
    view.innerHTML = "<section class=\"player-view\"><div class=\"player-layout\"" + gs + "\"><div class=\"player-main\"><div class=\"video-bar\"><button id=\"back\" class=\"back\">◀ VIDEO LIST</button><span id=\"reveal\" class=\"video-path\" title=\"Открыть в Проводнике\">" + escapeHtml(tab.video.path) + "</span><button id=\"videoScreenshot\" class=\"video-action\" title=\"Сохранить скрин текущего кадра\" aria-label=\"Сохранить скрин текущего кадра\">SHOT</button><button id=\"copyVideoName\" class=\"video-action\" title=\"Скопировать название файла без расширения\" aria-label=\"Скопировать название файла без расширения\">COPY</button><button id=\"openOkoshko\" class=\"video-action\" title=\"Открыть в okoshko\" aria-label=\"Открыть в okoshko\"><svg viewBox=\"0 0 16 16\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" aria-hidden=\"true\"><rect x=\"2\" y=\"3\" width=\"12\" height=\"10\" rx=\"1.5\"/><path d=\"M2 6h12\"/></svg></button><button id=\"openExternal\" class=\"open-external\" title=\"Открыть в системном плеере\" aria-label=\"Открыть в системном плеере\">▶</button></div><div class=\"video-stage\"><video id=\"player\" controls playsinline src=\"" + (state.cutJob && state.cutJob.filePath === tab.video.path ? "" : tab.video.url) + "\"></video><nav class=\"video-switcher\" aria-label=\"Управление воспроизведением и переключение видео\"><button id=\"previousVideo\" type=\"button\" title=\"Предыдущее видео\" aria-label=\"Предыдущее видео\" " + (prevDisabled ? "disabled" : "") + ">‹ Prev</button><button id=\"togglePlayback\" class=\"toggle-playback\" type=\"button\" title=\"Воспроизвести (Space)\" aria-label=\"Воспроизвести\" aria-pressed=\"false\"><span aria-hidden=\"true\">▶</span></button><button id=\"nextVideo\" type=\"button\" title=\"Следующее видео\" aria-label=\"Следующее видео\" " + (nextDisabled ? "disabled" : "") + ">Next ›</button></nav></div></div><aside id=\"gridPanel\" class=\"grid-panel" + (tab.collapsed ? " collapsed" : "") + "\"><header class=\"grid-head\"><button id=\"collapse\" class=\"collapse\" title=\"Свернуть панель\">" + (tab.collapsed ? "◀" : "▶") + "</button><div class=\"grid-control\"><label>Col</label><select id=\"columns\">" + [3,4,5,6,8].map(function(v) { return "<option " + (v === tab.columns ? "selected" : "") + ">" + v + "</option>"; }).join("") + "</select></div><div class=\"grid-control\"><label>Sec</label><select id=\"seconds\">" + [5,10,15,30,60].map(function(v) { return "<option " + (v === tab.seconds ? "selected" : "") + ">" + v + "</option>"; }).join("") + "</select></div><div class=\"grid-control\"><label>Scroll</label><select id=\"scroll\"><option value=\"center\" " + (tab.scroll === "center" ? "selected" : "") + ">Center</option><option value=\"edge\" " + (tab.scroll === "edge" ? "selected" : "") + ">Edge</option><option value=\"off\" " + (tab.scroll === "off" ? "selected" : "") + ">OFF</option></select></div></header><div id=\"gridScroll\" class=\"grid-scroll\"><div id=\"frameGrid\" class=\"frame-grid\"></div></div></aside></div><footer class=\"player-status\">Пробел — пуск/пауза · Стрелки — перемещение маркера · Клик/перетаскивание — точный переход · I/O — границы вырезки · X — вырезать · Ctrl+Z — отменить вырезку</footer></section>";
    $("#gridPanel").outerHTML = sidePanelMarkup(tab);
    $(".video-switcher").insertAdjacentHTML("afterend", '<div class="video-note-box"><label for="videoNote" id="videoNoteTime">Заметки</label><textarea id="videoNote" aria-label="Заметка к текущему моменту видео" title="На паузе можно записать заметку" readonly></textarea></div>');
    var favoriteButton = document.createElement("button");
    favoriteButton.id = "playerFavorite";
    favoriteButton.className = "favorite-toggle" + (favorite ? " is-favorite" : "");
    favoriteButton.title = favorite ? "Удалить из избранного" : "Добавить в избранное";
    favoriteButton.setAttribute("aria-label", favoriteButton.title);
    favoriteButton.textContent = favorite ? "♥" : "♡";
    $("#videoScreenshot").before(favoriteButton);
    var youtubeButton = document.createElement("button");
    youtubeButton.id = "playerYoutube";
    youtubeButton.type = "button";
    youtubeButton.className = "player-youtube";
    youtubeButton.innerHTML = YOUTUBE_ICON;
    favoriteButton.before(youtubeButton);
    var deleteButton = document.createElement("button");
    deleteButton.id = "playerDelete";
    deleteButton.className = "player-delete";
    deleteButton.title = "Удалить видео";
    deleteButton.setAttribute("aria-label", deleteButton.title);
    deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
    $("#videoScreenshot").before(deleteButton);
    var moveButton = document.createElement("button");
    moveButton.id = "playerMove";
    moveButton.className = "player-move";
    moveButton.title = "Перенести в другую папку";
    moveButton.setAttribute("aria-label", moveButton.title);
    moveButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6l2 2h8v12H4V4Zm8 7h6m0 0-3-3m3 3-3 3"/></svg>';
    $("#playerDelete").before(moveButton);
    var cutButton = document.createElement("button");
    cutButton.id = "playerCut";
    cutButton.className = "player-cut" + (tab.cut && tab.cut.open ? " is-active" : "");
    cutButton.title = "Вырезать фрагменты (I — начало, O — конец, X — вырезать)";
    cutButton.setAttribute("aria-label", cutButton.title);
    cutButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg>';
    $("#playerDelete").before(cutButton);
    var speedButton = document.createElement("button");
    var speedJob = state.speedUp;
    var speedingUp = speedJob && speedJob.filePath === tab.video.path;
    speedButton.id = "playerSpeed";
    speedButton.className = "player-speed" + (speedJob ? " is-running" : "");
    speedButton.disabled = Boolean(speedJob);
    speedButton.title = speedingUp ? "Ускорение: " + Math.round(speedJob.progress) + "%" : "Ускорить в 2 раза";
    speedButton.setAttribute("aria-label", speedButton.title);
    if (speedingUp) speedButton.style.setProperty("--speed-progress", speedJob.progress + "%");
    speedButton.innerHTML = speedUpButtonMarkup(speedingUp, speedingUp ? speedJob.progress : 0);
    $("#playerDelete").before(speedButton);
    var transcriptButton = document.createElement("button");
    transcriptButton.id = "playerTranscript";
    transcriptButton.className = "player-transcript";
    transcriptButton.title = "Транскрибировать видео моделью Parakeet TDT";
    transcriptButton.setAttribute("aria-label", transcriptButton.title);
    transcriptButton.innerHTML = transcriptIconMarkup();
    $("#playerDelete").before(transcriptButton);
    var layout = $(".player-layout"); layout.insertAdjacentHTML("afterbegin", metadataPanelMarkup(tab)); layout.classList.toggle("metadata-collapsed", tab.metadataCollapsed); layout.classList.toggle("grid-collapsed", tab.collapsed); layout.style.setProperty("--grid-panel-width", (tab.panelWidth || 410) + "px");
    var player = $("#player"); player.currentTime = tab.currentTime || 0; player.playbackRate = playbackRate;
    var playbackRates = document.createElement("span");
    playbackRates.className = "playback-rates";
    playbackRates.setAttribute("aria-label", "Скорость воспроизведения");
    [1, 1.5, 2].forEach(function(rate) {
      var rateButton = document.createElement("button");
      rateButton.className = "playback-rate" + (rate === playbackRate ? " is-active" : "");
      rateButton.dataset.rate = rate;
      rateButton.type = "button";
      rateButton.title = "Скорость воспроизведения " + rate + "x";
      rateButton.setAttribute("aria-label", rateButton.title);
      rateButton.textContent = rate;
      playbackRates.appendChild(rateButton);
    });
    $(".video-switcher").appendChild(playbackRates);
    var playbackTime = document.createElement("span");
    playbackTime.id = "playbackTime";
    playbackTime.className = "playback-time";
    playbackTime.title = "Текущее время / длительность";
    playbackTime.setAttribute("aria-label", "Текущее время и длительность видео");
    $(".video-switcher").prepend(playbackTime);
    function updatePlaybackTime() { playbackTime.textContent = formatTime(player.currentTime || 0) + " / " + formatTime(player.duration); }
    updatePlaybackTime();
    ["loadedmetadata", "durationchange", "timeupdate", "seeked", "emptied"].forEach(function(name) { player.addEventListener(name, updatePlaybackTime); });
    $("#back").addEventListener("click", function() { flushPlayerNotes(tab); state.activeTab = "folder"; render(); });
    $("#reveal").addEventListener("click", function() { window.folderVideo.showInFolder(tab.video.path); });
    $("#playerFavorite").addEventListener("click", function() { toggleFavorite(tab.video); renderPlayer(tab); });
    $("#playerYoutube").addEventListener("click", function() {
      var info = currentYoutubeInfo(tab.video);
      if (info.mode === "linked") openYoutubeSource(tab.video);
      else if (info.mode === "none" || info.mode === "error") findYoutubeSource(tab.video, player);
    });
    applyYoutubeButton(tab.video); loadYoutubeSource(tab.video);
    $("#playerMove").addEventListener("click", function() { moveFile(tab.video.path); });
    $("#playerCut").addEventListener("click", function() { toggleCutBar(tab, player); $("#playerCut").classList.toggle("is-active", Boolean(tab.cut && tab.cut.open)); });
    $("#playerSpeed").addEventListener("click", function() { startSpeedUp(tab, player); });
    $("#playerTranscript").addEventListener("click", function() { tab.panelMode = "transcript"; setPlayerPanelMode(tab, player); if (!tab.transcriptSegments || !tab.transcriptSegments.length) startPlayerTranscript(tab); });
    $("#playerDelete").addEventListener("click", function() { deleteFile(tab.video.path); });
    $("#videoScreenshot").addEventListener("click", function() { takeVideoScreenshot(tab, player); });
    $("#copyVideoName").addEventListener("click", function() { copyVideoName(tab); });
    player.addEventListener("contextmenu", function(event) { event.preventDefault(); showCtxMenu(event, tab.video.path, tab, player); });
    var togglePlayback = $("#togglePlayback");
    function updatePlaybackButton() {
      var playing = !player.paused && !player.ended;
      togglePlayback.classList.toggle("is-playing", playing);
      togglePlayback.setAttribute("aria-pressed", String(playing));
      togglePlayback.title = (playing ? "Пауза" : "Воспроизвести") + " (Space)";
      togglePlayback.setAttribute("aria-label", playing ? "Поставить на паузу" : "Воспроизвести");
      togglePlayback.firstElementChild.textContent = playing ? "❚❚" : "▶";
    }
    togglePlayback.addEventListener("click", function() { player.paused ? player.play().catch(function() {}) : player.pause(); });
    player.addEventListener("play", function() { updatePlaybackButton(); refreshVideoNote(tab, player, false); flushPlayerNotes(tab); });
    player.addEventListener("pause", function() { updatePlaybackButton(); refreshVideoNote(tab, player, false); });
    player.addEventListener("ended", updatePlaybackButton);
    $("#videoNote").addEventListener("input", function(event) {
      if (!player.paused || tab.notesStatus !== "ready") return;
      var text = event.target.value;
      tab.notesText = notesCore.upsertNote(tab.notesText, tab.noteEditStart, text, tab.noteEditBlockIndex);
      var edited = notesCore.parseNotes(tab.notesText).filter(function(note) { return note.start === tab.noteEditStart && note.text === text.trim(); });
      tab.noteEditBlockIndex = edited.length ? edited[edited.length - 1].blockIndex : null;
      schedulePlayerNotesSave(tab);
      renderNotesPanel(tab, player);
    });
    $("#previousVideo").addEventListener("click", function() { switchPlayerVideo(tab, -1); });
    $("#nextVideo").addEventListener("click", function() { switchPlayerVideo(tab, 1); });
    document.querySelectorAll(".playback-rate").forEach(function(button) {
      button.addEventListener("click", function() {
        tab.playbackRate = Number(button.dataset.rate);
        player.playbackRate = tab.playbackRate;
        document.querySelectorAll(".playback-rate").forEach(function(rateButton) { rateButton.classList.toggle("is-active", rateButton === button); });
      });
    });
    $("#openOkoshko").addEventListener("click", async function() {
      var error = await window.folderVideo.openInOkoshko(tab.video.path);
      if (error) notice("Не удалось открыть в okoshko: " + error);
    });
    $("#openExternal").addEventListener("click", async function() {
      var error = await window.folderVideo.openInSystemPlayer(tab.video.path);
      if (error) notice("Не удалось открыть внешний плеер: " + error);
    });
    $("#metadataCollapse").addEventListener("click", function() { tab.metadataCollapsed = !tab.metadataCollapsed; state.metadataCollapsed = tab.metadataCollapsed; savePanelPreferences(); renderPlayer(tab); });
    $("#collapse").addEventListener("click", function() { tab.collapsed = !tab.collapsed; state.gridCollapsed = tab.collapsed; savePanelPreferences(); renderPlayer(tab); });
    var panelResizer = $("#panelResizer");
    panelResizer.addEventListener("pointerdown", function(event) {
      if (tab.collapsed) return;
      event.preventDefault(); panelResizer.setPointerCapture(event.pointerId);
      var startX = event.clientX; var startWidth = tab.panelWidth || 410;
      function resize(moveEvent) {
        var layoutWidth = layout.clientWidth; var leftWidth = tab.metadataCollapsed ? 42 : 280;
        var maxWidth = Math.max(280, Math.min(720, layoutWidth - leftWidth - 430));
        tab.panelWidth = Math.max(280, Math.min(maxWidth, startWidth + startX - moveEvent.clientX));
        layout.style.setProperty("--grid-panel-width", tab.panelWidth + "px");
        panelResizer.setAttribute("aria-valuenow", String(Math.round(tab.panelWidth)));
        state.settings.viewer.panelWidth = Math.round(tab.panelWidth);
        state.tabs.filter(function(item) { return item.type === "player"; }).forEach(function(item) { item.panelWidth = tab.panelWidth; });
      }
      function finish() { panelResizer.removeEventListener("pointermove", resize); panelResizer.removeEventListener("pointerup", finish); panelResizer.removeEventListener("pointercancel", finish); savePanelPreferences(); }
      panelResizer.addEventListener("pointermove", resize); panelResizer.addEventListener("pointerup", finish); panelResizer.addEventListener("pointercancel", finish);
    });
    panelResizer.addEventListener("keydown", function(event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault(); var delta = event.key === "ArrowLeft" ? 16 : -16;
      tab.panelWidth = Math.max(280, Math.min(720, (tab.panelWidth || 410) + delta));
      state.settings.viewer.panelWidth = tab.panelWidth; layout.style.setProperty("--grid-panel-width", tab.panelWidth + "px");
      panelResizer.setAttribute("aria-valuenow", String(tab.panelWidth)); savePanelPreferences();
    });
    document.querySelectorAll("[data-panel-mode]").forEach(function(button) { button.addEventListener("click", function() { tab.panelMode = button.dataset.panelMode; setPlayerPanelMode(tab, player); }); });
    $("#transcriptAction").addEventListener("click", function() { startPlayerTranscript(tab); });
    var articleMenu = $("#obsidianMenu"); var articleToggle = $("#obsidianMenuToggle");
    function closeArticleMenu() { articleMenu.classList.add("is-hidden"); articleToggle.setAttribute("aria-expanded", "false"); document.removeEventListener("click", outsideArticleMenu, true); }
    function outsideArticleMenu(event) { if (!articleMenu.contains(event.target) && !articleToggle.contains(event.target)) closeArticleMenu(); }
    $("#obsidianExport").addEventListener("click", function() { closeArticleMenu(); exportSummaryArticle(tab, "create"); });
    articleToggle.addEventListener("click", function() {
      if (!articleMenu.classList.contains("is-hidden")) { closeArticleMenu(); return; }
      articleMenu.classList.remove("is-hidden"); articleToggle.setAttribute("aria-expanded", "true"); document.addEventListener("click", outsideArticleMenu, true);
    });
    articleMenu.addEventListener("keydown", function(event) { if (event.key === "Escape") { closeArticleMenu(); articleToggle.focus(); } });
    articleMenu.querySelectorAll("[data-article-action]").forEach(function(item) { item.addEventListener("click", function() { closeArticleMenu(); if (item.dataset.articleAction === "open") openSummaryArticle(tab); else exportSummaryArticle(tab, "append"); }); });
    $("#columns").addEventListener("change", function(event) {
      tab.columns = Number(event.target.value);
      var grid = $("#frameGrid");
      if (grid) grid.style.gridTemplateColumns = "repeat(" + tab.columns + ", minmax(0, 1fr))";
      updateActiveFrame(player.currentTime, tab, false);
    });
    $("#seconds").addEventListener("change", function(event) {
      tab.seconds = Number(event.target.value);
      renderFrameGrid(tab, player);
    });
    $("#scroll").addEventListener("change", function(event) { tab.scroll = event.target.value; });
    renderMetadataContent(tab); if (!tab.metadata && tab.metadataStatus === "idle") loadMetadata(tab);
    if (!tab.transcriptStatus) loadPlayerTranscript(tab);
    else { renderTranscriptPanel(tab, player); if (!tab.summaryStatus && tab.transcriptSegments.length) loadPlayerSummary(tab); else renderSummaryPanel(tab, player); }
    if (!tab.notesStatus) loadPlayerNotes(tab); else { renderNotesPanel(tab, player); refreshVideoNote(tab, player, false); }
    player.addEventListener("loadedmetadata", function() {
      if (!Number.isFinite(player.duration) || !player.duration) { notice("Этот файл не удаётся декодировать в Chromium."); return; }
      renderFrameGrid(tab, player);
    });
    player.addEventListener("timeupdate", function() { tab.currentTime = player.currentTime; updateActiveFrame(player.currentTime, tab, !tab.isDragging); updateActiveTranscript(player.currentTime, tab, true); refreshVideoNote(tab, player, true); if (Date.now() - lastSessionSave >= 1000) saveSession(); });
    player.addEventListener("seeked", function() { tab.currentTime = player.currentTime; updateActiveFrame(player.currentTime, tab, !tab.isDragging); updateActiveTranscript(player.currentTime, tab, true); refreshVideoNote(tab, player, false); saveSession(); });
    document.onkeydown = function(event) { keyboardPlayer(event, tab, player); };
    player.addEventListener("loadedmetadata", function() { renderCutBar(tab, player); });
    ["timeupdate", "seeked"].forEach(function(name) { player.addEventListener(name, function() { updateCutPlayhead(tab, player); }); });
    renderCutBar(tab, player);
    if (state.cutJob && state.cutJob.filePath === tab.video.path) showCutOverlay(tab);
  }
  // --- Вырезка фрагментов ---
  var CUT_FRAME_STEP = 1 / 30;
  var CUT_MIN_HANDLE_GAP = 0.1;
  function cutModel(tab) {
    if (!tab.cut) tab.cut = { open: false, ranges: [], pendingStart: null, precise: localStorage.getItem("folder-video-cut-precise") === "true", plan: null, planError: "", planToken: 0, planTimer: null, view: null, dragging: false, wave: null };
    return tab.cut;
  }
  // Видимое окно полосы: {start, span} в секундах; по умолчанию показан весь ролик.
  function cutView(tab, player) {
    var cut = cutModel(tab);
    cut.view = window.CutCore.clampView(cut.view || window.CutCore.fullView(player.duration), player.duration);
    return cut.view;
  }
  function cutPos(seconds, view) { return (seconds - view.start) / view.span * 100; }
  function cutRangeBox(range, view) {
    var left = cutPos(range.start, view); var right = cutPos(range.end, view);
    if (right <= 0 || left >= 100) return null;
    var clippedLeft = Math.max(0, left);
    return { left: clippedLeft, width: Math.min(100, right) - clippedLeft, clipStart: left < 0, clipEnd: right > 100 };
  }
  function cutClock(seconds) { return window.CutCore.formatClock(seconds); }
  function cutInfoText(tab) {
    var cut = cutModel(tab);
    if (cut.planError) return cut.planError;
    if (cut.pendingStart !== null && !cut.ranges.length) return "Начало " + cutClock(cut.pendingStart) + ". Найдите конец и нажмите O.";
    if (!cut.ranges.length) return "I — начало, O — конец (без I — от начала видео), X — вырезать. +/− — масштаб полосы, Ctrl+колесо — масштаб у курсора. Ctrl+Z — отменить вырезку.";
    if (!cut.plan) return "Проверяю границы…";
    var plan = cut.plan;
    var removed = window.CutCore.removedSeconds(plan.ranges);
    var text = "Будет удалено " + cutClock(removed) + " (" + plan.ranges.map(function(range) { return cutClock(range.start) + " → " + cutClock(range.end); }).slice(0, 3).join("; ") + (plan.ranges.length > 3 ? "…" : "") + "), останется " + cutClock(plan.remainder) + ".";
    var requested = window.CutCore.removedSeconds(window.CutCore.normalizeRanges(cut.ranges, plan.duration));
    if (!plan.precise && Math.abs(removed - requested) >= 0.05) text += " Отмечено " + cutClock(requested) + ": без перекодирования конец сдвинут к ключевому кадру. Для точной границы включите «Точно».";
    if (plan.skipped.length) text += " Пропущено фрагментов: " + plan.skipped.length + " (после них нет ключевых кадров) — включите «Точно».";
    return text;
  }
  function scheduleCutPlan(tab) {
    var cut = cutModel(tab);
    clearTimeout(cut.planTimer);
    cut.plan = null; cut.planError = "";
    var token = ++cut.planToken;
    updateCutInfo(tab);
    if (!cut.ranges.length) return;
    cut.planTimer = setTimeout(async function() {
      var result = await window.folderVideo.planCut(tab.video.path, cut.ranges, cut.precise);
      if (token !== cut.planToken) return;
      if (result && result.plan) cut.plan = result.plan; else cut.planError = (result && result.error) || "Не удалось проверить границы.";
      updateCutInfo(tab);
    }, 250);
  }
  function updateCutInfo(tab) {
    var info = $("#cutInfo");
    if (info) info.textContent = cutInfoText(tab);
    var run = $("#cutRun");
    if (run) { var cut = cutModel(tab); run.disabled = !cut.ranges.length || Boolean(state.cutJob); run.title = "Вырезать отмеченные фрагменты" + (cut.ranges.length ? " (" + cut.ranges.length + ")" : "") + " (X)"; run.setAttribute("aria-label", run.title); }
  }
  function placeCutPlayhead(tab, player) {
    var head = $("#cutPlayhead");
    if (!head || !tab.cut || !tab.cut.view) return;
    var position = cutPos(player.currentTime || 0, tab.cut.view);
    head.style.display = position < 0 || position > 100 ? "none" : "";
    head.style.left = position + "%";
  }
  // При воспроизведении окно следует за текущим моментом.
  function updateCutPlayhead(tab, player) {
    var cut = tab.cut;
    if (!cut || !cut.open || !cut.view || !Number.isFinite(player.duration) || player.duration <= 0) return;
    var time = player.currentTime || 0;
    if (!cut.dragging && (time < cut.view.start || time > cut.view.start + cut.view.span)) {
      cut.view = window.CutCore.revealView(cut.view, time, player.duration);
      renderCutBar(tab, player);
      return;
    }
    placeCutPlayhead(tab, player);
  }
  function setCutRangeStyle(element, range, view) {
    var box = cutRangeBox(range, view);
    if (!box) { element.style.display = "none"; return; }
    element.style.display = ""; element.style.left = box.left + "%"; element.style.width = box.width + "%";
    element.classList.toggle("is-clipped-start", box.clipStart); element.classList.toggle("is-clipped-end", box.clipEnd);
  }
  function zoomCutBar(tab, player, factor, anchor) {
    var cut = cutModel(tab);
    if (!cut.open || !Number.isFinite(player.duration) || player.duration <= 0) return;
    var view = cutView(tab, player);
    var time = player.currentTime || 0;
    var focus = anchor !== undefined ? anchor : (time >= view.start && time <= view.start + view.span ? time : view.start + view.span / 2);
    cut.view = window.CutCore.zoomView(view, factor, focus, player.duration);
    renderCutBar(tab, player);
  }
  function zoomCutToRange(tab, player) {
    var cut = cutModel(tab);
    var target = cut.ranges.length ? { start: cut.ranges[0].start, end: cut.ranges[cut.ranges.length - 1].end } : cut.pendingStart !== null ? { start: Math.min(cut.pendingStart, player.currentTime), end: Math.max(cut.pendingStart, player.currentTime) } : null;
    if (!target || target.end <= target.start) { zoomCutBar(tab, player, 0.25); return; }
    cut.view = window.CutCore.viewForRange(target.start, target.end, player.duration);
    renderCutBar(tab, player);
  }
  // Звуковая волна: пики считает main (ffmpeg), здесь они только рисуются на canvas под диапазонами.
  function ensureCutWave(tab, player) {
    var cut = tab.cut;
    if (cut.wave) return;
    cut.wave = { status: "loading" };
    var filePath = tab.video.path;
    window.folderVideo.loadWaveform(filePath).then(function(result) {
      if (!tab.cut || tab.video.path !== filePath) return;
      if (result && result.peaks) {
        var peaks = new Int8Array(result.peaks.buffer, result.peaks.byteOffset, result.peaks.length);
        tab.cut.wave = { status: "ready", peaks: peaks, binsPerSecond: result.binsPerSecond, gain: window.WaveformCore.peakGain(peaks) };
      } else tab.cut.wave = { status: result && result.none ? "none" : "error" };
      var current = $("#player");
      if (active() === tab && current) renderCutBar(tab, current);
    }).catch(function() { if (tab.cut) tab.cut.wave = { status: "error" }; });
  }
  function drawCutWave(tab) {
    var canvas = $("#cutWave");
    var cut = tab.cut;
    if (!canvas || !cut || !cut.view) return;
    var wave = cut.wave;
    canvas.style.display = wave && wave.status === "ready" ? "" : "none";
    if (!wave || wave.status !== "ready") return;
    var ratio = window.devicePixelRatio || 1;
    var width = Math.max(1, Math.round(canvas.clientWidth * ratio)); var height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    canvas.width = width; canvas.height = height;
    var context = canvas.getContext("2d");
    var columns = window.WaveformCore.waveformColumns(wave.peaks, wave.binsPerSecond, cut.view.start, cut.view.span / width, width);
    var middle = height / 2; var amplitude = middle - 2 * ratio;
    context.fillStyle = document.body.classList.contains("light") ? "#7655cc" : "#8f7bd6";
    for (var x = 0; x < width; x++) {
      var top = middle - columns.max[x] * wave.gain * amplitude / 127;
      var bottom = middle - columns.min[x] * wave.gain * amplitude / 127;
      context.fillRect(x, Math.min(top, middle - 0.5), 1, Math.max(1, bottom - top));
    }
  }
  function renderCutBar(tab, player) {
    var stage = $(".video-stage");
    var existing = $("#cutBar");
    var cut = tab.cut;
    if (!stage) return;
    if (!cut || !cut.open || !Number.isFinite(player.duration) || player.duration <= 0) {
      if (existing) existing.remove();
      stage.classList.remove("has-cut-bar");
      return;
    }
    var duration = player.duration;
    var view = cutView(tab, player);
    ensureCutWave(tab, player);
    var bar = existing;
    if (!bar) { bar = document.createElement("div"); bar.id = "cutBar"; bar.className = "cut-bar"; $(".video-switcher").before(bar); }
    stage.classList.add("has-cut-bar");
    var ranges = cut.ranges.map(function(range, index) {
      var box = cutRangeBox(range, view);
      if (!box) return "";
      return '<div class="cut-range' + (box.clipStart ? " is-clipped-start" : "") + (box.clipEnd ? " is-clipped-end" : "") + '" style="left:' + box.left + '%;width:' + box.width + '%" data-index="' + index + '"><span class="cut-handle is-start" data-index="' + index + '" data-edge="start" tabindex="0" role="slider" title="Начало фрагмента: ' + cutClock(range.start) + '" aria-label="Начало фрагмента ' + (index + 1) + '" aria-valuemin="0" aria-valuemax="' + Math.round(duration) + '" aria-valuenow="' + Math.round(range.start) + '"></span><span class="cut-handle is-end" data-index="' + index + '" data-edge="end" tabindex="0" role="slider" title="Конец фрагмента: ' + cutClock(range.end) + '" aria-label="Конец фрагмента ' + (index + 1) + '" aria-valuemin="0" aria-valuemax="' + Math.round(duration) + '" aria-valuenow="' + Math.round(range.end) + '"></span></div>';
    }).join("");
    var pendingPosition = cut.pendingStart !== null ? cutPos(cut.pendingStart, view) : -1;
    var pending = pendingPosition >= 0 && pendingPosition <= 100 ? '<div class="cut-pending" style="left:' + pendingPosition + '%" title="Начало: ' + cutClock(cut.pendingStart) + '"></div>' : "";
    var chips = cut.ranges.map(function(range, index) {
      return '<span class="cut-chip"><button type="button" class="cut-chip-seek" data-seek="' + index + '" title="Перейти к началу фрагмента" aria-label="Перейти к началу фрагмента ' + (index + 1) + '">' + cutClock(range.start) + ' → ' + cutClock(range.end) + '</button><button type="button" class="cut-chip-remove" data-remove="' + index + '" title="Убрать фрагмент" aria-label="Убрать фрагмент ' + (index + 1) + '">✕</button></span>';
    }).join("");
    var icon = function(paths) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>'; };
    var lens = '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>';
    var waveLayer = '<canvas id="cutWave" class="cut-wave" aria-hidden="true"></canvas>' + (!cut.wave || cut.wave.status === "loading" ? '<span class="cut-wave-note">Строю звуковую волну…</span>' : "");
    bar.innerHTML = '<div class="cut-trackrow"><div id="cutTrack" class="cut-track" role="group" aria-label="Полоса фрагментов для вырезки">' + waveLayer + ranges + pending + '<div id="cutPlayhead" class="cut-playhead"></div></div>' +
      '<div class="cut-zoom"><button type="button" id="cutZoomOut" class="cut-icon" title="Отдалить (−)" aria-label="Отдалить">' + icon(lens + '<path d="M8 11h6"/>') + '</button><button type="button" id="cutZoomIn" class="cut-icon" title="Приблизить (+, Ctrl+колесо)" aria-label="Приблизить">' + icon(lens + '<path d="M11 8v6M8 11h6"/>') + '</button><button type="button" id="cutZoomRange" class="cut-icon" title="Приблизить к выборке" aria-label="Приблизить к выборке">' + icon('<path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/><path d="M9 12h6"/>') + '</button><button type="button" id="cutZoomFit" class="cut-icon" title="Показать весь ролик" aria-label="Показать весь ролик">' + icon('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>') + '</button></div></div>' +
      '<div class="cut-scale" aria-hidden="true"><span>' + cutClock(view.start) + '</span><span>окно ' + cutClock(view.span) + '</span><span>' + cutClock(view.start + view.span) + '</span></div>' +
      '<div class="cut-controls"><button type="button" id="cutMarkStart" class="cut-icon" title="Начало фрагмента (I)" aria-label="Начало фрагмента">' + icon('<path d="M8 4H5v16h3M10 12h9M15 8l4 4-4 4"/>') + '</button><button type="button" id="cutMarkEnd" class="cut-icon" title="Конец фрагмента (O)" aria-label="Конец фрагмента">' + icon('<path d="M16 4h3v16h-3M14 12H5M9 8l-4 4 4 4"/>') + '</button><span class="cut-chips">' + chips + '</span>' +
      '<button type="button" id="cutPreview" class="cut-icon" title="Проиграть место склейки" aria-label="Проиграть место склейки"' + (cut.ranges.length ? "" : " disabled") + '>' + icon('<path d="M7 5v14l12-7z"/>') + '</button>' +
      '<label class="cut-precise" title="Перекодировать для точности до кадра: медленнее, но границы ровно там, где отмечены"><input type="checkbox" id="cutPrecise"' + (cut.precise ? " checked" : "") + ' aria-label="Точно (перекодировать)"> Точно</label>' +
      '<button type="button" id="cutRun" class="cut-run cut-icon" title="Вырезать отмеченные фрагменты (X)" aria-label="Вырезать отмеченные фрагменты">' + icon('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>') + '</button><button type="button" id="cutClose" title="Закрыть панель вырезки" aria-label="Закрыть панель вырезки">✕</button></div>' +
      '<div id="cutInfo" class="cut-info" role="status"></div>';
    updateCutInfo(tab); placeCutPlayhead(tab, player); drawCutWave(tab);
    $("#cutMarkStart").addEventListener("click", function() { cutMarkStart(tab, player); });
    $("#cutMarkEnd").addEventListener("click", function() { cutMarkEnd(tab, player); });
    $("#cutPreview").addEventListener("click", function() { previewCut(tab, player); });
    $("#cutRun").addEventListener("click", function() { runCut(tab, player); });
    $("#cutClose").addEventListener("click", function() { cut.open = false; renderCutBar(tab, player); });
    $("#cutZoomOut").addEventListener("click", function() { zoomCutBar(tab, player, 2); });
    $("#cutZoomIn").addEventListener("click", function() { zoomCutBar(tab, player, 0.5); });
    $("#cutZoomRange").addEventListener("click", function() { zoomCutToRange(tab, player); });
    $("#cutZoomFit").addEventListener("click", function() { cut.view = window.CutCore.fullView(duration); renderCutBar(tab, player); });
    $("#cutPrecise").addEventListener("change", function(event) { cut.precise = event.target.checked; try { localStorage.setItem("folder-video-cut-precise", String(cut.precise)); } catch (error) {} event.target.blur(); scheduleCutPlan(tab); });
    bar.querySelectorAll("[data-seek]").forEach(function(button) { button.addEventListener("click", function() { var start = cut.ranges[Number(button.dataset.seek)].start; player.currentTime = start; cut.view = window.CutCore.revealView(cutView(tab, player), start, duration); renderCutBar(tab, player); }); });
    bar.querySelectorAll("[data-remove]").forEach(function(button) { button.addEventListener("click", function() { cut.ranges.splice(Number(button.dataset.remove), 1); renderCutBar(tab, player); scheduleCutPlan(tab); }); });
    bar.querySelectorAll(".cut-handle").forEach(function(handle) {
      handle.addEventListener("keydown", function(event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); event.stopPropagation();
        var range = cut.ranges[Number(handle.dataset.index)]; var edge = handle.dataset.edge;
        var next = range[edge] + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : CUT_FRAME_STEP);
        range[edge] = edge === "start" ? Math.max(0, Math.min(next, range.end - CUT_MIN_HANDLE_GAP)) : Math.min(duration, Math.max(next, range.start + CUT_MIN_HANDLE_GAP));
        player.currentTime = range[edge];
        cut.view = window.CutCore.revealView(cutView(tab, player), range[edge], duration);
        renderCutBar(tab, player); scheduleCutPlan(tab);
        var again = bar.querySelector('.cut-handle[data-index="' + handle.dataset.index + '"][data-edge="' + edge + '"]'); if (again) again.focus();
      });
    });
    var track = $("#cutTrack"); var drag = null;
    if (window.ResizeObserver) new ResizeObserver(function() { drawCutWave(tab); }).observe(track);
    function timeAt(event) { var rect = track.getBoundingClientRect(); return Math.max(0, Math.min(duration, view.start + (event.clientX - rect.left) / rect.width * view.span)); }
    track.addEventListener("wheel", function(event) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoomCutBar(tab, player, event.deltaY > 0 ? 1.25 : 0.8, timeAt(event));
      else { cut.view = window.CutCore.clampView({ start: view.start + ((event.deltaY || event.deltaX) > 0 ? 1 : -1) * view.span * 0.15, span: view.span }, duration); renderCutBar(tab, player); }
    }, { passive: false });
    track.addEventListener("pointerdown", function(event) {
      track.setPointerCapture(event.pointerId);
      var handle = event.target instanceof Element ? event.target.closest(".cut-handle") : null;
      drag = handle ? { index: Number(handle.dataset.index), edge: handle.dataset.edge } : { scrub: true };
      cut.dragging = true;
      if (drag.scrub) player.currentTime = timeAt(event);
    });
    track.addEventListener("pointermove", function(event) {
      if (!drag) return;
      var time = timeAt(event);
      if (drag.scrub) { player.currentTime = time; placeCutPlayhead(tab, player); return; }
      var range = cut.ranges[drag.index];
      range[drag.edge] = drag.edge === "start" ? Math.min(time, range.end - CUT_MIN_HANDLE_GAP) : Math.max(time, range.start + CUT_MIN_HANDLE_GAP);
      setCutRangeStyle(track.querySelector('.cut-range[data-index="' + drag.index + '"]'), range, view);
      player.currentTime = range[drag.edge]; placeCutPlayhead(tab, player);
    });
    function finishDrag() {
      if (!drag) return;
      var wasHandle = !drag.scrub; drag = null; cut.dragging = false;
      if (wasHandle) { cut.ranges = window.CutCore.normalizeRanges(cut.ranges, duration); renderCutBar(tab, player); scheduleCutPlan(tab); }
    }
    track.addEventListener("pointerup", finishDrag); track.addEventListener("pointercancel", finishDrag);
  }
  function cutMarkStart(tab, player) {
    if (!Number.isFinite(player.duration) || player.duration <= 0) { notice("Дождитесь загрузки длительности видео."); return; }
    var cut = cutModel(tab); cut.open = true; cut.pendingStart = player.currentTime;
    renderCutBar(tab, player); updateCutInfo(tab);
  }
  function cutMarkEnd(tab, player) {
    if (!Number.isFinite(player.duration) || player.duration <= 0) { notice("Дождитесь загрузки длительности видео."); return; }
    var cut = cutModel(tab);
    var from = cut.pendingStart === null ? 0 : cut.pendingStart;
    var start = Math.min(from, player.currentTime); var end = Math.max(from, player.currentTime);
    if (end - start < window.CutCore.MIN_RANGE_SECONDS) { notice("Конец должен быть позже начала."); return; }
    cut.ranges = window.CutCore.normalizeRanges(cut.ranges.concat([{ start: start, end: end }]), player.duration);
    cut.pendingStart = null; cut.open = true;
    renderCutBar(tab, player); scheduleCutPlan(tab);
  }
  function toggleCutBar(tab, player) {
    var cut = cutModel(tab); cut.open = !cut.open;
    renderCutBar(tab, player);
  }
  function previewCut(tab, player) {
    var cut = cutModel(tab);
    if (!cut.ranges.length) return;
    var range = cut.plan && cut.plan.ranges.length ? cut.plan.ranges[0] : cut.ranges[0];
    var context = 3;
    var jumped = false;
    var token = {};
    state.cutPreview = token;
    player.currentTime = Math.max(0, range.start - context);
    player.play().catch(function() {});
    (function watch() {
      if (state.cutPreview !== token || !document.body.contains(player)) return;
      var time = player.currentTime;
      if (!jumped && time >= range.start && time < range.end) { jumped = true; player.currentTime = range.end; }
      else if (jumped && time >= range.end + context) { player.pause(); state.cutPreview = null; return; }
      if (player.paused && !jumped && time > range.end) { state.cutPreview = null; return; }
      requestAnimationFrame(watch);
    })();
  }
  function showCutOverlay(tab) {
    var stage = $(".video-stage");
    var job = state.cutJob;
    if (!stage || !job || job.filePath !== tab.video.path) return;
    var overlay = document.createElement("div");
    overlay.id = "cutOverlay"; overlay.className = "cut-overlay"; overlay.setAttribute("role", "status");
    overlay.innerHTML = '<div class="cut-overlay-box"><div id="cutOverlayText" class="cut-overlay-text"></div><div class="cut-overlay-track"><div id="cutOverlayBar" class="cut-overlay-bar"></div></div><button type="button" id="cutOverlayCancel" title="Отменить вырезку" aria-label="Отменить вырезку">Отмена</button></div>';
    stage.appendChild(overlay);
    $("#cutOverlayCancel").addEventListener("click", function() { window.folderVideo.cancelCut(job.operationId); });
    updateCutOverlay();
  }
  function updateCutOverlay() {
    var job = state.cutJob; var text = $("#cutOverlayText"); var bar = $("#cutOverlayBar");
    if (!job || !text || !bar) return;
    text.textContent = (job.precise ? "Вырезаю с перекодированием… " : "Вырезаю… ") + Math.round(job.progress) + "%";
    bar.style.width = job.progress + "%";
  }
  window.folderVideo.onCutProgress(function(progress) {
    if (!state.cutJob || progress.operationId !== state.cutJob.operationId) return;
    state.cutJob.progress = progress.percent;
    updateCutOverlay();
  });
  function replaceVideoItem(video) {
    var index = state.files.findIndex(function(file) { return file.path === video.path; });
    if (index === -1) state.files.push(video); else state.files[index] = video;
  }
  async function runCut(tab, player) {
    var cut = cutModel(tab);
    if (!cut.ranges.length) { notice("Отметьте фрагмент: I — начало, O — конец."); return; }
    if (state.cutJob) { notice("Вырезка уже выполняется."); return; }
    var problem = window.CutCore.validateCut(cut.ranges, player.duration);
    if (problem) { notice(problem); return; }
    await flushPlayerNotes(tab);
    var filePath = tab.video.path;
    var ranges = cut.ranges.map(function(range) { return { start: range.start, end: range.end }; });
    var job = { operationId: "cut-" + Date.now() + "-" + Math.random().toString(16).slice(2), filePath: filePath, progress: 0, precise: cut.precise };
    state.cutJob = job;
    state.cutPreview = null;
    releasePlayerResources(tab.video.url);
    updateCutInfo(tab);
    showCutOverlay(tab);
    var result = await window.folderVideo.startCut(filePath, job.operationId, ranges, cut.precise);
    state.cutJob = null;
    var tabs = state.tabs.filter(function(item) { return item.type === "player" && item.video.path === filePath; });
    if (!result || result.canceled) { notice("Вырезка отменена", true); if (active() === tab) renderPlayer(tab); return; }
    if (result.error) {
      notice("Не удалось вырезать: " + (result.code === "ENOENT" ? "FFmpeg не найден в PATH." : result.error)); if (active() === tab) renderPlayer(tab); return;
    }
    var video = await window.folderVideo.readVideo(result.outputPath);
    if (!video) { notice("Вырезка сделана, но не удалось открыть файл."); if (active() === tab) renderPlayer(tab); return; }
    var removed = window.CutCore.removedSeconds(result.ranges);
    if (!result.replaced) {
      replaceVideoItem(video);
      cut.ranges = []; cut.pendingStart = null; cut.plan = null;
      notice("Сохранено: " + video.name + " (удалено " + cutClock(removed) + ")", true);
      if (active() === tab) renderPlayer(tab);
      return;
    }
    replaceVideoItem(video);
    var seam = result.ranges[0].start;
    tabs.forEach(function(item) { setPlayerVideo(item, video); item.currentTime = item === tab ? seam : 0; });
    state.cutUndo.push({ undoId: result.undoId, filePath: filePath });
    notice("Вырезано " + cutClock(removed) + ". Отменить — клик или Ctrl+Z", true, function() { undoLastCut(); }, "Отменить вырезку");
    render();
  }
  async function undoLastCut() {
    var entry = state.cutUndo.pop();
    if (!entry) { notice("Нет вырезок для отмены.", true); return; }
    if (!await undoCutEntry(entry)) state.cutUndo.push(entry);
  }
  async function undoCutEntry(entry) {
    if (state.cutJob) { notice("Дождитесь окончания вырезки."); return false; }
    var tabs = state.tabs.filter(function(item) { return item.type === "player" && item.video.path === entry.filePath; });
    await Promise.all(tabs.map(flushPlayerNotes));
    tabs.forEach(function(item) { releasePlayerResources(item.video.url); });
    var result = await window.folderVideo.undoCut(entry.undoId);
    if (!result || result.error) { notice("Не удалось отменить: " + ((result && result.error) || "неизвестная ошибка")); render(); return false; }
    var video = await window.folderVideo.readVideo(entry.filePath);
    if (video) { replaceVideoItem(video); tabs.forEach(function(item) { setPlayerVideo(item, video); }); }
    notice("Вырезка отменена, оригинал восстановлен", true);
    render();
    return true;
  }
  function keyboardPlayer(event, tab, player) {
    if (active().id !== tab.id || ["SELECT", "INPUT", "TEXTAREA"].indexOf(document.activeElement.tagName) !== -1) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.code === "KeyZ") { event.preventDefault(); undoLastCut(); return; }
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!event.repeat && event.code === "KeyI") { event.preventDefault(); cutMarkStart(tab, player); return; }
      if (!event.repeat && event.code === "KeyO") { event.preventDefault(); cutMarkEnd(tab, player); return; }
      if (!event.repeat && event.code === "KeyX") { event.preventDefault(); runCut(tab, player); return; }
      if (event.code === "Comma" || event.code === "Period") {
        event.preventDefault(); player.pause();
        player.currentTime = Math.max(0, Math.min(player.duration || 0, player.currentTime + (event.code === "Comma" ? -CUT_FRAME_STEP : CUT_FRAME_STEP)));
        return;
      }
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && tab.cut && tab.cut.open) {
      if (event.code === "Equal" || event.code === "NumpadAdd") { event.preventDefault(); zoomCutBar(tab, player, 0.5); return; }
      if (event.code === "Minus" || event.code === "NumpadSubtract") { event.preventDefault(); zoomCutBar(tab, player, 2); return; }
    }
    var step = tab.seconds; var target = null;
    if (event.key === " ") {
      if (event.repeat) { event.preventDefault(); return; }
      if (event.target instanceof Element && event.target.closest("button, a, [role='button'], video")) return;
      event.preventDefault();
      player.paused ? player.play().catch(function() {}) : player.pause();
    }
    if (event.key === "ArrowLeft") target = player.currentTime - step;
    if (event.key === "ArrowRight") target = player.currentTime + step;
    if (event.key === "Home") target = 0;
    if (event.key === "End") target = player.duration;
    if (target !== null) { event.preventDefault(); player.currentTime = Math.max(0, Math.min(player.duration, target)); }
  }
  async function renderFrameGrid(tab, player) {
    var duration = player.duration; var count = Math.ceil(duration / tab.seconds); var grid = $("#frameGrid");
    grid.style.gridTemplateColumns = "repeat(" + tab.columns + ", minmax(0, 1fr))";
    var framesHtml = "";
    for (var fi = 0; fi < count; fi++) {
      framesHtml += "<button class=\"frame\" data-time=\"" + Math.min(duration, fi * tab.seconds) + "\"><span class=\"time\">" + formatTime(fi * tab.seconds) + "</span></button>";
    }
    grid.innerHTML = framesHtml + "<div id=\"playMarker\" class=\"play-marker\" aria-hidden=\"true\"></div>";
    setupGridInteraction(tab, player);
    startMarkerLoop(tab, player);
    updateActiveFrame(player.currentTime, tab, true);
    var taskId = ++state.task; var cacheKey = fileKey(tab.video);
    var frames = state.frameCache.get(cacheKey);
    if (!frames) { frames = new Map(); state.frameCache.set(cacheKey, frames); }
    var cells = [].concat(Array.from(grid.querySelectorAll(".frame")));
    var missing = [];
    for (var ci = 0; ci < cells.length; ci++) {
      if (taskId !== state.task || active().id !== tab.id) return;
      var cell = cells[ci];
      var time = Number(cell.dataset.time); var image = frames.get(time);
      if (image) applyFrameImage(cell, image);
      else missing.push({ cell: cell, time: time });
    }
    if (!missing.length) return;
    await captureGridFrames(tab.video.url, missing, function(item, image) {
      if (taskId !== state.task || active().id !== tab.id) return false;
      if (image) {
        frames.set(item.time, image);
        applyFrameImage(item.cell, image);
      }
      return true;
    });
  }

  function applyFrameImage(cell, image) {
    if (!image || !cell.isConnected) return;
    if (cell.querySelector("img")) return;
    cell.classList.add("ready");
    cell.insertAdjacentHTML("afterbegin", "<img src=\"" + image + "\" alt=\"Кадр " + formatTime(Number(cell.dataset.time)) + "\" />");
  }

  function setupGridInteraction(tab, player) {
    var grid = $("#frameGrid");
    var marker = $("#playMarker");
    if (!grid || !marker) return;

    function seekFromPointer(event) {
      var frames = [].concat(Array.from(grid.querySelectorAll(".frame")));
      if (!frames.length) return;
      var rect = grid.getBoundingClientRect();
      var style = getComputedStyle(grid);
      var columnGap = parseFloat(style.columnGap) || 0;
      var rowGap = parseFloat(style.rowGap) || 0;
      var cellWidth = frames[0].offsetWidth;
      var cellHeight = frames[0].offsetHeight;
      var x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      var y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      var row = Math.max(0, Math.floor(y / (cellHeight + rowGap)));
      var column = Math.max(0, Math.min(tab.columns - 1, Math.floor(x / (cellWidth + columnGap))));
      var index = Math.min(frames.length - 1, row * tab.columns + column);
      var frame = frames[index];
      var fraction = Math.max(0, Math.min(1, (x - frame.offsetLeft) / frame.offsetWidth));
      player.currentTime = Math.max(0, Math.min(player.duration, (index + fraction) * tab.seconds));
      tab.currentTime = player.currentTime;
      updateActiveFrame(player.currentTime, tab, false);
    }

    function finishDrag(event) {
      if (!tab.isDragging) return;
      tab.isDragging = false;
      marker.classList.remove("dragging");
      if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId);
      updateActiveFrame(player.currentTime, tab, true);
    }

    grid.addEventListener("pointerdown", function(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      tab.isDragging = true;
      marker.classList.add("dragging");
      grid.setPointerCapture(event.pointerId);
      seekFromPointer(event);
    });
    grid.addEventListener("pointermove", function(event) {
      if (!tab.isDragging) return;
      event.preventDefault();
      seekFromPointer(event);
    });
    grid.addEventListener("pointerup", finishDrag);
    grid.addEventListener("pointercancel", finishDrag);
  }

  function startMarkerLoop(tab, player) {
    var loopId = (tab.markerLoopId || 0) + 1;
    tab.markerLoopId = loopId;
    function tick() {
      if (tab.markerLoopId !== loopId || !player.isConnected || (active() ? active().id : null) !== tab.id) return;
      if (!tab.isDragging) updateActiveFrame(player.currentTime, tab, false);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function updateActiveFrame(time, tab, shouldScroll) {
    var grid = $("#frameGrid"); if (!grid || (active() ? active().id : null) !== tab.id) return;
    var frames = [].concat(Array.from(grid.querySelectorAll(".frame")));
    var rawIndex = time / tab.seconds;
    var index = Math.min(frames.length - 1, Math.floor(rawIndex)); var frame = frames[index];
    var fraction = Math.max(0, Math.min(1, rawIndex - index));
    if (!frame) return;
    var previous = grid.querySelector(".frame.active");
    if (previous !== frame) { if (previous) previous.classList.remove("active"); frame.classList.add("active"); }
    var marker = $("#playMarker");
    if (marker) {
      marker.style.setProperty("--marker-x", Math.round(frame.offsetLeft + frame.offsetWidth * fraction) + "px");
      marker.style.setProperty("--marker-y", Math.round(frame.offsetTop + frame.offsetHeight / 2) + "px");
    }
    if (shouldScroll && tab.scroll !== "off" && tab.lastScrollIndex !== index && !isFrameVisible(frame)) {
      frame.scrollIntoView({ block: tab.scroll === "center" ? "center" : "nearest", behavior: "auto" });
      tab.lastScrollIndex = index;
    }
  }

  function isFrameVisible(frame) {
    var scroller = $("#gridScroll");
    if (!scroller) return true;
    var frameRect = frame.getBoundingClientRect();
    var scrollRect = scroller.getBoundingClientRect();
    return frameRect.top >= scrollRect.top && frameRect.bottom <= scrollRect.bottom;
  }

  async function captureFrames(url, duration, count, shouldContinue, onFrame) {
    var times = [];
    var lastFrameTime = Math.max(0, duration - 0.1);
    for (var fi = 0; fi < count; fi++) {
      times.push(Math.min(lastFrameTime, duration * fi / Math.max(1, count - 1)));
    }
    return captureFrameTimes(url, times, function(image, index) {
      if (onFrame) onFrame(image, index, times[index]);
    }, shouldContinue);
  }
  async function captureGridFrames(url, items, onFrame) {
    var workers = [[], []];
    items.forEach(function(item, index) { workers[index % workers.length].push(item); });
    await Promise.all(workers.filter(function(workerItems) { return workerItems.length; }).map(function(workerItems) {
      return captureFrameTimes(url, workerItems.map(function(item) { return item.time; }), function(image, index) {
        return onFrame(workerItems[index], image);
      });
    }));
  }
  async function captureFrameTimes(url, times, onFrame, shouldContinue) {
    var frames = [];
    if (!times.length) return frames;
    var video = document.createElement("video");
    var captureVideos = state.captureVideos.get(url);
    if (!captureVideos) { captureVideos = new Set(); state.captureVideos.set(url, captureVideos); }
    captureVideos.add(video);
    var canvas = document.createElement("canvas");
    try {
      if (shouldContinue && !shouldContinue()) return null;
      await loadCaptureVideo(video, url);
      for (var fi = 0; fi < times.length; fi++) {
        if (shouldContinue && !shouldContinue()) {
          frames.forEach(function(frame) { if (frame) URL.revokeObjectURL(frame); });
          return null;
        }
        var frame = await captureFrameFromVideo(video, canvas, times[fi]);
        if (shouldContinue && !shouldContinue()) {
          if (frame) URL.revokeObjectURL(frame);
          frames.forEach(function(previousFrame) { if (previousFrame) URL.revokeObjectURL(previousFrame); });
          return null;
        }
        frames.push(frame);
        if (onFrame && onFrame(frame, fi) === false) break;
      }
    } finally {
      var activeCaptures = state.captureVideos.get(url);
      if (activeCaptures) {
        activeCaptures.delete(video);
        if (!activeCaptures.size) state.captureVideos.delete(url);
      }
      releaseVideoElement(video);
      video.remove();
    }
    return frames;
  }
  function captureFrame(url, time) {
    return captureFrameTimes(url, [time]).then(function(frames) { return frames[0] || null; });
  }
  async function captureMiddleFrame(url) {
    var video = document.createElement("video");
    var captureVideos = state.captureVideos.get(url);
    if (!captureVideos) { captureVideos = new Set(); state.captureVideos.set(url, captureVideos); }
    captureVideos.add(video);
    var canvas = document.createElement("canvas");
    try {
      if (!await loadCaptureVideo(video, url) || !Number.isFinite(video.duration) || video.duration <= 0) return null;
      return await captureFrameFromVideo(video, canvas, Math.max(0, video.duration / 2));
    } finally {
      captureVideos.delete(video);
      if (!captureVideos.size) state.captureVideos.delete(url);
      releaseVideoElement(video);
      video.remove();
    }
  }
  function loadCaptureVideo(video, url) { return new Promise(function(resolve) {
    var done = false; var timeout = setTimeout(function() { finish(false); }, 9000);
    function finish(ok) { if (done) return; done = true; clearTimeout(timeout); video.onloadedmetadata = null; video.onloadeddata = null; video.onerror = null; resolve(ok); }
    video.muted = true; video.preload = "auto";
    // Metadata достаточно, чтобы выставить currentTime; сам кадр дожидаемся
    // в captureFrameFromVideo перед drawImage().
    video.onloadedmetadata = function() { finish(true); };
    video.onerror = function() { finish(false); };
    video.src = url; video.load();
  }); }
  function captureFrameFromVideo(video, canvas, time) { return new Promise(function(resolve) {
    if (!Number.isFinite(video.duration) || !video.duration) { resolve(null); return; }
    var done = false;
    var timeout = setTimeout(function() { finish(null); }, 9000);
    function finish(value) { if (done) return; done = true; clearTimeout(timeout); video.onseeked = null; video.onerror = null; resolve(value); }
    function draw() {
      if (video.readyState < 2) {
        video.onloadeddata = draw;
        return;
      }
      try {
        canvas.width = 160; canvas.height = 90;
        canvas.getContext("2d").drawImage(video, 0, 0, 160, 90);
        canvas.toBlob(function(blob) { finish(blob ? URL.createObjectURL(blob) : null); }, "image/webp", 0.72);
      } catch (e) { finish(null); }
    }
    var target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.1)));
    video.onseeked = draw;
    video.onloadeddata = draw;
    video.onerror = function() { finish(null); };
    if (Math.abs(video.currentTime - target) < 0.02 && video.readyState >= 2) draw();
    else video.currentTime = target;
  }); }

  const startupReady = settingsReady.then(restoreSession).catch(function() { notice("Не удалось восстановить вкладки"); }).finally(function() { restoringSession = false; render(); });
  render();
})();
