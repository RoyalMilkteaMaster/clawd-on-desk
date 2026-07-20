"use strict";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const MAX_TEXT_LENGTH = 5000;

function createLineNotificationClient({
  getToken,
  getUserId,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  async function sendNotification(text) {
    const message = typeof text === "string" ? text.trim() : "";
    if (!message) return { ok: false, errorClass: "invalid-message" };
    if (typeof fetchImpl !== "function") return { ok: false, errorClass: "fetch-unavailable" };

    const token = typeof getToken === "function" ? String(getToken() || "").trim() : "";
    const userId = typeof getUserId === "function" ? String(getUserId() || "").trim() : "";
    if (!token || !userId) return { ok: false, errorClass: "not-configured" };

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(LINE_PUSH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: userId,
          messages: [{ type: "text", text: message.slice(0, MAX_TEXT_LENGTH) }],
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
  createLineNotificationClient,
  LINE_PUSH_URL,
  MAX_TEXT_LENGTH,
};
