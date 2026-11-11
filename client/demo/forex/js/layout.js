'use strict';

/* Small screens (phones, narrow windows): the menu folds behind a "Menu" button at the top of the sidebar and closes
   again when a page is chosen. On wider screens the menu is always shown (css/app.css, "fit every screen"). */
(() => {
  const setUp = () => {
    const side = document.querySelector('.sidebar');
    if (!side || side.querySelector('.nav-toggle')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-toggle';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span>☰ Menu</span><span aria-hidden="true">▾</span>';
    btn.addEventListener('click', () => { const open = side.classList.toggle('open'); btn.setAttribute('aria-expanded', String(open)); });
    (side.querySelector('.brand') || side.firstElementChild).insertAdjacentElement('afterend', btn);
    window.addEventListener('hashchange', () => { side.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setUp); else setUp();
})();
