'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PAT_REGEX = /^figd_[A-Za-z0-9_-]{20,}$/;
const FILE_KEY_REGEX = /^[a-zA-Z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/** Remove any accidental token leaks from error strings before surfacing them */
function sanitizeError(msg) {
  return String(msg).replace(/figd_[A-Za-z0-9_-]+/g, '[REDACTED]');
}

function validateToken(token) {
  return typeof token === 'string' && PAT_REGEX.test(token);
}

// ---------------------------------------------------------------------------
// Figma URL parser
// Supports:
//   figma.com/file/{key}/...?node-id=1-2
//   figma.com/design/{key}/...?node-id=1-2
//   figma.com/proto/{key}/...?node-id=1-2
// ---------------------------------------------------------------------------
function parseFigmaUrl(rawUrl) {
  let urlObj;
  try {
    urlObj = new URL(rawUrl);
  } catch {
    return null;
  }

  if (urlObj.hostname !== 'figma.com' && urlObj.hostname !== 'www.figma.com') return null;

  const parts = urlObj.pathname.split('/').filter(Boolean);
  // parts[0] = 'file' | 'design' | 'proto', parts[1] = fileKey
  const typeIdx = parts.findIndex((p) => ['file', 'design', 'proto'].includes(p));
  if (typeIdx === -1 || typeIdx + 1 >= parts.length) return null;

  const fileKey = parts[typeIdx + 1];
  if (!fileKey || !FILE_KEY_REGEX.test(fileKey)) return null;

  const rawNodeId = urlObj.searchParams.get('node-id');
  if (!rawNodeId) return null;

  // URL format: "1-2"  →  API format: "1:2"
  // Also handle URL-encoded colon: "1%3A2" → "1:2"
  const apiNodeId = decodeURIComponent(rawNodeId).replace(/-/g, ':');

  // Basic sanity check: must look like digits:digits (allows compound ids)
  if (!/^\d+:\d+/.test(apiNodeId)) return null;

  return { fileKey, nodeId: apiNodeId };
}

// ---------------------------------------------------------------------------
// Figma API
// ---------------------------------------------------------------------------
async function fetchFigmaImage(fileKey, nodeId, scale, token) {
  const clampedScale = Math.max(0.5, Math.min(4, Number(scale) || 2));
  const params = new URLSearchParams({
    ids: nodeId,
    scale: String(clampedScale),
    format: 'png',
  });

  let response;
  try {
    response = await fetch(
      `https://api.figma.com/v1/images/${encodeURIComponent(fileKey)}?${params}`,
      { method: 'GET', headers: { 'X-Figma-Token': token } }
    );
  } catch {
    throw new Error('ネットワークエラーが発生しました。インターネット接続を確認してください。');
  }

  switch (response.status) {
    case 200: break;
    case 400: throw new Error('Figma APIへのリクエストが不正です。URLを確認してください。');
    case 401:
    case 403: throw new Error('Figmaトークンが無効です。PATを再入力してください。');
    case 404: throw new Error('ファイルまたはノードが見つかりません。Figma URLを確認してください。');
    case 429: throw new Error('Figma APIのレート制限に達しました。しばらく待ってから再試行してください。');
    default:  throw new Error(`Figma APIエラー (HTTP ${response.status})`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Figma APIから予期しない応答がありました。');
  }

  if (data.err) throw new Error('Figma APIがエラーを返しました。URLとnode-idを確認してください。');

  const images = data.images ?? {};
  // Figma may return the node id with colon or %3A – try both
  const imageUrl =
    images[nodeId] ??
    images[nodeId.replace(/:/g, '%3A')] ??
    Object.values(images)[0];

  if (!imageUrl) {
    throw new Error('このノードの画像が取得できませんでした。URLのnode-idを確認してください。');
  }

  return imageUrl;
}

// ---------------------------------------------------------------------------
// Token storage helpers (session = in-memory; local = persisted)
// ---------------------------------------------------------------------------
async function getToken() {
  try {
    const session = await chrome.storage.session.get('figma_pat');
    if (session.figma_pat) return session.figma_pat;
    const local = await chrome.storage.local.get('figma_pat');
    return local.figma_pat ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Message dispatcher
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || typeof msg.type !== 'string') {
        sendResponse({ ok: false, error: '不正なメッセージです。' });
        return;
      }

      switch (msg.type) {

        // ── Save token ──────────────────────────────────────────────────────
        case 'SAVE_TOKEN': {
          const { token, persist } = msg;
          if (!validateToken(token)) {
            sendResponse({ ok: false, error: 'トークンの形式が正しくありません。Figma PATは "figd_" から始まります。' });
            return;
          }
          // Always cache in session (memory-only)
          await chrome.storage.session.set({ figma_pat: token });
          if (persist) {
            await chrome.storage.local.set({ figma_pat: token });
          } else {
            await chrome.storage.local.remove('figma_pat');
          }
          sendResponse({ ok: true });
          break;
        }

        // ── Clear token ──────────────────────────────────────────────────────
        case 'CLEAR_TOKEN': {
          await chrome.storage.session.remove('figma_pat');
          await chrome.storage.local.remove('figma_pat');
          sendResponse({ ok: true });
          break;
        }

        // ── Check token presence ─────────────────────────────────────────────
        case 'HAS_TOKEN': {
          const token = await getToken();
          sendResponse({ ok: true, hasToken: !!token });
          break;
        }

        // ── Fetch Figma image URL ────────────────────────────────────────────
        case 'FETCH_IMAGE': {
          const { figmaUrl, scale } = msg;
          if (typeof figmaUrl !== 'string') {
            sendResponse({ ok: false, error: 'figmaUrlが指定されていません。' });
            return;
          }
          const token = await getToken();
          if (!token) {
            sendResponse({ ok: false, error: 'トークンが見つかりません。Figma PATを入力してください。' });
            return;
          }
          const parsed = parseFigmaUrl(figmaUrl);
          if (!parsed) {
            sendResponse({ ok: false, error: '無効なFigma URLです。node-id付きのデザインURLを貼り付けてください。' });
            return;
          }
          const imageUrl = await fetchFigmaImage(parsed.fileKey, parsed.nodeId, scale, token);
          sendResponse({ ok: true, imageUrl });
          break;
        }

        // ── Resize browser window to match design frame ──────────────────────
        case 'RESIZE_WINDOW': {
          const windowId = _sender.tab?.windowId;
          if (!windowId) {
            sendResponse({ ok: false, error: 'ウィンドウIDを取得できませんでした。' });
            return;
          }
          const w = Math.round(Number(msg.width));
          if (!Number.isFinite(w) || w < 50 || w > 7680) {
            sendResponse({ ok: false, error: 'ウィンドウサイズの値が不正です。' });
            return;
          }
          await chrome.windows.update(windowId, { width: w });
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: `Unknown message type: "${msg.type}"` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: sanitizeError(err.message ?? '不明なエラーが発生しました。') });
    }
  })();

  return true; // Keep channel open for async response
});
