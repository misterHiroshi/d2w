'use strict';

document.getElementById('version-line').textContent =
  `ver. ${chrome.runtime.getManifest().version}`;

document.getElementById('cta-btn').addEventListener('click', () => window.close());
