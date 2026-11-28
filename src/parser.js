'use strict';

// Pure parsing helpers for SINUMERIK cycle calls.
//
// This module deliberately has no VS Code API dependency so it can be
// unit-tested with plain node (see test/parser.test.js). All positions
// are character offsets into the original document text.

/**
 * Return a copy of `text` in which every comment (from `;` to the end
 * of the line) is replaced by spaces. The result has exactly the same
 * length as the input, so offsets stay valid. Semicolons inside
 * double-quoted strings are not treated as comment starts.
 */
function stripComments(text) {
	const chars = text.split('');
	let inString = false;
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i];
		if (ch === '\n') {
			inString = false;
			continue;
		}
		if (inString) {
			if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === ';') {
			let j = i;
			while (j < chars.length && chars[j] !== '\n') {
				chars[j] = ' ';
				j++;
			}
			i = j - 1;
		}
	}
	return chars.join('');
}

/**
 * Split the argument list that starts at `openParen` (the index of `(`)
 * in `code`. Commas nested inside parentheses or strings do not split.
 * Returns { args, closeParen } where closeParen is the index of the
 * matching `)`, or -1 when the list is not closed.
 */
function parseArgs(code, openParen) {
	const segments = [];
	let depth = 0;
	let inString = false;
	let segStart = openParen + 1;
	let closeParen = -1;

	const pushSegment = (end) => {
		const raw = code.slice(segStart, end);
		const lead = raw.length - raw.trimStart().length;
		const trail = raw.length - raw.trimEnd().length;
		segments.push({
			start: segStart,
			end,
			textStart: segStart + lead,
			textEnd: end - trail,
			text: raw.trim()
		});
	};

	for (let i = openParen; i < code.length; i++) {
		const ch = code[i];
		if (inString) {
			if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === '(') {
			depth++;
		} else if (ch === ')') {
			depth--;
			if (depth === 0) {
				closeParen = i;
				pushSegment(i);
				break;
			}
		} else if (ch === ',' && depth === 1) {
			pushSegment(i);
			segStart = i + 1;
		}
	}
	if (closeParen === -1 && segStart < code.length) {
		// Unbalanced call: keep whatever was scanned up to the end.
		pushSegment(code.length);
	}
	// `CYCLE82()` is a call with zero arguments, not one empty argument.
	if (segments.length === 1 && segments[0].text === '') {
		segments.length = 0;
	}
	return { args: segments, closeParen };
}

/**
 * Find all calls of known cycles in `text`.
 *
 * `cycles` maps a cycle name to its parameter-name array (see
 * src/cycles.js). Each returned call is:
 *   {
 *     name, nameStart, nameEnd, openParen, closeParen,
 *     args: [{ start, end, textStart, textEnd, text, index, param }],
 *     excess  // how many arguments exceed the definition (0 = ok)
 *   }
 * `param` is the parameter name for that argument position, or null
 * when the position is beyond the cycle's definition. Empty arguments
 * (`,,`) count as one argument each, as on the control.
 *
 * Calls inside comments are ignored, and a cycle name that is part of
 * a longer word (e.g. a variable name) does not match.
 */
function parseCycleCalls(text, cycles) {
	const code = stripComments(text);
	const calls = [];
	const re = /\b(CYCLE[0-9]+)[ \t]*\(/g;
	let m;
	while ((m = re.exec(code)) !== null) {
		const name = m[1];
		const params = cycles[name];
		if (!params) {
			continue;
		}
		const openParen = m.index + m[0].length - 1;
		const parsed = parseArgs(code, openParen);
		const args = parsed.args.map((arg, index) => ({
			...arg,
			index,
			param: index < params.length ? params[index] : null
		}));
		calls.push({
			name,
			nameStart: m.index,
			nameEnd: m.index + name.length,
			openParen,
			closeParen: parsed.closeParen,
			args,
			excess: Math.max(0, args.length - params.length)
		});
		if (parsed.closeParen >= 0) {
			// Do not match cycle names inside this call's arguments.
			re.lastIndex = parsed.closeParen + 1;
		}
	}
	return calls;
}

/**
 * The full signature of a cycle, e.g.
 * "CYCLE82(RTP, RFP, SDIS, DP, DPR, DTB)".
 */
function signature(name, cycles) {
	const params = cycles[name];
	return params ? `${name}(${params.join(', ')})` : name;
}

module.exports = { stripComments, parseCycleCalls, signature };
