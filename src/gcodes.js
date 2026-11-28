'use strict';

// Dictionary of SINUMERIK G codes and modal program words, for hover
// information and the modal-state tracker (see src/modal.js).
//
// Only codes whose G-group assignment has been verified against the
// official Siemens programming manual (Programming Manual
// Fundamentals / SINUMERIK ONE NC Programming, G-function table) are
// listed here. Do not add a code from memory: check the manual first,
// then append the entry.
//
// Entry fields:
//   group     G-group number from the manual's G-function table.
//   modal     true  = stays in effect until replaced in its group.
//             false = effective in the block in which it appears only.
//   component Group 3 only: which frame component the word sets
//             (frame commands of different components combine).
//   desc      Short meaning of the code.
const GCODES = {
	// Group 1: motion commands (modal)
	G0: { group: 1, modal: true, desc: 'Rapid traverse positioning' },
	G1: { group: 1, modal: true, desc: 'Linear interpolation (feed move)' },
	G2: { group: 1, modal: true, desc: 'Circular interpolation, clockwise' },
	G3: { group: 1, modal: true, desc: 'Circular interpolation, counterclockwise' },
	CIP: { group: 1, modal: true, desc: 'Circular interpolation via intermediate point' },
	G33: { group: 1, modal: true, desc: 'Thread cutting with constant lead' },

	// Group 2: special commands (non-modal)
	G4: { group: 2, modal: false, desc: 'Dwell (time or spindle revolutions)' },
	G74: { group: 2, modal: false, desc: 'Approach reference point (home position)' },
	G75: { group: 2, modal: false, desc: 'Approach fixed point' },

	// Group 3: programmable frame commands. The absolute forms
	// (TRANS/ROT/SCALE/MIRROR) replace the programmable frame, the
	// additive forms (ATRANS/...) add to it. Commands of different
	// components (translation/rotation/scaling/mirroring) combine,
	// so the tracker keeps the latest command per component.
	TRANS: { group: 3, modal: true, component: 'translation', desc: 'Programmable frame: absolute translation (zero offset)' },
	ATRANS: { group: 3, modal: true, component: 'translation', desc: 'Programmable frame: additive translation (zero offset)' },
	ROT: { group: 3, modal: true, component: 'rotation', desc: 'Programmable frame: absolute rotation' },
	AROT: { group: 3, modal: true, component: 'rotation', desc: 'Programmable frame: additive rotation' },
	SCALE: { group: 3, modal: true, component: 'scaling', desc: 'Programmable frame: absolute scaling' },
	ASCALE: { group: 3, modal: true, component: 'scaling', desc: 'Programmable frame: additive scaling' },
	MIRROR: { group: 3, modal: true, component: 'mirroring', desc: 'Programmable frame: absolute mirroring' },
	AMIRROR: { group: 3, modal: true, component: 'mirroring', desc: 'Programmable frame: additive mirroring' },

	// Group 6: working plane (modal)
	G17: { group: 6, modal: true, desc: 'Working plane X/Y (tool axis Z)' },
	G18: { group: 6, modal: true, desc: 'Working plane Z/X (tool axis Y)' },
	G19: { group: 6, modal: true, desc: 'Working plane Y/Z (tool axis X)' },

	// Group 7: tool radius compensation (modal)
	G40: { group: 7, modal: true, desc: 'Tool radius compensation off' },
	G41: { group: 7, modal: true, desc: 'Tool radius compensation, left of the contour' },
	G42: { group: 7, modal: true, desc: 'Tool radius compensation, right of the contour' },

	// Group 8: settable work offset (modal). Besides G54–G57, the
	// range G505–G599 holds further settable offsets; those are not
	// listed one by one but recognized as a pattern in lookupGCode.
	G500: { group: 8, modal: true, desc: 'Settable work offset off (basic frame only)' },
	G54: { group: 8, modal: true, desc: '1st settable work offset' },
	G55: { group: 8, modal: true, desc: '2nd settable work offset' },
	G56: { group: 8, modal: true, desc: '3rd settable work offset' },
	G57: { group: 8, modal: true, desc: '4th settable work offset' },

	// Group 9: frame suppression (non-modal, one block only)
	G53: { group: 9, modal: false, desc: 'Suppress settable work offset for one block' },
	SUPA: { group: 9, modal: false, desc: 'Suppress all frames and offsets for one block' },

	// Group 14: dimensioning (modal)
	G90: { group: 14, modal: true, desc: 'Absolute dimensioning' },
	G91: { group: 14, modal: true, desc: 'Incremental dimensioning' },

	// Group 15: feed type (modal)
	G93: { group: 15, modal: true, desc: 'Inverse-time feed (1/min)' },
	G94: { group: 15, modal: true, desc: 'Linear feed (mm/min)' },
	G95: { group: 15, modal: true, desc: 'Revolutional feed (mm/rev)' },
	G96: { group: 15, modal: true, desc: 'Constant cutting speed on' },
	G97: { group: 15, modal: true, desc: 'Constant cutting speed off (constant spindle speed)' }
};

// Display names of the G groups covered by GCODES.
const GROUP_NAMES = {
	1: 'Motion',
	2: 'Special commands',
	3: 'Programmable frame',
	6: 'Plane selection',
	7: 'Tool radius compensation',
	8: 'Work offset',
	9: 'Frame suppression',
	14: 'Dimensioning',
	15: 'Feed type'
};

/**
 * Look up a word (as written in the program, any case) in the
 * dictionary. G codes are normalized, so "G01" finds G1 and "g54"
 * finds G54. Words from the settable-offset range G505–G599 return a
 * generic group-8 entry. Returns an entry object
 * { code, group, modal, desc, component? } or null when the word is
 * not a known code.
 */
function lookupGCode(word) {
	if (!word) {
		return null;
	}
	const upper = String(word).toUpperCase();
	const gMatch = /^G(\d+)$/.exec(upper);
	if (gMatch) {
		const num = parseInt(gMatch[1], 10);
		const code = `G${num}`;
		if (Object.prototype.hasOwnProperty.call(GCODES, code)) {
			return { code, ...GCODES[code] };
		}
		if (num >= 505 && num <= 599) {
			return {
				code,
				group: 8,
				modal: true,
				desc: 'Settable work offset (from the G505–G599 range)'
			};
		}
		return null;
	}
	if (Object.prototype.hasOwnProperty.call(GCODES, upper)) {
		return { code: upper, ...GCODES[upper] };
	}
	return null;
}

module.exports = { GCODES, GROUP_NAMES, lookupGCode };
