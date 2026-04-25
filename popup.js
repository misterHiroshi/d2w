'use strict';

// ---------------------------------------------------------------------------
// バリデーションパターン (background.js と二重防御で一致させる)
// ---------------------------------------------------------------------------
const PAT_REGEX       = /^figd_[A-Za-z0-9_-]{20,}$/;
const FIGMA_URL_REGEX = /^https:\/\/(www\.)?figma\.com\/(file|design|proto)\/[a-zA-Z0-9_-]+.*[?&]node-id=/;
const SETTINGS_PREFIX = 'overlay_settings_';
const UPLOAD_KEY      = SETTINGS_PREFIX + '__upload__';

// アップロード制限
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// ---------------------------------------------------------------------------
// DOM 参照
// ---------------------------------------------------------------------------
// 共通
const settingsBtn      = document.getElementById('settings-btn');

// セットアップ画面
const screenSetup      = document.getElementById('screen-setup');
const patInput         = document.getElementById('pat-input');
const tokenEye         = document.getElementById('token-eye');
const patError         = document.getElementById('pat-error');
const persistToken     = document.getElementById('persist-token');
const setupSaveBtn     = document.getElementById('setup-save-btn');
const setupStatus      = document.getElementById('setup-status');
const setupSkipBtn     = document.getElementById('setup-skip-btn');

// メイン画面 — タブ
const screenMain       = document.getElementById('screen-main');
const tabApiBtn        = document.getElementById('tab-api');
const tabUploadBtn     = document.getElementById('tab-upload');
const panelApi         = document.getElementById('panel-api');
const panelUpload      = document.getElementById('panel-upload');

// API パネル
const apiNoTokenWarn   = document.getElementById('api-no-token-warn');
const urlInput         = document.getElementById('url-input');
const urlError         = document.getElementById('url-error');
const scaleInput       = document.getElementById('scale-input');

// アップロードパネル
const dropZone         = document.getElementById('drop-zone');
const filePickBtn      = document.getElementById('file-pick-btn');
const fileInput        = document.getElementById('file-input');
const uploadPreview    = document.getElementById('upload-preview');
const previewImg       = document.getElementById('preview-img');
const uploadFilenameEl = document.getElementById('upload-filename');
const uploadClearBtn   = document.getElementById('upload-clear-btn');
const uploadError      = document.getElementById('upload-error');

// 共通オプション / アクション
const scalemodeInput   = document.getElementById('scalemode-input');
const loadBtn          = document.getElementById('load-btn');
const mainStatus       = document.getElementById('main-status');
const clearTokenBtn    = document.getElementById('clear-token-btn');

// ---------------------------------------------------------------------------
// アップロード状態
// ---------------------------------------------------------------------------
let activeSource     = 'api';  // 'api' | 'upload'
let uploadedDataUrl  = null;
let uploadedFilename = null;

// ---------------------------------------------------------------------------
// 画面切替
// ---------------------------------------------------------------------------
function showScreen(name) {
  if (name === 'setup') {
    screenSetup.hidden = false;
    screenMain.hidden  = true;
    settingsBtn.hidden = true;
    patInput.focus();
  } else {
    screenSetup.hidden = true;
    screenMain.hidden  = false;
    settingsBtn.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// タブ切替
// ---------------------------------------------------------------------------
function setActiveSource(src) {
  activeSource = src;

  tabApiBtn.classList.toggle('active', src === 'api');
  tabApiBtn.setAttribute('aria-selected', String(src === 'api'));
  tabUploadBtn.classList.toggle('active', src === 'upload');
  tabUploadBtn.setAttribute('aria-selected', String(src === 'upload'));

  panelApi.hidden    = src !== 'api';
  panelUpload.hidden = src !== 'upload';

  // ステータスとエラーをリセット
  mainStatus.hidden = true;
  if (src === 'api') {
    clearFieldError(uploadError);
  } else {
    clearFieldError(urlError);
  }
}

tabApiBtn.addEventListener('click', () => setActiveSource('api'));

tabUploadBtn.addEventListener('click', async () => {
  setActiveSource('upload');
  await loadUploadSettings();
});

// ---------------------------------------------------------------------------
// メッセージング
// ---------------------------------------------------------------------------
function msgBackground(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp ?? { ok: false, error: '応答がありませんでした' });
      }
    });
  });
}

function msgTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp ?? { ok: true });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------
function validatePat(val) {
  if (!val) return 'PATを入力してください';
  if (!PAT_REGEX.test(val)) return 'PATは "figd_" から始まる文字列である必要があります';
  return null;
}

function validateUrl(val) {
  if (!val) return 'Figma URL を入力してください';
  if (!FIGMA_URL_REGEX.test(val)) return '有効な Figma デザイン URL（?node-id 付き）を入力してください';
  return null;
}

// ---------------------------------------------------------------------------
// UI ヘルパー
// ---------------------------------------------------------------------------
function showFieldError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}
function clearFieldError(el) {
  el.textContent = '';
  el.hidden = true;
}

function showStatus(el, msg, isOk) {
  el.textContent = msg;
  el.className   = 'status ' + (isOk ? 'ok' : 'error');
  el.hidden      = false;
  if (isOk) setTimeout(() => { el.hidden = true; }, 3000);
}

function setLoading(btn, on, label) {
  btn.disabled    = on;
  btn.textContent = on ? '処理中…' : label;
}

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------
async function init() {
  const hasResp = await msgBackground({ type: 'HAS_TOKEN' });

  if (hasResp?.hasToken) {
    await transitionToMain(true);
  } else {
    const pref = await chrome.storage.local.get('persist_token_pref');
    persistToken.checked = !!pref.persist_token_pref;
    showScreen('setup');
  }
}

// メイン画面への遷移。hasToken=true なら警告を隠す、false なら表示する
async function transitionToMain(hasToken) {
  try {
    await loadMainScreenDefaults();
  } catch { /* ストレージ取得失敗時はデフォルト値のまま続行 */ }
  apiNoTokenWarn.hidden = !!hasToken;
  showScreen('main');
}

async function loadMainScreenDefaults() {
  const stored = await chrome.storage.local.get('last_figma_url');
  if (stored.last_figma_url) {
    urlInput.value = stored.last_figma_url;
    await restoreUrlSettings(stored.last_figma_url);
  }
}

async function restoreUrlSettings(figmaUrl) {
  const key    = SETTINGS_PREFIX + figmaUrl;
  const stored = await chrome.storage.local.get(key);
  const s      = stored[key];
  if (!s) return;
  if (s.scale)     scaleInput.value     = String(s.scale);
  if (s.scaleMode) scalemodeInput.value = s.scaleMode;
}

async function loadUploadSettings() {
  const stored = await chrome.storage.local.get(UPLOAD_KEY);
  const s      = stored[UPLOAD_KEY];
  if (!s) return;
  if (s.scaleMode) scalemodeInput.value = s.scaleMode;
}

// ---------------------------------------------------------------------------
// ファイルハンドリング
// ---------------------------------------------------------------------------
function handleFile(file) {
  clearFieldError(uploadError);

  if (!ALLOWED_TYPES.includes(file.type)) {
    showFieldError(uploadError, 'PNG、JPG、WebP 形式の画像のみ対応しています。');
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showFieldError(uploadError, 'ファイルサイズが大きすぎます（上限: 10MB）。');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const result = e.target.result;
    // MIME タイプを確認（base64 data URL のみ受け付ける）
    if (typeof result !== 'string' ||
        !/^data:image\/(png|jpeg|webp);base64,/.test(result)) {
      showFieldError(uploadError, '画像の読み込みに失敗しました。');
      return;
    }
    uploadedDataUrl  = result;
    uploadedFilename = file.name;
    showUploadPreview(result, file.name);
    mainStatus.hidden = true;
  };
  reader.onerror = () => {
    showFieldError(uploadError, '画像の読み込みに失敗しました。');
  };
  reader.readAsDataURL(file);
}

function showUploadPreview(dataUrl, filename) {
  previewImg.src               = dataUrl;
  uploadFilenameEl.textContent = filename;
  dropZone.hidden              = true;
  uploadPreview.hidden         = false;
}

function clearUploadState() {
  uploadedDataUrl              = null;
  uploadedFilename             = null;
  previewImg.src               = '';
  uploadFilenameEl.textContent = '';
  dropZone.hidden              = false;
  uploadPreview.hidden         = true;
  fileInput.value              = '';
  clearFieldError(uploadError);
}

// ── ファイル選択ボタン ──
filePickBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // ドロップゾーンへのバブルを防ぐ
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

// ── ドラッグ & ドロップ ──
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
  // 子要素へのホバーでは消えないようにする
  if (!dropZone.contains(e.relatedTarget)) {
    dropZone.classList.remove('dragover');
  }
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

// ── アップロードクリア ──
uploadClearBtn.addEventListener('click', clearUploadState);

// ---------------------------------------------------------------------------
// セットアップ画面: PAT 保存
// ---------------------------------------------------------------------------
setupSaveBtn.addEventListener('click', async () => {
  clearFieldError(patError);
  setupStatus.hidden = true;

  const patValue = patInput.value.trim();
  const persist  = persistToken.checked;
  const err      = validatePat(patValue);
  if (err) { showFieldError(patError, err); patInput.classList.add('invalid'); return; }

  patInput.classList.remove('invalid');
  setLoading(setupSaveBtn, true, '保存して続ける');

  try {
    const resp = await msgBackground({ type: 'SAVE_TOKEN', token: patValue, persist });
    if (!resp.ok) {
      showStatus(setupStatus, resp.error ?? 'トークンの保存に失敗しました', false);
      return;
    }
    await chrome.storage.local.set({ persist_token_pref: persist });
    patInput.value = '';
    await transitionToMain(true);
  } catch (e) {
    showStatus(setupStatus, '予期しないエラー: ' + e.message, false);
  } finally {
    setLoading(setupSaveBtn, false, '保存して続ける');
  }
});

// ---------------------------------------------------------------------------
// セットアップスキップ → 警告付きでメイン画面へ
// ---------------------------------------------------------------------------
setupSkipBtn.addEventListener('click', async () => {
  await transitionToMain(false);
});

// ---------------------------------------------------------------------------
// ヘッダーの設定ボタン → セットアップ画面に戻る
// ---------------------------------------------------------------------------
settingsBtn.addEventListener('click', async () => {
  try {
    const pref = await chrome.storage.local.get('persist_token_pref');
    persistToken.checked = !!pref.persist_token_pref;
  } catch { /* ストレージ取得失敗時はデフォルト値のまま続行 */ }
  patInput.value       = '';
  patInput.classList.remove('invalid');
  clearFieldError(patError);
  setupStatus.hidden = true;
  showScreen('setup');
});

// ---------------------------------------------------------------------------
// メイン画面: オーバーレイ読み込み (ディスパッチ)
// ---------------------------------------------------------------------------
loadBtn.addEventListener('click', async () => {
  mainStatus.hidden = true;

  const scaleMode = scalemodeInput.value;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    showStatus(mainStatus, 'アクティブなタブが見つかりませんでした', false);
    return;
  }

  if (activeSource === 'api') {
    await loadFromApi(tab, scaleMode);
  } else {
    await loadFromUpload(tab, scaleMode);
  }
});

// ── Figma API から読み込み ──
async function loadFromApi(tab, scaleMode) {
  clearFieldError(urlError);

  const urlValue = urlInput.value.trim();
  const scale    = Number(scaleInput.value);

  const urlErr = validateUrl(urlValue);
  if (urlErr) { showFieldError(urlError, urlErr); urlInput.classList.add('invalid'); return; }
  urlInput.classList.remove('invalid');

  setLoading(loadBtn, true, 'オーバーレイを読み込む');

  try {
    // 1. 画像 URL を取得
    const fetchResp = await msgBackground({ type: 'FETCH_IMAGE', figmaUrl: urlValue, scale });
    if (!fetchResp.ok) {
      showStatus(mainStatus, fetchResp.error ?? '画像の取得に失敗しました', false);
      return;
    }

    // 2. 前回の設定を読み込む（SET_IMAGE に渡すため）
    const settingsKey = SETTINGS_PREFIX + urlValue;
    const existing    = await chrome.storage.local.get(settingsKey);
    const prev        = existing[settingsKey] ?? {};

    // 3. コンテンツスクリプトを注入
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch (injErr) {
      showStatus(mainStatus, `このページには注入できません: ${injErr.message}`, false);
      return;
    }

    // 4. SET_IMAGE を送信
    const setResp = await msgTab(tab.id, {
      type:           'SET_IMAGE',
      imageUrl:       fetchResp.imageUrl,
      figmaUrl:       urlValue,
      scale,
      scaleMode,
      sourceType:     'figma',
      opacity:        prev.opacity       ?? 0.5,
      offsetX:        prev.offsetX       ?? 0,
      offsetY:        prev.offsetY       ?? 0,
      followScroll:   prev.followScroll  ?? false,
      diffHighlight:  prev.diffHighlight ?? false,
    });

    if (!setResp.ok) {
      showStatus(mainStatus, setResp.error ?? 'オーバーレイの適用に失敗しました', false);
      return;
    }

    // 5. 適用成功後に設定を保存
    await chrome.storage.local.set({
      last_figma_url: urlValue,
      [settingsKey]:  { ...prev, scale, scaleMode },
    });

    showStatus(mainStatus, 'オーバーレイを適用しました！ Alt+D でトグルできます。', true);

  } catch (e) {
    showStatus(mainStatus, '予期しないエラー: ' + e.message, false);
  } finally {
    setLoading(loadBtn, false, 'オーバーレイを読み込む');
  }
}

// ── アップロード画像から読み込み ──
async function loadFromUpload(tab, scaleMode) {
  clearFieldError(uploadError);

  if (!uploadedDataUrl) {
    showFieldError(uploadError, '画像をアップロードしてください。');
    return;
  }

  setLoading(loadBtn, true, 'オーバーレイを読み込む');

  try {
    // 1. アップロード用の保存済み設定を取得
    const existing = await chrome.storage.local.get(UPLOAD_KEY);
    const prev     = existing[UPLOAD_KEY] ?? {};

    // 2. コンテンツスクリプトを注入
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch (injErr) {
      showStatus(mainStatus, `このページには注入できません: ${injErr.message}`, false);
      return;
    }

    // 3. SET_IMAGE を data URL で送信 (scale=1: 実寸として扱う)
    const setResp = await msgTab(tab.id, {
      type:           'SET_IMAGE',
      imageUrl:       uploadedDataUrl,
      figmaUrl:       null,
      scale:          1,
      scaleMode,
      sourceType:     'upload',
      opacity:        prev.opacity       ?? 0.5,
      offsetX:        prev.offsetX       ?? 0,
      offsetY:        prev.offsetY       ?? 0,
      followScroll:   prev.followScroll  ?? false,
      diffHighlight:  prev.diffHighlight ?? false,
    });

    if (!setResp.ok) {
      showStatus(mainStatus, setResp.error ?? 'オーバーレイの適用に失敗しました', false);
      return;
    }

    // 4. 適用成功後に設定を保存
    await chrome.storage.local.set({ [UPLOAD_KEY]: { ...prev, scaleMode } });

    showStatus(mainStatus, 'オーバーレイを適用しました！ Alt+D でトグルできます。', true);

  } catch (e) {
    showStatus(mainStatus, '予期しないエラー: ' + e.message, false);
  } finally {
    setLoading(loadBtn, false, 'オーバーレイを読み込む');
  }
}

// ---------------------------------------------------------------------------
// トークン表示切替
// ---------------------------------------------------------------------------
tokenEye.addEventListener('click', () => {
  patInput.type = patInput.type === 'password' ? 'text' : 'password';
});

// ---------------------------------------------------------------------------
// トークン削除
// ---------------------------------------------------------------------------
clearTokenBtn.addEventListener('click', async () => {
  try {
    await msgBackground({ type: 'CLEAR_TOKEN' });
  } catch { /* 失敗してもセットアップ画面へ遷移 */ }
  showScreen('setup');
});

// ---------------------------------------------------------------------------
// リアルタイムバリデーション
// ---------------------------------------------------------------------------
patInput.addEventListener('input', () => {
  const err = validatePat(patInput.value.trim());
  if (err && patInput.value.trim()) {
    showFieldError(patError, err);
    patInput.classList.add('invalid');
  } else {
    clearFieldError(patError);
    patInput.classList.remove('invalid');
  }
});

urlInput.addEventListener('input', () => {
  const val = urlInput.value.trim();
  const err = validateUrl(val);
  if (err && val) {
    showFieldError(urlError, err);
    urlInput.classList.add('invalid');
  } else {
    clearFieldError(urlError);
    urlInput.classList.remove('invalid');
  }
  if (!err && val) restoreUrlSettings(val);
});

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
init();
