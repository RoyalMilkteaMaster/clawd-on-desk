"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// main.js cannot be required here (it pulls in electron), so this follows the
// existing main-*.test.js convention of reading the source. Where behavior can
// actually be executed — the config signature — we lift the real function into
// a VM instead of grepping for strings.
const MAIN_SOURCE = fs.readFileSync(path.resolve(__dirname, "..", "src", "main.js"), "utf8");

function loadFn(name, extraContext = {}) {
  const start = MAIN_SOURCE.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in main.js`);
  const end = MAIN_SOURCE.indexOf("\n}", start);
  assert.notEqual(end, -1, `${name} should be terminated`);
  const block = MAIN_SOURCE.slice(start, end + 2);
  const context = { ...extraContext };
  context.globalThis = context;
  vm.runInNewContext(`${block}\nresult = ${name};`, context);
  return context.result;
}

const PATHS = { secretsEnvFilePath: "/tmp/feishu-approval.env" };
const SECRETS = { appId: "cli_1", appSecret: "s", verificationToken: "", encryptKey: "" };
const CONFIG = {
  enabled: true,
  platform: "feishu",
  idType: "open_id",
  approverId: "ou_1",
  connectionTimeoutSeconds: 15,
};

describe("main Feishu/Lark approval platform wiring", () => {
  it("changes the config signature when the platform changes", () => {
    const buildFeishuApprovalSignature = loadFn("buildFeishuApprovalSignature", {
      feishuApprovalSecretsRevision: 0,
    });

    const feishu = buildFeishuApprovalSignature(CONFIG, PATHS, SECRETS);
    const lark = buildFeishuApprovalSignature({ ...CONFIG, platform: "lark" }, PATHS, SECRETS);

    // The signature is what startFeishuApprovalClient compares to decide
    // between "reuse the live client" and "tear it down and rebuild". If the
    // platform were missing from it, switching to Lark would keep the old WS
    // connected to Feishu and reuse the Feishu REST client + token cache.
    assert.notEqual(feishu, lark, "platform must be part of the signature");
    assert.match(feishu, /"platform":"feishu"/);
    assert.match(lark, /"platform":"lark"/);
  });

  it("keeps the signature stable when nothing changes", () => {
    const buildFeishuApprovalSignature = loadFn("buildFeishuApprovalSignature", {
      feishuApprovalSecretsRevision: 0,
    });
    assert.equal(
      buildFeishuApprovalSignature(CONFIG, PATHS, SECRETS),
      buildFeishuApprovalSignature({ ...CONFIG }, PATHS, SECRETS),
      "an unchanged config must not trigger a pointless reconnect"
    );
    // Sanity: fields that do matter still move it.
    for (const patch of [{ enabled: false }, { idType: "user_id" }, { approverId: "ou_2" }, { connectionTimeoutSeconds: 30 }]) {
      assert.notEqual(
        buildFeishuApprovalSignature(CONFIG, PATHS, SECRETS),
        buildFeishuApprovalSignature({ ...CONFIG, ...patch }, PATHS, SECRETS),
        `${JSON.stringify(patch)} should change the signature`
      );
    }
  });

  it("does not put the language in the signature", () => {
    // Cards read the language dynamically through getLang. Putting lang in the
    // signature would drop and rebuild the long connection on every language
    // switch.
    const start = MAIN_SOURCE.indexOf("function buildFeishuApprovalSignature(");
    const block = MAIN_SOURCE.slice(start, MAIN_SOURCE.indexOf("\n}", start));
    assert.ok(!/\blang\b/.test(block), "lang must not be part of the Feishu approval signature");
  });

  it("constructs the approval client with the configured platform and a dynamic language source", () => {
    const start = MAIN_SOURCE.indexOf("feishuApprovalClient = new FeishuApprovalClient({");
    assert.notEqual(start, -1, "main.js should construct FeishuApprovalClient");
    const block = MAIN_SOURCE.slice(start, MAIN_SOURCE.indexOf("});", start));
    assert.match(block, /platform:\s*config\.platform/, "the resolved platform must be passed to the client");
    assert.match(block, /getLang:\s*\(\)\s*=>/, "a dynamic getLang must be injected for card i18n");
  });

  it("reports the resolved platform in the status snapshot", () => {
    const start = MAIN_SOURCE.indexOf("function getFeishuApprovalStatus(");
    assert.notEqual(start, -1);
    const block = MAIN_SOURCE.slice(start, MAIN_SOURCE.indexOf("\n}", start));
    assert.match(block, /platform:\s*config\.platform/, "status should expose the platform for the settings page");
  });

  it("localizes the settings test card instead of hardcoding English", () => {
    const start = MAIN_SOURCE.indexOf("async function sendFeishuApprovalTest(");
    assert.notEqual(start, -1);
    const block = MAIN_SOURCE.slice(start, MAIN_SOURCE.indexOf("\n}", start));
    assert.match(block, /title:\s*translate\("feishuCardTestTitle"\)/);
    assert.match(block, /detail:\s*translate\("feishuCardTestDetail"\)/);
    // The old card paired an English title with Chinese buttons.
    assert.ok(!block.includes("Clawd Feishu approval test"), "the test card title must not be hardcoded");
  });

  it("keeps user-visible runtime fallbacks brand-neutral", () => {
    const start = MAIN_SOURCE.indexOf("function feishuApprovalUnavailableMessage(");
    assert.notEqual(start, -1);
    const block = MAIN_SOURCE.slice(start, MAIN_SOURCE.indexOf("\n}", start));
    const strings = block.match(/"[^"]*"/g) || [];
    for (const literal of strings) {
      assert.ok(
        !/feishu|lark/i.test(literal),
        `unavailable-message fallback must not name a brand: ${literal}`
      );
    }
  });
});
