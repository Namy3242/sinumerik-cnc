'use strict';

// Diagnostic for a modal subprogram call that is never cancelled.
//
// This module deliberately has no VS Code API dependency so it can be
// unit-tested with plain node (see test/mcall.test.js). All
// positions are character offsets into the original document text.
//
// "MCALL <name>(...)" makes a subprogram (or cycle) modal: it is
// called again after every subsequent traversing block until it is
// cancelled. The one cancellation form this check recognizes is a
// bare MCALL block — MCALL with nothing after it on the block. That
// narrow reading is deliberate: other wordings are not guessed at,
// so the warning stays free of false positives.
//
// While scanning, the check tracks the currently active MCALL (a
// second MCALL with a target replaces the first). When a program
// end (M2, M30, M17 or RET) is reached with a call still active —
// or the file simply ends — the active MCALL is reported once, as a
// warning on the MCALL keyword itself. Keywords inside comments and
// strings never count.

const { stripComments } = require('./parser');

// Words that end a program (or subprogram) for this check.
const PROGRAM_ENDS = new Set(['M2', 'M30', 'M17', 'RET']);

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
 * Split `text` into lines. Returns [{ start, content }] where `start`
 * is the offset of the line's first character and `content` excludes
 * the line ending (a trailing "\r" counts as part of the ending).
 */
function splitLines(text) {
	const lines = [];
	let start = 0;
	for (let i = 0; i <= text.length; i++) {
		if (i === text.length || text[i] === '\n') {
			let content = text.slice(start, i);
			if (content.endsWith('\r')) {
				content = content.slice(0, -1);
			}
			lines.push({ start, content });
			start = i + 1;
		}
	}
	return lines;
}

/** Word tokens of one line: [{ word, start, end }] (uppercased word). */
function lineWords(line) {
	const words = [];
	const re = /[A-Za-z_][A-Za-z0-9_]*/g;
	let m;
	while ((m = re.exec(line.content)) !== null) {
		words.push({
			word: m[0].toUpperCase(),
			raw: m[0],
			start: line.start + m.index,
			end: line.start + m.index + m[0].length
		});
	}
	return words;
}

/**
 * Check `text` for a modal call that is still active at a program
 * end or at the end of the file. Returns diagnostics as
 * [{ kind, start, end, message }] with kind 'mcall-not-cancelled',
 * sorted by start offset. The range covers the MCALL keyword of the
 * call that was left active.
 */
function checkMcall(text) {
	const code = blankStrings(stripComments(text));
	const diagnostics = [];
	let active = null; // { start, end, target }

	const report = () => {
		diagnostics.push({
			kind: 'mcall-not-cancelled',
			start: active.start,
			end: active.end,
			message:
				`Modal call MCALL ${active.target} is still active here; ` +
				'it is never cancelled. End it with a bare MCALL block ' +
				'before the program ends.'
		});
		active = null;
	};

	for (const line of splitLines(code)) {
		const words = lineWords(line);
		for (let w = 0; w < words.length; w++) {
			const token = words[w];
			if (token.word === 'MCALL') {
				// MCALL is modal state, and a block holds at most one
				// meaningful MCALL: if a word follows it on the block
				// it (re)activates a call, otherwise it cancels.
				const next = words[w + 1];
				if (next) {
					active = { start: token.start, end: token.end, target: next.raw };
				} else if (active) {
					active = null;
				}
				// Nothing after an MCALL on the same block changes
				// the modal state further for this check.
				break;
			}
			if (PROGRAM_ENDS.has(token.word) && active) {
				report();
			}
		}
	}
	if (active) {
		report();
	}
	diagnostics.sort((a, b) => a.start - b.start);
	return diagnostics;
}

module.exports = { checkMcall };
