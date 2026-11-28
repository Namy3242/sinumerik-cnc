'use strict';

// Unit tests for the G-code dictionary and the modal-state tracker.
// Run with: node --test test/modal.test.js

const test = require('node:test');
const assert = require('node:assert');
const { GCODES, GROUP_NAMES, lookupGCode } = require('../src/gcodes');
const {
	tokenize,
	modalStateAt,
	formatModalState,
	gcodeAtOffset
} = require('../src/modal');

const codesOf = (text, offset) =>
	modalStateAt(text, offset === undefined ? text.length : offset).map((s) => s.code);

test('dictionary contains exactly the verified codes', () => {
	// 6 (group 1) + 3 (group 2) + 8 (group 3) + 3 (group 6)
	// + 3 (group 7) + 5 (group 8) + 2 (group 9) + 2 (group 14)
	// + 5 (group 15)
	assert.strictEqual(Object.keys(GCODES).length, 37);
	for (const [code, entry] of Object.entries(GCODES)) {
		assert.ok(Number.isInteger(entry.group), code);
		assert.strictEqual(typeof entry.modal, 'boolean', code);
		assert.ok(entry.desc.length > 0, code);
		assert.ok(GROUP_NAMES[entry.group], code);
	}
});

test('dictionary spot checks: group and modality', () => {
	assert.strictEqual(GCODES.G1.group, 1);
	assert.strictEqual(GCODES.G1.modal, true);
	assert.strictEqual(GCODES.G4.group, 2);
	assert.strictEqual(GCODES.G4.modal, false);
	assert.strictEqual(GCODES.TRANS.group, 3);
	assert.strictEqual(GCODES.G17.group, 6);
	assert.strictEqual(GCODES.G41.group, 7);
	assert.strictEqual(GCODES.G54.group, 8);
	assert.strictEqual(GCODES.G53.group, 9);
	assert.strictEqual(GCODES.G53.modal, false);
	assert.strictEqual(GCODES.SUPA.group, 9);
	assert.strictEqual(GCODES.SUPA.modal, false);
	assert.strictEqual(GCODES.G90.group, 14);
	assert.strictEqual(GCODES.G94.group, 15);
});

test('lookupGCode normalizes case and leading zeros', () => {
	assert.strictEqual(lookupGCode('G01').code, 'G1');
	assert.strictEqual(lookupGCode('g54').code, 'G54');
	assert.strictEqual(lookupGCode('trans').code, 'TRANS');
	assert.strictEqual(lookupGCode('G00').code, 'G0');
});

test('lookupGCode recognizes the G505-G599 offset range as a pattern', () => {
	const entry = lookupGCode('G510');
	assert.strictEqual(entry.group, 8);
	assert.strictEqual(entry.modal, true);
	assert.strictEqual(entry.code, 'G510');
});

test('lookupGCode returns null for unknown words', () => {
	assert.strictEqual(lookupGCode('G999'), null);
	assert.strictEqual(lookupGCode('G600'), null);
	assert.strictEqual(lookupGCode('M3'), null);
	assert.strictEqual(lookupGCode('FAKTOR'), null);
	assert.strictEqual(lookupGCode(''), null);
});

test('basic switching within a group: last code wins', () => {
	assert.deepStrictEqual(codesOf('G54\nG55'), ['G55']);
	assert.deepStrictEqual(codesOf('G90\nG91'), ['G91']);
	assert.deepStrictEqual(codesOf('G41\nG40'), ['G40']);
	assert.deepStrictEqual(codesOf('G17\nG18\nG19'), ['G19']);
	assert.deepStrictEqual(codesOf('G0 X0\nG1 X10 F100'), ['G1']);
});

test('groups are tracked independently and ordered by group', () => {
	const state = modalStateAt('G94 G90 G54 G17 G41 G1 X10', 31);
	assert.deepStrictEqual(
		state.map((s) => `${s.group}:${s.code}`),
		['1:G1', '6:G17', '7:G41', '8:G54', '14:G90', '15:G94']
	);
});

test('comments are ignored, including trailing comments', () => {
	assert.deepStrictEqual(codesOf('; G55 G91\nG54 G90'), ['G54', 'G90']);
	assert.deepStrictEqual(codesOf('G54 ; switch to G55 later\nG1 X1'), ['G1', 'G54']);
});

test('several codes in one block all take effect', () => {
	assert.deepStrictEqual(
		codesOf('N10 G54 G90 G17 G94 G1 X10 Y20 F200'),
		['G1', 'G17', 'G54', 'G90', 'G94']
	);
});

test('compact blocks without spaces are tokenized', () => {
	assert.deepStrictEqual(codesOf('G54G90G1X10Y20'), ['G1', 'G54', 'G90']);
});

test('text after the offset is not reflected', () => {
	const text = 'G54 G90\nG55 G91';
	const endOfFirstLine = text.indexOf('\n') + 1;
	assert.deepStrictEqual(codesOf(text, endOfFirstLine), ['G54', 'G90']);
	assert.deepStrictEqual(codesOf(text), ['G55', 'G91']);
});

test('non-modal codes never enter the state and do not clear it', () => {
	assert.deepStrictEqual(codesOf('G4 F2'), []);
	assert.deepStrictEqual(codesOf('G54\nG53 X0\nG75'), ['G54']);
	assert.deepStrictEqual(codesOf('G90 SUPA X0'), ['G90']);
});

test('frame commands combine per component', () => {
	assert.deepStrictEqual(codesOf('TRANS X10\nROT RPL=30'), ['TRANS', 'ROT']);
	// Additive form replaces the absolute form of the same component.
	assert.deepStrictEqual(codesOf('TRANS X10\nATRANS X5'), ['ATRANS']);
	assert.deepStrictEqual(
		codesOf('MIRROR X0\nSCALE X2\nAROT RPL=10\nTRANS Z1'),
		['TRANS', 'AROT', 'SCALE', 'MIRROR']
	);
});

test('settable offsets from the G505-G599 range set group 8', () => {
	assert.deepStrictEqual(codesOf('G54\nG510'), ['G510']);
});

test('unknown codes and other words are ignored', () => {
	assert.deepStrictEqual(codesOf('T1 D1 M3 S1000\nFAKTOR=2'), []);
	assert.deepStrictEqual(codesOf(''), []);
});

test('codes inside strings are ignored', () => {
	assert.deepStrictEqual(codesOf('MSG("G55 G91")\nG54'), ['G54']);
});

test('formatModalState joins codes with separators', () => {
	const state = modalStateAt('G54 G90 G17', 11);
	assert.strictEqual(formatModalState(state), 'G17 | G54 | G90');
	assert.strictEqual(formatModalState([]), '');
});

test('gcodeAtOffset finds the code under the cursor', () => {
	const text = 'N10 G54 G1 X10';
	const hit = gcodeAtOffset(text, text.indexOf('G54') + 1);
	assert.strictEqual(hit.entry.code, 'G54');
	assert.strictEqual(hit.entry.group, 8);
	assert.strictEqual(text.slice(hit.start, hit.end), 'G54');
	const wordHit = gcodeAtOffset('TRANS X10', 2);
	assert.strictEqual(wordHit.entry.code, 'TRANS');
});

test('gcodeAtOffset returns null outside known codes', () => {
	const text = 'N10 G54 G1 X10';
	assert.strictEqual(gcodeAtOffset(text, text.indexOf('X10') + 1), null);
	assert.strictEqual(gcodeAtOffset(text, 0), null); // block number N10
});

test('tokenize splits letter/digit sequences', () => {
	const words = tokenize('G01X10 TRANS').map((t) => t.word);
	assert.deepStrictEqual(words, ['G01', 'X', 'TRANS']);
});
