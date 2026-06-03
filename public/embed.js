/**
 * Libar Asistent — WordPress Embed Script
 *
 * Ubaci u WordPress footer (via Appearance → Theme Editor → footer.php
 * ili via plugin kao što je "Insert Headers and Footers"):
 *
 *   <script src="https://TV-RENDER-URL.com/embed.js" async></script>
 *
 * Zamijeni "TV-RENDER-URL.com" stvarnim URL-om bota.
 */

(function () {
  'use strict';

  const BOT_URL = document.currentScript?.src?.replace('/embed.js', '') || '';
  if (!BOT_URL) {
    console.error('[Libar Asistent] Nije moguće odrediti BOT_URL. Provjeri src atribut skripte.');
    return;
  }

  // ── Floating Button ──
  const fab = document.createElement('button');
  fab.id = 'libar-chat-fab';
  fab.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  `;
  fab.setAttribute('aria-label', 'Otvori Libar Asistent');
  fab.style.cssText = `
    position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;
    background:#f26a35;color:#fff;border:none;cursor:pointer;z-index:99999;
    display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,0.25);
    transition:transform .2s ease,box-shadow .2s ease;
  `;
  fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.08)'; });
  fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });

  // ── Chat Panel (iframe) ──
  const panel = document.createElement('div');
  panel.id = 'libar-chat-panel';
  panel.style.cssText = `
    position:fixed;bottom:96px;right:24px;width:400px;max-width:calc(100vw - 32px);
    height:580px;max-height:calc(100vh - 120px);border-radius:20px;
    box-shadow:0 12px 40px rgba(0,0,0,0.2);overflow:hidden;border:1px solid #e5e7eb;
    background:#fff;z-index:99998;transform:translateY(20px) scale(0.95);opacity:0;
    pointer-events:none;transition:transform .3s ease,opacity .3s ease;
    display:flex;flex-direction:column;
  `;

  const iframe = document.createElement('iframe');
  iframe.src = BOT_URL;
  iframe.style.cssText = 'width:100%;height:100%;border:none;';
  iframe.title = 'Libar Asistent';
  panel.appendChild(iframe);

  // ── Toggle logic ──
  let isOpen = false;
  function toggle() {
    isOpen = !isOpen;
    if (isOpen) {
      panel.style.transform = 'translateY(0) scale(1)';
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'all';
      fab.querySelector('svg').innerHTML = `
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      `;
      fab.setAttribute('aria-label', 'Zatvori Libar Asistent');
    } else {
      panel.style.transform = 'translateY(20px) scale(0.95)';
      panel.style.opacity = '0';
      panel.style.pointerEvents = 'none';
      fab.querySelector('svg').innerHTML = `
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      `;
      fab.setAttribute('aria-label', 'Otvori Libar Asistent');
    }
  }

  fab.addEventListener('click', toggle);

  // ── Close on Escape ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) toggle();
  });

  // ── Append to body ──
  document.body.appendChild(fab);
  document.body.appendChild(panel);
})();
