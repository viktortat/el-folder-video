(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SessionCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";

  function normalize(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.tabs)) return null;
    var ids = new Set(), paths = new Set();
    var tabs = value.tabs.map(function(item) {
      if (!item || !["folder", "settings", "player"].includes(item.type)) return null;
      var id = item.type === "player" ? item.id : item.type;
      if (typeof id !== "string" || !id || ids.has(id)) return null;
      var tab = { id: id, type: item.type };
      if (item.type === "player") {
        if (id === "folder" || id === "settings" || typeof item.path !== "string" || !item.path || paths.has(item.path)) return null;
        tab.path = item.path;
        tab.currentTime = Number.isFinite(item.currentTime) && item.currentTime >= 0 ? item.currentTime : 0;
        tab.playbackRate = [1, 1.5, 2].includes(item.playbackRate) ? item.playbackRate : 1;
        if ([3, 4, 5, 6, 8].includes(item.columns)) tab.columns = item.columns;
        if ([5, 10, 15, 30, 60].includes(item.seconds)) tab.seconds = item.seconds;
        if (["center", "edge", "off"].includes(item.scroll)) tab.scroll = item.scroll;
        if (["frames", "transcript", "summary", "notes"].includes(item.panelMode)) tab.panelMode = item.panelMode;
        if (Number.isFinite(item.panelWidth)) tab.panelWidth = Math.max(280, Math.min(720, item.panelWidth));
        ["collapsed", "metadataCollapsed"].forEach(function(key) { if (typeof item[key] === "boolean") tab[key] = item[key]; });
        paths.add(item.path);
      }
      ids.add(id);
      return tab;
    }).filter(Boolean);
    return {
      version: 1,
      folderPath: typeof value.folderPath === "string" ? value.folderPath : "",
      recursive: value.recursive === true,
      tabs: tabs,
      activeTab: value.activeTab === null ? null : (ids.has(value.activeTab) ? value.activeTab : (tabs[0] ? tabs[0].id : null))
    };
  }

  function snapshot(state) {
    return normalize({ version: 1, folderPath: state.folderPath, recursive: state.recursive, activeTab: state.activeTab,
      tabs: state.tabs.map(function(tab) {
        return Object.assign({}, tab, { path: tab.type === "player" && tab.video ? tab.video.path : undefined });
      })
    });
  }

  function parse(raw) {
    try { return normalize(JSON.parse(raw)); } catch (_) { return null; }
  }

  return { snapshot: snapshot, parse: parse };
});
