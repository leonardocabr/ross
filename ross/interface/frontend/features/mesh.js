// Discretizing the shafts: every element longer than a number of diameters
// is cut into equal parts (domain/meshing.py), so the user draws the shaft by
// its sections -- one row per step of diameter -- and the model gets the
// elements it needs to be right.
//
// THE RULE, and why it is asked for as a ratio. API RP 684 (section 1.5.2.1)
// asks for no section longer than 1.0 diameter, 0.5 preferred, and none
// shorter than 0.1. The dialog opens on 0.5; the server refuses anything that
// is not a positive number, by name.
//
// The server answers the cut project AND the plan, and the plan is shown
// before the project is taken on: how many elements each shaft becomes, which
// ones are too short to fix, which spans a coupling keeps whole. Nothing is
// changed until the person says yes -- and after, Undo takes it back like any
// other edit.
import { openCustomAlert, openCustomConfirm, openCustomPrompt } from '../components/modals.js';
import { apiFetch } from '../core/api.js';
import { t } from '../core/i18n.js';
import { applyProject, withoutAnalyses } from './split.js';

export const DEFAULT_MAX_LD = '0.5';

// A plan with more lines than this ends in "..." -- a rotor of fifty shafts
// cut would otherwise be a dialog taller than the screen.
const MOST_LINES = 8;

function fill(template, ...values) {
    return values.reduce(
        (text, value, position) => text.split('%' + (position + 1)).join(String(value)),
        template,
    );
}

// "#2 Body" for the rows of a span, as the list numbers them (from 1).
function rowsName(rows, shafts) {
    return rows.map(index => {
        const tag = String((shafts[index] || {}).tag || '').trim();
        return tag ? `#${index + 1} ${tag}` : `#${index + 1}`;
    }).join(' + ');
}

const ratio = value => (typeof value === 'number' && isFinite(value) ? value.toFixed(2) : '?');

// The plan in words, one line per span cut, then what could not be done.
export function meshSummary(report, shafts) {
    const lines = [fill(t('meshSummary'), report.before, report.after)];
    const cut = report.cut || [];
    cut.slice(0, MOST_LINES).forEach(step => {
        lines.push(fill(t('meshCutLine'), rowsName(step.rows, shafts), ratio(step.ratio), step.parts));
    });
    if (cut.length > MOST_LINES) lines.push('...');
    const short = report.short || [];
    if (short.length) {
        lines.push('', t('meshShortTitle'));
        short.slice(0, MOST_LINES).forEach(step => {
            lines.push(fill(t('meshShortLine'), rowsName(step.rows, shafts), ratio(step.ratio)));
        });
        if (short.length > MOST_LINES) lines.push('...');
    }
    const kept = (report.kept || []).filter(step => step.why === 'coupling');
    if (kept.length) lines.push('', fill(t('meshKeptCoupling'), kept.map(step => rowsName(step.rows, shafts)).join(', ')));
    return lines.join('\n');
}

// Answers whether the project changed. `indexes`: the shaft rows ticked in
// the list, or none for every shaft.
export async function meshProject(data, indexes) {
    const shafts = (data && data.shafts) || [];
    if (!shafts.length) return false;

    const question = indexes && indexes.length ? fill(t('meshAskPicked'), indexes.length) : t('meshAsk');
    const typed = await openCustomPrompt(question, DEFAULT_MAX_LD);
    if (typed === null || typed === undefined || String(typed).trim() === '') return false;

    let answer;
    try {
        answer = await apiFetch('/api/rotor/mesh_shafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project: withoutAnalyses(data),
                max_ld: String(typed).trim().replace(',', '.'),
                indexes: indexes || [],
            }),
        });
    } catch (error) {
        await openCustomAlert(t('meshFailed'));
        return false;
    }
    const body = await answer.json();
    if (!answer.ok) {
        await openCustomAlert(body.message || t('meshFailed'));
        return false;
    }

    const report = body.report || {};
    if (!(report.cut || []).length) {
        // Nothing to cut; what is too short is still worth knowing.
        await openCustomAlert([t('meshNothing'), meshSummary(report, shafts).split('\n').slice(1).join('\n')]
            .filter(Boolean).join('\n'));
        return false;
    }
    if (!(await openCustomConfirm(meshSummary(report, shafts)))) return false;
    applyProject(data, body.projectData);
    return true;
}
