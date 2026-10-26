// Le menu : ouvert par Échap, H ou Start, à tout moment (main.js met la manche en pause tant qu'il est ouvert, sauf en
// ligne). À gauche, le titre, « Rouler » et les rubriques ; à droite, la rubrique choisie (Pistes, Course, En ligne,
// Classement, Commandes, Options). Ici : l'affichage des rubriques, et la navigation au clavier (flèches) et à la manette (croix
// ou stick vers le bouton le plus proche dans cette direction, A pour choisir, B pour revenir, LB / RB pour changer de
// rubrique). Ce que font les boutons est dans main.js.

const PAD = { a: 0, b: 1, lb: 4, rb: 5, up: 12, down: 13, left: 14, right: 15 };
const REPEAT_DELAY = 0.35, REPEAT_EVERY = 0.12; // stick ou croix maintenus : un pas, puis des pas réguliers

/** onTab(t) : appelé à chaque changement de rubrique (le classement se charge quand on l'ouvre). */
export function createMenu({ onTab } = {}) {
  const root = document.getElementById('menu');
  const tabButtons = [...root.querySelectorAll('[data-tab]')];
  const tabs = tabButtons.map((b) => b.dataset.tab);
  let tab = tabs[0], open = false;
  const padPrev = [];
  let held = null, heldFor = 0;

  function setTab(t) {
    if (!tabs.includes(t)) return;
    tab = t;
    for (const b of tabButtons) b.classList.toggle('on', b.dataset.tab === t);
    for (const s of root.querySelectorAll('[data-panel]')) s.classList.toggle('hidden', s.dataset.panel !== t);
    if (onTab) onTab(t);
  }
  setTab(tab);
  for (const b of tabButtons) b.addEventListener('click', () => setTab(b.dataset.tab));

  // ----- Navigation -----
  const visible = (el) => el.offsetParent !== null && !el.disabled;
  const focusables = () => [...root.querySelectorAll('button, input')].filter(visible);
  const current = () => (root.contains(document.activeElement) && visible(document.activeElement) ? document.activeElement : null);
  function focus(el) {
    if (!el) return;
    for (const x of root.querySelectorAll('.nav-focus')) x.classList.remove('nav-focus');
    el.focus({ preventScroll: true });
    el.classList.add('nav-focus'); // (le contour, même quand le navigateur ne le montre pas pour un focus du script)
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  // La souris reprend la main : plus de contour imposé.
  root.addEventListener('mousemove', () => { for (const x of root.querySelectorAll('.nav-focus')) x.classList.remove('nav-focus'); });

  /** Vers le bouton le plus proche dans la direction (dx, dy) : d'abord dans l'axe, puis le moins décalé. */
  function move(dx, dy) {
    const cur = current();
    if (!cur) return focus(root.querySelector('#mGo'));
    // Un curseur (le son) : gauche et droite le règlent.
    if (cur.type === 'range' && dx) {
      const step = Number(cur.step) || 0.05;
      cur.value = String(Math.min(Number(cur.max), Math.max(Number(cur.min), Number(cur.value) + dx * step * 2)));
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of focusables()) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(), ex = r.left + r.width / 2, ey = r.top + r.height / 2;
      // (les distances entre les bords, pour que deux boutons côte à côte de tailles différentes restent voisins)
      const gx = Math.max(0, r.left - a.right, a.left - r.right), gy = Math.max(0, r.top - a.bottom, a.top - r.bottom);
      const along = dx ? (ex - ax) * dx : (ey - ay) * dy;
      if (along <= 4) continue;
      const side = dx ? Math.abs(ey - ay) : Math.abs(ex - ax);
      const score = (dx ? gx : gy) + side * 2 + (dx ? gy : gx) * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) focus(best);
  }
  function stepTab(d) {
    const i = (tabs.indexOf(tab) + d + tabs.length) % tabs.length;
    setTab(tabs[i]);
    focus(tabButtons[i]);
  }
  addEventListener('keydown', (e) => {
    if (!open || (e.target && e.target.matches && e.target.matches('input[type=text], input:not([type])'))) return;
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.code];
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    move(...dir);
  }, true);

  return {
    root,
    get tab() { return tab; },
    isOpen: () => open,
    setTab,
    /** Ouvre le menu (sur une rubrique, sinon la dernière), le bouton « Rouler » choisi. */
    show(t) {
      if (t) setTab(t);
      if (open) return;
      open = true;
      root.classList.remove('hidden');
      focus(root.querySelector('#mGo'));
    },
    hide() {
      if (!open) return;
      open = false;
      root.classList.add('hidden');
      if (root.contains(document.activeElement)) document.activeElement.blur();
    },
    /**
     * La manette, à chaque image tant que le menu est ouvert. close() : B depuis les rubriques de gauche (retour au jeu).
     */
    poll(dt, close) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = [...pads].find((p) => p && p.connected);
      if (!pad) return;
      const btn = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0) > 0.5;
      const hit = (i) => btn(i) && !padPrev[i];
      // La direction : la croix, ou le stick gauche franchement penché.
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const dir = btn(PAD.up) || ay < -0.6 ? 'up' : btn(PAD.down) || ay > 0.6 ? 'down' : btn(PAD.left) || ax < -0.6 ? 'left' : btn(PAD.right) || ax > 0.6 ? 'right' : null;
      if (dir !== held) { held = dir; heldFor = 0; if (dir) move(...{ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir]); }
      else if (dir) {
        heldFor += dt;
        if (heldFor > REPEAT_DELAY) { heldFor -= REPEAT_EVERY; move(...{ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir]); }
      }
      if (hit(PAD.a)) { const cur = current(); if (cur) cur.click(); else focus(root.querySelector('#mGo')); }
      if (hit(PAD.b)) {
        // B : d'une rubrique, on revient à son onglet ; de la colonne de gauche, on retourne au jeu.
        const cur = current();
        if (cur && root.querySelector('.mR').contains(cur)) focus(tabButtons[tabs.indexOf(tab)]);
        else close();
      }
      if (hit(PAD.lb)) stepTab(-1);
      if (hit(PAD.rb)) stepTab(1);
      pad.buttons.forEach((b, i) => { padPrev[i] = b.value > 0.5; });
    },
    /** Après l'ouverture par la manette : ses boutons déjà enfoncés ne comptent pas comme des appuis. */
    syncPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = [...pads].find((p) => p && p.connected);
      if (pad) pad.buttons.forEach((b, i) => { padPrev[i] = b.value > 0.5; });
    },
  };
}
