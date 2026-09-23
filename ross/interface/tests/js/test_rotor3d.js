// The 3D view's two halves that run without a browser: where every part goes
// (core/rotor3d_layout.js) and the solids built for it
// (components/rotor3d_parts.js), with the real three.js from vendor/three.
//
// WHY THIS BATTERY EXISTS. The scenes below are ROSS's, not made up here:
// tests/golden/rotor_scenes.json holds the projects and the scenes the server
// answered for them, and tests/test_rotor_scene.py keeps the file equal to
// what ROSS builds today. Every claim is about agreement -- a part drawn where
// the pointer finds it, a camera that frames what is drawn, a rebuild that
// frees what it replaces -- because a view that agrees with itself and not
// with the rotor is the prototype's defect over again.
import fs from 'node:fs';
import { check, shutDown } from './fake_dom.js';

const THREE = await import('../../frontend/vendor/three/three.module.js');
const { SYMBOL, drivenPlacement, framing, layoutScene, pickPart, shaftRadiusAt, viewDirection } =
    await import('../../frontend/core/rotor3d_layout.js');
const { MAX_DRAWN_TEETH, buildRotorModel, mergeColoured } =
    await import('../../frontend/components/rotor3d_parts.js');

const CASES = JSON.parse(fs.readFileSync(new URL('../golden/rotor_scenes.json', import.meta.url)));
const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
const copy = value => JSON.parse(JSON.stringify(value));

// --- every element becomes exactly one part -------------------------------------
console.log('\nOne part per element, at the element\'s place');

const CATEGORIES = ['shafts', 'couplings', 'disks', 'gears', 'bearings', 'seals', 'pointmasses'];
for (const [name, { scene }] of Object.entries(CASES)) {
    const lines = scene.kind === 'multirotor' ? [['driving', scene.driving], ['driven', scene.driven]] : [[null, scene]];
    const { parts } = layoutScene(scene);
    const expected = lines.reduce((sum, [, line]) => sum + CATEGORIES.reduce((n, c) => n + (line[c] || []).length, 0), 0);
    check(`${name}: ${expected} elements, ${parts.length} parts`, parts.length === expected);
    const keys = new Set(parts.map(p => p.key));
    check(`${name}: no two parts share a key`, keys.size === parts.length);
    const everyRowOnce = lines.every(([half, line]) => CATEGORIES.every(c => (line[c] || []).every(e =>
        parts.filter(p => p.half === half && p.category === c && p.index === e.index && p.entry === e).length === 1)));
    check(`${name}: each part is its own row, by category and index`, everyRowOnce);
}

const compressor = CASES.compressor_example.scene;
const compressorParts = layoutScene(compressor).parts;
const shaftParts = compressorParts.filter(p => p.kind === 'shaft');
check('a shaft part spans the nodes the server put it between',
    shaftParts.every(p => p.z0 === p.entry.z0 && p.z1 === p.entry.z1));
check('and is as thick as its larger end',
    shaftParts.every(p => near(p.radius, Math.max(p.entry.odl, p.entry.odr) / 2)));

// --- sizes -------------------------------------------------------------------------
console.log('\nSizes: the scene\'s when it has one, the shaft\'s when it has none');

const every = CASES.every_element.scene;
const everyParts = layoutScene(every).parts;
const disksDrawn = everyParts.filter(p => p.kind === 'disk');
check('a disk from its dimensions is drawn at its outer radius',
    disksDrawn.some(p => p.entry.shape.exact && near(p.radius, p.entry.shape.outer_radius)));
check('an equivalent disk at the equivalent radius and width',
    disksDrawn.some(p => !p.entry.shape.exact && near(p.radius, p.entry.shape.outer_radius)
        && near(Math.abs(p.z1 - p.z0), p.entry.shape.width)));

const noShape = copy(every);
noShape.disks[0].shape = null;
const ring = layoutScene(noShape).parts.find(p => p.key === 'disks:0');
const radiusThere = shaftRadiusAt(noShape.shafts, noShape.disks[0].z, 0);
check('a disk with no equivalent is a thin ring in proportion to its shaft, and says so',
    ring.symbolic === true && near(ring.radius, SYMBOL.disk.radius * radiusThere));

const bearing = everyParts.find(p => p.kind === 'bearing' && !p.hanging);
check('a bearing is sized by the shaft it holds',
    near(bearing.radius, SYMBOL.bearing.radius * shaftRadiusAt(every.shafts, bearing.entry.z, 0)));

// every_element: a point mass on link node 5, which bearing 0 (node 0) links to.
const hanging = everyParts.find(p => p.kind === 'pointmass');
check('a part on a link node hangs under the node that links to it',
    hanging.entry.link === true && hanging.hanging === 1
    && near(hanging.offset.y, -SYMBOL.link * hanging.shaftRadius) && hanging.entry.z === every.bearings[0].z);

// A tapered element, read halfway along; a sleeve over a shaft, read outside.
const tapered = [{ z0: 0, z1: 1, odl: 0.1, odr: 0.2 }];
check('the radius of a tapered element halfway along is halfway between its ends',
    near(shaftRadiusAt(tapered, 0.5, 0), 0.075));
const layered = [{ z0: 0, z1: 1, odl: 0.1, odr: 0.1 }, { z0: 0, z1: 1, odl: 0.14, odr: 0.14 }];
check('under a sleeve, the radius is the sleeve\'s', near(shaftRadiusAt(layered, 0.3, 0), 0.07));

// --- the MultiRotor -------------------------------------------------------------------
console.log('\nThe second shaft line of a MultiRotor');

const multi = CASES.multirotor.scene;
const placed = drivenPlacement(multi);
const pitch = (line, node) => line.gears.find(g => g.n === node).pitch_radius;
const apart = pitch(multi.driving, multi.coupled_nodes[0]) + pitch(multi.driven, multi.coupled_nodes[1]);
check('the two axes are the sum of the pitch radii apart',
    near(Math.hypot(placed.x, placed.y), apart));
check('along the line of centres at ROSS\'s orientation angle',
    near(Math.atan2(placed.y, placed.x), multi.orientation_angle));
check('and shifted along the axis by ROSS\'s own dz_pos', near(placed.z, multi.driven_offset));
const multiParts = layoutScene(multi).parts;
check('the driven line\'s parts are keyed apart and carry the shift',
    multiParts.filter(p => p.half === 'driven').every(p => p.key.startsWith('driven:')
        && (p.hanging || (near(p.offset.x, placed.x) && near(p.offset.y, placed.y) && near(p.offset.z, placed.z)))));

// ROSS's own MultiRotor example: the pinion's pitch diameter (77 mm) is smaller
// than its 150 mm shaft. Drawn as given, its teeth were buried in the shaft
// and the two gears were drawn inside each other -- what Leonardo saw.
const example = CASES.ross_multirotor_example.scene;
const exampleParts = layoutScene(example).parts;
const pinion = exampleParts.find(p => p.half === 'driven' && p.kind === 'gear');
const wheel = exampleParts.find(p => p.half === 'driving' && p.kind === 'gear');
check('a pitch circle inside its own shaft is drawn as teeth cut on the shaft',
    pinion.gear.onShaft === true && near(pinion.gear.root, pinion.shaftRadius)
    && pinion.gear.pitch > pinion.shaftRadius && near(pinion.gear.rossPitch, pinion.entry.pitch_radius));
check('a gear bigger than its shaft keeps ROSS\'s pitch circle',
    wheel.gear.onShaft === false && near(wheel.gear.pitch, wheel.entry.pitch_radius));
const exampleOffset = drivenPlacement(example);
const exampleDistance = Math.hypot(exampleOffset.x, exampleOffset.y);
check('the two gears are drawn in mesh: the axes are the drawn pitch radii apart',
    near(exampleDistance, wheel.gear.pitch + pinion.gear.pitch));
check('and neither shaft runs into the other gear',
    exampleDistance - pinion.shaftRadius >= wheel.gear.tip && exampleDistance - wheel.shaftRadius >= pinion.gear.tip);
check('a gear with no width in ROSS is drawn ten modules wide, and says so',
    pinion.entry.width === null && pinion.gear.widthAssumed && near(pinion.faceWidth, 10 * pinion.gear.module));

// --- shafts and couplings --------------------------------------------------------
console.log('\nShaft ends and couplings');

const everyShafts = everyParts.filter(p => p.kind === 'shaft').sort((a, b) => a.z0 - b.z0);
check('a free end of the shaft line is chamfered', everyShafts[0].chamfer[0] === true);
check('an end that meets a thicker element is not', everyShafts[0].chamfer[1] === false);
check('the thicker element\'s end, standing proud of the thinner one, is', everyShafts[1].chamfer[0] === true);

// ROSS lumps a coupling's halves at its two nodes (m_l, m_r): a hub on each,
// and only a slender spacer between them.
const couplingCase = CASES.coupling.scene;
const couplingPart = layoutScene(couplingCase).parts.find(p => p.kind === 'coupling');
const couplingModel = buildRotorModel(THREE, { parts: [couplingPart], rings: [] });
const cp = couplingModel.object.getObjectByName('metal').geometry.attributes.position.array;
const span = couplingPart.z1 - couplingPart.z0;
let hubAtLeft = false;
let hubAtRight = false;
let bulkInMiddle = false;
for (let i = 0; i < cp.length; i += 3) {
    const radius = Math.hypot(cp[i], cp[i + 1]);
    const z = cp[i + 2];
    if (radius > 0.95 * couplingPart.radius && z < couplingPart.z0 + 0.35 * span) hubAtLeft = true;
    if (radius > 0.95 * couplingPart.radius && z > couplingPart.z1 - 0.35 * span) hubAtRight = true;
    if (radius > 0.6 * couplingPart.radius && Math.abs(z - (couplingPart.z0 + couplingPart.z1) / 2) < 0.15 * span) bulkInMiddle = true;
}
check('a coupling is a flanged hub at each of its nodes', hubAtLeft && hubAtRight);
check('and not a drum across the span', !bulkInMiddle);
check('it carries ROSS\'s two lumped masses for the tooltip',
    couplingPart.entry.m_l === 2 && couplingPart.entry.m_r === 3);
couplingModel.dispose();

// --- the pointer ----------------------------------------------------------------------
console.log('\nThe pointer finds the part it is on');

const gearPart = everyParts.find(p => p.kind === 'gear');
const gz = gearPart.entry.z;
const down = pickPart(everyParts, [0, 1, gz], [0, -1, 0]);
check('straight down onto a gear, it is the gear', down && down.part === gearPart);
check('at the gear\'s tip, not at the shaft inside it', down && near(down.distance, 1 - gearPart.radius));

const shaftOnly = everyParts.find(p => p.kind === 'shaft' && p.index === 2);
const zShaft = (shaftOnly.z0 + shaftOnly.z1) / 2;
const onShaft = pickPart(everyParts, [0, 1, zShaft], [0, -1, 0]);
check('between the parts, the shaft', onShaft && onShaft.part.kind === 'shaft' && onShaft.part.index === 2);
check('beside the rotor, nothing', pickPart(everyParts, [1, 1, zShaft], [0, -1, 0]) === null);
check('along the axis from past the end, the last part first',
    (() => {
        const hit = pickPart(everyParts, [0, 0, 5], [0, 0, -1]);
        const zs = everyParts.filter(p => !p.hanging && p.offset.y === 0).map(p => Math.max(p.z0, p.z1));
        return hit && near(5 - hit.distance, Math.max(...zs));
    })());
const drivenGear = multiParts.find(p => p.half === 'driven' && p.kind === 'gear');
const drivenHit = pickPart(multiParts, [placed.x, placed.y + 1, drivenGear.entry.z + placed.z], [0, -1, 0]);
check('on the driven line, the driven line\'s gear', drivenHit && drivenHit.part === drivenGear);

// --- the camera -----------------------------------------------------------------------
console.log('\nThe camera frames what is drawn, closely');

for (const [name, { scene }] of Object.entries(CASES)) {
    const { bounds } = layoutScene(scene);
    const direction = viewDirection(scene);
    const fov = 35;
    const aspect = 1.6;
    const view = framing(bounds, fov, aspect, direction);
    // Independently: each corner, seen from the camera, inside the half-angles.
    const back = view.direction;
    const eye = view.center.map((c, i) => c + back[i] * view.distance);
    const forward = back.map(v => -v);
    const r = [-forward[2], 0, forward[0]];
    const rl = Math.hypot(...r);
    const rightAxis = r.map(v => v / rl);
    const upAxis = [
        rightAxis[1] * forward[2] - rightAxis[2] * forward[1],
        rightAxis[2] * forward[0] - rightAxis[0] * forward[2],
        rightAxis[0] * forward[1] - rightAxis[1] * forward[0],
    ];
    const tanV = Math.tan(fov * Math.PI / 360);
    const tanH = tanV * aspect;
    let worst = 0;
    for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
        const p = [x - eye[0], y - eye[1], z - eye[2]];
        const depth = p[0] * forward[0] + p[1] * forward[1] + p[2] * forward[2];
        const h = Math.abs(p[0] * rightAxis[0] + p[1] * rightAxis[1] + p[2] * rightAxis[2]) / (depth * tanH);
        const v = Math.abs(p[0] * upAxis[0] + p[1] * upAxis[1] + p[2] * upAxis[2]) / (depth * tanV);
        worst = Math.max(worst, h, v);
    }
    check(`${name}: every corner is in view`, worst <= 1 + 1e-9);
    check(`${name}: and the rotor fills most of it (${(worst * 100).toFixed(0)}% of the frame)`, worst >= 0.85);
}

// --- the solids -------------------------------------------------------------------------
console.log('\nThe solids: a mesh per finish, ROSS\'s colours, in the layout\'s box, freed on rebuild');

// Every triangle of a mesh faces the way its normals say. `revolve` writes its
// normals itself; a triangle wound the other way is lit from behind, which is
// what a rotor that looks black on the side facing the light is.
function facingOut(geometry) {
    const p = geometry.attributes.position.array;
    const n = geometry.attributes.normal.array;
    let good = 0;
    let counted = 0;
    for (let i = 0; i < p.length; i += 9) {
        const e1 = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
        const e2 = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
        const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const area = Math.hypot(...c);
        if (area < 1e-12) continue;
        const normal = [0, 1, 2].map(k => n[i + k] + n[i + 3 + k] + n[i + 6 + k]);
        counted += 1;
        if (c[0] * normal[0] + c[1] * normal[1] + c[2] * normal[2] > 0) good += 1;
    }
    return counted ? good / counted : 0;
}

for (const [name, { scene }] of Object.entries(CASES)) {
    const layout = layoutScene(scene);
    const model = buildRotorModel(THREE, layout);
    const meshes = model.object.children.filter(o => o.isMesh);
    const names = model.object.children.map(o => o.name).sort();
    check(`${name}: a mesh per finish, the outlines and the node rings, nothing else`,
        meshes.length >= 1 && names.every(n => ['metal', 'paint', 'outlines', 'nodes'].includes(n))
        && model.object.getObjectByName('nodes').isLineSegments
        && model.object.getObjectByName('outlines').isLineSegments);
    check(`${name}: coloured by vertex`, meshes.every(m => m.material.vertexColors === true && !!m.geometry.attributes.color));
    check(`${name}: every face turned the way it is lit`, meshes.every(m => facingOut(m.geometry) > 0.999));
    const box = new THREE.Box3();
    meshes.forEach(m => { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); });
    const size = Math.max(...[0, 1, 2].map(i => layout.bounds.max[i] - layout.bounds.min[i]));
    const inside = ['x', 'y', 'z'].every((axis, i) => box.min[axis] >= layout.bounds.min[i] - 1e-3 * size
        && box.max[axis] <= layout.bounds.max[i] + 1e-3 * size);
    const filling = ['x', 'y', 'z'].every((axis, i) => box.min[axis] <= layout.bounds.min[i] + 2e-2 * size
        && box.max[axis] >= layout.bounds.max[i] - 2e-2 * size);
    check(`${name}: what is drawn stays inside the box the camera frames`, inside);
    check(`${name}: and reaches its sides`, filling);
    model.dispose();
}

// Colours: ROSS's names, not the prototype's fixed palette.
const oneDisk = { parts: layoutScene(every).parts.filter(p => p.kind === 'disk').slice(0, 1), rings: [], bounds: null };
const diskModel = buildRotorModel(THREE, oneDisk);
const colour = diskModel.object.getObjectByName('metal').geometry.attributes.color.array;
const firebrick = new THREE.Color().setHex(THREE.Color.NAMES.firebrick);
check('a disk is ROSS\'s Firebrick', near(colour[0], firebrick.r, 1e-6) && near(colour[1], firebrick.g, 1e-6)
    && near(colour[2], firebrick.b, 1e-6));
diskModel.dispose();
const unknown = { ...oneDisk, parts: [{ ...oneDisk.parts[0], color: 'not-a-colour' }] };
const greyModel = buildRotorModel(THREE, unknown);
const grey = greyModel.object.getObjectByName('metal').geometry.attributes.color.array;
check('a colour three.js does not know is the shaft grey, not white',
    near(grey[0], new THREE.Color(0x525252).r, 1e-6) && grey[0] < 0.5);
greyModel.dispose();

// Teeth: the gear's own count, up to the cap.
const gearOnly = teeth => {
    const found = layoutScene(every).parts.find(p => p.kind === 'gear');
    const part = { ...found, gear: { ...found.gear, teeth } };
    const model = buildRotorModel(THREE, { parts: [part], rings: [] });
    const count = model.vertices;
    model.dispose();
    return count;
};
check('more teeth, more vertices: the count is the gear\'s', gearOnly(40) > gearOnly(20));

// The teeth are as wide as the gear's face; only the hub stands proud of them.
const gearModel = buildRotorModel(THREE, { parts: [gearPart], rings: [] });
const positions = gearModel.object.getObjectByName('metal').geometry.attributes.position.array;
let toothLo = Infinity;
let toothHi = -Infinity;
for (let i = 0; i < positions.length; i += 3) {
    if (Math.hypot(positions[i], positions[i + 1]) > gearPart.gear.pitch) {
        toothLo = Math.min(toothLo, positions[i + 2]);
        toothHi = Math.max(toothHi, positions[i + 2]);
    }
}
check('the teeth span the face width ROSS gives the gear',
    near(toothHi - toothLo, gearPart.entry.width, 1e-5) && near((toothHi + toothLo) / 2, gearPart.entry.z, 1e-5));
gearModel.dispose();
check('past the cap, no more', gearOnly(100000) === gearOnly(MAX_DRAWN_TEETH));

// Freeing: every geometry and material the model holds, and the pieces merged
// into it as soon as they are copied.
const freed = new Set();
const watch = object => object.addEventListener('dispose', () => freed.add(object));
const model = buildRotorModel(THREE, layoutScene(compressor));
const held = [];
model.object.traverse(o => { if (o.geometry) held.push(o.geometry, o.material); });
held.forEach(watch);
model.dispose();
check('dispose frees every geometry and material the model holds', held.every(o => freed.has(o)));
check('and leaves nothing hanging from the group', model.object.children.length === 0);

// Indexed pieces (as three.js makes them) and one already flat, which is
// copied as it is and has to be freed all the same.
const pieces = [0, 1, 2].map(() => new THREE.CylinderGeometry(1, 1, 1, 8));
pieces.push(new THREE.CylinderGeometry(1, 1, 1, 8).toNonIndexed());
pieces.forEach(watch);
const merged = mergeColoured(THREE, pieces.map(geometry => ({ geometry, color: new THREE.Color(1, 0, 0) })));
check('merging frees the pieces it copied, indexed or not', pieces.every(p => freed.has(p)));
check('and keeps all their vertices',
    merged.attributes.position.count === 4 * new THREE.CylinderGeometry(1, 1, 1, 8).toNonIndexed().attributes.position.count);
merged.dispose();

shutDown();
