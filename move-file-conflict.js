"use strict";

const path = require("node:path");

function resolvedPath(filePath, platform) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const resolved = pathApi.resolve(filePath);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function createSameFileMoveConflict(sourcePath, destinationPath, platform = process.platform) {
  if (resolvedPath(sourcePath, platform) !== resolvedPath(destinationPath, platform)) return null;
  const pathApi = platform === "win32" ? path.win32 : path;

  return {
    dialogOptions: {
      type: "warning",
      title: "Файл уже существует",
      message: `В выбранной папке уже есть «${pathApi.basename(sourcePath)}».`,
      detail: `Исходный файл и файл назначения совпадают:\n${sourcePath}`,
      buttons: ["Заменить", "Отмена"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    },
    confirmedResult: { success: true, dest: destinationPath, unchanged: true }
  };
}

module.exports = { createSameFileMoveConflict };
