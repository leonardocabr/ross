import { recordChange, resetHistory, structuralSnapshot } from './history.js';

// The six values that cross module boundaries, in one named object.
//
// This is not a state framework and does not want to be: it is the minimum set
// of what several parts read **and write**. They live in an object because
// `export let` is read-only for importers -- and because this way a mutation
// has an address and a search finds it. The goal of the coming slices is for
// this object to shrink.
export const state = {
    rotorLibrary: [],
    activeRotorIndex: -1,
    projectData: { materials: [], shafts: [], disks: [], gears: [], couplings: [],
                   seals: [], bearings: [], pointmasses: [] },
    currentTab: null,
    editingIndex: -1,
    currentSubType: 'BASIC',
    // Which of a MultiRotor's two rotors is being edited. It used to live in
    // `state.multiRotorEditTarget`, read and written by three modules -- a seventh
    // shared value, only without an address.
    multiRotorEditTarget: 'driving',
};


// Returns data for the active rotor on the screen (whether a simple rotor or the selected half of a multi-rotor)
export function getActiveData() {
    if (state.projectData.isMultiRotor) {
        return state.multiRotorEditTarget === 'driven' ? state.projectData.driven_rotor : state.projectData.driving_rotor;
    }
    return state.projectData;
}

// Called by whoever changes the open project. It has one subscriber -- the two
// history buttons, which have to grey out the moment there is nothing left to
// undo -- and it is a hook rather than a direct call because this module has no
// business touching the DOM. Same shape as `onReorder` in components/list.js.
//
// The default is a no-op and not a throw, unlike `onReorder`: this fires on
// every mutation, including inside the node batteries, where nobody has any
// reason to subscribe.
let changeHandler = () => {};

export function onProjectChanged(fn) {
    changeHandler = fn;
}

// Writes the open project back to the library, records the step for undo, and
// tells whoever is listening.
//
// The write-back only does something for a MultiRotor: for a plain rotor
// `state.projectData` **is** the library entry (`openRotorWorkspace` assigns
// the object itself, not a copy), so there is nothing to copy across.
//
// The history is recorded here because this is the one call every mutation of
// the modelling screen already makes -- see the comment at the top of
// core/history.js for why that matters more than it looks.
export function syncBackToLibrary() {
    writeBackToLibrary();
    recordChange(structuralSnapshot(state.projectData));
    changeHandler();
}

// A rotor was opened: its history starts empty, holding this model as the state
// the first change will come back to.
//
// It lives here, beside `syncBackToLibrary`, and not in the Hub calling
// `resetHistory` directly -- which is what it did, and it was a bug the node
// battery could not see. Emptying the stacks is a change to the history exactly
// like recording a step is, and the buttons have to hear about both; the Hub
// emptied them and told nobody, so the buttons kept the state they had under
// the *previous* rotor and undo arrived alive in a model with no history.
//
// Putting both behind this module is what makes that impossible rather than
// merely fixed: there is no way to change the history without announcing it.
export function openProjectHistory(project) {
    resetHistory(structuralSnapshot(project));
    changeHandler();
}

// The same write-back with no history and no notification, for undo and redo:
// they put a snapshot on screen, and a restore that recorded itself would push
// what it just undid back onto the stack.
export function writeBackToLibrary() {
    if (state.projectData.isMultiRotor) {
        let drvLib = state.rotorLibrary.find(r => r.uid === state.projectData.driving_uid);
        if (drvLib) Object.assign(drvLib, JSON.parse(JSON.stringify(state.projectData.driving_rotor)));
        
        let drvnLib = state.rotorLibrary.find(r => r.uid === state.projectData.driven_uid);
        if (drvnLib) Object.assign(drvnLib, JSON.parse(JSON.stringify(state.projectData.driven_rotor)));
    }
}

// Operations on the rotor library, used by the Hub and by the MultiRotor.
// They lived in the MultiRotor module by accident of history: they touch
// `rotorLibrary` and nothing else.
export function ensureUIDs() {
    state.rotorLibrary.forEach(r => {
        if (!r.uid) r.uid = 'rotor_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    });
}

export function syncMultiRotors() {
    state.rotorLibrary.forEach(mr => {
        if (mr.isMultiRotor) {
            let drv = state.rotorLibrary.find(r => r.uid === mr.driving_uid);
            if (drv) mr.driving_rotor = JSON.parse(JSON.stringify(drv));
            
            let drvn = state.rotorLibrary.find(r => r.uid === mr.driven_uid);
            if (drvn) mr.driven_rotor = JSON.parse(JSON.stringify(drvn));
        }
    });
}
