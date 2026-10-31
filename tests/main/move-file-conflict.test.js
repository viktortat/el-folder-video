"use strict";

const assert = require("node:assert/strict");
const { createSameFileMoveConflict } = require("./move-file-conflict.js");

const sourcePath = "K:\\videos\\example.mp4";

const conflict = createSameFileMoveConflict(sourcePath, "K:\\videos\\example.mp4", "win32");
assert.ok(conflict, "выбор текущей папки должен считаться конфликтом существующего файла");
assert.deepEqual(conflict.dialogOptions.buttons, ["Заменить", "Отмена"]);
assert.equal(conflict.confirmedResult.success, true);
assert.equal(conflict.confirmedResult.unchanged, true, "замена файла самим собой не должна изменять файл");

assert.ok(
  createSameFileMoveConflict(sourcePath, "k:\\VIDEOS\\example.mp4", "win32"),
  "сравнение Windows-путей должно быть нечувствительным к регистру"
);
assert.equal(
  createSameFileMoveConflict(sourcePath, "K:\\archive\\example.mp4", "win32"),
  null,
  "другой путь должен обрабатываться обычной логикой перемещения"
);

console.log("move file conflict: ok");
