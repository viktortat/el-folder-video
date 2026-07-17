(() => {
  "use strict";

  const STRIP_COUNT = 10;
  const thumbnailQueue = new ThumbnailQueue(2);
  const supported = "MP4, WebM, MOV, AVI, MKV, M4V, OGV";
  const DEFAULT_SETTINGS = { version: 1, theme: "dark", storage: { metadataDirectory: "", gitRepositoryUrl: "" }, viewer: { columns: 3, seconds: 10, scroll: "center" }, interface: { metadataCollapsed: false, gridCollapsed: false } };
  const SETTINGS_FIELDS = [
    { group: "Хранилище", key: "storage.metadataDirectory", label: "Каталог метаданных", type: "text", hint: "JSON-файлы и template.html" },
    { group: "Хранилище", key: "storage.gitRepositoryUrl", label: "Git-репозиторий", type: "text", hint: "URL удалённого репозитория" },
    { group: "Просмотр видео", key: "viewer.columns", label: "Колонки кадров", type: "select", options: [3, 4, 5, 6, 8] },
    { group: "Просмотр видео", key: "viewer.seconds", label: "Шаг кадров", type: "select", options: [5, 10, 15, 30, 60], suffix: "секунд" },
    { group: "Просмотр видео", key: "viewer.scroll", label: "Автопрокрутка", type: "select", options: [{ value: "center", label: "По центру" }, { value: "edge", label: "До ближайшего края" }, { value: "off", label: "Выключена" }] },
    { group: "Интерфейс", key: "interface.metadataCollapsed", label: "Сворачивать панель метаданных", type: "checkbox" },
    { group: "Интерфейс", key: "interface.gridCollapsed", label: "Сворачивать панель кадров", type: "checkbox" }
  ];
  const state = {
    folderPath: "", files: [], skipped: 0, recursive: false, filterText: "", sort: "date", asc: false, page: 1, pageSize: 10,
    tabs: [{ id: "folder", type: "folder", label: "Видео" }], activeTab: "folder",
    stripCache: new Map(), stripPending: new Map(), frameCache: new Map(), durationCache: new Map(), task: 0, thumbnailGeneration: 0, thumbnailPriority: 0,
    recentFolders: JSON.parse(localStorage.getItem("folder-video-recent") || "[]"),
    pinnedFolders: JSON.parse(localStorage.getItem("folder-video-pinned") || "[]"),
    favorites: JSON.parse(localStorage.getItem("folder-video-favorites") || "[]"), favoritesOpen: false,
    speedUp: null,
    metadataCollapsed: false, gridCollapsed: false,
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  };
  const $ = selector => document.querySelector(selector);
  const view = $("#view");
  const tabsEl = $("#tabs");
  const toastEl = $("#toast");
  const themeToggle = $("#themeToggle");
  const favoritesButton = $("#favoritesButton");
  const settingsButton = $("#settingsButton");
  const appVersion = $("#appVersion");
  let toastTimer;
  let resizeTimer;

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
  function formatSize(bytes) { if (bytes < 1024) return bytes + " B"; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"; if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB"; return (bytes / 1073741824).toFixed(2) + " GB"; }
  function formatDate(value) { return new Date(value).toLocaleString([], { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  function formatTime(value) { if (!Number.isFinite(value)) return "—"; const h = Math.floor(value / 3600); const m = Math.floor((value % 3600) / 60); const s = Math.floor(value % 60); return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0"); }
  function notice(message, info) { if (info === undefined) info = false; toastEl.textContent = message; toastEl.className = "toast show" + (info ? " info" : ""); clearTimeout(toastTimer); toastTimer = setTimeout(function() { toastEl.className = "toast"; }, 3900); }
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
  function saveFavorites() { localStorage.setItem("folder-video-favorites", JSON.stringify(state.favorites)); }
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
  function renderFavoritesPanel() {
    closeFavorites(); state.favoritesOpen = true;
    var overlay = document.createElement("div");
    overlay.id = "favoritesOverlay"; overlay.className = "favorites-overlay";
    var items = state.favorites.map(function(video) {
      return "<li class=\"favorite-item\"><button class=\"favorite-open\" data-path=\"" + escapeHtml(video.path) + "\" title=\"Открыть видео\"><strong>" + escapeHtml(video.name) + "</strong><span>" + escapeHtml(video.path) + "</span></button><button class=\"favorite-remove\" data-path=\"" + escapeHtml(video.path) + "\" title=\"Удалить из избранного\" aria-label=\"Удалить из избранного\">♥</button></li>";
    }).join("");
    overlay.innerHTML = "<section class=\"favorites-panel\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Избранные видео\"><header><strong>Избранное</strong><span>" + state.favorites.length + "</span><button id=\"closeFavorites\" title=\"Закрыть избранное\" aria-label=\"Закрыть избранное\">×</button></header>" + (items ? "<ul>" + items + "</ul>" : "<p class=\"favorites-empty\">Пока нет добавленных видео.</p>") + "</section>";
    overlay.addEventListener("click", function(event) { if (event.target === overlay) closeFavorites(); });
    document.body.appendChild(overlay);
    $("#closeFavorites").addEventListener("click", closeFavorites);
    overlay.querySelectorAll(".favorite-remove").forEach(function(button) { button.addEventListener("click", function() { toggleFavorite({ path: button.dataset.path }); renderActiveView(); renderFavoritesPanel(); }); });
    overlay.querySelectorAll(".favorite-open").forEach(function(button) { button.addEventListener("click", function() { openFavorite(button.dataset.path); }); });
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
  settingsButton.addEventListener("click", openSettings);
  const homeButton = $("#homeButton");
  homeButton.addEventListener("click", function() {
    state.activeTab = null;
    render();
  });
  document.addEventListener("keydown", function(event) { if (event.key === "Escape") { if (state.favoritesOpen) closeFavorites(); closeCtxMenu(); } }); document.addEventListener("click", function() { closeCtxMenu(); });
  applyTheme("dark", false); updateFavoritesButton();
  window.folderVideo.getSettings().then(function(result) {
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
        : a.lastModified - b.lastModified;
      return state.asc ? result : -result;
    });
  }
  function filteredFiles() {
    var query = state.filterText.toLowerCase();
    return sortedFiles().filter(function(file) { return !query || file.name.toLowerCase().includes(query); });
  }

  /* context menu */
  var ctxMenu = null;
  function closeCtxMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }
  function showCtxMenu(event, filePath) {
    closeCtxMenu();
    var menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    menu.innerHTML = '<button data-action="copy">Копировать полный путь</button><div class="sep"></div><button data-action="move">Перенести в другую папку</button><button class="danger" data-action="delete">Удалить видео</button>';
    menu.querySelectorAll('button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        closeCtxMenu();
        if (btn.dataset.action === 'copy') {
          window.folderVideo.copyPath(filePath);
          notice('Путь скопирован в буфер обмена', true);
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
  async function moveFile(filePath) {
    var playerTab = active();
    var replacement = playerTab && playerTab.type === 'player' && playerTab.video.path === filePath
      ? adjacentPlayerVideo(playerTab, 1) || adjacentPlayerVideo(playerTab, -1)
      : null;
    var result = await window.folderVideo.moveFile(filePath);
    if (!result) return;
    if (result.canceled) return;
    if (result.error) { notice('Ошибка: ' + result.error); return; }
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
  async function deleteFile(filePath) {
    var playerTab = active();
    var replacement = playerTab && playerTab.type === 'player' && playerTab.video.path === filePath
      ? adjacentPlayerVideo(playerTab, 1) || adjacentPlayerVideo(playerTab, -1)
      : null;
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
  function render() { renderTabs(); renderActiveView(); }
  function renderTabs() {
    tabsEl.replaceChildren();
    for (var ti = 0; ti < state.tabs.length; ti++) {
      var tab = state.tabs[ti];
      var button = document.createElement("button");
      button.className = "tab" + (tab.id === state.activeTab ? " active" : "");
      var tabName = tab.type === "folder" ? "ВИДЕО" : tab.type === "settings" ? "НАСТРОЙКИ" : tab.video.name;
      button.innerHTML = "<span class=\"tab-dot\"></span><span class=\"tab-name\">" + escapeHtml(tabName) + "</span><span class=\"close-tab\" title=\"Закрыть вкладку\">×</span>";
      button.addEventListener("click", function(tid) {
        return function(event) {
          if (event.target.closest(".close-tab")) return closeTab(tid);
          state.activeTab = tid; render();
        };
      }(tab.id));
      tabsEl.appendChild(button);
    }
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
    var tab = state.tabs.find(function(item) { return item.type === "settings"; });
    if (!tab) { tab = { id: "settings", type: "settings", draft: clone(state.settings), dirty: false }; state.tabs.push(tab); }
    state.activeTab = tab.id; render();
  }
  function settingsControlMarkup(field, value) {
    if (field.type === "text") return "<input data-setting=\"" + field.key + "\" value=\"" + escapeHtml(value) + "\" />";
    if (field.type === "checkbox") return "<label class=\"settings-switch\"><input data-setting=\"" + field.key + "\" type=\"checkbox\"" + (value ? " checked" : "") + "/><span></span></label>";
    var options = field.options.map(function(option) { var item = typeof option === "object" ? option : { value: option, label: String(option) + (field.suffix ? " " + field.suffix : "") }; return "<option value=\"" + escapeHtml(item.value) + "\"" + (String(item.value) === String(value) ? " selected" : "") + ">" + escapeHtml(item.label) + "</option>"; }).join("");
    return "<select data-setting=\"" + field.key + "\">" + options + "</select>";
  }
  function renderSettings(tab) {
    var groups = SETTINGS_FIELDS.reduce(function(result, field) { (result[field.group] || (result[field.group] = [])).push(field); return result; }, {});
    var markup = Object.keys(groups).map(function(group) { return "<section class=\"settings-group\"><h2>" + escapeHtml(group) + "</h2>" + groups[group].map(function(field) { return "<label class=\"settings-row\"><span><strong>" + escapeHtml(field.label) + "</strong>" + (field.hint ? "<small>" + escapeHtml(field.hint) + "</small>" : "") + "</span>" + settingsControlMarkup(field, readSetting(tab.draft, field.key)) + "</label>"; }).join("") + "</section>"; }).join("");
    view.innerHTML = "<section class=\"settings-view\"><form id=\"settingsForm\"><header class=\"settings-head\"><div><p>Настройки</p><h1>Параметры приложения</h1></div><span>Изменения применяются после сохранения</span></header>" + markup + "<footer class=\"settings-footer\"><span id=\"settingsState\">" + (tab.dirty ? "Есть несохранённые изменения" : "Сохранено") + "</span><button id=\"resetSettings\" type=\"button\" class=\"settings-reset\">Сбросить</button><button type=\"submit\" class=\"primary\">Сохранить</button></footer></form></section>";
    $("#settingsForm").querySelectorAll("[data-setting]").forEach(function(control) { control.addEventListener("change", function() { var field = SETTINGS_FIELDS.find(function(item) { return item.key === control.dataset.setting; }); var value = field.type === "checkbox" ? control.checked : field.type === "select" && typeof readSetting(tab.draft, field.key) === "number" ? Number(control.value) : control.value; writeSetting(tab.draft, field.key, value); tab.dirty = true; $("#settingsState").textContent = "Есть несохранённые изменения"; }); });
    $("#resetSettings").addEventListener("click", async function() { if (!confirm("Сбросить настройки к значениям по умолчанию?")) return; var result = await window.folderVideo.getDefaultSettings(); tab.draft = result.settings; tab.dirty = true; renderSettings(tab); });
    $("#settingsForm").addEventListener("submit", function(event) { event.preventDefault(); saveSettingsTab(tab); });
  }
  async function saveSettingsTab(tab) {
    var switchingDatabase = tab.draft.storage.metadataDirectory !== state.settings.storage.metadataDirectory;
    var dirtyPlayers = state.tabs.filter(function(item) { return item.type === "player" && item.metadataDirty; });
    if (switchingDatabase && dirtyPlayers.length && !confirm("В открытых вкладках есть несохранённые метаданные. Сменить каталог без сохранения?")) return;
    var result = await window.folderVideo.saveSettings(tab.draft);
    if (result.error) { notice(result.error); return; }
    state.settings = result.settings; state.metadataCollapsed = state.settings.interface.metadataCollapsed; state.gridCollapsed = state.settings.interface.gridCollapsed; applyTheme(state.settings.theme, false);
    tab.draft = clone(state.settings); tab.dirty = false;
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
    return "<div class=\"empty\"><div class=\"empty-inner home-panel\"><div class=\"empty-icon\"><img src=\"assets/folder-video.png\" alt=\"\" /></div><p class=\"home-kicker\">Folder-video</p><strong>Быстрый обзор больших видеопапок без импорта и лишней суеты</strong><small>Локальный видеобраузер с покадровой сеткой, точным переходом по таймлайну и удобным отбором роликов прямо из папки.</small><div class=\"home-points\"><span>Кадры по всей длине видео</span><span>Мгновенный переход к сцене</span><span>Файлы остаются локально</span></div><p class=\"home-formats\">" + supported + "</p></div></div>";
  }

  function recentFoldersMarkup() {
    var items = visibleRecentFolders().map(function(f) {
      var pinned = isPinnedFolder(f);
      var label = pinned ? "Открепить папку" : "Закрепить папку";
      return "<div class=\"recent-folder\"><button class=\"recent-open\" data-folder=\"" + escapeHtml(f) + "\" title=\"" + escapeHtml(f) + "\"><span class=\"recent-icon\">▸</span><span>" + escapeHtml(f) + "</span></button><button class=\"recent-pin" + (pinned ? " is-pinned" : "") + "\" data-folder=\"" + escapeHtml(f) + "\" title=\"" + label + "\" aria-label=\"" + label + "\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7Z\"/></svg></button></div>";
    }).join("");
    return "<div class=\"empty\"><div class=\"empty-inner home-panel\"><div class=\"empty-icon\"><img src=\"assets/folder-video.png\" alt=\"\" /></div><p class=\"home-kicker\">Folder-video</p><strong>Вернитесь к папке и найдите нужный момент глазами</strong><small>Миниатюры по всей длине ролика превращают папку с видео в карту сцен: меньше перемотки, больше точных решений.</small><div class=\"home-recents\"><span>Последние папки</span><div class=\"recent-folder-grid\">" + items + "</div></div></div></div>";
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
        "<label class=\"check\"><input id=\"recursive\" type=\"checkbox\" " + (state.recursive ? "checked" : "") + "/> Recursive</label>" +
        "<div class=\"sort\"><span>Sort</span><select id=\"sort\"><option value=\"date\" " + (state.sort === "date" ? "selected" : "") + ">Date</option><option value=\"name\" " + (state.sort === "name" ? "selected" : "") + ">Name</option></select><button id=\"direction\" title=\"Изменить направление\">" + (state.asc ? "▲" : "▼") + "</button></div>" +
        "<span class=\"count\">" + files.length + (state.filterText ? " / " + state.files.length : "") + " videos</span>" +
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
    var message = state.filterText ? "По фильтру ничего не найдено" : "Видео не найдены";
    return "<div class=\"empty\"><div class=\"empty-inner\"><div class=\"empty-icon\"><img src=\"assets/folder-video.png\" alt=\"\" /></div><strong>" + message + "</strong><small>Измените фильтр или выберите другую папку<br>" + supported + "</small></div></div>";
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
  async function loadFolder(folder) {
    addRecentFolder(folder);
    state.folderPath = folder; state.page = 1;
    state.tabs = [{ id: "folder", type: "folder", label: "Видео" }];
    state.activeTab = "folder"; state.thumbnailGeneration += 1; state.stripCache.clear(); state.stripPending.clear(); state.frameCache.clear(); state.durationCache.clear(); await window.folderVideo.setTitle(folder); render(); await scanCurrentFolder();
  }
  window.folderVideo.onOpenTarget(async function(target) {
    if (!target || typeof target.path !== "string") return;
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
  function setPlayerVideo(tab, video) {
    if (tab.metadataRequestId) window.folderVideo.cancelMetadata(tab.metadataRequestId);
    tab.video = video; tab.label = video.name; tab.currentTime = 0; tab.isDragging = false;
    tab.metadataStatus = "idle"; tab.metadata = null; tab.metadataDraft = null; tab.metadataDirty = false; tab.metadataRequestId = null; tab.markdownMode = "edit";
  }
  function switchPlayerVideo(tab, direction) {
    var nextVideo = adjacentPlayerVideo(tab, direction);
    if (!nextVideo) return;
    setPlayerVideo(tab, nextVideo);
    render();
  }
  function openVideo(video) {
    for (var ti = 0; ti < state.tabs.length; ti++) {
      if (state.tabs[ti].type === "player" && state.tabs[ti].video.path === video.path) {
        state.activeTab = state.tabs[ti].id; render(); return;
      }
    }
    var tab = { id: "player-" + Date.now() + "-" + Math.random().toString(16).slice(2), type: "player", label: video.name, video: video, columns: state.settings.viewer.columns, seconds: state.settings.viewer.seconds, scroll: state.settings.viewer.scroll, collapsed: state.gridCollapsed, metadataCollapsed: state.metadataCollapsed, currentTime: 0, metadataStatus: "idle", metadata: null, metadataDraft: null, metadataDirty: false, markdownMode: "edit" };
    state.tabs.push(tab); state.activeTab = tab.id; render();
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
    if (tab.metadataRequestId) window.folderVideo.cancelMetadata(tab.metadataRequestId);
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
  function renderPlayer(tab) { var gs = "";
    var playbackRate = tab.playbackRate || 1;
    var videoIndex = playerVideoIndex(tab);
    var prevDisabled = videoIndex <= 0;
    var nextDisabled = videoIndex === -1 || videoIndex >= playerVideoList().length - 1;
    var favorite = isFavorite(tab.video.path);
    view.innerHTML = "<section class=\"player-view\"><div class=\"player-layout\"" + gs + "\"><div class=\"player-main\"><div class=\"video-bar\"><button id=\"back\" class=\"back\">◀ VIDEO LIST</button><span id=\"reveal\" class=\"video-path\" title=\"Открыть в Проводнике\">" + escapeHtml(tab.video.path) + "</span><button id=\"videoScreenshot\" class=\"video-action\" title=\"Сохранить скрин текущего кадра\" aria-label=\"Сохранить скрин текущего кадра\">SHOT</button><button id=\"copyVideoName\" class=\"video-action\" title=\"Скопировать название файла без расширения\" aria-label=\"Скопировать название файла без расширения\">COPY</button><button id=\"openExternal\" class=\"open-external\" title=\"Открыть в системном плеере\" aria-label=\"Открыть в системном плеере\">▶</button></div><div class=\"video-stage\"><video id=\"player\" controls playsinline src=\"" + tab.video.url + "\"></video><nav class=\"video-switcher\" aria-label=\"Переключение видео\"><button id=\"previousVideo\" type=\"button\" title=\"Предыдущее видео\" aria-label=\"Предыдущее видео\" " + (prevDisabled ? "disabled" : "") + ">‹ Prev</button><button id=\"nextVideo\" type=\"button\" title=\"Следующее видео\" aria-label=\"Следующее видео\" " + (nextDisabled ? "disabled" : "") + ">Next ›</button></nav></div></div><aside id=\"gridPanel\" class=\"grid-panel" + (tab.collapsed ? " collapsed" : "") + "\"><header class=\"grid-head\"><button id=\"collapse\" class=\"collapse\" title=\"Свернуть панель\">" + (tab.collapsed ? "◀" : "▶") + "</button><div class=\"grid-control\"><label>Col</label><select id=\"columns\">" + [3,4,5,6,8].map(function(v) { return "<option " + (v === tab.columns ? "selected" : "") + ">" + v + "</option>"; }).join("") + "</select></div><div class=\"grid-control\"><label>Sec</label><select id=\"seconds\">" + [5,10,15,30,60].map(function(v) { return "<option " + (v === tab.seconds ? "selected" : "") + ">" + v + "</option>"; }).join("") + "</select></div><div class=\"grid-control\"><label>Scroll</label><select id=\"scroll\"><option value=\"center\" " + (tab.scroll === "center" ? "selected" : "") + ">Center</option><option value=\"edge\" " + (tab.scroll === "edge" ? "selected" : "") + ">Edge</option><option value=\"off\" " + (tab.scroll === "off" ? "selected" : "") + ">OFF</option></select></div></header><div id=\"gridScroll\" class=\"grid-scroll\"><div id=\"frameGrid\" class=\"frame-grid\"></div></div></aside></div><footer class=\"player-status\">Space Play/Pause · Arrows Move marker · Click/Drag precise seek</footer></section>";
    var favoriteButton = document.createElement("button");
    favoriteButton.id = "playerFavorite";
    favoriteButton.className = "favorite-toggle" + (favorite ? " is-favorite" : "");
    favoriteButton.title = favorite ? "Удалить из избранного" : "Добавить в избранное";
    favoriteButton.setAttribute("aria-label", favoriteButton.title);
    favoriteButton.textContent = favorite ? "♥" : "♡";
    $("#videoScreenshot").before(favoriteButton);
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
    var layout = $(".player-layout"); layout.insertAdjacentHTML("afterbegin", metadataPanelMarkup(tab)); layout.classList.toggle("metadata-collapsed", tab.metadataCollapsed); layout.classList.toggle("grid-collapsed", tab.collapsed);
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
    $("#back").addEventListener("click", function() { state.activeTab = "folder"; render(); });
    $("#reveal").addEventListener("click", function() { window.folderVideo.showInFolder(tab.video.path); });
    $("#playerFavorite").addEventListener("click", function() { toggleFavorite(tab.video); renderPlayer(tab); });
    $("#playerMove").addEventListener("click", function() { moveFile(tab.video.path); });
    $("#playerSpeed").addEventListener("click", function() { startSpeedUp(tab, player); });
    $("#playerDelete").addEventListener("click", function() { deleteFile(tab.video.path); });
    $("#videoScreenshot").addEventListener("click", function() { takeVideoScreenshot(tab, player); });
    $("#copyVideoName").addEventListener("click", function() { copyVideoName(tab); });
    $("#previousVideo").addEventListener("click", function() { switchPlayerVideo(tab, -1); });
    $("#nextVideo").addEventListener("click", function() { switchPlayerVideo(tab, 1); });
    document.querySelectorAll(".playback-rate").forEach(function(button) {
      button.addEventListener("click", function() {
        tab.playbackRate = Number(button.dataset.rate);
        player.playbackRate = tab.playbackRate;
        document.querySelectorAll(".playback-rate").forEach(function(rateButton) { rateButton.classList.toggle("is-active", rateButton === button); });
      });
    });
    $("#openExternal").addEventListener("click", async function() {
      var error = await window.folderVideo.openInSystemPlayer(tab.video.path);
      if (error) notice("Не удалось открыть внешний плеер: " + error);
    });
    $("#metadataCollapse").addEventListener("click", function() { tab.metadataCollapsed = !tab.metadataCollapsed; state.metadataCollapsed = tab.metadataCollapsed; savePanelPreferences(); renderPlayer(tab); });
    $("#collapse").addEventListener("click", function() { tab.collapsed = !tab.collapsed; state.gridCollapsed = tab.collapsed; savePanelPreferences(); renderPlayer(tab); });
    [["columns", "columns"], ["seconds", "seconds"], ["scroll", "scroll"]].forEach(function(pair) {
      $("#" + pair[0]).addEventListener("change", function(event) {
        tab[pair[1]] = pair[0] === "scroll" ? event.target.value : Number(event.target.value);
        renderPlayer(tab);
      });
    });
    renderMetadataContent(tab); if (!tab.metadata && tab.metadataStatus === "idle") loadMetadata(tab);
    player.addEventListener("loadedmetadata", function() {
      if (!Number.isFinite(player.duration) || !player.duration) { notice("Этот файл не удаётся декодировать в Chromium."); return; }
      renderFrameGrid(tab, player);
    });
    player.addEventListener("timeupdate", function() { tab.currentTime = player.currentTime; updateActiveFrame(player.currentTime, tab, !tab.isDragging); });
    player.addEventListener("seeked", function() { tab.currentTime = player.currentTime; updateActiveFrame(player.currentTime, tab, !tab.isDragging); });
    document.onkeydown = function(event) { keyboardPlayer(event, tab, player); };
  }
  function keyboardPlayer(event, tab, player) {
    if (active().id !== tab.id || ["SELECT", "INPUT", "TEXTAREA"].indexOf(document.activeElement.tagName) !== -1) return;
    var step = tab.seconds; var target = null;
    if (event.key === " ") { event.preventDefault(); player.paused ? player.play().catch(function() {}) : player.pause(); }
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
    var taskId = ++state.task; var cacheKey = fileKey(tab.video) + "|" + tab.seconds;
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
    function tick() {
      if (!player.isConnected || (active() ? active().id : null) !== tab.id) return;
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
    await captureFrameTimes(url, items.map(function(item) { return item.time; }), function(image, index) {
      return onFrame(items[index], image);
    });
  }
  async function captureFrameTimes(url, times, onFrame, shouldContinue) {
    var frames = [];
    if (!times.length) return frames;
    var video = document.createElement("video");
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
      video.removeAttribute("src");
      video.load();
      video.remove();
    }
    return frames;
  }
  function captureFrame(url, time) {
    return captureFrameTimes(url, [time]).then(function(frames) { return frames[0] || null; });
  }
  function loadCaptureVideo(video, url) { return new Promise(function(resolve) {
    var done = false; var timeout = setTimeout(function() { finish(false); }, 9000);
    function finish(ok) { if (done) return; done = true; clearTimeout(timeout); video.onloadeddata = null; video.onerror = null; resolve(ok); }
    video.muted = true; video.preload = "auto";
    video.onloadeddata = function() { finish(true); };
    video.onerror = function() { finish(false); };
    video.src = url; video.load();
  }); }
  function captureFrameFromVideo(video, canvas, time) { return new Promise(function(resolve) {
    if (!Number.isFinite(video.duration) || !video.duration) { resolve(null); return; }
    var done = false;
    var timeout = setTimeout(function() { finish(null); }, 9000);
    function finish(value) { if (done) return; done = true; clearTimeout(timeout); video.onseeked = null; video.onerror = null; resolve(value); }
    function draw() {
      try {
        canvas.width = 160; canvas.height = 90;
        canvas.getContext("2d").drawImage(video, 0, 0, 160, 90);
        canvas.toBlob(function(blob) { finish(blob ? URL.createObjectURL(blob) : null); }, "image/webp", 0.72);
      } catch (e) { finish(null); }
    }
    var target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.1)));
    video.onseeked = draw;
    video.onerror = function() { finish(null); };
    if (Math.abs(video.currentTime - target) < 0.02 && video.readyState >= 2) draw();
    else video.currentTime = target;
  }); }

  render();
})();
