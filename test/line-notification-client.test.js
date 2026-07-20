"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createLineNotificationClient, LINE_PUSH_URL } = require("../src/line-notification-client");

test("sends one LINE text message with bearer authentication", async () => {
  let request = null;
  const client = createLineNotificationClient({
    getToken: () => "secret-token",
    getUserId: () => `U${"b".repeat(32)}`,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });

  assert.deepEqual(await client.sendNotification("Task complete"), { ok: true });
  assert.equal(request.url, LINE_PUSH_URL);
  assert.equal(request.options.headers.Authorization, "Bearer secret-token");
  assert.deepEqual(JSON.parse(request.options.body), {
    to: `U${"b".repeat(32)}`,
    messages: [{ type: "text", text: "Task complete" }],
  });
});

test("classifies failed requests without returning secrets", async () => {
  const client = createLineNotificationClient({
    getToken: () => "secret-token",
    getUserId: () => `U${"c".repeat(32)}`,
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });

  assert.deepEqual(await client.sendNotification("test"), { ok: false, errorClass: "429" });
});
