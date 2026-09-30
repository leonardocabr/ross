// Discretizing the shafts from the list: what it asks, what it sends, what it
// shows before changing anything, and that nothing changes until "yes".
//
// WHY THIS BATTERY EXISTS. Discretizing can turn three rows into sixty and
// renumber every disk and bearing. The screen's part is to say that before it
// happens -- how many elements each shaft becomes, and what the rule cannot
// fix -- and to leave the project alone when the person says no. The cut
// itself is Python's (tests/test_meshing.py, held to ROSS's refine_mesh).
import { check, node, shutDown } from './fake_dom.js';

const { DEFAULT_MAX_LD, meshProject, meshSummary } = await import('../../frontend/features/mesh.js');
const { closeCustomAlert, closeCustomConfirm, closeCustomPrompt } = await import('../../frontend/components/modals.js');
const { setSchemaLanguage, t } = await import('../../frontend/core/i18n.js');

function project() {
    return {
        name: 'Rig', uid: 'uid_rig', savedAnalyses: [{ figure: 'heavy' }],
        materials: [{ name: 'Steel' }],
        shafts: [
            { L: '400', odl: '200', tag: 'Inlet' },
            { L: '10', odl: '200' },
            { L: '300', odl: '200', tag: 'Outlet' },
        ],
        disks: [{ n: '2', m: '10' }], gears: [], couplings: [], seals: [],
        bearings: [{ n: '0' }, { n: '3' }], pointmasses: [],
    };
}

const REPORT = {
    cut: [{ rows: [0], parts: 4, ratio: 2 }, { rows: [2], parts: 3, ratio: 1.5 }],
    short: [{ rows: [1], ratio: 0.05 }],
    kept: [],
    before: 3,
    after: 8,
};
const CUT = {
    shafts: new Array(8).fill(0).map((_, i) => ({ L: '100', odl: '200', tag: 'piece ' + i })),
    disks: [{ n: '5', m: '10' }],
    bearings: [{ n: '0' }, { n: '8' }],
};

let sent = null;
function serverAnswers(ok, payload) {
    globalThis.fetch = async (path, options) => {
        sent = { path, body: JSON.parse(options.body) };
        return { ok, json: async () => payload };
    };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// Types `typed` in the box, then answers the next dialog with `yes` (a confirm)
// or closes it (an alert); reads what each said.
async function run(data, indexes, typed, yes) {
    const finished = meshProject(data, indexes);
    await tick();
    const asked = node('custom-prompt-message').innerText;
    const offered = node('custom-prompt-input').value;
    closeCustomPrompt(typed);
    await tick(); await tick();
    const confirmed = node('custom-confirm-message').innerText;
    const alerted = node('custom-alert-message').innerText;
    if (yes === 'alert') closeCustomAlert(); else if (yes !== undefined) closeCustomConfirm(yes);
    const result = await finished;
    node('custom-confirm-message').innerText = '';
    node('custom-alert-message').innerText = '';
    return { asked, offered, confirmed, alerted, result };
}

// --- the plan in words -------------------------------------------------------------
console.log('\nThe plan, before anything changes');

const words = meshSummary(REPORT, project().shafts);
check('says how many elements the shafts go from and to', words.includes('3') && words.includes('8'));
check('names each shaft cut by its position and its name', words.includes('#1 Inlet') && words.includes('#3 Outlet'));
check('with its L/D and the parts it becomes', words.includes('2.00') && words.includes('4'));
check('and what cutting cannot fix, by the API 684 floor', words.includes(t('meshShortTitle')) && words.includes('#2') && words.includes('0.05'));
const many = { ...REPORT, cut: new Array(20).fill(0).map((_, i) => ({ rows: [i], parts: 2, ratio: 1 })) };
check('a long plan ends in "..." instead of a dialog taller than the screen', meshSummary(many, []).split('\n').length < 15);
check('a span kept whole beside a coupling is said',
    meshSummary({ ...REPORT, kept: [{ rows: [1], why: 'coupling' }] }, project().shafts).includes('#2'));

// --- the trip -------------------------------------------------------------------------------
console.log('\nAsking, sending, taking the answer on');

const data = project();
serverAnswers(true, { status: 'success', projectData: CUT, report: REPORT });
const accepted = await run(data, [], '0,5', true);
check('the box opens on API 684\'s preferred ratio', accepted.offered === DEFAULT_MAX_LD && DEFAULT_MAX_LD === '0.5');
check('and the question cites the rule', /API RP 684/.test(accepted.asked));
check('the route is the one the server serves', sent.path === '/api/rotor/mesh_shafts');
check('a decimal comma is read as the point it means', sent.body.max_ld === '0.5');
check('nothing ticked asks for every shaft', Array.isArray(sent.body.indexes) && sent.body.indexes.length === 0);
check('the saved analyses stay behind', sent.body.project.savedAnalyses === undefined);
check('the plan is shown before the project is taken on', accepted.confirmed.includes('#1 Inlet'));
check('yes takes the project on', accepted.result === true && data.shafts.length === 8 && data.disks[0].n === '5');
check('and keeps the saved analyses and the identity', data.savedAnalyses.length === 1 && data.uid === 'uid_rig');

const declined = project();
serverAnswers(true, { status: 'success', projectData: CUT, report: REPORT });
const no = await run(declined, [], '0.5', false);
check('no leaves the project exactly as it was', no.result === false && JSON.stringify(declined) === JSON.stringify(project()));

const ticked = project();
serverAnswers(true, { status: 'success', projectData: CUT, report: REPORT });
const some = await run(ticked, [0, 2], '1', false);
check('the shafts ticked are the ones sent', JSON.stringify(sent.body.indexes) === '[0,2]');
check('and the question says how many', some.asked.includes('2'));

// --- the ways out ---------------------------------------------------------------------------
console.log('\nThe ways out');

sent = null;
const escaped = await run(project(), [], null);
check('Escape sends nothing and changes nothing', sent === null && escaped.result === false);
sent = null;
const blank = await run(project(), [], '  ');
check('an empty box is not a ratio', sent === null && blank.result === false);
check('a rotor with no shaft asks nothing', (await meshProject({ shafts: [] }, [])) === false);

const refused = project();
serverAnswers(false, { status: 'error', message: "The largest L/D has to be a positive number, not 'much'." });
const refusal = await run(refused, [], 'much', 'alert');
check('a refusal shows the server\'s sentence', /not 'much'/.test(refusal.alerted));
check('and changes nothing', refusal.result === false && refused.shafts.length === 3);

const already = project();
serverAnswers(true, { status: 'success', projectData: project(), report: { cut: [], short: REPORT.short, kept: [], before: 3, after: 3 } });
const nothing = await run(already, [], '1', 'alert');
check('nothing to cut says so, with no question to answer', nothing.alerted.includes(t('meshNothing')) && nothing.confirmed === '');
check('and still names what is too short', nothing.alerted.includes('#2'));
check('and changes nothing', nothing.result === false);

setSchemaLanguage('pt');
check('the question is translated', /no máximo 1,0/.test(t('meshAsk')));
setSchemaLanguage('en');

shutDown();
