// Entry point.
//
// No logic here: it wires the layers, fires the bootstrap and publishes on
// `window` the names the inline handlers of the HTML call. Everything else lives
// in `core/`, `components/` and `features/`.
//
// The bridge is temporary by construction: the next slice replaces the inline
// handlers with event delegation, and each converted handler erases a name from
// it.
import { closeAbout } from './components/about.js';
import { closeHelpModal, openAnalysisCardHelp } from './components/help.js';
import { handleUnitChange } from './components/form.js';
import { onReorder } from './components/list.js';
import { closeCustomAlert, closeCustomConfirm, closeCustomPrompt, confirmCustomPrompt } from './components/modals.js';
import { applyLanguage } from './core/i18n.js';
import { startPersistence, restoreState } from './core/persistence.js';
import { schemaReady } from './core/schema.js';
import { onProjectChanged } from './core/state.js';
import { addAnalysis, addAngleProbeRow, addForceRow, addProbeRow, addUnbalanceRow, checkDeps, deleteAnalysis, fillAnalysisTypes, runCardAnalysis, toggleAnalysis, toggleDashAdv } from './features/analysis.js';
import { copyRotorInHub, deleteRotorInHub, editRotorName, generatePythonFromHub, openRotorWorkspace, renderRotorHub, saveRotorFromHub } from './features/hub.js';
import { buildRotorLive, refreshHistoryButtons, startRotorFigureFollowsWidth } from './features/modeling.js';
import { startHistoryShortcuts } from './features/shortcuts.js';
import { closeMultiRotorModal, describeCoupling, saveMultiRotor } from './features/multirotor.js';
import { closeConcatenateModal, describeJoint, saveConcatenation, swapConcatenationOrder } from './features/concatenate.js';
import { startWorkBar } from './features/progress.js';
import { startTheme } from './core/theme.js';
import { startErrorNotice } from './features/error_notice.js';
import { defineActions, startActions } from './core/actions.js';
import { SHELL_ACTIONS } from './features/shell_actions.js';
import { MODELING_ACTIONS } from './features/modeling_actions.js';

// --- Wiring between layers -------------------------------------------------
//
// The element list does not know the rotor: it announces that the order changed,
// and whoever knows how to rebuild subscribes here. It was this inversion that
// removed the only path from a component to a feature -- and it was the one I
// created and forgot to connect, leaving dragging with no effect on the figure.
onReorder(buildRotorLive);

// The buttons grey out when there is nothing left to undo. The reason this is a
// hook and not a call from core/state.js is written there.
onProjectChanged(refreshHistoryButtons);

// What the buttons mean, by name (core/actions.js). One table per area of the
// page; the bridge below shrinks as the areas move over.
defineActions(SHELL_ACTIONS);
defineActions(MODELING_ACTIONS);



// The schema is loaded once at startup; openForm waits for it.
document.addEventListener('DOMContentLoaded', () => {
    // First, so that a failure in anything below is seen on screen.
    startErrorNotice();
    startActions();
    // The theme first: the head script already set the attribute before the first
    // paint, and this wires the buttons and the system's preference to it.
    startTheme();
    // The page is born in English in the HTML; the chosen language is applied as
    // soon as the schema arrives, along with the analysis titles that come with it.
    applyLanguage();
    // The bar that says what is being computed and offers the only way to stop
    // it. Here and not at module level because it takes hold of elements of the
    // page; `features/progress.js` exports a function and runs nothing on load.
    startWorkBar();
    // Ctrl+Z / Ctrl+Y: takes hold of the document, like the other `start*`.
    startHistoryShortcuts();
    // The rotor figure follows the width without losing ROSS's height.
    startRotorFigureFollowsWidth();
    schemaReady()
        .then(() => { applyLanguage(); fillAnalysisTypes(); })
        .catch(error => console.error('schema:', error));

    const rotors = restoreState();
    if (rotors) {
        console.info('state restored: ' + rotors + ' rotor(s)');
        // `restoreState` returns and does not draw -- the caller draws. This line was
        // missing when the dependency was inverted, and the result was the same defect
        // as the list hook: the rotors came back from memory and the Hub stayed empty
        // until the user touched something.
        renderRotorHub();
    }
    startPersistence();
});


// --- Bridge to the inline handlers of the HTML -----------------------------
//
// An ES module has its own scope: nothing is global unless someone puts it
// there. index.html and the HTML the cards generate call these functions by
// name, in `onclick`/`onchange` attributes. While that is so, they have to be on
// `window`, and this is the only place that puts them there -- before, there were
// 21 `window.x =` scattered through the file.
//
// The bridge is temporary by construction. The next slice replaces the inline
// handlers with event delegation, and each converted handler erases a name from
// here: the bridge shrinking is the measure of progress.
//
// `tests/js/test_bridge.js` guards both sides -- that every name called in a
// handler is here, and that nothing here has stopped being called.
Object.assign(window, {
    addAnalysis, addAngleProbeRow, addForceRow, addProbeRow, addUnbalanceRow,
    checkDeps, closeAbout, closeCustomAlert, closeCustomConfirm,
    closeCustomPrompt, closeHelpModal, closeConcatenateModal,
    closeMultiRotorModal, confirmCustomPrompt, describeJoint, copyRotorInHub,
    deleteAnalysis, deleteRotorInHub, editRotorName, generatePythonFromHub,
    handleUnitChange, openAnalysisCardHelp, describeCoupling,
    openRotorWorkspace, runCardAnalysis, saveConcatenation, saveMultiRotor,
    saveRotorFromHub, swapConcatenationOrder, toggleAnalysis, toggleDashAdv,
});
