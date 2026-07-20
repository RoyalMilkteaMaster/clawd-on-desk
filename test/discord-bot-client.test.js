"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createDiscordBotClient,
  DISCORD_API_BASE,
  DISCORD_USER_AGENT,
  MAX_TEXT_LENGTH,
} = require("../src/discord-bot-client");

test("sends one Discord message with safe mentions and bot authentication", async () => {
  let request = null;
  const client = createDiscordBotClient({
    getToken: () => "secret-discord-token",
    getChannelId: () => "123456789012345678",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });

  assert.deepEqual(await client.sendNotification("Task complete"), { ok: true });
  assert.equal(request.url, `${DISCORD_API_BASE}/channels/123456789012345678/messages`);
  assert.equal(request.options.headers.Authorization, "Bot secret-discord-token");
  assert.equal(request.options.headers["User-Agent"], DISCORD_USER_AGENT);
  assert.deepEqual(JSON.parse(request.options.body), {
    content: "Task complete",
    allowed_mentions: { parse: [] },
  });
});

test("truncates long messages and classifies API failures without returning secrets", async () => {
  let body = null;
  const client = createDiscordBotClient({
    getToken: () => "secret-discord-token",
    getChannelId: () => "123456789012345678",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: false, status: 429 };
    },
  });

  assert.deepEqual(await client.sendNotification("x".repeat(MAX_TEXT_LENGTH + 50)), {
    ok: false,
    errorClass: "429",
  });
  assert.equal(body.content.length, MAX_TEXT_LENGTH);
});
