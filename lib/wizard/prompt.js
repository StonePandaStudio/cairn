'use strict';

// The wizard's prompt layer, no dependency. Two implementations behind one interface
// { ask, confirm, choose, multi, write, close }:
//   - createTtyPrompter: arrow-key menus on a real terminal (raw keypresses);
//   - createLinePrompter: numbered choices on plain lines, for pipes, CI and tests. Lines are
//     queued as they arrive, so scripted stdin (a pipe that delivers everything at once) is not
//     lost between questions.
// createPrompter picks one by whether both ends are a TTY. Callers only use the interface.

const readline = require('readline');
const { UserError, Back } = require('../errors');

const INPUT_ENDED = 'input ended before the wizard finished (nothing more was run)';

// ------------------------------------------------------------------ line prompter

function createLinePrompter({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, terminal: false });
  const queue = [];
  let waiting = null;
  let closed = false;

  rl.on('line', (line) => {
    if (waiting) {
      const w = waiting;
      waiting = null;
      w.resolve(line);
    } else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    if (waiting) {
      const w = waiting;
      waiting = null;
      w.reject(new UserError(INPUT_ENDED));
    }
  });

  const write = (s) => output.write(s);

  function readLine() {
    if (queue.length) return Promise.resolve(queue.shift());
    if (closed) return Promise.reject(new UserError(INPUT_ENDED));
    return new Promise((resolve, reject) => {
      waiting = { resolve, reject };
    });
  }

  async function ask(text, def) {
    write(`${text}${def !== undefined && def !== '' ? ` [${def}]` : ''}: `);
    const line = (await readLine()).trim();
    if (line === '<' || line.toLowerCase() === 'back') throw new Back();
    return line === '' && def !== undefined ? def : line;
  }

  async function confirm(text, def = true) {
    for (;;) {
      const a = (await ask(`${text} (${def ? 'Y/n' : 'y/N'})`, '')).toLowerCase();
      if (a === '') return def;
      if (a === 'y' || a === 'yes') return true;
      if (a === 'n' || a === 'no') return false;
      write('  answer y or n\n');
    }
  }

  function list(options) {
    options.forEach((o, i) => write(`  ${i + 1}) ${o.label}${o.hint ? `  — ${o.hint}` : ''}\n`));
  }

  // One of `options` ({ value, label, hint? }); the answer is a number or the value itself.
  async function choose(text, options, defIndex = 0) {
    write(`${text}\n`);
    list(options);
    for (;;) {
      const a = await ask('>', String(defIndex + 1));
      const byNumber = /^\d+$/.test(a) ? options[Number(a) - 1] : undefined;
      const hit = byNumber || options.find((o) => String(o.value) === a);
      if (hit) return hit.value;
      write(`  pick 1-${options.length}\n`);
    }
  }

  // Any number of `options`: "1,3", "1 3", "all", "none" or empty for the defaults (indexes).
  async function multi(text, options, defIndexes = []) {
    write(`${text}\n`);
    list(options);
    const def = defIndexes.length ? defIndexes.map((i) => i + 1).join(',') : 'none';
    for (;;) {
      const a = (await ask('> numbers, "all" or "none"', def)).toLowerCase();
      if (a === 'none') return [];
      if (a === 'all') return options.map((o) => o.value);
      const picked = a.split(/[\s,]+/).filter(Boolean);
      const items = picked.map((p) => (/^\d+$/.test(p) ? options[Number(p) - 1] : options.find((o) => String(o.value) === p)));
      if (items.length && items.every(Boolean)) return [...new Set(items.map((o) => o.value))];
      write(`  numbers from 1 to ${options.length}, separated by commas\n`);
    }
  }

  return { ask, confirm, choose, multi, write, close: () => rl.close(), backHint: 'Type < to go back one step.' };
}

// ------------------------------------------------------------------- tty prompter

// up/down (or j/k) move, enter takes, space toggles in a multi-select, a / n select all / none,
// a digit jumps to that row, ctrl+c cancels. Raw keypresses only; Node delivers them on Windows
// consoles and Windows Terminal as well.
function createTtyPrompter({ input = process.stdin, output = process.stdout } = {}) {
  readline.emitKeypressEvents(input);
  const raw = typeof input.setRawMode === 'function';
  const wasRaw = raw ? Boolean(input.isRaw) : false;
  if (raw) input.setRawMode(true);
  input.resume();

  const keys = [];
  let waiting = null;
  let closed = false;
  const onKey = (str, key) => {
    const k = { str: str || '', name: key && key.name, ctrl: Boolean(key && key.ctrl), meta: Boolean(key && key.meta) };
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(k);
    } else keys.push(k);
  };
  input.on('keypress', onKey);

  const nextKey = () =>
    new Promise((resolve) => {
      if (keys.length) resolve(keys.shift());
      else waiting = resolve;
    }).then((k) => {
      if (k.ctrl && (k.name === 'c' || k.name === 'd')) throw new UserError('cancelled (nothing more was run)');
      if (k.name === 'escape') throw new Back();
      return k;
    });

  const ESC = '\x1b';
  const write = (s) => output.write(s);
  const bold = (s) => `${ESC}[1m${s}${ESC}[22m`;
  const dim = (s) => `${ESC}[2m${s}${ESC}[22m`;
  const cyan = (s) => `${ESC}[36m${s}${ESC}[39m`;
  const isEnter = (k) => k.name === 'return' || k.name === 'enter';
  const printable = (k) => !k.ctrl && !k.meta && k.str.length > 0 && !/[\x00-\x1f\x7f]/.test(k.str);

  async function ask(text, def) {
    write(`${text}${def !== undefined && def !== '' ? dim(` [${def}]`) : ''}: `);
    let buf = '';
    for (;;) {
      const k = await nextKey();
      if (isEnter(k)) {
        write('\n');
        return buf.trim() === '' && def !== undefined ? def : buf.trim();
      }
      if (k.name === 'backspace') {
        if (buf) {
          buf = buf.slice(0, -1);
          write('\b \b');
        }
      } else if (printable(k)) {
        buf += k.str;
        write(k.str);
      }
    }
  }

  async function confirm(text, def = true) {
    write(`${text} ${dim(def ? '(Y/n)' : '(y/N)')} `);
    for (;;) {
      const k = await nextKey();
      let answer = null;
      if (isEnter(k)) answer = def;
      else if (k.str.toLowerCase() === 'y') answer = true;
      else if (k.str.toLowerCase() === 'n') answer = false;
      if (answer !== null) {
        write(`${answer ? 'yes' : 'no'}\n`);
        return answer;
      }
    }
  }

  // Draws `options` and redraws them in place by moving the cursor up over the previous frame.
  function makeList(options, marker) {
    let drawn = 0;
    const clear = () => {
      if (drawn) write(`${ESC}[${drawn}A\r${ESC}[J`);
      drawn = 0;
    };
    const draw = (cursor) => {
      clear();
      const lines = options.map((o, i) => {
        const on = i === cursor;
        const label = on ? bold(cyan(o.label)) : o.label;
        return `${on ? cyan('>') : ' '} ${marker(i)}${label}${o.hint ? dim(`  ${o.hint}`) : ''}`;
      });
      write(`${lines.join('\n')}\n`);
      drawn = lines.length;
    };
    const finish = (summary) => {
      clear();
      write(`${summary}\n`);
    };
    return { draw, finish };
  }

  function move(k, cursor, n) {
    if (k.name === 'up' || k.str === 'k') return (cursor + n - 1) % n;
    if (k.name === 'down' || k.str === 'j') return (cursor + 1) % n;
    if (k.name === 'home') return 0;
    if (k.name === 'end') return n - 1;
    if (/^[1-9]$/.test(k.str) && Number(k.str) <= n) return Number(k.str) - 1;
    return cursor;
  }

  async function choose(text, options, defIndex = 0) {
    write(`${bold(text.trim())}  ${dim('(up/down, enter, esc back)')}\n`);
    const list = makeList(options, () => '');
    let cursor = defIndex;
    list.draw(cursor);
    for (;;) {
      const k = await nextKey();
      if (isEnter(k)) {
        list.finish(`  ${options[cursor].label}`);
        return options[cursor].value;
      }
      const next = move(k, cursor, options.length);
      if (next !== cursor) {
        cursor = next;
        list.draw(cursor);
      }
    }
  }

  async function multi(text, options, defIndexes = []) {
    write(`${bold(text.trim())}  ${dim('(up/down, space toggles, a all, n none, enter, esc back)')}\n`);
    const on = new Set(defIndexes);
    const list = makeList(options, (i) => (on.has(i) ? '[x] ' : '[ ] '));
    let cursor = 0;
    list.draw(cursor);
    for (;;) {
      const k = await nextKey();
      if (isEnter(k)) {
        const picked = options.filter((_, i) => on.has(i));
        list.finish(`  ${picked.length ? picked.map((o) => o.label).join(', ') : 'none'}`);
        return picked.map((o) => o.value);
      }
      if (k.name === 'space' || k.str === ' ') {
        if (on.has(cursor)) on.delete(cursor);
        else on.add(cursor);
      } else if (k.str === 'a') options.forEach((_, i) => on.add(i));
      else if (k.str === 'n') on.clear();
      else cursor = move(k, cursor, options.length);
      list.draw(cursor);
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    input.removeListener('keypress', onKey);
    if (raw) input.setRawMode(wasRaw);
    input.pause();
  }

  return { ask, confirm, choose, multi, write, close, backHint: 'Esc goes back one step, ctrl+c quits.' };
}

// A real terminal gets arrow keys; a pipe (scripts, CI, tests) gets numbered lines.
function createPrompter(opts = {}) {
  const input = opts.input || process.stdin;
  const output = opts.output || process.stdout;
  const tty = opts.tty !== undefined ? opts.tty : Boolean(input.isTTY && output.isTTY);
  return tty ? createTtyPrompter({ input, output }) : createLinePrompter({ input, output });
}

module.exports = { createPrompter, createLinePrompter, createTtyPrompter };
