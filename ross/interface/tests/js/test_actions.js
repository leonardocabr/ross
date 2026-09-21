// What the buttons mean, by name -- and that every name means something.
//
// WHY THIS BATTERY EXISTS. The page is moving off the `window` bridge
// (core/actions.js): a button now says `data-action="save-rotor"` and one
// listener looks the name up. The failure this trades away was silent -- a
// function missing from `window` left its button dead. The failure it could
// introduce is the same one under a new name: a `data-action` nobody defined.
// So the table is read against the HTML in both directions, every action is
// pressed once, and the listener's rules are checked on plain objects.
import { check, node, shutDown } from './fake_dom.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'success' }) });
// Screens and side panels announce a resize; Node's global is not an EventTarget.
globalThis.dispatchEvent = () => true;

const { actionNames, defineActions, handleEvent, runAction, startActions } =
    await import('../../frontend/core/actions.js');
await import('../../frontend/main.js');

const FRONTEND = fileURLToPath(new URL('../../frontend/', import.meta.url));
const PAGE = fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8');

function sources(folder) {
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) return ['lib', 'vendor'].includes(entry.name) ? [] : sources(full);
        return entry.name.endsWith('.js') ? [fs.readFileSync(full, 'utf8')] : [];
    });
}
const TEXTS = [PAGE, ...sources(FRONTEND)];
const named = new Set();
for (const text of TEXTS) for (const m of text.matchAll(/data-action="([a-z-]+)"/g)) named.add(m[1]);

// --- the table and the page agree -------------------------------------------------

check('the page names actions at all', named.size > 10);
const undefinedNames = [...named].filter(name => !actionNames().includes(name));
check('every action the page names is defined: ' + undefinedNames.join(', '), undefinedNames.length === 0);
const unusedNames = actionNames().filter(name => !named.has(name));
check('and every defined action is named somewhere: ' + unusedNames.join(', '), unusedNames.length === 0);

// The attributes the adapters read have to point at something that exists.
const ids = new Set([...PAGE.matchAll(/\sid="([\w-]+)"/g)].map(m => m[1]));
const inputs = [...PAGE.matchAll(/data-action="choose-file" data-input="([\w-]+)"/g)].map(m => m[1]);
check('every file button names its input', inputs.length === 4);
check('and each of those inputs is on the page', inputs.every(id => ids.has(id)));
const screens = [...PAGE.matchAll(/data-action="show-screen" data-screen="([\w-]+)"/g)].map(m => m[1]);
check('every screen button names a screen that exists', screens.length > 0 && screens.every(id => ids.has(id)));

// --- the listener's rules ------------------------------------------------------------

let pressed = [];
defineActions({ 'battery-probe': (element, event) => { pressed.push([element, event]); return 'done'; } });

function element(tagName, action, extra) {
    const el = Object.assign({ tagName, dataset: { action }, disabled: false }, extra || {});
    el.closest = () => el;
    return el;
}

const button = element('BUTTON', 'battery-probe');
handleEvent({ type: 'click', target: button });
check('a click on a button runs its action', pressed.length === 1 && pressed[0][0] === button);

// The icon inside a button is what the pointer usually lands on.
const icon = { closest: () => button };
handleEvent({ type: 'click', target: icon });
check('and so does a click on the icon inside it', pressed.length === 2);

handleEvent({ type: 'click', target: element('BUTTON', 'battery-probe', { disabled: true }) });
check('a disabled button does nothing', pressed.length === 2);

// A hidden file input is opened by `input.click()`; that click must not run the
// input's own action before any file was chosen.
handleEvent({ type: 'click', target: element('INPUT', 'battery-probe') });
check('a click on a form field does not run its action', pressed.length === 2);
handleEvent({ type: 'change', target: element('SELECT', 'battery-probe') });
check('its change does', pressed.length === 3);
handleEvent({ type: 'change', target: element('BUTTON', 'battery-probe') });
check('and a change never runs a button', pressed.length === 3);

handleEvent({ type: 'click', target: { closest: () => null } });
check('a click on nothing in particular is nothing', pressed.length === 3);

let thrown = null;
try { runAction(element('BUTTON', 'no-such-thing')); } catch (error) { thrown = error; }
// The whole point: the dead-button failure now has a name, and the error
// notice shows it.
check('a name nobody defined fails, and says which', thrown && /no-such-thing/.test(thrown.message));

thrown = null;
try { defineActions({ 'battery-probe': () => {} }); } catch (error) { thrown = error; }
check('a name defined twice is refused', thrown && /twice/.test(thrown.message));

// The listener itself: one for clicks and one for changes, on the document.
// Without the second, the language selects and the file inputs go dead.
const listening = {};
const realAdd = document.addEventListener;
document.addEventListener = (type, handler) => { listening[type] = handler; };
startActions();
document.addEventListener = realAdd;
check('the document listens for clicks', listening.click === handleEvent);
check('and for changes', listening.change === handleEvent);

// --- what a few of them do -------------------------------------------------------------

let opened = null;
node('upload-rotor-hub').click = () => { opened = 'upload-rotor-hub'; };
runAction(element('BUTTON', 'choose-file', { dataset: { action: 'choose-file', input: 'upload-rotor-hub' } }));
check('a file button opens the input it names', opened === 'upload-rotor-hub');

// --- every action, pressed once ----------------------------------------------------------
//
// The same promise the smoke battery makes for the bridge: nothing throws on
// the way in. `exit` is left out for the reason the smoke battery gave: it
// shuts the server down and closes the window.
const LEFT_OUT = ['exit', 'battery-probe'];
const event = { preventDefault() {}, stopPropagation() {}, target: { files: [], value: '' } };
const attributes = { input: 'upload-rotor-hub', screen: 'screen-modeling' };
const failures = [];
for (const name of actionNames().filter(n => !LEFT_OUT.includes(n))) {
    const el = element(name === 'change-language' ? 'SELECT' : 'BUTTON', name,
        { dataset: Object.assign({ action: name }, attributes), value: 'en' });
    try {
        const answer = runAction(el, event);
        // Not awaited: several of them open a dialog and wait for an answer
        // that never comes here. Their failures are still collected.
        if (answer && typeof answer.then === 'function') answer.catch(error => failures.push(name + ': ' + error.message));
    } catch (error) {
        failures.push(name + ': ' + error.message);
    }
}
await new Promise(done => setTimeout(done, 200));
check('every action runs without throwing: ' + failures.join(' | '), failures.length === 0);

// --- the ratchet -------------------------------------------------------------------------
//
// How many inline handlers are left in index.html. It only goes down: each
// stage of the move lowers it, and a new `onclick=` in the page fails here.
// The five `onerror` on the logo images are not calls to anything on the
// bridge (they hide a missing picture) and are counted apart.
const inline = (PAGE.match(/\son(?!error)[a-z]+="/g) || []).length;
check('inline handlers left in index.html: ' + inline + ' (at most 42)', inline <= 42);

shutDown();
