// The shapes of the geometry bank (core/shapes3d.js), each built in the
// envelope of the element it stands for: its outer radius `part.radius`, its
// width `z0..z1` and its bore. Only pictures -- ROSS computes with the
// element's own mass and inertias -- so what matters is that each reads as
// what it is, and that nothing is drawn outside the part: the pointer finds
// parts by that envelope and the camera frames it.
//
// three.js is handed in, not imported (see rotor3d_parts.js). Each builder
// returns pieces as rotor3d_solids.js describes them.
import { SEGMENTS, faceted, loft, own, revolve, ring } from './rotor3d_solids.js';

// The frame every shape is built in: z along the shaft, the part's middle at
// `mid`.
function frame(part) {
    const w = Math.abs(part.z1 - part.z0);
    const R = part.radius;
    return { R, w, mid: (part.z0 + part.z1) / 2, bore: Math.min(part.bore || 0, 0.8 * R) };
}

// A point at radius r, angle a round the shaft, height z.
const at = (r, a, z) => [r * Math.cos(a), r * Math.sin(a), z];

// --- centrifugal compressor impeller -------------------------------------------
//
// The eye faces node 0 (-z), the back plate the other way; the hub flares
// from the eye to the full radius, and the blades run over it from the inlet
// -- leaning into the flow -- to the tip, swept back. Half of them are
// splitters, starting part-way along.
function impeller(THREE, part, edges) {
    const { R, w, mid, bore } = frame(part);
    const front = mid - w / 2;
    const back = mid + w / 2;
    const plate = 0.1 * w;
    const run = w - plate;
    const nose = Math.max(bore * 1.3, 0.28 * R);
    const hubAt = th => [R - (R - nose) * Math.cos(th), front + run * Math.sin(th)];
    const inletTip = nose + 0.55 * (R - nose);
    const exitHeight = 0.2 * run;
    const shroudAt = th => [R - (R - inletTip) * Math.cos(th), front + (run - exitHeight) * Math.sin(th)];

    const profile = [[bore, front], [nose, front]];
    for (let i = 1; i <= 14; i++) profile.push(hubAt((i / 14) * (Math.PI / 2)));
    profile.push([R, back], [bore, back], [bore, front]);
    const pieces = [own(revolve(THREE, profile, SEGMENTS.part, edges))];

    const blades = 7;
    const thick = 0.02 * R;
    const samples = 20;
    const blade = (start, phase) => {
        const sections = [];
        for (const s of [0, 0.5, 1]) {
            const sideA = [];
            const sideB = [];
            for (let i = 0; i <= samples; i++) {
                const t = start + (1 - start) * (i / samples);
                const th = t * (Math.PI / 2);
                const [rh, zh] = hubAt(th);
                const [rs, zs] = shroudAt(th);
                const r = rh + (rs - rh) * s;
                const z = zh + (zs - zh) * s;
                const lead = (1 - t) * (1 - t);
                const a = phase + 0.6 * lead - 0.35 * t * t + 0.2 * s * lead;
                const half = (0.5 * thick) / Math.max(r, 1e-9);
                sideA.push(at(r, a + half, z));
                sideB.unshift(at(r, a - half, z));
            }
            sections.push(sideA.concat(sideB));
        }
        return loft(THREE, sections, edges);
    };
    for (let i = 0; i < blades; i++) {
        const phase = (i / blades) * Math.PI * 2;
        pieces.push(own(blade(0, phase)));
        pieces.push(own(blade(0.45, phase + Math.PI / blades)));
    }
    return pieces;
}

// --- bladed disks: axial compressor stage, turbine wheel, fan --------------------
//
// A blade is an airfoil section -- a cambered, thickened line -- set at a
// stagger angle from the shaft axis that grows from root to tip (the twist),
// and lofted over the span.
function bladeRow(THREE, edges, { count, root, tip, centre, chord, stagger, camber, thickness, spans = 4 }) {
    const pieces = [];
    const samples = 8;
    for (let b = 0; b < count; b++) {
        const a = (b / count) * Math.PI * 2;
        const radial = [Math.cos(a), Math.sin(a), 0];
        const across = [-Math.sin(a), Math.cos(a), 0];
        const sections = [];
        for (let k = 0; k <= spans; k++) {
            const f = k / spans;
            const reach = root + (tip - root) * f;
            const c = chord(f);
            const z = stagger(f);
            const along = [Math.sin(z) * across[0], Math.sin(z) * across[1], Math.cos(z)];
            const normal = [Math.cos(z) * across[0], Math.cos(z) * across[1], -Math.sin(z)];
            const outline = [];
            for (let i = 0; i <= samples; i++) {
                const u = (i / samples - 0.5) * c;
                const x = 1 - Math.pow((2 * u) / c, 2);
                const bend = camber * c * x;
                const half = 0.5 * thickness * c * Math.max(Math.sqrt(Math.max(x, 0)), 0.15);
                outline.push([u, bend + half], [u, bend - half]);
            }
            // The section leans across the radius, so its corners stand further
            // out than its middle: the middle is brought in until the farthest
            // corner is at `reach`, inside the part's envelope.
            const sideways = Math.max(...outline.map(([u, v]) => Math.abs(u * Math.sin(z) + v * Math.cos(z))));
            const r = Math.sqrt(Math.max(reach * reach - sideways * sideways, 0.25 * reach * reach));
            const point = ([u, v]) => [0, 1, 2].map(i => r * radial[i] + u * along[i] + v * normal[i] + (i === 2 ? centre : 0));
            const upper = outline.filter((_, i) => i % 2 === 0).map(point);
            const lower = outline.filter((_, i) => i % 2 === 1).map(point).reverse();
            sections.push(upper.concat(lower));
        }
        pieces.push(own(loft(THREE, sections, edges)));
    }
    return pieces;
}

// The disk under the blades: a hub the full width, a thinner web, and the
// platform the blades stand on.
function bladedDisk(THREE, part, edges, platformAt, platformWidth) {
    const { R, w, mid, bore } = frame(part);
    const h = w / 2;
    const platform = platformAt * R;
    const lip = 0.07 * R;
    const hub = bore + 0.25 * (platform - lip - bore);
    const pw = platformWidth * h;
    const profile = [
        [bore, mid - h], [hub, mid - h], [hub, mid - 0.36 * h], [platform - lip, mid - 0.24 * h],
        [platform - lip, mid - pw], [platform, mid - pw], [platform, mid + pw], [platform - lip, mid + pw],
        [platform - lip, mid + 0.24 * h], [hub, mid + 0.36 * h], [hub, mid + h], [bore, mid + h], [bore, mid - h],
    ];
    return own(revolve(THREE, profile, SEGMENTS.part, edges));
}

function axialStage(THREE, part, edges) {
    const { R, w, mid } = frame(part);
    const root = 0.64 * R;
    const chord = 0.8 * w / Math.cos((30 * Math.PI) / 180);
    const count = Math.max(16, Math.min(56, Math.round((2 * Math.PI * (root + R) / 2) / (0.75 * chord))));
    return [bladedDisk(THREE, part, edges, 0.66, 0.84)].concat(bladeRow(THREE, edges, {
        count, root, tip: R, centre: mid, chord: () => chord,
        stagger: f => ((30 + 25 * f) * Math.PI) / 180, camber: 0.06, thickness: 0.08,
    }));
}

// Fewer, more curved blades than a compressor stage, under a shroud band.
function turbine(THREE, part, edges) {
    const { R, w, mid } = frame(part);
    const root = 0.6 * R;
    const band = 0.07 * R;
    const chord = 0.8 * w / Math.cos((22 * Math.PI) / 180);
    const count = Math.max(12, Math.min(40, Math.round((2 * Math.PI * (root + R) / 2) / (1.05 * chord))));
    return [bladedDisk(THREE, part, edges, 0.62, 0.9)]
        .concat(bladeRow(THREE, edges, {
            count, root, tip: R - band * 0.9, centre: mid, chord: () => chord,
            stagger: f => ((22 + 18 * f) * Math.PI) / 180, camber: 0.2, thickness: 0.14,
        }))
        .concat([own(ring(THREE, R - band, R, mid - 0.42 * w, mid + 0.42 * w, edges, SEGMENTS.part, 0.2 * band))]);
}

// A few broad, strongly twisted blades on a hub with a spinner.
function fan(THREE, part, edges) {
    const { R, w, mid, bore } = frame(part);
    const hub = Math.max(bore * 1.4, 0.3 * R);
    const front = mid - w / 2;
    const noseLength = 0.35 * w;
    const profile = [[0, front]];
    for (let i = 1; i <= 8; i++) {
        const th = (i / 8) * (Math.PI / 2);
        profile.push([hub * Math.sin(th), front + noseLength * (1 - Math.cos(th))]);
    }
    profile.push([hub, mid + w / 2], [0, mid + w / 2], [0, front]);
    const pieces = [own(revolve(THREE, profile, SEGMENTS.part, edges))];
    const count = 7;
    const room = w - noseLength;
    const centre = front + noseLength + room / 2;
    const rootStagger = (35 * Math.PI) / 180;
    const tipStagger = (65 * Math.PI) / 180;
    const rootChord = (0.9 * room) / Math.cos(rootStagger);
    const tipChord = Math.min(1.35 * rootChord, (0.9 * room) / Math.cos(tipStagger), (0.8 * 2 * Math.PI * R) / count);
    return pieces.concat(bladeRow(THREE, edges, {
        count, root: hub * 0.98, tip: R, centre, spans: 5,
        chord: f => rootChord + (tipChord - rootChord) * f,
        stagger: f => rootStagger + (tipStagger - rootStagger) * f, camber: 0.08, thickness: 0.06,
    }));
}

// --- flywheel and pulley -------------------------------------------------------------

// A heavy rim on spokes.
function flywheel(THREE, part, edges) {
    const { R, w, mid, bore } = frame(part);
    const rimIn = 0.74 * R;
    const hub = Math.max(bore * 1.9, 0.22 * R);
    const pieces = [
        own(ring(THREE, rimIn, R, mid - w / 2, mid + w / 2, edges, SEGMENTS.part, 0.04 * R)),
        own(ring(THREE, bore, hub, mid - w / 2, mid + w / 2, edges, SEGMENTS.part, 0.03 * R)),
    ];
    const spokes = 6;
    const thick = Math.min(0.35 * w, 0.07 * R);
    const length = rimIn - hub + 0.04 * R;
    for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        const spoke = new THREE.CylinderGeometry(thick, thick * 1.25, length, 16);
        spoke.translate(0, (hub + rimIn) / 2, 0);
        spoke.rotateZ(a - Math.PI / 2);
        spoke.translate(0, 0, mid);
        pieces.push(own(faceted(THREE, spoke, edges)));
    }
    return pieces;
}

// A V-belt pulley: grooves round the rim, a web, the hub.
function pulley(THREE, part, edges) {
    const { R, w, mid, bore } = frame(part);
    const h = w / 2;
    const hub = Math.max(bore * 1.6, 0.25 * R);
    const rimIn = 0.8 * R;
    const grooves = Math.max(1, Math.min(6, Math.floor(w / (0.16 * R))));
    const pitch = w / grooves;
    const top = 0.8 * pitch;
    const depth = Math.min(0.1 * R, 0.8 * (R - rimIn));
    const bottom = Math.max(top - 2 * depth * Math.tan((19 * Math.PI) / 180), 0.12 * pitch);
    const profile = [
        [bore, mid - h], [hub, mid - h], [hub, mid - 0.12 * w], [rimIn, mid - 0.12 * w], [rimIn, mid - h], [R, mid - h],
    ];
    for (let g = 0; g < grooves; g++) {
        const c = mid - h + pitch * (g + 0.5);
        profile.push([R, c - top / 2], [R - depth, c - bottom / 2], [R - depth, c + bottom / 2], [R, c + top / 2]);
    }
    profile.push([R, mid + h], [rimIn, mid + h], [rimIn, mid + 0.12 * w], [hub, mid + 0.12 * w], [hub, mid + h],
        [bore, mid + h], [bore, mid - h]);
    return [own(revolve(THREE, profile, SEGMENTS.part, edges))];
}

// By key, as core/shapes3d.js names them.
export const SHAPE_BUILDERS = {
    impeller,
    axial: axialStage,
    turbine,
    fan,
    flywheel,
    pulley,
};
