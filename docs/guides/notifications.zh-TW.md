# Discord／LINE 選配通知安裝指南

Discord 與 LINE 通知是選配功能。只使用桌面寵物與狀態列時，不需要設定任何 Bot、Token 或 JSON。

## 先了解資料放在哪裡

- Discord 與 LINE 預設關閉。
- Token 不會包在安裝檔或 Git repository 裡。
- 每個 Windows 使用者都要設定自己的 Bot Token 與接收 ID。
- Token 儲存在 `%APPDATA%\clawd-on-desk` 的獨立檔案。
- 暱稱與通知回應由 `設定…` → `通知回應` 編輯；一般使用者不需要碰 JSON。
- 完成通知只接受大專案／根任務，Codex 子 agent 不會各自傳送完成訊息。

不要把 Discord Bot Token、LINE Channel Access Token、整個 `%APPDATA%\clawd-on-desk` 資料夾或包含 Token 的截圖上傳到 GitHub。

---

## Discord Bot 通知

### 需要準備什麼

- 一個 Discord 帳號。
- 一個你有「管理伺服器」權限的測試伺服器。
- Discord Bot Token。
- 要接收通知的文字頻道 ID。

### 1. 建立 Discord Application 與 Bot

1. 開啟 [Discord Developer Portal](https://discord.com/developers/applications)。
2. 按 `New Application`，輸入名稱後建立。
3. 左側開啟 `Bot`。
4. 如果尚未建立 Bot，按 `Add Bot`。
5. 在 Token 區域按 `Reset Token` 或 `Copy`，完成驗證後複製 Token。
6. Token 只貼到 Clawd 的 `設定…` → `Discord Bot`，不要貼到聊天、Issue 或 GitHub。

不需要開啟 `Message Content Intent`。Clawd 只用 Bot REST API 主動傳送通知，不讀取 Discord 訊息。

### 2. 使用 Guild Install 加入伺服器

1. Developer Portal 左側開啟 `Installation`。
2. 在 `Installation Contexts` 啟用 `Guild Install`。
3. 在 `Default Install Settings` 的 `Guild Install` 加入 Scope：`bot`。
4. Bot Permissions 至少選擇：
   - `View Channels`
   - `Send Messages`
5. 按 `Save Changes`。
6. 複製 Install Link，在瀏覽器開啟。
7. 在「新增至伺服器」選擇測試伺服器並授權。

Discord 官方參考：[建立 Bot](https://docs.discord.com/developers/quick-start/getting-started)、[權限說明](https://docs.discord.com/developers/topics/permissions)。

### 3. 取得文字頻道 ID

1. Discord `使用者設定` → `進階` → 開啟 `開發者模式`。
2. 對目標文字頻道按右鍵。
3. 選擇 `複製頻道 ID`。

請勿混用以下 ID：

| 名稱 | 用途 | 要不要填進 Discord Bot 通知 |
|---|---|---|
| Application ID | Discord Application／Rich Presence | 不要 |
| Bot Token | Bot 呼叫 Discord API 的密鑰 | 要 |
| Server／Guild ID | 安裝目標伺服器 | 不要 |
| Channel ID | 實際接收訊息的文字頻道 | 要 |
| User ID | Discord 使用者識別碼 | 不要 |

`設定…` → `Discord 狀態` 裡的 Application ID 是 Rich Presence 功能，與 `Discord Bot` 通知不同。

### 4. 在 Clawd 啟用

1. 開啟 `設定…` → `Discord Bot`。
2. 貼上 Bot Token，按 `儲存 Token`。
3. 貼上文字頻道 ID，按儲存。
4. 按 `傳送測試`。
5. 收到測試訊息後，開啟 Discord 通知與完成通知。

Clawd 必須正在執行，才能在任務完成、任務中斷或需要權限／選擇時傳送通知。

### Discord 常見問題

#### Bot 是灰色／離線，但測試訊息可以送出

這是正常現象。此版本使用 REST API 發送通知，沒有連接 Discord Gateway，因此 Bot 不會顯示成持續在線。灰色不代表不能傳送訊息，以 `傳送測試` 結果為準。

#### 找不到「新增至伺服器」

- 確認 `Installation` 已啟用 `Guild Install`。
- 確認 Guild Install Scope 包含 `bot`。
- 按 `Save Changes` 後重新複製 Install Link。
- 你的 Discord 帳號必須有該伺服器的「管理伺服器」權限。

#### `401`／Bot Token 被拒絕

- 貼到 Clawd 的必須是 `Bot` 頁面的 Token，不是 Application ID、Public Key 或 Client Secret。
- 不要在 Token 前面自行加上 `Bot `；Clawd 會自動加入。
- 如果按過 `Reset Token`，舊 Token 立即失效，必須把新 Token 重新存進 Clawd。
- Token 曾公開時，立刻在 Developer Portal 重設。

#### `403`／Bot 無法傳送訊息

依序檢查：

1. Bot 是否真的安裝在該伺服器。
2. Bot 角色是否有 `View Channels` 與 `Send Messages`。
3. 目標頻道的權限覆寫是否拒絕 Bot 或 Bot 角色。
4. 填入的是文字頻道 ID，不是 Server ID。
5. 若舊版 `0.12.1-discord.9` 在權限全開時仍回傳 `403`，更新到 `0.12.1-notifications.10`；新版已補上 Discord API 要求的 Bot User-Agent。

#### `404`／找不到頻道

- 頻道 ID 錯誤、頻道已刪除，或 Bot 看不到該頻道。
- 重新開啟開發者模式並複製文字頻道 ID。

#### `429`／請求過多

Discord 正在限制傳送頻率。等待後再測試，不要連續快速按測試按鈕。

#### 測試成功，但任務完成沒有通知

- 確認 Discord 通知與完成通知開關都已開啟。
- Clawd 必須持續執行。
- 只有大專案／根任務完成才通知；子 agent 完成不通知。
- 已經完成後才啟動 Clawd 的舊事件不會補發，以免重新啟動時洗版。

---

## LINE 手機通知

本功能使用 LINE Messaging API。LINE Notify 已在 2025 年 3 月 31 日終止，舊的 LINE Notify Token 不能使用。[LINE 官方終止公告](https://developers.line.biz/en/news/2025/04/01/line-notify/)

目前 MVP 只支援傳送給一個 `U` 開頭的 LINE 使用者 ID，不支援直接填入群組 ID。

### 1. 建立 Messaging API Channel

1. 開啟 [LINE Developers Console](https://developers.line.biz/console/)。
2. 建立或選擇 Provider。
3. 建立 LINE Official Account，並為它啟用 Messaging API Channel。
4. 依照 LINE 官方的 [Messaging API 入門指南](https://developers.line.biz/en/docs/messaging-api/getting-started/) 完成基本設定。

### 2. 取得 Channel Access Token

1. 開啟 Messaging API Channel。
2. 進入 `Messaging API` 分頁。
3. 在 `Channel access token` 區域發行 Token。
4. 複製 Token，只貼到 Clawd 的 `設定…` → `LINE 手機通知`。

Token 類型與生命週期請參考 [LINE Channel Access Token 官方文件](https://developers.line.biz/en/docs/basics/channel-access-token/)。Token 被重發或撤銷後，Clawd 裡的舊 Token 也必須更新。

### 3. 取得 LINE User ID

LINE User ID 不是顯示名稱、電話號碼、搜尋用 LINE ID 或 Official Account Basic ID。正確格式為：

```text
U + 32 個十六進位字元
```

如果你是 Channel 開發者：

1. 先把 LINE 帳號連結到 LINE Business ID。
2. 開啟 Channel 的 `Basic settings`。
3. 複製 `Your user ID`。

其他使用者的 User ID 通常要從加入好友或傳訊息時收到的 webhook 事件取得。完整方式見 [LINE 取得 User ID](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)。

### 4. 加入好友並在 Clawd 啟用

1. 用接收通知的 LINE 帳號加入該 LINE Official Account 為好友。
2. 開啟 Clawd `設定…` → `LINE 手機通知`。
3. 儲存 Channel Access Token。
4. 儲存 `U` 開頭的 User ID。
5. 按 `傳送測試`。
6. 收到測試後，開啟 LINE 通知、完成通知與需要確認時通知。

### LINE 常見問題

#### LINE Notify Token 完全不能用

LINE Notify 已終止。請建立 Messaging API Channel，使用 Channel Access Token，不要使用以前從 `notify-bot.line.me` 取得的 Token。

#### User ID 格式錯誤

- 必須是 `U` 加 32 個十六進位字元。
- 不可填顯示名稱、手機號碼、搜尋用 LINE ID、Channel ID 或 Basic ID。
- 不同 Provider 下，同一個 LINE 使用者可能有不同 User ID。

#### `400`／傳送內容或接收者無效

- 重新確認 User ID 格式與 Channel 所屬 Provider。
- 確認該 User ID 對目前 Messaging API Channel 有效。

#### `401`／Channel Access Token 被拒絕

- Token 已撤銷、過期、複製不完整，或來自不同 Channel。
- 在 LINE Developers Console 發行新 Token，再存回 Clawd。

#### 無錯誤但手機沒收到

- 確認接收者已加入 Official Account 為好友，而且沒有封鎖它。
- 確認 User ID 與 Channel 位於正確 Provider。
- 查看 Official Account 的訊息額度是否已用完。

#### `429`／訊息額度或 API 頻率限制

等待限制解除，並到 LINE Official Account Manager 檢查本月訊息額度。LINE Push Message 行為與限制見 [LINE 傳送訊息文件](https://developers.line.biz/en/docs/messaging-api/sending-messages/)。

---

## 修改暱稱與隨機回應

1. 開啟 `設定…` → `通知回應`。
2. 修改暱稱。
3. 新增、刪除或編輯完成回應；每次完成會隨機抽選，並避免立刻重複上一則。
4. 也可以修改任務中斷、權限確認與等待選擇的回應。
5. 按儲存。

可用變數：`{owner}`、`{task}`、`{project}`、`{agent}`、`{session}`。

Discord 與 LINE 共用這套通知回應。修改一次即可同時生效。

## 如果通知回應設定損壞

優先使用不需要碰 JSON 的方式：

1. 開啟 `設定…` → `通知回應`。
2. 按 `重設回應`。
3. 再按儲存。

如果設定頁無法儲存：

1. 完全關閉 Clawd。
2. 開啟 `%APPDATA%\clawd-on-desk`。
3. 將 `line-notification-style.json` 改名成 `line-notification-style.json.backup`。
4. 重新啟動 Clawd；程式會自動建立新的預設檔。

不要刪除 `discord-bot-token` 或 `line-notifications-token`，除非你確定要清除已儲存的 Token。
