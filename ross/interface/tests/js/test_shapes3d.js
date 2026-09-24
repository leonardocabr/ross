// The geometry bank: the shapes an element can be drawn with in the 3D view
// instead of its default -- a compressor impeller in place of a disk, say.
//
// WHY THIS BATTERY EXISTS. The shape is only a picture (Leonardo's decision:
// ROSS computes with the form's own mass and inertias), and that is exactly
// why it can go wrong quietly:
//
//   * a shape that pokes out of the element's envelope is drawn where the
//     pointer does not find it and past what the camera frames;
//   * a blade wound the wrong way is lit from behind -- black on the side
//     facing the light;
//   * a catalogue key with no builder, or a builder no key reaches, is a
//     tile that draws the default, or a shape nobody can choose;
//   * the picker has to show what the element holds, after a restore, a
//     redraw, a language change.
//
// That ROSS and the exported script never see it is Python's to check
// (tests/test_python_export.py).
import fs from 'node:fs';
import { check, node, registerSelector, schemaResponse, shutDown } from './fake_dom.js';

const THREE = await import('../../frontend/vendor/three/three.module.js');
const { SHAPE_FIELD, shapeOf, shapesFor } = await import('../../frontend/core/shapes3d.js');
const { layoutScene } = await import('../../frontend/core/rotor3d_layout.js');
const { buildRotorModel } = await import('../../frontend/components/rotor3d_parts.js');
const { SHAPE_BUILDERS } = await import('../../frontend/components/rotor3d_shapes.js');
const { pickShape, shapePickerHTML, syncShapePicker } = await import('../../frontend/components/shape_picker.js');

const CASES = JSON.parse(fs.readFileSync(new URL('../golden/rotor_scenes.json', import.meta.url)));

// --- the catalogue ---------------------------------------------------------------------
console.log('\nThe catalogue');

const disks = shapesFor('disks');
const COVERED = ['disks', 'bearings', 'seals', 'pointmasses', 'couplings'];
const everyShape = COVERED.flatMap(category => shapesFor(category).slice(1).map(shape => ({ category, shape })));
check('each category covered has its default first, as the empty key',
    COVERED.every(c => shapesFor(c)[0].key === '' && shapesFor(c).length > 1) && shapeOf('disks', '') === null);
check('every shape has a builder', everyShape.every(({ shape }) => typeof SHAPE_BUILDERS[shape.key] === 'function'));
check('and every builder a shape to choose it by',
    Object.keys(SHAPE_BUILDERS).every(key => everyShape.some(({ shape }) => shape.key === key)));
check('no key is offered by two categories: the builders are found by key alone',
    new Set(everyShape.map(({ shape }) => shape.key)).size === everyShape.length);
check('each has a name', COVERED.every(c => shapesFor(c).every(s => typeof s.name() === 'string' && s.name().length > 0)));
check('a key the catalogue does not know is the default, not an error',
    shapeOf('disks', 'warp-drive') === null && shapeOf('bearings', 'impeller') === null);
check('a category the bank does not cover offers nothing', shapesFor('shafts').length === 0 && shapesFor('gears').length === 0);

// --- the layout --------------------------------------------------------------------------
console.log('\nThe layout: the shape in the disk\'s envelope');

const every = CASES.every_element.scene;
const plain = layoutScene(every).parts.filter(p => p.kind === 'disk');
const asked = [];
const shaped = layoutScene(every, (half, category, index) => {
    asked.push([half, category, index]);
    return index === 0 ? shapeOf('disks', 'impeller') : null;
}).parts.filter(p => p.kind === 'disk');
check('the layout asks for each disk by its line, category and position',
    asked.filter(([, c]) => c === 'disks').length === plain.length && asked.every(([h]) => h === null));
check('the disk given a shape carries its key; the others none', shaped[0].shape === 'impeller' && shaped[1].shape === '');
check('without the question, nothing changes', plain.every(p => p.shape === ''));
const impeller = shapeOf('disks', 'impeller');
check('a shape that needs depth widens the part, in both directions, and no further',
    shaped[0].z1 - shaped[0].z0 >= impeller.minWidth * shaped[0].radius - 1e-12
    && Math.abs((shaped[0].z0 + shaped[0].z1) / 2 - (plain[0].z0 + plain[0].z1) / 2) < 1e-12
    && shaped[0].radius === plain[0].radius);
const thin = { ...every, disks: every.disks.map(d => ({ ...d, shape: { ...d.shape, width: 0.005 } })) };
const widened = layoutScene(thin, () => impeller).parts.find(p => p.kind === 'disk');
check('a disk thinner than that is widened to it', Math.abs((widened.z1 - widened.z0) - impeller.minWidth * widened.radius) < 1e-12);
const noSize = { ...every, disks: every.disks.map(d => ({ ...d, shape: null })) };
check('a disk with no size in ROSS stays the ring that says so',
    layoutScene(noSize, () => impeller).parts.filter(p => p.kind === 'disk').every(p => p.shape === '' && p.symbolic));

// --- the solids --------------------------------------------------------------------------
console.log('\nThe solids: inside the envelope, lit from the front');

function facingOut(geometry) {
    const p = geometry.attributes.position.array;
    const n = geometry.attributes.normal.array;
    let good = 0;
    let counted = 0;
    for (let i = 0; i < p.length; i += 9) {
        const e1 = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
        const e2 = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
        const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (Math.hypot(...c) < 1e-14) continue;
        const normal = [0, 1, 2].map(k => n[i + k] + n[i + 3 + k] + n[i + 6 + k]);
        counted += 1;
        if (c[0] * normal[0] + c[1] * normal[1] + c[2] * normal[2] > 0) good += 1;
    }
    return counted ? good / counted : 0;
}

// Outward, and not merely consistent: the normals of a closed solid, weighted
// by area, point away from its middle.
function pointingOut(geometry, centre) {
    const p = geometry.attributes.position.array;
    let flux = 0;
    for (let i = 0; i < p.length; i += 9) {
        const e1 = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
        const e2 = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
        const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const m = [0, 1, 2].map(k => (p[i + k] + p[i + 3 + k] + p[i + 6 + k]) / 3 - centre[k]);
        flux += c[0] * m[0] + c[1] * m[1] + c[2] * m[2];
    }
    return flux;
}

const base = plain[0];
for (const shape of disks.slice(1)) {
    const part = { ...base, shape: shape.key };
    const model = buildRotorModel(THREE, { parts: [part], rings: [] });
    const meshes = model.object.children.filter(o => o.isMesh);
    let reach = 0;
    let lo = Infinity;
    let hi = -Infinity;
    meshes.forEach(m => {
        const p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
            reach = Math.max(reach, Math.hypot(p.getX(i), p.getY(i)));
            lo = Math.min(lo, p.getZ(i));
            hi = Math.max(hi, p.getZ(i));
        }
    });
    const tol = 1e-6 * part.radius;
    check(`${shape.key}: inside the disk's radius and width`,
        reach <= part.radius + tol && lo >= part.z0 - tol && hi <= part.z1 + tol);
    check(`${shape.key}: and filling them`, reach >= 0.97 * part.radius && hi - lo >= 0.9 * (part.z1 - part.z0));
    check(`${shape.key}: every face turned the way it is lit`, meshes.every(m => facingOut(m.geometry) > 0.995));
    model.dispose();
    // Each piece on its own: a closed piece's faces point out of it.
    const pieces = SHAPE_BUILDERS[shape.key](THREE, part, []);
    const outward = pieces.every(({ geometry }) => {
        geometry.computeBoundingBox();
        const centre = new THREE.Vector3();
        geometry.boundingBox.getCenter(centre);
        const out = pointingOut(geometry, centre.toArray());
        geometry.dispose();
        return out > 0;
    });
    check(`${shape.key}: and out of the solid, not into it`, outward);
    check(`${shape.key}: in the element's own colour`, pieces.every(p => p.color === null));
}
const vertices = shape => {
    const built = buildRotorModel(THREE, { parts: [{ ...base, shape }], rings: [] });
    const count = built.vertices;
    built.dispose();
    return count;
};
const counts = disks.map(s => vertices(s.key));
check('each shape is drawn as itself, not as the default disk', new Set(counts).size === counts.length);

// Every other category, in the scene it belongs to: what is drawn stays in
// the box the camera frames (which knows a support's base and feet, a seal's
// flange), and faces out.
const SCENES = { bearings: 'every_element', seals: 'every_element', pointmasses: 'every_element', couplings: 'coupling' };
for (const { category, shape } of everyShape.filter(e => e.category !== 'disks')) {
    const scene = CASES[SCENES[category]].scene;
    const layout = layoutScene(scene, (half, c) => (c === category ? shape : null));
    const drawnParts = layout.parts.filter(p => p.category === category);
    const model = buildRotorModel(THREE, layout);
    const meshes = model.object.children.filter(o => o.isMesh);
    const box = new THREE.Box3();
    meshes.forEach(m => { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); });
    const size = Math.max(...[0, 1, 2].map(i => layout.bounds.max[i] - layout.bounds.min[i]));
    const inside = ['x', 'y', 'z'].every((axis, i) => box.min[axis] >= layout.bounds.min[i] - 1e-3 * size
        && box.max[axis] <= layout.bounds.max[i] + 1e-3 * size);
    check(`${category} ${shape.key}: every part given it, and inside the box the camera frames`,
        drawnParts.length > 0 && drawnParts.every(p => p.shape === shape.key) && inside);
    check(`${category} ${shape.key}: every face turned the way it is lit`, meshes.every(m => facingOut(m.geometry) > 0.995));
    const plainOne = buildRotorModel(THREE, { parts: [{ ...drawnParts[0], shape: '' }], rings: [] });
    const shapedOne = buildRotorModel(THREE, { parts: [drawnParts[0]], rings: [] });
    check(`${category} ${shape.key}: drawn as itself, not as the default`, plainOne.vertices !== shapedOne.vertices);
    const pieces = SHAPE_BUILDERS[shape.key](THREE, drawnParts[0], []);
    check(`${category} ${shape.key}: some of it in the element's own colour`, pieces.some(p => p.color === null));
    pieces.forEach(p => p.geometry.dispose());
    plainOne.dispose();
    shapedOne.dispose();
    model.dispose();
}

const plainModel = buildRotorModel(THREE, { parts: [{ ...base, shape: 'warp-drive' }], rings: [] });
const defaultModel = buildRotorModel(THREE, { parts: [base], rings: [] });
check('an unknown key draws the default disk', plainModel.vertices === defaultModel.vertices);
plainModel.dispose();
defaultModel.dispose();

// --- the picker --------------------------------------------------------------------------
console.log('\nThe picker in the form');

const html = shapePickerHTML('disks');
check('a tile per shape, the default pressed', (html.match(/class="shape-tile"/g) || []).length === disks.length
    && /data-shape="" aria-pressed="true"/.test(html));
check('the choice rides in a hidden field the form saves like any other',
    html.includes(`<input type="hidden" id="inp-${SHAPE_FIELD}" value="">`));
check('no drawing carries a colour of its own', !/#[0-9a-f]{3,6}\b/i.test(html) && html.includes('currentColor'));
check('no picker for a category the bank does not cover', shapePickerHTML('shafts') === '');

const tiles = disks.map(s => { const tile = node('tile:' + s.key); tile.dataset.shape = s.key; return tile; });
registerSelector('#form-fields .shape-tile', tiles);
pickShape('fan');
check('picking a shape writes the field', node(`inp-${SHAPE_FIELD}`).value === 'fan');
check('and lights its tile alone', tiles.filter(t => t.getAttribute('aria-pressed') === 'true').map(t => t.dataset.shape).join() === 'fan');
node(`inp-${SHAPE_FIELD}`).value = 'axial';
syncShapePicker();
check('a value restored into the field lights its tile', tiles.find(t => t.dataset.shape === 'axial').getAttribute('aria-pressed') === 'true');
node(`inp-${SHAPE_FIELD}`).value = 'warp-drive';
syncShapePicker();
check('a key from a later version lights none, and is kept',
    tiles.every(t => t.getAttribute('aria-pressed') === 'false') && node(`inp-${SHAPE_FIELD}`).value === 'warp-drive');
pickShape('');
check('the default empties the field: saved, the element carries no shape', node(`inp-${SHAPE_FIELD}`).value === '');
pickShape('fan');
pickShape(undefined);
check('a tile with no shape named is the default too', node(`inp-${SHAPE_FIELD}`).value === '');

// In the form: the element's own models get it, the LIST batch does not (its
// fields are lists of values), and a restore -- a language change redraws the
// form and puts back what was typed -- lights the tile again.
globalThis.fetch = async path => {
    const answer = schemaResponse(path);
    return { ok: true, status: 200, json: async () => answer || { status: 'success' } };
};
const { schemaReady } = await import('../../frontend/core/schema.js');
const { buildFormHTML, restoreFormValues } = await import('../../frontend/components/form.js');
await schemaReady();
check('the disk form ends with the picker', buildFormHTML('disks', 'BASIC').includes('class="shape-picker"'));
check('the LIST form has none', !buildFormHTML('disks', 'LIST').includes('shape-picker'));
check('nor the form of a category the bank does not cover', !buildFormHTML('shafts', 'BASIC').includes('shape-picker'));
check('a bearing\'s form offers its own shapes', (shapePickerHTML('bearings').match(/class="shape-tile"/g) || []).length === shapesFor('bearings').length);
restoreFormValues({ values: { [`inp-${SHAPE_FIELD}`]: 'turbine' }, advancedOpen: false });
check('a restore lights the tile of what it put back',
    tiles.filter(t => t.getAttribute('aria-pressed') === 'true').map(t => t.dataset.shape).join() === 'turbine');

shutDown();
