'use strict';

// Unit tests for the cross-file subprogram index. Run with:
//   node --test test/workspaceIndex.test.js

const test = require('node:test');
const assert = require('node:assert');
const {
	buildIndex,
	createIndex,
	indexFile,
	removeFile,
	resolveSubprogram,
	subprogramNameForFile,
	subprogramReferenceAt
} = require('../src/workspaceIndex');

const MAIN = {
	path: '/ws/MAIN.mpf',
	text: 'N10 CALL DRILL_AUX\nN20 FINISH\nM30'
};
const DRILL = {
	path: '/ws/DRILL_AUX.spf',
	text: 'PROC DRILL_AUX(REAL DEPTH)\nG1 Z=-DEPTH\nRET'
};
const FINISH = {
	path: '/ws/FINISH.spf',
	// No PROC header: on the control the file itself is the
	// subprogram, found by its name.
	text: 'G1 X10\nRET'
};

test('a call resolves to the PROC definition in another file', () => {
	const index = buildIndex([MAIN, DRILL, FINISH]);
	const found = resolveSubprogram(index, 'DRILL_AUX');
	assert.strictEqual(found.length, 1);
	assert.strictEqual(found[0].path, DRILL.path);
	assert.strictEqual(found[0].via, 'proc');
	assert.strictEqual(
		DRILL.text.slice(found[0].start, found[0].end),
		'DRILL_AUX'
	);
});

test('resolution is case-insensitive', () => {
	const index = buildIndex([DRILL]);
	const found = resolveSubprogram(index, 'drill_aux');
	assert.strictEqual(found.length, 1);
	assert.strictEqual(found[0].via, 'proc');
});

test('a name without a PROC falls back to the like-named file', () => {
	const index = buildIndex([MAIN, DRILL, FINISH]);
	const found = resolveSubprogram(index, 'FINISH');
	assert.strictEqual(found.length, 1);
	assert.strictEqual(found[0].path, FINISH.path);
	assert.strictEqual(found[0].via, 'file');
	assert.strictEqual(found[0].start, 0);
	assert.strictEqual(found[0].end, 0);
});

test('a PROC definition wins over the file-name fallback', () => {
	const named = { path: '/ws/BOTH.spf', text: 'G1 X0\nRET' };
	const defining = { path: '/ws/HELPER.spf', text: 'PROC BOTH()\nRET' };
	const index = buildIndex([named, defining]);
	const found = resolveSubprogram(index, 'BOTH');
	assert.strictEqual(found.length, 1);
	assert.strictEqual(found[0].path, defining.path);
	assert.strictEqual(found[0].via, 'proc');
});

test('several definitions of one name are all returned', () => {
	const a = { path: '/ws/A_DIR/UTIL.spf', text: 'PROC SHARED()\nRET' };
	const b = { path: '/ws/B_DIR/UTIL.spf', text: 'PROC SHARED()\nRET' };
	const index = buildIndex([b, a]);
	const found = resolveSubprogram(index, 'SHARED');
	assert.strictEqual(found.length, 2);
	// Sorted by path, so the order does not depend on indexing order.
	assert.deepStrictEqual(
		found.map((f) => f.path),
		[a.path, b.path]
	);
	assert.ok(found.every((f) => f.via === 'proc'));
});

test('an unknown name resolves to nothing', () => {
	const index = buildIndex([MAIN, DRILL]);
	assert.deepStrictEqual(resolveSubprogram(index, 'NO_SUCH'), []);
});

test('re-indexing a changed file moves its definition', () => {
	const index = createIndex();
	indexFile(index, '/ws/MOVING.spf', 'PROC PROG_A()\nRET');
	const before = resolveSubprogram(index, 'PROG_A');
	assert.strictEqual(before.length, 1);

	indexFile(index, '/ws/MOVING.spf', '\n\nPROC PROG_A()\nRET');
	const after = resolveSubprogram(index, 'PROG_A');
	assert.strictEqual(after.length, 1);
	assert.strictEqual(after[0].start, before[0].start + 2);
});

test('re-indexing a changed file replaces the old definition', () => {
	const index = createIndex();
	indexFile(index, '/ws/MOVING.spf', 'PROC PROG_A()\nRET');
	indexFile(index, '/ws/MOVING.spf', 'PROC PROG_B()\nRET');
	// MOVING is not named PROG_A either, so nothing is left.
	assert.deepStrictEqual(resolveSubprogram(index, 'PROG_A'), []);
	assert.strictEqual(resolveSubprogram(index, 'PROG_B').length, 1);
});

test('removing a file removes its definitions and its name', () => {
	const index = buildIndex([DRILL]);
	removeFile(index, DRILL.path);
	assert.deepStrictEqual(resolveSubprogram(index, 'DRILL_AUX'), []);
});

test('the file-name table maps base names, uppercased', () => {
	assert.strictEqual(subprogramNameForFile('/a/b/MAIN.mpf'), 'MAIN');
	assert.strictEqual(subprogramNameForFile('C:\\prg\\Mill.SPF'), 'MILL');
	assert.strictEqual(
		subprogramNameForFile('file:///ws/Part_1.spf'),
		'PART_1'
	);
});

// --- subprogramReferenceAt -------------------------------------------

const refAt = (text, name) =>
	subprogramReferenceAt(text, text.indexOf(name));

test('a name after CALL is a subprogram reference', () => {
	const ref = refAt('N10 CALL SUB1', 'SUB1');
	assert.strictEqual(ref.name, 'SUB1');
});

test('a name after MCALL is a subprogram reference', () => {
	const ref = refAt('MCALL SUB2(1, 2)', 'SUB2');
	assert.strictEqual(ref.name, 'SUB2');
});

test('a name after EXTERN is a subprogram reference', () => {
	const ref = refAt('EXTERN SUB3(INT, REAL)', 'SUB3');
	assert.strictEqual(ref.name, 'SUB3');
});

test('a call at the start of a block is a subprogram reference', () => {
	assert.strictEqual(refAt('SUB4(3)', 'SUB4').name, 'SUB4');
	assert.strictEqual(refAt('N10 SUB5', 'SUB5').name, 'SUB5');
	assert.strictEqual(refAt('N10 SUB6(3) ; a comment', 'SUB6').name, 'SUB6');
});

test('a jump target is not a subprogram reference', () => {
	assert.strictEqual(refAt('IF R1>0 GOTOF LABEL1', 'LABEL1'), undefined);
});

test('a DEF variable is not a subprogram reference', () => {
	assert.strictEqual(refAt('DEF INT MYVAR', 'MYVAR'), undefined);
});

test('an assigned name is not a subprogram reference', () => {
	assert.strictEqual(refAt('X=SUB7', 'SUB7'), undefined);
});

test('the name in a PROC header is a definition, not a reference', () => {
	assert.strictEqual(refAt('PROC SUB8()', 'SUB8'), undefined);
});

test('a name inside a comment is not a reference', () => {
	assert.strictEqual(refAt('; CALL SUB9', 'SUB9'), undefined);
});

test('a label definition is not a subprogram reference', () => {
	assert.strictEqual(refAt('SUB10: G1 X0', 'SUB10'), undefined);
});

test('a reference in one file resolves through the index', () => {
	const index = buildIndex([MAIN, DRILL, FINISH]);
	const ref = subprogramReferenceAt(MAIN.text, MAIN.text.indexOf('DRILL_AUX'));
	assert.strictEqual(ref.name, 'DRILL_AUX');
	const found = resolveSubprogram(index, ref.name);
	assert.strictEqual(found.length, 1);
	assert.strictEqual(found[0].path, DRILL.path);
});
