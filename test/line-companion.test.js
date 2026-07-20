"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createLineCompanion, createNotificationCompanion, summarizeResult } = require("../src/line-companion");
const { extractLastUserPromptTitleFromRecords } = require("../hooks/codex-assistant-output");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function completedEntry(overrides = {}) {
  return {
    id: "session-abcdef123",
    agentId: "codex",
    displayTitle: "修正登入錯誤",
    cwd: "C:\\work\\important-project",
    badge: "done",
    lastEvent: { rawEvent: "Stop", at: 1000 },
    ...overrides,
  };
}

function makeCompanion(initialConfig = {}, getTaskTitle = () => "", getStyle = () => null) {
  const sent = [];
  const config = {
    enabled: true,
    notifyOnComplete: true,
    notifyOnAttention: true,
    ...initialConfig,
  };
  const companion = createLineCompanion({
    getConfig: () => config,
    getLang: () => "en",
    getTaskTitle,
    getStyle,
    getClient: () => ({
      sendNotification: async (message) => {
        sent.push(message);
        return { ok: true };
      },
    }),
  });
  return { companion, config, sent };
}

test("primes without backlog then sends each new completion with task identity", async () => {
  const { companion, sent } = makeCompanion();
  companion.onSnapshot({ sessions: [completedEntry()] });
  await tick();
  assert.deepEqual(sent, []);

  companion.onSnapshot({ sessions: [completedEntry({ lastEvent: { rawEvent: "Stop", at: 2000 } })] });
  await tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /修正登入錯誤/);
  assert.match(sent[0], /important-project/);
  assert.match(sent[0], /codex/);
  assert.match(sent[0], /bcdef123/);
});

test("renders editable catgirl templates with task variables", async () => {
  const style = {
    nickname: "小璃",
    accountName: "Clawd",
    templates: {
      complete: ["{owner}「{task}」完成了喵！{result} {project} #{session}"],
      interrupted: "{owner}，{task}卡住了喵",
      permission: "{owner}，{task}需要確認權限喵",
      choice: "{owner}，{task}等您選擇喵",
    },
  };
  const { companion, sent } = makeCompanion({}, () => "修好通知", () => style);
  companion.onSnapshot({ sessions: [] });
  companion.onSnapshot({ sessions: [completedEntry({ assistantLastOutput: "已修正重複通知" })] });
  await tick();
  assert.equal(sent[0], "小璃主~人~♡「修好通知」完成了喵！已修正重複通知 important-project #bcdef123");
});

test("generic companion lets Discord reuse the same editable completion templates", async () => {
  const sent = [];
  const companion = createNotificationCompanion({
    transportName: "Discord",
    getConfig: () => ({ enabled: true, notifyOnComplete: true }),
    getStyle: () => ({ templates: { complete: ["Discord：{task}"] } }),
    getTaskTitle: () => "共用隨機回覆",
    getClient: () => ({
      sendNotification: async (message) => {
        sent.push(message);
        return { ok: true };
      },
    }),
  });
  companion.onSnapshot({ sessions: [] });
  companion.onSnapshot({ sessions: [completedEntry()] });
  await tick();
  assert.deepEqual(sent, ["Discord：共用隨機回覆"]);
});

test("summarizes the final assistant reply without forwarding fenced code", () => {
  const result = summarizeResult(`# 完成結果\n\n已完成通知修正。\n\n\`\`\`js\nconst secret = true;\n\`\`\``);
  assert.equal(result, "完成結果\n\n已完成通知修正。\n\n[程式碼內容已省略]");
  assert.match(summarizeResult("x".repeat(400)), /…$/);
});

test("ignores background completions and remembers completions across missing snapshots", async () => {
  const { companion, sent } = makeCompanion();
  companion.onSnapshot({ sessions: [] });
  const background = completedEntry({ headless: true });
  companion.onSnapshot({ sessions: [background] });
  companion.onSnapshot({ sessions: [] });
  companion.onSnapshot({ sessions: [background] });
  await tick();
  assert.deepEqual(sent, []);

  const visibleSubagent = completedEntry({
    id: "codex-subagent-12345678",
    headless: false,
    codexSource: "subagent",
    lastEvent: { rawEvent: "Stop", at: 3000 },
  });
  companion.onSnapshot({ sessions: [visibleSubagent] });
  await tick();
  assert.deepEqual(sent, []);

  const root = completedEntry({ id: "session-root-12345678", lastEvent: { rawEvent: "Stop", at: 2000 } });
  companion.onSnapshot({ sessions: [root] });
  companion.onSnapshot({ sessions: [] });
  companion.onSnapshot({ sessions: [root] });
  await tick();
  assert.equal(sent.length, 1);
});

test("uses the latest user message as the completed task name", async () => {
  const records = [
    { type: "event_msg", payload: { type: "user_message", message: "舊任務" } },
    { type: "event_msg", payload: { type: "task_complete" } },
    { type: "event_msg", payload: { type: "user_message", message: "修正重複 LINE 通知\n不要重送" } },
  ];
  const title = extractLastUserPromptTitleFromRecords(records);
  const { companion, sent } = makeCompanion({}, () => title);
  companion.onSnapshot({ sessions: [] });
  companion.onSnapshot({ sessions: [completedEntry()] });
  await tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /修正重複 LINE 通知/);
  assert.doesNotMatch(sent[0], /修正登入錯誤|不要重送/);
});

test("master switch stops sends and does not backfill while re-enabled", async () => {
  const { companion, config, sent } = makeCompanion({ enabled: false });
  companion.onSnapshot({ sessions: [] });
  companion.onSnapshot({ sessions: [completedEntry()] });
  config.enabled = true;
  companion.onSnapshot({ sessions: [completedEntry()] });
  await tick();
  assert.deepEqual(sent, []);
});

test("attention notification asks the user to return without leaking tool input", async () => {
  const { companion, sent } = makeCompanion({}, () => "檢查部署選項");
  companion.onSnapshot({ sessions: [completedEntry({ badge: "working" })] });
  companion.onPermissionAdded({
    sessionId: "session-abcdef123",
    agentId: "codex",
    toolUseId: "tool-1",
    toolName: "shell_command",
    toolInput: "API_KEY=top-secret",
    createdAt: 1000,
  });
  companion.onPermissionAdded({ sessionId: "session-abcdef123", toolUseId: "tool-1" });
  await tick();

  assert.equal(sent.length, 1);
  assert.match(sent[0], /檢查部署選項/);
  assert.match(sent[0], /return to your computer/i);
  assert.doesNotMatch(sent[0], /top-secret|shell_command/);
});
