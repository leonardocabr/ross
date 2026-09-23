// The solids of the 3D view, built from the layout (`core/rotor3d_layout.js`).
//
// three.js is handed in, not imported: this module is loaded by node in the
// tests with the real library, and by the page only once the 3D view is
// opened, so that nobody who never opens it pays for 2 MB of it.
//
// What the prototype taught, measured (see the project's 3D evaluation):
//
// * **one geometry for the whole rotor.** Every part is merged into a single
//   mesh with its colour in the vertices -- one draw call, whatever the number
//   of elements, where the prototype spent about five per shaft element and
//   seventeen per bearing;
// * **everything built here is disposed here.** The prototype removed the old
//   meshes from the scene and never freed them: eleven times the geometries on
//   the GPU after twenty edits. `dispose()` below frees every geometry and
//   material this module created, and nothing it did not create;
// * **detail stays**, as decided with Leonardo: disks with hub, web and rim,
//   gears with their own number of teeth, bearing housings with their base.

import { SEAL_FLANGE } from '../core/rotor3d_layout.js';

const SEGMENTS = { shaft: 36, part: 48 };

// A gear with more teeth than this is drawn with this many: past it the teeth
// are finer than a pixel at any sensible zoom, and each one costs vertices.
export const MAX_DRAWN_TEETH = 160;

// Revolve an (r, z) profile around the z axis. LatheGeometry revolves around y;
// the quarter turn about x takes y to z.
function lathe(THREE, profile, segments) {
    const points = profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 0), z));
    const geometry = new THREE.LatheGeometry(points, segments);
    geometry.rotateX(Math.PI / 2);
    return geometry;
}

// A closed ring or cylinder between two radii, from z0 to z1.
function annulus(THREE, rIn, rOut, z0, z1, segments = SEGMENTS.part) {
    if (rIn > 1e-9) {
        return lathe(THREE, [[rIn, z0], [rOut, z0], [rOut, z1], [rIn, z1], [rIn, z0]], segments);
    }
    return lathe(THREE, [[0, z0], [rOut, z0], [rOut, z1], [0, z1]], segments);
}

function box(THREE, sx, sy, sz, x, y, z) {
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    geometry.translate(x, y, z);
    return geometry;
}

// --- one builder per kind, each returning plain geometries in the part's frame

function shaftPieces(THREE, part) {
    const { odl, odr, idl, idr } = part.profile;
    const z0 = part.z0;
    const z1 = part.z1;
    if (idl > 1e-9 || idr > 1e-9) {
        return [lathe(THREE, [[idl / 2, z0], [odl / 2, z0], [odr / 2, z1], [idr / 2, z1], [idl / 2, z0]], SEGMENTS.shaft)];
    }
    return [lathe(THREE, [[0, z0], [odl / 2, z0], [odr / 2, z1], [0, z1]], SEGMENTS.shaft)];
}

// Hub, web and rim, as in the prototype. The web is a third of the hub's width,
// so the disk reads as a disk and not as a drum.
function diskPieces(THREE, part) {
    const z = (part.z0 + part.z1) / 2;
    const w = Math.abs(part.z1 - part.z0);
    const ri = Math.min(part.bore, part.radius * 0.9);
    const ro = part.radius;
    if (part.symbolic || ro - ri < 1e-6) return [annulus(THREE, ri, ro, z - w / 2, z + w / 2)];
    const dr = ro - ri;
    const rHub = ri + dr * 0.28;
    const rRim = ri + dr * 0.72;
    const wWeb = w * 0.34;
    const wRim = w * 0.86;
    const profile = [
        [ri, -w / 2], [rHub, -w / 2], [rHub, -wWeb / 2], [rRim, -wWeb / 2], [rRim, -wRim / 2],
        [ro, -wRim / 2], [ro, wRim / 2], [rRim, wRim / 2], [rRim, wWeb / 2], [rHub, wWeb / 2],
        [rHub, w / 2], [ri, w / 2], [ri, -w / 2],
    ].map(([r, dz]) => [r, z + dz]);
    return [lathe(THREE, profile, SEGMENTS.part)];
}

// A spur gear: the teeth the element has, between the root and the tip, around
// its bore. The tip is ROSS's addendum radius; the root sits 1.25 addenda below
// the pitch circle, the standard dedendum.
function gearPieces(THREE, part) {
    const z = (part.z0 + part.z1) / 2;
    const w = part.faceWidth;
    const tip = part.radius;
    const pitch = Math.min(part.pitch || tip, tip);
    const addendum = Math.max(tip - pitch, tip * 0.02);
    const root = Math.max(pitch - 1.25 * addendum, part.bore * 1.05);
    const teeth = Math.min(Math.max(Math.round(part.teeth) || 24, 6), MAX_DRAWN_TEETH);
    const shape = new THREE.Shape();
    const step = (2 * Math.PI) / teeth;
    for (let i = 0; i < teeth; i++) {
        const a = i * step;
        // Root, rise to the tip, across it, back down: a trapezoidal tooth.
        const fractions = [0.0, 0.18, 0.5, 0.68];
        const radii = [root, tip, tip, root];
        for (let k = 0; k < 4; k++) {
            const angle = a + fractions[k] * step;
            const x = Math.cos(angle) * radii[k];
            const y = Math.sin(angle) * radii[k];
            if (i === 0 && k === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
        }
    }
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, part.bore, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const body = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 24 });
    body.translate(0, 0, z - w / 2);
    // The hub stands a little proud of the teeth on both faces.
    const hubRadius = Math.min(part.bore + (root - part.bore) * 0.35, root);
    const hub = annulus(THREE, part.bore, hubRadius, part.z0, part.z1);
    return [body, hub];
}

function couplingPieces(THREE, part) {
    const z0 = Math.min(part.z0, part.z1);
    const z1 = Math.max(part.z0, part.z1);
    const L = z1 - z0;
    const ro = part.radius;
    const flange = L * 0.26;
    const spacer = Math.max(part.bore * 1.1, ro * 0.5);
    return [
        annulus(THREE, part.bore, ro, z0, z0 + flange),
        annulus(THREE, part.bore, spacer, z0 + flange, z1 - flange),
        annulus(THREE, part.bore, ro, z1 - flange, z1),
    ];
}

// A split housing on a base plate, as the prototype drew it: a rounded cap
// over the shaft, a block under it, a plate reaching past both sides.
function bearingPieces(THREE, part) {
    const r = part.shaftRadius;
    const z = (part.z0 + part.z1) / 2;
    const w = Math.abs(part.z1 - part.z0);
    const cap = part.radius;
    const pieces = [annulus(THREE, r * 1.02, cap, z - w * 0.46, z + w * 0.46)];
    const blockHeight = 1.3 * r;
    pieces.push(box(THREE, cap * 1.7, blockHeight, w * 0.9, 0, -blockHeight / 2 - r * 0.2, z));
    const plateHeight = 0.4 * r;
    pieces.push(box(THREE, cap * 3.2, plateHeight, w, 0, -1.9 * r + plateHeight / 2, z));
    return pieces;
}

function sealPieces(THREE, part) {
    const r = part.shaftRadius;
    const z = (part.z0 + part.z1) / 2;
    const w = Math.abs(part.z1 - part.z0);
    return [
        annulus(THREE, r * 1.02, part.radius, z - w / 2, z + w * 0.3),
        annulus(THREE, r * 1.02, part.radius * SEAL_FLANGE, z + w * 0.3, z + w / 2),
    ];
}

function pointMassPieces(THREE, part) {
    const r = part.shaftRadius;
    const z = (part.z0 + part.z1) / 2;
    const w = Math.abs(part.z1 - part.z0);
    return [
        annulus(THREE, r * 1.02, part.radius, z - w / 2, z + w / 2),
        // The clamp's lug, on top.
        box(THREE, r * 0.5, r * 0.55, w * 0.7, 0, part.radius + r * 0.25, z),
    ];
}

const BUILDERS = {
    shaft: shaftPieces,
    disk: diskPieces,
    gear: gearPieces,
    coupling: couplingPieces,
    bearing: bearingPieces,
    seal: sealPieces,
    pointmass: pointMassPieces,
};

// A colour ROSS names ('Firebrick', or a hex code) as three.js linear RGB. An
// unknown name, or none, is ROSS's shaft grey (0x525252) rather than white.
function colorOf(THREE, cache, name) {
    const text = name || '';
    if (!cache.has(text)) {
        const color = new THREE.Color(0x525252);
        const named = THREE.Color.NAMES[text.toLowerCase()];
        if (named !== undefined) color.setHex(named);
        else if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text)) color.setStyle(text);
        cache.set(text, color);
    }
    return cache.get(text);
}

// Merge plain geometries into one, with a colour per vertex. Every piece is
// made non-indexed first, so position, normal and colour line up one to one;
// the pieces themselves are freed as soon as they are copied.
export function mergeColoured(THREE, pieces) {
    let count = 0;
    const flat = pieces.map(({ geometry, color }) => {
        const plain = geometry.index ? geometry.toNonIndexed() : geometry;
        if (plain !== geometry) geometry.dispose();
        if (!plain.attributes.normal) plain.computeVertexNormals();
        count += plain.attributes.position.count;
        return { plain, color };
    });
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const colour = new Float32Array(count * 3);
    let at = 0;
    for (const { plain, color } of flat) {
        const n = plain.attributes.position.count;
        position.set(plain.attributes.position.array, at * 3);
        normal.set(plain.attributes.normal.array, at * 3);
        for (let i = 0; i < n; i++) {
            colour[(at + i) * 3] = color.r;
            colour[(at + i) * 3 + 1] = color.g;
            colour[(at + i) * 3 + 2] = color.b;
        }
        at += n;
        plain.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(colour, 3));
    merged.computeBoundingSphere();
    return merged;
}

// The circles that mark the nodes on the shaft surface, as one set of lines.
function ringLines(THREE, rings, segments = 40) {
    const points = new Float32Array(rings.length * segments * 6);
    let k = 0;
    for (const ring of rings) {
        const r = ring.radius * 1.004;
        for (let i = 0; i < segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const b = ((i + 1) / segments) * Math.PI * 2;
            points.set([ring.x + Math.cos(a) * r, ring.y + Math.sin(a) * r, ring.z,
                ring.x + Math.cos(b) * r, ring.y + Math.sin(b) * r, ring.z], k);
            k += 6;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    return geometry;
}

// The whole rotor as three.js objects: one mesh for every part, one set of
// lines for the node rings. `dispose` frees exactly what was made here.
//
// `look.ring` is the colour of the node rings, read from the page's theme by
// the caller: this module does not touch the DOM.
export function buildRotorModel(THREE, layout, look = {}) {
    const colors = new Map();
    const pieces = [];
    for (const part of layout.parts) {
        const build = BUILDERS[part.kind];
        if (!build) continue;
        const color = colorOf(THREE, colors, part.color);
        for (const geometry of build(THREE, part)) {
            const o = part.offset;
            if (o.x || o.y || o.z) geometry.translate(o.x, o.y, o.z);
            pieces.push({ geometry, color });
        }
    }

    const group = new THREE.Group();
    const made = { geometries: [], materials: [] };
    if (pieces.length) {
        const geometry = mergeColoured(THREE, pieces);
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true, metalness: 0.35, roughness: 0.45,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'rotor';
        group.add(mesh);
        made.geometries.push(geometry);
        made.materials.push(material);
    }
    if (layout.rings.length) {
        const geometry = ringLines(THREE, layout.rings);
        const material = new THREE.LineBasicMaterial({ color: look.ring || 'steelblue' });
        const lines = new THREE.LineSegments(geometry, material);
        lines.name = 'nodes';
        group.add(lines);
        made.geometries.push(geometry);
        made.materials.push(material);
    }

    const release = () => {
        made.geometries.forEach(g => g.dispose());
        made.materials.forEach(m => m.dispose());
        made.geometries = [];
        made.materials = [];
        group.clear();
    };
    return {
        object: group,
        vertices: made.geometries.reduce((sum, g) => sum + g.attributes.position.count, 0),
        dispose: release,
    };
}
