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

