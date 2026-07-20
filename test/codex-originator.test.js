"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { isCodexDesktopOriginator } = require("../hooks/codex-originator");

describe("Codex originator classification", () => {
  it("recognizes current and legacy Codex Desktop values", () => {
    for (const value of [
      "codex_work_desktop",
      " CODEX_WORK_DESKTOP ",
      "Codex Desktop",
      " codex desktop ",
    ]) {
      assert.strictEqual(isCodexDesktopOriginator(value), true, value);
    }
  });

  it("fails closed for CLI, unknown, and malformed values", () => {
    for (const value of [
      "codex_exec",
      "codex-tui",
      "codex_work_cli",
      "desktop",
      "codex",
      "",
      null,
      undefined,
      42,
      {},
    ]) {
      assert.strictEqual(isCodexDesktopOriginator(value), false, String(value));
    }
  });
});
