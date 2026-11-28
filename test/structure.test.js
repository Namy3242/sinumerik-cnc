'use strict';

// Unit tests for the structural diagnostics. Run with:
//   node --test test/structure.test.js

const test = require('node:test');
const assert = require('node:assert');
const { checkStructure, MAX_BLOCK_LENGTH } = require('../src/structure');

const ofKind = (text, kind) => checkStructure(text).filter((d) => d.kind === kind);
const structure = (text) => ofKind(text, 'structure');

test('a balanced IF / ELSE / ENDIF produces no diagnostics', () => {
	const text = ['IF R1>0', 'G1 X10', 'ELSE', 'G1 X20', 'ENDIF'].join('\n');
	assert.deepStrictEqual(checkStructure(text), []);
});

test('ELSEIF is a marker and does not break the pairing', () => {
	const text = ['IF R1==1', 'G1 X1', 'ELSEIF R1==2', 'G1 X2', 'ELSE', 'ENDIF'].join('\n');
	assert.deepStrictEqual(structure(text), []);
});

test('all six structures pair up when balanced', () => {
	const text = [
		'LOOP',
		'WHILE R1<3',
		'FOR I=1 TO 3',
		'IF I==2',
		'ENDIF',
		'ENDFOR',
		'ENDWHILE',
		'ENDLOOP',
		'REPEAT',
		'G4 F1',
		'UNTIL R2>5',
		'CASE R3 OF 1 GOTOF A 2 GOTOF B DEFAULT GOTOF C ENDCASE'
	].join('\n');
	assert.deepStrictEqual(structure(text), []);
});

test('nested structures in mixed order pair correctly', () => {
	const text = [
		'WHILE R1<10',
		'LOOP',
		'IF R2==0',
		'REPEAT',
		'UNTIL R3',
		'ENDIF',
		'ENDLOOP',
		'ENDWHILE'
	].join('\n');
	assert.deepStrictEqual(structure(text), []);
});

test('an unclosed IF is reported at the IF keyword', () => {
	const text = 'G54\nIF R1>0\nG1 X10';
	const diags = structure(text);
	assert.strictEqual(diags.length, 1);
	assert.strictEqual(text.slice(diags[0].start, diags[0].end), 'IF');
	assert.match(diags[0].message, /IF without a matching ENDIF/);
});

test('an unclosed REPEAT is reported (UNTIL missing)', () => {
	const diags = structure('REPEAT\nG1 X1');
	assert.strictEqual(diags.length, 1);
	assert.match(diags[0].message, /REPEAT without a matching UNTIL/);
});

test('a closer without an opener is reported', () => {
	const text = 'G1 X10\nENDIF';
	const diags = structure(text);
	assert.strictEqual(diags.length, 1);
	assert.strictEqual(text.slice(diags[0].start, diags[0].end), 'ENDIF');
	assert.match(diags[0].message, /ENDIF without a matching IF/);
});

test('an extra ENDLOOP after a balanced loop is reported', () => {
	const diags = structure('LOOP\nENDLOOP\nENDLOOP');
	assert.strictEqual(diags.length, 1);
	assert.match(diags[0].message, /ENDLOOP without a matching LOOP/);
});

test('a mismatched closer reports the inner unclosed opener only', () => {
	// ENDLOOP closes the LOOP; the IF inside was never closed.
	const diags = structure('LOOP\nIF R1\nENDLOOP');
	assert.strictEqual(diags.length, 1);
	assert.match(diags[0].message, /IF without a matching ENDIF/);
});

test('keywords in comments are ignored', () => {
	const text = ['; IF R1>0', 'G1 X10 ; ENDIF would go here', '; LOOP'].join('\n');
	assert.deepStrictEqual(checkStructure(text), []);
});

test('keywords inside strings are ignored', () => {
	const text = 'MSG("IF LOOP WHILE")\nG1 X1';
	assert.deepStrictEqual(structure(text), []);
});

test('keywords that are part of a longer word do not match', () => {
	const text = ['FORMAT=1', 'BEFORE=2', 'LOOPY=3', 'ENDIFX=4', 'WHILEY=5'].join('\n');
	assert.deepStrictEqual(structure(text), []);
});

test('a conditional jump IF ... GOTOF is not a block opener', () => {
	const text = 'IF R1>0 GOTOF ENDLABEL\nG1 X1\nENDLABEL:';
	assert.deepStrictEqual(structure(text), []);
});

test('REPEAT with a label operand is program-section repetition, not a loop', () => {
	const text = 'SECTION1:\nG1 X1\nREPEAT SECTION1 P=3';
	assert.deepStrictEqual(structure(text), []);
});

test('lowercase keywords pair the same way', () => {
	assert.deepStrictEqual(structure('if R1\nendif'), []);
	assert.deepStrictEqual(structure('loop\nendloop'), []);
});

test('a duplicate block number is reported at the second use', () => {
	const text = 'N10 G54\nN20 G1 X10\nN10 G1 X20';
	const diags = ofKind(text, 'duplicate-block-number');
	assert.strictEqual(diags.length, 1);
	assert.strictEqual(text.slice(diags[0].start, diags[0].end), 'N10');
	assert.match(diags[0].message, /line 1/);
});

test('leading zeros do not hide a duplicate block number', () => {
	const diags = ofKind('N10 G54\nN010 G55', 'duplicate-block-number');
	assert.strictEqual(diags.length, 1);
});

test('distinct block numbers and labels produce no warning', () => {
	const text = ['N10 G54', 'START:', 'N20 G1 X10', 'ENDLABEL:', 'M30'].join('\n');
	assert.deepStrictEqual(ofKind(text, 'duplicate-block-number'), []);
});

test('a label that looks like a block number is not a block number', () => {
	const text = 'N10:\nG1 X10\nN10 G1 X20';
	assert.deepStrictEqual(ofKind(text, 'duplicate-block-number'), []);
});

test('block numbers inside comments are ignored', () => {
	const text = 'N10 G54\n; N10 mentioned in a comment';
	assert.deepStrictEqual(ofKind(text, 'duplicate-block-number'), []);
});

test('a block of exactly 512 characters is allowed', () => {
	const line = 'G1 X' + '1'.repeat(MAX_BLOCK_LENGTH - 4);
	assert.strictEqual(line.length, MAX_BLOCK_LENGTH);
	assert.deepStrictEqual(ofKind(line, 'block-length'), []);
});

test('a block of 513 characters is reported', () => {
	const line = 'G1 X' + '1'.repeat(MAX_BLOCK_LENGTH - 3);
	assert.strictEqual(line.length, MAX_BLOCK_LENGTH + 1);
	const diags = ofKind(line, 'block-length');
	assert.strictEqual(diags.length, 1);
	assert.match(diags[0].message, /513 characters/);
});

test('the comment counts toward the block length', () => {
	const line = 'G1 X1 ;' + 'x'.repeat(MAX_BLOCK_LENGTH);
	const diags = ofKind(line, 'block-length');
	assert.strictEqual(diags.length, 1);
});

test('a normal program passes all checks', () => {
	const text = [
		'N10 G54 G90 G17',
		'N20 T1 D1 M6',
		'N30 IF R1>0',
		'N40 G1 X10 F100',
		'N50 ELSE',
		'N60 G1 X20',
		'N70 ENDIF',
		'N80 LOOP',
		'N90 G4 F1',
		'N100 ENDLOOP',
		'N110 M30'
	].join('\n');
	assert.deepStrictEqual(checkStructure(text), []);
});
