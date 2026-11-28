'use strict';

// Parameter names of SINUMERIK machining cycles, in call order.
//
// Only cycles whose parameter lists have been verified against the
// official Siemens programming manual are listed here. Do not add a
// cycle from memory: check the manual first, then append the entry.
//
// To support another cycle, add one line:
//   CYCLE99: ['PARAM1', 'PARAM2', ...],
const CYCLES = {
	CYCLE81: ['RTP', 'RFP', 'SDIS', 'DP', 'DPR'],
	CYCLE82: ['RTP', 'RFP', 'SDIS', 'DP', 'DPR', 'DTB'],
	CYCLE83: [
		'RTP', 'RFP', 'SDIS', 'DP', 'DPR', 'FDEP', 'FDPR', 'DAM', 'DTB',
		'DTS', 'FRF', 'VARI', '_AXN', '_MDEP', '_VRT', '_DTD', '_DIS1'
	]
};

module.exports = { CYCLES };
