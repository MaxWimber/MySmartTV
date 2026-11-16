// Injected into regular (desktop) websites: lets the arrow keys move a visible
// focus frame between links and buttons, so the site works with a TV remote.
(() => {
  if (window.__stvSpatnav) return;
  window.__stvSpatnav = true;

  const SELECTOR = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
    '[tabindex]:not([tabindex="-1"])', '[role="button"]', '[role="link"]',
    '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[contenteditable="true"]',
  ].join(',');
  const FOCUS_CLASS = '__stv-focus';
  const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  const style = document.createElement('style');
  style.textContent = `.${FOCUS_CLASS}{outline:4px solid #4da3ff!important;outline-offset:2px!important;box-shadow:0 0 0 8px rgba(77,163,255,.35)!important;border-radius:6px}`;
  (document.head || document.documentElement).appendChild(style);

  let current = null;

  const isTextField = (el) =>
    !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && !['button', 'submit', 'checkbox', 'radio', 'range', 'reset', 'image'].includes(el.type)));

  function isCandidate(el) {
    if (el.disabled || el.closest('[aria-hidden="true"], [inert]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    // Look a couple of screens away so focus can travel and scroll the page.
    if (r.bottom < -2 * innerHeight || r.top > 3 * innerHeight) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    return true;
  }

  function setFocus(el) {
    if (current) current.classList.remove(FOCUS_CLASS);
    current = el;
    el.classList.add(FOCUS_CLASS);
    if (!el.matches(SELECTOR) || el.tabIndex < 0) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    const r = el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function best(dir, from) {
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let winner = null;
    let winnerScore = Infinity;
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (el === from || from.contains(el) || el.contains(from) || !isCandidate(el)) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      let main;
      let cross;
      if (dir === 'left') { if (bx >= ax - 1) continue; main = a.left - b.right; cross = Math.abs(by - ay); }
      if (dir === 'right') { if (bx <= ax + 1) continue; main = b.left - a.right; cross = Math.abs(by - ay); }
      if (dir === 'up') { if (by >= ay - 1) continue; main = a.top - b.bottom; cross = Math.abs(bx - ax); }
      if (dir === 'down') { if (by <= ay + 1) continue; main = b.top - a.bottom; cross = Math.abs(bx - ax); }
      const horizontal = dir === 'left' || dir === 'right';
      const score = Math.max(0, main) + cross * (horizontal ? 3 : 1.2);
      if (score < winnerScore) { winnerScore = score; winner = el; }
    }
    return winner;
  }

  function first() {
    let pick = null;
    let pickScore = Infinity;
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (!isCandidate(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.top > innerHeight) continue;
      const score = r.top * 2 + r.left;
      if (score < pickScore) { pickScore = score; pick = el; }
    }
    return pick;
  }

  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.fullscreenElement) return; // the video player handles its own keys
    const active = document.activeElement;
    const dir = DIRS[e.key];

    if (dir) {
      if (isTextField(active) && (dir === 'left' || dir === 'right')) return;
      if (active && active.closest('[role="slider"], video')) return;
      let from = current && current.isConnected ? current : null;
      if (!from && active && active !== document.body && active.matches(SELECTOR)) from = active;
      const target = from ? best(dir, from) : first();
      e.preventDefault();
      e.stopPropagation();
      if (target) setFocus(target);
      else if (dir === 'up' || dir === 'down') scrollBy({ top: (dir === 'up' ? -0.6 : 0.6) * innerHeight, behavior: 'smooth' });
      return;
    }

    // Enter on things that are not natively clickable by keyboard (div role=button etc.).
    if (e.key === 'Enter' && current && current.isConnected && active === current &&
        !isTextField(current) && !['A', 'BUTTON', 'SELECT'].includes(current.tagName)) {
      e.preventDefault();
      current.click();
    }
  }, true);

  // Keep the frame in sync when the user clicks with the mouse/touchpad.
  addEventListener('focusin', (e) => {
    if (current && e.target !== current) { current.classList.remove(FOCUS_CLASS); current = null; }
  }, true);
})();
