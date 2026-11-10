'use strict';

// Small helpers shared by the code providers.

const fs = require('fs');

class CodeSourceError extends Error {
  constructor(message, code = 'failed') {
    super(message);
    this.name = 'CodeSourceError';
    this.code = code;
  }
}

const toPosix = (p) => String(p).replace(/\\/g, '/');

// Append `line` to a .gitignore (creating it) unless already present. -> true if written.
function appendIgnore(file, line) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    /* created below */
  }
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return false;
  fs.writeFileSync(file, text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n');
  return true;
}

module.exports = { CodeSourceError, toPosix, appendIgnore };
