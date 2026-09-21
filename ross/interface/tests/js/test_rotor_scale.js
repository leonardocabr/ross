// Stretching the rotor figure vertically, and saying so.
//
// WHY THIS BATTERY EXISTS. A stretched figure with no label is the one
// dishonest thing this feature can produce: an engineer reading a rotor and not
// suspecting the scale draws the wrong conclusion about slenderness, which is
// the property the picture is there to convey. So the check that matters is not
// "does it stretch" -- it is that **stretching and labelling cannot be
// separated**, and that asking for no stretch changes nothing at all.
import { check, shutDown } from './fake_dom.js';

const { VERTICAL_SCALES, withVerticalScale } =
    await import('../../frontend/core/rotor_scale.js');

// Read defensively on purpose. The claim this file exists to defend is that a
// stretch cannot happen without a label, and a check for it has to **fail by
// name** when the label goes -- not bring the battery down with a TypeError on
// an axis that has no title. A mutation that removes `stretchTitle` used to do
// exactly that: detected, but unreadable.
function titleOf(layout) {
    const axis = (layout && layout.yaxis) || {};
    const title = axis.title;
    return (title && typeof title === 'object' ? title.text : title) || '';
}

// What `plot_rotor` really answers, measured on a six-element rotor:
// height 332, margins t:100 b:102, and the 1:1 lock on the y axis.
function rossLayout() {
    return {
        height: 332,
        margin: { l: 70, r: 25, t: 100, b: 102 },
        yaxis: {
            scaleanchor: 'x',
            scaleratio: 1,
            title: { text: 'Shaft radius (m)' },
        },
    };
}

// --- no stretch changes nothing -------------------------------------------------

const asIs = withVerticalScale(rossLayout(), 1, 'vertical scale 1×');
check('at one times the height is ROSS\'s own', asIs.height === 332);
check('and the ratio is untouched', asIs.yaxis.scaleratio === 1);
// The label would be a lie in the other direction: it would warn about a
// distortion that is not there.
check('and the axis says nothing extra', titleOf(asIs) === 'Shaft radius (m)');

// Controls: anything that is not a stretch is treated as none.
['0', '', 'abc', null, undefined, -3].forEach(bad => {
    const same = withVerticalScale(rossLayout(), bad, 'x');
    check('a scale of ' + JSON.stringify(bad) + ' leaves the figure alone',
        same.height === 332 && same.yaxis.scaleratio === 1);
});

// --- stretching ------------------------------------------------------------------

const three = withVerticalScale(rossLayout(), 3, 'vertical scale 3×');

check('the ratio is the factor asked for', three.yaxis.scaleratio === 3);
// The plot area has to grow with it, or Plotly honours the ratio by shrinking
// the x domain and the rotor comes out narrower instead of taller.
check('the plot area grew by the same factor',
    three.height === (332 - 100 - 102) * 3 + 100 + 102);
// The margins reserve fixed bands for the axis title, the toggle buttons and
// the axes indicator: growing them would move those.
check('the margins were not touched',
    three.margin.t === 100 && three.margin.b === 102);

// --- the label, which is the whole point ------------------------------------------

check('the axis carries the warning', /vertical scale 3×/.test(titleOf(three)));
check('without losing what it said before',
    /Shaft radius \(m\)/.test(titleOf(three)));

// --- the argument is never touched ------------------------------------------------
//
// The property that replaces idempotence, and the one that protects the caller.
// The screen keeps the figure the server sent so that changing the factor
// redraws without asking again; if stretching wrote into it, going 1× → 5× → 2×
// would compound the height and stack the note. A first version of this module
// stripped a previous note and let the height compound -- correct-looking and
// wrong, which is worse than plainly wrong.
const original = rossLayout();
const copy = withVerticalScale(original, 4, 'note');

check('the layout that went in still has ROSS\'s height', original.height === 332);
check('and ROSS\'s ratio', original.yaxis.scaleratio === 1);
check('and no note on its axis', titleOf(original) === 'Shaft radius (m)');
check('while the one that came out is stretched', copy.height !== 332);

// So the same source can be stretched twice at different factors, which is what
// the picker does, and neither answer knows about the other.
const twoTimes = withVerticalScale(original, 2, 'note 2');
const fiveTimes = withVerticalScale(original, 5, 'note 5');
check('two draws from one figure do not compound',
    twoTimes.height === 130 * 2 + 202 && fiveTimes.height === 130 * 5 + 202);
check('and neither note carries the other',
    !/note 5/.test(titleOf(twoTimes)) && !/note 2/.test(titleOf(fiveTimes)));

// An axis with no title at all still gets the warning: the note is what cannot
// be dropped.
const bare = withVerticalScale({ height: 300, margin: { t: 10, b: 10 }, yaxis: {} }, 2, 'note');
check('an axis with no title still gets the note', titleOf(bare) === 'note');
check('and a layout with no yaxis does not throw',
    withVerticalScale({ height: 300, margin: {} }, 2, 'note').yaxis.scaleratio === 2);

// --- what the control offers --------------------------------------------------------

check('the first choice is the true proportion', VERTICAL_SCALES[0] === 1);
check('and there is more than one choice', VERTICAL_SCALES.length > 1);
check('every choice is a stretch, never a squeeze',
    VERTICAL_SCALES.every(times => times >= 1));

shutDown();
