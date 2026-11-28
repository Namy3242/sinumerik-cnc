# sinumerik_cnc_ex

sinumerik_cnc_ex is set of syntaxes and snippets.

## Features

Some syntaxes and snippets.

### Cycle parameter hints

For the cycles below, the extension shows the name of each argument
directly in the editor (inlay hints), explains the cycle and each
argument on hover, and warns when a call passes more arguments than
the cycle takes. Trailing arguments may be omitted, and an empty
argument (`,,`) still shows its parameter name, so it is always clear
which value belongs to which parameter.

Supported cycles (parameter lists verified against the official
Siemens programming manual — only these three for now):

| Cycle | Parameters |
| --- | --- |
| CYCLE81 | RTP, RFP, SDIS, DP, DPR |
| CYCLE82 | RTP, RFP, SDIS, DP, DPR, DTB |
| CYCLE83 | RTP, RFP, SDIS, DP, DPR, FDEP, FDPR, DAM, DTB, DTS, FRF, VARI, _AXN, _MDEP, _VRT, _DTD, _DIS1 |

Inlay hints require the VS Code setting `editor.inlayHints.enabled`
to be on (it is by default).

### G-code hover

Hovering a G code or a modal program word shows its meaning, its
G-group number, and whether it is modal (stays in effect until
replaced) or non-modal (effective in its block only). The dictionary
covers 37 codes whose group assignments were verified against the
official Siemens programming manual — the motion group (G0, G1, G2,
G3, CIP, G33), dwell/home commands (G4, G74, G75), the programmable
frame commands (TRANS, ATRANS, ROT, AROT, SCALE, ASCALE, MIRROR,
AMIRROR), plane selection (G17–G19), tool radius compensation
(G40–G42), work offsets (G500, G54–G57, plus the G505–G599 range),
frame suppression (G53, SUPA), dimensioning (G90, G91) and feed types
(G93–G97).

### Modal state in the status bar

The status bar shows the modal codes currently in effect, inferred
by scanning the file up to the cursor line — for example
`Modal: G1 | G17 | G54 | G90`. It updates as the cursor moves.

Only codes the file itself selects are shown. The state at the start
of a file depends on machine data ($MC_GCODE_RESET_VALUES), which the
extension cannot know, so groups the file never sets are left out
instead of being guessed.

### Structure diagnostics

Three structural problems are flagged as warnings while you edit:

- **Unmatched control structures** — the block structures
  `IF … ENDIF`, `LOOP … ENDLOOP`, `WHILE … ENDWHILE`,
  `FOR … ENDFOR`, `REPEAT … UNTIL` and `CASE … ENDCASE` must be
  opened and closed in pairs. An opener that is never closed, and a
  closer without a matching opener, are both flagged. Keywords in
  comments and strings are ignored. Two look-alikes are deliberately
  not treated as block openers: `IF <condition> GOTOF <label>` is a
  conditional jump, and `REPEAT <label> P=<n>` repeats a program
  section rather than opening a loop.
- **Duplicate block numbers** — an `N…` block number at the start of
  a block may be used only once per file. Labels (`NAME:`) are not
  block numbers.
- **Overlong blocks** — one block may be at most 512 characters,
  comment included.

### Go to definition and find references

F12 (go to definition) and Shift+F12 (find all references) work
for the names a program defines itself:

- **DEF variables** — `DEF INT MYVAR`, including several variables
  in one statement (`DEF REAL X, Y`), array sizes and initial
  values. Resolved within the same file only.
- **Block labels** — `NAME:` at the start of a block, so a jump
  (`GOTOF`, `GOTOB`, `GOTOS`, `GOTO`) can jump to its target.
  Resolved within the same file only.
- **Subprograms** — `PROC NAME(...)` definitions, found across
  files (see below).

For subprograms, a definition in the same file wins. If the file
does not define the name, the extension searches the workspace:
every `.mpf` / `.spf` / `.def` file is indexed for its `PROC`
definitions, and a call jumps to the definition wherever it is.
If no file defines a `PROC` with that name, the SINUMERIK
convention applies — a subprogram lives in the file of the same
name — and the call jumps to the top of that file (`NAME.spf`)
instead. When several files define the same name, all of them
are offered. The cross-file lookup applies to names used as
subprogram calls: after `CALL` or `MCALL`, in an `EXTERN`
declaration, or as a call at the start of a block. The index
follows files as they are created, edited and deleted.

Names are matched case-insensitively, as on the control, and
occurrences inside comments and strings are ignored.

### Modal call (MCALL) warning

`MCALL <name>(...)` makes a subprogram or cycle modal: it runs
again after every traversing block until it is cancelled with a
bare `MCALL` block. If a modal call is still active when the
program ends (`M2`, `M30`, `M17`, `RET`) — or the file simply
ends — the `MCALL` is flagged with a warning, because a forgotten
cancellation is a common source of surprising extra calls.

### Snippets

Besides the original snippets, the following are included:
`CYCLE82` (drilling cycle call with a placeholder for each
parameter), `IFN` (IF … ENDIF without ELSE), `WHILE`
(WHILE … ENDWHILE), `FRAME` (G54 plus a TRANS translation) and
`WHENEVER` (a synchronized action, `WHENEVER … DO …`). Tab stops
move through the values that need editing.

## Release Notes

Syntax highlighting and snipets are covered for basic CNC command.

### 0.1.0

Added cycle parameter hints (inlay hints, hover, argument-count
warning) for CYCLE81, CYCLE82 and CYCLE83.

### 0.0.1

Initial release.

### 0.0.2

### 0.0.3
 
fixed some bugs.

### 0.0.4

add source.

### 0.0.5
 
fixed some bugs(Highlight). ex) FAKTOR

