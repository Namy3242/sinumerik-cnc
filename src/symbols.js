'use strict';

// Symbol collection for go-to-definition and find-references.
//
// This module deliberately has no VS Code API dependency so it can be
// unit-tested with plain node (see test/symbols.test.js). All
// positions are character offsets into the original document text.
//
// Three kinds of definitions are collected, all within one file:
//
// - 'variable':   names defined by a DEF statement. The identifiers
//                 after the type keyword are definitions; a DEF may
//                 define several variables at once
//                 ("DEF REAL X, Y"), each possibly with an array
//                 size ("ARR[10]") or an initial value ("=0").
// - 'label':      a block label, "NAME:" at the start of a block.
//                 Jump instructions (GOTOB / GOTOF / GOTO / GOTOS)
//                 refer to these names.
// - 'subprogram': the name of a "PROC NAME(...)" definition, so a
//                 call of a subprogram defined in the same file can
//                 jump to it.
//
// Names in SINUMERIK are not case-sensitive, so definitions carry an
// uppercased form ("upper") for comparisons while "name" keeps the
// spelling found in the file. Keywords inside comments and strings
// never count, and a keyword that is part of a longer word (a
// variable named MYDEF) never matches.

const { stripComments } = require('./parser');

// Data types that may follow DEF (and its optional scope modifiers).
const DEF_TYPES = new Set([
	'INT', 'REAL', 'BOOL', 'CHAR', 'STRING', 'AXIS', 'FRAME'
]);

// Scope modifiers that may appear between DEF and the type.
const DEF_MODIFIERS = new Set(['NCK', 'CHAN']);

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
 * Split `s` (a substring of a line) on top-level commas. Commas
 * inside parentheses or brackets do not split, so an initial value
 * such as "=(1,2,3)" stays in one segment. Returns
 * [{ text, offset }] with offsets relative to the start of `s`.
 */
function splitTopLevel(s) {
	const segments = [];
	let depth = 0;
	let segStart = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === '(' || ch === '[') {
			depth++;
		} else if (ch === ')' || ch === ']') {
			depth--;
		} else if (ch === ',' && depth === 0) {
			segments.push({ text: s.slice(segStart, i), offset: segStart });
			segStart = i + 1;
		}
	}
	segments.push({ text: s.slice(segStart), offset: segStart });
	return segments;
}

/**
 * Collect the variables defined by one DEF line. `words` are the
 * line's word tokens and `defIndex` is the index of the DEF token.
 * Returns definition records (possibly none).
 */
function defVariables(line, words, defIndex) {
	// Skip optional scope modifiers, then expect the type keyword.
	let t = defIndex + 1;
	while (t < words.length && DEF_MODIFIERS.has(words[t].word)) {
		t++;
	}
	if (t >= words.length || !DEF_TYPES.has(words[t].word)) {
		return [];
	}
	// The rest of the line, from the end of the type keyword on, is a
	// comma-separated list of defined names. A STRING type may carry
	// its length first ("DEF STRING[20] NAME"): skip that bracket.
	let rest = line.content.slice(words[t].end - line.start);
	const lead = rest.length - rest.trimStart().length;
	if (rest.trimStart().startsWith('[')) {
		const close = rest.indexOf(']');
		if (close === -1) {
			return [];
		}
		rest = rest.slice(0, lead) + ' '.repeat(close + 1 - lead) + rest.slice(close + 1);
	}
	const base = words[t].end;
	const definitions = [];
	for (const segment of splitTopLevel(rest)) {
		const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(segment.text);
		if (!m) {
			continue;
		}
		const start = base + segment.offset + (segment.text.length - segment.text.trimStart().length);
		definitions.push({
			name: m[1],
			upper: m[1].toUpperCase(),
			kind: 'variable',
			start,
			end: start + m[1].length
		});
	}
	return definitions;
}

/**
 * Collect all definitions in `text`. Returns
 * [{ name, upper, kind, start, end }] sorted by start offset, where
 * kind is 'variable', 'label' or 'subprogram'.
 */
function collectDefinitions(text) {
	const code = blankStrings(stripComments(text));
	const definitions = [];
	for (const line of splitLines(code)) {
		const words = lineWords(line);
		for (let w = 0; w < words.length; w++) {
			if (words[w].word === 'DEF') {
				definitions.push(...defVariables(line, words, w));
			}
		}
		// A subprogram definition: "PROC NAME(...)" at the start of
		// the block (an optional block number may precede it).
		const proc = /^[ \t]*(?:N[0-9]+[ \t]+)?PROC[ \t]+([A-Za-z_][A-Za-z0-9_]*)/i.exec(line.content);
		if (proc) {
			const start = line.start + proc[0].length - proc[1].length;
			definitions.push({
				name: proc[1],
				upper: proc[1].toUpperCase(),
				kind: 'subprogram',
				start,
				end: start + proc[1].length
			});
		}
		// A block label: "NAME:" at the start of the block. (A plain
		// block number has no colon; "N10:" is a label.)
		const label = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:/.exec(line.content);
		if (label) {
			const start = line.start + (label[0].indexOf(label[1]));
			definitions.push({
				name: label[1],
				upper: label[1].toUpperCase(),
				kind: 'label',
				start,
				end: start + label[1].length
			});
		}
	}
	definitions.sort((a, b) => a.start - b.start);
	return definitions;
}

/**
 * Find every occurrence of the identifier `name` in `text`, as
 * [{ start, end }] sorted by offset. Matching is case-insensitive
 * and on word boundaries: an occurrence that is part of a longer
 * word does not count, and neither do occurrences inside comments
 * or strings. The definition site itself is included.
 */
function collectOccurrences(text, name) {
	const code = blankStrings(stripComments(text));
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'gi');
	const occurrences = [];
	let m;
	while ((m = re.exec(code)) !== null) {
		occurrences.push({ start: m.index, end: m.index + m[0].length });
	}
	return occurrences;
}

module.exports = { collectDefinitions, collectOccurrences };
