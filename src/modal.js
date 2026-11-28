'use strict';

// Modal G-code state tracking for SINUMERIK programs.
//
// This module deliberately has no VS Code API dependency so it can be
// unit-tested with plain node (see test/modal.test.js). All positions
// are character offsets into the original document text.
//
// The tracker answers "which modal codes has this file selected so
// far?" by scanning the program text. It deliberately does NOT know
// the state at the start of the file: the power-on defaults come from
// machine data ($MC_GCODE_RESET_VALUES) and differ per machine, so
// groups the file never sets are reported as unknown, never guessed.

const { stripComments } = require('./parser');
const { lookupGCode } = require('./gcodes');

// Display order of the group-3 frame components.
const FRAME_COMPONENT_ORDER = ['translation', 'rotation', 'scaling', 'mirroring'];

/**
 * Return a copy of `text` in which the contents of double-quoted
 * strings are replaced by spaces. Same length as the input, so
 * offsets stay valid.
 */
function blankStrings(text) {
	const chars = text.split('');
	let inString = false;
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i];
		if (ch === '\n') {
			inString = false;
			continue;
		}
		if (inString) {
			chars[i] = ' ';
			if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			chars[i] = ' ';
		}
	}
	return chars.join('');
}

/**
 * Split program text into word tokens. A token is a run of letters
 * plus, for the letter G, the digits that follow it (so "G54" is one
 * token and the compact block "G54G90G1X10" still tokenizes into
 * G54 / G90 / G1 / X10). Comments and string contents never produce
 * tokens. Each token is { word, start, end, entry } where `entry` is
 * the dictionary entry from src/gcodes.js or null.
 */
function tokenize(text) {
	const code = blankStrings(stripComments(text));
	const tokens = [];
	let i = 0;
	while (i < code.length) {
		const ch = code[i];
		if (!/[A-Za-z]/.test(ch)) {
			i++;
			continue;
		}
		let j = i;
		while (j < code.length && /[A-Za-z]/.test(code[j])) {
			j++;
		}
		const letters = code.slice(i, j).toUpperCase();
		let word = letters;
		let end = j;
		if (letters === 'G') {
			let k = j;
			while (k < code.length && /[0-9]/.test(code[k])) {
				k++;
			}
			if (k > j) {
				word = `G${code.slice(j, k)}`;
				end = k;
			}
		}
		tokens.push({ word, start: i, end, entry: lookupGCode(word) });
		i = end;
	}
	return tokens;
}

/**
 * The modal state established by `text` up to (not including)
 * `offset`: for every modal G group, the code most recently selected
 * in the scanned range. Returns an array of { group, code } ordered
 * by group number. Group 3 (programmable frame) may appear several
 * times, once per frame component, because frame commands of
 * different components combine. Non-modal codes (G4, G53, SUPA, ...)
 * never appear: they do not change the modal state. Groups the
 * scanned text never sets are absent from the result.
 */
function modalStateAt(text, offset) {
	const limit = Math.max(0, Math.min(offset, text.length));
	const tokens = tokenize(text.slice(0, limit));
	const single = new Map(); // group -> code
	const frames = new Map(); // component -> code
	for (const token of tokens) {
		const entry = token.entry;
		if (!entry || !entry.modal) {
			continue;
		}
		if (entry.group === 3) {
			frames.set(entry.component, entry.code);
		} else {
			single.set(entry.group, entry.code);
		}
	}
	const byGroup = new Map();
	for (const [group, code] of single) {
		byGroup.set(group, [code]);
	}
	if (frames.size > 0) {
		byGroup.set(
			3,
			FRAME_COMPONENT_ORDER.filter((c) => frames.has(c)).map((c) => frames.get(c))
		);
	}
	return [...byGroup.keys()]
		.sort((a, b) => a - b)
		.flatMap((group) => byGroup.get(group).map((code) => ({ group, code })));
}

/**
 * One-line summary of a modal state, e.g. "G1 | G17 | G54 | G90".
 * Returns '' for an empty state.
 */
function formatModalState(state) {
	return state.map((s) => s.code).join(' | ');
}

/**
 * The dictionary entry for the code token at `offset`, or null when
 * the offset is not on a known code. Returns
 * { entry, start, end } with the token's range.
 */
function gcodeAtOffset(text, offset) {
	for (const token of tokenize(text)) {
		if (offset >= token.start && offset < token.end && token.entry) {
			return { entry: token.entry, start: token.start, end: token.end };
		}
	}
	return null;
}

module.exports = { tokenize, modalStateAt, formatModalState, gcodeAtOffset };
