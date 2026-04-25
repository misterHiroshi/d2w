'use strict';

// Guard against double-injection (e.g. SPA navigation)
if (window.__figmaOverlayDiffLoaded) {
  // Already running – nothing to do
} else {
  window.__figmaOverlayDiffLoaded = true;
  initFigmaOverlay();
}

function initFigmaOverlay() {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const state = {
    imageUrl:       null,
    figmaUrl:       null,
    scale:          1,
    visible:        false,
    opacity:        0.5,
    offsetX:        0,
    offsetY:        0,
    scaleMode:      'actual',
    followScroll:   false,
    diffHighlight:  false,
    retryCount:     0,
    sourceType:     'figma', // 'figma' | 'upload'
  };
  const MAX_RETRY = 3;
  const SETTINGS_PREFIX = 'overlay_settings_';

  // -------------------------------------------------------------------------
  // Overlay <img> — lives directly in the page (not Shadow DOM) so that it
  // can cover the full viewport with position:fixed + correct stacking.
  // It never receives pointer events, so page interaction is unaffected.
  // -------------------------------------------------------------------------
  const overlayImg = document.createElement('img');
  overlayImg.setAttribute('aria-hidden', 'true');
  overlayImg.setAttribute('alt', '');
  Object.assign(overlayImg.style, {
    position:       'fixed',
    top:            '0',
    left:           '0',
    zIndex:         '2147483646',
    pointerEvents:  'none',
    display:        'none',
    userSelect:     'none',
    maxWidth:       'none',
    maxHeight:      'none',
    transformOrigin:'top left',
  });
  document.documentElement.appendChild(overlayImg);

  overlayImg.addEventListener('load', () => {
    updateDimensions();
  });

  overlayImg.addEventListener('error', () => {
    // アップロード画像は再取得不要
    if (state.sourceType === 'upload') return;
    if (state.retryCount >= MAX_RETRY || !state.figmaUrl) return;
    // Guard: extension context may be invalidated after an update/reload
    if (!chrome.runtime?.id) return;
    state.retryCount++;
    chrome.runtime.sendMessage(
      { type: 'FETCH_IMAGE', figmaUrl: state.figmaUrl, scale: state.scale },
      (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) return;
        state.imageUrl = resp.imageUrl;
        state.retryCount = 0;
        applyOverlay();
      }
    );
  });

  // -------------------------------------------------------------------------
  // Update dimension display in panel
  // naturalWidth/Height = rendered PNG size (e.g. 2880×1800 for 2x)
  // Design frame size   = naturalWidth / scale  (e.g. 1440×900)
  // -------------------------------------------------------------------------
  function updateDimensions() {
    const nw = overlayImg.naturalWidth;
    const nh = overlayImg.naturalHeight;
    if (!nw || !nh) return;

    const fw = Math.round(nw / state.scale);
    const fh = Math.round(nh / state.scale);

    dimWValue.textContent = `${fw} px`;
    dimHValue.textContent = `${fh} px`;
    dimWValue.classList.remove('loading');
    dimHValue.classList.remove('loading');

    // Enable resize button now that we have valid dimensions
    resizeWinBtn.disabled = false;
  }

  function applyOverlay() {
    if (!state.imageUrl) return;

    if (overlayImg.src !== state.imageUrl) {
      overlayImg.src = state.imageUrl;
    }

    // position: absolute → scrolls with page content
    // position: fixed    → stays fixed at viewport (default)
    overlayImg.style.position = state.followScroll ? 'absolute' : 'fixed';

    // 差分ハイライトモード ON 時: opacity を強制 100%・ブレンドモードを difference に設定
    if (state.diffHighlight) {
      overlayImg.style.opacity      = '1';
      overlayImg.style.mixBlendMode = 'difference';
    } else {
      overlayImg.style.opacity      = String(state.opacity);
      overlayImg.style.mixBlendMode = 'normal';
    }
    overlayImg.style.transform = `translate(${state.offsetX}px, ${state.offsetY}px)`;

    switch (state.scaleMode) {
      case 'fit-width':
        overlayImg.style.width  = '100vw';
        overlayImg.style.height = 'auto';
        break;
      case 'fit-height':
        overlayImg.style.width  = 'auto';
        overlayImg.style.height = '100vh';
        break;
      case 'actual':
      default:
        overlayImg.style.width  = 'auto';
        overlayImg.style.height = 'auto';
        break;
    }

    overlayImg.style.display = state.visible ? 'block' : 'none';
  }

  // -------------------------------------------------------------------------
  // Persist per-URL settings (opacity, offsets, scaleMode)
  // アップロードモードは '__upload__' キーを使用; 画像データは保存しない
  // -------------------------------------------------------------------------
  function saveSettings() {
    const storageId = state.sourceType === 'upload' ? '__upload__' : state.figmaUrl;
    if (!storageId) return;
    const key = SETTINGS_PREFIX + storageId;
    const data = {
      opacity:        state.opacity,
      offsetX:        state.offsetX,
      offsetY:        state.offsetY,
      scaleMode:      state.scaleMode,
      followScroll:   state.followScroll,
      diffHighlight:  state.diffHighlight,
    };
    // scale は figma モードのみ保存 (アップロードでは常に 1)
    if (state.sourceType === 'figma') data.scale = state.scale;
    chrome.storage.local.set({ [key]: data });
  }

  // -------------------------------------------------------------------------
  // Shadow DOM — control panel only
  // The host element itself is zero-sized and pointer-events:none so it
  // doesn't interfere with the page; the panel inside re-enables its own
  // pointer events.
  // -------------------------------------------------------------------------
  const shadowHost = document.createElement('div');
  Object.assign(shadowHost.style, {
    position:      'fixed',
    top:           '0',
    left:          '0',
    width:         '0',
    height:        '0',
    zIndex:        '2147483647',
    pointerEvents: 'none',
  });
  document.documentElement.appendChild(shadowHost);

  const shadow = shadowHost.attachShadow({ mode: 'closed' });

  // ── Styles ────────────────────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .panel {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 260px;
      background: #ffffff;
      border: 1px solid #bfdbfe;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(29,78,216,.15), 0 0 0 .5px rgba(29,78,216,.08);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 12px;
      color: #1f2937;
      pointer-events: auto;
      overflow: hidden;
    }

    /* ── Header ── */
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      background: #f0f5ff;
      border-bottom: 1px solid #bfdbfe;
      cursor: move;
      user-select: none;
      -webkit-user-select: none;
    }

    .panel-title {
      font-size: 12px;
      font-weight: 600;
      color: #1d4ed8;
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #bfdbfe;
      flex-shrink: 0;
      transition: background .2s;
    }
    .status-dot.active { background: #16a34a; box-shadow: 0 0 6px #16a34a; }

    .header-btn {
      background: none;
      border: none;
      color: #4b5563;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
      line-height: 1;
      transition: color .15s, background .15s;
    }
    .header-btn:hover { color: #1f2937; background: #e8f0fe; }
    .header-btn-close:hover { color: #ef4444; background: rgba(239,68,68,.1); }

    .header-btns {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    /* ── Body ── */
    .panel-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .panel.collapsed .panel-body { display: none; }

    /* ── Toggle button ── */
    .toggle-btn {
      width: 100%;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid #bfdbfe;
      background: #f0f5ff;
      color: #1f2937;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background .15s, border-color .15s, color .15s;
      letter-spacing: .02em;
    }
    .toggle-btn:hover   { background: #dbeafe; }
    .toggle-btn.on      { background: #1d4ed8; border-color: #1d4ed8; color: #ffffff; }
    .toggle-btn.on:hover{ background: #1e40af; border-color: #1e40af; }

    /* ── Generic controls ── */
    .control-group { display: flex; flex-direction: column; gap: 5px; }

    .control-label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #374151;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: .04em;
    }

    .control-value {
      color: #1d4ed8;
      font-variant-numeric: tabular-nums;
    }

    input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 4px;
      border-radius: 2px;
      background: #dbeafe;
      outline: none;
      cursor: pointer;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #1d4ed8;
      cursor: pointer;
      transition: transform .1s;
    }
    input[type="range"]::-webkit-slider-thumb:hover { transform: scale(1.25); }

    select {
      background: #f0f5ff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      color: #1f2937;
      font-size: 12px;
      padding: 5px 8px;
      width: 100%;
      outline: none;
      cursor: pointer;
      transition: border-color .15s;
    }
    select:focus { border-color: #1d4ed8; }

    /* ── Offset row ── */
    .offset-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .offset-item { display: flex; flex-direction: column; gap: 4px; }
    .offset-label {
      color: #374151;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .06em;
      text-transform: uppercase;
    }

    input[type="number"] {
      background: #f0f5ff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      color: #1f2937;
      font-size: 12px;
      padding: 5px 8px;
      width: 100%;
      text-align: right;
      outline: none;
      font-variant-numeric: tabular-nums;
      transition: border-color .15s;
    }
    input[type="number"]:focus { border-color: #1d4ed8; }
    /* Hide spinners for cleaner look */
    input[type="number"]::-webkit-inner-spin-button,
    input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

    /* ── Divider ── */
    .divider { height: 1px; background: #dbeafe; }

    /* ── Dimensions display ── */
    .dimensions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .dim-item {
      background: #f0f5ff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      padding: 5px 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .dim-label {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: #4b5563;
    }
    .dim-value {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: #1f2937;
      font-weight: 500;
    }
    .dim-value.loading { color: #bfdbfe; }

    /* ── Window resize button ── */
    .resize-win-btn {
      width: 100%;
      padding: 7px 12px;
      border-radius: 8px;
      border: 1px solid #bfdbfe;
      background: #eff6ff;
      color: #374151;
      font-size: 11px;
      cursor: pointer;
      transition: border-color .15s, color .15s;
      letter-spacing: .02em;
      text-align: center;
    }
    .resize-win-btn:hover:not(:disabled) { border-color: #1d4ed8; color: #1d4ed8; }
    .resize-win-btn:disabled { opacity: .4; cursor: not-allowed; }

    /* ── Checkbox row ── */
    .check-row {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }
    .check-row input[type="checkbox"] {
      width: 14px;
      height: 14px;
      accent-color: #1d4ed8;
      cursor: pointer;
      flex-shrink: 0;
      margin: 0;
    }
    .check-row-label {
      font-size: 11px;
      color: #374151;
      font-weight: 500;
      letter-spacing: .02em;
    }

    /* ── Source badge ── */
    .source-badge {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 3px;
      background: #dbeafe;
      color: #1d4ed8;
    }
    .source-badge.upload { color: #15803d; background: #dcfce7; }

    /* ── Re-fetch button ── */
    .refetch-btn {
      width: 100%;
      padding: 7px 12px;
      border-radius: 8px;
      border: 1px solid #bfdbfe;
      background: transparent;
      color: #374151;
      font-size: 11px;
      cursor: pointer;
      transition: border-color .15s, color .15s;
      letter-spacing: .02em;
    }
    .refetch-btn:hover:not(:disabled) { border-color: #1d4ed8; color: #1d4ed8; }
    .refetch-btn:disabled { opacity: .4; cursor: not-allowed; }

    /* ── Status message ── */
    .status-msg {
      font-size: 10px;
      text-align: center;
      min-height: 14px;
      letter-spacing: .02em;
      color: transparent;
    }
    .status-msg.error { color: #ef4444; }
    .status-msg.ok    { color: #16a34a; }

    /* ── Diff highlight ── */
    input[type="range"]:disabled {
      opacity: .35;
      cursor: not-allowed;
    }
    .diff-highlight-label.active .check-row-label {
      color: #7c3aed;
      font-weight: 600;
    }
    .diff-highlight-label.active input[type="checkbox"] {
      accent-color: #7c3aed;
    }

    /* ── Offset accordion ── */
    .offset-toggle {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #374151;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: .04em;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }
    .offset-toggle:hover { color: #1d4ed8; }
    .offset-chevron {
      font-size: 11px;
      color: #6b7280;
    }
    .offset-body {
      display: none;
      flex-direction: column;
      gap: 5px;
    }
    .offset-body.open { display: flex; }

    /* ── Offset buttons ── */
    .offset-btns {
      display: flex;
      gap: 3px;
    }
    .offset-btn {
      flex: 1;
      height: 24px;
      border-radius: 5px;
      border: 1px solid #bfdbfe;
      background: #f0f5ff;
      color: #374151;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      line-height: 1;
      transition: background .15s, border-color .15s;
    }
    .offset-btn:hover  { background: #dbeafe; border-color: #93c5fd; }
    .offset-btn:active { background: #bfdbfe; }
    .offset-reset-btn {
      width: 100%;
      padding: 5px;
      border-radius: 6px;
      border: 1px solid #bfdbfe;
      background: #eff6ff;
      color: #374151;
      font-size: 10px;
      cursor: pointer;
      transition: border-color .15s, color .15s;
      letter-spacing: .02em;
    }
    .offset-reset-btn:hover { border-color: #1d4ed8; color: #1d4ed8; }
    .dpad-hint {
      font-size: 9px;
      color: #9ca3af;
      text-align: center;
      letter-spacing: .02em;
    }

    /* ── Shortcut hint ── */
    .shortcut-hint {
      font-size: 10px;
      color: #4b5563;
      text-align: center;
      letter-spacing: .03em;
    }
    kbd {
      background: #f0f5ff;
      border: 1px solid #bfdbfe;
      border-radius: 3px;
      padding: 0 4px;
      font-family: inherit;
    }
  `;
  shadow.appendChild(styleEl);

  // ── Panel DOM (built programmatically — no innerHTML with dynamic data) ──
  const panel = mkEl('div', { class: 'panel' });

  // Header
  const header = mkEl('div', { class: 'panel-header' });
  const titleEl = mkEl('div', { class: 'panel-title' });
  const dot = mkEl('span', { class: 'status-dot' });
  titleEl.appendChild(dot);
  titleEl.appendChild(document.createTextNode(' D2W Diff'));
  const sourceBadge = mkEl('span', { class: 'source-badge' });
  sourceBadge.textContent = 'API';
  titleEl.appendChild(sourceBadge);
  const headerBtns  = mkEl('div', { class: 'header-btns' });
  const collapseBtn = mkEl('button', { class: 'header-btn', title: '折りたたむ / 展開する', type: 'button' });
  collapseBtn.textContent = '−';
  const closeBtn = mkEl('button', { class: 'header-btn header-btn-close', title: '閉じる', type: 'button', 'aria-label': '閉じる' });
  closeBtn.textContent = '×';
  headerBtns.appendChild(collapseBtn);
  headerBtns.appendChild(closeBtn);
  header.appendChild(titleEl);
  header.appendChild(headerBtns);
  panel.appendChild(header);

  // Body
  const body = mkEl('div', { class: 'panel-body' });

  //  Toggle
  const toggleBtn = mkEl('button', { class: 'toggle-btn', type: 'button' });
  toggleBtn.textContent = 'OFF — クリックで表示';
  body.appendChild(toggleBtn);

  body.appendChild(mkEl('div', { class: 'divider' }));

  //  Opacity
  const opacityGroup = mkEl('div', { class: 'control-group' });
  const opacityLabel = mkEl('div', { class: 'control-label' });
  opacityLabel.appendChild(document.createTextNode('不透明度'));
  const opacityVal = mkEl('span', { class: 'control-value' });
  opacityVal.textContent = '50%';
  opacityLabel.appendChild(opacityVal);
  const opacitySlider = mkEl('input', { type: 'range', min: '0', max: '100', value: '50', step: '1' });
  opacityGroup.appendChild(opacityLabel);
  opacityGroup.appendChild(opacitySlider);
  body.appendChild(opacityGroup);

  //  Scale mode
  const scaleModeGroup = mkEl('div', { class: 'control-group' });
  const scaleModeLabel = mkEl('div', { class: 'control-label' });
  scaleModeLabel.appendChild(document.createTextNode('スケールモード'));
  const scaleModeSelect = mkEl('select');
  [
    ['actual',     '実寸 (1:1)'],
    ['fit-width',  '幅に合わせる'],
    ['fit-height', '高さに合わせる'],
  ].forEach(([val, label]) => {
    const opt = mkEl('option', { value: val });
    opt.textContent = label;
    scaleModeSelect.appendChild(opt);
  });
  scaleModeGroup.appendChild(scaleModeLabel);
  scaleModeGroup.appendChild(scaleModeSelect);
  body.appendChild(scaleModeGroup);

  //  Dimensions display
  const dimsGroup = mkEl('div', { class: 'control-group' });
  const dimsLabel = mkEl('div', { class: 'control-label' });
  dimsLabel.appendChild(document.createTextNode('デザインサイズ'));
  dimsGroup.appendChild(dimsLabel);
  const dimsRow = mkEl('div', { class: 'dimensions' });

  const dimWItem  = mkEl('div', { class: 'dim-item' });
  const dimWLabel = mkEl('div', { class: 'dim-label' });
  dimWLabel.textContent = 'Width';
  const dimWValue = mkEl('div', { class: 'dim-value loading' });
  dimWValue.textContent = '—';
  dimWItem.appendChild(dimWLabel);
  dimWItem.appendChild(dimWValue);

  const dimHItem  = mkEl('div', { class: 'dim-item' });
  const dimHLabel = mkEl('div', { class: 'dim-label' });
  dimHLabel.textContent = 'Height';
  const dimHValue = mkEl('div', { class: 'dim-value loading' });
  dimHValue.textContent = '—';
  dimHItem.appendChild(dimHLabel);
  dimHItem.appendChild(dimHValue);

  dimsRow.appendChild(dimWItem);
  dimsRow.appendChild(dimHItem);
  dimsGroup.appendChild(dimsRow);
  body.appendChild(dimsGroup);

  //  Window resize button
  const resizeWinBtn = mkEl('button', { class: 'resize-win-btn', type: 'button' });
  resizeWinBtn.disabled = true;
  resizeWinBtn.textContent = '⊡  Windowサイズをデザインに合わせる';
  body.appendChild(resizeWinBtn);

  body.appendChild(mkEl('div', { class: 'divider' }));

  //  Offset (accordion — デフォルト閉)
  const offsetGroup  = mkEl('div', { class: 'control-group' });
  const offsetHeader = mkEl('div', { class: 'offset-toggle' });
  offsetHeader.appendChild(document.createTextNode('オフセット (px)'));
  const offsetChevron = mkEl('span', { class: 'offset-chevron' });
  offsetChevron.textContent = '＋';
  offsetHeader.appendChild(offsetChevron);
  offsetGroup.appendChild(offsetHeader);

  const offsetBody = mkEl('div', { class: 'offset-body' }); // デフォルト閉

  const offsetRow = mkEl('div', { class: 'offset-row' });

  // X 列: ラベル + 入力 + [←][→]
  const offsetXItem  = mkEl('div', { class: 'offset-item' });
  const offsetXLabel = mkEl('div', { class: 'offset-label' });
  offsetXLabel.textContent = 'X';
  const offsetXInput = mkEl('input', { type: 'number', value: '0', step: '1' });
  const offsetXBtns  = mkEl('div', { class: 'offset-btns' });
  const dpadLeft  = mkEl('button', { class: 'offset-btn', type: 'button', title: '左へ移動 (Shift: 10px)' });
  const dpadRight = mkEl('button', { class: 'offset-btn', type: 'button', title: '右へ移動 (Shift: 10px)' });
  dpadLeft.textContent  = '←';
  dpadRight.textContent = '→';
  offsetXBtns.appendChild(dpadLeft);
  offsetXBtns.appendChild(dpadRight);
  const offsetXResetBtn = mkEl('button', { class: 'offset-reset-btn', type: 'button', title: 'X をリセット' });
  offsetXResetBtn.textContent = 'X リセット';
  offsetXItem.appendChild(offsetXLabel);
  offsetXItem.appendChild(offsetXInput);
  offsetXItem.appendChild(offsetXBtns);
  offsetXItem.appendChild(offsetXResetBtn);

  // Y 列: ラベル + 入力 + [↑][↓] + リセット
  const offsetYItem  = mkEl('div', { class: 'offset-item' });
  const offsetYLabel = mkEl('div', { class: 'offset-label' });
  offsetYLabel.textContent = 'Y';
  const offsetYInput = mkEl('input', { type: 'number', value: '0', step: '1' });
  const offsetYBtns  = mkEl('div', { class: 'offset-btns' });
  const dpadUp   = mkEl('button', { class: 'offset-btn', type: 'button', title: '上へ移動 (Shift: 10px)' });
  const dpadDown = mkEl('button', { class: 'offset-btn', type: 'button', title: '下へ移動 (Shift: 10px)' });
  dpadUp.textContent   = '↑';
  dpadDown.textContent = '↓';
  offsetYBtns.appendChild(dpadUp);
  offsetYBtns.appendChild(dpadDown);
  const offsetYResetBtn = mkEl('button', { class: 'offset-reset-btn', type: 'button', title: 'Y をリセット' });
  offsetYResetBtn.textContent = 'Y リセット';
  offsetYItem.appendChild(offsetYLabel);
  offsetYItem.appendChild(offsetYInput);
  offsetYItem.appendChild(offsetYBtns);
  offsetYItem.appendChild(offsetYResetBtn);

  offsetRow.appendChild(offsetXItem);
  offsetRow.appendChild(offsetYItem);
  offsetBody.appendChild(offsetRow);

  const dpadHint = mkEl('div', { class: 'dpad-hint' });
  dpadHint.textContent = 'Shift+クリックで 10px 移動';
  offsetBody.appendChild(dpadHint);

  offsetGroup.appendChild(offsetBody);
  body.appendChild(offsetGroup);

  body.appendChild(mkEl('div', { class: 'divider' }));

  //  Follow scroll checkbox
  const followScrollLabel = mkEl('label', { class: 'check-row' });
  const followScrollCheck = mkEl('input', { type: 'checkbox' });
  const followScrollText  = mkEl('span',  { class: 'check-row-label' });
  followScrollText.textContent = 'スクロールに追従';
  followScrollLabel.appendChild(followScrollCheck);
  followScrollLabel.appendChild(followScrollText);
  body.appendChild(followScrollLabel);

  //  Diff highlight checkbox
  const diffHighlightLabel = mkEl('label', { class: 'check-row diff-highlight-label' });
  const diffHighlightCheck = mkEl('input', { type: 'checkbox' });
  const diffHighlightText  = mkEl('span',  { class: 'check-row-label' });
  diffHighlightText.textContent = '差分ハイライトモード（反転）';
  diffHighlightLabel.appendChild(diffHighlightCheck);
  diffHighlightLabel.appendChild(diffHighlightText);
  body.appendChild(diffHighlightLabel);

  body.appendChild(mkEl('div', { class: 'divider' }));

  //  Re-fetch
  const refetchBtn = mkEl('button', { class: 'refetch-btn', type: 'button' });
  refetchBtn.textContent = '↻  最新デザインを再取得';
  body.appendChild(refetchBtn);

  //  Status
  const statusMsg = mkEl('div', { class: 'status-msg' });
  body.appendChild(statusMsg);

  //  Shortcut hint
  const hint = mkEl('div', { class: 'shortcut-hint' });
  hint.appendChild(document.createTextNode('トグル: '));
  const kbd = mkEl('kbd');
  kbd.textContent = 'Alt+D';
  hint.appendChild(kbd);
  body.appendChild(hint);

  panel.appendChild(body);
  shadow.appendChild(panel);

  // ── DOM helper ────────────────────────────────────────────────────────────
  function mkEl(tag, attrs = {}) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // -------------------------------------------------------------------------
  // Panel — collapse / expand
  // -------------------------------------------------------------------------
  collapseBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    collapseBtn.textContent = collapsed ? '+' : '−';
  });

  closeBtn.addEventListener('click', () => {
    overlayImg.remove();
    shadowHost.remove();
    // document に直接追加したリスナーを解除（再注入時の蓄積を防ぐ）
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
    document.removeEventListener('keydown',   onKeyDown);
    // ガード解除: 次回のポップアップ操作で再注入できるようにする
    delete window.__figmaOverlayDiffLoaded;
  });

  // -------------------------------------------------------------------------
  // Panel — drag (mousedown on header, mousemove/mouseup on real document)
  // -------------------------------------------------------------------------
  let drag = null;

  header.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop:  rect.top,
    };
    e.preventDefault();
  });

  function onMouseMove(e) {
    if (!drag) return;
    const left = drag.origLeft + (e.clientX - drag.startX);
    const top  = drag.origTop  + (e.clientY - drag.startY);
    panel.style.left  = `${left}px`;
    panel.style.top   = `${top}px`;
    panel.style.right = 'auto';
  }

  function onMouseUp() { drag = null; }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  // -------------------------------------------------------------------------
  // Panel — controls
  // -------------------------------------------------------------------------
  function setStatus(msg, isOk) {
    statusMsg.textContent  = msg;
    statusMsg.className    = 'status-msg ' + (isOk ? 'ok' : 'error');
    if (isOk) setTimeout(() => { statusMsg.textContent = ''; statusMsg.className = 'status-msg'; }, 2500);
  }

  function syncPanelToState() {
    opacitySlider.value       = String(Math.round(state.opacity * 100));
    scaleModeSelect.value     = state.scaleMode;
    offsetXInput.value        = String(state.offsetX);
    offsetYInput.value        = String(state.offsetY);
    followScrollCheck.checked = state.followScroll;
    diffHighlightCheck.checked = state.diffHighlight;

    // 差分ハイライトモード ON 時: 不透明度スライダーを無効化し視覚的に伝える
    if (state.diffHighlight) {
      opacityVal.textContent   = '100% (ハイライト中)';
      opacitySlider.disabled   = true;
      diffHighlightLabel.classList.add('active');
    } else {
      opacityVal.textContent   = `${opacitySlider.value}%`;
      opacitySlider.disabled   = false;
      diffHighlightLabel.classList.remove('active');
    }

    updateDimensions();

    if (state.visible) {
      toggleBtn.textContent = 'ON — クリックで非表示';
      toggleBtn.classList.add('on');
      dot.classList.add('active');
    } else {
      toggleBtn.textContent = 'OFF — クリックで表示';
      toggleBtn.classList.remove('on');
      dot.classList.remove('active');
    }
  }

  // Toggle
  toggleBtn.addEventListener('click', () => {
    if (!state.imageUrl) {
      setStatus('画像が読み込まれていません。ポップアップから設定してください。', false);
      return;
    }
    state.visible = !state.visible;
    applyOverlay();
    syncPanelToState();
  });

  // Opacity slider
  opacitySlider.addEventListener('input', () => {
    state.opacity = Number(opacitySlider.value) / 100;
    opacityVal.textContent = `${opacitySlider.value}%`;
    applyOverlay();
    saveSettings();
  });

  // Scale mode
  scaleModeSelect.addEventListener('change', () => {
    state.scaleMode = scaleModeSelect.value;
    applyOverlay();
    saveSettings();
  });

  // Offset X
  offsetXInput.addEventListener('input', () => {
    const v = parseInt(offsetXInput.value, 10);
    if (!isNaN(v)) { state.offsetX = v; applyOverlay(); saveSettings(); }
  });

  // Offset Y
  offsetYInput.addEventListener('input', () => {
    const v = parseInt(offsetYInput.value, 10);
    if (!isNaN(v)) { state.offsetY = v; applyOverlay(); saveSettings(); }
  });

  // Offset d-pad
  function moveDpad(dx, dy, e) {
    const step = e.shiftKey ? 10 : 1;
    state.offsetX += dx * step;
    state.offsetY += dy * step;
    offsetXInput.value = String(state.offsetX);
    offsetYInput.value = String(state.offsetY);
    applyOverlay();
    saveSettings();
  }
  dpadUp.addEventListener('click',    (e) => moveDpad( 0, -1, e));
  dpadDown.addEventListener('click',  (e) => moveDpad( 0,  1, e));
  dpadLeft.addEventListener('click',  (e) => moveDpad(-1,  0, e));
  dpadRight.addEventListener('click', (e) => moveDpad( 1,  0, e));

  // Offset accordion toggle
  offsetHeader.addEventListener('click', () => {
    const isOpen = offsetBody.classList.toggle('open');
    offsetChevron.textContent = isOpen ? 'ー' : '＋';
  });

  // Offset reset
  offsetXResetBtn.addEventListener('click', () => {
    state.offsetX = 0;
    offsetXInput.value = '0';
    applyOverlay();
    saveSettings();
  });
  offsetYResetBtn.addEventListener('click', () => {
    state.offsetY = 0;
    offsetYInput.value = '0';
    applyOverlay();
    saveSettings();
  });

  // Follow scroll
  followScrollCheck.addEventListener('change', () => {
    state.followScroll = followScrollCheck.checked;
    applyOverlay();
    saveSettings();
  });

  // Diff highlight
  diffHighlightCheck.addEventListener('change', () => {
    state.diffHighlight = diffHighlightCheck.checked;
    applyOverlay();
    syncPanelToState();
    saveSettings();
  });

  // Resize window to match design frame
  resizeWinBtn.addEventListener('click', () => {
    const nw = overlayImg.naturalWidth;
    const nh = overlayImg.naturalHeight;
    if (!nw || !nh) return;

    const frameW = Math.round(nw / state.scale);

    resizeWinBtn.disabled    = true;
    resizeWinBtn.textContent = '⊡  リサイズ中…';

    const resetResizeBtn = () => {
      resizeWinBtn.disabled    = false;
      resizeWinBtn.textContent = '⊡  Windowサイズをデザインに合わせる';
    };

    // MV3 サービスワーカーが windows.update 後に終了した場合に備えタイムアウトで復旧
    const resizeTimeout = setTimeout(resetResizeBtn, 5000);

    chrome.runtime.sendMessage(
      { type: 'RESIZE_WINDOW', width: frameW },
      (resp) => {
        clearTimeout(resizeTimeout);
        resetResizeBtn();
        if (chrome.runtime.lastError || !resp?.ok) {
          setStatus(resp?.error ?? 'リサイズに失敗しました', false);
          return;
        }
        setStatus(`横幅を ${frameW}px に調整しました`, true);
      }
    );
  });

  // Re-fetch
  refetchBtn.addEventListener('click', () => {
    if (!state.figmaUrl) {
      setStatus('Figma URLが設定されていません。ポップアップから設定してください。', false);
      return;
    }
    refetchBtn.disabled     = true;
    refetchBtn.textContent  = '↻  取得中…';
    chrome.runtime.sendMessage(
      { type: 'FETCH_IMAGE', figmaUrl: state.figmaUrl, scale: state.scale },
      (resp) => {
        refetchBtn.disabled    = false;
        refetchBtn.textContent = '↻  最新デザインを再取得';
        if (chrome.runtime.lastError) { setStatus('拡張機能エラーが発生しました。', false); return; }
        if (!resp?.ok) { setStatus(resp?.error ?? '取得に失敗しました。', false); return; }
        state.imageUrl   = resp.imageUrl;
        state.retryCount = 0;
        applyOverlay();
        setStatus('デザインを更新しました！', true);
      }
    );
  });

  // -------------------------------------------------------------------------
  // Message listener — from popup
  // -------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;

    if (msg.type === 'SET_IMAGE') {
      // 型チェック: https:// URL または data:image/(png|jpeg|webp);base64, のみ受け付ける
      if (typeof msg.imageUrl !== 'string' ||
          (!msg.imageUrl.startsWith('https://') &&
           !/^data:image\/(png|jpeg|webp);base64,/.test(msg.imageUrl))) {
        sendResponse({ ok: false, error: '無効な画像URLです。' });
        return true;
      }
      // 各フィールドの型・範囲を検証してから適用
      const _scale   = Number(msg.scale);
      const _opacity = Number(msg.opacity);
      const _offsetX = parseInt(msg.offsetX, 10);
      const _offsetY = parseInt(msg.offsetY, 10);
      const _SCALE_MODES = ['fit-width', 'fit-height', 'actual'];

      state.imageUrl     = msg.imageUrl;
      state.figmaUrl     = typeof msg.figmaUrl === 'string' ? msg.figmaUrl : null;
      state.scale        = (Number.isFinite(_scale) && _scale >= 0.5 && _scale <= 4) ? _scale : 2;
      state.opacity      = (Number.isFinite(_opacity) && _opacity >= 0 && _opacity <= 1) ? _opacity : 0.5;
      state.offsetX      = Number.isFinite(_offsetX) ? _offsetX : 0;
      state.offsetY      = Number.isFinite(_offsetY) ? _offsetY : 0;
      state.scaleMode      = _SCALE_MODES.includes(msg.scaleMode) ? msg.scaleMode : 'actual';
      state.followScroll   = msg.followScroll   === true;
      state.diffHighlight  = msg.diffHighlight  === true;
      state.sourceType     = msg.sourceType === 'upload' ? 'upload' : 'figma';
      state.visible      = true;
      state.retryCount   = 0;

      // ソースバッジとボタン表示を更新
      const isUpload = state.sourceType === 'upload';
      sourceBadge.textContent = isUpload ? 'Local' : 'API';
      sourceBadge.className   = 'source-badge' + (isUpload ? ' upload' : '');
      refetchBtn.style.display = isUpload ? 'none' : '';

      applyOverlay();
      syncPanelToState();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'TOGGLE') {
      if (state.imageUrl) {
        state.visible = !state.visible;
        applyOverlay();
        syncPanelToState();
      }
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  // -------------------------------------------------------------------------
  // Keyboard shortcut: Alt+D — toggle overlay
  // -------------------------------------------------------------------------
  function onKeyDown(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'd') {
      if (!state.imageUrl) return;
      state.visible = !state.visible;
      applyOverlay();
      syncPanelToState();
    }
  }
  document.addEventListener('keydown', onKeyDown);
}
