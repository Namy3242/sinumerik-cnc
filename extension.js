'use strict';

// Editor assistance for SINUMERIK programs.
//
// - Cycle parameter-name hints: shows the name of each cycle argument
//   as an inlay hint, explains cycles and arguments on hover, and
//   warns when a call passes more arguments than the cycle takes.
//   Only the cycles listed in src/cycles.js (verified against the
//   Siemens programming manual) are supported.
// - G-code hover: explains the codes listed in src/gcodes.js
//   (meaning, G group, modal or non-modal).
// - Modal state tracker: the status bar shows the modal codes the
//   file itself has selected up to the cursor line. Groups the file
//   never sets are not shown: their power-on defaults come from
//   machine data ($MC_GCODE_RESET_VALUES), not from the program.
// - Structural diagnostics: unmatched control structures
//   (IF/LOOP/WHILE/FOR/REPEAT/CASE), duplicate block numbers and
//   blocks longer than 512 characters are flagged as warnings
//   (see src/structure.js).

const vscode = require('vscode');
const { CYCLES } = require('./src/cycles');
const { parseCycleCalls, signature } = require('./src/parser');
const { GROUP_NAMES } = require('./src/gcodes');
const { modalStateAt, formatModalState, gcodeAtOffset } = require('./src/modal');
const { checkStructure } = require('./src/structure');

const SELECTOR = { language: 'sinumerik' };

function gcodeMarkdown(entry) {
	const md = new vscode.MarkdownString();
	const groupName = GROUP_NAMES[entry.group] || '';
	md.appendMarkdown(`**${entry.code}** — ${entry.desc}\n\n`);
	md.appendMarkdown(
		`G group ${entry.group}${groupName ? ` (${groupName})` : ''} · ` +
		(entry.modal ? 'Modal' : 'Non-modal (effective in its block only)')
	);
	if (entry.group === 3) {
		md.appendMarkdown(
			'\n\nFrame commands of different components ' +
			'(translation / rotation / scaling / mirroring) combine; ' +
			'the absolute form replaces, the additive form (A…) adds.'
		);
	}
	return md;
}

function signatureMarkdown(name) {
	const md = new vscode.MarkdownString();
	md.appendCodeblock(signature(name, CYCLES), 'sinumerik');
	md.appendMarkdown(
		`SINUMERIK cycle with ${CYCLES[name].length} parameters. ` +
		'Trailing arguments may be omitted; an empty argument (`,,`) keeps its default.'
	);
	return md;
}

function activate(context) {
	// --- Inlay hints: "RTP:" in front of every argument ---------------
	context.subscriptions.push(
		vscode.languages.registerInlayHintsProvider(SELECTOR, {
			provideInlayHints(document, range) {
				const rangeStart = document.offsetAt(range.start);
				const rangeEnd = document.offsetAt(range.end);
				const hints = [];
				for (const call of parseCycleCalls(document.getText(), CYCLES)) {
					for (const arg of call.args) {
						if (!arg.param) {
							continue;
						}
						if (arg.textStart < rangeStart || arg.textStart > rangeEnd) {
							continue;
						}
						const hint = new vscode.InlayHint(
							document.positionAt(arg.textStart),
							`${arg.param}:`
						);
						hint.kind = vscode.InlayHintKind.Parameter;
						hint.paddingRight = true;
						hints.push(hint);
					}
				}
				return hints;
			}
		})
	);

	// --- Hover: signature on the cycle name, parameter on arguments ---
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(SELECTOR, {
			provideHover(document, position) {
				const offset = document.offsetAt(position);
				const calls = parseCycleCalls(document.getText(), CYCLES);
				for (const call of calls) {
					if (offset >= call.nameStart && offset <= call.nameEnd) {
						return new vscode.Hover(
							signatureMarkdown(call.name),
							new vscode.Range(
								document.positionAt(call.nameStart),
								document.positionAt(call.nameEnd)
							)
						);
					}
					if (call.closeParen > 0 && offset > call.openParen && offset < call.closeParen) {
						const arg = call.args.find((a) => offset >= a.start && offset <= a.end);
						if (!arg) {
							return undefined;
						}
						if (arg.param) {
							const md = new vscode.MarkdownString();
							md.appendMarkdown(
								`**${arg.param}** — argument ${arg.index + 1} of ${call.name}\n\n`
							);
							md.appendCodeblock(signature(call.name, CYCLES), 'sinumerik');
							return new vscode.Hover(md);
						}
						const md = new vscode.MarkdownString();
						md.appendMarkdown(
							`Argument ${arg.index + 1} of ${call.name}: ` +
							`this cycle takes only ${CYCLES[call.name].length} arguments.`
						);
						return new vscode.Hover(md);
					}
				}
				// A known cycle name without a call (e.g. after MCALL).
				const wordRange = document.getWordRangeAtPosition(
					position,
					/[A-Za-z_][A-Za-z0-9_]*/
				);
				if (wordRange) {
					const word = document.getText(wordRange);
					if (Object.prototype.hasOwnProperty.call(CYCLES, word)) {
						return new vscode.Hover(signatureMarkdown(word), wordRange);
					}
				}
				// A G code or modal program word from the dictionary.
				const hit = gcodeAtOffset(document.getText(), offset);
				if (hit) {
					return new vscode.Hover(
						gcodeMarkdown(hit.entry),
						new vscode.Range(
							document.positionAt(hit.start),
							document.positionAt(hit.end)
						)
					);
				}
				return undefined;
			}
		})
	);

	// --- Diagnostics: cycle argument count + program structure --------
	const diagnostics = vscode.languages.createDiagnosticCollection('sinumerik');
	context.subscriptions.push(diagnostics);

	const refreshDiagnostics = (document) => {
		if (document.languageId !== 'sinumerik') {
			return;
		}
		const text = document.getText();
		const found = [];
		for (const call of parseCycleCalls(text, CYCLES)) {
			if (call.excess === 0) {
				continue;
			}
			const max = CYCLES[call.name].length;
			const first = call.args[max];
			const last = call.args[call.args.length - 1];
			const range = new vscode.Range(
				document.positionAt(first.start),
				document.positionAt(last.end)
			);
			const diagnostic = new vscode.Diagnostic(
				range,
				`${call.name} takes at most ${max} arguments, but ${call.args.length} were given.`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.source = 'sinumerik';
			found.push(diagnostic);
		}
		for (const issue of checkStructure(text)) {
			const diagnostic = new vscode.Diagnostic(
				new vscode.Range(
					document.positionAt(issue.start),
					document.positionAt(issue.end)
				),
				issue.message,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.source = 'sinumerik';
			found.push(diagnostic);
		}
		diagnostics.set(document.uri, found);
	};

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
		vscode.workspace.onDidChangeTextDocument((e) => refreshDiagnostics(e.document)),
		vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri))
	);
	for (const document of vscode.workspace.textDocuments) {
		refreshDiagnostics(document);
	}

	// --- Status bar: modal state up to the cursor line ----------------
	const statusBar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		100
	);
	statusBar.name = 'SINUMERIK modal state';
	context.subscriptions.push(statusBar);

	const updateStatusBar = () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'sinumerik') {
			statusBar.hide();
			return;
		}
		// Scan through the end of the cursor line: the state shown is
		// the state in effect on that line.
		const lineEnd = editor.document.lineAt(editor.selection.active.line).range.end;
		const offset = editor.document.offsetAt(lineEnd);
		const state = modalStateAt(editor.document.getText(), offset);
		if (state.length === 0) {
			statusBar.hide();
			return;
		}
		statusBar.text = `Modal: ${formatModalState(state)}`;
		statusBar.tooltip =
			'Modal G-code state selected in this file up to the cursor line.\n' +
			'Groups the file has not set are not shown — their defaults ' +
			'depend on machine data ($MC_GCODE_RESET_VALUES).';
		statusBar.show();
	};

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
		vscode.window.onDidChangeTextEditorSelection(updateStatusBar),
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (
				vscode.window.activeTextEditor &&
				e.document === vscode.window.activeTextEditor.document
			) {
				updateStatusBar();
			}
		})
	);
	updateStatusBar();
}

function deactivate() {}

module.exports = { activate, deactivate };
