/* Pulse Grid — jeu mobile autonome, sans dépendance externe. */
(() => {
  'use strict';

  const GRID = 8;
  const QUEUE_SIZE = 3;
  const SAVE_KEY = 'pulse-grid-save-v1';
  const APP_VERSION = '5.2';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const formatNumber = value => new Intl.NumberFormat('fr-FR').format(Math.round(value || 0));
  const scheduleFrame = callback => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 16);
  const cancelScheduledFrame = frame => {
    if (frame === null || frame === undefined) return;
    if (typeof cancelAnimationFrame === 'function' && typeof requestAnimationFrame === 'function') cancelAnimationFrame(frame);
    else clearTimeout(frame);
  };

  // Réglages du drag (à tester sur téléphone) :
  // - false : on écoute pointermove (aligné sur les frames, moins de travail pour le téléphone)
  // - true  : on écoute pointerrawupdate (plus d'événements, peut saturer un téléphone modeste)
  const DRAG_USE_RAW_UPDATES = false;
  // - true  : la pièce est dessinée légèrement en avance sur la trajectoire du doigt
  //   (compense la latence de l'écran tactile) ; false : position exacte du doigt.
  const DRAG_USE_PREDICTION = false;
  // Tolérance du placement : la pièce se « colle » à la meilleure case valide
  // située à moins de DRAG_SNAP_RADIUS cases de sa position réelle (0 = très strict).
  const DRAG_SNAP_RADIUS = 1.3;
  // Décalage vertical (en pixels) de la pièce au-dessus du doigt, pour qu'elle
  // ne soit pas cachée par le doigt. 0 = sous le doigt (comportement d'origine).
  const DRAG_LIFT_PX = 0;

  const SHAPE_LIBRARY = [
    { id: 'dot', cells: [[0, 0]] },
    { id: 'domino-h', cells: [[0, 0], [0, 1]] },
    { id: 'domino-v', cells: [[0, 0], [1, 0]] },
    { id: 'tri-h', cells: [[0, 0], [0, 1], [0, 2]] },
    { id: 'tri-v', cells: [[0, 0], [1, 0], [2, 0]] },
    { id: 'square', cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { id: 'rect-2x3', cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]] },
    { id: 'rect-3x3', cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]] },
    { id: 'l-small', cells: [[0, 0], [1, 0], [1, 1]] },
    { id: 'l-big', cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
    { id: 't', cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
    { id: 'z', cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
    { id: 'plus', cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] },
    { id: 'line-4-h', cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    { id: 'line-4-v', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] }
  ];

  const PIECE_COLORS = {
    dot: { primary: '#65e8d0', secondary: '#23b7d4', soft: 'rgba(101,232,208,.28)' },
    'domino-h': { primary: '#65e8d0', secondary: '#299bd6', soft: 'rgba(101,232,208,.28)' },
    'domino-v': { primary: '#a894ff', secondary: '#625dff', soft: 'rgba(139,124,255,.28)' },
    'tri-h': { primary: '#ffe08a', secondary: '#ff9b70', soft: 'rgba(255,209,122,.3)' },
    'tri-v': { primary: '#a6f58c', secondary: '#38cba7', soft: 'rgba(143,240,187,.28)' },
    square: { primary: '#ffadca', secondary: '#ff5d91', soft: 'rgba(255,127,158,.28)' },
    'rect-2x3': { primary: '#ffd17a', secondary: '#ff7f9e', soft: 'rgba(255,209,122,.28)' },
    'rect-3x3': { primary: '#c4f36d', secondary: '#53d99d', soft: 'rgba(196,243,109,.28)' },
    'l-small': { primary: '#91d9ff', secondary: '#558cff', soft: 'rgba(110,184,255,.28)' },
    'l-big': { primary: '#d1f878', secondary: '#54d99d', soft: 'rgba(196,243,109,.28)' },
    t: { primary: '#e4a5ff', secondary: '#9472ff', soft: 'rgba(224,154,255,.28)' },
    z: { primary: '#ffb18b', secondary: '#ff637c', soft: 'rgba(255,155,112,.28)' },
    plus: { primary: '#f4b6ff', secondary: '#b56cff', soft: 'rgba(224,154,255,.28)' },
    'line-4-h': { primary: '#75e9ff', secondary: '#4c8dff', soft: 'rgba(110,184,255,.28)' },
    'line-4-v': { primary: '#ffe28a', secondary: '#ff856e', soft: 'rgba(255,209,122,.3)' }
  };
  const getPieceColor = id => skinColorForShape(CATALOG.skins.find(item => item.id === profile.equipped.skin), id);
  const STARTER_WAVES = [
    ['domino-h', 'square', 'tri-h'],
    ['domino-v', 'l-small', 'line-4-h']
  ];

  /* =====================================================================
     SHAPES — formes de pièces, géométrie générique et définition des plateaux
     ---------------------------------------------------------------------
     Un plateau est décrit par :
       - rows / cols : boîte englobante (la grille DOM reste rectangulaire,
         ce qui permet de réutiliser tel quel le drag, les métriques et la preview) ;
       - cell(r, c)  : quelles cases EXISTENT (les autres sont « void » :
         le moteur ne les considère pas comme jouables) ;
       - lines       : ce qui remplace la « ligne complète » (lignes, colonnes,
         diagonales, zones personnalisées, avec poids et statut « spéciale ») ;
       - pool        : pièces compatibles avec leur poids de tirage ;
       - starter     : mains de départ ; mastery : conditions de progression.
     Pour ajouter une forme : ajouter UN objet dans SHAPE_BOARDS (et, si besoin,
     de nouvelles pièces dans EXTRA_SHAPES). Rien d'autre à modifier.
     ===================================================================== */
  const EXTRA_SHAPES = [
    { id: 'line-5-h', cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
    { id: 'line-5-v', cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
    { id: 'l3-b', cells: [[0, 0], [0, 1], [1, 0]] },
    { id: 'l3-c', cells: [[0, 0], [0, 1], [1, 1]] },
    { id: 'l3-d', cells: [[0, 1], [1, 0], [1, 1]] },
    { id: 'stair-6', cells: [[0, 0], [1, 0], [1, 1], [2, 0], [2, 1], [2, 2]] },
    { id: 'stair-6-i', cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [2, 0]] },
    { id: 't-up', cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
    { id: 't-left', cells: [[0, 0], [1, 0], [1, 1], [2, 0]] },
    { id: 't-right', cells: [[0, 1], [1, 0], [1, 1], [2, 1]] },
    { id: 's', cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
    { id: 'pyr-9', cells: [[0, 2], [1, 1], [1, 2], [1, 3], [2, 0], [2, 1], [2, 2], [2, 3], [2, 4]] },
    { id: 'pyr-9-i', cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 1], [1, 2], [1, 3], [2, 2]] },
    { id: 'p-5', cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]] },
    { id: 'u-5', cells: [[0, 0], [0, 1], [1, 0], [2, 0], [2, 1]] },
    { id: 'v-5', cells: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]] }
  ];
  Object.assign(PIECE_COLORS, {
    'line-5-h': { primary: '#8ff0ff', secondary: '#3f8bff', soft: 'rgba(110,184,255,.3)' },
    'line-5-v': { primary: '#ffd8a0', secondary: '#ff7a6e', soft: 'rgba(255,170,120,.3)' },
    'l3-b': { primary: '#9ee6ff', secondary: '#4f7dff', soft: 'rgba(110,184,255,.28)' },
    'l3-c': { primary: '#8cf5c0', secondary: '#2fb8a0', soft: 'rgba(110,240,190,.28)' },
    'l3-d': { primary: '#ffc4e0', secondary: '#ff6f9b', soft: 'rgba(255,127,158,.28)' },
    'stair-6': { primary: '#ffe08a', secondary: '#ff9b6a', soft: 'rgba(255,209,122,.3)' },
    'stair-6-i': { primary: '#c9b5ff', secondary: '#7a63ff', soft: 'rgba(139,124,255,.3)' },
    't-up': { primary: '#f2b0ff', secondary: '#9a6bff', soft: 'rgba(224,154,255,.28)' },
    't-left': { primary: '#ffb7a0', secondary: '#ff6a7a', soft: 'rgba(255,155,112,.28)' },
    't-right': { primary: '#a5f0a0', secondary: '#38cba7', soft: 'rgba(143,240,187,.28)' },
    s: { primary: '#ffcf8a', secondary: '#ff8a5e', soft: 'rgba(255,170,100,.28)' },
    'pyr-9': { primary: '#fff0a0', secondary: '#ffa24d', soft: 'rgba(255,209,122,.32)' },
    'pyr-9-i': { primary: '#8fe9ff', secondary: '#5a7dff', soft: 'rgba(110,184,255,.3)' },
    'p-5': { primary: '#ffa9d0', secondary: '#c85dff', soft: 'rgba(224,154,255,.3)' },
    'u-5': { primary: '#b4f58f', secondary: '#38b6a0', soft: 'rgba(143,240,187,.3)' },
    'v-5': { primary: '#ffe28a', secondary: '#ff7f6a', soft: 'rgba(255,209,122,.3)' }
  });
  const ALL_SHAPES = [...SHAPE_LIBRARY, ...EXTRA_SHAPES];
  const SHAPE_BY_ID = Object.fromEntries(ALL_SHAPES.map(def => [def.id, def]));

  const circleDist = (r, c, size) => Math.hypot(r - (size - 1) / 2, c - (size - 1) / 2);
  const CLASSIC_DEF = { id: 'classic', name: 'Classic', rows: GRID, cols: GRID };

  const SHAPE_BOARDS = [
    {
      id: 'square', name: 'Carré', icon: '■', accent: '#65e8d0', rows: 8, cols: 8,
      tagline: 'Les fondations',
      rule: 'Plateau 8×8 : remplis une ligne ou une colonne pour la dissoudre. Les pièces classiques, pour apprendre les bases.',
      specialLabel: null,
      lines: [{ kind: 'rows' }, { kind: 'cols' }],
      starter: STARTER_WAVES,
      pool: SHAPE_LIBRARY.map(def => [def.id, 1]),
      mastery: { lines: 30, combo: 3, score: 1800 },
      reward: { coins: 120, xp: 160 }
    },
    {
      id: 'rectangle', name: 'Rectangle', icon: '▭', accent: '#8b9cff', rows: 6, cols: 9,
      tagline: 'Long et étroit',
      rule: '9 colonnes pour 6 rangées. Les lignes de 9 cases sont des lignes longues : elles rapportent ×1,5. Pièces de 5 cases en renfort.',
      specialLabel: 'Lignes longues',
      lines: [{ kind: 'rows', weight: 1.5, special: true }, { kind: 'cols' }],
      starter: [['domino-h', 'tri-h', 'square'], ['l-small', 'domino-v', 'line-4-h']],
      pool: [['dot', 1], ['domino-h', 1], ['domino-v', 1], ['tri-h', 1], ['tri-v', 1], ['square', 1], ['rect-2x3', 1], ['l-small', 1],
        ['l3-b', .8], ['l3-c', .8], ['l3-d', .8], ['l-big', 1], ['t', 1], ['t-up', .8], ['z', 1], ['s', .8], ['plus', .7],
        ['line-4-h', 1], ['line-4-v', .8], ['line-5-h', 1.3], ['line-5-v', .6]],
      mastery: { lines: 40, combo: 3, score: 2200, special: 6 },
      reward: { coins: 160, xp: 200 }
    },
    {
      id: 'triangle', name: 'Triangle', icon: '◣', accent: '#ffd17a', rows: 9, cols: 9,
      cell: (r, c) => c <= r,
      tagline: 'Trois directions',
      rule: 'Escalier triangulaire à 3 directions : lignes, colonnes ET diagonales. Une diagonale complète vaut ×1,5. Pièces en escalier.',
      specialLabel: 'Diagonales',
      lines: [{ kind: 'rows', min: 4 }, { kind: 'cols', min: 4 }, { kind: 'diag', min: 4, weight: 1.5, special: true }],
      starter: [['domino-h', 'l3-d', 'tri-v'], ['l-small', 'square', 'domino-v']],
      pool: [['dot', 1], ['domino-h', 1], ['domino-v', 1], ['tri-h', 1], ['tri-v', 1], ['square', 1], ['l-small', 1.2], ['l3-b', 1],
        ['l3-c', 1], ['l3-d', 1.2], ['l-big', .8], ['t', .8], ['t-up', 1], ['t-left', 1], ['t-right', 1], ['stair-6', 1.5],
        ['stair-6-i', 1.1], ['z', .7], ['s', .7], ['line-4-h', .6], ['line-4-v', .6]],
      mastery: { lines: 40, combo: 3, score: 2400, special: 4 },
      reward: { coins: 200, xp: 240 }
    },
    {
      id: 'diamond', name: 'Losange', icon: '◆', accent: '#ff7f9e', rows: 10, cols: 10,
      cell: (r, c, R, C) => Math.abs(r - (R - 1) / 2) + Math.abs(c - (C - 1) / 2) <= R / 2,
      tagline: 'Le cœur du diamant',
      rule: 'Losange de 60 cases, sans bord droit : les petites pièces sont reines. Les 4 bords diagonaux sont des lignes spéciales (×2), en plus des lignes et colonnes de 3 cases ou plus.',
      specialLabel: 'Bords du losange',
      lines: [{ kind: 'rows', min: 3 }, { kind: 'cols', min: 3 }, {
        kind: 'custom', name: 'rim', min: 5, weight: 2, special: true,
        key: (r, c) => {
          const dr = r - 4.5; const dc = c - 4.5;
          if (Math.abs(dr) + Math.abs(dc) !== 5) return null;
          return [`${dr < 0 ? 'N' : 'S'}${dc < 0 ? 'W' : 'E'}`];
        }
      }],
      starter: [['domino-h', 'plus', 'tri-h'], ['l-small', 'square', 'domino-v']],
      pool: [['dot', 2], ['domino-h', 1.6], ['domino-v', 1.6], ['tri-h', 1.2], ['tri-v', 1.2], ['square', .8], ['l-small', 1.1], ['l3-b', 1], ['l3-c', 1], ['l3-d', 1], ['plus', .5], ['t-up', .6], ['t-left', .6], ['t-right', .6], ['z', .5], ['s', .5], ['line-4-h', .5], ['line-4-v', .5]],
      mastery: { lines: 40, combo: 4, score: 2600, special: 3 },
      reward: { coins: 260, xp: 300 }
    },
    {
      id: 'circle', name: 'Cercle', icon: '●', accent: '#c58bff', rows: 10, cols: 10,
      cell: (r, c, R) => circleDist(r, c, R) <= 4.9,
      tagline: 'Pas un coin droit',
      rule: 'Disque de 76 cases. Lignes et colonnes de 5 cases ou plus, plus deux zones concentriques : le Noyau (×2) et l\'Anneau (×2). Pièces arrondies.',
      specialLabel: 'Noyau & anneau',
      lines: [{ kind: 'rows', min: 5 }, { kind: 'cols', min: 5 }, {
        kind: 'custom', name: 'zone', min: 16, weight: 2, special: true,
        key: (r, c) => { const d = circleDist(r, c, 10); return d < 2.2 ? 'core' : d < 3.3 ? 'ring' : null; }
      }],
      starter: STARTER_WAVES,
      pool: [['dot', 1], ['domino-h', 1], ['domino-v', 1], ['tri-h', 1], ['tri-v', 1], ['square', 1.2], ['rect-2x3', .8], ['l-small', 1],
        ['l3-b', 1], ['l3-c', 1], ['l3-d', 1], ['p-5', 1.2], ['u-5', 1], ['v-5', 1], ['plus', 1], ['t', 1], ['z', .9], ['s', .9],
        ['l-big', .8], ['line-4-h', .6], ['line-4-v', .6]],
      mastery: { lines: 55, combo: 4, score: 3400, special: 4 },
      reward: { coins: 340, xp: 380 }
    }
  ];

  // Construit la géométrie d'un plateau : cases existantes, lignes, index case → lignes, pool.
  function buildGeometry(def) {
    const { rows, cols } = def;
    const mask = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (def.cell ? Boolean(def.cell(r, c, rows, cols)) : true)));
    let cellCount = 0;
    mask.forEach(row => row.forEach(value => { if (value) cellCount += 1; }));

    const lines = [];
    const addLine = (spec, kind, cells) => {
      if (cells.length >= (spec.min || 1)) lines.push({ kind: spec.name || kind, cells, weight: spec.weight || 1, special: Boolean(spec.special) });
    };
    // Découpe une suite de cases en tronçons contigus selon un pas (dr, dc).
    const splitRuns = (cells, dr, dc) => {
      const runs = []; let current = [];
      cells.forEach(cell => {
        const previous = current[current.length - 1];
        if (previous && !(cell[0] - previous[0] === dr && cell[1] - previous[1] === dc)) { runs.push(current); current = []; }
        current.push(cell);
      });
      if (current.length) runs.push(current);
      return runs;
    };
    const specs = def.lines || [{ kind: 'rows' }, { kind: 'cols' }];
    specs.forEach(spec => {
      if (spec.kind === 'rows') {
        for (let r = 0; r < rows; r++) {
          const cells = []; for (let c = 0; c < cols; c++) if (mask[r][c]) cells.push([r, c]);
          splitRuns(cells, 0, 1).forEach(run => addLine(spec, 'rows', run));
        }
      } else if (spec.kind === 'cols') {
        for (let c = 0; c < cols; c++) {
          const cells = []; for (let r = 0; r < rows; r++) if (mask[r][c]) cells.push([r, c]);
          splitRuns(cells, 1, 0).forEach(run => addLine(spec, 'cols', run));
        }
      } else if (spec.kind === 'diag' || spec.kind === 'anti') {
        const groups = new Map();
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (mask[r][c]) {
          const key = spec.kind === 'diag' ? r - c : r + c;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push([r, c]);
        }
        groups.forEach(cells => splitRuns(cells, 1, spec.kind === 'diag' ? 1 : -1).forEach(run => addLine(spec, spec.kind, run)));
      } else if (spec.kind === 'custom') {
        const groups = new Map();
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (mask[r][c]) {
          const result = spec.key(r, c);
          const keys = result === null || result === undefined ? [] : Array.isArray(result) ? result : [result];
          keys.forEach(key => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push([r, c]); });
        }
        groups.forEach(cells => addLine(spec, 'custom', cells));
      }
    });

    const cellLines = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
    lines.forEach((line, index) => line.cells.forEach(([r, c]) => cellLines[r][c].push(index)));
    const pool = (def.pool || SHAPE_LIBRARY.map(shape => [shape.id, 1])).map(([id, weight]) => ({ def: SHAPE_BY_ID[id], w: weight }));
    return { id: def.id, def, rows, cols, mask, cellCount, lines, cellLines, pool, starter: def.starter || STARTER_WAVES, full: cellCount === rows * cols };
  }
  const GEO_CACHE = {};
  const getGeometry = def => GEO_CACHE[def.id] || (GEO_CACHE[def.id] = buildGeometry(def));
  // Géométrie active : Classic par défaut, remplacée au lancement d'une partie SHAPES.
  let geo = getGeometry(CLASSIC_DEF);

  const CATALOG = {
    skins: [
      { id: 'aurora', name: 'Aurora', price: 0, description: 'Le bloc de référence : brillant, net, lumineux.', primary: '#65e8d0', secondary: '#8b7cff', soft: 'rgba(101,232,208,.18)', contrast: '#07141b' },
      { id: 'ember', name: 'Ember', price: 180, description: 'Des blocs de lave : cœur sombre, braise qui couve dessous.', primary: '#ff9b70', secondary: '#ff4f92', soft: 'rgba(255,126,112,.18)', contrast: '#261016',
        palette: [['#ffd36e', '#ff7a1a'], ['#ff9a52', '#e8321e'], ['#ffb347', '#d6281f'], ['#ff6b4a', '#b3122d'], ['#ffe08a', '#ff8a3d'], ['#ff5a36', '#8f0f2a']] },
      { id: 'pixel', name: 'Pixel Arcade', price: 240, description: 'Relief 8 bits et couleurs pleines, comme sur une vraie borne.', primary: '#4dff88', secondary: '#4da6ff', soft: 'rgba(77,255,136,.18)', contrast: '#04140a',
        palette: [['#ff5d5d', '#b30000'], ['#4dff88', '#00a844'], ['#4da6ff', '#0050c8'], ['#ffe14d', '#c89a00'], ['#ff5dff', '#a000a0'], ['#ff9a3d', '#c24b00']] },
      { id: 'cobalt', name: 'Cobalt', price: 260, description: 'Des blocs de verre glacé, taillés pour refléter la lumière.', primary: '#6eb8ff', secondary: '#6673ff', soft: 'rgba(110,184,255,.18)', contrast: '#081426',
        palette: [['#d9f4ff', '#5bb8ff'], ['#a8e3ff', '#3a7bff'], ['#c7e9ff', '#6a8dff'], ['#8fd2ff', '#2e5fe0'], ['#e6f7ff', '#7ec8ff'], ['#b4c0ff', '#4a58e8']] },
      { id: 'lime', name: 'Lime Shift', price: 340, description: 'Des bonbons gélifiés rebondis, avec leurs reflets mouillés.', primary: '#c4f36d', secondary: '#53d99d', soft: 'rgba(196,243,109,.18)', contrast: '#12210f',
        palette: [['#d7ff6e', '#3fd97a'], ['#ffe75e', '#ffa81f'], ['#ff8fc4', '#ff4e9a'], ['#7ee8ff', '#2fb4ff'], ['#c9a6ff', '#8a5bff'], ['#ffb07a', '#ff6a4f']] },
      { id: 'violet', name: 'Ultraviolet', price: 460, description: 'Des tubes néon : contour électrique, cœur incandescent.', primary: '#e09aff', secondary: '#766cff', soft: 'rgba(224,154,255,.18)', contrast: '#1a0c24',
        palette: [['#f0a5ff', '#b34dff'], ['#8fa6ff', '#5a4dff'], ['#ff8ad8', '#ff3fa9'], ['#76f0ff', '#2fa5ff'], ['#c4a0ff', '#7b4dff'], ['#ff9bd0', '#d13fff']] },
      { id: 'prism', name: 'Prism Shift', price: 520, description: 'Des gemmes taillées en facettes qui captent chaque reflet.', primary: '#f5a8ff', secondary: '#65e8ff', soft: 'rgba(186,151,255,.2)', contrast: '#160d28',
        palette: [['#ff9bd2', '#b06cff'], ['#7ff3ff', '#4a8bff'], ['#9bffb3', '#2fd6a5'], ['#fff08a', '#ffb03f'], ['#ffa8a8', '#ff4f7a'], ['#c3a8ff', '#6a6bff']] },
      { id: 'solaris', name: 'Solaris', price: 620, description: 'De l’or massif brossé, serti de rivets polis.', primary: '#ffe28a', secondary: '#ff6e89', soft: 'rgba(255,186,116,.2)', contrast: '#29130f',
        palette: [['#fff0a0', '#e0a020'], ['#ffe27a', '#c98512'], ['#ffd2b0', '#d6703a'], ['#f4f6ff', '#a9b4d6'], ['#ffc85a', '#d4691f'], ['#ffc1b0', '#d0788a']] }
    ],
    boards: [
      { id: 'night', name: 'Nuit profonde', price: 0, description: 'Le plateau original de Pulse Grid.', shell: '#182846', cell: '#263b5d', glow: 'rgba(101,232,208,.2)', preview: '#203452' },
      { id: 'glass', name: 'Verre fumé', price: 220, description: 'Une vitre givrée aux reflets de lumière.', shell: '#20384c', cell: '#31536a', glow: 'rgba(120,217,255,.28)', preview: '#2d4b60' },
      { id: 'carbon', name: 'Carbone', price: 300, description: 'Fibre tressée, mate et dense. Sensation arcade.', shell: '#1c1f26', cell: '#2f343d', glow: 'rgba(255,155,112,.26)', preview: '#30343b' },
      { id: 'sunset', name: 'Synthwave', price: 380, description: 'Un coucher de soleil rétro-futuriste sous la grille.', shell: '#3a1170', cell: 'rgba(26,8,56,.66)', glow: 'rgba(255,92,160,.34)', preview: '#4a1685' },
      { id: 'nebula', name: 'Nébuleuse', price: 400, description: 'Un ciel d’étoiles et de gaz cosmiques derrière chaque case.', shell: '#2a2550', cell: 'rgba(40,30,92,.62)', glow: 'rgba(224,154,255,.3)', preview: '#3a3263' },
      { id: 'gridline', name: 'Gridline', price: 520, description: 'Une grille de néon turquoise, tracée au laser.', shell: '#071e26', cell: 'rgba(8,38,46,.92)', glow: 'rgba(101,232,208,.36)', preview: '#164149' },
      { id: 'void', name: 'Void', price: 600, description: 'Un vortex violet qui aspire la lumière de la grille.', shell: '#100a20', cell: 'rgba(20,11,40,.88)', glow: 'rgba(190,110,255,.4)', preview: '#26183e' }
    ],
    effects: [
      { id: 'burst', name: 'Burst', price: 0, description: 'Éclats géométriques à chaque ligne.', icon: '✦' },
      { id: 'ring', name: 'Anneaux', price: 200, description: 'Des ondes de choc concentriques traversent le plateau.', icon: '◎' },
      { id: 'confetti', name: 'Confettis', price: 320, description: 'Une explosion de confettis pour fêter chaque grand coup.', icon: '·✦·' },
      { id: 'spark', name: 'Étincelles', price: 430, description: 'Des traînées dorées qui fusent comme un feu d’artifice.', icon: '⁕' },
      { id: 'nova', name: 'Nova', price: 550, description: 'Un éclair blanc, une onde de choc : la ligne devient supernova.', icon: '✺' },
      { id: 'magnet', name: 'Magnétisme', price: 600, description: 'Les débris sont aspirés en spirale vers un cœur lumineux.', icon: '◉' }
    ],
    boosters: [
      { id: 'hammer', name: 'Éclateur', price: 75, description: 'Retire un carré précis sans casser ton rythme.', icon: '⌁', tag: 'PRÉCISION', howTo: 'Active puis touche un carré occupé.' },
      { id: 'reroll', name: 'Recomposition', price: 95, description: 'Change les fragments disponibles quand la main ne répond plus.', icon: '⟳', tag: 'OPTIONS', howTo: 'Remplace les fragments encore libres.' },
      { id: 'pulse-core', name: 'Surcharge Pulse', price: 135, description: 'Remplit la charge pour préparer une Pulse Burst immédiate.', icon: '\u26A1\uFE0E', tag: 'COMBO', howTo: 'La prochaine ligne déclenche la Burst.' },
      { id: 'scanner', name: 'Scanner Tactique', price: 60, description: 'Révèle une position forte sans jouer à ta place.', icon: '⌕', tag: 'INTEL', howTo: 'Active pour afficher le meilleur fragment.' },
      { id: 'line-breaker', name: 'Lame de Ligne', price: 145, description: 'Ouvre une ligne horizontale au point faible de ta grille.', icon: '╾', tag: 'SECOURS', howTo: 'Active puis touche une case de la ligne.' }
    ],
    packs: [
      { id: 'starter', name: 'Kit Ouverture', price: 220, description: 'Les outils essentiels pour sortir d’une grille serrée.', icon: '▣', badge: 'DÉPART', savings: '−10%', contents: { hammer: 1, scanner: 2, reroll: 1 } },
      { id: 'combo', name: 'Kit Combo', price: 440, description: 'Un stock équilibré pour préparer et prolonger les séries.', icon: '✦', badge: 'POPULAIRE', savings: '−15%', contents: { hammer: 2, scanner: 1, 'pulse-core': 2, 'line-breaker': 1 } },
      { id: 'overdrive', name: 'Kit Overdrive', price: 760, description: 'La réserve complète pour les runs où chaque espace compte.', icon: '◆', badge: 'VALEUR MAX', savings: '−20%', contents: { hammer: 3, reroll: 2, scanner: 2, 'pulse-core': 3, 'line-breaker': 2 } }
    ]
  };

  const PROGRESSION_REWARDS = [
    { level: 1, type: 'coins', amount: 60, icon: '◆', title: 'Impulsion de départ' },
    { level: 2, type: 'booster', id: 'hammer', amount: 1, icon: '⌁', title: 'Marteau' },
    { level: 3, type: 'coins', amount: 90, icon: '◆', title: 'Réserve de PulseCoins' },
    { level: 4, type: 'booster', id: 'reroll', amount: 1, icon: '⟳', title: 'Recomposition' },
    { level: 5, type: 'skin', id: 'cobalt', icon: '✦', title: 'Skin Cobalt', milestone: true },
    { level: 6, type: 'coins', amount: 120, icon: '◆', title: 'Réserve renforcée' },
    { level: 7, type: 'pack', id: 'starter', amount: 1, icon: '▣', title: 'Pack de départ' },
    { level: 8, type: 'booster', id: 'pulse-core', amount: 1, icon: '\u26A1\uFE0E', title: 'Noyau Pulse' },
    { level: 9, type: 'coins', amount: 140, icon: '◆', title: 'Réserve brillante' },
    { level: 10, type: 'board', id: 'glass', icon: '▦', title: 'Plateau Verre fumé', milestone: true },
    { level: 11, type: 'coins', amount: 150, icon: '◆', title: 'PulseCoins' },
    { level: 12, type: 'booster', id: 'hammer', amount: 2, icon: '⌁', title: 'Deux Marteaux' },
    { level: 13, type: 'effect', id: 'ring', icon: '◎', title: 'Effet Anneaux' },
    { level: 14, type: 'coins', amount: 180, icon: '◆', title: 'Réserve experte' },
    { level: 15, type: 'skin', id: 'lime', icon: '✦', title: 'Skin Lime Shift', milestone: true },
    { level: 16, type: 'pack', id: 'combo', amount: 1, icon: '▣', title: 'Pack Combo' },
    { level: 17, type: 'coins', amount: 200, icon: '◆', title: 'PulseCoins' },
    { level: 18, type: 'booster', id: 'pulse-core', amount: 2, icon: '\u26A1\uFE0E', title: 'Double Noyau Pulse' },
    { level: 19, type: 'coins', amount: 220, icon: '◆', title: 'Réserve avancée' },
    { level: 20, type: 'effect', id: 'confetti', icon: '✧', title: 'Effet Confettis', milestone: true },
    { level: 21, type: 'coins', amount: 240, icon: '◆', title: 'PulseCoins' },
    { level: 22, type: 'booster', id: 'reroll', amount: 2, icon: '⟳', title: 'Double Recomposition' },
    { level: 23, type: 'pack', id: 'starter', amount: 1, icon: '▣', title: 'Pack de départ' },
    { level: 24, type: 'coins', amount: 260, icon: '◆', title: 'Réserve architecte' },
    { level: 25, type: 'board', id: 'nebula', icon: '▦', title: 'Plateau Nébuleuse', milestone: true },
    { level: 26, type: 'booster', id: 'hammer', amount: 2, icon: '⌁', title: 'Marteaux experts' },
    { level: 27, type: 'coins', amount: 280, icon: '◆', title: 'PulseCoins' },
    { level: 28, type: 'effect', id: 'spark', icon: '⁕', title: 'Effet Étincelles' },
    { level: 29, type: 'coins', amount: 300, icon: '◆', title: 'Grande réserve' },
    { level: 30, type: 'skin', id: 'violet', icon: '✦', title: 'Skin Ultraviolet', milestone: true }
  ];

  const DEFAULT_STATS = { games: 0, totalScore: 0, totalLines: 0, bestCombo: 0, piecesPlaced: 0, pulseBursts: 0, boostersUsed: 0, perfectClears: 0 };
  const defaultSave = () => ({
    best: 0,
    coins: 240,
    xp: 0,
    level: 1,
    unlocked: { skins: ['aurora'], boards: ['night'], effects: ['burst'] },
    equipped: { skin: 'aurora', board: 'night', effect: 'burst' },
    inventory: { hammer: 2, reroll: 1, 'pulse-core': 0, scanner: 0, 'line-breaker': 0 },
    stats: { ...DEFAULT_STATS },
    sound: true,
    music: false,
    volume: .72,
    progressionClaims: [],
    missionDate: '',
    missions: [],
    shapes: defaultShapes(),
    ui: 'soft',
    haptics: true,
    reduceMotion: false,
    showTip: true,
    tutorialDone: false,
    achievements: {},
    daily: { last: '', streak: 0 },
    run: null
  });

  // ----- SHAPES : données de sauvegarde (séparées de Classic) -----
  const defaultBoardProgress = () => ({ lines: 0, special: 0, bestCombo: 0, bestScore: 0, games: 0, mastered: false, seen: false });
  const defaultShapes = () => ({ current: SHAPE_BOARDS[0].id, boards: {}, stats: { ...DEFAULT_STATS } });
  // Accepte n'importe quelle ancienne sauvegarde : tout champ manquant reçoit sa valeur par défaut.
  // Le déblocage est DÉRIVÉ (plateau précédent maîtrisé), donc ajouter une forme plus tard ne casse rien.
  function normalizeShapes(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const result = defaultShapes();
    const num = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; };
    result.stats = { ...DEFAULT_STATS, ...(source.stats && typeof source.stats === 'object' ? source.stats : {}) };
    SHAPE_BOARDS.forEach(board => {
      const saved = source.boards && typeof source.boards === 'object' && source.boards[board.id] && typeof source.boards[board.id] === 'object' ? source.boards[board.id] : {};
      const base = defaultBoardProgress();
      result.boards[board.id] = {
        lines: num(saved.lines), special: num(saved.special), bestCombo: num(saved.bestCombo), bestScore: num(saved.bestScore), games: num(saved.games),
        mastered: saved.mastered === true, seen: saved.seen === true || base.seen
      };
    });
    result.current = SHAPE_BOARDS.some(board => board.id === source.current) ? source.current : SHAPE_BOARDS[0].id;
    // Cohérence : on ne reste jamais sur un plateau verrouillé.
    const index = SHAPE_BOARDS.findIndex(board => board.id === result.current);
    if (index > 0 && !result.boards[SHAPE_BOARDS[index - 1].id].mastered) result.current = SHAPE_BOARDS[0].id;
    return result;
  }

  let profile = loadProfile();
  let state = {
    screen: 'home',
    mode: 'classic',
    pendingMastery: null,
    masteryNext: null,
    masteryReward: null,
    bestAtStart: 0,
    board: createEmptyBoard(),
    queue: [],
    turn: 0,
    score: 0,
    lines: 0,
    combo: 0,
    recordAnnounced: false,
    bestComboInGame: 0,
    charge: 0,
    pulseBursts: 0,
    activeBooster: null,
    selectedPiece: null,
    drag: null,
    preview: [],
    previewNodes: [],
    previewKey: '',
    resolving: false,
    gameActive: false,
    paused: false,
    shopTab: 'themes',
    preview: null,
    toastTimer: null,
    clearFeedbackTimer: null,
    highScoreTimer: null,
    clearVisualPending: false,
    clearVisualToken: 0,
    boardMetricsCache: null,
    packOpening: false,
    packOpeningTimer: null,
    suppressPieceClick: false
  };

  function loadProfile() {
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (_) { parsed = null; }
    const base = defaultSave();
    const result = { ...base, ...(parsed || {}) };
    result.unlocked = { ...base.unlocked, ...((parsed && parsed.unlocked) || {}) };
    result.equipped = { ...base.equipped, ...((parsed && parsed.equipped) || {}) };
    result.inventory = { ...base.inventory, ...((parsed && parsed.inventory) || {}) };
    result.stats = { ...DEFAULT_STATS, ...((parsed && parsed.stats) || {}) };
    result.shapes = normalizeShapes(parsed && parsed.shapes);
    result.ui = result.ui === 'dark' ? 'dark' : 'soft';
    result.haptics = result.haptics !== false;
    result.reduceMotion = result.reduceMotion === true;
    result.showTip = result.showTip !== false;
    result.tutorialDone = Boolean(result.tutorialDone === true || (parsed && (Number(parsed.level) > 1 || Number(parsed.best) > 0)));
    const unlockedAch = {};
    if (parsed && parsed.achievements && typeof parsed.achievements === 'object') Object.keys(parsed.achievements).forEach(id => { unlockedAch[id] = Number(parsed.achievements[id]) || 1; });
    result.achievements = unlockedAch;
    const daily = parsed && parsed.daily && typeof parsed.daily === 'object' ? parsed.daily : {};
    result.daily = { last: typeof daily.last === 'string' ? daily.last : '', streak: Math.max(0, Math.floor(Number(daily.streak) || 0)) };
    result.run = parsed && parsed.run && typeof parsed.run === 'object' && Array.isArray(parsed.run.board) && Array.isArray(parsed.run.queue) ? parsed.run : null;
    result.sound = result.sound !== false;
    result.music = result.music === true;
    result.volume = clamp(Number(result.volume ?? .72), 0, 1);
    result.progressionClaims = Array.isArray(result.progressionClaims)
      ? [...new Set(result.progressionClaims.map(Number).filter(level => Number.isInteger(level) && level > 0))]
      : [];
    Object.keys(base.unlocked).forEach(category => {
      if (!Array.isArray(result.unlocked[category])) result.unlocked[category] = [...base.unlocked[category]];
    });
    ensureMissionsForToday(result);
    return result;
  }

  function saveProfile() {
    if (state.gameActive && !state.packOpening) profile.run = snapshotRun();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(profile)); } catch (_) { /* localStorage peut être désactivé en mode privé */ }
  }

  function dateKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function ensureMissionsForToday(target = profile) {
    if (target.missionDate === dateKey() && Array.isArray(target.missions) && target.missions.length) {
      if (!target.missions.some(mission => mission.type === 'pulse')) target.missions.push({ id: 'pulse', type: 'pulse', title: 'Déclencher 1 Pulse Burst', detail: 'Atteins la charge maximale', target: 1, progress: 0, reward: 90, icon: '\u26A1\uFE0E', claimed: false });
      return;
    }
    target.missionDate = dateKey();
    target.missions = [
      { id: 'score', type: 'score', title: 'Atteindre 1 500 points', detail: 'En une seule partie', target: 1500, progress: 0, reward: 55, icon: '↗', claimed: false },
      { id: 'lines', type: 'lines', title: 'Dissoudre 10 lignes', detail: 'Lignes ou colonnes', target: 10, progress: 0, reward: 65, icon: '▦', claimed: false },
      { id: 'combo', type: 'combo', title: 'Atteindre un combo de 3', detail: 'Sans quitter la partie', target: 3, progress: 0, reward: 80, icon: '✦', claimed: false },
      { id: 'games', type: 'games', title: 'Jouer 2 parties', detail: 'Chaque tentative compte', target: 2, progress: 0, reward: 45, icon: '◉', claimed: false },
      { id: 'pieces', type: 'pieces', title: 'Poser 18 fragments', detail: 'Toutes parties confondues', target: 18, progress: 0, reward: 50, icon: '◆', claimed: false },
      { id: 'pulse', type: 'pulse', title: 'Déclencher 1 Pulse Burst', detail: 'Atteins la charge maximale', target: 1, progress: 0, reward: 90, icon: '\u26A1\uFE0E', claimed: false }
    ];
  }

  function createEmptyBoard() { return Array.from({ length: geo.rows }, () => Array(geo.cols).fill(null)); }
  function cloneShape(shape) { return shape.map(([r, c]) => [r, c]); }
  function makePiece(def) {
    const cells = cloneShape(def.cells);
    return { id: def.id, color: getPieceColor(def.id), cells, rows: Math.max(...cells.map(c => c[0])) + 1, cols: Math.max(...cells.map(c => c[1])) + 1 };
  }

  function occupiedCount() { return state.board.flat().filter(Boolean).length; }

  // Évalue ce qu'une forme peut accomplir sur le plateau actuel (lignes complétées / presque complètes).
  // Raisonne sur les « lignes » de la géométrie active : valable pour toutes les formes de plateau.
  function evaluateShapeOpportunity(def, lineFilled) {
    const piece = makePiece(def);
    const lines = geo.lines;
    let bestClear = 0; let bestNear = 0; let bestPotential = 0;
    for (let row = 0; row < geo.rows; row++) for (let col = 0; col < geo.cols; col++) {
      if (!canPlace(piece, row, col)) continue;
      const added = new Map();
      piece.cells.forEach(([dr, dc]) => geo.cellLines[row + dr][col + dc].forEach(index => added.set(index, (added.get(index) || 0) + 1)));
      let clear = 0; let near = 0;
      for (let i = 0; i < lines.length; i++) {
        const filled = lineFilled[i] + (added.get(i) || 0);
        const length = lines[i].cells.length;
        if (filled >= length) clear += 1;
        else if (filled === length - 1) near += 1;
      }
      bestClear = Math.max(bestClear, clear);
      bestNear = Math.max(bestNear, near);
      bestPotential = Math.max(bestPotential, clear * 5 + near * 1.25);
    }
    return { bestClear, bestNear, bestPotential };
  }

  function chooseShapeDefinition() {
    const lineFilled = geo.lines.map(line => line.cells.reduce((sum, [r, c]) => sum + (state.board[r][c] ? 1 : 0), 0));
    const density = occupiedCount() / geo.cellCount;
    const opening = state.turn < 6 && occupiedCount() < Math.round(geo.cellCount * .375);
    const weights = geo.pool.map(({ def, w }) => {
      const size = def.cells.length;
      const opportunity = evaluateShapeOpportunity(def, lineFilled);
      let weight = w;
      if (density > .5 && size <= 3) weight += 2.6;
      if (density > .68 && size <= 2) weight += 2.5;
      if (!opening && density < .22 && size >= 4) weight += .8;
      if (opening && size <= 4) weight += 2.2;
      if (opening && size >= 5) weight *= .25;
      if (size >= 6 && density > .42) weight *= .32;
      if (opportunity.bestClear >= 1) weight += Math.min(4.5, opportunity.bestClear * 1.8);
      if (opportunity.bestClear >= 2) weight += 2.5;
      if (opportunity.bestNear >= 2) weight += Math.min(3, opportunity.bestNear * .55);
      if (opportunity.bestPotential === 0 && density > .58) weight *= .7;
      return Math.max(.12, weight);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < geo.pool.length; i++) { roll -= weights[i]; if (roll <= 0) return geo.pool[i].def; }
    return geo.pool[0].def;
  }

  function getStarterQueue() {
    const waves = geo.starter;
    const wave = state.turn < 3 ? waves[0] : state.turn < 6 ? waves[1] : null;
    if (!wave) return null;
    return wave.map(id => makePiece(SHAPE_BY_ID[id]));
  }

  // Une case existe pour le moteur seulement si geo.mask la déclare : les cases « void » ne sont jamais jouables.
  function canPlace(piece, row, col) {
    return piece.cells.every(([dr, dc]) => {
      const r = row + dr; const c = col + dc;
      return r >= 0 && r < geo.rows && c >= 0 && c < geo.cols && geo.mask[r][c] && !state.board[r][c];
    });
  }

  function canAnyPlace(piece) {
    for (let r = 0; r < geo.rows; r++) for (let c = 0; c < geo.cols; c++) if (canPlace(piece, r, c)) return true;
    return false;
  }

  function generatePiece() {
    for (let attempt = 0; attempt < 12; attempt++) {
      const piece = makePiece(chooseShapeDefinition());
      if (canAnyPlace(piece)) return piece;
    }
    const fallback = geo.pool.slice(0, 3).map(({ def }) => makePiece(def)).find(canAnyPlace);
    return fallback || makePiece(SHAPE_LIBRARY[0]);
  }

  function generateQueue() {
    const starterQueue = getStarterQueue();
    const pieces = starterQueue || Array.from({ length: QUEUE_SIZE }, generatePiece);
    if (!pieces.some(canAnyPlace) && occupiedCount() < geo.cellCount) {
      pieces[0] = makePiece(SHAPE_LIBRARY[0]);
    }
    return pieces;
  }

  function applyTheme() {
    const skin = CATALOG.skins.find(item => item.id === profile.equipped.skin) || CATALOG.skins[0];
    const board = CATALOG.boards.find(item => item.id === profile.equipped.board) || CATALOG.boards[0];
    document.documentElement.style.setProperty('--skin-primary', skin.primary);
    document.documentElement.style.setProperty('--skin-secondary', skin.secondary);
    document.documentElement.style.setProperty('--skin-soft', skin.soft);
    document.documentElement.style.setProperty('--skin-contrast', skin.contrast);
    const lifted = profile.ui !== 'dark' && board.id === 'night';
    document.documentElement.dataset.ui = profile.ui === 'dark' ? 'dark' : 'soft';
    document.documentElement.dataset.motion = (profile.reduceMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ? 'reduced' : 'full';
    document.documentElement.dataset.tip = profile.showTip ? 'on' : 'off';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', profile.ui === 'dark' ? '#080b18' : '#2a3c63');
    document.documentElement.style.setProperty('--board-shell', lifted ? '#2f4a7a' : board.shell);
    document.documentElement.style.setProperty('--cell-bg', lifted ? '#4a6b9f' : board.cell);
    document.documentElement.style.setProperty('--board-glow', board.glow);
    document.body.dataset.effect = profile.equipped.effect;
    ['#board-wrap', '#piece-tray'].forEach(selector => { const el = $(selector); if (el) { el.dataset.skin = skin.id; el.dataset.board = board.id; } });
  }

  function init() {
    applyTheme();
    applyBoardLayout();
    renderSettings();
    // La musique démarre après la 1re interaction (autoplay bloqué par les navigateurs).
    renderBoard();
    renderHome();
    renderMissions();
    renderShop();
    renderCollection();
    renderStats();
    renderProgression();
    renderShapes();
    renderTrophies();
    bindEvents();
    initNative();
    try { onlineInit(); } catch (_) { /* l'online ne doit jamais bloquer le lancement */ }
    try { initUiPolish(); } catch (_) { /* purement décoratif */ }
    setTimeout(() => $('#boot-screen')?.classList.add('done'), 650);
  }

  // Petit « pop » sur les chiffres qui changent (score, pièces, niveau). Purement visuel.
  function initUiPolish() {
    if (typeof MutationObserver !== 'function') return;
    const startedAt = Date.now();
    ['#game-score', '#game-best', '#home-coins', '#shop-coins', '#home-level'].forEach(selector => {
      const el = $(selector); if (!el) return;
      let last = el.textContent;
      el.addEventListener('animationend', () => el.classList.remove('bump'));
      new MutationObserver(() => {
        const now = el.textContent; if (now === last) return;
        last = now;
        if (Date.now() - startedAt < 1800) return;   // pas de pop pendant le chargement initial
        el.classList.remove('bump');
        scheduleFrame(() => el.classList.add('bump'));
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  function bindEvents() {
    document.addEventListener('click', handleClick);
    document.addEventListener('pointerdown', handlePointerDown, { passive: false });
    const moveEvent = DRAG_USE_RAW_UPDATES && typeof window !== 'undefined' && 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
    // Réveille l'audio dès la première interaction (et non au moment de prendre
    // une pièce) : créer l'AudioContext à ce moment-là provoque un à-coup.
    const warmAudio = () => { if (profile.sound || profile.music) getAudioContext(); startMusic(); };
    document.addEventListener('pointerup', warmAudio, { once: true, passive: true });
    document.addEventListener('click', warmAudio, { once: true, passive: true });
    document.addEventListener(moveEvent, handlePointerMove, { passive: false });
    document.addEventListener('pointerup', handlePointerUp, { passive: false });
    document.addEventListener('pointercancel', cancelDrag, { passive: false });
    window.addEventListener('blur', cancelDrag);
    const invalidateBoardMetrics = () => { state.boardMetricsCache = null; };
    window.addEventListener('resize', invalidateBoardMetrics, { passive: true });
    window.addEventListener('orientationchange', invalidateBoardMetrics, { passive: true });
    window.addEventListener('scroll', invalidateBoardMetrics, { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelDrag(); });
    $('#modal-backdrop').addEventListener('click', event => { if (event.target.id === 'modal-backdrop' && !state.packOpening) closeModal(); });
    $('#volume-control')?.addEventListener('input', event => {
      profile.volume = clamp(Number(event.target.value) / 100, 0, 1);
      saveProfile(); updateMusicVolume();
      const label = $('#volume-label'); if (label) label.textContent = `${Math.round(profile.volume * 100)}%`;
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
    $('#import-file')?.addEventListener('change', event => {
      const file = event.target.files && event.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importSave(String(reader.result || ''));
      reader.onerror = () => showToast('Lecture du fichier impossible.');
      reader.readAsText(file); event.target.value = '';
    });
  }

  function handleClick(event) {
    const clickedButton = event.target.closest('button');
    if (clickedButton) retriggerClass(clickedButton, 'button-press');
    const routeButton = event.target.closest('[data-route]');
    if (routeButton) {
      playSfx('button'); vibrate(7);
      const route = routeButton.dataset.route;
      if (route === 'home' && state.gameActive && state.screen === 'game') {
        openPauseModal();
      } else {
        showScreen(route);
      }
      return;
    }

    const shopTabButton = event.target.closest('[data-shop-tab]');
    if (shopTabButton) {
      playSfx('button'); vibrate(6);
      state.shopTab = shopTabButton.dataset.shopTab;
      renderShop();
      return;
    }

    const pieceButton = event.target.closest('[data-piece-index]');
    if (pieceButton && state.screen === 'game') {
      if (state.suppressPieceClick) { state.suppressPieceClick = false; return; }
      if (state.activeBooster) { showToast('Utilise le bonus actif sur la grille.'); return; }
      selectPiece(Number(pieceButton.dataset.pieceIndex)); return;
    }
    const cell = event.target.closest('[data-cell-index]');
    if (cell && state.screen === 'game') {
      const index = Number(cell.dataset.cellIndex);
      if (state.activeBooster) { useBoosterAtCell(Math.floor(index / geo.cols), index % geo.cols); return; }
      if (state.selectedPiece !== null) {
        placeSelectedAt(Math.floor(index / geo.cols), index % geo.cols);
        return;
      }
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (['pause', 'resume', 'go-home', 'close-modal', 'hint', 'progression', 'progression-current'].includes(action)) { playSfx('button'); vibrate(7); }
    switch (action) {
      case 'play': startNewGame('classic'); break;
      case 'play-shapes': startNewGame('shapes', event.target.closest('[data-shape-id]')?.dataset.shapeId || null); break;
      case 'shapes-next': startNextShapesBoard(); break;
      case 'shapes-screen': closeModal(); state.gameActive = false; state.paused = false; showScreen('shapes'); break;
      case 'game-home': state.gameActive ? openPauseModal() : showScreen('home'); break;
      case 'pause': openPauseModal(); break;
      case 'resume': closeModal(); state.paused = false; break;
      case 'restart': closeModal(); startNewGame(); break;
      case 'go-home': closeModal(); state.gameActive = false; state.paused = false; showScreen('home'); break;
      case 'close-modal': closeModal(); break;
      case 'hint': giveHint(); break;
      case 'progression': closeModal(); state.gameActive = false; showScreen('progression'); break;
      case 'progression-current': scrollProgressionToCurrent(true); break;
      case 'claim-progression': claimProgressionReward(event.target.closest('[data-level]')?.dataset.level); break;
      case 'use-booster': useBooster(event.target.closest('[data-booster-id]')?.dataset.boosterId); break;
      case 'toggle-sound': toggleSound(); break;
      case 'toggle-music': toggleMusic(); break;
      case 'toggle-theme': profile.ui = profile.ui === 'dark' ? 'soft' : 'dark'; saveProfile(); applyTheme(); renderHome(); renderSettings(); showToast(profile.ui === 'dark' ? 'Fond sombre' : 'Fond clair'); break;
      case 'toggle-haptics': profile.haptics = profile.haptics === false; saveProfile(); renderHome(); renderSettings(); showToast(profile.haptics ? 'Vibrations activées' : 'Vibrations coupées'); if (profile.haptics) vibrate(20); break;
      case 'resume-run': resumeRun(); break;
      case 'revive-accept': reviveAccept(); break;
      case 'revive-decline': state.reviveOffer = false; closeModal(); endGame(); break;
      case 'open-about': openAbout(); break;
      case 'install-app': installApp(); break;
      case 'open-tutorial': openTutorial(0); break;
      case 'tutorial-next': openTutorial(Number(event.target.closest('[data-page]')?.dataset.page || 0) + 1); break;
      case 'tutorial-skip': finishTutorial(); break;
      case 'share-score': shareScore(); break;
      case 'toggle-motion': profile.reduceMotion = !profile.reduceMotion; saveProfile(); applyTheme(); renderSettings(); break;
      case 'toggle-tip': profile.showTip = !profile.showTip; saveProfile(); applyTheme(); renderSettings(); break;
      case 'test-sound': playSfx('unlock'); if (profile.music) startMusic(); if (!profile.sound) showToast('Les effets sonores sont coupés.'); break;
      case 'export-save': exportSave(); break;
      case 'copy-save': copySave(); break;
      case 'import-save': $('#import-file')?.click(); break;
      case 'reset-classic': case 'reset-shapes': case 'reset-all': askReset(action.slice(6)); break;
      case 'confirm-reset': doReset(event.target.closest('[data-scope]')?.dataset.scope); break;
      case 'lb-edit-name': playSfx('button'); startNameEdit(); break;
      case 'lb-cancel-name': playSfx('button'); cancelNameEdit(); break;
      case 'lb-retry': playSfx('button'); loadLeaderboard(); break;
      case 'claim-daily': claimDaily(); break;
      case 'claim-mission': claimMission(event.target.closest('[data-mission-id]')?.dataset.missionId); break;
      case 'buy-item': buyItem(event.target.closest('[data-item]')?.dataset.category, event.target.closest('[data-item]')?.dataset.item); break;
      case 'buy-booster': buyBooster(event.target.closest('[data-booster-id]')?.dataset.boosterId); break;
      case 'buy-pack': buyPack(event.target.closest('[data-pack-id]')?.dataset.packId); break;
      case 'preview-item': { const card = event.target.closest('[data-item]'); playSfx('button'); vibrate(8); openCosmeticPreview('item', card?.dataset.category, card?.dataset.item); break; }
      case 'preview-theme': { const card = event.target.closest('[data-theme]'); playSfx('button'); vibrate(8); openCosmeticPreview('theme', null, card?.dataset.theme); break; }
      case 'buy-theme': buyTheme(event.target.closest('[data-theme]')?.dataset.theme); break;
      case 'equip-theme': equipTheme(event.target.closest('[data-theme]')?.dataset.theme); break;
      case 'finish-pack-opening': finishPackOpening(); break;
      case 'equip-item': equipItem(event.target.closest('[data-item]')?.dataset.category, event.target.closest('[data-item]')?.dataset.item); break;
      case 'shop-tab': state.shopTab = event.target.closest('[data-shop-tab]').dataset.shopTab; renderShop(); break;
      default: break;
    }
  }

  function setDragMode(active) {
    document.documentElement.classList.toggle('is-dragging', active);
  }

  function removeDragGhost(ghost) {
    if (!ghost) return;
    ghost.style.willChange = 'auto';
    ghost.remove();
  }

  function cancelDrag() {
    if (!state.drag) return;
    cancelScheduledFrame(state.drag.previewFrame);
    state.drag.sourceItem?.releasePointerCapture?.(state.drag.pointerId);
    removeDragGhost(state.drag.ghost);
    removeDragPreviewOverlay(state.drag);
    state.drag = null;
    setDragMode(false);
    state.suppressPieceClick = false;
    clearPreview();
  }

  function handlePointerDown(event) {
    const item = event.target.closest('.piece-item');
    if (!item || state.drag || state.activeBooster || item.classList.contains('used') || state.screen !== 'game' || state.resolving || !state.gameActive || state.paused) return;

    const index = Number(item.dataset.pieceIndex);
    const piece = state.queue[index];
    const visual = item.querySelector('.piece-shape');
    if (!piece || !visual) return;

    // Toutes les coordonnées utilisées ici sont des coordonnées viewport :
    // clientX/clientY + getBoundingClientRect(). Cela reste juste même si la
    // page défile pendant le drag, sans compensation fixe liée au navigateur.
    const visualRect = visual.getBoundingClientRect();
    // L'offset peut aussi être légèrement extérieur au visuel (padding de la
    // carte de pièce) : on le conserve brut pour éviter tout saut initial.
    const grabOffsetX = event.clientX - visualRect.left;
    const grabOffsetY = event.clientY - visualRect.top;
    const hitX = clamp(grabOffsetX, 0, visualRect.width);
    const hitY = clamp(grabOffsetY, 0, visualRect.height);
    const computedVisual = getComputedStyle(visual);
    const cssGap = parseFloat(computedVisual.gap) || 0;
    const cssCellWidth = parseFloat(computedVisual.gridTemplateColumns) || visualRect.width / piece.cols;
    const cssCellHeight = parseFloat(computedVisual.gridTemplateRows) || visualRect.height / piece.rows;
    const cellPitchX = cssCellWidth + cssGap;
    const cellPitchY = cssCellHeight + cssGap;
    const naturalWidth = cssCellWidth * piece.cols + cssGap * Math.max(0, piece.cols - 1);
    const naturalHeight = cssCellHeight * piece.rows + cssGap * Math.max(0, piece.rows - 1);
    const trayScaleX = naturalWidth ? visualRect.width / naturalWidth : 1;
    const trayScaleY = naturalHeight ? visualRect.height / naturalHeight : 1;

    // On mémorise aussi la cellule visuelle située sous le doigt. La pièce
    // peut être saisie par son centre, son bord ou son coin sans aucun saut.
    const grabCol = clamp(Math.floor(hitX / (cellPitchX * trayScaleX)), 0, piece.cols - 1);
    const grabRow = clamp(Math.floor(hitY / (cellPitchY * trayScaleY)), 0, piece.rows - 1);

    // Le fantôme utilise maintenant les dimensions réelles des carrés du
    // plateau. Une pièce de 3 cases affiche donc 3 carrés de la même taille
    // que ceux qu'elle va occuper, quelle que soit la résolution du téléphone.
    const boardMetrics = getBoardMetrics();
    const dragCellWidth = boardMetrics?.cellWidth || cssCellWidth * trayScaleX;
    const dragCellHeight = boardMetrics?.cellHeight || cssCellHeight * trayScaleY;
    const dragGapX = boardMetrics?.gapX ?? cssGap * trayScaleX;
    const dragGapY = boardMetrics?.gapY ?? cssGap * trayScaleY;
    const trayCellWidth = cssCellWidth * trayScaleX;
    const trayCellHeight = cssCellHeight * trayScaleY;
    const trayPitchX = trayCellWidth + cssGap * trayScaleX;
    const trayPitchY = trayCellHeight + cssGap * trayScaleY;
    const offsetInsideTrayCellX = hitX - grabCol * trayPitchX;
    const offsetInsideTrayCellY = hitY - grabRow * trayPitchY;
    const cellFractionX = trayCellWidth ? offsetInsideTrayCellX / trayCellWidth : .5;
    const cellFractionY = trayCellHeight ? offsetInsideTrayCellY / trayCellHeight : .5;
    const ghostOffsetX = grabCol * (dragCellWidth + dragGapX) + cellFractionX * dragCellWidth;
    const ghostOffsetY = grabRow * (dragCellHeight + dragGapY) + cellFractionY * dragCellHeight;

    event.preventDefault();
    state.suppressPieceClick = true;
    // Ne pas reconstruire le tray pendant pointerdown : l'élément touché
    // resterait alors sans cible native sur certains Android. Le fragment
    // fantôme et la sélection sont mis à jour sans interrompre le pointer.
    state.selectedPiece = index;
    $$('.piece-item.selected').forEach(pieceItem => pieceItem.classList.remove('selected'));
    item.classList.add('selected');
    clearPreview();
    $('#game-message').textContent = 'Touche la grille pour déposer ce fragment.';

    // Ghost mobile ultra-léger : un seul canvas au lieu d'un arbre de divs.
    // Le canvas est dessiné une seule fois au début du drag ; ensuite seul son
    // transform change, ce qui réduit fortement le travail de paint du navigateur.
    const ghost = createDragGhostCanvas(piece, dragCellWidth, dragCellHeight, dragGapX, dragGapY);

    state.drag = {
      pointerId: event.pointerId,
      index,
      piece,
      ghost,
      sourceItem: item,
      grabOffsetX: ghostOffsetX,
      grabOffsetY: ghostOffsetY,
      grabCol,
      grabRow,
      pendingX: event.clientX,
      pendingY: event.clientY,
      previewCellKey: '',
      previewFrame: null
    };
    item.setPointerCapture?.(event.pointerId);
    setDragMode(true);
    state.drag.overlay = createDragPreviewOverlay(state.drag);
    document.body.appendChild(ghost);
    updateGhost(event.clientX, event.clientY);
    // Vibration et son sont reportés après l'affichage de la première frame du
    // drag, pour qu'ils ne retardent jamais l'apparition de la pièce.
    scheduleFrame(() => setTimeout(() => {
      if (state.drag?.pointerId !== event.pointerId) return;
      vibrate(9);
      playSfx('select');
    }, 0));
  }

  function handlePointerMove(event) {
    const drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    // Utilise uniquement le point le plus récent disponible, puis effectue
    // UNE seule écriture de transform. Aucun smoothing ni interpolation.
    let latestEvent = event;
    try {
      const coalesced = event.getCoalescedEvents?.();
      if (coalesced?.length) latestEvent = coalesced[coalesced.length - 1];
    } catch (_) { /* API facultative */ }

    // Priorité absolue : le ghost bouge dans le même événement que le doigt.
    let visualEvent = latestEvent;
    if (DRAG_USE_PREDICTION) {
      try {
        const predicted = event.getPredictedEvents?.();
        if (predicted?.length) visualEvent = predicted[0];
      } catch (_) { /* API facultative */ }
    }
    updateGhost(visualEvent.clientX, visualEvent.clientY, drag);
    drag.pendingX = latestEvent.clientX;
    drag.pendingY = latestEvent.clientY;
    event.preventDefault();

    // La preview est secondaire et ne peut jamais retarder le déplacement.
    if (drag.previewFrame !== null) return;
    drag.previewFrame = scheduleFrame(() => {
      if (!state.drag || state.drag !== drag) return;
      drag.previewFrame = null;
      updateDragPreview(drag, drag.pendingX, drag.pendingY);
    });
  }

  function updateDragPreview(drag, x, y) {
    if (!drag?.ghost || state.drag !== drag) return;
    const placement = resolveDragPlacement(drag, x, y);
    if (drag.overlay) { updateDragPreviewOverlay(drag, placement); return; }
    // Secours : si l'overlay n'a pas pu être créé, on utilise l'ancienne preview par classes.
    if (!placement) { clearPreview(); return; }
    showPreview(drag.piece, placement);
  }

  function handlePointerUp(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    event.preventDefault();
    const drag = state.drag;
    drag.pendingX = event.clientX; drag.pendingY = event.clientY;
    cancelScheduledFrame(drag.previewFrame);
    drag.previewFrame = null;
    updateGhost(drag.pendingX, drag.pendingY, drag);
    const placement = getDropPlacement(drag.pendingX, drag.pendingY, drag);
    drag.sourceItem?.releasePointerCapture?.(drag.pointerId);
    removeDragGhost(drag.ghost);
    removeDragPreviewOverlay(drag);
    state.drag = null;
    clearPreview();
    setDragMode(false);
    if (placement?.valid) placePiece(drag.index, placement.row, placement.col);
    else { if (placement) playSfx('error'); renderTray(); }
  }

  // Le dessin du fantôme (dégradés + ombres) est coûteux sur un téléphone
  // modeste : on garde en mémoire les canvas déjà dessinés pour les réutiliser.
  const ghostCanvasCache = new Map();

  function createDragGhostCanvas(piece, cellWidth, cellHeight, gapX, gapY) {
    const pieceColor = getPieceColor(piece.id);
    const cacheKey = [piece.id, pieceColor.primary, pieceColor.secondary, cellWidth.toFixed(2), cellHeight.toFixed(2), gapX.toFixed(2), gapY.toFixed(2), window.devicePixelRatio || 1].join('|');
    const cached = ghostCanvasCache.get(cacheKey);
    if (cached) { cached.style.willChange = 'transform'; return cached; }
    const canvas = buildDragGhostCanvas(piece, cellWidth, cellHeight, gapX, gapY);
    if (ghostCanvasCache.size > 40) ghostCanvasCache.clear();
    ghostCanvasCache.set(cacheKey, canvas);
    return canvas;
  }

  function buildDragGhostCanvas(piece, cellWidth, cellHeight, gapX, gapY) {
    const canvas = document.createElement('canvas');
    canvas.className = 'drag-ghost';
    const cssWidth = piece.cols * cellWidth + Math.max(0, piece.cols - 1) * gapX;
    const cssHeight = piece.rows * cellHeight + Math.max(0, piece.rows - 1) * gapY;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.style.willChange = 'transform';
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return canvas;
    ctx.scale(dpr, dpr);
    const color = getPieceColor(piece.id);
    const radius = Math.min(10, Math.max(6, cellWidth * 0.28));

    for (const [r, c] of piece.cells) {
      const x = c * (cellWidth + gapX);
      const y = r * (cellHeight + gapY);
      const gradient = ctx.createLinearGradient(x, y, x + cellWidth, y + cellHeight);
      gradient.addColorStop(0, color.primary);
      gradient.addColorStop(1, color.secondary);
      ctx.save();
      ctx.shadowColor = color.soft;
      ctx.shadowBlur = Math.min(9, cellWidth * 0.32);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, cellWidth, cellHeight, radius);
      else {
        const rr = Math.min(radius, cellWidth / 2, cellHeight / 2);
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + cellWidth, y, x + cellWidth, y + cellHeight, rr);
        ctx.arcTo(x + cellWidth, y + cellHeight, x, y + cellHeight, rr);
        ctx.arcTo(x, y + cellHeight, x, y, rr);
        ctx.arcTo(x, y, x + cellWidth, y, rr);
      }
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(255,255,255,.2)';
      ctx.lineWidth = Math.max(1, Math.min(1.5, cellWidth * 0.06));
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.fillRect(x + cellWidth * .08, y + cellHeight * .07, cellWidth * .84, Math.max(1, cellHeight * .055));
      ctx.restore();
    }
    return canvas;
  }

  function updateGhost(x, y, drag = state.drag) {
    if (!drag?.ghost) return;
    // Le fantôme conserve exactement l'offset de saisie. transform est
    // composité par le GPU et évite un nouveau layout à chaque mouvement.
    const ghostX = x - drag.grabOffsetX;
    const ghostY = y - drag.grabOffsetY - DRAG_LIFT_PX;
    drag.ghost.style.transform = `translate3d(${ghostX}px, ${ghostY}px, 0)`;
  }

  function getBoardMetrics() {
    if (state.boardMetricsCache) return state.boardMetricsCache.value;
    const board = $('#board');
    if (!board || !board.children.length) return null;
    const firstCell = [...board.children].find(cell => !cell.classList.contains('filled')) || board.children[0];
    if (!firstCell) return null;

    const boardRect = board.getBoundingClientRect();
    const measuredRect = firstCell.getBoundingClientRect();
    const boardStyle = getComputedStyle(board);
    const cellRadius = getComputedStyle(firstCell).borderTopLeftRadius || '8px';
    const borderLeft = parseFloat(boardStyle.borderLeftWidth) || 0;
    const borderTop = parseFloat(boardStyle.borderTopWidth) || 0;
    const paddingLeft = parseFloat(boardStyle.paddingLeft) || 0;
    const paddingTop = parseFloat(boardStyle.paddingTop) || 0;
    const fallbackGap = parseFloat(boardStyle.gap) || 5;
    const gapX = parseFloat(boardStyle.columnGap) || fallbackGap;
    const gapY = parseFloat(boardStyle.rowGap) || fallbackGap;

    const value = {
      rect: boardRect,
      originX: boardRect.left + borderLeft + paddingLeft,
      originY: boardRect.top + borderTop + paddingTop,
      cellWidth: measuredRect.width,
      cellHeight: measuredRect.height,
      cellRadius,
      gapX,
      gapY
    };
    state.boardMetricsCache = { value };
    return value;
  }

  function getGridCellFromPoint(clientX, clientY) {
    const metrics = getBoardMetrics();
    if (!metrics) return null;
    const { rect, originX, originY, cellWidth, cellHeight, gapX, gapY } = metrics;
    if (clientX < rect.left - 24 || clientX > rect.right + 24 || clientY < rect.top - 24 || clientY > rect.bottom + 24) return null;

    // clientX/clientY et getBoundingClientRect() partagent le même repère
    // viewport. Le scroll éventuel est donc déjà pris en compte.
    // Les dimensions viennent directement des vrais carrés du plateau.
    const x = clientX - originX;
    const y = clientY - originY;
    const col = Math.round((x - cellWidth / 2) / (cellWidth + gapX));
    const row = Math.round((y - cellHeight / 2) / (cellHeight + gapY));
    return { row, col };
  }

  function getPieceCenterAnchor(piece) {
    return {
      row: Math.floor((piece.rows - 1) / 2),
      col: Math.floor((piece.cols - 1) / 2)
    };
  }

  // Fonction centrale : transforme une cellule ciblée et une cellule
  // d'ancrage de la pièce en position réelle de placement.
  function getPlacementFromGridCell(piece, gridRow, gridCol, anchor = getPieceCenterAnchor(piece)) {
    const row = gridRow - anchor.row;
    const col = gridCol - anchor.col;
    return { row, col, valid: canPlace(piece, row, col) };
  }

  function getPlacementFromTopLeft(piece, row, col) {
    const anchor = getPieceCenterAnchor(piece);
    return getPlacementFromGridCell(piece, row + anchor.row, col + anchor.col, anchor);
  }

  function getDropPlacement(clientX, clientY, drag) {
    return resolveDragPlacement(drag, clientX, clientY);
  }

  // Cherche où la pièce doit se poser. On part de la position VISUELLE de la
  // pièce (coin haut-gauche du fantôme), arrondie à la case la plus proche,
  // puis on cherche la meilleure place valide autour (tolérance DRAG_SNAP_RADIUS).
  // La preview et le dépôt utilisent exactement cette même fonction.
  function resolveDragPlacement(drag, clientX, clientY) {
    const metrics = getBoardMetrics();
    if (!metrics || !drag?.piece) return null;
    const piece = drag.piece;
    const pitchX = metrics.cellWidth + metrics.gapX;
    const pitchY = metrics.cellHeight + metrics.gapY;
    const fx = (clientX - drag.grabOffsetX - metrics.originX) / pitchX;
    const fy = (clientY - drag.grabOffsetY - DRAG_LIFT_PX - metrics.originY) / pitchY;
    const baseCol = Math.round(fx);
    const baseRow = Math.round(fy);

    const reach = Math.ceil(DRAG_SNAP_RADIUS);
    let best = null;
    let bestDistance = Infinity;
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        const row = baseRow + dr;
        const col = baseCol + dc;
        const distance = Math.hypot(row - fy, col - fx);
        if (distance > DRAG_SNAP_RADIUS || distance >= bestDistance) continue;
        if (canPlace(piece, row, col)) { best = { row, col, valid: true }; bestDistance = distance; }
      }
    }
    if (best) return best;

    // Aucune place valide à proximité : on montre la position en rouge si la
    // pièce touche la grille, sinon aucune preview (pièce loin de la grille).
    const touchesBoard = piece.cells.some(([dr, dc]) => {
      const r = baseRow + dr; const c = baseCol + dc;
      return r >= 0 && r < geo.rows && c >= 0 && c < geo.cols;
    });
    return touchesBoard ? { row: baseRow, col: baseCol, valid: false } : null;
  }

  // Preview du drag : un petit calque séparé (comme le fantôme) qui se déplace
  // avec transform. La grille n'est donc plus redessinée à chaque changement de case.
  function createDragPreviewOverlay(drag) {
    const metrics = getBoardMetrics();
    if (!metrics || !drag?.piece) return null;
    const pitchX = metrics.cellWidth + metrics.gapX;
    const pitchY = metrics.cellHeight + metrics.gapY;
    const root = document.createElement('div');
    root.className = 'drag-preview';
    root.style.visibility = 'hidden';
    const cells = drag.piece.cells.map(([dr, dc]) => {
      const el = document.createElement('i');
      el.style.left = `${dc * pitchX}px`;
      el.style.top = `${dr * pitchY}px`;
      el.style.width = `${metrics.cellWidth}px`;
      el.style.height = `${metrics.cellHeight}px`;
      el.style.borderRadius = metrics.cellRadius;
      root.appendChild(el);
      return { el, off: false };
    });
    document.body.appendChild(root);
    return { root, cells, key: '', invalid: false };
  }

  function updateDragPreviewOverlay(drag, placement) {
    const overlay = drag.overlay;
    const metrics = getBoardMetrics();
    if (!overlay || !metrics) return;
    if (!placement) {
      if (overlay.key !== 'none') { overlay.root.style.visibility = 'hidden'; overlay.key = 'none'; }
      return;
    }
    const key = `${placement.row}:${placement.col}:${placement.valid ? 1 : 0}`;
    if (overlay.key === key) return;
    overlay.key = key;
    const pitchX = metrics.cellWidth + metrics.gapX;
    const pitchY = metrics.cellHeight + metrics.gapY;
    const x = metrics.originX + placement.col * pitchX;
    const y = metrics.originY + placement.row * pitchY;
    overlay.root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (overlay.invalid === placement.valid) {
      overlay.invalid = !placement.valid;
      overlay.root.classList.toggle('invalid', overlay.invalid);
    }
    drag.piece.cells.forEach(([dr, dc], index) => {
      const r = placement.row + dr; const c = placement.col + dc;
      const inside = r >= 0 && r < geo.rows && c >= 0 && c < geo.cols && geo.mask[r][c];
      const entry = overlay.cells[index];
      if (entry.off === !inside) return;
      entry.off = !inside;
      entry.el.classList.toggle('off', entry.off);
    });
    overlay.root.style.visibility = 'visible';
  }

  function removeDragPreviewOverlay(drag) {
    if (!drag?.overlay) return;
    drag.overlay.root.remove();
    drag.overlay = null;
  }

  function selectPiece(index) {
    if (state.resolving || !state.gameActive || !state.queue[index]) return;
    state.selectedPiece = state.selectedPiece === index ? null : index;
    renderTray();
    clearPreview();
    if (state.selectedPiece !== null) {
      const piece = state.queue[state.selectedPiece];
      playSfx('select'); vibrate(9);
      $('#game-message').textContent = 'Touche la grille pour déposer ce fragment.';
      if (!canAnyPlace(piece)) showToast('Ce fragment ne trouve plus sa place.');
    } else $('#game-message').textContent = 'Choisis un fragment et fais-le glisser.';
  }

  function placeSelectedAt(row, col) {
    const index = state.selectedPiece;
    if (index === null || !state.queue[index]) return;
    const piece = state.queue[index];
    const placement = getPlacementFromGridCell(piece, row, col);
    if (!placement.valid) {
      showPreview(piece, placement);
      showToast('Cet emplacement ne peut pas accueillir ce fragment.');
      vibrate(16); playSfx('error');
      return;
    }
    placePiece(index, placement.row, placement.col);
  }

  function showPreview(piece, placement) {
    if (!piece || !placement) return;
    const { row, col, valid } = placement;
    const previewKey = `${piece.id}:${row}:${col}:${valid ? 1 : 0}`;
    if (state.previewKey === previewKey) return;
    clearPreview();
    state.previewKey = previewKey;
    state.preview = piece.cells.map(([dr, dc]) => ({ row: row + dr, col: col + dc, valid }));
    const boardCells = $('#board')?.children;
    state.preview.forEach(({ row: r, col: c, valid: ok }) => {
      if (boardCells && r >= 0 && r < geo.rows && c >= 0 && c < geo.cols) {
        const cell = boardCells[r * geo.cols + c];
        cell.classList.add(ok ? 'preview-valid' : 'preview-invalid');
        state.previewNodes.push(cell);
      }
    });
  }

  function clearPreview() {
    state.previewNodes.forEach(cell => cell.classList.remove('preview-valid', 'preview-invalid'));
    state.preview = [];
    state.previewNodes = [];
    state.previewKey = '';
  }

  function createPieceVisual(piece, ghost = false) {
    const shape = document.createElement('div');
    const color = getPieceColor(piece.id);
    shape.className = 'piece-shape' + (ghost ? ' ghost-shape' : '') + (Math.max(piece.cols, piece.rows) >= 5 ? ' wide' : '');
    shape.style.setProperty('--piece-cols', piece.cols);
    shape.style.setProperty('--piece-rows', piece.rows);
    shape.style.setProperty('--piece-primary', color.primary);
    shape.style.setProperty('--piece-secondary', color.secondary);
    shape.style.setProperty('--piece-soft', color.soft);
    for (let r = 0; r < piece.rows; r++) for (let c = 0; c < piece.cols; c++) {
      const mini = document.createElement('i');
      mini.className = 'mini-cell' + (piece.cells.some(([pr, pc]) => pr === r && pc === c) ? '' : ' empty');
      shape.appendChild(mini);
    }
    return shape;
  }

  function renderBoard() {
    const board = $('#board');
    if (!board) return;
    state.boardMetricsCache = null;
    const rows = geo.rows; const cols = geo.cols;
    const dims = `${rows}x${cols}`;
    if (board.dataset.dims !== dims || board.children.length !== rows * cols) {
      board.innerHTML = '';
      board.dataset.dims = dims;
      for (let i = 0; i < rows * cols; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell'; cell.dataset.cellIndex = i; cell.setAttribute('role', 'gridcell');
        board.appendChild(cell);
      }
    }
    // « Presque complète » : une ligne régulière à 2 cases de la fin (1 case pour les lignes courtes
    // ou spéciales). Pour Classic (lignes de 8) le seuil reste exactement 6 cases remplies.
    const near = new Uint8Array(rows * cols);
    geo.lines.forEach(line => {
      const length = line.cells.length;
      let filled = 0;
      line.cells.forEach(([r, c]) => { if (state.board[r][c]) filled += 1; });
      const regular = (line.kind === 'rows' || line.kind === 'cols') && !line.special;
      const threshold = regular && length >= 6 ? length - 2 : length - 1;
      if (filled >= threshold) line.cells.forEach(([r, c]) => { near[r * cols + c] = 1; });
    });
    [...board.children].forEach((cell, index) => {
      const r = Math.floor(index / cols); const c = index % cols;
      const boardPiece = state.board[r][c];
      const occupied = Boolean(boardPiece);
      cell.className = `cell${geo.mask[r][c] ? '' : ' void'}${occupied ? ' filled' : ''}${near[index] ? ' near-line' : ''}`;
      cell.removeAttribute('style');
      if (occupied) {
        const color = getPieceColor(boardPiece.piece);
        cell.style.setProperty('--piece-primary', color.primary);
        cell.style.setProperty('--piece-secondary', color.secondary);
        cell.style.setProperty('--piece-soft', color.soft);
      }
    });
  }

  function renderTray() {
    const tray = $('#piece-tray'); if (!tray) return;
    tray.innerHTML = '';
    state.queue.forEach((piece, index) => {
      const item = document.createElement('div');
      item.className = 'piece-item' + (!piece ? ' used' : '') + (state.selectedPiece === index ? ' selected' : '');
      item.dataset.pieceIndex = index; item.setAttribute('role', 'button'); item.setAttribute('aria-label', piece ? `Fragment ${index + 1}` : 'Fragment utilisé');
      if (piece) item.appendChild(createPieceVisual(piece));
      else { const empty = document.createElement('span'); empty.className = 'piece-index'; empty.textContent = '✓'; item.appendChild(empty); }
      const label = document.createElement('span'); label.className = 'piece-index'; label.textContent = piece ? `${index + 1} / 3` : 'PLACÉ'; item.appendChild(label);
      tray.appendChild(item);
    });
  }

  function renderHud() {
    $('#game-score').textContent = formatNumber(state.score);
    $('#game-best').textContent = formatNumber(Math.max(getBest(), state.score));
    const badge = $('#combo-badge');
    if (state.combo > 1) { badge.classList.remove('hidden'); badge.querySelector('b').textContent = state.combo; } else badge.classList.add('hidden');
    renderCharge();
    renderShapeHud();
  }

  function renderCharge() {
    const fill = $('#charge-fill'); const value = $('#charge-value'); const message = $('#charge-message');
    if (!fill || !value || !message) return;
    const ready = state.charge >= 100;
    fill.style.width = `${clamp(state.charge, 0, 100)}%`;
    fill.classList.toggle('ready', ready);
    value.textContent = ready ? 'PRÊT' : `${Math.round(state.charge)}%`;
    value.classList.toggle('ready', ready);
    message.textContent = ready ? 'La prochaine ligne déclenche une Pulse Burst !' : 'Dissous des lignes pour charger une rafale.';
  }

  const BOOSTER_DEFS = [
    { id: 'hammer', label: 'Éclateur', short: 'Retirer 1 carré', active: 'Touche un carré', icon: '⌁' },
    { id: 'reroll', label: 'Recomp.', short: 'Changer la main', active: 'En cours…', icon: '⟳' },
    { id: 'pulse-core', label: 'Surcharge', short: 'Charger Pulse', active: 'Prêt au prochain clear', icon: '\u26A1\uFE0E' },
    { id: 'scanner', label: 'Scanner', short: 'Révéler un coup', active: 'Analyse…', icon: '⌕' },
    { id: 'line-breaker', label: 'Lame', short: 'Ouvrir une ligne', active: 'Touche une ligne', icon: '╾' }
  ];

  function renderBoosters() {
    const bar = $('#booster-bar');
    if (!bar) return;
    bar.innerHTML = BOOSTER_DEFS.map(def => {
      const count = profile.inventory[def.id] || 0;
      const active = state.activeBooster === def.id;
      const disabled = count <= 0 || state.resolving || !state.gameActive;
      return `<button class="booster-button booster-${def.id}${active ? ' active' : ''}" data-action="use-booster" data-booster-id="${def.id}" ${disabled && !active ? 'disabled' : ''} aria-label="${def.label}, ${count} disponible${count > 1 ? 's' : ''}"><span class="booster-symbol">${def.icon}</span><span class="booster-info"><b>${active ? 'ANNULER' : def.label}</b><small>${active ? def.active : def.short}</small></span><strong class="booster-count">${count}</strong></button>`;
    }).join('');
  }

  function animateTrayArrival() {
    $$('#piece-tray .piece-item').forEach((item, index) => {
      item.style.setProperty('--tray-delay', `${index * 20}ms`);
      retriggerClass(item, 'tray-arrive');
    });
  }

  function animateBoosterArrival() {
    $$('#booster-bar .booster-button').forEach((button, index) => {
      button.style.setProperty('--booster-delay', `${index * 20}ms`);
      retriggerClass(button, 'booster-arrive');
    });
  }

  function animatePlacedCells(cells) {
    cells.forEach(([row, col], index) => {
      const cell = $('#board').children[row * geo.cols + col];
      if (!cell) return;
      cell.style.setProperty('--landing-delay', `${Math.min(index * 8, 40)}ms`);
      retriggerClass(cell, 'landing');
      setTimeout(() => cell.style.removeProperty('--landing-delay'), 260);
    });
  }

  function animateShopItem(attribute, value, className = 'purchase-pop') {
    const item = $$(`[${attribute}]`).find(element => element.getAttribute(attribute) === value && (!element.closest('.screen') || element.closest('.screen').classList.contains('active')));
    retriggerClass(item, className);
  }

  function consumeBooster(id) {
    if (!profile.inventory[id] || profile.inventory[id] <= 0) {
      showToast('Ce bonus est épuisé.');
      return false;
    }
    profile.inventory[id] -= 1;
    modeStats().boostersUsed += 1;
    saveProfile();
    renderBoosters();
    if (state.screen === 'shop') renderShop();
    return true;
  }

  function useBooster(id) {
    if (!id || !state.gameActive || state.resolving) return;
    if (id === 'hammer') {
      if (state.activeBooster === 'hammer') {
        state.activeBooster = null;
        renderBoosters();
        $('#game-message').textContent = 'Choisis un fragment et fais-le glisser.';
        return;
      }
      if (!(profile.inventory.hammer > 0)) return showToast('Tu n’as plus de Marteau.');
      state.activeBooster = 'hammer';
      state.selectedPiece = null;
      clearPreview();
      renderTray();
      renderBoosters();
      $('#game-message').textContent = 'Marteau actif : touche un carré occupé à retirer.';
      playSfx('booster'); vibrate(18);
      return;
    }

    if (id === 'line-breaker') {
      if (state.activeBooster === 'line-breaker') {
        state.activeBooster = null;
        renderBoosters();
        $('#game-message').textContent = 'Choisis un fragment et fais-le glisser.';
        return;
      }
      if (!(profile.inventory['line-breaker'] > 0)) return showToast('Tu n’as plus de Lame de Ligne.');
      state.activeBooster = 'line-breaker';
      state.selectedPiece = null;
      clearPreview();
      renderTray();
      renderBoosters();
      $('#game-message').textContent = 'Lame active : touche une case de la ligne à ouvrir.';
      playSfx('booster'); vibrate(18);
      return;
    }

    if (id === 'scanner') {
      if (!profile.inventory.scanner) return showToast('Tu n’as plus de Scanner Tactique.');
      if (!state.queue.some(piece => piece && canAnyPlace(piece))) return showToast('Le Scanner ne trouve aucun fragment jouable.');
      if (!consumeBooster('scanner')) return;
      state.activeBooster = null;
      state.selectedPiece = null;
      clearPreview();
      renderTray();
      giveHint({ fromScanner: true });
      playSfx('booster'); vibrate([10, 8, 18]);
      return;
    }

    if (!consumeBooster(id)) return;
    state.activeBooster = null;
    state.selectedPiece = null;
    clearPreview();
    renderTray();

    if (id === 'reroll') {
      state.queue = state.queue.map(piece => piece ? generatePiece() : null);
      if (!state.queue.some(piece => piece && canAnyPlace(piece))) state.queue[0] = makePiece(SHAPE_LIBRARY[0]);
      renderTray(); renderBoosters(); animateTrayArrival();
      triggerBoardImpact('place');
      spawnScorePopup('RECOMPO !', 'combo', [], true);
      showToast('Nouveaux fragments en approche.');
      playSfx('booster'); vibrate([15, 12, 24]);
    } else if (id === 'pulse-core') {
      state.charge = 100;
      renderHud(); renderBoosters();
      triggerBoardImpact('pulse');
      spawnScorePopup('CHARGE !', 'pulse', [], true);
      showToast('La prochaine ligne déclenchera une Pulse Burst.');
      playSfx('booster'); vibrate([18, 15, 32]);
    }
    saveProfile();
  }

  function useBoosterAtCell(row, col) {
    const boosterId = state.activeBooster;
    if (!boosterId || state.resolving || !state.gameActive) return;
    if (boosterId === 'hammer') {
      if (!state.board[row][col]) {
        showToast('Choisis un carré occupé.');
        vibrate(12);
        return;
      }
      if (!consumeBooster('hammer')) return;
      state.board[row][col] = null;
      state.activeBooster = null;
      state.selectedPiece = null;
      renderBoard(); renderTray(); renderHud(); renderBoosters();
      triggerClearEffect([[row, col]], false);
      triggerBoardImpact('clear');
      spawnScorePopup('LIBÉRÉ', 'clear', [[row, col]], true);
      $('#game-message').textContent = 'Un espace vient de se libérer. À toi de jouer.';
      showToast('Carré retiré.');
      playSfx('booster'); vibrate([18, 14, 28]);
      saveProfile();
      return;
    }

    if (boosterId === 'line-breaker') {
      const rowCells = state.board[row].map((cell, index) => cell ? [row, index] : null).filter(Boolean);
      if (!rowCells.length) {
        showToast('Choisis une ligne qui contient des carrés.');
        vibrate(12);
        return;
      }
      if (!consumeBooster('line-breaker')) return;
      rowCells.forEach(([r, c]) => { state.board[r][c] = null; });
      state.activeBooster = null;
      state.selectedPiece = null;
      renderBoard(); renderTray(); renderHud(); renderBoosters();
      triggerClearEffect(rowCells, true);
      triggerBoardImpact('clear');
      spawnScorePopup('LIGNE OUVERTE', 'clear', rowCells, true);
      $('#game-message').textContent = 'Une ligne a été ouverte. Le rythme repart.';
      showToast('Lame de Ligne · espace libéré.');
      playSfx('multi-clear', 2); vibrate([20, 10, 32]);
      saveProfile();
    }
  }

  function startNewGame(mode = state.mode, boardId = null) {
    cancelDrag();
    state.reviveOffer = false;
    closeModal();
    state.mode = mode === 'shapes' ? 'shapes' : 'classic';
    profile.run = null;
    let shapeId = null;
    if (state.mode === 'shapes') {
      shapeId = boardId && isShapeUnlocked(boardId) ? boardId : suggestedShapesBoard();
      if (!isShapeUnlocked(shapeId)) shapeId = SHAPE_BOARDS[0].id;
      profile.shapes.current = shapeId;
    }
    // La géométrie est fixée AVANT la création du plateau et de la première main.
    activateBoard(state.mode, shapeId);
    clearTimeout(state.highScoreTimer);
    clearTimeout(state.clearFeedbackTimer);
    $('#high-score-feedback')?.classList.remove('show');
    $('#high-score-feedback')?.setAttribute('aria-hidden', 'true');
    $('#clear-feedback')?.classList.remove('show');
    $('#clear-feedback')?.setAttribute('aria-hidden', 'true');
    state.screen = 'game'; state.board = createEmptyBoard(); state.turn = 0; state.queue = generateQueue(); state.score = 0; state.lines = 0; state.combo = 0; state.recordAnnounced = false; state.bestComboInGame = 0; state.charge = 0; state.pulseBursts = 0; state.activeBooster = null; state.selectedPiece = null; state.resolving = false; state.clearVisualPending = false; state.clearVisualToken += 1; state.gameActive = true; state.paused = false; state.bestAtStart = getBest(); state.revived = false; state.reviveOffer = false; state.pendingMastery = null; state.masteryNext = null; state.masteryReward = null;
    showScreen('game'); renderBoard(); renderTray(); renderHud(); renderBoosters(); animateTrayArrival(); animateBoosterArrival(); $('#game-message').textContent = 'Choisis un fragment et fais-le glisser.'; vibrate(8); playSfx('start');
    if (state.mode === 'classic' && !profile.tutorialDone) openTutorial(0);
    if (state.mode === 'shapes') {
      const prog = shapesProgress();
      if (!prog.seen) { prog.seen = true; openBoardIntro(shapeDef(geo.id)); }
      saveProfile();
    }
  }

  function showScreen(route) {
    if (route === 'game' && !state.gameActive) { startNewGame(); return; }
    if (state.screen === 'game' && route !== 'game' && state.gameActive) { openPauseModal(); return; }
    state.screen = route;
    $$('.screen').forEach(screen => screen.classList.toggle('active', screen.id === `screen-${route}`));
    // Classe temporaire : déclenche les animations d'entrée de la page (cascade, barres), une seule fois.
    const entering = $(`#screen-${route}`);
    if (entering) { entering.classList.add('enter'); clearTimeout(entering._enterTimer); entering._enterTimer = setTimeout(() => entering.classList.remove('enter'), 1300); }
    $('#bottom-nav').classList.toggle('hidden', route === 'game');
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
    if (route === 'home') renderHome();
    if (route === 'shop') renderShop();
    if (route === 'collection') renderCollection();
    if (route === 'missions') renderMissions();
    if (route === 'stats') renderStats();
    if (route === 'shapes') renderShapes();
    if (route === 'settings') renderSettings();
    if (route === 'trophies') renderTrophies();
    if (route === 'leaderboard') openLeaderboard();
    keepAwake(route === 'game' && state.gameActive);
    if (route === 'progression') {
      renderProgression();
      requestAnimationFrame(() => scrollProgressionToCurrent(false));
    }
  }

  // Une « ligne » est définie par la géométrie active (lignes, colonnes, diagonales, zones…).
  // Pour Classic : exactement les 8 lignes + 8 colonnes d'avant.
  function clearCompletedLines() {
    const done = []; const seen = new Set(); const cells = []; let weightSum = 0;
    geo.lines.forEach(line => {
      if (!line.cells.every(([r, c]) => state.board[r][c])) return;
      done.push(line); weightSum += line.weight;
      line.cells.forEach(([r, c]) => { const key = r * geo.cols + c; if (!seen.has(key)) { seen.add(key); cells.push([r, c]); } });
    });
    return {
      lines: done, count: done.length, weightSum, cells,
      rows: done.filter(line => line.kind === 'rows'), cols: done.filter(line => line.kind === 'cols')
    };
  }

  function calculatePlacementScore(piece) {
    const sizeBonus = Math.max(0, piece.cells.length - 3) * 12;
    return piece.cells.length * 10 + sizeBonus;
  }

  // Barème volontairement lisible : 100 pts par ligne, un bonus par case
  // effectivement effacée, puis un bonus de combo. Les intersections ligne /
  // colonne ne sont comptées qu'une seule fois dans completed.cells.
  function calculateClearScore(completed, combo, pulseBonus = 0) {
    const lineCount = completed.count;
    const weightBonus = Math.round((completed.weightSum - completed.count) * 100);
    const lineScore = lineCount * 100 + Math.max(0, lineCount - 1) ** 2 * 45 + weightBonus;
    const clearedCellScore = completed.cells.length * 15;
    const comboScore = Math.max(0, combo - 1) * 80 + Math.max(0, combo - 2) * 35;
    const comboMultiplier = 1 + Math.min(.4, Math.max(0, combo - 1) * .08);
    return Math.round((lineScore + clearedCellScore + comboScore) * comboMultiplier + pulseBonus);
  }

  function placePiece(index, row, col) {
    if (state.resolving || !state.gameActive) return;
    const piece = state.queue[index]; if (!piece || !canPlace(piece, row, col)) return;
    state.resolving = true; state.selectedPiece = null; state.turn += 1;
    const scoreBeforeMove = state.score;
    const placedCells = piece.cells.map(([dr, dc]) => [row + dr, col + dc]);
    const placementScore = calculatePlacementScore(piece);
    piece.cells.forEach(([dr, dc]) => { state.board[row + dr][col + dc] = { piece: piece.id, color: getPieceColor(piece.id) }; });
    modeStats().piecesPlaced += 1; updateMission('pieces', 1);
    state.score += placementScore;
    state.queue[index] = null; renderBoard(); renderTray(); renderHud(); animatePlacedCells(placedCells);
    spawnScorePopup(`+${formatNumber(placementScore)}`, 'place', placedCells);
    triggerBoardImpact('place');
    playSfx('place'); vibrate(10);
    const completed = clearCompletedLines();
    if (completed.cells.length) {
      const clearedLines = completed.count;
      const pulseReady = state.charge >= 100;
      state.lines += clearedLines; state.combo += 1; state.bestComboInGame = Math.max(state.bestComboInGame, state.combo);
      const chargeGain = clearedLines * 16 + completed.cells.length * 0.7 + state.combo * 3;
      let pulseBonus = 0;
      if (pulseReady) {
        state.charge = 0; state.pulseBursts += 1; modeStats().pulseBursts += 1; pulseBonus = 250 + clearedLines * 75;
        updateMission('pulse', 1);
      } else state.charge = Math.min(100, state.charge + chargeGain);
      const clearScore = calculateClearScore(completed, state.combo, pulseBonus);
      state.score += clearScore;
      modeStats().totalLines += clearedLines;
      if (state.combo > modeStats().bestCombo) modeStats().bestCombo = state.combo;
      updateMission('lines', clearedLines); updateMission('combo', state.combo); updateMission('score', state.score);
      trackShapesProgress(completed);
      markCellsClearing(completed.cells);
      completed.cells.forEach(([r, c]) => { state.board[r][c] = null; });
      if (occupiedCount() === 0) {
        state.score += 500; modeStats().perfectClears = (modeStats().perfectClears || 0) + 1;
        setTimeout(() => { spawnScorePopup('PLATEAU VIDE +500', 'pulse', [], true); showToast('PLATEAU VIDE ! +500 pts bonus'); playSfx('record'); vibrate([30, 16, 60]); }, 280);
      }
      const clearVisualToken = ++state.clearVisualToken;
      state.clearVisualPending = true;
      // Le modèle est déjà nettoyé : on libère immédiatement la prochaine
      // pièce avant les effets décoratifs et audio.
      releaseTurnAfterClear();
      const clearLevel = pulseReady || clearedLines >= 3 ? 3 : clearedLines >= 2 ? 2 : 1;
      const clearHaptic = state.combo >= 3 ? [18, 8, 18, 8, 34] : clearLevel >= 3 ? [24, 12, 42] : clearLevel === 2 ? [18, 10, 30] : 14;
      const runClearFeedback = () => {
        triggerClearEffect(completed.cells, pulseReady);
        triggerBoardImpact(pulseReady ? 'pulse' : 'clear');
        showClearFeedback(clearedLines);
        spawnScorePopup(`+${formatNumber(clearScore)}`, pulseReady ? 'pulse' : 'clear', completed.cells);
        if (state.combo > 1) {
          spawnScorePopup(`COMBO ×${state.combo}`, 'combo', completed.cells, true);
          renderHud();
          retriggerClass($('#combo-badge'), 'combo-pop');
        }
        $('#game-message').textContent = pulseReady ? 'PULSE BURST ! La grille vient de surcharger.' : `${clearedLines} ligne${clearedLines > 1 ? 's' : ''} dissoute${clearedLines > 1 ? 's' : ''} !`;
        showToast(pulseReady ? `PULSE BURST  ·  +${formatNumber(clearScore)} pts` : state.combo > 1 ? `Combo ×${state.combo}  ·  +${formatNumber(clearScore)} pts` : `Impulsion parfaite  ·  +${formatNumber(clearScore)} pts`);
        playSfx(clearLevel >= 3 ? 'multi-clear' : clearedLines >= 2 ? 'multi-clear' : 'clear', clearLevel);
        if (state.combo > 1) playSfx('combo', Math.min(4, state.combo));
        vibrate(clearHaptic);
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(runClearFeedback);
      else setTimeout(runClearFeedback, 0);
      setTimeout(() => finishClear(clearVisualToken), pulseReady ? 320 : 230);
    } else {
      state.combo = 0; updateMission('score', state.score); trackShapesProgress(null); finishTurn();
    }
    if (state.bestAtStart > 0 && !state.recordAnnounced && scoreBeforeMove <= state.bestAtStart && state.score > state.bestAtStart) {
      state.recordAnnounced = true;
      showHighScoreFeedback(state.score);
      showToast('NEW HIGH SCORE ! Continue comme ça.');
      spawnScorePopup('NEW HIGH SCORE', 'pulse', placedCells, true);
      playSfx('record');
      vibrate([28, 14, 52]);
    }
    renderHud(); checkAchievements(); saveProfile();
  }

  function markCellsClearing(cells) {
    cells.forEach(([r, c], index) => {
      const cell = $('#board').children[r * geo.cols + c];
      if (!cell) return;
      cell.style.setProperty('--clear-delay', `${Math.min(index * 5, 40)}ms`);
      cell.classList.add('clearing');
    });
  }

  function releaseTurnAfterClear() {
    if (!state.gameActive) return;
    if (state.queue.every(piece => !piece)) { state.queue = generateQueue(); }
    state.resolving = false;
    renderTray(); renderHud();
    const playable = state.queue.some(piece => piece && canAnyPlace(piece));
    if (!playable) endOrRevive();
    else { $('#game-message').textContent = state.combo > 1 ? `Le rythme est lancé : combo ×${state.combo}.` : 'À toi de jouer. Trouve le prochain espace.'; saveProfile(); }
  }

  function finishClear(clearVisualToken) {
    if (clearVisualToken !== state.clearVisualToken || !state.clearVisualPending) return;
    state.clearVisualPending = false;
    renderBoard();
  }

  function finishTurn() {
    if (!state.gameActive) return;
    if (state.queue.every(piece => !piece)) { state.queue = generateQueue(); }
    state.resolving = false; state.clearVisualPending = false; renderBoard(); renderTray(); renderHud();
    const playable = state.queue.some(piece => piece && canAnyPlace(piece));
    if (!playable) endOrRevive();
    else { $('#game-message').textContent = state.combo > 1 ? `Le rythme est lancé : combo ×${state.combo}.` : 'À toi de jouer. Trouve le prochain espace.'; saveProfile(); }
  }

  function endGame(options = {}) {
    if (!state.gameActive) return;
    state.gameActive = false; state.resolving = false; state.activeBooster = null; profile.run = null; keepAwake(false);
    renderBoosters();
    const reward = 20 + Math.floor(state.score / 250) + state.lines * 3 + Math.max(0, state.bestComboInGame - 1) * 5 + state.pulseBursts * 12;
    const xpEarned = 45 + Math.floor(state.score / 28) + state.lines * 12;
    const levelBefore = profile.level;
    const previousBest = state.bestAtStart;
    const isNewRecord = state.score > previousBest;
    const modeStat = modeStats();
    profile.coins += reward; modeStat.games += 1; modeStat.totalScore += state.score;
    if (state.mode === 'shapes') {
      const boardProgress = shapesProgress();
      boardProgress.games += 1; boardProgress.bestScore = Math.max(boardProgress.bestScore, state.score);
    } else profile.best = Math.max(profile.best, state.score);
    updateMission('games', 1); updateMission('score', state.score);
    const levels = addXp(xpEarned);
    checkAchievements();
    saveProfile(); renderHome(); renderMissions(); renderStats(); renderHud(); renderShapes(); renderTrophies();
    if (state.mode === 'classic') onlineAfterClassicGame();
    if (options.silent) { showToast(`Partie enregistrée · +${reward} ◆ · +${xpEarned} XP`); return; }
    const masteryNow = state.mode === 'shapes' && state.pendingMastery;
    if (!masteryNow) {
      playSfx(isNewRecord && !state.recordAnnounced ? 'record' : 'gameOver');
      vibrate(isNewRecord && !state.recordAnnounced ? [28, 14, 52] : [18, 12, 28]);
      openEndModal(reward, xpEarned, levels, levelBefore, isNewRecord, previousBest);
    } else showMasteryCelebration();
    showRewardPopup(`+${reward} ◆`, 'coins');
    setTimeout(() => { showRewardPopup(`+${xpEarned} XP`, 'xp'); playSfx('xp'); }, 90);
    setTimeout(() => playSfx('coins'), 210);
    if (levels) setTimeout(() => playSfx('unlock'), 340);
  }

  function addXp(amount) {
    let levels = 0; profile.xp += amount;
    while (profile.xp >= xpForNextLevel(profile.level)) { profile.xp -= xpForNextLevel(profile.level); profile.level += 1; levels += 1; profile.coins += 75 + profile.level * 10; }
    return levels;
  }
  function xpForNextLevel(level) { return 400 + (level - 1) * 150; }

  function getProgressionReward(level) {
    const explicit = PROGRESSION_REWARDS.find(reward => reward.level === level);
    if (explicit) return { ...explicit };
    if (level % 10 === 0) return { level, type: 'pack', id: 'overdrive', amount: 1, icon: '◆', title: 'Pack Overdrive', milestone: true };
    if (level % 5 === 0) return { level, type: 'coins', amount: 320 + level * 8, icon: '◆', title: 'Grande réserve', milestone: true };
    return { level, type: 'coins', amount: 100 + level * 8, icon: '◆', title: 'PulseCoins' };
  }

  function isProgressionClaimed(level) { return profile.progressionClaims.includes(level); }

  function progressionRewardLabel(reward) {
    if (reward.type === 'coins') return `+${formatNumber(reward.amount)} PulseCoins`;
    if (reward.type === 'booster') {
      const item = CATALOG.boosters.find(entry => entry.id === reward.id);
      return `${reward.amount > 1 ? `${reward.amount}× ` : ''}${item?.name || 'Booster'}`;
    }
    if (reward.type === 'pack') return `${reward.amount > 1 ? `${reward.amount}× ` : ''}${CATALOG.packs.find(pack => pack.id === reward.id)?.name || 'Pack'}`;
    if (reward.type === 'skin') return `Skin ${findCatalog('skins', reward.id).name}`;
    if (reward.type === 'board') return `Plateau ${findCatalog('boards', reward.id).name}`;
    if (reward.type === 'effect') return `Effet ${findCatalog('effects', reward.id).name}`;
    return reward.title || 'Récompense';
  }

  function progressionRewardDetail(reward) {
    if (reward.type === 'coins') return `+${formatNumber(reward.amount)} ◆`;
    if (reward.type === 'booster') return `${reward.amount > 1 ? `${reward.amount} × ` : ''}${CATALOG.boosters.find(item => item.id === reward.id)?.name || 'Booster'}`;
    if (reward.type === 'pack') return `${reward.amount > 1 ? `${reward.amount} × ` : ''}${CATALOG.packs.find(pack => pack.id === reward.id)?.name || 'Pack'}`;
    return progressionRewardLabel(reward);
  }

  function getNextProgressionReward() {
    for (let level = 1; level <= profile.level; level++) {
      if (!isProgressionClaimed(level)) return getProgressionReward(level);
    }
    return getProgressionReward(profile.level + 1);
  }

  function availableProgressionRewards() {
    let count = 0;
    for (let level = 1; level <= profile.level; level++) if (!isProgressionClaimed(level)) count++;
    return count;
  }

  function grantProgressionReward(reward) {
    if (reward.type === 'coins') {
      profile.coins += reward.amount;
      return { popup: `+${formatNumber(reward.amount)} ◆`, popupType: 'coins' };
    }
    if (reward.type === 'booster') {
      profile.inventory[reward.id] = (profile.inventory[reward.id] || 0) + reward.amount;
      return { popup: `+${reward.amount} ${CATALOG.boosters.find(item => item.id === reward.id)?.name || 'booster'}`, popupType: 'special' };
    }
    if (reward.type === 'pack') {
      const pack = CATALOG.packs.find(item => item.id === reward.id);
      if (pack) for (let index = 0; index < reward.amount; index++) Object.entries(pack.contents).forEach(([id, amount]) => { profile.inventory[id] = (profile.inventory[id] || 0) + amount; });
      return { popup: `${pack?.name || 'Pack'} obtenu`, popupType: 'special' };
    }
    const category = reward.type === 'skin' ? 'skins' : reward.type === 'board' ? 'boards' : 'effects';
    const alreadyUnlocked = profile.unlocked[category].includes(reward.id);
    if (!alreadyUnlocked) {
      profile.unlocked[category].push(reward.id);
      return { popup: `${progressionRewardLabel(reward)} débloqué`, popupType: 'special' };
    }
    const fallbackCoins = reward.duplicateCoins || 75;
    profile.coins += fallbackCoins;
    return { popup: `Déjà obtenu · +${fallbackCoins} ◆`, popupType: 'coins' };
  }

  function claimProgressionReward(level) {
    const rewardLevel = Number(level);
    if (!Number.isInteger(rewardLevel) || rewardLevel < 1 || rewardLevel > profile.level || isProgressionClaimed(rewardLevel)) return;
    const reward = getProgressionReward(rewardLevel);
    const result = grantProgressionReward(reward);
    profile.progressionClaims.push(rewardLevel);
    profile.progressionClaims.sort((a, b) => a - b);
    saveProfile();
    renderHome(); renderProgression(); renderShop(); renderCollection(); renderStats();
    showRewardPopup(result.popup, result.popupType);
    showToast(`Récompense du niveau ${rewardLevel} récupérée !`);
    playSfx(reward.milestone ? 'unlock' : 'coins');
    vibrate(reward.milestone ? [18, 10, 28] : 14);
  }

  function renderProgression() {
    const target = $('#progression-content');
    if (!target) return;
    const nextXp = xpForNextLevel(profile.level);
    const xpRatio = clamp(profile.xp / nextXp * 100, 0, 100);
    const nextReward = getNextProgressionReward();
    const available = availableProgressionRewards();
    const maxLevel = Math.max(PROGRESSION_REWARDS.length, profile.level + 5);
    const nodes = Array.from({ length: maxLevel }, (_, index) => {
      const level = index + 1;
      const reward = getProgressionReward(level);
      const claimed = isProgressionClaimed(level);
      const unlocked = level <= profile.level;
      const current = level === profile.level;
      const milestone = Boolean(reward.milestone || level % 5 === 0);
      const statusClass = claimed ? 'is-claimed' : unlocked ? 'is-available' : 'is-locked';
      const stateLabel = claimed ? '✓ RÉCUPÉRÉE' : current ? 'NIVEAU ACTUEL' : unlocked ? 'RÉCOMPENSE DISPONIBLE' : 'VERROUILLÉ';
      const action = claimed ? '<span class="progression-claimed">RÉCUPÉRÉE</span>' : unlocked ? `<button class="progression-claim" data-action="claim-progression" data-level="${level}">RÉCUPÉRER</button>` : `<span class="progression-locked">À venir</span>`;
      return `<article class="progression-node ${statusClass}${current ? ' is-current' : ''}${milestone ? ' is-milestone' : ''}" data-progression-level="${level}"><div class="progression-rail"><span class="progression-dot">${claimed ? '✓' : milestone ? '★' : level}</span></div><div class="progression-card"><div class="progression-card-top"><span class="progression-level">NIVEAU ${level}</span><span class="progression-state">${stateLabel}</span></div><div class="progression-reward"><span class="progression-reward-icon">${reward.icon || '◆'}</span><div><strong>${progressionRewardLabel(reward)}</strong><small>${reward.title || progressionRewardDetail(reward)}${milestone ? ' · MILESTONE' : ''}</small></div></div>${action}</div></article>`;
    }).join('');
    target.innerHTML = `<article class="progression-overview"><div class="progression-overview-top"><div><span class="eyebrow accent">ROUTE DE PROGRESSION</span><h2>Niveau ${profile.level}</h2><p>${formatNumber(profile.xp)} / ${formatNumber(nextXp)} XP avant le niveau ${profile.level + 1}</p></div><button class="progression-center" data-action="progression-current">MON NIVEAU</button></div><div class="progression-xp"><span style="width:${xpRatio}%"></span></div><div class="progression-next"><span>${available ? `${available} récompense${available > 1 ? 's' : ''} disponible${available > 1 ? 's' : ''}` : 'PROCHAINE RÉCOMPENSE'}</span><strong>NIVEAU ${nextReward.level} · ${progressionRewardDetail(nextReward)}</strong></div></article><div class="progression-track">${nodes}</div>`;
  }

  function scrollProgressionToCurrent(smooth = false) {
    const level = Math.min(profile.level, Math.max(PROGRESSION_REWARDS.length, profile.level));
    document.querySelector(`[data-progression-level="${level}"]`)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
  }

  function updateMission(type, amount) {
    ensureMissionsForToday(profile);
    const mission = profile.missions.find(item => item.type === type);
    if (!mission) return;
    if (type === 'score' || type === 'combo') mission.progress = Math.max(mission.progress, amount);
    else mission.progress = Math.min(mission.target, mission.progress + amount);
  }

  function claimMission(id) {
    const mission = profile.missions.find(item => item.id === id); if (!mission || mission.claimed || mission.progress < mission.target) return;
    mission.claimed = true; profile.coins += mission.reward; saveProfile(); renderHome(); renderMissions(); renderShop(); animateShopItem('data-mission-id', id, 'mission-claim'); showToast(`+${mission.reward} PulseCoins · mission validée`); showRewardPopup(`+${mission.reward} ◆`, 'coins'); playSfx('coins'); vibrate(24);
  }

  function renderHome() {
    const next = xpForNextLevel(profile.level); const ratio = clamp(profile.xp / next * 100, 0, 100);
    $('#home-level').textContent = profile.level; $('#home-coins').textContent = formatNumber(profile.coins); $('#home-best').textContent = formatNumber(profile.best); $('#home-xp-label').textContent = `${formatNumber(profile.xp)} / ${formatNumber(next)} XP`; $('#home-xp-fill').style.width = `${ratio}%`;
    $('#sound-icon').innerHTML = profile.sound ? '<svg class="ico" aria-hidden="true"><use href="#i-volume"/></svg>' : '<svg class="ico" aria-hidden="true"><use href="#i-volume-off"/></svg>';
    $('#music-icon').innerHTML = profile.music ? '<svg class="ico" aria-hidden="true"><use href="#i-music"/></svg>' : '<svg class="ico" aria-hidden="true"><use href="#i-music-off"/></svg>';
    $('#sound-label').textContent = profile.sound ? 'ON' : 'OFF';
    $('#music-label').textContent = profile.music ? 'ON' : 'OFF';
    $$('[data-action="toggle-sound"]').forEach(button => button.setAttribute('aria-pressed', String(profile.sound)));
    $$('[data-action="toggle-music"]').forEach(button => button.setAttribute('aria-pressed', String(profile.music)));
    $('#volume-control').value = Math.round(profile.volume * 100);
    $('#volume-label').textContent = `${Math.round(profile.volume * 100)}%`;
    const progressionAvailable = availableProgressionRewards();
    const progressionNext = getNextProgressionReward();
    const progressionLabel = progressionAvailable ? `${progressionAvailable} récompense${progressionAvailable > 1 ? 's' : ''} à récupérer` : `Niv. ${progressionNext.level} · ${progressionRewardDetail(progressionNext)}`;
    $('#home-progression-next').textContent = progressionLabel;
    const available = profile.missions.filter(m => m.progress >= m.target && !m.claimed).length; $('#home-mission-count').textContent = available ? `${available} à réclamer` : 'Défis du jour';
    const mission = profile.missions.find(m => !m.claimed) || profile.missions[0];
    renderShapesHome(); renderHomeExtras(); renderTrophyCount(); renderLeaderboardTeaser();
    if (mission) { $('#home-mission-title').textContent = mission.title; $('#home-mission-fill').style.width = `${clamp(mission.progress / mission.target * 100, 0, 100)}%`; }
  }

  /* ===== Boutique cosmétique : métadonnées, thèmes, aperçus ===== */
  const SHOP_META = {
    skins: {
      aurora: { rarity: 'ORIGINAL', tag: 'CLASSIQUE', note: 'Le bloc Pulse Grid, brillant et net.' },
      ember: { rarity: 'RARE', tag: 'MAGMA', note: 'Cœur sombre, braise incandescente et fissure de lave.' },
      pixel: { rarity: 'RARE', tag: 'PIXEL', note: 'Relief 8 bits, esprit borne d’arcade.' },
      cobalt: { rarity: 'RARE', tag: 'CRISTAL', note: 'Verre glacé et reflets coupants.' },
      lime: { rarity: 'ÉPIQUE', tag: 'GELÉE', note: 'Bonbons rebondis, reflets mouillés.' },
      violet: { rarity: 'ÉPIQUE', tag: 'NÉON', note: 'Contours lumineux, cœur électrique.' },
      prism: { rarity: 'MYTHIQUE', tag: 'GEMME', note: 'Facettes taillées qui captent la lumière.' },
      solaris: { rarity: 'MYTHIQUE', tag: 'OR MASSIF', note: 'Plaques d’or brossé, rivets polis.' }
    },
    boards: {
      night: { rarity: 'ORIGINAL', tag: 'CLASSIQUE', note: 'Le plateau Pulse Grid.' },
      glass: { rarity: 'RARE', tag: 'VERRE', note: 'Surface givrée, reflets diagonaux.' },
      carbon: { rarity: 'RARE', tag: 'CARBONE', note: 'Fibre tressée, liseré orange.' },
      sunset: { rarity: 'ÉPIQUE', tag: 'SYNTHWAVE', note: 'Dégradé coucher de soleil, halo rose.' },
      nebula: { rarity: 'ÉPIQUE', tag: 'COSMOS', note: 'Étoiles et gaz cosmiques en fond.' },
      gridline: { rarity: 'MYTHIQUE', tag: 'NÉON GRID', note: 'Cases tracées au laser turquoise.' },
      void: { rarity: 'MYTHIQUE', tag: 'VORTEX', note: 'Vortex violet, cases sombres cerclées de lumière.' }
    },
    effects: {
      burst: { rarity: 'ORIGINAL', tag: 'ÉCLAT', note: 'Le feedback Pulse Grid.' },
      ring: { rarity: 'RARE', tag: 'ONDE', note: 'Ondes de choc concentriques.' },
      confetti: { rarity: 'ÉPIQUE', tag: 'FÊTE', note: 'Pluie de confettis multicolores.' },
      spark: { rarity: 'ÉPIQUE', tag: 'FEU D’ARTIFICE', note: 'Traînées dorées nerveuses.' },
      nova: { rarity: 'MYTHIQUE', tag: 'SUPERNOVA', note: 'Flash blanc et onde de choc.' },
      magnet: { rarity: 'MYTHIQUE', tag: 'TROU NOIR', note: 'Aspiration en spirale vers le centre.' }
    }
  };

  const RARITY_KEY = { 'ORIGINAL': 'original', 'RARE': 'rare', 'ÉPIQUE': 'epic', 'MYTHIQUE': 'mythic' };
  const CATEGORY_LABEL = { skins: 'Fragment', boards: 'Plateau', effects: 'Impulsion' };
  const THEME_DISCOUNT = .25;
  const THEMES = [
    { id: 'eclipse', name: 'Éclipse Solaire', skin: 'solaris', board: 'void', effect: 'nova', rarity: 'MYTHIQUE', tagline: 'De l’or fondu sur le vide. Chaque ligne devient une supernova.' },
    { id: 'cosmos', name: 'Cosmos Prismatique', skin: 'prism', board: 'nebula', effect: 'magnet', rarity: 'MYTHIQUE', tagline: 'Des gemmes dans la nébuleuse, aspirées par un trou noir.' },
    { id: 'neon', name: 'Nuit Néon', skin: 'violet', board: 'gridline', effect: 'spark', rarity: 'ÉPIQUE', tagline: 'Tubes néon sur grille laser, feux d’artifice à chaque combo.' },
    { id: 'arcade', name: 'Arcade 88', skin: 'pixel', board: 'sunset', effect: 'confetti', rarity: 'ÉPIQUE', tagline: 'Pixels, soleil couchant et confettis : la borne de tes rêves.' },
    { id: 'magma', name: 'Cœur de Magma', skin: 'ember', board: 'carbon', effect: 'spark', rarity: 'RARE', tagline: 'Lave et fibre de carbone. Ça chauffe à chaque ligne.' },
    { id: 'glacier', name: 'Glacier', skin: 'cobalt', board: 'glass', effect: 'ring', rarity: 'RARE', tagline: 'Cristal, verre givré et ondes de choc glacées.' }
  ];

  const toRgba = (hex, alpha) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`; };
  const AURORA_IDS = ['dot', 'domino-v', 'tri-h', 'tri-v', 'square', 't'];
  function paletteColor(skin, index) {
    if (!skin || !skin.palette) return PIECE_COLORS[AURORA_IDS[index % AURORA_IDS.length]];
    const [primary, secondary] = skin.palette[index % skin.palette.length];
    return { primary, secondary, soft: toRgba(secondary, .34) };
  }
  function skinColorForShape(skin, shapeId) {
    if (!skin || !skin.palette) return PIECE_COLORS[shapeId] || PIECE_COLORS.dot;
    return paletteColor(skin, Math.max(0, ALL_SHAPES.findIndex(shape => shape.id === shapeId)));
  }

  const DEMO5 = [[-1, -1, -1, -1, -1], [0, 0, -1, 3, -1], [0, -1, -1, 3, 3], [1, 1, 1, -1, 2], [4, 4, -1, 4, 2]];
  const DEMO5_BOARD = [[-1, -1, -1, -1, -1], [-1, 0, 0, -1, -1], [-1, -1, -1, 3, -1], [1, -1, -1, 3, 3], [1, 1, -1, -1, -1]];
  const DEMO5_FX = [[-1, 0, -1, -1, -1], [-1, 0, -1, 3, 3], [4, 4, 4, 4, 4], [1, 1, -1, 2, -1], [1, -1, -1, 2, 5]];
  const DEMO7 = [
    [-1, -1, -1, -1, -1, -1, -1], [-1, 0, 0, -1, -1, 3, -1], [-1, 0, -1, -1, -1, 3, 3], [4, 4, 4, 4, 4, 4, 4],
    [5, 5, -1, 2, 2, -1, 1], [5, -1, -1, -1, 2, -1, 1], [1, 1, -1, -1, -1, -1, 0]
  ];

  const FX_COLORS = { burst: ['#65e8d0', '#8b7cff'], ring: ['#78d9ff', '#65e8d0'], confetti: ['#ff7f9e', '#ffd17a'], spark: ['#ffd17a', '#fff2b3'], nova: ['#fff2b3', '#ff9b70'], magnet: ['#e09aff', '#65e8ff'] };
  const CONFETTI_COLORS = ['#ff7f9e', '#ffd17a', '#65e8d0', '#8b7cff', '#78d9ff', '#c4f36d'];

  function fxHTML(effectId, rowCenterPercent) {
    const [c1, c2] = FX_COLORS[effectId] || FX_COLORS.burst;
    const parts = [];
    const add = (vars, cls = '') => parts.push(`<i${cls ? ` class="${cls}"` : ''} style="${vars}"></i>`);
    if (effectId === 'burst') for (let i = 0; i < 14; i++) add(`--a:${i * 360 / 14}deg;--r:${58 + (i % 3) * 14};--s:7;--c:${i % 2 ? c2 : c1};--d:${(i % 4) * .02}s`);
    else if (effectId === 'ring') for (let i = 0; i < 3; i++) add(`--s:34;--g:${3 + i * .9};--c:${i % 2 ? c2 : c1};--d:${i * .12}s`);
    else if (effectId === 'confetti') for (let i = 0; i < 18; i++) add(`--x:${((i * 47) % 100) - 50};--u:${-(40 + (i * 13) % 46)};--f:${52 + (i * 7) % 26};--rot:${(i % 2 ? 1 : -1) * (240 + i * 22)}deg;--s:6;--c:${CONFETTI_COLORS[i % 6]};--d:${(i % 5) * .025}s`);
    else if (effectId === 'spark') for (let i = 0; i < 12; i++) add(`--a:${i * 30 + 15}deg;--r:${72 + (i % 3) * 18};--c:${i % 2 ? c2 : c1};--d:${(i % 3) * .02}s`);
    else if (effectId === 'nova') {
      add(`--s:38;--c:${c1}`, 'nv-core');
      add(`--s:30;--g:3.6;--c:${c2}`, 'nv-wave');
      for (let i = 0; i < 10; i++) add(`--a:${i * 36}deg;--r:${52 + (i % 2) * 20};--s:6;--c:${i % 2 ? c2 : c1}`, 'nv-dot');
    } else if (effectId === 'magnet') {
      add(`--s:16;--c:${c1}`, 'mg-core');
      for (let i = 0; i < 12; i++) add(`--a:${i * 30}deg;--r:${62 + (i % 3) * 14};--s:6;--c:${i % 2 ? c2 : c1};--d:${(i % 4) * .05}s`, 'mg-dot');
    }
    return `<div class="fxp fx-${effectId}" style="--fy:${rowCenterPercent}%">${parts.join('')}</div>`;
  }

  function themeVarsStyle(skin, board) {
    return `--skin-primary:${skin.primary};--skin-secondary:${skin.secondary};--skin-soft:${skin.soft};--skin-contrast:${skin.contrast};--board-shell:${board.shell};--cell-bg:${board.cell};--board-glow:${board.glow};`;
  }

  function miniBoardHTML(skinId, boardId, opts = {}) {
    const skin = findCatalog('skins', skinId); const board = findCatalog('boards', boardId);
    const size = opts.size || 5; const layout = opts.layout || DEMO5; const clearRow = opts.clearRow ?? -1;
    let cells = '';
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const value = layout[r][c];
      if (value < 0) { cells += '<i class="cell"></i>'; continue; }
      const color = paletteColor(skin, value);
      cells += `<i class="cell filled${r === clearRow ? ' demo-line' : ''}" style="--piece-primary:${color.primary};--piece-secondary:${color.secondary};--piece-soft:${color.soft};--dl:${c * 28}ms"></i>`;
    }
    const fx = opts.effect && clearRow >= 0 ? fxHTML(opts.effect, ((clearRow + .5) / size) * 100) : '';
    return `<div class="mini-board${opts.big ? ' big' : ''}" data-skin="${skin.id}" data-board="${board.id}" style="${themeVarsStyle(skin, board)}"><div class="board" style="grid-template-columns:repeat(${size},1fr);grid-template-rows:repeat(${size},1fr)">${cells}</div>${fx}</div>`;
  }

  function demoTrayHTML(skinId) {
    const skin = findCatalog('skins', skinId);
    const shapes = [[[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 0], [1, 1]], [[0, 0], [0, 1], [0, 2]]];
    const indexes = [2, 4, 0];
    return `<div class="cp-tray" data-skin="${skin.id}">${shapes.map((cells, k) => {
      const color = paletteColor(skin, indexes[k]);
      const rows = Math.max(...cells.map(cell => cell[0])) + 1; const cols = Math.max(...cells.map(cell => cell[1])) + 1;
      let html = '';
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) html += `<i class="mini-cell${cells.some(([pr, pc]) => pr === r && pc === c) ? '' : ' empty'}"></i>`;
      return `<div class="piece-shape" style="--piece-cols:${cols};--piece-rows:${rows};--piece-primary:${color.primary};--piece-secondary:${color.secondary};--piece-soft:${color.soft}">${html}</div>`;
    }).join('')}</div>`;
  }

  function themeInfo(theme) {
    const parts = [['skins', theme.skin], ['boards', theme.board], ['effects', theme.effect]];
    const missing = parts.filter(([category, id]) => !isUnlocked(category, id));
    const missingSum = missing.reduce((sum, [category, id]) => sum + findCatalog(category, id).price, 0);
    return {
      parts, missing, full: missingSum, price: Math.round(missingSum * (1 - THEME_DISCOUNT) / 5) * 5,
      complete: missing.length === 0, equipped: parts.every(([category, id]) => profile.equipped[category.slice(0, -1)] === id)
    };
  }

  function refreshGameVisuals() {
    try { renderBoard(); renderTray(); } catch (_) { /* l'écran de jeu n'est pas encore prêt */ }
  }

  function stageHTML(category, item) {
    const equipped = profile.equipped;
    if (category === 'skins') return miniBoardHTML(item.id, equipped.board, { size: 5, layout: DEMO5 });
    if (category === 'boards') return miniBoardHTML(equipped.skin, item.id, { size: 5, layout: DEMO5_BOARD });
    return miniBoardHTML(equipped.skin, equipped.board, { size: 5, layout: DEMO5_FX, clearRow: 2, effect: item.id });
  }

  function needBlock(price) {
    const short = Math.max(0, price - profile.coins);
    if (!short) return '';
    return `<div class="cos-need-wrap"><span class="cos-need"><span style="width:${Math.min(100, Math.round(profile.coins / price * 100))}%"></span></span><small class="cos-need-label">Il te manque <b>◆ ${formatNumber(short)}</b></small></div>`;
  }

  function renderCatalogCard(category, item) {
    const unlocked = isUnlocked(category, item.id); const equipped = profile.equipped[category.slice(0, -1)] === item.id;
    const meta = SHOP_META[category]?.[item.id] || { rarity: 'RARE', tag: 'COLLECTION', note: item.description };
    const short = item.price > profile.coins;
    let action;
    if (equipped) action = '<button class="cos-btn on" disabled>✓ ÉQUIPÉ</button>';
    else if (unlocked) action = '<button class="cos-btn equip" data-action="equip-item">ÉQUIPER</button>';
    else action = `<button class="cos-btn buy${short ? ' short' : ''}" data-action="buy-item">◆ ${formatNumber(item.price)}</button>${needBlock(item.price)}`;
    const state = equipped ? '<span class="cos-state on">ÉQUIPÉ</span>' : unlocked ? '<span class="cos-state own">✓ POSSÉDÉ</span>' : '';
    return `<article class="cos-card ${unlocked ? 'owned' : 'locked'}${equipped ? ' equipped-card' : ''}" data-r="${RARITY_KEY[meta.rarity]}" data-category="${category}" data-item="${item.id}">
      <button class="cos-stage" data-action="preview-item" aria-label="Aperçu de ${item.name}">${stageHTML(category, item)}<span class="cos-rarity">${meta.rarity}</span>${state}<span class="cos-try">◉ APERÇU EN JEU</span></button>
      <div class="cos-body"><div class="cos-name"><em>${meta.tag}</em><h3>${item.name}</h3></div><p class="cos-note">${meta.note}</p>${action}</div></article>`;
  }

  function themeCardHTML(theme) {
    const info = themeInfo(theme); const rk = RARITY_KEY[theme.rarity];
    const skin = findCatalog('skins', theme.skin); const board = findCatalog('boards', theme.board);
    const chips = info.parts.map(([category, id]) => {
      const own = isUnlocked(category, id);
      return `<span class="tc-chip${own ? ' own' : ''}"><b>${own ? '✓' : '◆'}</b>${CATEGORY_LABEL[category]} · ${findCatalog(category, id).name}</span>`;
    }).join('');
    const short = info.price > profile.coins;
    let action;
    if (info.equipped) action = '<button class="cos-btn on" disabled>✓ THÈME ÉQUIPÉ</button>';
    else if (info.complete) action = '<button class="cos-btn equip" data-action="equip-theme">ÉQUIPER LE THÈME</button>';
    else action = `<button class="cos-btn buy${short ? ' short' : ''}" data-action="buy-theme"><span>OBTENIR</span>${info.full > info.price ? `<s>◆ ${formatNumber(info.full)}</s>` : ''}<b>◆ ${formatNumber(info.price)}</b></button>${needBlock(info.price)}`;
    return `<article class="theme-card" data-r="${rk}" data-theme="${theme.id}">
      <button class="theme-stage" data-action="preview-theme" aria-label="Aperçu du thème ${theme.name}" style="--tg1:${toRgba(skin.palette ? skin.palette[0][1] : skin.primary, .42)};--tg2:${toRgba(skin.palette ? skin.palette[2][1] : skin.secondary, .34)}">
        <span class="theme-copy"><span class="cos-rarity static">${theme.rarity}</span><strong>${theme.name}</strong><small>${theme.tagline}</small></span>
        ${miniBoardHTML(theme.skin, theme.board, { size: 5, layout: DEMO5_FX, clearRow: 2, effect: theme.effect })}
        ${!info.complete && info.full > info.price ? '<span class="theme-save">−25%</span>' : ''}<span class="cos-try">◉ APERÇU EN JEU</span>
      </button>
      <div class="theme-body"><div class="tc-chips">${chips}</div>${action}</div></article>`;
  }

  function renderThemeShop() {
    const complete = THEMES.filter(theme => themeInfo(theme).complete).length;
    return `<section class="shop-hero shop-hero-themes"><div class="shop-hero-icon">❖</div><div class="shop-hero-copy"><span class="eyebrow accent">COLLECTIONS ASSORTIES</span><h2>Thèmes assortis</h2><p>Fragments, plateau et impulsion pensés ensemble, −25% par rapport à l’unité.</p></div><div class="shop-hero-stat"><strong>${complete}/${THEMES.length}</strong><small>complets</small></div></section><div class="theme-list">${THEMES.map(themeCardHTML).join('')}</div>`;
  }

  /* ----- Aperçu en jeu (fenêtre) ----- */
  function previewConfig(request) {
    const equipped = profile.equipped;
    if (request.kind === 'theme') {
      const theme = THEMES.find(entry => entry.id === request.id); if (!theme) return null;
      return { kind: 'theme', id: theme.id, theme, skin: theme.skin, board: theme.board, effect: theme.effect, name: theme.name, desc: theme.tagline, rarity: theme.rarity, highlight: ['skin', 'board', 'effect'] };
    }
    const item = findCatalog(request.category, request.id); const key = request.category.slice(0, -1);
    const config = { kind: 'item', category: request.category, id: request.id, item, skin: equipped.skin, board: equipped.board, effect: equipped.effect, name: item.name, desc: item.description, rarity: SHOP_META[request.category][request.id].rarity, highlight: [key] };
    config[key] = request.id;
    return config;
  }

  function buyBlockHTML(price, strike, action, label) {
    const short = Math.max(0, price - profile.coins);
    return `<button class="cp-cta buy${short ? ' short' : ''}" data-action="${action}"><span>${label}</span><span class="cp-price">${strike > price ? `<s>◆ ${formatNumber(strike)}</s>` : ''}<b>◆ ${formatNumber(price)}</b></span></button>${short
      ? `<div class="cp-short"><span class="cos-need"><span style="width:${Math.min(100, Math.round(profile.coins / price * 100))}%"></span></span><small>Il te manque <b>◆ ${formatNumber(short)}</b> · chaque partie en rapporte</small></div>`
      : '<div class="cp-ready">✓ Tu as assez de PulseCoins</div>'}`;
  }

  function previewActionHTML(config) {
    if (config.kind === 'theme') {
      const info = themeInfo(config.theme);
      if (info.equipped) return '<button class="cp-cta on" disabled>✓ THÈME ÉQUIPÉ</button>';
      if (info.complete) return '<button class="cp-cta equip" data-action="equip-theme">ÉQUIPER LE THÈME</button>';
      return buyBlockHTML(info.price, info.full, 'buy-theme', 'OBTENIR LE THÈME');
    }
    const unlocked = isUnlocked(config.category, config.id); const equipped = profile.equipped[config.category.slice(0, -1)] === config.id;
    if (equipped) return '<button class="cp-cta on" disabled>✓ ÉQUIPÉ</button>';
    if (unlocked) return '<button class="cp-cta equip" data-action="equip-item">ÉQUIPER</button>';
    return buyBlockHTML(config.item.price, 0, 'buy-item', 'DÉBLOQUER');
  }

  function openCosmeticPreview(kind, category, id) {
    state.preview = { kind, category, id };
    const config = previewConfig(state.preview); if (!config) return;
    const skin = findCatalog('skins', config.skin); const board = findCatalog('boards', config.board); const effect = findCatalog('effects', config.effect);
    const rows = [['skin', 'Fragment', skin.name], ['board', 'Plateau', board.name], ['effect', 'Impulsion', effect.name]]
      .map(([key, label, name]) => `<span class="cp-chip${config.highlight.includes(key) ? ' hl' : ''}"><small>${label}</small>${name}</span>`).join('');
    const owner = config.kind === 'theme' ? `data-theme="${config.id}"` : `data-category="${config.category}" data-item="${config.id}"`;
    openModal(`<div class="cp" data-r="${RARITY_KEY[config.rarity]}" ${owner}>
      <button class="cp-close" data-action="close-modal" aria-label="Fermer">✕</button>
      <div class="cp-stage"><span class="cp-live">● APERÇU EN JEU</span>${miniBoardHTML(config.skin, config.board, { size: 7, layout: DEMO7, clearRow: 3, effect: config.effect, big: true })}${demoTrayHTML(config.skin)}</div>
      <div class="cp-info"><div class="cp-meta"><span class="cp-rarity">${config.rarity}</span><span class="cp-kind">${config.kind === 'theme' ? 'THÈME COMPLET' : CATEGORY_LABEL[config.category].toUpperCase()}</span></div><h2>${config.name}</h2><p>${config.desc}</p><div class="cp-chips">${rows}</div>${previewActionHTML(config)}</div></div>`, 'cosmetic-modal');
  }

  function refreshPreview() {
    if (state.preview && $('#modal-backdrop').classList.contains('open')) openCosmeticPreview(state.preview.kind, state.preview.category, state.preview.id);
  }

  function buyTheme(id) {
    const theme = THEMES.find(entry => entry.id === id); if (!theme) return;
    const info = themeInfo(theme);
    if (info.complete) { equipTheme(id); return; }
    if (profile.coins < info.price) { showToast('Pas assez de PulseCoins pour ce thème.'); vibrate(20); return; }
    profile.coins -= info.price;
    info.missing.forEach(([category, itemId]) => { if (!profile.unlocked[category].includes(itemId)) profile.unlocked[category].push(itemId); });
    info.parts.forEach(([category, itemId]) => { profile.equipped[category.slice(0, -1)] = itemId; });
    applyTheme(); refreshGameVisuals(); saveProfile(); renderShop(); renderCollection(); renderHome(); refreshPreview();
    showToast(`${theme.name} débloqué et équipé !`); playSfx('unlock'); vibrate(30);
  }

  function equipTheme(id) {
    const theme = THEMES.find(entry => entry.id === id); if (!theme) return;
    const info = themeInfo(theme); if (!info.complete) return;
    info.parts.forEach(([category, itemId]) => { profile.equipped[category.slice(0, -1)] = itemId; });
    applyTheme(); refreshGameVisuals(); saveProfile(); renderShop(); renderCollection(); refreshPreview();
    showToast(`${theme.name} équipé`); playSfx('unlock');
  }

  const SHOP_COPY = {
    skins: { kicker: 'FORME DES BLOCS', title: 'Matières des blocs', detail: 'Lave, cristal, néon, or : chaque skin redessine tous tes blocs, sur la grille comme dans ta main.', icon: '✦' },
    boards: { kicker: 'ESPACE DE JEU', title: 'Plateaux', detail: 'Des matières et des ambiances qui transforment la grille, sans gêner la lecture.', icon: '▦' },
    effects: { kicker: 'SIGNATURE DE COMBO', title: 'Effets de combo', detail: 'Touche une carte pour voir l’effet jouer sur une vraie ligne.', icon: '✺' }
  };

  function renderShop() {
    $('#shop-coins').textContent = formatNumber(profile.coins);
    $$('[data-shop-tab]').forEach(button => button.classList.toggle('active', button.dataset.shopTab === state.shopTab));
    const target = $('#shop-content');
    if (!target) return;
    target.className = 'shop-content-shell';
    if (state.shopTab === 'boosters') {
      target.innerHTML = renderBoosterShop();
      return;
    }
    if (state.shopTab === 'themes') {
      target.innerHTML = renderThemeShop();
      return;
    }
    const items = CATALOG[state.shopTab] || [];
    const copy = SHOP_COPY[state.shopTab];
    const key = state.shopTab.slice(0, -1);
    const equipped = findCatalog(state.shopTab, profile.equipped[key]);
    const owned = items.filter(item => isUnlocked(state.shopTab, item.id)).length;
    target.innerHTML = `<section class="shop-hero shop-hero-${state.shopTab}"><div class="shop-hero-icon">${copy.icon}</div><div class="shop-hero-copy"><span class="eyebrow accent">${copy.kicker}</span><h2>${copy.title}</h2><p>${copy.detail}</p></div><div class="shop-hero-stat"><strong>${owned}/${items.length}</strong><small>possédés</small></div></section><div class="shop-current"><span>ÉQUIPÉ</span><strong>${equipped.name}</strong><small>${SHOP_META[state.shopTab]?.[equipped.id]?.note || equipped.description}</small></div><div class="shop-section-label">COLLECTION ${owned === items.length ? 'COMPLÈTE' : `${items.length - owned} À DÉBLOQUER`}</div><div class="cos-grid">${items.map(item => renderCatalogCard(state.shopTab, item)).join('')}</div>`;
  }

  function renderBoosterShop() {
    const packs = CATALOG.packs.map(pack => {
      const rewardCount = Object.values(pack.contents).reduce((sum, count) => sum + count, 0);
      return `<article class="catalog-card pack-card" data-pack-id="${pack.id}"><div class="catalog-preview pack-preview"><span>${pack.icon}</span><em>${pack.badge || 'PACK'}</em><b class="pack-question">?</b></div><div class="pack-kicker">${pack.badge || 'PACK DE BOOSTERS'} <b>${pack.savings || ''}</b></div><h3>${pack.name}</h3><p>${pack.description}</p><div class="pack-mystery"><span>?</span><div><strong>CONTENU MYSTÈRE</strong><small>${rewardCount} bonus garantis · révélés à l’ouverture</small></div></div><div class="pack-value"><span>VALEUR RUN</span><strong>${pack.savings || 'STOCK'}</strong></div><button class="item-action buy" data-action="buy-pack">◆ ${pack.price}</button></article>`;
    }).join('');
    const boosters = CATALOG.boosters.map(item => renderBoosterShopCard(item)).join('');
    return `<div class="booster-shop"><section class="shop-hero shop-hero-boosters"><div class="shop-hero-icon">\u26A1\uFE0E</div><div class="shop-hero-copy"><span class="eyebrow accent">OUTILS DE RUN</span><h2>Bonus de partie</h2><p>Chaque bonus a un moment précis où il peut sauver ta grille. Pas de décoration inutile.</p></div><div class="shop-hero-stat"><strong>${Object.values(profile.inventory).reduce((sum, count) => sum + (Number(count) || 0), 0)}</strong><small>en stock</small></div></section><div class="booster-shop-intro"><div class="booster-shop-icon">◎</div><div><span class="eyebrow accent">CONSOMMABLES</span><strong>Choisis ton style de secours.</strong><small>Précision, information, tempo ou ouverture : les packs combinent des usages différents.</small></div></div><div class="shop-section-label">PACKS AVANTAGEUX</div><div class="catalog-grid pack-grid">${packs}</div><div class="shop-section-label">À L'UNITÉ · CHOISIS TON OUTIL</div><div class="catalog-grid booster-grid">${boosters}</div></div>`;
  }

  function renderBoosterShopCard(item) {
    const count = profile.inventory[item.id] || 0;
    const rarity = item.id === 'line-breaker' || item.id === 'pulse-core' ? 'ÉPIQUE' : item.id === 'scanner' || item.id === 'hammer' ? 'RARE' : 'TACTIQUE';
    return `<article class="catalog-card booster-card booster-shop-card" data-booster-id="${item.id}"><div class="catalog-preview booster-preview"><span>${item.icon}</span><em>${item.tag}</em></div><div class="product-head"><span class="product-rarity" data-rarity="${rarity}">${rarity}</span><span class="product-tag">${item.tag}</span></div><div class="booster-card-head"><h3>${item.name}</h3><strong>${count}</strong></div><p>${item.description}</p><div class="booster-how"><span>UTILISATION</span>${item.howTo}</div><div class="inventory-line"><span>EN STOCK</span><b>${count}</b></div><button class="item-action buy" data-action="buy-booster">◆ ${item.price}</button></article>`;
  }

  function renderCollection() {
    const skin = findCatalog('skins', profile.equipped.skin); const board = findCatalog('boards', profile.equipped.board); const effect = findCatalog('effects', profile.equipped.effect);
    $('#collection-content').innerHTML = `
      <article class="collection-hero">${miniBoardHTML(skin.id, board.id, { size: 5, layout: DEMO5 })}<div><span class="eyebrow accent">ÉQUIPEMENT ACTUEL</span><h2>${skin.name}</h2><p>${board.name} · ${effect.name}</p></div></article>
      <div class="collection-section"><h3>Fragments</h3><div class="cos-grid">${CATALOG.skins.map(item => renderCatalogCard('skins', item, 'collection')).join('')}</div></div>
      <div class="collection-section"><h3>Plateaux</h3><div class="cos-grid">${CATALOG.boards.map(item => renderCatalogCard('boards', item, 'collection')).join('')}</div></div>
      <div class="collection-section"><h3>Impulsions</h3><div class="cos-grid">${CATALOG.effects.map(item => renderCatalogCard('effects', item, 'collection')).join('')}</div></div>`;
  }

  function findCatalog(category, id) { return CATALOG[category].find(item => item.id === id) || CATALOG[category][0]; }
  function isUnlocked(category, id) { return profile.unlocked[category].includes(id); }

  function buyItem(category, id) {
    if (!category || !id) return; const item = findCatalog(category, id); if (isUnlocked(category, id)) { equipItem(category, id); return; }
    if (profile.coins < item.price) { showToast('Pas assez de PulseCoins pour cet élément.'); vibrate(20); return; }
    profile.coins -= item.price; profile.unlocked[category].push(id); saveProfile(); renderShop(); renderCollection(); renderHome(); animateShopItem('data-item', id); showToast(`${item.name} débloqué !`); playSfx('unlock'); vibrate(22); refreshPreview();
  }

  function buyBooster(id) {
    const booster = CATALOG.boosters.find(item => item.id === id);
    if (!booster) return;
    if (profile.coins < booster.price) {
      showToast('Pas assez de PulseCoins pour ce bonus.');
      vibrate(20);
      return;
    }
    profile.coins -= booster.price;
    profile.inventory[id] = (profile.inventory[id] || 0) + 1;
    saveProfile(); renderShop(); renderHome(); renderBoosters(); animateShopItem('data-booster-id', id);
    showToast(`${booster.name} ajouté à l'inventaire.`);
    playSfx('purchase'); vibrate(22);
  }

  function buildPackRewards(pack) {
    const rewards = Object.entries(pack.contents).flatMap(([id, amount]) => Array.from({ length: amount }, () => id));
    for (let index = rewards.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [rewards[index], rewards[swapIndex]] = [rewards[swapIndex], rewards[index]];
    }
    return rewards;
  }

  function buyPack(id) {
    const pack = CATALOG.packs.find(item => item.id === id);
    if (!pack || state.packOpening) return;
    if (profile.coins < pack.price) {
      showToast('Pas assez de PulseCoins pour ce pack.');
      vibrate(20);
      return;
    }
    const rewards = buildPackRewards(pack);
    profile.coins -= pack.price;
    rewards.forEach(boosterId => { profile.inventory[boosterId] = (profile.inventory[boosterId] || 0) + 1; });
    saveProfile(); renderShop(); renderHome(); renderBoosters(); animateShopItem('data-pack-id', id);
    openPackOpening(pack, rewards);
  }

  /* ===== Ouverture de pack : cinématique plein écran ===== */
  const PACK_RARITY = {
    common: { key: 'common', label: 'COMMUN', rank: 0 },
    rare: { key: 'rare', label: 'RARE', rank: 1 },
    epic: { key: 'epic', label: 'ÉPIQUE', rank: 2 }
  };
  const BOOSTER_RARITY = { scanner: 'common', hammer: 'common', reroll: 'rare', 'pulse-core': 'epic', 'line-breaker': 'epic' };
  const packRarityOf = id => PACK_RARITY[BOOSTER_RARITY[id] || 'common'];
  let packTimers = [];
  const packLater = (callback, delay) => { const id = setTimeout(callback, delay); packTimers.push(id); return id; };
  const clearPackTimers = () => { packTimers.forEach(clearTimeout); packTimers = []; };

  function packSound(kind) {
    if (kind === 'charge') playTone(140, 1.1, { type: 'sawtooth', gain: .022, to: 720 });
    else if (kind === 'burst') {
      playTone(120, .42, { type: 'square', gain: .05, to: 40 });
      [523, 784, 1047].forEach((frequency, i) => packLater(() => playTone(frequency, .22, { type: 'sine', gain: .04 }), 90 + i * 80));
    }
    else if (kind === 'whoosh') playTone(280, .22, { type: 'triangle', gain: .022, to: 900 });
    else if (kind === 'common') playSfx('booster');
    else if (kind === 'rare') playSfx('unlock');
    else if (kind === 'epic') {
      playTone(100, .35, { type: 'square', gain: .045, to: 45 });
      [523, 659, 784, 1047, 1319].forEach((frequency, i) => packLater(() => playTone(frequency, .2, { type: 'sine', gain: .04 }), 60 + i * 75));
    }
  }

  function spawnPackParticles(container, count, tone, inward = false) {
    if (!container) return;
    const layer = document.createElement('span');
    layer.className = `pc-particles${tone === 'blue' ? ' blue' : ''}${inward ? ' inward' : ''}`;
    let html = '';
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 360 + Math.random() * 12;
      const distance = 90 + Math.random() * 140;
      const size = 4 + Math.random() * 7;
      const time = .7 + Math.random() * .55;
      html += `<i style="--a:${angle.toFixed(1)}deg;--d:${distance.toFixed(0)}px;--s:${size.toFixed(1)}px;--t:${time.toFixed(2)}s"></i>`;
    }
    layer.innerHTML = html;
    container.appendChild(layer);
    packLater(() => layer.remove(), 1500);
  }

  function openPackOpening(pack, rewards) {
    closePackCinema(true);
    state.packOpening = true;
    // Les meilleurs bonus sortent en dernier, pour le suspense.
    const ordered = rewards.map((id, order) => ({ id, order }))
      .sort((a, b) => packRarityOf(a.id).rank - packRarityOf(b.id).rank || a.order - b.order)
      .map(item => item.id);
    const total = ordered.length;
    const face = `<div class="pc-face"><span class="pc-face-icon">${pack.icon}</span><b>${pack.badge || 'PACK'}</b><em>PULSE GRID</em><i class="pc-shine"></i></div>`;
    const root = document.createElement('div');
    root.id = 'pack-cinema';
    root.className = 'pc';
    root.dataset.phase = 'sealed';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', `Ouverture : ${pack.name}`);
    root.innerHTML = `
      <div class="pc-bg"><i class="pc-rays"></i><i class="pc-vignette"></i></div>
      <div class="pc-ambient">${Array.from({ length: 16 }, (_, i) => `<i style="left:${(i * 37 + 7) % 100}%;--s:${3 + (i * 5) % 6}px;--t:${5 + (i * 7) % 6}s;--dl:-${(i * 13) % 9}s"></i>`).join('')}</div>
      <button class="pc-skip" type="button">PASSER ›</button>
      <div class="pc-top"><span class="pc-kicker">${pack.name}</span><div class="pc-dots">${ordered.map(() => '<i></i>').join('')}</div></div>
      <div class="pc-stage">
        <div class="pc-pack">
          <i class="pc-glow"></i><i class="pc-wave"></i><i class="pc-wave w2"></i><i class="pc-ring"></i><i class="pc-ring r2"></i><i class="pc-ring r3"></i>
          <div class="pc-orbit"><i></i><i></i><i></i></div><div class="pc-orbit o2"><i></i><i></i></div>
          <div class="pc-sway"><div class="pc-box">
            <div class="pc-half top">${face}</div>
            <div class="pc-half bottom">${face}</div>
            <i class="pc-seam"></i><i class="pc-beam"></i>
          </div></div>
        </div>
        <div class="pc-card-slot"></div>
        <i class="pc-shock"></i>
        <i class="pc-flash"></i>
      </div>
      <div class="pc-hint on">TOUCHE POUR OUVRIR</div>
      <div class="pc-summary"></div>`;
    ($('#app') || document.body).appendChild(root);

    const stage = root.querySelector('.pc-stage');
    const slot = root.querySelector('.pc-card-slot');
    const hint = root.querySelector('.pc-hint');
    const flash = root.querySelector('.pc-flash');
    const summary = root.querySelector('.pc-summary');
    const dots = [...root.querySelectorAll('.pc-dots i')];
    const openedAt = Date.now();
    let current = 0;
    let cardState = 'locked';
    let currentCard = null;

    const setHint = text => { if (text) hint.textContent = text; hint.classList.toggle('on', !!text); };
    const updateDots = () => dots.forEach((dot, index) => {
      dot.classList.toggle('on', index < current);
      dot.classList.toggle('cur', index === current);
    });
    const fireFlash = () => { flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go'); };
    const shakeStage = () => {
      stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake');
      packLater(() => stage.classList.remove('shake'), 540);
    };

    function startOpening() {
      root.dataset.phase = 'opening';
      setHint('');
      root.classList.add('is-charging');
      packSound('charge');
      vibrate([10, 50, 14, 50, 20, 50, 28, 50, 36]);
      [0, 380, 760].forEach(delay => packLater(() => spawnPackParticles(stage, 14, 'gold', true), delay));
      packLater(() => {
        root.classList.add('is-burst');
        packSound('burst');
        vibrate([40, 20, 80]);
        spawnPackParticles(stage, 30, 'gold');
      }, 1150);
      packLater(() => showCard(0), 1500);
    }

    function showCard(index) {
      const id = ordered[index];
      const booster = CATALOG.boosters.find(item => item.id === id);
      if (!booster) { showSummary(); return; }
      const rarity = packRarityOf(id);
      root.removeAttribute('data-rarity');
      root.dataset.phase = 'card';
      current = index;
      cardState = 'busy';
      slot.insertAdjacentHTML('beforeend', `<div class="pc-card rar-${rarity.key} ${index === 0 ? 'enter-first' : 'enter'}"><i class="pc-aura"></i><div class="pc-float"><div class="pc-tilt"><div class="pc-card-inner">
        <div class="pc-back"><span>✦</span><small>BONUS ${index + 1} / ${total}</small></div>
        <div class="pc-front"><i class="pc-foil"></i><span class="pc-rarity">${rarity.label}</span><div class="pc-icon-wrap"><span class="pc-icon">${booster.icon}</span></div><strong>${booster.name}</strong><small class="pc-tag">${booster.tag}</small><p>${booster.description}</p><b class="pc-plus">+1</b></div>
      </div></div></div></div>`);
      currentCard = slot.lastElementChild;
      updateDots();
      setHint('');
      packSound('whoosh');
      vibrate(8);
      packLater(() => { cardState = 'back'; setHint('TOUCHE POUR RÉVÉLER'); }, 480);
    }

    function flipCard() {
      const rarity = packRarityOf(ordered[current]);
      cardState = 'busy';
      setHint('');
      currentCard.classList.add('flipped');
      playSfx('select');
      packLater(() => {
        root.dataset.rarity = rarity.key;
        currentCard.classList.add('revealed');
        packSound(rarity.key);
        if (rarity.key === 'epic') { spawnPackParticles(stage, 34, 'gold'); fireFlash(); shakeStage(); vibrate([24, 16, 46, 16, 70]); }
        else if (rarity.key === 'rare') { spawnPackParticles(stage, 16, 'blue'); fireFlash(); vibrate([16, 10, 30]); }
        else { spawnPackParticles(stage, 8, 'blue'); vibrate(14); }
      }, 320);
      packLater(() => {
        cardState = 'front';
        setHint(current >= total - 1 ? 'TOUCHE POUR VOIR TON BUTIN' : 'TOUCHE POUR CONTINUER');
      }, 820);
    }

    function nextCard() {
      cardState = 'busy';
      setHint('');
      const old = currentCard;
      resetTilt();
      old.classList.remove('enter', 'enter-first');
      old.classList.add('leave');
      packLater(() => old.remove(), 340);
      if (current >= total - 1) packLater(showSummary, 300);
      else packLater(() => showCard(current + 1), 140);
    }

    function showSummary() {
      clearPackTimers();
      cardState = 'locked';
      root.removeAttribute('data-rarity');
      const counts = new Map();
      ordered.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
      const entries = [...counts.entries()].sort((a, b) => packRarityOf(b[0]).rank - packRarityOf(a[0]).rank);
      const tiles = entries.map(([id, count], index) => {
        const booster = CATALOG.boosters.find(item => item.id === id);
        const rarity = packRarityOf(id);
        return `<div class="pc-tile rar-${rarity.key}" style="--d:${120 + index * 90}ms"><b class="t-count">×${count}</b><span class="t-icon">${booster.icon}</span><strong>${booster.name}</strong><small>${rarity.label}</small></div>`;
      }).join('');
      summary.innerHTML = `<span class="pc-sum-kicker">BUTIN DU PACK</span><h2>${pack.name}</h2><div class="pc-sum-grid">${tiles}</div><p class="pc-sum-total">${total} bonus ajoutés à ton inventaire</p><button class="pc-done" type="button">TERMINER</button>`;
      summary.scrollTop = 0;
      root.dataset.phase = 'summary';
      summary.querySelector('.pc-done').addEventListener('click', finishPackOpening);
      playSfx('unlock');
      vibrate([14, 8, 26]);
    }

    let tiltFrame = 0;
    let tiltX = 0;
    let tiltY = 0;
    function resetTilt() {
      const el = currentCard && currentCard.querySelector('.pc-tilt');
      if (el) { el.classList.remove('live'); el.style.transform = ''; }
    }
    function applyTilt() {
      tiltFrame = 0;
      const el = currentCard && currentCard.querySelector('.pc-tilt');
      if (!el || root.dataset.phase !== 'card') return;
      const rect = stage.getBoundingClientRect();
      const nx = clamp((tiltX - (rect.left + rect.width / 2)) / (rect.width / 2), -1, 1);
      const ny = clamp((tiltY - (rect.top + rect.height / 2)) / (rect.height / 2), -1, 1);
      el.classList.add('live');
      el.style.transform = `rotateY(${(nx * 18).toFixed(1)}deg) rotateX(${(-ny * 18).toFixed(1)}deg)`;
    }
    const onTilt = event => { tiltX = event.clientX; tiltY = event.clientY; if (!tiltFrame) tiltFrame = scheduleFrame(applyTilt); };
    root.addEventListener('pointerdown', onTilt);
    root.addEventListener('pointermove', onTilt);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(name => root.addEventListener(name, resetTilt));

    root.addEventListener('click', event => {
      if (event.target.closest('button') || Date.now() - openedAt < 350) return;
      const phase = root.dataset.phase;
      if (phase === 'sealed') startOpening();
      else if (phase === 'card' && cardState === 'back') flipCard();
      else if (phase === 'card' && cardState === 'front') nextCard();
    });
    root.querySelector('.pc-skip').addEventListener('click', event => { event.stopPropagation(); showSummary(); });

    playSfx('purchase');
    vibrate([18, 12, 30]);
  }

  function closePackCinema(immediate = false) {
    clearPackTimers();
    const root = $('#pack-cinema');
    if (root) {
      if (immediate) root.remove();
      else { root.classList.add('closing'); setTimeout(() => root.remove(), 260); }
    }
    state.packOpening = false;
  }

  function finishPackOpening() {
    if (!state.packOpening) return;
    closePackCinema();
  }

  function equipItem(category, id) {
    if (!category || !id || !isUnlocked(category, id)) return;
    const key = category.slice(0, -1); profile.equipped[key] = id; applyTheme(); refreshGameVisuals(); saveProfile(); renderShop(); renderCollection(); refreshPreview(); animateShopItem('data-item', id, 'equip-pop'); showToast(`${findCatalog(category, id).name} équipé`); playSfx('unlock');
  }

  function renderMissions() {
    ensureMissionsForToday(profile);
    $('#missions-content').innerHTML = profile.missions.map(mission => {
      const percent = clamp(mission.progress / mission.target * 100, 0, 100); const ready = mission.progress >= mission.target && !mission.claimed;
      return `<article class="mission-card ${mission.claimed ? 'done' : ''}" data-mission-id="${mission.id}"><div class="mission-head"><div class="mission-icon">${mission.icon}</div><div class="mission-main"><strong>${mission.title}</strong><small>${mission.detail}</small></div><div class="mission-reward">◆ ${mission.reward}</div></div><div class="mission-progress-row"><div class="mini-progress"><span style="width:${percent}%"></span></div><span class="mission-count">${Math.min(mission.progress, mission.target)} / ${mission.target}</span></div>${mission.claimed ? '<button class="claim-button" disabled>RÉCOMPENSE RÉCUPÉRÉE</button>' : `<button class="claim-button" data-action="claim-mission" ${ready ? '' : 'disabled'}>${ready ? 'RÉCUPÉRER LA RÉCOMPENSE' : 'ENCORE UN PEU'}</button>`}</article>`;
    }).join('');
  }

  function renderStats() {
    const next = xpForNextLevel(profile.level); const ratio = clamp(profile.xp / next * 100, 0, 100); const stats = profile.stats;
    $('#stats-content').innerHTML = `<article class="stats-level-card"><div class="stats-level-top"><div><span class="eyebrow accent">NIVEAU ACTUEL</span><h2>Récompenses</h2></div><strong>${profile.level}</strong></div><p>${formatNumber(profile.xp)} / ${formatNumber(next)} XP avant le niveau ${profile.level + 1}</p><div class="xp-track"><span style="width:${ratio}%"></span></div></article><div class="section-heading"><h2>Classic</h2><span class="section-line"></span></div><div class="stats-grid"><article class="stat-box"><span>Meilleur score</span><strong>${formatNumber(profile.best)}</strong><em>record personnel</em></article><article class="stat-box"><span>Parties jouées</span><strong>${formatNumber(stats.games)}</strong><em>tentatives</em></article><article class="stat-box"><span>Lignes dissoutes</span><strong>${formatNumber(stats.totalLines)}</strong><em>total cumulé</em></article><article class="stat-box"><span>Meilleur combo</span><strong>×${formatNumber(stats.bestCombo)}</strong><em>chaîne maximale</em></article><article class="stat-box"><span>Score cumulé</span><strong>${formatNumber(stats.totalScore)}</strong><em>toutes parties</em></article><article class="stat-box"><span>Fragments posés</span><strong>${formatNumber(stats.piecesPlaced)}</strong><em>patience & précision</em></article><article class="stat-box"><span>Pulse Bursts</span><strong>${formatNumber(stats.pulseBursts)}</strong><em>surcharges parfaites</em></article><article class="stat-box"><span>Bonus utilisés</span><strong>${formatNumber(stats.boostersUsed)}</strong><em>coups de secours</em></article></div>${shapesStatsHTML()}<div class="tip-card">Les scores, objets et missions sont enregistrés automatiquement sur cet appareil grâce à <strong>localStorage</strong>. Ferme le jeu sans crainte : ta progression reste là.</div>`;
  }

  function giveHint(options = {}) {
    if (!state.gameActive || state.resolving) return false;
    const piece = state.queue.find(item => item && canAnyPlace(item));
    if (!piece) { showToast('Aucun fragment ne peut être posé.'); return false; }
    let best = null; let bestValue = -Infinity;
    for (let r = 0; r < geo.rows; r++) for (let c = 0; c < geo.cols; c++) if (canPlace(piece, r, c)) {
      // Bonus pour les cases collées au bord du plateau (bord de la forme, pas de la boîte englobante).
      let value = 0; piece.cells.forEach(([dr, dc]) => { const rr = r + dr; const cc = c + dc; if (!geo.mask[rr - 1]?.[cc]) value += .5; if (!geo.mask[rr + 1]?.[cc]) value += .5; if (!geo.mask[rr]?.[cc - 1]) value += .5; if (!geo.mask[rr]?.[cc + 1]) value += .5; });
      const nearFull = [...Array(geo.rows)].map((_, i) => state.board[r + i]?.filter(Boolean).length || 0).reduce((a, b) => a + b, 0); value += nearFull * .01;
      if (value > bestValue) { bestValue = value; best = { r, c }; }
    }
    const index = state.queue.indexOf(piece);
    selectPiece(index);
    showPreview(piece, getPlacementFromTopLeft(piece, best.r, best.c));
    showToast(options.fromScanner ? 'Scanner : position forte révélée.' : 'Indice : cette position garde de l’espace pour la suite.');
    setTimeout(clearPreview, 1100);
    return true;
  }

  function openPauseModal() {
    if (!state.gameActive) { showScreen('home'); return; }
    state.paused = true;
    openModal(`<div class="pause-icon">Ⅱ</div><span class="modal-kicker">PARTIE EN PAUSE</span><h2>Kits de bonus</h2><p>La partie est en sécurité. Reviens quand tu veux continuer à construire ta grille.</p><div class="modal-actions"><button class="secondary" data-action="go-home">ACCUEIL</button><button class="secondary" data-action="restart">RECOMMENCER</button><button class="primary" data-action="resume">CONTINUER</button></div>`);
  }

  function openEndModal(reward, xpEarned, levels, levelBefore, isNewRecord, previousBest) {
    const levelText = levels ? `<div class="level-up"><strong>LEVEL UP!</strong><span>NIVEAU ${levelBefore + levels} atteint · ${levels > 1 ? `${levels} récompenses` : 'une récompense'} disponible${levels > 1 ? 's' : ''}</span><button data-action="progression">VOIR LA RÉCOMPENSE</button></div>` : '';
    const recordKicker = isNewRecord ? 'NEW HIGH SCORE' : 'PARTIE TERMINÉE';
    const recordTitle = isNewRecord ? 'Tu viens de monter la barre.' : 'Bien joué.';
    const recordBanner = isNewRecord ? `<div class="end-record-banner"><span>NEW HIGH SCORE</span><strong>${formatNumber(state.score)}</strong></div>` : '';
    const recordMessage = isNewRecord ? 'Cette partie devient ton nouveau repère. Encore une pour voir jusqu\'où tu peux pousser la grille.' : previousBest > 0 ? `Il te manquait ${formatNumber(Math.max(0, previousBest - state.score))} points pour battre ton record.` : 'Chaque partie construit ton premier record. Le prochain coup peut déjà tout changer.';
    openModal(`${recordBanner}<span class="modal-kicker ${isNewRecord ? 'record-kicker' : ''}">${recordKicker}</span><h2>${recordTitle}</h2><p>${recordMessage}</p><div class="result-score ${isNewRecord ? 'record-score' : ''}"><span>SCORE</span><strong>${formatNumber(state.score)}</strong></div><div class="result-stats"><div class="result-stat"><strong>${formatNumber(state.lines)}</strong><span>lignes supprimées</span></div><div class="result-stat"><strong>×${formatNumber(Math.max(modeStats().bestCombo, state.bestComboInGame))}</strong><span>meilleur combo</span></div><div class="result-stat"><strong>${formatNumber(state.turn)}</strong><span>pièces posées</span></div><div class="result-stat"><strong>${formatNumber(getBest())}</strong><span>meilleur score</span></div></div><div class="reward-row"><div>◆ ${reward}<span>PulseCoins</span></div><div>✦ ${xpEarned}<span>XP gagnés</span></div></div>${levelText}${shapesEndBlock()}<button class="share-link" data-action="share-score">↗ PARTAGER MON SCORE</button><div class="modal-actions"><button class="secondary" data-action="go-home">ACCUEIL</button>${state.mode === 'shapes' ? '<button class="secondary" data-action="shapes-screen">PLATEAUX</button>' : ''}<button class="primary" data-action="restart">REJOUER</button></div>`);
  }

  function openModal(content, variant = '') {
    const modalCard = $('#modal-card');
    state.mandatoryModal = variant === 'name-modal';   // fenêtre impossible à fermer sans valider
    modalCard.className = `modal-card${variant ? ` ${variant}` : ''}`;
    modalCard.innerHTML = content;
    $('#modal-backdrop').classList.add('open');
    $('#modal-backdrop').setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    if (state.mandatoryModal) return;
    state.preview = null;
    if (state.packOpeningTimer !== null) clearTimeout(state.packOpeningTimer);
    state.packOpeningTimer = null;
    state.packOpening = false;
    $('#modal-card').className = 'modal-card';
    $('#modal-backdrop').classList.remove('open');
    $('#modal-backdrop').setAttribute('aria-hidden', 'true');
    if (state.gameActive) state.paused = false;
    // Fermer l'offre de reprise sans choisir (retour, touche Échap, clic à côté) = terminer la partie.
    if (state.reviveOffer) { state.reviveOffer = false; endGame(); }
  }

  function triggerClearEffect(cells, pulseBurst = false) {
    const layer = $('#fx-layer'); if (!layer) return;
    const effect = profile.equipped.effect;
    const particleCells = pulseBurst
      ? Array.from({ length: Math.min(36, cells.length * 2) }, (_, index) => cells[index % cells.length])
      : cells.slice(0, 16);
    particleCells.forEach(([r, c], index) => {
      const particle = document.createElement('i');
      const type = pulseBurst ? 'pulse-particle' : effect === 'ring' ? 'ring' : effect === 'confetti' ? 'round' : effect === 'nova' ? 'nova-particle' : effect === 'magnet' ? 'magnet-particle' : '';
      particle.className = `fx-particle ${type}`;
      const x = ((c + .5) / geo.cols) * 100; const y = ((r + .5) / geo.rows) * 100;
      particle.style.left = `${x}%`; particle.style.top = `${y}%`; particle.style.setProperty('--dx', `${(Math.random() - .5) * (pulseBurst ? 150 : 95)}px`); particle.style.setProperty('--dy', `${-15 - Math.random() * (pulseBurst ? 110 : 75)}px`); particle.style.animationDelay = `${index * (pulseBurst ? 7 : 12)}ms`; layer.appendChild(particle); setTimeout(() => particle.remove(), pulseBurst ? 1100 : 850);
    });
    if (pulseBurst || effect === 'spark' || effect === 'nova' || effect === 'magnet') layer.animate([{ opacity: .35 }, { opacity: 1 }, { opacity: .35 }], { duration: pulseBurst ? 440 : effect === 'nova' ? 260 : 360, iterations: 2 });
  }

  function showClearFeedback(count) {
    if (count < 2) return;
    const panel = $('#clear-feedback');
    const text = $('#clear-feedback-text');
    const subtitle = $('#clear-feedback-subtitle');
    if (!panel || !text || !subtitle) return;

    const feedback = count >= 5
      ? { word: 'UNSTOPPABLE!', className: 'feedback-unstoppable', level: 4, duration: 1150 }
      : count === 4
        ? { word: 'INCREDIBLE!', className: 'feedback-incredible', level: 3, duration: 1100 }
        : count === 3
          ? { word: 'AWESOME!', className: 'feedback-awesome', level: 2, duration: 1050 }
          : { word: 'AMAZING!', className: 'feedback-amazing', level: 1, duration: 1000 };

    clearTimeout(state.clearFeedbackTimer);
    panel.className = `clear-feedback ${feedback.className}`;
    panel.setAttribute('aria-hidden', 'false');
    text.textContent = feedback.word;
    subtitle.textContent = `${count} LIGNES / COLONNES ÉLIMINÉES`;
    void panel.offsetWidth;
    panel.classList.add('show');
    spawnFeedbackParticles(feedback.level);
    if (feedback.level >= 3) spawnFeedbackFlash();
    speakClearFeedback(feedback.word, feedback.level);

    state.clearFeedbackTimer = setTimeout(() => {
      panel.classList.remove('show');
      panel.setAttribute('aria-hidden', 'true');
    }, feedback.duration);
  }

  function spawnFeedbackParticles(level) {
    const layer = $('#fx-layer');
    if (!layer) return;
    const amount = level >= 4 ? 14 : level === 3 ? 11 : level === 2 ? 8 : 5;
    for (let index = 0; index < amount; index++) {
      const particle = document.createElement('i');
      particle.className = `fx-particle feedback-particle${level >= 3 ? ' feedback-particle-big' : ''}${level >= 4 && index % 2 === 0 ? ' feedback-particle-hot' : ''}`;
      particle.style.left = `${50 + (Math.random() - .5) * 20}%`;
      particle.style.top = `${45 + (Math.random() - .5) * 14}%`;
      particle.style.setProperty('--dx', `${(Math.random() - .5) * (level >= 4 ? 190 : 130)}px`);
      particle.style.setProperty('--dy', `${-22 - Math.random() * (level >= 4 ? 120 : 82)}px`);
      particle.style.animationDelay = `${index * (level >= 4 ? 12 : 17)}ms`;
      layer.appendChild(particle);
      setTimeout(() => particle.remove(), 950);
    }
  }

  function spawnFeedbackFlash() {
    const layer = $('#fx-layer');
    if (!layer) return;
    const flash = document.createElement('div');
    flash.className = 'clear-feedback-flash';
    layer.appendChild(flash);
    requestAnimationFrame(() => flash.classList.add('show'));
    setTimeout(() => flash.remove(), 280);
  }

  function speakClearFeedback(word, level) {
    if (!profile.sound || profile.volume <= 0 || !('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return;
    try {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = 'en-US';
      // Une diction légèrement ralentie mais avec un pitch plus haut donne
      // une impression de cri de victoire plutôt que de voix monotone.
      utterance.rate = level >= 4 ? .94 : level >= 3 ? .98 : 1.02;
      utterance.pitch = level >= 4 ? 1.22 : level === 3 ? 1.17 : 1.12;
      utterance.volume = profile.volume;
      const voices = synth.getVoices();
      const englishVoice = voices.find(voice => /^en(-|_)/i.test(voice.lang) && /Google|Samantha|Microsoft|Alex/i.test(voice.name))
        || voices.find(voice => /^en(-|_)/i.test(voice.lang));
      if (englishVoice) utterance.voice = englishVoice;
      synth.cancel();
      if (typeof synth.resume === 'function') synth.resume();
      synth.speak(utterance);
    } catch (_) {
      // Le bandeau, les particules et les sons restent actifs si la synthèse vocale est bloquée.
    }
  }

  function spawnScorePopup(text, type = 'place', cells = [], raised = false) {
    const layer = $('#fx-layer');
    if (!layer) return;
    const points = cells.length ? cells : [[Math.floor(geo.rows / 2), Math.floor(geo.cols / 2)]];
    const averageRow = points.reduce((sum, cell) => sum + cell[0], 0) / points.length;
    const averageCol = points.reduce((sum, cell) => sum + cell[1], 0) / points.length;
    const popup = document.createElement('span');
    popup.className = `score-pop ${type}${raised ? ' raised' : ''}`;
    popup.textContent = text;
    popup.style.left = `${clamp(((averageCol + .5) / geo.cols) * 100, 8, 92)}%`;
    popup.style.top = `${clamp(((averageRow + .5) / geo.rows) * 100, 12, 88)}%`;
    layer.appendChild(popup);
    setTimeout(() => popup.remove(), type === 'pulse' ? 1150 : 900);
  }

  function showRewardPopup(text, type = 'coins') {
    const layer = $('#reward-layer');
    if (!layer) return;
    const popup = document.createElement('span');
    popup.className = `reward-pop reward-${type}`;
    popup.textContent = text;
    layer.appendChild(popup);
    setTimeout(() => popup.remove(), 1100);
  }

  function retriggerClass(element, className) {
    if (!element) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  function triggerBoardImpact(type = 'place') {
    const boardWrap = $('#board-wrap');
    if (!boardWrap) return;
    boardWrap.classList.remove('impact-place', 'impact-clear', 'impact-pulse');
    void boardWrap.offsetWidth;
    boardWrap.classList.add(`impact-${type}`);
    setTimeout(() => boardWrap.classList.remove(`impact-${type}`), type === 'pulse' ? 520 : 300);
  }

  function showHighScoreFeedback(score) {
    const panel = $('#high-score-feedback');
    const value = $('#high-score-value');
    if (!panel || !value) return;
    value.textContent = formatNumber(score);
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.remove('show');
    void panel.offsetWidth;
    panel.classList.add('show');
    spawnFeedbackParticles(4);
    spawnFeedbackFlash();
    clearTimeout(state.highScoreTimer);
    state.highScoreTimer = setTimeout(() => {
      panel.classList.remove('show');
      panel.setAttribute('aria-hidden', 'true');
    }, 1900);
  }

  function showToast(message) {
    const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function toggleSound() {
    profile.sound = !profile.sound;
    saveProfile(); renderHome();
    showToast(profile.sound ? 'Effets sonores activés' : 'Effets sonores coupés');
    if (profile.sound) playSfx('button');
  }

  function toggleMusic() {
    profile.music = !profile.music;
    saveProfile(); renderHome();
    showToast(profile.music ? 'Musique d\u2019ambiance activée' : 'Musique coupée');
    if (profile.music) startMusic(); else stopMusic();
    if (profile.sound) playSfx('button');
  }

  function vibrate(pattern) {
    if (profile.haptics === false) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
    } catch (_) { /* vibration facultative */ }
  }

  /* =====================================================================
     AUDIO — moteur Web Audio
     Chaîne : voix → bus (sfx / musique) → master → compresseur → sortie,
     avec un envoi de réverbération (réponse impulsionnelle générée, aucun fichier).
     Les sons sont planifiés avec l'horloge audio (précis, sans setTimeout).
     ===================================================================== */
  let audioContext = null;
  let audioNodes = null;
  let activeVoices = 0;
  const MAX_VOICES = 36;
  const midiToHz = midi => 440 * Math.pow(2, (midi - 69) / 12);
  const PENTA = [0, 2, 4, 7, 9];
  const pentaMidi = (root, step) => root + PENTA[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5);

  function buildAudioGraph(context) {
    const master = context.createGain(); master.gain.value = .9;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -16; limiter.knee.value = 22; limiter.ratio.value = 5; limiter.attack.value = .004; limiter.release.value = .24;
    master.connect(limiter); limiter.connect(context.destination);
    const sfx = context.createGain(); sfx.connect(master);
    const music = context.createGain(); music.gain.value = 0; music.connect(master);
    // Réverbération : bruit stéréo à décroissance exponentielle (~1,3 s).
    const length = Math.floor(context.sampleRate * 1.3);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
    }
    const convolver = context.createConvolver(); convolver.buffer = impulse;
    const wet = context.createGain(); wet.gain.value = .34;
    const send = context.createGain();
    send.connect(convolver); convolver.connect(wet); wet.connect(master);
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const noiseData = noise.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
    return { master, sfx, music, send, noise };
  }

  function getAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!audioContext) { audioContext = new AudioContextClass(); audioNodes = buildAudioGraph(audioContext); }
      if (audioContext.state === 'suspended') {
        const resume = audioContext.resume();
        if (resume?.catch) resume.catch(() => {});
      }
      return audioContext;
    } catch (_) { return null; }
  }

  // Une voix : oscillateur(s) → filtre → enveloppe → pan → bus (+ réverbération).
  function voice(freq, start, duration, o = {}) {
    const context = audioContext; if (!context || !audioNodes || activeVoices >= MAX_VOICES) return;
    try {
      const peak = Math.max(.0008, (o.gain ?? .05) * (o.music ? 1 : profile.volume));
      const attack = o.attack ?? .006;
      const gain = context.createGain();
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + attack);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      let head = gain;
      if (o.pan !== undefined && context.createStereoPanner) { const pan = context.createStereoPanner(); pan.pan.value = o.pan; gain.connect(pan); head = pan; }
      head.connect(o.music ? audioNodes.music : audioNodes.sfx);
      if (o.reverb) { const rv = context.createGain(); rv.gain.value = o.reverb; head.connect(rv); rv.connect(audioNodes.send); }
      let input = gain;
      if (o.filter) {
        const filter = context.createBiquadFilter(); filter.type = o.filter.type || 'lowpass';
        filter.frequency.setValueAtTime(o.filter.freq, start); filter.Q.value = o.filter.q ?? .7;
        if (o.filter.to) filter.frequency.exponentialRampToValueAtTime(o.filter.to, start + duration);
        filter.connect(gain); input = filter;
      }
      const partials = o.partials || [[1, 1]];
      const oscillators = partials.map(([ratio, level]) => {
        const osc = context.createOscillator(); osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(freq * ratio, start);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to * ratio, start + duration);
        if (o.detune) osc.detune.value = o.detune * (ratio > 1 ? -1 : 1);
        if (level === 1) osc.connect(input);
        else { const lv = context.createGain(); lv.gain.value = level; osc.connect(lv); lv.connect(input); }
        osc.start(start); osc.stop(start + duration + .05);
        return osc;
      });
      activeVoices += 1;
      oscillators[0].onended = () => { activeVoices = Math.max(0, activeVoices - 1); };
    } catch (_) { /* audio facultatif */ }
  }

  // Cloche douce : fondamentale + harmoniques à décroissance rapide.
  const bell = (midi, start, o = {}) => voice(midiToHz(midi), start, o.dur ?? .55, { type: 'sine', gain: o.gain ?? .05, attack: .004, partials: [[1, 1], [2.01, .32], [3.98, .12]], reverb: o.reverb ?? .5, pan: o.pan });
  // Bruit filtré (souffle / impact).
  function noiseHit(start, duration, o = {}) {
    const context = audioContext; if (!context || !audioNodes) return;
    try {
      const source = context.createBufferSource(); source.buffer = audioNodes.noise; source.loop = true;
      const filter = context.createBiquadFilter(); filter.type = o.type || 'bandpass'; filter.Q.value = o.q ?? .9;
      filter.frequency.setValueAtTime(o.freq ?? 1800, start);
      if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, start + duration);
      const gain = context.createGain(); const peak = Math.max(.0008, (o.gain ?? .03) * profile.volume);
      gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(peak, start + (o.attack ?? .004)); gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      source.connect(filter); filter.connect(gain); gain.connect(audioNodes.sfx);
      if (o.reverb) { const rv = context.createGain(); rv.gain.value = o.reverb; gain.connect(rv); rv.connect(audioNodes.send); }
      source.start(start, Math.random() * .5); source.stop(start + duration + .05);
    } catch (_) { /* audio facultatif */ }
  }

  // Compatibilité : utilisé par la cinématique d'ouverture des packs (sons « tonals » simples).
  function playTone(freq, duration, o = {}) {
    if (!profile.sound || profile.volume <= 0) return;
    const context = getAudioContext(); if (!context || context.state === 'suspended') return;
    const harsh = o.type === 'square' || o.type === 'sawtooth';
    voice(freq, context.currentTime + .005, duration, { type: o.type || 'sine', gain: (o.gain || .04) * 1.1, to: o.to, attack: .004, reverb: .25, filter: harsh ? { freq: 2400 } : undefined });
  }

  function playSfx(name, level = 1) {
    if (!profile.sound || profile.volume <= 0) return;
    const context = getAudioContext(); if (!context || context.state === 'suspended') return;
    const t = context.currentTime + .005;
    const lv = clamp(level, 1, 4);
    switch (name) {
      case 'select': bell(81, t, { dur: .22, gain: .03, reverb: .2 }); break;
      case 'place':
        voice(190, t, .13, { type: 'sine', to: 78, gain: .075, attack: .003 });
        noiseHit(t, .05, { type: 'lowpass', freq: 2400, to: 500, gain: .035, q: .5 });
        bell(69 + (state.turn % 3) * 2, t + .02, { dur: .25, gain: .02, reverb: .25 });
        break;
      case 'error':
        voice(150, t, .13, { type: 'triangle', to: 105, gain: .05, filter: { freq: 700 } });
        voice(130, t + .09, .14, { type: 'triangle', to: 90, gain: .045, filter: { freq: 600 } });
        break;
      case 'clear': case 'multi-clear': {
        const root = 72; const count = name === 'multi-clear' ? 3 + lv : 3;
        noiseHit(t, .38, { type: 'bandpass', freq: 500, to: 5200, q: 1.2, gain: .028 + lv * .005, attack: .12, reverb: .35 });
        for (let i = 0; i < count; i++) bell(pentaMidi(root, i * 1) + (i > 4 ? 0 : 0), t + .04 + i * .055, { dur: .7, gain: .05 - i * .003, reverb: .6, pan: (i / Math.max(1, count - 1) - .5) * .6 });
        voice(midiToHz(root - 24), t, .3, { type: 'sine', to: midiToHz(root - 29), gain: .06 });
        break;
      }
      case 'combo': {
        const root = 74 + lv * 2;
        [0, 2, 4].forEach((step, i) => bell(pentaMidi(root, step + lv), t + .02 + i * .06, { dur: .5, gain: .04, reverb: .55 }));
        voice(midiToHz(root + 12), t + .2, .35, { type: 'triangle', gain: .02, partials: [[1, 1], [1.5, .4]], reverb: .6 });
        break;
      }
      case 'booster':
        voice(260, t, .32, { type: 'sawtooth', to: 880, gain: .032, filter: { freq: 500, to: 3200, q: 3 }, reverb: .3 });
        bell(88, t + .22, { dur: .5, gain: .04 }); bell(93, t + .3, { dur: .55, gain: .035 });
        break;
      case 'coins': [88, 93, 100].forEach((m, i) => bell(m, t + i * .06, { dur: .4, gain: .04, reverb: .3 })); break;
      case 'xp': [76, 79, 83, 88].forEach((m, i) => bell(m, t + i * .07, { dur: .5, gain: .035, reverb: .5 })); break;
      case 'unlock': [72, 76, 79, 84].forEach((m, i) => bell(m, t + i * .09, { dur: .9, gain: .045, reverb: .7 })); break;
      case 'purchase': bell(79, t, { dur: .3, gain: .045 }); bell(86, t + .08, { dur: .5, gain: .045 }); noiseHit(t + .1, .12, { type: 'highpass', freq: 5000, gain: .02 }); break;
      case 'record':
        [72, 76, 79, 84, 88].forEach((m, i) => bell(m, t + i * .1, { dur: 1.1, gain: .05, reverb: .8, pan: (i - 2) * .2 }));
        [48, 55].forEach(m => voice(midiToHz(m), t, 1.2, { type: 'triangle', gain: .04, attack: .05, filter: { freq: 600 }, reverb: .5 }));
        break;
      case 'gameOver':
        [69, 65, 62, 57].forEach((m, i) => voice(midiToHz(m), t + i * .16, .75, { type: 'triangle', gain: .05, attack: .02, filter: { freq: 1400, to: 400 }, reverb: .7 }));
        break;
      case 'morph':
        voice(180, t, .75, { type: 'sawtooth', to: 1200, gain: .028, filter: { freq: 400, to: 4200, q: 4 }, reverb: .5 });
        [76, 83, 88, 95].forEach((m, i) => bell(m, t + .35 + i * .08, { dur: .8, gain: .035, reverb: .7 }));
        break;
      case 'start': bell(72, t, { dur: .35, gain: .035 }); bell(79, t + .08, { dur: .5, gain: .04 }); break;
      case 'button': default: voice(1200, t, .06, { type: 'triangle', gain: .028, to: 900 });
    }
  }

  /* ----- Musique d'ambiance générative (nappes + arpèges pentatoniques) ----- */
  const MUSIC = {
    bpm: 68, timer: null, nextBar: 0, bar: 0,
    chords: [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]]
  };
  const musicTarget = () => clamp(profile.volume, 0, 1) * .55;
  function updateMusicVolume() {
    if (!audioContext || !audioNodes) return;
    audioNodes.music.gain.setTargetAtTime(profile.music ? musicTarget() : 0, audioContext.currentTime, .6);
  }
  function scheduleMusic() {
    const context = audioContext; if (!context || !profile.music) return;
    const beat = 60 / MUSIC.bpm; const barLength = beat * 4;
    if (MUSIC.nextBar < context.currentTime) MUSIC.nextBar = context.currentTime + .08;
    // Pendant un drag on ne planifie rien : le téléphone reste 100 % dédié au doigt.
    if (document.documentElement.classList.contains('is-dragging')) return;
    while (MUSIC.nextBar < context.currentTime + 1.6) {
      const start = MUSIC.nextBar; const chord = MUSIC.chords[MUSIC.bar % MUSIC.chords.length];
      chord.forEach((m, i) => voice(midiToHz(m + (i === 0 ? -12 : 0)), start, barLength + 1.2, { type: i === 0 ? 'sine' : 'triangle', gain: i === 0 ? .05 : .026, attack: 1.1, filter: { freq: 900, q: .5 }, detune: i * 3, music: true, reverb: .4 }));
      for (let step = 0; step < 8; step++) {
        if (Math.random() < .5) {
          const note = pentaMidi(69, Math.floor(Math.random() * 7) - 1);
          voice(midiToHz(note + 12), start + step * beat / 2, 1.1, { type: 'sine', gain: .028, attack: .01, partials: [[1, 1], [2.01, .25]], music: true, reverb: .9, pan: Math.random() - .5 });
        }
      }
      MUSIC.nextBar += barLength; MUSIC.bar += 1;
    }
  }
  function startMusic() {
    if (!profile.music) return;
    const context = getAudioContext(); if (!context) return;
    updateMusicVolume();
    if (MUSIC.timer) return;
    MUSIC.nextBar = context.currentTime + .1;
    scheduleMusic(); MUSIC.timer = setInterval(scheduleMusic, 300);
  }
  function stopMusic() {
    if (MUSIC.timer) { clearInterval(MUSIC.timer); MUSIC.timer = null; }
    updateMusicVolume();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (MUSIC.timer) { clearInterval(MUSIC.timer); MUSIC.timer = null; } audioContext?.suspend?.().catch?.(() => {}); }
    else if (profile.music && profile.sound !== undefined) { getAudioContext(); startMusic(); }
  });


  /* =====================================================================
     SHAPES — runtime : progression, maîtrise, écrans, transition
     ===================================================================== */
  const shapeDef = id => SHAPE_BOARDS.find(board => board.id === id) || SHAPE_BOARDS[0];
  const shapeIndexOf = id => Math.max(0, SHAPE_BOARDS.findIndex(board => board.id === id));
  const shapesProgress = (id = geo.id) => profile.shapes.boards[id] || (profile.shapes.boards[id] = defaultBoardProgress());
  // Statistiques et record dépendent du mode : rien n'est mélangé entre Classic et Shapes.
  const modeStats = () => (state.mode === 'shapes' ? profile.shapes.stats : profile.stats);
  const getBest = () => (state.mode === 'shapes' ? shapesProgress().bestScore : profile.best);
  const isShapeUnlocked = id => {
    const index = shapeIndexOf(id);
    return index === 0 || profile.shapes.boards[SHAPE_BOARDS[index - 1].id]?.mastered === true;
  };
  const suggestedShapesBoard = () => {
    const open = SHAPE_BOARDS.find(board => isShapeUnlocked(board.id) && !profile.shapes.boards[board.id].mastered);
    return open ? open.id : profile.shapes.current;
  };

  // Objectifs de maîtrise d'un plateau : cumulés (lignes, spéciales) ou records (combo, score).
  // Ils reprennent les systèmes déjà présents dans le jeu (lignes, combos, score) et ajoutent
  // un objectif propre à chaque géométrie (lignes longues, diagonales, bords, zones…).
  function shapeObjectives(def, prog, live = null) {
    const m = def.mastery;
    const score = Math.max(prog.bestScore, live ? live.score : 0);
    const list = [
      { key: 'lines', label: 'Lignes dissoutes', value: prog.lines, target: m.lines },
      { key: 'combo', label: 'Meilleur combo', value: prog.bestCombo, target: m.combo, prefix: '×' },
      { key: 'score', label: 'Score en une partie', value: score, target: m.score }
    ];
    if (m.special) list.push({ key: 'special', label: def.specialLabel || 'Lignes spéciales', value: prog.special, target: m.special });
    return list;
  }
  function shapeMasteryPct(def, prog, live = null) {
    if (prog.mastered) return 100;
    const objectives = shapeObjectives(def, prog, live);
    const ratio = objectives.reduce((sum, o) => sum + clamp(o.value / o.target, 0, 1), 0) / objectives.length;
    return Math.min(99, Math.floor(ratio * 100));
  }
  function objectivesHTML(def, prog, live = null) {
    return `<div class="objectives">${shapeObjectives(def, prog, live).map(o => {
      const done = o.value >= o.target;
      const shown = Math.min(o.value, o.target);
      const prefix = o.prefix || '';
      return `<div class="obj${done ? ' done' : ''}"><div class="obj-row"><span>${done ? '✓ ' : ''}${o.label}</span><b>${prefix}${formatNumber(shown)} / ${prefix}${formatNumber(o.target)}</b></div><div class="mini-progress"><span style="width:${clamp(o.value / o.target * 100, 0, 100)}%"></span></div></div>`;
    }).join('')}</div>`;
  }

  // Aperçu miniature d'une géométrie (cases existantes uniquement).
  function shapeMiniHTML(def, extraClass = '') {
    const g = getGeometry(def);
    let cells = '';
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) cells += `<i${g.mask[r][c] ? ' class="on"' : ''}></i>`;
    return `<span class="shape-mini ${extraClass}" style="--sm-cols:${g.cols};--sm-rows:${g.rows};--sm-max:${Math.max(g.rows, g.cols)};--sm-accent:${def.accent}">${cells}</span>`;
  }

  // Transformation réelle d'un plateau en un autre : chaque case apparaît / disparaît / change de couleur.
  function shapeMorphHTML(fromDef, toDef) {
    const a = getGeometry(fromDef); const b = getGeometry(toDef);
    const rows = Math.max(a.rows, b.rows); const cols = Math.max(a.cols, b.cols);
    const offA = [Math.floor((rows - a.rows) / 2), Math.floor((cols - a.cols) / 2)];
    const offB = [Math.floor((rows - b.rows) / 2), Math.floor((cols - b.cols) / 2)];
    const inGeo = (g, off, r, c) => { const rr = r - off[0]; const cc = c - off[1]; return rr >= 0 && cc >= 0 && rr < g.rows && cc < g.cols && g.mask[rr][cc]; };
    let cells = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const inA = inGeo(a, offA, r, c); const inB = inGeo(b, offB, r, c);
      const dist = Math.hypot(r - (rows - 1) / 2, c - (cols - 1) / 2);
      cells += `<i class="${inA ? 'a ' : ''}${inB ? 'b' : ''}" style="--d:${Math.round(dist * 55)}ms"></i>`;
    }
    return `<div class="morph-stage" style="--mm-cols:${cols};--mm-rows:${rows};--mm-max:${Math.max(rows, cols)};--ma:${fromDef.accent};--mb:${toDef.accent}">${cells}</div>`;
  }

  /* ----- Géométrie active + mise en page dynamique du plateau ----- */
  function activateBoard(mode, boardId) {
    const def = mode === 'shapes' ? shapeDef(boardId) : CLASSIC_DEF;
    geo = getGeometry(def);
    state.boardMetricsCache = null;
    applyBoardLayout();
  }

  // La grille DOM reste rectangulaire (le drag n'en dépend pas) ; seule la taille et le ratio changent.
  // Tout est calculé à partir de rows/cols : aucune coordonnée fixe.
  function applyBoardLayout() {
    const wrap = $('#board-wrap'); const board = $('#board');
    if (!wrap || !board) return;
    const shaped = state.mode === 'shapes';
    const { rows, cols } = geo;
    if (shaped) {
      wrap.style.setProperty('--bar', `${cols} / ${rows}`);
      wrap.style.setProperty('--bk', String(cols >= rows ? 1 : +(cols / rows).toFixed(4)));
      wrap.style.setProperty('--shape-accent', geo.def.accent);
      wrap.dataset.shape = geo.id;
    } else {
      wrap.style.removeProperty('--bar'); wrap.style.removeProperty('--bk'); wrap.style.removeProperty('--shape-accent');
      delete wrap.dataset.shape;
    }
    wrap.classList.toggle('shaped', shaped && !geo.full);
    board.style.setProperty('--cols', cols);
    board.style.setProperty('--rows', rows);
    state.boardMetricsCache = null;
  }

  function renderShapeHud() {
    const hud = $('#shape-hud'); if (!hud) return;
    const shaped = state.mode === 'shapes';
    hud.classList.toggle('hidden', !shaped);
    if (!shaped) return;
    const def = shapeDef(geo.id);
    const pct = shapeMasteryPct(def, shapesProgress(), { score: state.score });
    hud.style.setProperty('--shape-accent', def.accent);
    $('#shape-hud-icon').textContent = def.icon;
    $('#shape-hud-name').textContent = def.name.toUpperCase();
    $('#shape-hud-fill').style.width = `${pct}%`;
    $('#shape-hud-pct').textContent = `${pct}%`;
  }

  /* ----- Progression : appelée à chaque coup, avant la fin de tour ----- */
  function trackShapesProgress(completed) {
    if (state.mode !== 'shapes') return;
    const def = shapeDef(geo.id); const prog = shapesProgress();
    if (completed && completed.count) {
      prog.lines += completed.count;
      prog.special += completed.lines.filter(line => line.special).length;
      prog.bestCombo = Math.max(prog.bestCombo, state.combo);
    }
    prog.bestScore = Math.max(prog.bestScore, state.score);
    if (!prog.mastered && shapeObjectives(def, prog).every(o => o.value >= o.target)) {
      prog.mastered = true;
      profile.coins += def.reward.coins;
      const levels = addXp(def.reward.xp);
      const next = SHAPE_BOARDS[shapeIndexOf(def.id) + 1] || null;
      state.pendingMastery = def.id;
      state.masteryNext = next ? next.id : null;
      state.masteryReward = { coins: def.reward.coins, xp: def.reward.xp, levels };
      saveProfile();
      if (state.gameActive) {
        setTimeout(() => { if (state.gameActive && state.pendingMastery === def.id) showMasteryCelebration(); }, 950);
      }
    }
  }

  /* ----- Plateau maîtrisé : transition + découverte de la forme suivante ----- */
  function showMasteryCelebration() {
    const id = state.pendingMastery; if (!id) return;
    const def = shapeDef(id);
    const next = state.masteryNext ? shapeDef(state.masteryNext) : null;
    const reward = state.masteryReward || def.reward;
    const live = state.gameActive;
    state.pendingMastery = null;
    cancelDrag();
    state.paused = true;
    const stage = next ? shapeMorphHTML(def, next) : `<div class="intro-shape">${shapeMiniHTML(def, 'big')}</div>`;
    const reveal = next
      ? `<div class="morph-reveal"><small>NOUVEAU PLATEAU</small><strong>${next.name.toUpperCase()}</strong><p>${next.rule}</p></div>`
      : `<div class="morph-reveal"><small>BRAVO</small><strong>TOUTES LES FORMES</strong><p>Tu as maîtrisé tous les plateaux disponibles. De nouvelles géométries arriveront bientôt.</p></div>`;
    const recap = live ? '' : `<div class="result-score"><span>SCORE</span><strong>${formatNumber(state.score)}</strong></div>`;
    const actions = live
      ? `<button class="secondary" data-action="close-modal">CONTINUER</button>${next ? `<button class="primary" data-action="shapes-next">DÉCOUVRIR →</button>` : `<button class="primary" data-action="close-modal">SUPER !</button>`}`
      : `<button class="secondary" data-action="go-home">ACCUEIL</button><button class="secondary" data-action="restart">REJOUER</button>${next ? `<button class="primary" data-action="shapes-next">SUIVANT →</button>` : ''}`;
    openModal(`<span class="modal-kicker record-kicker">PLATEAU MAÎTRISÉ</span><h2>${def.name} ✓</h2>${stage}${recap}<div class="reward-row"><div>◆ ${reward.coins}<span>PulseCoins</span></div><div>✦ ${reward.xp}<span>XP gagnés</span></div></div>${reveal}<div class="modal-actions">${actions}</div>`, 'mastery-modal');
    setTimeout(() => $('#modal-card .morph-stage')?.classList.add('go'), 750);
    renderShapesHome();
    playSfx('record'); setTimeout(() => playSfx('morph'), 700); setTimeout(() => playSfx('unlock'), 1500);
    vibrate([28, 14, 52]); setTimeout(() => vibrate([14, 10, 14, 10, 30]), 750);
  }

  function startNextShapesBoard() {
    const nextId = state.masteryNext || SHAPE_BOARDS[Math.min(SHAPE_BOARDS.length - 1, shapeIndexOf(geo.id) + 1)].id;
    closeModal();
    if (state.gameActive) endGame({ silent: true });
    shapesProgress(nextId).seen = true;
    startNewGame('shapes', nextId);
  }

  function openBoardIntro(def) {
    state.paused = true;
    openModal(`<span class="modal-kicker">NOUVEAU PLATEAU</span><div class="intro-shape">${shapeMiniHTML(def, 'big')}</div><h2>${def.name}</h2><p>${def.rule}</p>${objectivesHTML(def, shapesProgress(def.id))}<div class="modal-actions"><button class="primary" data-action="close-modal">JOUER</button></div>`, 'intro-modal');
  }

  function shapesEndBlock() {
    if (state.mode !== 'shapes') return '';
    const def = shapeDef(geo.id); const prog = shapesProgress(def.id);
    const pct = shapeMasteryPct(def, prog);
    return `<div class="end-shape"><div class="row-between"><span>${def.icon} ${def.name.toUpperCase()} · maîtrise</span><b>${pct} %</b></div>${objectivesHTML(def, prog)}</div>`;
  }

  /* ----- Écrans ----- */
  function renderShapesHome() {
    const card = $('#shapes-card'); if (!card) return;
    const def = shapeDef(suggestedShapesBoard());
    const prog = shapesProgress(def.id);
    const pct = shapeMasteryPct(def, prog);
    const mastered = SHAPE_BOARDS.filter(board => profile.shapes.boards[board.id]?.mastered).length;
    card.style.setProperty('--world-accent', def.accent);
    $('#shapes-card-visual').innerHTML = shapeMiniHTML(def, 'card');
    $('#shapes-card-board').textContent = `${def.icon} ${def.name.toUpperCase()}`;
    $('#shapes-card-pct').textContent = `${pct} %`;
    $('#shapes-card-fill').style.width = `${pct}%`;
    $('#shapes-card-text').textContent = `${mastered} / ${SHAPE_BOARDS.length} plateaux maîtrisés · ${def.tagline}`;
  }

  function renderShapes() {
    const root = $('#shapes-content'); if (!root) return;
    const masteredCount = SHAPE_BOARDS.filter(board => profile.shapes.boards[board.id].mastered).length;
    const globalPct = Math.round(masteredCount / SHAPE_BOARDS.length * 100);
    const suggested = suggestedShapesBoard();
    const intro = `<article class="shapes-intro"><span class="eyebrow accent">PARCOURS DES FORMES</span><h2>${masteredCount} / ${SHAPE_BOARDS.length} plateaux maîtrisés</h2><p>Remplis les objectifs d'un plateau pour le maîtriser et débloquer la forme suivante.</p><div class="mini-progress"><span style="width:${globalPct}%"></span></div></article>`;
    const cards = SHAPE_BOARDS.map((def, index) => {
      const prog = profile.shapes.boards[def.id];
      const unlocked = isShapeUnlocked(def.id);
      const pct = shapeMasteryPct(def, prog);
      const status = prog.mastered ? 'mastered' : !unlocked ? 'locked' : def.id === suggested ? 'current' : 'open';
      const badge = prog.mastered ? '✓ MAÎTRISÉ' : !unlocked ? 'VERROUILLÉ' : def.id === suggested ? 'EN COURS' : 'DISPONIBLE';
      const previous = SHAPE_BOARDS[index - 1];
      const body = unlocked
        ? `<p class="world-rule">${def.rule}</p>${objectivesHTML(def, prog)}<div class="world-actions"><button class="primary-button" data-action="play-shapes" data-shape-id="${def.id}"><span>${prog.mastered ? 'REJOUER' : 'JOUER'}</span><b><svg class="ico" aria-hidden="true"><use href="#i-arrow"/></svg></b></button></div>`
        : `<p class="world-lock">Maîtrise le plateau <b>${previous.name}</b> (100 %) pour débloquer cette forme.</p><p class="world-rule faint">${def.specialLabel ? `Nouveauté : ${def.specialLabel.toLowerCase()}.` : def.tagline}</p>`;
      return `<article class="world-card ${status}" style="--world-accent:${def.accent}" data-shape-id="${def.id}"><div class="world-head">${shapeMiniHTML(def)}<div class="world-title"><span class="eyebrow">PLATEAU ${index + 1} · ${def.tagline.toUpperCase()}</span><strong>${def.name}</strong></div><span class="world-badge">${badge}</span></div><div class="world-progress"><div class="mini-progress"><span style="width:${pct}%"></span></div><b>${pct} %</b></div>${body}</article>`;
    });
    root.innerHTML = intro + cards.join('<div class="world-link" aria-hidden="true"></div>');
  }

  function shapesStatsHTML() {
    const s = profile.shapes.stats;
    const mastered = SHAPE_BOARDS.filter(board => profile.shapes.boards[board.id].mastered).length;
    const bests = SHAPE_BOARDS.filter(board => isShapeUnlocked(board.id)).map(board => `<div class="shape-best"><span>${board.icon} ${board.name}</span><b>${formatNumber(profile.shapes.boards[board.id].bestScore)}</b></div>`).join('');
    return `<div class="section-heading"><h2>Shapes</h2><span class="section-line"></span></div><div class="stats-grid"><article class="stat-box"><span>Plateaux maîtrisés</span><strong>${mastered} / ${SHAPE_BOARDS.length}</strong><em>progression Shapes</em></article><article class="stat-box"><span>Parties jouées</span><strong>${formatNumber(s.games)}</strong><em>mode Shapes</em></article><article class="stat-box"><span>Lignes dissoutes</span><strong>${formatNumber(s.totalLines)}</strong><em>total cumulé</em></article><article class="stat-box"><span>Meilleur combo</span><strong>×${formatNumber(s.bestCombo)}</strong><em>chaîne maximale</em></article></div><div class="shape-bests">${bests}</div>`;
  }


  /* =====================================================================
     Reprise de partie + bonus quotidien
     ===================================================================== */
  function snapshotRun() {
    return {
      mode: state.mode, boardId: geo.id, at: Date.now(),
      board: state.board.map(row => row.map(cell => (cell ? cell.piece : null))),
      queue: state.queue.map(piece => (piece ? piece.id : null)),
      score: state.score, lines: state.lines, combo: state.combo, turn: state.turn, charge: state.charge,
      pulseBursts: state.pulseBursts, bestComboInGame: state.bestComboInGame, bestAtStart: state.bestAtStart
    };
  }
  function validRun(run) {
    if (!run || (run.mode !== 'classic' && run.mode !== 'shapes')) return false;
    if (run.mode === 'shapes' && (!SHAPE_BOARDS.some(b => b.id === run.boardId) || !isShapeUnlocked(run.boardId))) return false;
    const g = getGeometry(run.mode === 'shapes' ? shapeDef(run.boardId) : CLASSIC_DEF);
    if (run.board.length !== g.rows || !run.board.every(row => Array.isArray(row) && row.length === g.cols)) return false;
    if (!run.board.every((row, r) => row.every((id, c) => id === null || (SHAPE_BY_ID[id] && g.mask[r][c])))) return false;
    return run.queue.length === QUEUE_SIZE;
  }
  function resumeRun() {
    const run = profile.run;
    if (!validRun(run)) { profile.run = null; saveProfile(); renderHome(); showToast('Cette partie ne peut pas être reprise.'); return; }
    startNewGame(run.mode, run.boardId);
    state.board = run.board.map(row => row.map(id => (id ? { piece: id, color: getPieceColor(id) } : null)));
    state.queue = run.queue.map(id => (id && SHAPE_BY_ID[id] ? makePiece(SHAPE_BY_ID[id]) : null));
    if (state.queue.every(piece => !piece)) state.queue = generateQueue();
    ['score', 'lines', 'combo', 'turn', 'charge', 'pulseBursts', 'bestComboInGame', 'bestAtStart'].forEach(key => { state[key] = Number(run[key]) || 0; });
    state.recordAnnounced = state.bestAtStart > 0 && state.score > state.bestAtStart;
    renderBoard(); renderTray(); renderHud(); renderBoosters(); animateTrayArrival();
    $('#game-message').textContent = 'Partie reprise. À toi de jouer.';
    profile.run = snapshotRun(); saveProfile();
  }

  const DAILY_REWARDS = [30, 40, 50, 60, 80, 100, 160];
  const dateKeyOffset = days => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function dailyStatus() {
    const claimed = profile.daily.last === dateKey();
    const day = claimed ? profile.daily.streak : (profile.daily.last === dateKeyOffset(-1) ? profile.daily.streak + 1 : 1);
    return { claimed, day, reward: DAILY_REWARDS[(day - 1) % DAILY_REWARDS.length] };
  }
  function claimDaily() {
    const status = dailyStatus(); if (status.claimed) return;
    profile.daily = { last: dateKey(), streak: status.day };
    profile.coins += status.reward; checkAchievements();
    saveProfile(); renderHome();
    showRewardPopup(`+${status.reward} ◆`, 'coins'); playSfx('coins'); vibrate([14, 10, 24]);
  }
  function renderHomeExtras() {
    const resume = $('#resume-card');
    if (resume) {
      const run = validRun(profile.run) ? profile.run : null;
      resume.classList.toggle('hidden', !run);
      if (run) {
        const label = run.mode === 'shapes' ? `SHAPES · ${shapeDef(run.boardId).name.toUpperCase()}` : 'CLASSIC';
        $('#resume-card-text').textContent = `${label} · ${formatNumber(run.score)} pts`;
      }
    }
    const daily = $('#daily-bonus');
    if (daily) {
      const s = dailyStatus();
      daily.classList.toggle('claimed', s.claimed);
      $('#daily-bonus-title').textContent = s.claimed ? `Série de ${s.day} jour${s.day > 1 ? 's' : ''}` : `Jour ${s.day} · +${s.reward} ◆`;
      $('#daily-bonus-text').textContent = s.claimed ? 'Reviens demain pour continuer ta série.' : 'Connexion quotidienne : plus la série est longue, plus c\u2019est généreux.';
      const button = $('#daily-bonus-button'); button.textContent = s.claimed ? '✓' : 'RÉCUPÉRER'; button.disabled = s.claimed;
    }
    const themeLabel = $('#theme-label'); if (themeLabel) themeLabel.textContent = profile.ui === 'dark' ? 'SOMBRE' : 'CLAIR';
    const hapticLabel = $('#haptics-label'); if (hapticLabel) hapticLabel.textContent = profile.haptics ? 'ON' : 'OFF';
  }

  /* =====================================================================
     PARAMÈTRES : affichage, export / import, réinitialisations
     ===================================================================== */
  function renderSettings() {
    const pressed = { 'toggle-theme': profile.ui !== 'dark', 'toggle-haptics': profile.haptics, 'toggle-motion': profile.reduceMotion, 'toggle-tip': profile.showTip };
    Object.entries(pressed).forEach(([action, value]) => $$(`[data-action="${action}"]`).forEach(button => button.setAttribute('aria-pressed', String(Boolean(value)))));
    const motion = $('#motion-label'); if (motion) motion.textContent = profile.reduceMotion ? 'ON' : 'OFF';
    const tip = $('#tip-label'); if (tip) tip.textContent = profile.showTip ? 'ON' : 'OFF';
    renderHomeExtras();
    const version = $('#settings-version'); if (version) version.textContent = APP_VERSION;
    renderInstall();
    const summary = $('#settings-summary');
    if (summary) summary.textContent = `Niveau ${profile.level} · ${formatNumber(profile.coins)} ◆ · ${profile.stats.games + profile.shapes.stats.games} parties jouées`;
  }

  // Tout ce qui dépend du profil est redessiné d'un coup (import ou réinitialisation).
  function refreshAll() {
    cancelDrag(); closeModal();
    state.reviveOffer = false;
    state.gameActive = false; state.paused = false; state.resolving = false; state.activeBooster = null; state.selectedPiece = null;
    applyTheme(); renderHome(); renderMissions(); renderShop(); renderCollection(); renderStats(); renderProgression(); renderShapes(); renderSettings(); renderTrophies();
    updateMusicVolume();
    if (profile.music) startMusic(); else stopMusic();
    try { onlineSyncSoon(800); } catch (_) { /* rien */ }
  }

  function saveText() { return JSON.stringify({ ...profile, run: null, exportedAt: new Date().toISOString(), app: 'pulse-grid', version: APP_VERSION }); }

  function exportSave() {
    try {
      const blob = new Blob([saveText()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `pulse-grid-sauvegarde-${dateKey()}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast('Sauvegarde exportée.'); playSfx('purchase'); vibrate(12);
    } catch (_) { showToast('Export impossible sur ce navigateur. Essaie « Copier ».'); }
  }

  function copySave() {
    const text = saveText();
    const done = () => { showToast('Sauvegarde copiée dans le presse-papiers.'); playSfx('purchase'); vibrate(12); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => showToast('Copie refusée par le navigateur.'));
    else showToast('Copie impossible ici. Utilise « Exporter ».');
  }

  // Une sauvegarde importée est validée puis normalisée par loadProfile() : tout champ manquant reçoit sa valeur par défaut.
  function importSave(text) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
    const looksRight = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ['coins', 'best', 'level', 'xp', 'unlocked'].some(key => key in parsed);
    if (!looksRight) { showToast('Ce fichier n\u2019est pas une sauvegarde Pulse Grid.'); playSfx('error'); return false; }
    delete parsed.run;
    let previous = null;
    try { previous = localStorage.getItem(SAVE_KEY); localStorage.setItem(SAVE_KEY, JSON.stringify(parsed)); } catch (_) { showToast('Import impossible : stockage indisponible.'); return false; }
    try { profile = loadProfile(); } catch (_) {
      try { if (previous !== null) localStorage.setItem(SAVE_KEY, previous); } catch (__) { /* rien */ }
      profile = loadProfile(); showToast('Sauvegarde illisible, rien n\u2019a changé.'); return false;
    }
    refreshAll(); profile.run = null; saveProfile(); showToast('Sauvegarde importée.'); playSfx('unlock'); vibrate([14, 10, 24]);
    return true;
  }

  const RESET_COPY = {
    classic: { title: 'Remettre Classic à zéro ?', text: 'Ton meilleur score et les statistiques Classic seront effacés. Niveau, pièces, objets et progression Shapes sont conservés.' },
    shapes: { title: 'Remettre Shapes à zéro ?', text: 'Tous les plateaux redeviennent verrouillés sauf le carré. Niveau, pièces, objets et record Classic sont conservés.' },
    all: { title: 'Tout effacer ?', text: 'Niveau, pièces, objets, missions, records et progression seront définitivement supprimés. Pense à exporter ta sauvegarde avant.' }
  };
  function askReset(scope) {
    const copy = RESET_COPY[scope]; if (!copy) return;
    openModal(`<span class="modal-kicker confirm-warn">ATTENTION</span><h2>${copy.title}</h2><p>${copy.text}</p><div class="modal-actions"><button class="secondary" data-action="close-modal">ANNULER</button><button class="primary" data-action="confirm-reset" data-scope="${scope}">CONFIRMER</button></div>`);
  }
  function doReset(scope) {
    if (!RESET_COPY[scope]) return;
    if (scope === 'all') {
      try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* rien */ }
      profile = loadProfile();
    } else if (scope === 'classic') {
      profile.best = 0; profile.stats = { ...DEFAULT_STATS };
      if (profile.run?.mode === 'classic') profile.run = null;
    } else {
      profile.shapes = defaultShapes(); profile.shapes = normalizeShapes(profile.shapes);
      if (profile.run?.mode === 'shapes') profile.run = null;
    }
    refreshAll(); saveProfile();
    showToast(scope === 'all' ? 'Toutes les données ont été effacées.' : scope === 'classic' ? 'Classic remis à zéro.' : 'Shapes remis à zéro.');
    playSfx('button'); vibrate(14);
  }

  /* =====================================================================
     TROPHÉES
     ===================================================================== */
  const totalOf = key => (profile.stats[key] || 0) + (profile.shapes.stats[key] || 0);
  const bestScoreAll = () => Math.max(profile.best, ...SHAPE_BOARDS.map(b => profile.shapes.boards[b.id]?.bestScore || 0));
  const masteredCount = () => SHAPE_BOARDS.filter(b => profile.shapes.boards[b.id]?.mastered).length;
  const ACHIEVEMENTS = [
    { id: 'games-1', icon: 'play', name: 'Premiers pas', desc: 'Termine 1 partie', target: 1, reward: 30, value: () => totalOf('games') },
    { id: 'games-10', icon: 'play', name: 'Habitué', desc: 'Termine 10 parties', target: 10, reward: 60, value: () => totalOf('games') },
    { id: 'games-50', icon: 'play', name: 'Accro', desc: 'Termine 50 parties', target: 50, reward: 200, value: () => totalOf('games') },
    { id: 'lines-25', icon: 'rows', name: 'Premières lignes', desc: 'Dissous 25 lignes', target: 25, reward: 40, value: () => totalOf('totalLines') },
    { id: 'lines-250', icon: 'rows', name: 'Démolisseur', desc: 'Dissous 250 lignes', target: 250, reward: 120, value: () => totalOf('totalLines') },
    { id: 'lines-1000', icon: 'rows', name: 'Architecte', desc: 'Dissous 1 000 lignes', target: 1000, reward: 400, value: () => totalOf('totalLines') },
    { id: 'combo-3', icon: 'flame', name: 'En chaîne', desc: 'Atteins un combo ×3', target: 3, reward: 50, value: () => Math.max(profile.stats.bestCombo, profile.shapes.stats.bestCombo) },
    { id: 'combo-5', icon: 'bolt', name: 'Électrique', desc: 'Atteins un combo ×5', target: 5, reward: 120, value: () => Math.max(profile.stats.bestCombo, profile.shapes.stats.bestCombo) },
    { id: 'combo-8', icon: 'flame', name: 'Inarrêtable', desc: 'Atteins un combo ×8', target: 8, reward: 300, value: () => Math.max(profile.stats.bestCombo, profile.shapes.stats.bestCombo) },
    { id: 'score-2000', icon: 'star', name: 'Bon départ', desc: 'Score de 2 000 en une partie', target: 2000, reward: 50, value: bestScoreAll },
    { id: 'score-10000', icon: 'star', name: 'Virtuose', desc: 'Score de 10 000 en une partie', target: 10000, reward: 200, value: bestScoreAll },
    { id: 'score-30000', icon: 'crown', name: 'Légende', desc: 'Score de 30 000 en une partie', target: 30000, reward: 500, value: bestScoreAll },
    { id: 'pulse-1', icon: 'bolt', name: 'Surcharge', desc: 'Déclenche 1 Pulse Burst', target: 1, reward: 50, value: () => totalOf('pulseBursts') },
    { id: 'pulse-10', icon: 'bolt', name: 'Réacteur', desc: 'Déclenche 10 Pulse Bursts', target: 10, reward: 180, value: () => totalOf('pulseBursts') },
    { id: 'perfect-1', icon: 'target', name: 'Plateau vide', desc: 'Vide entièrement le plateau', target: 1, reward: 100, value: () => totalOf('perfectClears') },
    { id: 'shape-1', icon: 'shapes', name: 'Explorateur', desc: 'Maîtrise 1 plateau Shapes', target: 1, reward: 100, value: masteredCount },
    { id: 'shape-3', icon: 'shapes', name: 'Géomètre', desc: 'Maîtrise 3 plateaux Shapes', target: 3, reward: 250, value: masteredCount },
    { id: 'shape-5', icon: 'shapes', name: 'Maître des formes', desc: 'Maîtrise 5 plateaux Shapes', target: 5, reward: 600, value: masteredCount },
    { id: 'level-5', icon: 'trend', name: 'Niveau 5', desc: 'Atteins le niveau 5', target: 5, reward: 80, value: () => profile.level },
    { id: 'level-15', icon: 'trend', name: 'Niveau 15', desc: 'Atteins le niveau 15', target: 15, reward: 300, value: () => profile.level },
    { id: 'streak-3', icon: 'calendar', name: 'Fidèle', desc: '3 jours de suite', target: 3, reward: 60, value: () => profile.daily.streak },
    { id: 'streak-7', icon: 'calendar', name: 'Semaine parfaite', desc: '7 jours de suite', target: 7, reward: 200, value: () => profile.daily.streak },
    { id: 'booster-10', icon: 'box', name: 'Stratège', desc: 'Utilise 10 bonus', target: 10, reward: 70, value: () => totalOf('boostersUsed') }
  ];
  const achValue = id => { const a = ACHIEVEMENTS.find(item => item.id === id); return a ? a.value() : 0; };
  let trophyQueue = []; let trophyTimer = null;

  function checkAchievements() {
    let changed = false;
    ACHIEVEMENTS.forEach(a => {
      if (profile.achievements[a.id] || a.value() < a.target) return;
      profile.achievements[a.id] = Date.now(); profile.coins += a.reward; changed = true;
      trophyQueue.push(a);
    });
    if (changed) { saveProfileSoon(); pumpTrophyQueue(); renderTrophyCount(); }
    return changed;
  }
  const saveProfileSoon = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(profile)); } catch (_) { /* rien */ } };
  function pumpTrophyQueue() {
    if (trophyTimer || !trophyQueue.length) return;
    const a = trophyQueue.shift();
    trophyTimer = setTimeout(() => {
      showToast(`Trophée débloqué : ${a.name} · +${a.reward} ◆`); playSfx('unlock'); vibrate([16, 10, 28]);
      if (state.screen === 'trophies') renderTrophies();
      trophyTimer = setTimeout(() => { trophyTimer = null; pumpTrophyQueue(); }, 2600);
    }, 900);
  }
  function renderTrophyCount() {
    const el = $('#home-trophy-count'); if (el) el.textContent = `${Object.keys(profile.achievements).length} / ${ACHIEVEMENTS.length}`;
  }
  function renderTrophies() {
    const root = $('#trophies-content'); if (!root) return;
    const done = ACHIEVEMENTS.filter(a => profile.achievements[a.id]).length;
    const pct = Math.round(done / ACHIEVEMENTS.length * 100);
    const sorted = [...ACHIEVEMENTS].sort((a, b) => (profile.achievements[b.id] ? 1 : 0) - (profile.achievements[a.id] ? 1 : 0) || 0);
    root.innerHTML = `<article class="shapes-intro"><span class="eyebrow accent">COLLECTION</span><h2>${done} / ${ACHIEVEMENTS.length} trophées</h2><p>Chaque trophée débloqué rapporte des PulseCoins automatiquement.</p><div class="mini-progress"><span style="width:${pct}%"></span></div></article><div class="trophy-list">${
      sorted.map(a => {
        const got = Boolean(profile.achievements[a.id]); const v = Math.min(a.value(), a.target);
        return `<article class="trophy-card${got ? ' got' : ''}"><div class="trophy-icon"><svg class="ico" aria-hidden="true"><use href="#i-${a.icon}"/></svg></div><div class="trophy-main"><strong>${a.name}</strong><small>${a.desc}</small>${got ? '' : `<div class="mini-progress"><span style="width:${v / a.target * 100}%"></span></div>`}</div><div class="trophy-reward">${got ? '✓' : `◆ ${a.reward}`}</div></article>`;
      }).join('')}</div>`;
  }

  /* =====================================================================
     TUTORIEL (1re partie) — rejouable depuis les Paramètres
     ===================================================================== */
  const tutoGrid = rows => `<div class="tuto-grid" style="--tg:${rows[0].length}">${rows.map(row => [...row].map(ch => `<i class="tg-${ch === '.' ? 'e' : ch}"></i>`).join('')).join('')}</div>`;
  const TUTORIAL = [
    { title: 'Glisse les fragments', text: 'Prends un fragment en bas, fais-le glisser sur la grille et relâche pour le poser. Tu peux aussi le toucher, puis toucher la grille.', art: tutoGrid(['.....', '.aa..', '.a...', '.....', '...b.']) },
    { title: 'Complète des lignes', text: 'Une ligne ou une colonne entièrement remplie se dissout et rapporte des points. Vise les cases en surbrillance : elles sont presque complètes !', art: tutoGrid(['.....', 'xxxx.', '.....', '.....', '.....']) },
    { title: 'Enchaîne les combos', text: 'Dissous des lignes plusieurs coups de suite pour monter le combo et charger la Pulse. Vider tout le plateau offre +500 points.', art: tutoGrid(['aaaaa', 'bbbbb', 'aa.aa', 'bb.bb', 'aa.aa']) },
    { title: 'Bonus et Shapes', text: 'Utilise tes bonus quand tu es bloqué. Dans le mode Shapes, le plateau change de géométrie : maîtrise-le pour débloquer la forme suivante.', art: tutoGrid(['..a..', '.aaa.', 'aaaaa', '.aaa.', '..a..']) }
  ];
  function openTutorial(page = 0) {
    if (page >= TUTORIAL.length) { finishTutorial(); return; }
    const step = TUTORIAL[page]; const last = page === TUTORIAL.length - 1;
    state.paused = true;
    openModal(`<span class="modal-kicker">COMMENT JOUER · ${page + 1}/${TUTORIAL.length}</span><div class="tuto-art" data-page="${page}">${step.art}</div><h2>${step.title}</h2><p>${step.text}</p><div class="tuto-dots">${TUTORIAL.map((_, i) => `<span class="${i === page ? 'on' : ''}"></span>`).join('')}</div><div class="modal-actions" data-page="${page}">${last ? '' : '<button class="secondary" data-action="tutorial-skip">PASSER</button>'}<button class="primary" data-action="${last ? 'tutorial-skip' : 'tutorial-next'}">${last ? 'C\u2019EST PARTI !' : 'SUIVANT →'}</button></div>`, 'tutorial-modal');
    playSfx('button');
  }
  function finishTutorial() {
    profile.tutorialDone = true; saveProfile(); closeModal(); playSfx('start');
  }

  /* =====================================================================
     APPLICATION MOBILE : installation, hors-ligne, retour, veille, partage
     ===================================================================== */
  let deferredInstall = null;
  let wakeLock = null;
  const isStandalone = () => Boolean(window.matchMedia?.('(display-mode: standalone)').matches || (typeof navigator !== 'undefined' && navigator.standalone === true));
  const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent || '');

  function renderInstall() {
    const row = $('#install-row'); if (!row) return;
    row.classList.toggle('hidden', isStandalone());
    const small = $('#install-hint'); if (small) small.textContent = deferredInstall ? 'Ajoute Pulse Grid à ton écran d\u2019accueil, plein écran et hors ligne.' : isIos() ? 'Sur iPhone : Partager puis « Sur l\u2019écran d\u2019accueil ».' : 'Utilise le menu du navigateur : « Installer l\u2019application ».';
  }
  function installApp() {
    if (deferredInstall) {
      deferredInstall.prompt();
      Promise.resolve(deferredInstall.userChoice).finally(() => { deferredInstall = null; renderInstall(); });
    } else openModal(`<span class="modal-kicker">INSTALLER L'APPLICATION</span><h2>Joue en plein écran</h2><p>${isIos() ? 'Touche le bouton <b>Partager</b> de Safari, puis <b>Sur l\u2019écran d\u2019accueil</b>.' : 'Ouvre le menu du navigateur (⋮) puis choisis <b>Installer l\u2019application</b> ou <b>Ajouter à l\u2019écran d\u2019accueil</b>.'}</p><div class="modal-actions"><button class="primary" data-action="close-modal">COMPRIS</button></div>`);
  }

  // Maintient l'écran allumé pendant une partie (API facultative).
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock?.request) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener?.('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { const lock = wakeLock; wakeLock = null; await lock.release(); }
    } catch (_) { wakeLock = null; }
  }

  function shareScore() {
    const mode = state.mode === 'shapes' ? `Shapes · ${shapeDef(geo.id).name}` : 'Classic';
    const text = `J\u2019ai fait ${formatNumber(state.score)} points sur Pulse Grid (${mode}) ! Peux-tu faire mieux ?`;
    const url = typeof location !== 'undefined' && /^https?:/.test(location.href) ? location.href.split('#')[0] : undefined;
    if (navigator.share) { navigator.share({ title: 'Pulse Grid', text, url }).catch(() => {}); return; }
    const full = url ? `${text} ${url}` : text;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(full).then(() => showToast('Score copié, colle-le où tu veux !')).catch(() => showToast('Partage indisponible.'));
    else showToast('Partage indisponible sur ce navigateur.');
  }

  function initNative() {
    // Service worker : jeu utilisable sans connexion + mises à jour silencieuses.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof location !== 'undefined' && /^https?:/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => {
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) showToast('Mise à jour prête : elle s\u2019appliquera au prochain lancement.'); });
          });
        }).catch(() => {});
      });
    }
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; renderInstall(); });
    window.addEventListener('appinstalled', () => { deferredInstall = null; renderInstall(); showToast('Pulse Grid est installé !'); playSfx('unlock'); });
    // Comportements « appli » : pas de menu contextuel ni de zoom au pincement.
    document.addEventListener('contextmenu', event => { if (!event.target.closest?.('input, textarea')) event.preventDefault(); });
    document.addEventListener('gesturestart', event => event.preventDefault());
    // Partie mise en pause automatiquement quand l'app passe en arrière-plan.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (state.gameActive && state.screen === 'game' && !$('#modal-backdrop')?.classList.contains('open')) openPauseModal();
        saveProfile(); keepAwake(false);
      } else if (state.gameActive && state.screen === 'game') keepAwake(true);
    });
    window.addEventListener('pagehide', () => saveProfile());
    // Bouton retour Android / geste retour iOS : ferme, met en pause ou remonte — sans quitter l'app par erreur.
    if (typeof history !== 'undefined' && history.pushState) {
      history.pushState({ pg: 1 }, '');
      window.addEventListener('popstate', () => {
        let handled = true;
        if ($('#modal-backdrop')?.classList.contains('open') && !state.packOpening) closeModal();
        else if (state.screen === 'game' && state.gameActive) openPauseModal();
        else if (state.screen !== 'home') showScreen('home');
        else handled = false;
        if (handled) history.pushState({ pg: 1 }, '');
      });
    }
    renderInstall();
  }

  /* =====================================================================
     À propos, garde-fous
     ===================================================================== */
  function openAbout() {
    openModal(`<span class="modal-kicker">PULSE GRID · VERSION ${APP_VERSION}</span><h2>Confidentialité</h2><p>Pulse Grid n\u2019affiche aucune publicité et ne contient aucun traceur. Ta progression est enregistrée sur cet appareil (stockage local) ; tu peux l\u2019exporter ou l\u2019effacer à tout moment dans les Paramètres.</p><p>Seul le classement mondial utilise Internet : si tu choisis un pseudo, celui-ci, un identifiant aléatoire et ton meilleur score Classic sont envoyés à notre serveur et visibles par les autres joueurs. N\u2019utilise pas ton vrai nom.</p><p>Le jeu fonctionne hors ligne ; le classement attend simplement que la connexion revienne. Les achats se font avec la monnaie du jeu (PulseCoins), qui n\u2019a aucune valeur réelle.</p><div class="modal-actions"><button class="primary" data-action="close-modal">FERMER</button></div>`);
  }
  // Une erreur isolée ne doit jamais figer l'écran : on prévient et la partie continue.
  let lastErrorToast = 0;
  function reportError() {
    const now = Date.now();
    if (now - lastErrorToast > 8000) { lastErrorToast = now; try { showToast('Un petit souci est survenu. Ta progression est sauvegardée.'); } catch (_) { /* rien */ } }
  }
  window.addEventListener('error', reportError);
  window.addEventListener('unhandledrejection', reportError);
  setTimeout(() => $('#boot-screen')?.classList.add('done'), 6000);

  /* =====================================================================
     Reprise après blocage : une seule fois par partie, contre des PulseCoins
     ===================================================================== */
  const REVIVE_COST = 150;
  function endOrRevive() {
    if (!state.revived && state.turn >= 6 && profile.coins >= REVIVE_COST) offerRevive(); else endGame();
  }
  function offerRevive() {
    cancelDrag();
    state.paused = true; state.reviveOffer = true;
    openModal(`<span class="modal-kicker">PLUS DE PLACE</span><h2>Continuer la partie ?</h2><p>Aucun fragment ne rentre. Pour ${REVIVE_COST} PulseCoins, on libère de la place et tu reçois de nouveaux fragments. Ton score et ton combo en cours sont conservés.</p><div class="reward-row"><div>${formatNumber(state.score)}<span>score actuel</span></div><div>◆ ${formatNumber(profile.coins)}<span>ton solde</span></div></div><div class="modal-actions"><button class="secondary" data-action="revive-decline">TERMINER</button><button class="primary" data-action="revive-accept">CONTINUER · ◆ ${REVIVE_COST}</button></div>`, 'revive-modal');
    playSfx('gameOver'); vibrate([18, 12, 28]);
  }
  // Libère environ 20 % des cases en retirant les lignes les plus remplies, sans points ni progression gratuite.
  function reviveBoard() {
    const target = Math.ceil(geo.cellCount * .2);
    const ranked = geo.lines.map(line => ({ line, filled: line.cells.reduce((sum, [r, c]) => sum + (state.board[r][c] ? 1 : 0), 0) })).sort((a, b) => b.filled - a.filled);
    const cells = new Set();
    for (const { line } of ranked) {
      if (cells.size >= target) break;
      line.cells.forEach(([r, c]) => { if (state.board[r][c]) cells.add(r * geo.cols + c); });
    }
    cells.forEach(key => { state.board[Math.floor(key / geo.cols)][key % geo.cols] = null; });
    return cells.size;
  }
  function reviveAccept() {
    if (!state.reviveOffer || profile.coins < REVIVE_COST) { state.reviveOffer = false; closeModal(); endGame(); return; }
    state.reviveOffer = false;
    profile.coins -= REVIVE_COST; state.revived = true;
    reviveBoard();
    state.queue = generateQueue();
    state.resolving = false; state.combo = 0;
    closeModal();
    renderBoard(); renderTray(); renderHud(); animateTrayArrival();
    $('#game-message').textContent = 'Place libérée. C\u2019est reparti !';
    saveProfile(); playSfx('booster'); vibrate([14, 10, 24]);
  }

  // Pour les tests automatisés uniquement (aucun effet en production).
  if (typeof window !== 'undefined' && typeof window.__PULSE_EXPOSE__ === 'function') {
    window.__PULSE_EXPOSE__({
      endOrRevive, reviveAccept, playTone, REVIVE_COST,
      ACHIEVEMENTS, checkAchievements, achValue, openTutorial, finishTutorial, shareScore,
      importSave, doReset, saveText, renderSettings,
      snapshotRun, validRun, resumeRun, dailyStatus, claimDaily, playSfx, startMusic, stopMusic,
      get state() { return state; }, get profile() { return profile; }, get geo() { return geo; },
      SHAPE_BOARDS, SHAPE_BY_ID, getGeometry, buildGeometry, canPlace, canAnyPlace, generatePiece, generateQueue, makePiece,
      clearCompletedLines, placePiece, startNewGame, endGame, activateBoard, shapeMasteryPct, shapeObjectives, normalizeShapes,
      isShapeUnlocked, trackShapesProgress, loadProfile, createEmptyBoard, calculateClearScore
    });
  }

  /* =====================================================================
     ONLINE : pseudo, identifiant joueur, classement mondial Classic (Supabase)
     ---------------------------------------------------------------------
     - Seule la clé PUBLIQUE (publishable) est utilisée. Aucune clé secrète.
     - L'identité en ligne est stockée dans sa propre clé localStorage : elle
       n'altère pas la sauvegarde du jeu (SAVE_KEY) et survit à une remise à zéro.
     - Le jeu ne dépend jamais du réseau : toute erreur est rattrapée et le
       record est simplement renvoyé plus tard.
     ===================================================================== */
  const ONLINE = {
    url: 'https://kowglslveawcaxcngiyf.supabase.co/rest/v1/',
    key: 'sb_publishable_RTLBBaAri_Up8jmbrqBvqQ_7nWdBENN',
    table: 'leaderboard',
    // Noms des colonnes de la table Supabase : à adapter ici si besoin.
    cols: { id: 'player_id', name: 'username', best: 'classic_best' },
    storageKey: 'pulse-grid-online-v1',
    topSize: 100,
    timeoutMs: 9000,
    nameMin: 3,
    nameMax: 16
  };
  const ONLINE_BASE = ONLINE.url.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const esc = value => String(value ?? '').replace(/[&<>"'`]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;', '`': '&#96;' }[ch]));

  function makePlayerId() {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* repli ci-dessous */ }
    const bytes = new Uint8Array(16);
    try { crypto.getRandomValues(bytes); } catch (_) { for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256); }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Pseudo : on retire les caractères invisibles/de contrôle, on compacte les espaces, puis on valide.
  function cleanName(raw) {
    return String(raw ?? '').normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function validateName(raw) {
    const value = cleanName(raw);
    const length = Array.from(value).length;
    if (!value) return { ok: false, value, error: 'Entre un pseudo.' };
    if (/[<>&"'`\\]/.test(value)) return { ok: false, value, error: 'Caractères interdits : < > & " \' ` \\' };
    if (length < ONLINE.nameMin) return { ok: false, value, error: `Minimum ${ONLINE.nameMin} caractères.` };
    if (length > ONLINE.nameMax) return { ok: false, value, error: `Maximum ${ONLINE.nameMax} caractères.` };
    return { ok: true, value, error: '' };
  }

  function loadOnline() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(ONLINE.storageKey) || 'null'); } catch (_) { raw = null; }
    const o = raw && typeof raw === 'object' ? raw : {};
    const count = value => Math.max(0, Math.floor(Number(value) || 0));
    const named = validateName(o.name);
    return {
      id: typeof o.id === 'string' && UUID_RE.test(o.id) ? o.id.toLowerCase() : makePlayerId(),
      name: named.ok ? named.value : '',
      synced: count(o.synced),            // meilleur score connu côté serveur
      syncedName: typeof o.syncedName === 'string' ? o.syncedName : '',
      rank: count(o.rank),                // dernier rang connu (affichage hors ligne)
      rankBest: count(o.rankBest),
      asked: count(o.asked)               // nombre de fois où la fenêtre « choisis ton pseudo » a été affichée
    };
  }
  let online = loadOnline();
  function saveOnline() { try { localStorage.setItem(ONLINE.storageKey, JSON.stringify(online)); } catch (_) { /* stockage indisponible : on continue */ } }
  saveOnline();

  // ----- Réseau (PostgREST) -----
  function onlineError(kind, status = 0) { const error = new Error(`online:${kind}:${status}`); error.onlineKind = kind; error.status = status; return error; }

  async function sbRequest(path, { method = 'GET', body = null, prefer = '' } = {}) {
    if (typeof fetch !== 'function') throw onlineError('network');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { try { controller && controller.abort(); } catch (_) { /* rien */ } }, ONLINE.timeoutMs);
    try {
      const headers = { apikey: ONLINE.key, Accept: 'application/json' };
      if (body) headers['Content-Type'] = 'application/json';
      if (prefer) headers.Prefer = prefer;
      const response = await fetch(`${ONLINE_BASE}/rest/v1/${path}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: controller ? controller.signal : undefined
      });
      let data = null;
      if (response.status !== 204) {
        const text = await response.text();
        if (text) { try { data = JSON.parse(text); } catch (_) { data = null; } }
      }
      if (!response.ok) throw onlineError('http', response.status);
      return { data, range: response.headers.get('content-range') || '' };
    } catch (error) {
      if (error && error.onlineKind) throw error;
      throw onlineError('network');
    } finally { clearTimeout(timer); }
  }

  const qs = params => Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  const toScore = value => Math.max(0, Math.floor(Number(value) || 0));

  async function onlineFetchTop() {
    const C = ONLINE.cols;
    const { data } = await sbRequest(`${ONLINE.table}?${qs({ select: `${C.name},${C.best}`, [C.best]: 'gt.0', order: `${C.best}.desc,${C.name}.asc`, limit: ONLINE.topSize })}`);
    return Array.isArray(data) ? data.map(row => ({ name: String(row[C.name] ?? '').slice(0, 40), best: toScore(row[C.best]) })) : [];
  }

  // On ne lit JAMAIS l'identifiant des autres joueurs : seulement notre propre ligne.
  async function onlineFetchMine() {
    const C = ONLINE.cols;
    const { data } = await sbRequest(`${ONLINE.table}?${qs({ select: `${C.name},${C.best}`, [C.id]: `eq.${online.id}`, limit: 1 })}`);
    const row = Array.isArray(data) && data[0] ? data[0] : null;
    return row ? { name: String(row[C.name] ?? ''), best: toScore(row[C.best]) } : null;
  }

  async function onlineRefreshRank() {
    if (!online.name || !online.synced) return 0;
    const C = ONLINE.cols;
    const { range } = await sbRequest(`${ONLINE.table}?${qs({ select: C.best, [C.best]: `gt.${online.synced}`, limit: 1 })}`, { prefer: 'count=exact' });
    const match = /\/(\d+)$/.exec(range);
    if (!match) return 0;
    online.rank = Number(match[1]) + 1; online.rankBest = online.synced; saveOnline();
    return online.rank;
  }

  // ----- Synchronisation : crée le joueur, renvoie un record SEULEMENT s'il bat celui du serveur -----
  const onlineSync = { running: false, again: false, lastSent: 0 };
  const onlineNeedsSync = () => Boolean(online.name) && (online.syncedName !== online.name || toScore(profile.best) > online.synced);

  async function onlineSyncNow() {
    if (!online.name) return false;
    if (onlineSync.running) { onlineSync.again = true; return false; }
    onlineSync.running = true;
    let ok = false;
    const C = ONLINE.cols;
    try {
      const name = online.name; const best = toScore(profile.best);
      const row = await onlineFetchMine();
      if (!row) {
        const { data } = await sbRequest(`${ONLINE.table}?${qs({ select: C.best })}`, { method: 'POST', body: { [C.id]: online.id, [C.name]: name, [C.best]: best }, prefer: 'return=representation' });
        if (!Array.isArray(data) || !data.length) throw onlineError('blocked');
        online.synced = best; online.syncedName = name; onlineSync.lastSent = best;
      } else {
        const patch = {};
        if (row.name !== name) patch[C.name] = name;
        if (best > row.best) patch[C.best] = best;
        if (Object.keys(patch).length) {
          const { data } = await sbRequest(`${ONLINE.table}?${qs({ [C.id]: `eq.${online.id}`, select: C.best })}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
          if (!Array.isArray(data) || !data.length) throw onlineError('blocked');
          if (patch[C.best]) onlineSync.lastSent = best;
        }
        online.synced = Math.max(row.best, best); online.syncedName = name;
      }
      ok = true;
    } catch (error) {
      if (error && error.status === 409) onlineSync.again = true; // ligne créée entre-temps : on relit
      try { console.warn('[Pulse Grid] synchro classement impossible', error && error.message); } catch (_) { /* rien */ }
    } finally { saveOnline(); onlineSync.running = false; }
    if (onlineSync.again) { onlineSync.again = false; if (onlineNeedsSync()) { try { return await onlineSyncNow(); } catch (_) { return false; } } }
    return ok;
  }

  // Appelé après une partie Classic : n'envoie rien si le record n'a pas été battu.
  function onlineAfterClassicGame() {
    try {
      if (!online.name || !onlineNeedsSync()) return;
      onlineSyncNow().then(async ok => {
        if (!ok || !onlineSync.lastSent) return;
        onlineSync.lastSent = 0;
        const rank = await onlineRefreshRank().catch(() => 0);
        showToast(rank ? `Record envoyé · #${formatNumber(rank)} mondial` : 'Record envoyé au classement');
        renderLeaderboardTeaser();
      }).catch(() => {});
    } catch (_) { /* ne jamais gêner la fin de partie */ }
  }
  function onlineSyncSoon(delay = 1500) {
    setTimeout(() => { try { if (onlineNeedsSync()) onlineSyncNow().then(() => renderLeaderboardTeaser()).catch(() => {}); } catch (_) { /* rien */ } }, delay);
  }

  // ----- Écran Classement -----
  const lb = { status: 'idle', rows: [], token: 0, editing: false, draft: '', nameError: '', focus: false };

  function renderLeaderboardTeaser() {
    const sub = $('#home-leaderboard-sub'); if (!sub) return;
    if (!online.name) sub.textContent = 'Choisis ton pseudo et rejoins le top mondial';
    else if (online.rank && online.rankBest === online.synced) sub.textContent = `${online.name} · #${formatNumber(online.rank)} mondial`;
    else sub.textContent = `${online.name} · Top mondial Classic`;
  }

  function openLeaderboard() {
    lb.editing = false; lb.nameError = ''; lb.draft = '';
    loadLeaderboard();
  }

  async function loadLeaderboard() {
    const token = ++lb.token;
    lb.status = 'loading'; renderLeaderboard();
    try {
      if (online.name && onlineNeedsSync()) await onlineSyncNow();
      const [rows] = await Promise.all([onlineFetchTop(), online.name ? onlineRefreshRank().catch(() => 0) : 0]);
      if (token !== lb.token) return;
      lb.rows = rows; lb.status = 'ready';
    } catch (error) {
      if (token !== lb.token) return;
      lb.status = 'error';
      try { console.warn('[Pulse Grid] classement indisponible', error && error.message); } catch (_) { /* rien */ }
    }
    renderLeaderboard(); renderLeaderboardTeaser();
  }

  function startNameEdit() { lb.editing = true; lb.nameError = ''; lb.draft = online.name; lb.focus = true; renderLeaderboard(); }
  function cancelNameEdit() { lb.editing = false; lb.nameError = ''; renderLeaderboard(); }

  function submitName(raw) {
    const result = validateName(raw);
    if (!result.ok) { lb.nameError = result.error; lb.draft = String(raw ?? ''); lb.focus = true; playSfx('error'); vibrate([12, 40, 12]); renderLeaderboard(); return; }
    online.name = result.value; saveOnline();
    lb.editing = false; lb.nameError = ''; lb.draft = '';
    playSfx('unlock'); vibrate([14, 10, 24]); showToast('Pseudo enregistré');
    renderLeaderboardTeaser();
    loadLeaderboard();
  }

  function leaderboardRowsHTML() {
    let previous = null; let rank = 0;
    return lb.rows.map((row, index) => {
      if (row.best !== previous) { rank = index + 1; previous = row.best; }
      const mine = Boolean(online.name) && row.name === online.name && row.best === online.synced;
      const badge = rank <= 3 ? `<span class="lb-medal m${rank}">${rank}</span>` : `<span class="lb-pos">#${formatNumber(rank)}</span>`;
      return `<li class="lb-row${rank <= 3 ? ` top top${rank}` : ''}${mine ? ' mine' : ''}">${badge}<span class="lb-name">${esc(row.name)}</span><strong class="lb-score">${formatNumber(row.best)}</strong></li>`;
    }).join('');
  }

  function renderLeaderboard() {
    const root = $('#leaderboard-content'); if (!root) return;
    const hasName = Boolean(online.name);
    const form = !hasName || lb.editing;
    const intro = '<article class="shapes-intro lb-intro"><span class="eyebrow accent">COMPÉTITION</span><h2>Classement mondial</h2><p>Les meilleurs scores en mode Classic, partout dans le monde.</p></article>';

    let top = '';
    if (form) {
      top = `<form id="lb-name-form" class="lb-name-card" autocomplete="off" novalidate><span class="eyebrow accent">${hasName ? 'CHANGER DE PSEUDO' : 'REJOINDRE LE CLASSEMENT'}</span><h3>${hasName ? 'Nouveau pseudo' : 'Choisis ton pseudo'}</h3><p>${ONLINE.nameMin} à ${ONLINE.nameMax} caractères, visible par tous les joueurs. Ton record Classic sera envoyé automatiquement.</p><input id="lb-name-input" class="lb-input" name="name" type="text" maxlength="${ONLINE.nameMax}" placeholder="Ton pseudo" value="${esc(lb.draft)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Pseudo" aria-describedby="lb-name-error" /><div id="lb-name-error" class="lb-field-error" role="alert">${esc(lb.nameError)}</div><div class="lb-form-actions">${hasName ? '<button type="button" class="ghost-button" data-action="lb-cancel-name">ANNULER</button>' : ''}<button type="submit" class="primary-button lb-submit"><span>VALIDER</span><b><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></b></button></div></form>`;
    } else {
      const waiting = onlineNeedsSync() ? '<small class="lb-pending">Record en attente d\u2019envoi · il partira dès que la connexion revient.</small>' : '';
      const showRank = online.rank && online.rankBest === online.synced;
      top = `<article class="lb-me-card"><div class="lb-me-rank">${showRank ? `#${formatNumber(online.rank)}` : '—'}</div><div class="lb-me-main"><span class="eyebrow accent">TOI</span><strong>${esc(online.name)}</strong><small>Record Classic · ${formatNumber(Math.max(profile.best, online.synced))}</small>${waiting}</div><button class="ghost-button lb-edit" data-action="lb-edit-name">MODIFIER</button></article>`;
      if (!profile.best && !online.synced) top += '<p class="lb-hint">Joue une partie Classic pour entrer au classement.</p>';
    }

    let body = '';
    if (lb.status === 'loading' || lb.status === 'idle') {
      body = `<div class="lb-skeleton" aria-busy="true" aria-label="Chargement du classement">${'<span></span>'.repeat(7)}</div>`;
    } else if (lb.status === 'error') {
      body = `<article class="lb-state"><div class="lb-state-icon"><svg class="ico" aria-hidden="true"><use href="#i-warn"/></svg></div><h3>Classement indisponible</h3><p>Impossible de joindre le serveur pour l\u2019instant. Tu peux continuer à jouer : ton record sera envoyé plus tard.</p><button class="ghost-button" data-action="lb-retry">RÉESSAYER</button></article>`;
    } else if (!lb.rows.length) {
      body = '<article class="lb-state"><div class="lb-state-icon"><svg class="ico" aria-hidden="true"><use href="#i-crown"/></svg></div><h3>Le classement est vide</h3><p>Sois le premier à poser un score Classic !</p></article>';
    } else {
      body = `<div class="section-heading"><h2>Top ${lb.rows.length}</h2><span class="section-line"></span></div><ol class="lb-list">${leaderboardRowsHTML()}</ol>`;
    }

    const ranked = !form && lb.status === 'ready' && online.rank && online.rankBest === online.synced;
    const pinned = ranked ? `<div class="lb-pinned" aria-label="Ta position"><span class="lb-pos">#${formatNumber(online.rank)}</span><span class="lb-name">${esc(online.name)}</span><strong class="lb-score">${formatNumber(online.synced)}</strong></div>` : '';
    root.innerHTML = `${intro}${top}${body}${pinned}`;
    if (lb.focus) { lb.focus = false; const input = $('#lb-name-input'); if (input) { try { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } catch (_) { /* rien */ } } }
  }

  // ----- Choix du pseudo au premier lancement -----
  // Le pseudo est OBLIGATOIRE : la fenêtre s'affiche à chaque lancement tant
  // qu'aucun pseudo n'est enregistré, et elle ne peut pas être fermée sans valider
  // (ni clic à côté, ni Échap, ni bouton retour). Le pseudo reste modifiable
  // ensuite depuis l'écran Classement.
  function askNameSoon(delay = 1100, attempt = 0) {
    setTimeout(() => {
      try {
        if (online.name) return;
        const busy = $('#modal-backdrop')?.classList.contains('open') || state.gameActive || state.screen !== 'home';
        if (busy) { askNameSoon(2500, attempt + 1); return; }
        online.asked += 1; saveOnline();
        openNameModal();
      } catch (_) { /* ne jamais gêner le lancement */ }
    }, delay);
  }

  function openNameModal(error = '', draft = '') {
    openModal(`<span class="modal-kicker">BIENVENUE</span><h2>Choisis ton pseudo</h2><p>Choisis un pseudo pour commencer. Il sera visible dans le classement mondial, et ton record Classic sera envoyé automatiquement dès ta première partie.</p><form id="first-name-form" autocomplete="off" novalidate><input id="first-name-input" class="lb-input" name="name" type="text" maxlength="${ONLINE.nameMax}" placeholder="Ton pseudo" value="${esc(draft)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Pseudo" aria-describedby="first-name-error" /><div id="first-name-error" class="lb-field-error" role="alert">${esc(error)}</div><small class="name-hint">${ONLINE.nameMin} à ${ONLINE.nameMax} caractères · modifiable plus tard dans Classement.</small><div class="lb-form-actions"><button type="submit" class="primary-button lb-submit"><span>VALIDER</span><b><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></b></button></div></form>`, 'name-modal');
    setTimeout(() => { try { $('#first-name-input')?.focus(); } catch (_) { /* rien */ } }, 300);
  }

  function submitFirstName(raw) {
    const result = validateName(raw);
    if (!result.ok) {
      playSfx('error'); vibrate([12, 40, 12]);
      const box = $('#first-name-error'); if (box) box.textContent = result.error;
      try { $('#first-name-input')?.focus(); } catch (_) { /* rien */ }
      return;
    }
    online.name = result.value; saveOnline();
    state.mandatoryModal = false;
    closeModal();
    playSfx('unlock'); vibrate([14, 10, 24]); showToast(`Bienvenue, ${online.name} !`);
    renderLeaderboardTeaser();
    onlineSyncSoon(400);   // crée la ligne du joueur : son record comptera dès la première partie
  }

  function onlineInit() {
    document.addEventListener('submit', event => {
      if (!event.target) return;
      if (event.target.id === 'first-name-form') { event.preventDefault(); submitFirstName(new FormData(event.target).get('name')); return; }
      if (event.target.id !== 'lb-name-form') return;
      event.preventDefault();
      submitName(new FormData(event.target).get('name'));
    });
    window.addEventListener('online', () => { onlineSyncSoon(600); if (state.screen === 'leaderboard' && lb.status === 'error') loadLeaderboard(); });
    renderLeaderboardTeaser();
    askNameSoon(1100);      // 1er lancement : on propose de choisir un pseudo
    onlineSyncSoon(2500);   // renvoi silencieux d'un record resté en attente, sans retarder le lancement
  }

  init();
})();
