"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ensureStyleFile,
  normalizeStyle,
  pickTemplate,
  readStyle,
  renderTemplate,
  resetStyle,
  validateEditableStyle,
  writeStyle,
} = require("../src/line-notification-style");

test("normalizes partial style files and replaces supported variables", () => {
  const style = normalizeStyle({ nickname: "小璃", templates: { complete: "{owner}：{task}" } });
  assert.equal(style.nickname, "小璃");
  assert.deepEqual(style.templates.complete, ["{owner}：{task}"]);
  assert.match(style.templates.choice, /主人/);
  assert.equal(renderTemplate(style.templates.complete[0], { owner: "小璃主人", task: "測試" }), "小璃主人：測試");
});

test("picks a completion template without immediately repeating it", () => {
  const templates = ["第一種", "第二種", "第三種"];
  assert.equal(pickTemplate(templates, { random: () => 0, previous: "第一種" }), "第二種");
  assert.equal(pickTemplate(templates, { random: () => 0.999, previous: "第一種" }), "第三種");
});

test("creates an editable JSON style file and reads later edits", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-line-style-"));
  const file = path.join(dir, "line-notification-style.json");
  try {
    ensureStyleFile(file);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.nickname = "小璃";
    fs.writeFileSync(file, JSON.stringify(saved), "utf8");
    assert.equal(readStyle(file).nickname, "小璃");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("validates and safely writes replies edited from Settings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-line-style-edit-"));
  const file = path.join(dir, "line-notification-style.json");
  try {
    const style = readStyle(file);
    style.nickname = "Milktea";
    style.templates.complete = ["Done {task}", "Finished {project}"];
    style.templates.interrupted = "Stopped {task}";
    assert.equal(validateEditableStyle(style).status, "ok");
    assert.equal(writeStyle(file, style).status, "ok");
    assert.equal(readStyle(file).nickname, "Milktea");
    assert.deepEqual(readStyle(file).templates.complete, ["Done {task}", "Finished {project}"]);
    assert.equal(fs.existsSync(`${file}.tmp`), false);

    assert.equal(writeStyle(file, { templates: { complete: [] } }).status, "error");
    assert.equal(readStyle(file).nickname, "Milktea", "invalid edits must not overwrite the saved file");

    assert.equal(resetStyle(file).status, "ok");
    assert.equal(readStyle(file).nickname, normalizeStyle(null).nickname);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
