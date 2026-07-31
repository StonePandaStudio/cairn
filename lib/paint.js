'use strict';

// Tiny ANSI helper. Every command takes the same --color / --no-color pair, so
// the enabled flag is decided once at the CLI boundary and threaded down.

function makePaint(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return {
    enabled,
    bold: wrap(1),
    dim: wrap(2),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    blue: wrap(34),
    magenta: wrap(35),
    cyan: wrap(36),
  };
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

// Column-aligned table that measures visible width, not byte width, so coloured
// cells don't blow up the alignment.
function table(rows, headers, paint) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i]).length)),
  );
  const line = (cells) =>
    cells
      .map((cell, i) => String(cell) + ' '.repeat(widths[i] - stripAnsi(cell).length))
      .join('  ')
      .trimEnd();
  const out = [paint.bold(line(headers)), paint.dim(widths.map((w) => '─'.repeat(w)).join('  '))];
  for (const row of rows) out.push(line(row));
  return out.join('\n');
}

module.exports = { makePaint, stripAnsi, table };
