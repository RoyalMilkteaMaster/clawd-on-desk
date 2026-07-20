"use strict";

const path = require("path");

const DEFAULT_FEISHU_APPROVAL = Object.freeze({
  enabled: false,
  platform: "feishu",
  idType: "open_id",
  approverId: "",
  connectionTimeoutSeconds: 15,
});

// Feishu (China) and Lark (international) are separate deployments of the same
// product with separate API hosts. The value only ever selects an official SDK
// domain enum — users cannot type a host, so an App Secret can never be sent to
// a non-official server. Old configs have no platform key and normalize to
// "feishu", which is what they were implicitly using before this field existed.
const FEISHU_PLATFORMS = new Set(["feishu", "lark"]);
const FEISHU_ID_TYPES = new Set(["open_id", "user_id", "union_id"]);
const CONNECTION_TIMEOUT_SECONDS = new Set([5, 10, 15, 30, 60]);
const SECRET_KEYS = Object.freeze({
  appId: "FEISHU_APP_ID",
  appSecret: "FEISHU_APP_SECRET",
  verificationToken: "FEISHU_VERIFICATION_TOKEN",
  encryptKey: "FEISHU_ENCRYPT_KEY",
});

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function trimString(value, maxLen = 512) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

function cloneDefaultFeishuApproval() {
  return { ...DEFAULT_FEISHU_APPROVAL };
}

function normalizeConnectionTimeoutSeconds(value, fallback = DEFAULT_FEISHU_APPROVAL.connectionTimeoutSeconds) {
  const numeric = Number(value);
  return CONNECTION_TIMEOUT_SECONDS.has(numeric) ? numeric : fallback;
}

function normalizeFeishuApproval(value, defaultsValue = DEFAULT_FEISHU_APPROVAL) {
  const defaults = isPlainObject(defaultsValue) ? defaultsValue : DEFAULT_FEISHU_APPROVAL;
  const defaultPlatform = FEISHU_PLATFORMS.has(defaults.platform) ? defaults.platform : DEFAULT_FEISHU_APPROVAL.platform;
  const defaultIdType = FEISHU_ID_TYPES.has(defaults.idType) ? defaults.idType : DEFAULT_FEISHU_APPROVAL.idType;
  const defaultTimeout = normalizeConnectionTimeoutSeconds(defaults.connectionTimeoutSeconds);
  const out = {
    enabled: defaults.enabled === true,
    platform: defaultPlatform,
    idType: defaultIdType,
    approverId: trimString(defaults.approverId, 128),
    connectionTimeoutSeconds: defaultTimeout,
  };
  if (!isPlainObject(value)) return out;
  if (typeof value.enabled === "boolean") out.enabled = value.enabled;
  if (typeof value.platform === "string") {
    const platform = trimString(value.platform, 32);
    out.platform = FEISHU_PLATFORMS.has(platform) ? platform : DEFAULT_FEISHU_APPROVAL.platform;
  }
  if (typeof value.idType === "string") {
    const idType = trimString(value.idType, 32);
    out.idType = FEISHU_ID_TYPES.has(idType) ? idType : DEFAULT_FEISHU_APPROVAL.idType;
  }
  if (typeof value.approverId === "string") out.approverId = trimString(value.approverId, 128);
  if (value.connectionTimeoutSeconds !== undefined) {
    out.connectionTimeoutSeconds = normalizeConnectionTimeoutSeconds(value.connectionTimeoutSeconds, defaultTimeout);
  }
  return out;
}

function validateFeishuApproval(value) {
  if (!isPlainObject(value)) return { status: "error", message: "feishuApproval must be a plain object" };
  for (const key of Object.keys(value)) {
    if (key !== "enabled" && key !== "platform" && key !== "idType" && key !== "approverId" && key !== "connectionTimeoutSeconds") {
      return { status: "error", message: `feishuApproval.${key} is not supported` };
    }
  }
  if (typeof value.enabled !== "boolean") {
    return { status: "error", message: "feishuApproval.enabled must be a boolean" };
  }
  // Optional on the way in — configs saved before the platform field existed
  // (and any caller that omits it) stay valid and normalize to "feishu". A
  // present value must be one of the two official deployments; an arbitrary
  // host is never accepted here or anywhere downstream.
  if (value.platform !== undefined && !FEISHU_PLATFORMS.has(value.platform)) {
    return { status: "error", message: "feishuApproval.platform must be feishu or lark" };
  }
  if (!FEISHU_ID_TYPES.has(value.idType)) {
    return { status: "error", message: "feishuApproval.idType must be open_id, user_id, or union_id" };
  }
  if (typeof value.approverId !== "string") {
    return { status: "error", message: "feishuApproval.approverId must be a string" };
  }
  if (value.approverId.length > 128) {
    return { status: "error", message: "feishuApproval.approverId is too long" };
  }
  if (value.connectionTimeoutSeconds !== undefined && !CONNECTION_TIMEOUT_SECONDS.has(Number(value.connectionTimeoutSeconds))) {
    return { status: "error", message: "feishuApproval.connectionTimeoutSeconds must be 5, 10, 15, 30, or 60" };
  }
  return { status: "ok" };
}

function defaultSecretsEnvFilePath(userDataDir) {
  return userDataDir ? path.join(userDataDir, "feishu-approval.env") : "";
}

function parseEnvText(text) {
  const out = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function readSecretsEnvFile({ fs, filePath } = {}) {
  if (!fs || !filePath || typeof fs.readFileSync !== "function") {
    return { appId: "", appSecret: "", verificationToken: "", encryptKey: "" };
  }
  let parsed = {};
  try {
    parsed = parseEnvText(fs.readFileSync(filePath, "utf8"));
  } catch {
    parsed = {};
  }
  return {
    appId: trimString(parsed[SECRET_KEYS.appId], 256),
    appSecret: trimString(parsed[SECRET_KEYS.appSecret], 512),
    verificationToken: trimString(parsed[SECRET_KEYS.verificationToken], 512),
    encryptKey: trimString(parsed[SECRET_KEYS.encryptKey], 512),
  };
}

function buildSecretsEnvFile(secrets) {
  const source = isPlainObject(secrets) ? secrets : {};
  return [
    `${SECRET_KEYS.appId}=${trimString(source.appId, 256)}`,
    `${SECRET_KEYS.appSecret}=${trimString(source.appSecret, 512)}`,
    `${SECRET_KEYS.verificationToken}=${trimString(source.verificationToken, 512)}`,
    `${SECRET_KEYS.encryptKey}=${trimString(source.encryptKey, 512)}`,
    "",
  ].join("\n");
}

// Errors here are user-visible (the settings page shows them on a failed save),
// so they carry a stable `code` for the UI to localize and stay brand-neutral:
// the same writer serves Feishu and Lark, and a disk/permission failure has
// nothing to do with which platform was picked. `message` remains the English
// diagnostic — it names the real cause (EACCES, ENOSPC…) and is the only clue
// worth showing alongside the translated copy.
function writeSecretsEnvFile({ fs, path: pathModule = path, filePath, secrets, platform = process.platform } = {}) {
  if (!fs || typeof fs.writeFileSync !== "function") {
    return { status: "error", code: "write-failed", message: "writeSecretsEnvFile requires fs" };
  }
  if (!filePath || typeof filePath !== "string") {
    return { status: "error", code: "write-failed", message: "Secrets env file path is required" };
  }
  const current = readSecretsEnvFile({ fs, filePath });
  const incoming = isPlainObject(secrets) ? secrets : {};
  const next = { ...current };
  for (const key of Object.keys(SECRET_KEYS)) {
    if (typeof incoming[key] === "string" && incoming[key].trim()) {
      next[key] = trimString(incoming[key], key === "appId" ? 256 : 512);
    }
  }
  try {
    fs.mkdirSync(pathModule.dirname(filePath), { recursive: true });
    const base = pathModule.basename(filePath);
    const tmpPath = pathModule.join(
      pathModule.dirname(filePath),
      `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    );
    fs.writeFileSync(tmpPath, buildSecretsEnvFile(next), { encoding: "utf8", mode: 0o600 });
    if (platform !== "win32" && typeof fs.chmodSync === "function") {
      try { fs.chmodSync(tmpPath, 0o600); } catch {}
    }
    fs.renameSync(tmpPath, filePath);
    if (platform !== "win32" && typeof fs.chmodSync === "function") {
      try { fs.chmodSync(filePath, 0o600); } catch {}
    }
    return { status: "ok", secretsStored: true, filePath };
  } catch (err) {
    return {
      status: "error",
      code: "write-failed",
      message: `Secrets write failed: ${err && err.message}`,
    };
  }
}

function maskSecret(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.length < 10) return "****";
  return `${text.slice(0, 4)}......${text.slice(-4)}`;
}

function readMaskedSecrets({ fs, filePath } = {}) {
  const secrets = readSecretsEnvFile({ fs, filePath });
  const configured = !!(secrets.appId && secrets.appSecret);
  return {
    configured,
    appId: maskSecret(secrets.appId),
    appSecret: maskSecret(secrets.appSecret),
    verificationToken: maskSecret(secrets.verificationToken),
    encryptKey: maskSecret(secrets.encryptKey),
  };
}

function secretStatus({ fs, filePath } = {}) {
  const secrets = readSecretsEnvFile({ fs, filePath });
  let fileExists = false;
  let secretFileMtimeMs = 0;
  if (fs && filePath && typeof fs.existsSync === "function") {
    try { fileExists = fs.existsSync(filePath); } catch { fileExists = false; }
    if (fileExists && typeof fs.statSync === "function") {
      try {
        const stat = fs.statSync(filePath);
        secretFileMtimeMs = stat && Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
      } catch {
        secretFileMtimeMs = 0;
      }
    }
  }
  return {
    secretStored: fileExists,
    secretConfigured: !!(secrets.appId && secrets.appSecret),
    secretFileMtimeMs,
  };
}

// `reason` is the stable code the UI maps to a localized, platform-aware
// string; `message` stays English and brand-neutral because it is a log/
// fallback diagnostic that can surface under either platform. Never name a
// single brand here — a Lark user reading "Feishu App ID is invalid" is being
// told their (correct) setup is wrong.
function readiness(config, secrets) {
  const normalized = normalizeFeishuApproval(config);
  if (!normalized.enabled) return { ready: false, reason: "disabled", config: normalized };
  const valid = validateFeishuApproval(normalized);
  if (valid.status !== "ok") return { ready: false, reason: "invalid-config", message: valid.message, config: normalized };
  if (!normalized.approverId) {
    return { ready: false, reason: "invalid-config", message: "Approver id is not configured", config: normalized };
  }
  if (!secrets || !secrets.appId || !secrets.appSecret) {
    return { ready: false, reason: "missing-secret", message: "App ID and App Secret are not configured", config: normalized };
  }
  // Self-built apps use the `cli_` prefix on BOTH Feishu and Lark, so this
  // format gate stays platform-independent (and is why credentials alone
  // cannot be used to auto-detect the platform).
  const appId = String(secrets.appId || "").trim();
  if (!/^cli_[A-Za-z0-9_-]+$/.test(appId)) {
    return { ready: false, reason: "invalid-secret", message: "App ID format is invalid", config: normalized };
  }
  return { ready: true, config: normalized };
}

function redactionSecretsForFeishuApproval(config, secrets) {
  const normalized = normalizeFeishuApproval(config);
  const sourceSecrets = secrets && typeof secrets === "object" ? secrets : {};
  return [
    normalized.approverId,
    sourceSecrets.appId,
    sourceSecrets.appSecret,
    sourceSecrets.verificationToken,
    sourceSecrets.encryptKey,
  ].filter(Boolean);
}

module.exports = {
  DEFAULT_FEISHU_APPROVAL,
  FEISHU_PLATFORMS,
  FEISHU_ID_TYPES,
  CONNECTION_TIMEOUT_SECONDS,
  cloneDefaultFeishuApproval,
  normalizeFeishuApproval,
  validateFeishuApproval,
  defaultSecretsEnvFilePath,
  readSecretsEnvFile,
  writeSecretsEnvFile,
  readMaskedSecrets,
  secretStatus,
  readiness,
  redactionSecretsForFeishuApproval,
  maskSecret,
};
