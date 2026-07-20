"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const prefs = require("../src/prefs");
const { updateRegistry, commandRegistry } = require("../src/settings-actions");
const {
  normalizeDiscordBot,
  validateDiscordBot,
  validateBotToken,
  writeTokenFile,
  readTokenFile,
  maskToken,
  readiness,
} = require("../src/discord-bot-settings");

const CHANNEL_ID = "123456789012345678";
const TOKEN = "discord.bot.token.0123456789";

test("normalizes and validates Discord bot notification preferences", () => {
  assert.deepEqual(normalizeDiscordBot(null), {
    enabled: false,
    channelId: "",
    notifyOnComplete: true,
  });
  assert.equal(validateDiscordBot({ channelId: "bad" }).status, "error");
  assert.equal(validateDiscordBot({ channelId: CHANNEL_ID }).status, "ok");
  assert.equal(validateBotToken("short").status, "error");
  assert.equal(readiness({ enabled: true, channelId: CHANNEL_ID }, TOKEN).ready, true);
});

test("stores the Discord token outside preferences and only exposes a mask", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-discord-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "discord-token");

  assert.deepEqual(writeTokenFile(file, TOKEN), { status: "ok" });
  assert.equal(readTokenFile(file), TOKEN);
  assert.equal(maskToken(TOKEN), "disc...6789");

  const savedPrefs = prefs.validate({
    discordBot: { enabled: true, channelId: CHANNEL_ID, token: TOKEN },
  }).discordBot;
  assert.equal(Object.prototype.hasOwnProperty.call(savedPrefs, "token"), false);
});

test("registers Discord settings and token/test commands", async () => {
  assert.equal(updateRegistry.discordBot({ channelId: CHANNEL_ID }).status, "ok");
  assert.equal(updateRegistry.discordBot({ channelId: "bad" }).status, "error");

  let savedToken = "";
  const saved = await commandRegistry["discordBot.setToken"]({ token: TOKEN }, {
    writeDiscordBotToken(token) {
      savedToken = token;
      return { status: "ok" };
    },
  });
  assert.deepEqual(saved, { status: "ok" });
  assert.equal(savedToken, TOKEN);

  assert.deepEqual(commandRegistry["discordBot.tokenInfo"](null, {
    getDiscordBotTokenInfo: () => ({ configured: true, masked: "disc...6789" }),
  }), { status: "ok", configured: true, masked: "disc...6789" });

  assert.deepEqual(await commandRegistry["discordBot.test"](null, {
    sendDiscordBotTest: async () => ({ status: "ok" }),
  }), { status: "ok" });

  const style = { nickname: "Milktea", templates: { complete: ["Done"], interrupted: "Stopped", permission: "Approve", choice: "Choose" } };
  assert.deepEqual(commandRegistry["discordBot.style.get"](null, {
    getNotificationStyle: () => style,
  }), { status: "ok", style });
  assert.deepEqual(await commandRegistry["discordBot.style.save"](style, {
    writeNotificationStyle: async (value) => ({ status: "ok", style: value }),
  }), { status: "ok", style });
  assert.deepEqual(await commandRegistry["discordBot.style.reset"](null, {
    resetNotificationStyle: async () => ({ status: "ok", style }),
  }), { status: "ok", style });
});
