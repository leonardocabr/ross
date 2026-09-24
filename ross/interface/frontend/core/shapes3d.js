// The geometry bank: other shapes an element can be drawn with in the 3D view
// -- a compressor impeller, a turbine wheel, a fan -- instead of its default.
//
// ONLY A PICTURE. Leonardo's decision: ROSS goes on computing with the mass
// and inertias of the element's form, and the shape chosen here is drawn in
// the envelope the element already has (its outer radius, its width). It is
// saved with the element, as `shape3d`, so a project opens as it was left;
// the server never passes it to ROSS nor writes it into the exported script
// (`VIEW_FIELDS` in domain/rotor_builder.py).
//
// The catalogue is data, here; how each shape is built is
// components/rotor3d_shapes.js, and the picker in the form is
// components/shape_picker.js. A key this catalogue does not know -- a project
// from a later version, a typo in a hand-edited file -- is drawn as the
// default, never as an error.
import { t } from './i18n.js';

// The element field the choice is kept in.
export const SHAPE_FIELD = 'shape3d';

// `minWidth`: some shapes need depth to read as what they are -- an impeller
// is a cone of blades, not a plate. Their width is at least this fraction of
// the outer radius (the layout widens the part, so what the pointer finds and
// what the camera frames stay what is drawn).
const CATALOGUE = {
    disks: [
        { key: '', name: () => t('shapeDiskPlain'), minWidth: 0 },
        { key: 'impeller', name: () => t('shapeImpeller'), minWidth: 0.42 },
        { key: 'axial', name: () => t('shapeAxialStage'), minWidth: 0.16 },
        { key: 'turbine', name: () => t('shapeTurbine'), minWidth: 0.16 },
        { key: 'fan', name: () => t('shapeFan'), minWidth: 0.22 },
        { key: 'flywheel', name: () => t('shapeFlywheel'), minWidth: 0 },
        { key: 'pulley', name: () => t('shapePulley'), minWidth: 0.2 },
    ],
};

// The shapes offered for a category, the default first. None for a category
// the bank does not cover yet.
export function shapesFor(category) {
    return CATALOGUE[category] || [];
}

// The shape a stored key means, or null for the default (and for a key the
// catalogue does not know).
export function shapeOf(category, key) {
    if (!key) return null;
    return shapesFor(category).find(shape => shape.key === key) || null;
}
