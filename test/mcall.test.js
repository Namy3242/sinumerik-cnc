'use strict';

// Unit tests for the MCALL cancellation check. Run with:
//   node --test test/mcall.test.js

const test = require('node:test');
const assert = require('node:assert');
const { checkMcall } = require('../src/mcall');

test('a modal call cancelled by a bare MCALL warns about nothing', () => {
	const text = ['MCALL CYCLE82(2,0,1,-5,,0)', 'G1 X10', 'MCALL', 'M30'].join('\n');
	assert.deepStrictEqual(checkMcall(text), []);
});

test('a modal call still active at M30 is reported on the MCALL', () => {
	const text = ['MCALL CYCLE82(2,0,1,-5,,0)', 'G1 X10', 'M30'].join('\n');
	const found = checkMcall(text);
	assert.strictEqual(found.length, 1);
	assert.strictEqual(found[0].kind, 'mcall-not-cancelled');
	assert.strictEqual(text.slice(found[0].start, found[0].end), 'MCALL');
	assert.strictEqual(found[0].start, 0);
});

test('a modal call still active at the end of the file is reported', () => {
	const text = ['G1 X10', 'MCALL MYSUB(1)'].join('\n');
	const found = checkMcall(text);
	assert.strictEqual(found.length, 1);
	assert.strictEqual(found[0].start, text.indexOf('MCALL'));
});

test('a modal subprogram call still active at RET is reported', () => {
	const text = ['PROC SUB1', 'MCALL HELPER', 'RET'].join('\n');
	assert.strictEqual(checkMcall(text).length, 1);
});

test('M2 and M17 also end the program for this check', () => {
	assert.strictEqual(checkMcall('MCALL FOO\nM2').length, 1);
	assert.strictEqual(checkMcall('MCALL FOO\nM17').length, 1);
});

test('a second MCALL replaces the first; the warning points at it', () => {
	const text = ['MCALL FIRST', 'MCALL SECOND', 'M30'].join('\n');
	const found = checkMcall(text);
	assert.strictEqual(found.length, 1);
	assert.strictEqual(found[0].start, text.indexOf('MCALL SECOND'));
});

test('a replaced call that is then cancelled warns about nothing', () => {
	const text = ['MCALL FIRST', 'MCALL SECOND', 'MCALL', 'M30'].join('\n');
	assert.deepStrictEqual(checkMcall(text), []);
});

test('a cancelled call does not warn again at a later program end', () => {
	const text = ['MCALL FOO', 'M30', 'MCALL BAR', 'MCALL', 'M30'].join('\n');
	const found = checkMcall(text);
	assert.strictEqual(found.length, 1);
	assert.strictEqual(found[0].start, 0);
});

test('no MCALL at all means no warnings', () => {
	assert.deepStrictEqual(checkMcall('G1 X10\nM30'), []);
	assert.deepStrictEqual(checkMcall(''), []);
});

test('a bare MCALL without a preceding call is harmless', () => {
	assert.deepStrictEqual(checkMcall('MCALL\nM30'), []);
});

test('an MCALL inside a comment or a string does not count', () => {
	const text = ['; MCALL CYCLE82(1)', 'MSG("MCALL FOO")', 'M30'].join('\n');
	assert.deepStrictEqual(checkMcall(text), []);
});

test('a block number before MCALL still counts, and a trailing comment is ignored', () => {
	const text = ['N10 MCALL CYCLE82(1) ; modal drilling', 'N20 G1 X5', 'N30 M30'].join('\n');
	const found = checkMcall(text);
	assert.strictEqual(found.length, 1);
	assert.strictEqual(text.slice(found[0].start, found[0].end), 'MCALL');
});
