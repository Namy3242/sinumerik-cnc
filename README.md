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

