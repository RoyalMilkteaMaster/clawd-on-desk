"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeLineNotifications,
  validateLineNotifications,
  validateChannelAccessToken,
  writeTokenFile,
  readTokenFile,
  maskToken,
  readiness,
} = require("../src/line-notification-settings");

const USER_ID = `U${"a".repeat(32)}`;
const TOKEN = "test-channel-token-0123456789";

test("normalizes and validates LINE notification preferences", () => {
  assert.deepEqual(normalizeLineNotifications(null), {
    enabled: false,
    userId: "",
    notifyOnComplete: true,
    notifyOnAttention: true,
  });
  assert.equal(validateLineNotifications({ userId: "bad" }).status, "error");
  assert.equal(validateLineNotifications({ userId: USER_ID }).status, "ok");
  assert.equal(validateChannelAccessToken("short").status, "error");
  assert.equal(readiness({ enabled: true, userId: USER_ID }, TOKEN).ready, true);
});

test("stores the token separately and only exposes a mask", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-line-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "line-token");

  assert.deepEqual(writeTokenFile(file, TOKEN), { status: "ok" });
  assert.equal(readTokenFile(file), TOKEN);
  assert.equal(maskToken(TOKEN), "test...6789");
});
