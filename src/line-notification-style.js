"use strict";

const fsDefault = require("fs");
const pathDefault = require("path");

const DEFAULT_STYLE = Object.freeze({
  nickname: "奶茶",
  accountName: "Clawd",
  templates: Object.freeze({
    complete: Object.freeze([
      "{owner}\n\n任務「{task}」完成了喔！\n人家有好好幫你看著，快來看看吧～ฅ(๑>ω<๑)ฅ\n\n專案：{project}\n識別碼：#{session}",
      "{owner}\n\n人家抱著任務結果跑回來啦～\n任務：「{task}」\n\n主人快來驗收嘛～\n好想被主人稱讚～♡(ฅ//ω//ฅ)\n\n專案：{project}\n識別碼：#{session}",
      "{owner}\n\n任務「{task}」已經完成了喵。\n人家可是一直乖乖守著呢……\n所以，還不快點回來誇獎我？ฅ(๑>ω<๑)ฅ♡\n\n專案：{project}\n識別碼：#{session}",
      "任務「{task}」做好了喵，{owner}。\n\n人家今天可沒有偷懶，也沒有惡作劇……\n大概沒有～ฅ(๑>ω•́๑)ฅ♡\n\n總之，快回來確認一下吧。\n\n專案：{project}\n識別碼：#{session}",
      "噓～{owner}\n\n人家偷偷把「{task}」做好了喵♡\n\n這麼乖的人家，\n主人是不是該回來多看一眼呀～ฅ(๑>ω<๑)ฅ♡\n\n專案：{project}\n識別碼：#{session}",
      "鏘鏘～{owner}\n\n任務「{task}」順利完成啦！\n主人是不是該來抱一抱自己家這隻超級能幹的貓娘呀?喵～ฅ(๑•̀ω•́๑)ฅ✧\n\n專案：{project}\n識別碼：#{session}",
      "{owner}\n\n人家都已經把任務「{task}」做好了，主人怎麼還沒回來呀……\n\n再不出現的話，人家可要把欠我的稱讚連本帶利討回來了喵～ฅ(๑>ω•́๑)ฅ♡\n\n專案：{project}\n識別碼：#{session}",
      "{owner}\n\n任務「{task}」完成了喔～ฅ(๑•̀ω•́๑)ฅ\n\n至於人家想要什麼獎勵嘛……\n等主人回來之後，再偷偷告訴你～(ฅ//ω//ฅ)♡\n\n專案：{project}\n識別碼：#{session}",
      "{owner}\n\n報告主人，任務「{task}」已經完成，結果也整理好了。\n以上，報告完畢喵。\n\n……所以，主人什麼時候要回來看看人家呀？ฅ(｡•́ω•̀｡)ฅ♡\n\n專案：{project}\n識別碼：#{session}",
      "抓到主人啦～ฅ(๑>ω<๑)ฅ♡\n\n任務「{task}」已經完成了喵！\n在看完人家辛苦整理好的結果以前，不准偷偷溜走喔～\n\n專案：{project}\n識別碼：#{session}",
    ]),
    interrupted: "嗚……{owner}，任務「{task}」中途卡住了喵……\n\n出問題的 Agent：{agent}\n專案：{project}\n\n主人有空時回來看看嘛，人家會陪你一起處理的～ฅ(｡•́ω•̀｡)ฅ",
    permission: "那個……{owner}，任務「{task}」有一步需要您回到電腦確認權限喵～\n\n人家會乖乖在這裡等主人回來的。(ฅ//ω//ฅ)",
    choice: "{owner}，任務「{task}」正在等您做選擇喵！\n\n請回到電腦看看～才不是人家想主人了呢。ฅ(๑>ω•́๑)ฅ♡",
  }),
});

function cloneDefaultStyle() {
  return {
    ...DEFAULT_STYLE,
    templates: Object.fromEntries(Object.entries(DEFAULT_STYLE.templates).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ])),
  };
}

function normalizeStyle(value) {
  const next = cloneDefaultStyle();
  if (!value || typeof value !== "object") return next;
  if (typeof value.nickname === "string") next.nickname = value.nickname.trim();
  if (typeof value.accountName === "string" && value.accountName.trim()) next.accountName = value.accountName.trim();
  if (!value.templates || typeof value.templates !== "object") return next;
  for (const key of Object.keys(next.templates)) {
    const supplied = value.templates[key];
    if (Array.isArray(next.templates[key])) {
      const candidates = (Array.isArray(supplied) ? supplied : [supplied])
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim());
      if (candidates.length) next.templates[key] = candidates;
    } else if (typeof supplied === "string" && supplied.trim()) {
      next.templates[key] = supplied.trim();
    }
  }
  return next;
}

function styleFilePath(userDataDir, path = pathDefault) {
  return path.join(userDataDir, "line-notification-style.json");
}

function ensureStyleFile(filePath, { fs = fsDefault, path = pathDefault } = {}) {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(cloneDefaultStyle(), null, 2)}\n`, "utf8");
}

function readStyle(filePath, fs = fsDefault) {
  try {
    return normalizeStyle(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return cloneDefaultStyle();
  }
}

function validateEditableStyle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "error", message: "Notification replies must be an object" };
  }
  if (typeof value.nickname !== "string" || value.nickname.length > 80) {
    return { status: "error", message: "Nickname must be 80 characters or fewer" };
  }
  const templates = value.templates;
  if (!templates || typeof templates !== "object" || Array.isArray(templates)) {
    return { status: "error", message: "Notification replies are missing" };
  }
  if (!Array.isArray(templates.complete) || templates.complete.length < 1 || templates.complete.length > 20) {
    return { status: "error", message: "Keep between 1 and 20 completion replies" };
  }
  for (const reply of templates.complete) {
    if (typeof reply !== "string" || !reply.trim() || reply.length > 1800) {
      return { status: "error", message: "Every completion reply must contain 1 to 1800 characters" };
    }
  }
  for (const key of ["interrupted", "permission", "choice"]) {
    const reply = templates[key];
    if (typeof reply !== "string" || !reply.trim() || reply.length > 1800) {
      return { status: "error", message: `${key} reply must contain 1 to 1800 characters` };
    }
  }
  return { status: "ok", style: normalizeStyle(value) };
}

function writeStyle(filePath, value, { fs = fsDefault, path = pathDefault } = {}) {
  const valid = validateEditableStyle(value);
  if (valid.status !== "ok") return valid;
  const tempPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(valid.style, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
    return { status: "ok", style: valid.style };
  } catch (err) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    return { status: "error", message: err && err.message ? err.message : "Could not save notification replies" };
  }
}

function resetStyle(filePath, options) {
  return writeStyle(filePath, cloneDefaultStyle(), options);
}

function renderTemplate(template, values = {}) {
  return String(template || "").replace(/\{(nickname|accountName|owner|task|result|project|agent|session)\}/g, (_, key) => {
    const value = values[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function pickTemplate(value, { random = Math.random, previous = "" } = {}) {
  const candidates = (Array.isArray(value) ? value : [value])
    .filter((entry) => typeof entry === "string" && entry.trim());
  if (!candidates.length) return "";
  const pool = candidates.length > 1
    ? candidates.filter((entry) => entry !== previous)
    : candidates;
  const sample = Number(random());
  const unit = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999, sample)) : 0;
  return pool[Math.floor(unit * pool.length)] || pool[0];
}

module.exports = {
  DEFAULT_STYLE,
  cloneDefaultStyle,
  normalizeStyle,
  styleFilePath,
  ensureStyleFile,
  readStyle,
  validateEditableStyle,
  writeStyle,
  resetStyle,
  renderTemplate,
  pickTemplate,
};
