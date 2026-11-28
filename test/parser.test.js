'use strict';

// Unit tests for the pure cycle-call parser. Run with:
//   node --test test/parser.test.js

const test = require('node:test');
const assert = require('node:assert');
const { CYCLES } = require('../src/cycles');
const { stripComments, parseCycleCalls, signature } = require('../src/parser');

test('dictionary contains exactly the three verified cycles', () => {
	assert.deepStrictEqual(Object.keys(CYCLES).sort(), ['CYCLE81', 'CYCLE82', 'CYCLE83']);
	assert.strictEqual(CYCLES.CYCLE81.length, 5);
	assert.strictEqual(CYCLES.CYCLE82.length, 6);
	assert.strictEqual(CYCLES.CYCLE83.length, 17);
	assert.strictEqual(CYCLES.CYCLE83[16], '_DIS1');
});

test('signature lists all parameters in order', () => {
	assert.strictEqual(
		signature('CYCLE82', CYCLES),
		'CYCLE82(RTP, RFP, SDIS, DP, DPR, DTB)'
	);
});

test('normal call: arguments are mapped to parameter names', () => {
	const calls = parseCycleCalls('CYCLE82(2, 0, 1, -2.6, 0, 0)', CYCLES);
	assert.strictEqual(calls.length, 1);
	const call = calls[0];
	assert.strictEqual(call.name, 'CYCLE82');
	assert.strictEqual(call.args.length, 6);
	assert.deepStrictEqual(
		call.args.map((a) => a.param),
		['RTP', 'RFP', 'SDIS', 'DP', 'DPR', 'DTB']
	);
	assert.deepStrictEqual(
		call.args.map((a) => a.text),
		['2', '0', '1', '-2.6', '0', '0']
	);
	assert.strictEqual(call.excess, 0);
});

test('empty argument keeps its position and parameter name', () => {
	const calls = parseCycleCalls('CYCLE82(2,0,1,-2.6,,0)', CYCLES);
	assert.strictEqual(calls.length, 1);
	const call = calls[0];
	assert.strictEqual(call.args.length, 6);
	assert.strictEqual(call.args[4].text, '');
	assert.strictEqual(call.args[4].param, 'DPR');
	assert.strictEqual(call.args[5].param, 'DTB');
	assert.strictEqual(call.excess, 0);
});

test('trailing omission is not an error', () => {
	const calls = parseCycleCalls('CYCLE82(2, 0, 1)', CYCLES);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].args.length, 3);
	assert.strictEqual(calls[0].excess, 0);
});

test('too many arguments are reported as excess', () => {
	const calls = parseCycleCalls('CYCLE81(1, 2, 3, 4, 5, 6, 7)', CYCLES);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].args.length, 7);
	assert.strictEqual(calls[0].excess, 2);
	assert.strictEqual(calls[0].args[5].param, null);
	assert.strictEqual(calls[0].args[6].param, null);
});

test('calls inside comments are ignored', () => {
	const text = [
		'; CYCLE82(1, 2, 3, 4, 5, 6, 7)',
		'G1 X10 ; CYCLE83(1,2,3)',
		'CYCLE81(1, 2, 3, 4, 5) ; drilling'
	].join('\n');
	const calls = parseCycleCalls(text, CYCLES);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].name, 'CYCLE81');
});

test('semicolon inside a string does not start a comment', () => {
	const text = 'MSG("a;b") CYCLE82(1, 2, 3, 4, 5, 6)';
	const stripped = stripComments(text);
	assert.strictEqual(stripped.length, text.length);
	const calls = parseCycleCalls(text, CYCLES);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].args.length, 6);
});

test('MCALL call is found', () => {
	const calls = parseCycleCalls('MCALL CYCLE82(2,0,1,-2.6,,0)', CYCLES);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].name, 'CYCLE82');
	assert.strictEqual(calls[0].args.length, 6);
	assert.strictEqual(calls[0].args[4].param, 'DPR');
});

test('cycle name inside a longer word does not match', () => {
	assert.strictEqual(parseCycleCalls('MYCYCLE82(1,2,3)', CYCLES).length, 0);
	assert.strictEqual(parseCycleCalls('XCYCLE82(1,2,3)', CYCLES).length, 0);
	assert.strictEqual(parseCycleCalls('CYCLE82X(1,2,3)', CYCLES).length, 0);
});

test('unknown cycles and calls without parentheses are ignored', () => {
	assert.strictEqual(parseCycleCalls('CYCLE99(1,2,3)', CYCLES).length, 0);
	assert.strictEqual(parseCycleCalls('CYCLE82', CYCLES).length, 0);
	assert.strictEqual(parseCycleCalls('CYCLE82 (1, 2, 3, 4, 5)', CYCLES).length, 1);
});

test('nested parentheses do not split arguments', () => {
	const calls = parseCycleCalls('CYCLE82((1+2), 0, 1, -2.6, , 0)', CYCLES);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].args.length, 6);
	assert.strictEqual(calls[0].args[0].text, '(1+2)');
	assert.strictEqual(calls[0].args[0].param, 'RTP');
});

test('CYCLE83: all 17 parameters map in order', () => {
	const args = Array.from({ length: 17 }, (_, i) => String(i + 1)).join(',');
	const calls = parseCycleCalls(`CYCLE83(${args})`, CYCLES);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].args.length, 17);
	assert.strictEqual(calls[0].args[0].param, 'RTP');
	assert.strictEqual(calls[0].args[11].param, 'VARI');
	assert.strictEqual(calls[0].args[16].param, '_DIS1');
	assert.strictEqual(calls[0].excess, 0);
});

test('empty call has zero arguments', () => {
	const calls = parseCycleCalls('CYCLE82()', CYCLES);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].args.length, 0);
	assert.strictEqual(calls[0].excess, 0);
});

test('two calls on separate lines are both found', () => {
	const text = 'CYCLE81(1,2,3,4,5)\nCYCLE82(1,2,3,4,5,6)';
	const calls = parseCycleCalls(text, CYCLES);
	assert.strictEqual(calls.length, 2);
	assert.strictEqual(calls[0].name, 'CYCLE81');
	assert.strictEqual(calls[1].name, 'CYCLE82');
});

test('stripComments preserves length and removes comment text', () => {
	const text = 'G1 X10 ; comment\nG1 X20';
	const stripped = stripComments(text);
	assert.strictEqual(stripped.length, text.length);
	assert.ok(!stripped.includes('comment'));
	assert.ok(stripped.includes('G1 X20'));
});
