"use strict";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_USER_AGENT = "DiscordBot (https://github.com/RoyalMilkteaMaster/clawd-on-desk, 0.12.1)";
const MAX_TEXT_LENGTH = 2000;

function createDiscordBotClient({
  getToken,
  getChannelId,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  async function sendNotification(text) {
    const message = typeof text === "string" ? text.trim() : "";
    if (!message) return { ok: false, errorClass: "invalid-message" };
    if (typeof fetchImpl !== "function") return { ok: false, errorClass: "fetch-unavailable" };

    const token = typeof getToken === "function" ? String(getToken() || "").trim() : "";
    const channelId = typeof getChannelId === "function" ? String(getChannelId() || "").trim() : "";
    if (!token || !channelId) return { ok: false, errorClass: "not-configured" };

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
          "User-Agent": DISCORD_USER_AGENT,
        },
        body: JSON.stringify({
          content: message.slice(0, MAX_TEXT_LENGTH),
          allowed_mentions: { parse: [] },
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response || response.ok !== true) {
        return { ok: false, errorClass: String(response && response.status ? response.status : "http-error") };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        errorClass: err && err.name === "AbortError" ? "timeout" : "network-error",
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { sendNotification };
}

module.exports = {
  createDiscordBotClient,
  DISCORD_API_BASE,
  DISCORD_USER_AGENT,
  MAX_TEXT_LENGTH,
};
