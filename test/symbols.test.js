'use strict';

// Unit tests for definition / occurrence collection. Run with:
//   node --test test/symbols.test.js

const test = require('node:test');
const assert = require('node:assert');
const { collectDefinitions, collectOccurrences } = require('../src/symbols');

const byKind = (text, kind) => collectDefinitions(text).filter((d) => d.kind === kind);

test('a single DEF variable is collected with its position', () => {
	const text = 'DEF INT MYVAR\nMYVAR=1';
	const defs = byKind(text, 'variable');
	assert.strictEqual(defs.length, 1);
	assert.strictEqual(defs[0].name, 'MYVAR');
	assert.strictEqual(text.slice(defs[0].start, defs[0].end), 'MYVAR');
});

test('a DEF with several variables collects each of them', () => {
	const text = 'DEF REAL X, Y, Z';
	const defs = byKind(text, 'variable');
	assert.deepStrictEqual(defs.map((d) => d.name), ['X', 'Y', 'Z']);
	for (const def of defs) {
		assert.strictEqual(text.slice(def.start, def.end), def.name);
	}
});

test('array sizes and initial values do not hide later variables', () => {
	const text = 'DEF INT ARR[5]=(1,2,3), CNT=0';
	const defs = byKind(text, 'variable');
	assert.deepStrictEqual(defs.map((d) => d.name), ['ARR', 'CNT']);
});

test('a STRING length in brackets is skipped', () => {
	const text = 'DEF STRING[20] MSG_TEXT';
	const defs = byKind(text, 'variable');
	assert.deepStrictEqual(defs.map((d) => d.name), ['MSG_TEXT']);
});

test('a scope modifier between DEF and the type is allowed', () => {
	const text = 'DEF NCK INT GLOBAL_CNT';
	const defs = byKind(text, 'variable');
	assert.deepStrictEqual(defs.map((d) => d.name), ['GLOBAL_CNT']);
});

test('a DEF inside a comment or a string defines nothing', () => {
	const text = '; DEF INT IN_COMMENT\nMSG("DEF INT IN_STRING")';
	assert.deepStrictEqual(byKind(text, 'variable'), []);
});

test('DEF as part of a longer word defines nothing', () => {
	const text = 'MYDEF INT X\nDEFINE REAL Y';
	assert.deepStrictEqual(byKind(text, 'variable'), []);
});

test('a label at the start of a block is collected', () => {
	const text = 'START: G1 X10\nGOTOF START';
	const defs = byKind(text, 'label');
	assert.strictEqual(defs.length, 1);
	assert.strictEqual(defs[0].name, 'START');
	assert.strictEqual(text.slice(defs[0].start, defs[0].end), 'START');
});

test('a plain block number is not a label, but N10: is', () => {
	const text = 'N10 G1 X10\nN20: G1 X20';
	const defs = byKind(text, 'label');
	assert.deepStrictEqual(defs.map((d) => d.name), ['N20']);
});

test('a PROC definition is collected as a subprogram', () => {
	const text = 'PROC MYPROG(INT A, REAL B)\nRET';
	const defs = byKind(text, 'subprogram');
	assert.strictEqual(defs.length, 1);
	assert.strictEqual(defs[0].name, 'MYPROG');
	assert.strictEqual(text.slice(defs[0].start, defs[0].end), 'MYPROG');
});

test('definitions keep the written case but compare uppercase', () => {
	const text = 'DEF INT myVar';
	const defs = byKind(text, 'variable');
	assert.strictEqual(defs[0].name, 'myVar');
	assert.strictEqual(defs[0].upper, 'MYVAR');
});

test('occurrences find every use, case-insensitively', () => {
	const text = 'DEF INT COUNT\nCOUNT=1\nG1 X=count\nIF COUNT>2 GOTOF END';
	const occurrences = collectOccurrences(text, 'COUNT');
	assert.strictEqual(occurrences.length, 4);
	for (const occ of occurrences) {
		assert.strictEqual(text.slice(occ.start, occ.end).toUpperCase(), 'COUNT');
	}
});

test('occurrences ignore comments, strings and longer words', () => {
	const text = 'DEF INT POS\nPOS=1 ; POS in a comment\nMSG("POS")\nPOS2=POS';
	const occurrences = collectOccurrences(text, 'POS');
	// The definition, the assignment, and the use in "POS2=POS".
	assert.strictEqual(occurrences.length, 3);
});

test('occurrences of a label include its definition and jumps to it', () => {
	const text = 'LOOP1: G1 X10\nIF R1<3 GOTOB LOOP1';
	const occurrences = collectOccurrences(text, 'LOOP1');
	assert.strictEqual(occurrences.length, 2);
});
