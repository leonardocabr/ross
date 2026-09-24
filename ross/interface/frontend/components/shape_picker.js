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

const DRAWINGS = {
    '': () => circle(13, 2) + circle(9.5, 1) + circle(4),
    impeller: () => circle(13.5) + circle(4) + around(9, a =>
        `<path d="M ${polar(4, a)} Q ${polar(9.5, a + 0.25)} ${polar(13.5, a + 0.95)}" fill="none" stroke="currentColor" stroke-width="1.5"/>`),
    axial: () => circle(7.5) + circle(3) + around(22, a =>
        `<path d="M ${polar(8.5, a)} L ${polar(14, a + 0.12)}" stroke="currentColor" stroke-width="1.3"/>`),
    turbine: () => circle(14.5) + circle(7) + circle(3) + around(16, a =>
        `<path d="M ${polar(8, a)} L ${polar(13.5, a + 0.18)}" stroke="currentColor" stroke-width="1.5"/>`),
    fan: () => circle(4.5) + around(6, a =>
        `<path d="M ${polar(4.5, a - 0.2)} Q ${polar(13, a - 0.55)} ${polar(14, a + 0.15)} Q ${polar(10, a + 0.35)} ${polar(4.5, a + 0.25)} Z" fill="none" stroke="currentColor" stroke-width="1.3"/>`),
    flywheel: () => circle(14, 1.5) + circle(10.5, 1.5) + circle(3.5) + around(6, a =>
        `<path d="M ${polar(3.5, a)} L ${polar(10.5, a)}" stroke="currentColor" stroke-width="2"/>`),
    // Seen from the side: the V grooves are what make a pulley a pulley.
    pulley: () => '<path d="M 11 3 L 21 3 L 21 6 L 19.5 8 L 21 10 L 19.5 12 L 21 14 L 21 18 L 19.5 20 L 21 22 L 19.5 24 L 21 26 L 21 29 L 11 29 L 11 26 L 12.5 24 L 11 22 L 12.5 20 L 11 18 L 11 14 L 12.5 12 L 11 10 L 12.5 8 L 11 6 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>'
        + '<path d="M 11 14 L 21 14 M 11 18 L 21 18" stroke="currentColor" stroke-width="1"/>',
};

function drawing(key) {
    const draw = DRAWINGS[key] || DRAWINGS[''];
    return `<svg class="shape-drawing" viewBox="0 0 32 32" aria-hidden="true">${draw()}</svg>`;
}

// The picker for a category's form, or nothing when the bank has no shapes
// for it yet.
export function shapePickerHTML(category) {
    const shapes = shapesFor(category);
    if (!shapes.length) return '';
    const tiles = shapes.map(shape => `<button type="button" class="shape-tile" data-action="pick-shape" data-shape="${escapeHtml(shape.key)}" aria-pressed="${String(shape.key === '')}">`
        + `${drawing(shape.key)}<span>${escapeHtml(shape.name())}</span></button>`).join('');
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
