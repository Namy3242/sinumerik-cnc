'use strict';

// Cycle parameter-name hints for SINUMERIK programs.
//
// Shows the name of each cycle argument as an inlay hint, explains
// cycles and arguments on hover, and warns when a call passes more
// arguments than the cycle takes. Only the cycles listed in
// src/cycles.js (verified against the Siemens programming manual)
// are supported.

const vscode = require('vscode');
const { CYCLES } = require('./src/cycles');
const { parseCycleCalls, signature } = require('./src/parser');

const SELECTOR = { language: 'sinumerik' };

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
				return undefined;
			}
		})
	);

	// --- Diagnostics: more arguments than the cycle takes -------------
	const diagnostics = vscode.languages.createDiagnosticCollection('sinumerik');
	context.subscriptions.push(diagnostics);

	const refreshDiagnostics = (document) => {
		if (document.languageId !== 'sinumerik') {
			return;
		}
		const found = [];
		for (const call of parseCycleCalls(document.getText(), CYCLES)) {
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
}

function deactivate() {}

module.exports = { activate, deactivate };
