'use strict';

// Structural diagnostics for SINUMERIK programs.
//
// This module deliberately has no VS Code API dependency so it can be
// unit-tested with plain node (see test/structure.test.js). All
// positions are character offsets into the original document text.
//
// Three checks, all reported as warnings by the extension:
//
// 1. Control-structure pairing. The block structures
//      IF ... ENDIF        LOOP ... ENDLOOP     WHILE ... ENDWHILE
//      FOR ... ENDFOR      REPEAT ... UNTIL     CASE ... ENDCASE
//    are matched with a stack. ELSE / ELSEIF are intermediate markers
//    inside IF and never change the stack. An opener that is never
//    closed and a closer without a matching opener are both reported.
//    Keywords inside comments and strings never count, and a keyword
//    that is part of a longer word (a variable name such as FORMAT)
//    never matches.
//    Two SINUMERIK look-alikes are deliberately NOT treated as block
//    openers, because they are complete statements of their own:
//      - "IF <condition> GOTOF/GOTOB/GOTOS <label>" is a conditional
//        jump, not the start of an IF block.
//      - "REPEAT <label> P=<n>" repeats a program section; only a
//        bare REPEAT (no further word on its block) opens a
//        REPEAT ... UNTIL loop.
// 2. Duplicate block numbers. An "N<number>" at the start of a block
//    may be used only once per file (the control needs it to be
//    unique for jumps and program-section repetition). Labels
//    ("NAME:") are not block numbers, and neither is a label that
//    happens to look like one ("N10:" defines a label).
// 3. Block length. One block (line) may be at most 512 characters,
//    comment included (programming manual, Fundamentals).

const { stripComments } = require('./parser');

const MAX_BLOCK_LENGTH = 512;

// Opener keyword -> the closer that ends it.
const OPENERS = {
	IF: 'ENDIF',
	LOOP: 'ENDLOOP',
	WHILE: 'ENDWHILE',
	FOR: 'ENDFOR',
	REPEAT: 'UNTIL',
	CASE: 'ENDCASE'
};

// Closer keyword -> the opener it ends.
const CLOSERS = {};
for (const [opener, closer] of Object.entries(OPENERS)) {
	CLOSERS[closer] = opener;
}

// Intermediate markers inside IF: recognized, but stack-neutral.
const MARKERS = new Set(['ELSE', 'ELSEIF']);

// Words that turn an IF into a conditional jump.
const JUMP_WORDS = new Set(['GOTOB', 'GOTOF', 'GOTOS']);

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
			start: line.start + m.index,
			end: line.start + m.index + m[0].length
		});
	}
	return words;
}

function checkControlStructures(lines) {
	const diagnostics = [];
	const stack = []; // [{ keyword, start, end }]

	const reportUnclosed = (open) => {
		diagnostics.push({
			kind: 'structure',
			start: open.start,
			end: open.end,
			message: `${open.keyword} without a matching ${OPENERS[open.keyword]}.`
		});
	};

	for (const line of lines) {
		const words = lineWords(line);
		for (let w = 0; w < words.length; w++) {
			const token = words[w];
			const word = token.word;
			if (MARKERS.has(word)) {
				continue;
			}
			if (Object.prototype.hasOwnProperty.call(OPENERS, word)) {
				if (word === 'IF') {
					// "IF <cond> GOTOF label" is a jump, not a block.
					const rest = words.slice(w + 1);
					if (rest.some((t) => JUMP_WORDS.has(t.word))) {
						continue;
					}
				}
				if (word === 'REPEAT' && w < words.length - 1) {
					// "REPEAT <label> P=<n>" repeats a program section;
					// only a bare REPEAT opens a loop.
					continue;
				}
				stack.push({ keyword: word, start: token.start, end: token.end });
				continue;
			}
			if (Object.prototype.hasOwnProperty.call(CLOSERS, word)) {
				const opener = CLOSERS[word];
				// Find the nearest matching opener on the stack.
				let at = -1;
				for (let s = stack.length - 1; s >= 0; s--) {
					if (stack[s].keyword === opener) {
						at = s;
						break;
					}
				}
				if (at === -1) {
					diagnostics.push({
						kind: 'structure',
						start: token.start,
						end: token.end,
						message: `${word} without a matching ${opener}.`
					});
				} else {
					// Everything opened inside the matching structure
					// and never closed is reported, then the match pops.
					for (let s = stack.length - 1; s > at; s--) {
						reportUnclosed(stack[s]);
					}
					stack.length = at;
				}
			}
		}
	}
	for (const open of stack) {
		reportUnclosed(open);
	}
	return diagnostics;
}

function checkBlockNumbers(lines) {
	const diagnostics = [];
	const seen = new Map(); // numeric value -> 1-based line of first use
	lines.forEach((line, index) => {
		const m = /^[ \t]*(N[0-9]+)/.exec(line.content);
		if (!m) {
			return;
		}
		// "N10:" at the start of a line defines a label, and a word
		// character right after the digits makes it part of a name;
		// neither is a block number.
		const next = line.content[m[0].length];
		if (next === ':' || (next !== undefined && /[A-Za-z0-9_]/.test(next))) {
			return;
		}
		const value = parseInt(m[1].slice(1), 10);
		if (seen.has(value)) {
			const start = line.start + (m[0].length - m[1].length);
			diagnostics.push({
				kind: 'duplicate-block-number',
				start,
				end: start + m[1].length,
				message:
					`Block number ${m[1]} is used more than once ` +
					`(first used on line ${seen.get(value)}).`
			});
		} else {
			seen.set(value, index + 1);
		}
	});
	return diagnostics;
}

function checkBlockLengths(lines) {
	const diagnostics = [];
	for (const line of lines) {
		if (line.content.length > MAX_BLOCK_LENGTH) {
			diagnostics.push({
				kind: 'block-length',
				start: line.start,
				end: line.start + line.content.length,
				message:
					`Block is ${line.content.length} characters long; ` +
					`the maximum block length is ${MAX_BLOCK_LENGTH} characters.`
			});
		}
	}
	return diagnostics;
}

/**
 * Run all structural checks over `text`. Returns diagnostics as
 * [{ kind, start, end, message }] sorted by start offset, where kind
 * is 'structure', 'duplicate-block-number' or 'block-length'.
 */
function checkStructure(text) {
	// Keywords and block numbers are looked for in code with comments
	// and string contents removed (offsets preserved). The block
	// length limit, on the other hand, applies to the block as
	// written, comment included, so it uses the original lines.
	const codeLines = splitLines(blankStrings(stripComments(text)));
	const rawLines = splitLines(text);
	const diagnostics = [
		...checkControlStructures(codeLines),
		...checkBlockNumbers(codeLines),
		...checkBlockLengths(rawLines)
	];
	diagnostics.sort((a, b) => a.start - b.start);
	return diagnostics;
}

module.exports = { checkStructure, MAX_BLOCK_LENGTH };
