# D2W Diff — プライバシーポリシー / Privacy Policy

---

## 日本語

**最終更新日：2026年4月30日**

本プライバシーポリシーは、Chrome 拡張機能「D2W Diff」（以下「本拡張機能」）における個人情報および利用データの取り扱いについて説明するものです。

---

### 1. 収集する情報

本拡張機能が収集・保存する情報は以下のとおりです。

| 情報 | 保存場所 | 保存期間 |
|------|---------|---------|
| Figma Personal Access Token（PAT） | `chrome.storage.session`（デフォルト）または `chrome.storage.local`（ユーザーが永続保存を選択した場合） | セッション終了まで、または削除するまで |
| Figma URL スロット（最大3件）および読み込み済み画像の URL | `chrome.storage.local` | 削除するまで |
| アップロード画像（Base64 形式、最大3件） | `chrome.storage.local` | 削除するまで |
| オーバーレイ設定（不透明度・オフセット・スケールモード等） | `chrome.storage.local` | 削除するまで |

上記以外の個人情報（氏名・メールアドレス・位置情報など）は一切収集しません。

---

### 2. 情報の利用目的

収集した情報は、以下の目的にのみ使用します。

- Figma の公式 API（`api.figma.com`）からデザイン画像を取得すること
- オーバーレイの表示設定を次回起動時に復元すること

---

### 3. 第三者への提供

本拡張機能は、収集した情報を**第三者に販売・提供・共有しません**。

Figma PAT は、Figma 公式 API（`https://api.figma.com`）にのみ直接送信されます。本拡張機能が管理する中間サーバーは存在しません。

---

### 4. 外部サービスとの通信

本拡張機能が通信する外部サービスは以下のみです。

| サービス | 通信先 | 目的 |
|---------|--------|------|
| Figma API | `https://api.figma.com` | デザイン画像の取得 |

アナリティクス、広告、その他のトラッキングサービスとは一切通信しません。

---

### 5. データのセキュリティ

- Figma PAT は Chrome のサンドボックス内に保管され、他のウェブサイトや拡張機能からアクセスできません。
- 入力フォームは `type="password"` および `autocomplete="off"` で保護されています。
- エラーメッセージから PAT 文字列が漏洩しないよう、自動除去処理を実装しています。
- オーバーレイパネルは Shadow DOM（クローズドモード）で実装されており、閲覧ページの JavaScript・CSS と完全に分離されています。

---

### 6. データの削除

以下の操作でデータを削除できます。

- **Figma PAT**：ポップアップ内「API設定を変更」→ トークンが削除されます。
- **全設定**：Chrome の拡張機能管理ページから本拡張機能をアンインストールすると、すべてのデータが削除されます。

---

### 7. 本ポリシーの変更

本ポリシーを改定した場合は、本ページの「最終更新日」を更新します。重要な変更がある場合は、拡張機能のアップデートを通じてお知らせします。

---

### 8. お問い合わせ

本プライバシーポリシーに関するご質問は、以下までお問い合わせください。

**開発者：** togetoge  
**メール：** mensisinfinitum@gmail.com

---
---

## English

**Last updated: April 30, 2026**

This Privacy Policy describes how the Chrome extension "D2W Diff" (the "Extension") handles information collected during its use.

---

### 1. Information We Collect

The Extension collects and stores only the following information:

| Information | Storage Location | Retention |
|-------------|-----------------|-----------|
| Figma Personal Access Token (PAT) | `chrome.storage.session` (default) or `chrome.storage.local` (if persistent storage is selected by the user) | Until session ends or manually deleted |
| Figma URL slots (up to 3) and fetched image URLs | `chrome.storage.local` | Until manually deleted |
| Uploaded images (Base64 format, up to 3) | `chrome.storage.local` | Until manually deleted |
| Overlay settings (opacity, offset, scale mode, etc.) | `chrome.storage.local` | Until manually deleted |

No other personal information (such as name, email address, or location) is collected.

---

### 2. How We Use Information

Collected information is used solely for the following purposes:

- Fetching design images from the official Figma API (`api.figma.com`)
- Restoring overlay display settings on subsequent launches

---

### 3. Information Sharing

The Extension does **not** sell, share, or transfer any collected information to third parties.

Your Figma PAT is transmitted only directly to the official Figma API (`https://api.figma.com`). The Extension operates without any intermediate server.

---

### 4. External Communications

The Extension communicates only with the following external service:

| Service | Endpoint | Purpose |
|---------|----------|---------|
| Figma API | `https://api.figma.com` | Fetching design images |

The Extension does not communicate with any analytics, advertising, or tracking services.

---

### 5. Data Security

- Your Figma PAT is stored within Chrome's sandbox and is inaccessible to other websites or extensions.
- The input form uses `type="password"` and `autocomplete="off"` to protect token entry.
- An automatic sanitization process (`sanitizeError`) prevents PAT strings from appearing in error messages.
- The overlay control panel is implemented using a closed Shadow DOM, fully isolating it from the host page's JavaScript and CSS.

---

### 6. Data Deletion

You can delete your data at any time:

- **Figma PAT**: Click "Change API settings" in the popup to remove the stored token.
- **All data**: Uninstalling the Extension from Chrome's extension management page removes all stored data.

---

### 7. Changes to This Policy

If this policy is updated, the "Last updated" date at the top of this page will be revised. Significant changes will be communicated via an extension update.

---

### 8. Contact

If you have any questions about this Privacy Policy, please contact:

**Developer:** togetoge  
**Email:** mensisinfinitum@gmail.com
