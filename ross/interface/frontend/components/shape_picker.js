// The geometry bank's picker in the element form: one tile per shape of the
// category (core/shapes3d.js), each with a small drawing of it.
//
// The choice travels in a hidden field, `inp-shape3d`, like every other field
// of the form: saving reads it (and drops it when it is the default, empty),
// editing restores it, a language change keeps it. The tiles only show which
// one it is -- `syncShapePicker` after anything that writes the field.
import { escapeHtml } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { SHAPE_FIELD, shapesFor } from '../core/shapes3d.js';

// The drawings, face on, in a 32 x 32 box, in the text's colour.
const C = 16;
const polar = (r, a) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
const circle = (r, width = 1.5) => `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="currentColor" stroke-width="${width}"/>`;
const around = (count, draw) => Array.from({ length: count }, (_, i) => draw((i / count) * Math.PI * 2)).join('');

const stroke = (d, width = 1.5) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${width}"/>`;
const box = (x, y, w, h, width = 1.3) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="currentColor" stroke-width="${width}"/>`;

// By category, then by key: each category's default has its own drawing.
const DRAWINGS = {
    disks: {
        '': () => circle(13, 2) + circle(9.5, 1) + circle(4),
        impeller: () => circle(13.5) + circle(4) + around(9, a =>
            stroke(`M ${polar(4, a)} Q ${polar(9.5, a + 0.25)} ${polar(13.5, a + 0.95)}`)),
        axial: () => circle(7.5) + circle(3) + around(22, a => stroke(`M ${polar(8.5, a)} L ${polar(14, a + 0.12)}`, 1.3)),
        turbine: () => circle(14.5) + circle(7) + circle(3) + around(16, a => stroke(`M ${polar(8, a)} L ${polar(13.5, a + 0.18)}`)),
        fan: () => circle(4.5) + around(6, a =>
            stroke(`M ${polar(4.5, a - 0.2)} Q ${polar(13, a - 0.55)} ${polar(14, a + 0.15)} Q ${polar(10, a + 0.35)} ${polar(4.5, a + 0.25)} Z`, 1.3)),
        flywheel: () => circle(14) + circle(10.5) + circle(3.5) + around(6, a => stroke(`M ${polar(3.5, a)} L ${polar(10.5, a)}`, 2)),
        // Seen from the side: the V grooves are what make a pulley a pulley.
        pulley: () => stroke('M 11 3 L 21 3 L 21 6 L 19.5 8 L 21 10 L 19.5 12 L 21 14 L 21 18 L 19.5 20 L 21 22 L 19.5 24 L 21 26 L 21 29 L 11 29 L 11 26 L 12.5 24 L 11 22 L 12.5 20 L 11 18 L 11 14 L 12.5 12 L 11 10 L 12.5 8 L 11 6 Z')
            + stroke('M 11 14 L 21 14 M 11 18 L 21 18', 1),
    },
    bearings: {
        '': () => stroke('M 4 28 L 28 28 L 28 24 L 25 24 L 25 16 A 9 9 0 0 0 7 16 L 7 24 L 4 24 Z') + circle(4.5),
        rolling: () => circle(14) + circle(5) + around(10, a => `<circle cx="${polar(9.5, a).split(' ')[0]}" cy="${polar(9.5, a).split(' ')[1]}" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/>`),
        tilting_pad: () => circle(14) + circle(4) + around(5, a => stroke(`M ${polar(6, a - 0.45)} A 6 6 0 0 1 ${polar(6, a + 0.45)} L ${polar(9, a + 0.45)} A 9 9 0 0 0 ${polar(9, a - 0.45)} Z`, 1.2)),
        magnetic: () => circle(14) + circle(4.5) + around(8, a => stroke(`M ${polar(6.5, a)} L ${polar(11.5, a)}`, 3)),
    },
    seals: {
        '': () => stroke('M 5 26 L 5 8 L 8 8 L 8 12 L 11 12 L 11 8 L 14 8 L 14 12 L 17 12 L 17 8 L 20 8 L 20 12 L 23 12 L 23 5 L 27 5 L 27 26 Z'),
        brush: () => circle(14) + circle(5) + around(28, a => stroke(`M ${polar(5.5, a)} L ${polar(12, a + 0.35)}`, 1)),
    },
    pointmasses: {
        '': () => circle(11) + circle(5) + box(13, 1.5, 6, 5),
        balance_weight: () => circle(5) + circle(7) + stroke(`M ${polar(7, -Math.PI / 2 - 0.9)} A 7 7 0 0 1 ${polar(7, -Math.PI / 2 + 0.9)} L ${polar(14, -Math.PI / 2 + 0.9)} A 14 14 0 0 0 ${polar(14, -Math.PI / 2 - 0.9)} Z`),
        nut: () => stroke(`M ${around(6, a => polar(13, a + Math.PI / 6) + ' L ').slice(0, -3)} Z`) + circle(6),
    },
    couplings: {
        '': () => box(3, 7, 8, 18) + box(21, 7, 8, 18) + box(12, 9, 1.5, 14, 1) + box(18.5, 9, 1.5, 14, 1) + box(13.5, 13, 5, 6, 1),
        gear_coupling: () => box(3, 11, 5, 10) + box(24, 11, 5, 10) + box(7, 8, 18, 16) + box(14, 4, 4, 24),
        jaw: () => box(3, 8, 9, 16) + box(20, 8, 9, 16) + box(12, 8, 4, 5) + box(12, 19, 4, 5) + box(16, 13.5, 4, 5),
        rigid: () => box(3, 11, 9, 10) + box(20, 11, 9, 10) + box(12, 3, 4, 26) + box(16, 3, 4, 26)
            + stroke('M 10 6 L 22 6 M 10 26 L 22 26', 1),
    },
};

function drawing(category, key) {
    const drawings = DRAWINGS[category] || DRAWINGS.disks;
    const draw = drawings[key] || drawings[''];
    return `<svg class="shape-drawing" viewBox="0 0 32 32" aria-hidden="true">${draw()}</svg>`;
}

// The picker for a category's form, or nothing when the bank has no shapes
// for it yet.
export function shapePickerHTML(category) {
    const shapes = shapesFor(category);
    if (!shapes.length) return '';
    const tiles = shapes.map(shape => `<button type="button" class="shape-tile" data-action="pick-shape" data-shape="${escapeHtml(shape.key)}" aria-pressed="${String(shape.key === '')}">`
        + `${drawing(category, shape.key)}<span>${escapeHtml(shape.name())}</span></button>`).join('');
    return `<div class="shape-picker"><label>${escapeHtml(t('shapeTitle'))}</label>`
        + `<input type="hidden" id="inp-${SHAPE_FIELD}" value="">`
        + `<div class="shape-grid" role="group">${tiles}</div>`
        + `<p class="shape-hint">${escapeHtml(t('shapeHint'))}</p></div>`;
}

export function pickShape(key) {
    const field = document.getElementById(`inp-${SHAPE_FIELD}`);
    if (!field) return;
    field.value = key || '';
    syncShapePicker();
}

// The tiles show what the field holds: after a restore, an edit, a redraw.
// A key the catalogue does not know (a later version's) lights no tile, and
// is kept as it is.
export function syncShapePicker() {
    const field = document.getElementById(`inp-${SHAPE_FIELD}`);
    const value = field ? field.value || '' : '';
    document.querySelectorAll('#form-fields .shape-tile').forEach(tile => {
        tile.setAttribute('aria-pressed', String((tile.dataset.shape || '') === value));
    });
}
