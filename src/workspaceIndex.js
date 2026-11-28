'use strict';

// Cross-file index of subprogram definitions, for go-to-definition
// across the workspace.
//
// This module deliberately has no VS Code API dependency so it can
// be unit-tested with plain node (see test/workspaceIndex.test.js).
// A "file" here is just a { path, text } pair; positions are
// character offsets into that file's text.
//
// The index knows two ways a subprogram name can resolve, mirroring
// how the control finds subprograms:
//
// - 'proc': a "PROC NAME(...)" definition in some file. The name in
//   a subprogram call jumps to that definition.
// - 'file': a file whose base name is the subprogram name. On the
//   control a subprogram lives in the file of the same name
//   ("MYPROG" in MYPROG.SPF), so when no file defines a PROC with
//   the name, the call jumps to the top of the like-named file.
//
// PROC definitions win over the file-name fallback. When several
// files define the same name, all of them are returned and the
// editor lets the user pick. Names are not case-sensitive in
// SINUMERIK, so lookups compare the uppercased form.

const { stripComments } = require('./parser');
const { collectDefinitions } = require('./symbols');

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
 * The subprogram name a file stands for: its base name without the
 * extension, uppercased ("C:\PRG\MyProg.SPF" -> "MYPROG"). Both
 * slash styles are accepted so plain paths and URI strings work.
 */
function subprogramNameForFile(filePath) {
	const base = String(filePath).split(/[\\/]/).pop() || '';
	const dot = base.lastIndexOf('.');
	const stem = dot > 0 ? base.slice(0, dot) : base;
	return stem.toUpperCase();
}

/** An empty index. Build one with buildIndex, or fill it file by file with indexFile. */
function createIndex() {
	return {
		// Uppercased subprogram name -> [{ path, name, start, end }]
		procDefs: new Map(),
		// Uppercased file-derived subprogram name -> Set of paths
		filesByName: new Map(),
		// Path -> { name, defs } as last indexed, so a file's old
		// contributions can be removed before re-indexing it.
		perFile: new Map()
	};
}

/** Remove everything `filePath` contributed to the index. */
function removeFile(index, filePath) {
	const record = index.perFile.get(filePath);
	if (!record) {
		return;
	}
	for (const def of record.defs) {
		const list = index.procDefs.get(def.upper);
		if (!list) {
			continue;
		}
		const kept = list.filter((d) => d.path !== filePath);
		if (kept.length > 0) {
			index.procDefs.set(def.upper, kept);
		} else {
			index.procDefs.delete(def.upper);
		}
	}
	const paths = index.filesByName.get(record.name);
	if (paths) {
		paths.delete(filePath);
		if (paths.size === 0) {
			index.filesByName.delete(record.name);
		}
	}
	index.perFile.delete(filePath);
}

/**
 * Add one file to the index, replacing whatever an earlier version
 * of the same path contributed. `text` is the file's current
 * content.
 */
function indexFile(index, filePath, text) {
	removeFile(index, filePath);
	const defs = collectDefinitions(text)
		.filter((def) => def.kind === 'subprogram')
		.map((def) => ({
			upper: def.upper,
			name: def.name,
			start: def.start,
			end: def.end
		}));
	for (const def of defs) {
		if (!index.procDefs.has(def.upper)) {
			index.procDefs.set(def.upper, []);
		}
		index.procDefs.get(def.upper).push({
			path: filePath,
			name: def.name,
			start: def.start,
			end: def.end
		});
	}
	const name = subprogramNameForFile(filePath);
	if (!index.filesByName.has(name)) {
		index.filesByName.set(name, new Set());
	}
	index.filesByName.get(name).add(filePath);
	index.perFile.set(filePath, { name, defs });
	return index;
}

/** Build an index from a whole set of files: [{ path, text }]. */
function buildIndex(files) {
	const index = createIndex();
	for (const file of files) {
		indexFile(index, file.path, file.text);
	}
	return index;
}

/**
 * Resolve a subprogram name to jump targets:
 * [{ path, start, end, via }] where `via` is 'proc' (a PROC
 * definition; start/end span the name in that file) or 'file' (the
 * top of a like-named file; start and end are 0). PROC definitions
 * are returned whenever any exist; the file-name fallback is only
 * used when no file defines the name. An unknown name resolves to
 * an empty array.
 */
function resolveSubprogram(index, name) {
	const upper = String(name).toUpperCase();
	const defs = index.procDefs.get(upper);
	if (defs && defs.length > 0) {
		return defs
			.slice()
			.sort((a, b) =>
				a.path < b.path ? -1 : a.path > b.path ? 1 : a.start - b.start
			)
			.map((def) => ({
				path: def.path,
				start: def.start,
				end: def.end,
				via: 'proc'
			}));
	}
	const paths = index.filesByName.get(upper);
	if (paths && paths.size > 0) {
		return [...paths]
			.sort()
			.map((path) => ({ path, start: 0, end: 0, via: 'file' }));
	}
	return [];
}

// Keywords after which an identifier names a subprogram.
const CALL_KEYWORDS = new Set(['CALL', 'MCALL', 'EXTERN']);

function isWordChar(ch) {
	return /[A-Za-z0-9_]/.test(ch);
}

/**
 * If the identifier at `offset` in `text` is used as a subprogram
 * name, return { name, start, end } for it; otherwise return
 * undefined. A use counts when the name
 *
 * - follows CALL, MCALL or EXTERN ("CALL SUB1", "EXTERN SUB1(REAL)"),
 * - or stands at the start of a block (an optional block number may
 *   precede it) and is followed by its argument list or by nothing
 *   ("SUB1(3)", "N10 SUB1").
 *
 * A name after PROC is a definition, not a use, and names in other
 * positions (assignments, jump targets, DEF lists, ...) are not
 * subprogram uses. Comments and strings never count.
 */
function subprogramReferenceAt(text, offset) {
	const code = blankStrings(stripComments(text));
	if (offset < 0 || offset >= code.length || !isWordChar(code[offset])) {
		return undefined;
	}
	let start = offset;
	while (start > 0 && isWordChar(code[start - 1])) {
		start--;
	}
	let end = offset + 1;
	while (end < code.length && isWordChar(code[end])) {
		end++;
	}
	const name = code.slice(start, end);
	if (!/^[A-Za-z_]/.test(name)) {
		return undefined;
	}
	// The words of the block (line) the name stands in.
	const lineStart = code.lastIndexOf('\n', start - 1) + 1;
	let lineEnd = code.indexOf('\n', start);
	if (lineEnd === -1) {
		lineEnd = code.length;
	}
	const line = code.slice(lineStart, lineEnd);
	const words = [];
	const re = /[A-Za-z_][A-Za-z0-9_]*/g;
	let m;
	while ((m = re.exec(line)) !== null) {
		words.push({
			word: m[0].toUpperCase(),
			start: lineStart + m.index,
			end: lineStart + m.index + m[0].length
		});
	}
	const at = words.findIndex((token) => token.start === start);
	if (at === -1) {
		return undefined;
	}
	const prev = at > 0 ? words[at - 1] : undefined;
	if (prev && CALL_KEYWORDS.has(prev.word)) {
		return { name, start, end };
	}
	if (prev && prev.word === 'PROC') {
		return undefined;
	}
	// In call position only a block number may precede the name.
	const inCallPosition = words
		.slice(0, at)
		.every((token) => /^N[0-9]+$/.test(token.word));
	if (inCallPosition) {
		const rest = line.slice(end - lineStart).trimStart();
		if (rest === '' || rest.startsWith('(')) {
			return { name, start, end };
		}
	}
	return undefined;
}

module.exports = {
	createIndex,
	buildIndex,
	indexFile,
	removeFile,
	resolveSubprogram,
	subprogramNameForFile,
	subprogramReferenceAt
};
