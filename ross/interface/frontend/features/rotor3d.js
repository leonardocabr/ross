// The 3D view of the rotor, beside ROSS's 2D figure.
//
// It is a view and nothing else: it draws the scene the server answered with
// the rotor (`domain/rotor_scene.py`), and has no model of its own to fall out
// of step with the element lists. Editing from it comes in a later slice,
// through the same forms the lists open.
//
// What the prototype cost, and what this does instead (measured; see the
// project's 3D evaluation):
//
// * three.js is **loaded the first time the 3D view is opened**, with
//   `import()`: whoever never opens it never downloads it;
// * a frame is drawn **when something changed** -- the camera moved, the
//   rotor was rebuilt, the pointer moved -- and not sixty times a second while
//   the page sits there;
// * the pointer is resolved **once per frame**, against the cylinder around
//   each part (`pickPart`), not once per mouse event against every triangle;
// * a rebuild **frees what it replaces** (`components/rotor3d_parts.js`);
// * the renderer is made once and kept: one WebGL context for the page's
//   lifetime, where browsers allow only a handful before they drop the oldest.
import { escapeHtml } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { framing, layoutScene, pickPart, viewDirection } from '../core/rotor3d_layout.js';
import { buildRotorModel } from '../components/rotor3d_parts.js';

const FOV = 35;

let library = null;
let loadingLibrary = null;
let stage = null;
let model = null;
let layout = null;
let direction = null;
let framedFor = null;
let framedFrom = null;
let frameAsked = false;
let pointer = null;

// `import()` of the bare name 'three' goes through the import map in
// index.html, which points it at `vendor/three/`. The OrbitControls addon
// imports 'three' by that same name, so both see one copy of the library.
function loadLibrary() {
    if (library) return Promise.resolve(library);
    if (!loadingLibrary) {
        loadingLibrary = Promise.all([
            import('three'),
            import('three/addons/controls/OrbitControls.js'),
        ]).then(([THREE, controls]) => {
            library = { THREE, OrbitControls: controls.OrbitControls };
            return library;
        }).finally(() => { loadingLibrary = null; });
    }
    return loadingLibrary;
}

// A colour of the page's theme, for what the 3D view draws in the interface's
// colours rather than ROSS's: the node rings and the highlight.
function themeColor(name, fallback) {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function makeStage(container) {
    const { THREE, OrbitControls } = library;
    // Throws where WebGL is off or missing; the caller says so on screen.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = 'rotor3d-canvas';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.001, 100);
    scene.add(camera);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4652, 1.5));
    // The key light rides with the camera, so the side you look at is lit.
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(0.5, 1, 0.3);
    camera.add(key);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', requestFrame);

    // The highlight: a translucent sleeve over the part under the pointer. One
    // mesh, moved and scaled; it is never rebuilt.
    const sleeveGeometry = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
    sleeveGeometry.rotateX(Math.PI / 2);
    const sleeve = new THREE.Mesh(sleeveGeometry, new THREE.MeshBasicMaterial({
        color: themeColor('--accent', 'steelblue'), transparent: true, opacity: 0.3,
        depthWrite: false, side: THREE.DoubleSide,
    }));
    sleeve.visible = false;
    scene.add(sleeve);

    const tip = document.createElement('div');
    tip.className = 'rotor3d-tip';
    tip.hidden = true;

    container.appendChild(renderer.domElement);
    container.appendChild(tip);

    renderer.domElement.addEventListener('pointermove', event => {
        const box = renderer.domElement.getBoundingClientRect();
        pointer = { x: event.clientX - box.left, y: event.clientY - box.top, width: box.width, height: box.height };
        requestFrame();
    });
    renderer.domElement.addEventListener('pointerleave', () => {
        pointer = null;
        requestFrame();
    });

    const fresh = { container, renderer, scene, camera, controls, sleeve, tip, raycaster: new THREE.Raycaster(), hovered: null };
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => { fitCanvas(fresh); requestFrame(); }).observe(container);
    }
    return fresh;
}

function fitCanvas(current) {
    const width = current.container.clientWidth;
    const height = current.container.clientHeight;
    if (!width || !height) return false;
    current.renderer.setSize(width, height, false);
    current.renderer.domElement.style.width = '100%';
    current.renderer.domElement.style.height = '100%';
    current.camera.aspect = width / height;
    current.camera.updateProjectionMatrix();
    return true;
}

// The camera is put back only when the rotor changed size noticeably: editing
// one disk should not undo the angle the person was looking from.
function needsFraming(bounds) {
    if (!framedFor) return true;
    const size = b => [0, 1, 2].map(i => b.max[i] - b.min[i]);
    const before = size(framedFor);
    const after = size(bounds);
    return after.some((value, i) => Math.abs(value - before[i]) > 0.25 * Math.max(before[i], 1e-6));
}

export function frameRotor() {
    if (!stage || !layout) return;
    const { camera, controls } = stage;
    const view = framing(layout.bounds, FOV, camera.aspect, direction);
    const [cx, cy, cz] = view.center;
    const [dx, dy, dz] = view.direction;
    const d = view.distance;
    camera.position.set(cx + dx * d, cy + dy * d, cz + dz * d);
    camera.near = Math.max(view.distance / 200, 1e-4);
    camera.far = view.distance * 20;
    camera.updateProjectionMatrix();
    controls.target.set(cx, cy, cz);
    controls.update();
    framedFor = layout.bounds;
    framedFrom = String(direction);
    requestFrame();
}

// Draw `scene` in `container`. The first call loads three.js; a browser
// without WebGL rejects, and the caller shows why.
export async function showRotor3d(container, scene) {
    await loadLibrary();
    if (!stage || stage.container !== container) {
        stage = makeStage(container);
        framedFor = null;
    }
    fitCanvas(stage);
    if (model) {
        stage.scene.remove(model.object);
        model.dispose();
        model = null;
    }
    layout = layoutScene(scene);
    direction = viewDirection(scene);
    model = buildRotorModel(library.THREE, layout, { ring: themeColor('--accent', 'steelblue') });
    stage.scene.add(model.object);
    stage.hovered = null;
    if (needsFraming(layout.bounds) || framedFrom !== String(direction)) frameRotor();
    requestFrame();
}

// While the 2D figure is on screen the 3D view keeps its renderer and its
// rotor, and only stops reacting to a pointer it can no longer see.
export function hideRotor3d() {
    pointer = null;
    if (stage) {
        stage.tip.hidden = true;
        stage.sleeve.visible = false;
    }
}

function requestFrame() {
    if (frameAsked || !stage) return;
    frameAsked = true;
    requestAnimationFrame(drawFrame);
}

function drawFrame() {
    frameAsked = false;
    if (!stage) return;
    showWhatIsUnderThePointer();
    stage.renderer.render(stage.scene, stage.camera);
}

function showWhatIsUnderThePointer() {
    const { sleeve, tip, raycaster, camera } = stage;
    let hit = null;
    if (pointer && layout && pointer.width && pointer.height) {
        const ndc = { x: (pointer.x / pointer.width) * 2 - 1, y: -(pointer.y / pointer.height) * 2 + 1 };
        raycaster.setFromCamera(ndc, camera);
        const { origin, direction } = raycaster.ray;
        hit = pickPart(layout.parts, [origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z]);
    }
    const part = hit ? hit.part : null;
    if (!part) {
        sleeve.visible = false;
        tip.hidden = true;
        stage.hovered = null;
        return;
    }
    const o = part.offset;
    const length = Math.abs(part.z1 - part.z0);
    sleeve.position.set(o.x, o.y, o.z + (part.z0 + part.z1) / 2);
    sleeve.scale.set(part.radius * 1.08, part.radius * 1.08, length + part.radius * 0.08);
    sleeve.visible = true;
    if (stage.hovered !== part.key) {
        tip.innerHTML = describePart(part);
        stage.hovered = part.key;
    }
    tip.hidden = false;
    // Beside the pointer, and turned back inside when it would leave the view.
    const left = pointer.x + 16 + tip.offsetWidth > pointer.width ? pointer.x - 16 - tip.offsetWidth : pointer.x + 16;
    const top = Math.min(pointer.y + 16, Math.max(0, pointer.height - tip.offsetHeight - 4));
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, top)}px`;
}

// --- what the tooltip says -----------------------------------------------------

const CATEGORY_NAMES = {
    shafts: () => t('catShaft'),
    disks: () => t('catDisk'),
    gears: () => t('catGear'),
    couplings: () => t('catCoupling'),
    bearings: () => t('catBearing'),
    seals: () => t('catSeal'),
    pointmasses: () => t('catPointMassLong'),
};

const mm = metres => `${(metres * 1000).toFixed(1)} mm`;
const number = value => (Math.abs(value) >= 1000 || Math.abs(value) < 0.01 ? value.toExponential(3) : value.toPrecision(4));

function line(label, value) {
    return `<div><span class="rotor3d-tip-label">${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`;
}

function halfName(part) {
    if (part.half === 'driving') return t('multiDriving');
    if (part.half === 'driven') return t('multiDriven');
    return '';
}

// The row's own words: its position in the list (from 1, as the list numbers
// it), its tag, its node -- and the few numbers that say what was drawn and
// why it is that size.
function describePart(part) {
    const e = part.entry;
    const name = (CATEGORY_NAMES[part.category] || (() => part.category))();
    const title = `${name} #${part.index + 1}` + (e.tag ? ` · ${e.tag}` : '');
    const rows = [];
    const half = halfName(part);
    if (half) rows.push(line(t('rotor3dLine'), half));
    rows.push(line(t('rotor3dNode'), String(e.n)));
    if (part.kind === 'shaft') {
        rows.push(line(t('rotor3dLength'), mm(Math.abs(part.z1 - part.z0))));
        const { odl, odr, idl, idr } = part.profile;
        rows.push(line(t('rotor3dOuter'), odl === odr ? mm(odl) : `${mm(odl)} → ${mm(odr)}`));
        if (idl || idr) rows.push(line(t('rotor3dInner'), idl === idr ? mm(idl) : `${mm(idl)} → ${mm(idr)}`));
    } else if (part.kind === 'disk') {
        rows.push(line(t('rotor3dMass'), `${number(e.m)} kg`));
        rows.push(line('Ip', `${number(e.Ip)} kg·m²`));
        if (e.shape) {
            rows.push(line(t('rotor3dOuter'), mm(2 * e.shape.outer_radius)));
            rows.push(line(t('rotor3dWidth'), mm(e.shape.width)));
        }
        rows.push(`<div class="rotor3d-tip-note">${escapeHtml(
            !e.shape ? t('rotor3dNoSize') : e.shape.exact ? t('rotor3dExactDisk') : t('rotor3dEquivalentDisk'))}</div>`);
    } else if (part.kind === 'gear') {
        rows.push(line(t('rotor3dMass'), `${number(e.m)} kg`));
        if (e.teeth) rows.push(line(t('rotor3dTeeth'), String(e.teeth)));
        if (e.pitch_radius) rows.push(line(t('rotor3dPitch'), mm(2 * e.pitch_radius)));
        if (e.width) rows.push(line(t('rotor3dWidth'), mm(e.width)));
        if (e.width_is_equivalent) rows.push(`<div class="rotor3d-tip-note">${escapeHtml(t('rotor3dEquivalentWidth'))}</div>`);
    } else if (part.kind === 'coupling') {
        rows.push(line(t('rotor3dLength'), mm(Math.abs(part.z1 - part.z0))));
        if (e.outer_diameter) rows.push(line(t('rotor3dOuter'), mm(e.outer_diameter)));
    } else if (part.kind === 'pointmass') {
        rows.push(line(t('rotor3dMass'), `${number(e.m)} kg`));
        rows.push(`<div class="rotor3d-tip-note">${escapeHtml(t('rotor3dNoSize'))}</div>`);
    } else {
        rows.push(line(t('rotor3dModel'), e.kind || ''));
        rows.push(`<div class="rotor3d-tip-note">${escapeHtml(t('rotor3dNoSize'))}</div>`);
    }
    if (part.hanging) rows.push(`<div class="rotor3d-tip-note">${escapeHtml(t('rotor3dLinkNode'))}</div>`);
    return `<div class="rotor3d-tip-title">${escapeHtml(title)}</div>${rows.join('')}`;
}
