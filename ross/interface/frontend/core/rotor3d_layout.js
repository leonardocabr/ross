// Where each part of the 3D view goes, worked out from the scene the server
// sends (`domain/rotor_scene.py`), with no three.js in it.
//
// The scene says what ROSS built, in SI: where every node is along the axis,
// the diameters of every shaft element, the real or equivalent size of every
// disk. What it does not say is how to draw what has no size in ROSS -- a
// bearing, a seal, a point mass -- nor where the second shaft line of a
// MultiRotor sits. Both are decided here, as numbers, so they can be checked
// in node without a GPU, and so the drawing (`components/rotor3d_parts.js`)
// and the pointer (`pickPart`) read the same answer.
//
// Coordinates are ROSS's: z along the shaft, x and y across it, y up. A part is
// a solid of revolution around its own axis, which is the shaft line's axis
// moved by `offset` -- the MultiRotor's driven line, or a support hanging under
// the node that links to it.

// How big the parts ROSS gives no size to are drawn, in shaft radii at their
// node. The proportions are the prototype's, which were chosen to read as a
// bearing housing, a seal gland and a clamped collar at any rotor size.
export const SYMBOL = {
    bearing: { radius: 1.6, width: 2.6 },
    seal: { radius: 1.25, width: 1.0 },
    pointmass: { radius: 1.35, width: 1.0 },
    // A disk whose mass or inertia is not positive has no equivalent size:
    // a thin ring says "something is here" without inventing one.
    disk: { radius: 1.3, width: 0.4 },
    // How far below its parent a part on a link node hangs.
    link: 3.4,
};

// How far a gear's hub reaches along the axis, each way, in face widths; and
// how much wider than its gland a seal's flange is.
export const GEAR_HUB = 0.62;
export const SEAL_FLANGE = 1.2;

// When a node has no shaft element at all (a link node, or an empty rotor),
// symbols need some radius: the median of the shaft radii keeps them in scale
// with the rest of the rotor.
function typicalRadius(shafts) {
    const radii = shafts.map(s => Math.max(s.odl || 0, s.odr || 0) / 2).filter(r => r > 0).sort((a, b) => a - b);
    return radii.length ? radii[Math.floor(radii.length / 2)] : 0.025;
}

// The outer radius of the shaft line at `z`: the largest of the elements that
// reach it, tapered ones read at that point. Layered elements (a sleeve over a
// shaft, as in ROSS's compressor example) count with their outer diameter.
export function shaftRadiusAt(shafts, z, fallback) {
    let best = 0;
    for (const s of shafts) {
        if (s.z0 == null || s.z1 == null) continue;
        const lo = Math.min(s.z0, s.z1) - 1e-9;
        const hi = Math.max(s.z0, s.z1) + 1e-9;
        if (z < lo || z > hi) continue;
        const span = s.z1 - s.z0;
        const along = span ? (z - s.z0) / span : 0;
        const outer = ((s.odl || 0) + ((s.odr ?? s.odl ?? 0) - (s.odl || 0)) * along) / 2;
        best = Math.max(best, outer);
    }
    return best || fallback;
}

// The parts of one shaft line, in its own coordinates, moved by `offset`.
function partsOfLine(line, half, offset) {
    const shafts = line.shafts || [];
    const typical = typicalRadius(shafts);
    const radiusAt = z => shaftRadiusAt(shafts, z, typical);
    const parts = [];
    const key = (category, index) => (half ? `${half}:${category}:${index}` : `${category}:${index}`);
    const base = { half, offset };

    for (const s of shafts) {
        if (s.z0 == null || s.z1 == null) continue;
        parts.push({
            ...base, key: key('shafts', s.index), category: 'shafts', index: s.index, kind: 'shaft',
            entry: s, color: s.color, z0: s.z0, z1: s.z1,
            radius: Math.max(s.odl || 0, s.odr || 0) / 2,
            profile: { odl: s.odl, odr: s.odr ?? s.odl, idl: s.idl || 0, idr: s.idr ?? s.idl ?? 0 },
        });
    }

    for (const c of line.couplings || []) {
        if (c.z0 == null || c.z1 == null) continue;
        const r = radiusAt((c.z0 + c.z1) / 2);
        parts.push({
            ...base, key: key('couplings', c.index), category: 'couplings', index: c.index, kind: 'coupling',
            entry: c, color: c.color, z0: c.z0, z1: c.z1,
            radius: c.outer_diameter ? c.outer_diameter / 2 : 2 * r, bore: r,
        });
    }

    for (const d of line.disks || []) {
        if (d.z == null) continue;
        const r = radiusAt(d.z);
        const shape = d.shape;
        const outer = shape ? shape.outer_radius : SYMBOL.disk.radius * r;
        const width = shape && shape.width ? shape.width : SYMBOL.disk.width * r;
        parts.push({
            ...base, key: key('disks', d.index), category: 'disks', index: d.index, kind: 'disk',
            entry: d, color: d.color, z0: d.z - width / 2, z1: d.z + width / 2,
            radius: outer, bore: shape ? shape.inner_radius : r, symbolic: !shape,
        });
    }

    for (const g of line.gears || []) {
        if (g.z == null) continue;
        const r = radiusAt(g.z);
        const outer = g.outer_radius || g.pitch_radius || 2 * r;
        const width = g.width || 0.4 * outer;
        // The hub stands proud of the teeth on both faces (GEAR_HUB of the width).
        parts.push({
            ...base, key: key('gears', g.index), category: 'gears', index: g.index, kind: 'gear',
            entry: g, color: g.color, z0: g.z - GEAR_HUB * width, z1: g.z + GEAR_HUB * width,
            radius: outer, bore: g.bore_radius || r, faceWidth: width,
            pitch: g.pitch_radius || outer, teeth: g.teeth || 0,
        });
    }

    // What sits on a node with no size of its own. A part on a link node hangs
    // under the part that links to it, one level per link, as ROSS's 2D
    // figure draws a support under its bearing.
    const depth = linkDepths(line);
    const symbolic = [
        ['bearings', 'bearing'],
        ['seals', 'seal'],
        ['pointmasses', 'pointmass'],
    ];
    for (const [category, kind] of symbolic) {
        for (const e of line[category] || []) {
            if (e.z == null) continue;
            const r = radiusAt(e.z);
            const levels = e.link ? (depth.get(e.n) || 1) : 0;
            const size = SYMBOL[kind];
            parts.push({
                ...base, key: key(category, e.index), category, index: e.index, kind,
                entry: e, color: e.color, z0: e.z - (size.width * r) / 2, z1: e.z + (size.width * r) / 2,
                radius: size.radius * r, bore: r, shaftRadius: r,
                offset: { x: offset.x, y: offset.y - levels * SYMBOL.link * r, z: offset.z },
                hanging: levels,
            });
        }
    }
    return parts;
}

// How many links down each link node is: 1 under a structural node, 2 under a
// link node, and so on. A cycle stops at the number of links there are.
function linkDepths(line) {
    const parent = new Map();
    for (const category of ['bearings', 'seals']) {
        for (const e of line[category] || []) {
            if (e.n_link != null && !parent.has(e.n_link)) parent.set(e.n_link, e.n);
        }
    }
    const structural = new Set((line.nodes || []).map(n => n.n));
    const depth = new Map();
    for (const link of parent.keys()) {
        let levels = 0;
        let node = link;
        while (!structural.has(node) && parent.has(node) && levels <= parent.size) {
            node = parent.get(node);
            levels += 1;
        }
        depth.set(link, Math.max(1, levels));
    }
    return depth;
}

// Where the driven line of a MultiRotor goes. Along the axis, ROSS says it:
// `driven_offset` is the `dz_pos` that lines the two coupled gears up. Across
// it, the two axes are the sum of the pitch radii apart, on the line of gear
// centres at `orientation_angle` from x -- ROSS's own definition of that angle.
// (`position`, above or below, is how ROSS's 2D figure stacks the two lines on
// paper; in space the angle is what places them.)
export function drivenPlacement(scene) {
    const [drivingNode, drivenNode] = scene.coupled_nodes || [];
    const radiusOf = (line, node) => {
        const gear = (line.gears || []).find(g => g.n === node);
        return gear ? (gear.pitch_radius || gear.outer_radius || 0) : 0;
    };
    let distance = radiusOf(scene.driving, drivingNode) + radiusOf(scene.driven, drivenNode);
    if (!(distance > 0)) {
        distance = 4 * Math.max(typicalRadius(scene.driving.shafts || []), typicalRadius(scene.driven.shafts || []));
    }
    const angle = scene.orientation_angle || 0;
    return { x: distance * Math.cos(angle), y: distance * Math.sin(angle), z: scene.driven_offset || 0 };
}

// Every part of the scene, in world coordinates, plus the node rings and the
// box that holds them. This is the one reading of the scene the 3D view makes.
export function layoutScene(scene) {
    const lines = [];
    if (scene && scene.kind === 'multirotor') {
        lines.push(['driving', scene.driving, { x: 0, y: 0, z: 0 }]);
        lines.push(['driven', scene.driven, drivenPlacement(scene)]);
    } else if (scene) {
        lines.push([null, scene, { x: 0, y: 0, z: 0 }]);
    }

    const parts = [];
    const rings = [];
    for (const [half, line, offset] of lines) {
        const ofThisLine = partsOfLine(line, half, offset);
        parts.push(...ofThisLine);
        const shafts = line.shafts || [];
        const typical = typicalRadius(shafts);
        for (const node of line.nodes || []) {
            rings.push({ half, n: node.n, z: node.z + offset.z, x: offset.x, y: offset.y,
                radius: shaftRadiusAt(shafts, node.z, typical) });
        }
    }
    return { parts, rings, bounds: boundsOf(parts) };
}

function boundsOf(parts) {
    if (!parts.length) return { min: [-0.1, -0.1, 0], max: [0.1, 0.1, 0.1] };
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of parts) {
        const o = p.offset;
        const r = p.radius;
        // What reaches past the cylinder of a part (components/rotor3d_parts.js):
        // a bearing's base plate, wider than its cap and down at 1.9 shaft
        // radii, a seal's flange, and a point mass's clamp lug on top.
        const flange = p.kind === 'seal' ? SEAL_FLANGE * r : r;
        const across = p.kind === 'bearing' ? 1.6 * r : flange;
        const below = p.kind === 'bearing' ? Math.max(1.9 * p.shaftRadius, r) : flange;
        const above = p.kind === 'pointmass' ? r + 0.55 * p.shaftRadius : flange;
        min[0] = Math.min(min[0], o.x - across); max[0] = Math.max(max[0], o.x + across);
        min[1] = Math.min(min[1], o.y - below); max[1] = Math.max(max[1], o.y + above);
        min[2] = Math.min(min[2], o.z + Math.min(p.z0, p.z1)); max[2] = Math.max(max[2], o.z + Math.max(p.z0, p.z1));
    }
    return { min, max };
}

// Where to look from, for the whole rotor in view. The camera stands on the
// line through the centre of the box along `direction`, as close as it can
// while every corner of the box stays inside the field of view -- the box is
// projected, not wrapped in a sphere: a shaft is long and thin, and the
// sphere around it would leave it a sliver in the middle of the panel.
export function framing(bounds, fovDegrees, aspect, direction = [1, 0.45, 0.3]) {
    const center = [0, 1, 2].map(i => (bounds.min[i] + bounds.max[i]) / 2);
    const back = normalized(direction);
    const view = back.map(v => -v);
    let right = normalized(cross(view, [0, 1, 0]));
    if (!right.some(v => Math.abs(v) > 1e-9)) right = [1, 0, 0];
    const up = cross(right, view);
    const tanV = Math.tan((fovDegrees * Math.PI) / 360);
    const tanH = tanV * Math.max(aspect || 1, 1e-3);
    let distance = 0;
    for (const x of [bounds.min[0], bounds.max[0]]) {
        for (const y of [bounds.min[1], bounds.max[1]]) {
            for (const z of [bounds.min[2], bounds.max[2]]) {
                const p = [x - center[0], y - center[1], z - center[2]];
                const toward = dot(p, back);
                distance = Math.max(distance,
                    toward + Math.abs(dot(p, right)) / tanH,
                    toward + Math.abs(dot(p, up)) / tanV);
            }
        }
    }
    const size = [0, 1, 2].map(i => bounds.max[i] - bounds.min[i]);
    const radius = Math.max(1e-3, Math.hypot(...size) / 2);
    return { center, radius, distance: Math.max(distance * 1.08, radius * 1.05), direction: back };
}

// From the side, a little above and a little in front of node 0, so the
// shaft reads left to right as in the 2D figure. For a MultiRotor, obliquely
// across the line between the two axes and from its upper side, so neither
// line hides the other.
export function viewDirection(scene) {
    if (scene && scene.kind === 'multirotor') {
        const angle = scene.orientation_angle || 0;
        let side = [-Math.sin(angle), Math.cos(angle)];
        if (side[1] < 0) side = side.map(v => -v);
        const across = [Math.cos(angle), Math.sin(angle)];
        return normalized([side[0] + 0.8 * across[0], side[1] + 0.8 * across[1], 0.5]);
    }
    return normalized([1, 0.45, 0.3]);
}

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalized(v) {
    const length = Math.hypot(...v);
    return length > 0 ? v.map(x => x / length) : [0, 0, 1];
}

// The part under a ray, or null. Every part is picked as the cylinder that
// holds it -- the prototype cast its ray at every tooth of every gear, which
// cost 80 ms per mouse move on a large rotor. A coaxial cylinder is a few
// multiplications, and a pointer does not need the teeth to know it is on a
// gear. Returns the nearest hit.
export function pickPart(parts, origin, direction) {
    let best = null;
    for (const part of parts) {
        const t = rayCylinder(part, origin, direction);
        if (t !== null && (best === null || t < best.distance)) best = { part, distance: t };
    }
    return best;
}

function rayCylinder(part, origin, direction) {
    const o = part.offset;
    const ox = origin[0] - o.x;
    const oy = origin[1] - o.y;
    const oz = origin[2] - o.z;
    const [dx, dy, dz] = direction;
    const r = part.radius;
    const zLo = Math.min(part.z0, part.z1);
    const zHi = Math.max(part.z0, part.z1);
    let nearest = null;
    const keep = t => { if (t >= 0 && (nearest === null || t < nearest)) nearest = t; };

    // The side: (ox + t dx)^2 + (oy + t dy)^2 = r^2.
    const a = dx * dx + dy * dy;
    if (a > 1e-12) {
        const b = 2 * (ox * dx + oy * dy);
        const c = ox * ox + oy * oy - r * r;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
            const root = Math.sqrt(disc);
            for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
                const z = oz + t * dz;
                if (z >= zLo && z <= zHi) keep(t);
            }
        }
    }
    // The two ends.
    if (Math.abs(dz) > 1e-12) {
        for (const zEnd of [zLo, zHi]) {
            const t = (zEnd - oz) / dz;
            const x = ox + t * dx;
            const y = oy + t * dy;
            if (x * x + y * y <= r * r) keep(t);
        }
    }
    return nearest;
}
