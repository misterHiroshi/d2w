'use strict';

// ---------------------------------------------------------------------------
// バリデーションパターン (background.js と二重防御で一致させる)
// ---------------------------------------------------------------------------
const PAT_REGEX       = /^figd_[A-Za-z0-9_-]{20,}$/;
const FIGMA_URL_REGEX = /^https:\/\/(www\.)?figma\.com\/(file|design|proto)\/[a-zA-Z0-9_-]+.*[?&]node-id=/;
const SETTINGS_PREFIX  = 'overlay_settings_';
const SLOT_COUNT       = 3;
const ACTIVE_SLOT_KEY  = 'active_upload_slot';
const VIEW_MODE_KEY    = 'view_mode';

function uploadSlotKey(slot) { return SETTINGS_PREFIX + '__upload_slot_' + slot + '__'; }
function imageSlotKey(slot)  { return 'image_slot_' + slot; }

const SLOT_NUMS = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1);

// Figma URL スロット
const URL_SLOT_COUNT      = 3;
const ACTIVE_URL_SLOT_KEY = 'active_figma_url_slot';
function figmaUrlSlotKey(slot) { return 'figma_url_slot_' + slot; }
const URL_SLOT_NUMS = Array.from({ length: URL_SLOT_COUNT }, (_, i) => i + 1);

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
const urlListHeader    = document.getElementById('url-list-header');
const urlList          = document.getElementById('url-list');
const urlClearBtn      = document.getElementById('url-clear-btn');
const urlSaveBtn       = document.getElementById('url-save-btn');
const urlInput         = document.getElementById('url-input');
const urlError         = document.getElementById('url-error');
const scaleInput       = document.getElementById('scale-input');

// アップロードパネル
const imageListHeader  = document.getElementById('image-list-header');
const viewGridBtn      = document.getElementById('view-grid-btn');
const viewListBtn      = document.getElementById('view-list-btn');
const imageList        = document.getElementById('image-list');
const dropZone         = document.getElementById('drop-zone');
const filePickBtn      = document.getElementById('file-pick-btn');
const fileInput        = document.getElementById('file-input');
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
let activeSlot       = 1;
let viewMode         = 'grid'; // 'grid' | 'list'
let slotsInitialized = false;
const slotData = Object.fromEntries(SLOT_NUMS.map(i => [i, null])); // { dataUrl, filename } or null

// ---------------------------------------------------------------------------
// Figma URL スロット状態
// ---------------------------------------------------------------------------
let activeUrlSlot       = 1;
let urlSlotsInitialized = false;
const urlSlotData = Object.fromEntries(URL_SLOT_NUMS.map(i => [i, null])); // { url, imageUrl } or null

// 現在オーバーレイとして表示中のスロット／URL（削除時の消去判定用）
let loadedUploadSlot = null;
let loadedFigmaUrl   = null;

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

tabApiBtn.addEventListener('click', async () => {
  setActiveSource('api');
  await initUrlSlots();
});

tabUploadBtn.addEventListener('click', async () => {
  setActiveSource('upload');
  await initSlots();
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
  apiNoTokenWarn.hidden = !!hasToken;
  showScreen('main');
  await initUrlSlots();
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
  const key    = uploadSlotKey(activeSlot);
  const stored = await chrome.storage.local.get(key);
  const s      = stored[key];
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

  const targetSlot = nextEmptySlot();
  if (!targetSlot) {
    showFieldError(uploadError, `スロットが満杯です（最大${SLOT_COUNT}枚）。`);
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const result = e.target.result;
    if (typeof result !== 'string' ||
        !/^data:image\/(png|jpeg|webp);base64,/.test(result)) {
      showFieldError(uploadError, '画像の読み込みに失敗しました。');
      return;
    }

    slotData[targetSlot] = { dataUrl: result, filename: file.name };
    activeSlot = targetSlot;
    await chrome.storage.local.set({
      [imageSlotKey(targetSlot)]: slotData[targetSlot],
      [ACTIVE_SLOT_KEY]: targetSlot,
    });

    fileInput.value   = '';
    mainStatus.hidden = true;
    renderImageList();
  };
  reader.onerror = () => {
    showFieldError(uploadError, '画像の読み込みに失敗しました。');
  };
  reader.readAsDataURL(file);
}

function renderImageList() {
  imageList.innerHTML = '';
  const filled = SLOT_NUMS.filter(i => slotData[i] !== null);
  filled.forEach(slot => imageList.appendChild(createImageListItem(slot)));
  imageList.className    = 'image-list ' + viewMode;
  imageListHeader.hidden = filled.length === 0;
  dropZone.hidden        = filled.length >= SLOT_COUNT;
}

function setViewMode(mode) {
  viewMode = mode;
  viewGridBtn.classList.toggle('active', mode === 'grid');
  viewListBtn.classList.toggle('active', mode === 'list');
  chrome.storage.local.set({ [VIEW_MODE_KEY]: mode });
  renderImageList();
}

viewGridBtn.addEventListener('click', () => setViewMode('grid'));
viewListBtn.addEventListener('click', () => setViewMode('list'));

function createImageListItem(slot) {
  const { dataUrl, filename } = slotData[slot];
  const item = document.createElement('div');
  item.className = 'image-item' + (slot === activeSlot ? ' active' : '');

  const thumb = document.createElement('img');
  thumb.className = 'image-item-thumb';
  thumb.src = dataUrl;
  thumb.alt = filename;

  const name = document.createElement('span');
  name.className = 'image-item-name';
  name.textContent = filename;

  const delBtn = document.createElement('button');
  delBtn.className = 'image-item-del';
  delBtn.type = 'button';
  delBtn.setAttribute('aria-label', '画像を削除');
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteSlot(slot); });

  item.appendChild(thumb);
  item.appendChild(name);
  item.appendChild(delBtn);
  item.addEventListener('click', () => switchToSlot(slot));

  return item;
}

async function removeSlotAndMaybeClear(wasDisplayed, removeArg, setObj) {
  if (wasDisplayed) {
    const [[tab]] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      Promise.all([chrome.storage.local.remove(removeArg), chrome.storage.local.set(setObj)]),
    ]);
    if (tab?.id) msgTab(tab.id, { type: 'CLEAR_IMAGE' }).catch(() => {});
  } else {
    await Promise.all([chrome.storage.local.remove(removeArg), chrome.storage.local.set(setObj)]);
  }
}

async function deleteSlot(slot) {
  const wasActive    = slot === activeSlot;
  const wasDisplayed = slot === loadedUploadSlot;
  slotData[slot] = null;
  if (wasDisplayed) loadedUploadSlot = null;

  if (wasActive) {
    const next = SLOT_NUMS.find(i => slotData[i] !== null);
    activeSlot = next ?? 1;
    await removeSlotAndMaybeClear(
      wasDisplayed,
      [imageSlotKey(slot), uploadSlotKey(slot)],
      { [ACTIVE_SLOT_KEY]: activeSlot },
    );
  } else {
    await chrome.storage.local.remove([imageSlotKey(slot), uploadSlotKey(slot)]);
  }

  clearFieldError(uploadError);
  renderImageList();
}

function nextEmptySlot() {
  return SLOT_NUMS.find(i => slotData[i] === null);
}

// ── Figma URL クリアボタン ──
urlClearBtn.addEventListener('click', () => {
  urlInput.value = '';
  clearFieldError(urlError);
  urlInput.classList.remove('invalid');
  urlInput.focus();
});

// ── Figma URL 保存ボタン ──
urlSaveBtn.addEventListener('click', () => saveUrlSlot());

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

// ---------------------------------------------------------------------------
// スロット管理
// ---------------------------------------------------------------------------
async function initSlots() {
  if (slotsInitialized) return;
  slotsInitialized = true;

  try {
    const stored = await chrome.storage.local.get([ACTIVE_SLOT_KEY, VIEW_MODE_KEY, ...SLOT_NUMS.map(imageSlotKey)]);

    SLOT_NUMS.forEach(i => { slotData[i] = stored[imageSlotKey(i)] ?? null; });

    const saved = stored[ACTIVE_SLOT_KEY];
    if (saved >= 1 && saved <= SLOT_COUNT && slotData[saved]) {
      activeSlot = saved;
    } else {
      activeSlot = SLOT_NUMS.find(i => slotData[i] !== null) ?? 1;
    }

    if (stored[VIEW_MODE_KEY] === 'list' || stored[VIEW_MODE_KEY] === 'grid') {
      viewMode = stored[VIEW_MODE_KEY];
    }
    setViewMode(viewMode);
  } catch (e) {
    slotsInitialized = false;
    throw e;
  }
}

async function switchToSlot(slot) {
  if (slot === activeSlot) return;
  activeSlot = slot;
  await chrome.storage.local.set({ [ACTIVE_SLOT_KEY]: slot });
  clearFieldError(uploadError);
  mainStatus.hidden = true;

  renderImageList();
  await loadUploadSettings();
}

// ---------------------------------------------------------------------------
// Figma URL スロット管理
// ---------------------------------------------------------------------------
function urlLabel(url) {
  const m    = url.match(/figma\.com\/(?:file|design|proto)\/([^/?]+)/);
  const key  = m ? m[1].slice(0, 10) : '';
  const nodeM = url.match(/node-id=([^&]+)/);
  const node = nodeM ? decodeURIComponent(nodeM[1]) : '';
  return key ? `${key}… (${node})` : url.slice(0, 42);
}

function renderUrlList() {
  urlList.innerHTML = '';
  const filled = URL_SLOT_NUMS.filter(i => urlSlotData[i] !== null);
  filled.forEach(slot => urlList.appendChild(createUrlListItem(slot)));
  urlListHeader.hidden = filled.length === 0;
}

function makePlaceholder(url) {
  const div = document.createElement('div');
  div.className = 'url-item-placeholder';
  const span = document.createElement('span');
  span.className = 'url-item-placeholder-text';
  span.textContent = urlLabel(url);
  div.appendChild(span);
  return div;
}

function createUrlListItem(slot) {
  const { url, imageUrl } = urlSlotData[slot];
  const item = document.createElement('div');
  item.className = 'url-item' + (slot === activeUrlSlot ? ' active' : '');
  item.title = url;

  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'url-item-thumb';
    img.src = imageUrl;
    img.alt = '';
    img.addEventListener('error', () => img.replaceWith(makePlaceholder(url)), { once: true });
    item.appendChild(img);
  } else {
    item.appendChild(makePlaceholder(url));
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'url-item-del';
  delBtn.type = 'button';
  delBtn.setAttribute('aria-label', 'URLを削除');
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', e => { e.stopPropagation(); deleteUrlSlot(slot); });

  item.appendChild(delBtn);
  item.addEventListener('click', () => switchToUrlSlot(slot));
  return item;
}

async function initUrlSlots() {
  if (urlSlotsInitialized) return;
  urlSlotsInitialized = true;
  try {
    const stored = await chrome.storage.local.get([
      ACTIVE_URL_SLOT_KEY,
      'last_figma_url',
      ...URL_SLOT_NUMS.map(figmaUrlSlotKey),
    ]);
    URL_SLOT_NUMS.forEach(i => { urlSlotData[i] = stored[figmaUrlSlotKey(i)] ?? null; });

    // last_figma_url をスロット1へ一回限り移行
    if (!URL_SLOT_NUMS.some(i => urlSlotData[i] !== null) && stored.last_figma_url) {
      urlSlotData[1] = { url: stored.last_figma_url, imageUrl: null };
      await chrome.storage.local.set({ [figmaUrlSlotKey(1)]: urlSlotData[1] });
    }

    const saved = stored[ACTIVE_URL_SLOT_KEY];
    activeUrlSlot = (saved >= 1 && saved <= URL_SLOT_COUNT && urlSlotData[saved])
      ? saved
      : URL_SLOT_NUMS.find(i => urlSlotData[i] !== null) ?? 1;

    renderUrlList();
    if (urlSlotData[activeUrlSlot]) {
      urlInput.value = urlSlotData[activeUrlSlot].url;
      await restoreUrlSettings(urlSlotData[activeUrlSlot].url);
    }
  } catch (e) {
    urlSlotsInitialized = false;
    throw e;
  }
}

async function switchToUrlSlot(slot) {
  if (slot === activeUrlSlot) return;
  activeUrlSlot = slot;
  await chrome.storage.local.set({ [ACTIVE_URL_SLOT_KEY]: slot });
  urlInput.value = urlSlotData[slot].url;
  clearFieldError(urlError);
  mainStatus.hidden = true;
  renderUrlList();
  await restoreUrlSettings(urlSlotData[slot].url);
}

async function deleteUrlSlot(slot) {
  const wasDisplayed = loadedFigmaUrl !== null && urlSlotData[slot]?.url === loadedFigmaUrl;
  urlSlotData[slot] = null;
  if (wasDisplayed) loadedFigmaUrl = null;

  if (activeUrlSlot === slot) {
    const next = URL_SLOT_NUMS.find(i => urlSlotData[i] !== null);
    activeUrlSlot = next ?? 1;
    urlInput.value = urlSlotData[activeUrlSlot]?.url ?? '';
    await removeSlotAndMaybeClear(
      wasDisplayed,
      figmaUrlSlotKey(slot),
      { [ACTIVE_URL_SLOT_KEY]: activeUrlSlot },
    );
  } else {
    await chrome.storage.local.remove(figmaUrlSlotKey(slot));
  }

  clearFieldError(urlError);
  renderUrlList();
}

async function saveUrlSlot() {
  const url = urlInput.value.trim();
  const err = validateUrl(url);
  if (err) { showFieldError(urlError, err); urlInput.classList.add('invalid'); return; }
  urlInput.classList.remove('invalid');

  // 既存スロットに同一 URL があれば選択に切り替えるだけ
  const existing = URL_SLOT_NUMS.find(i => urlSlotData[i]?.url === url);
  if (existing) { await switchToUrlSlot(existing); return; }

  const emptySlot = URL_SLOT_NUMS.find(i => urlSlotData[i] === null);
  if (!emptySlot) {
    showFieldError(urlError, `スロットが満杯です（最大${URL_SLOT_COUNT}件）。不要な URL を削除してください。`);
    return;
  }

  urlSlotData[emptySlot] = { url, imageUrl: null };
  activeUrlSlot = emptySlot;
  await chrome.storage.local.set({
    [figmaUrlSlotKey(emptySlot)]: { url, imageUrl: null },
    [ACTIVE_URL_SLOT_KEY]: emptySlot,
  });
  renderUrlList();
}

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

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch (injErr) {
    showStatus(mainStatus, `このページには注入できません: ${injErr.message}`, false);
    return false;
  }
}

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
    if (!await injectContentScript(tab.id)) return;

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
    const updates = {
      last_figma_url: urlValue,
      [settingsKey]:  { ...prev, scale, scaleMode },
    };

    // マッチするURLスロットにサムネイル用 imageUrl を保存
    const matchedSlot = URL_SLOT_NUMS.find(i => urlSlotData[i]?.url === urlValue);
    if (matchedSlot) {
      urlSlotData[matchedSlot] = { ...urlSlotData[matchedSlot], imageUrl: fetchResp.imageUrl };
      updates[figmaUrlSlotKey(matchedSlot)] = urlSlotData[matchedSlot];
    }

    await chrome.storage.local.set(updates);
    if (matchedSlot) renderUrlList();
    loadedFigmaUrl   = urlValue;
    loadedUploadSlot = null;

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

  const slot       = activeSlot;
  const activeData = slotData[slot];
  if (!activeData) {
    showFieldError(uploadError, '画像をアップロードしてください。');
    return;
  }

  setLoading(loadBtn, true, 'オーバーレイを読み込む');

  try {
    // 1. アップロード用の保存済み設定を取得
    const slotSettingsKey = uploadSlotKey(slot);
    const existing = await chrome.storage.local.get(slotSettingsKey);
    const prev     = existing[slotSettingsKey] ?? {};

    // 2. コンテンツスクリプトを注入
    if (!await injectContentScript(tab.id)) return;

    // 3. SET_IMAGE を data URL で送信 (scale=1: 実寸として扱う)
    const setResp = await msgTab(tab.id, {
      type:           'SET_IMAGE',
      imageUrl:       activeData.dataUrl,
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
    await chrome.storage.local.set({ [uploadSlotKey(slot)]: { ...prev, scaleMode } });
    loadedUploadSlot = slot;
    loadedFigmaUrl   = null;

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
