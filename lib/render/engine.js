'use strict';

// A very small template engine — the subset of Handlebars the preset files use
// and nothing more. Pure: no fs, no cairn knowledge. The driver in ./index.js
// supplies the context and the `{{> stack/… }}` partial resolver.
//
// Supported:
//   {{ path }}            substitution, not HTML-escaped (output is markdown)
//   {{ this.x }}          `this` and dotted paths, plus @index / @index_1 / @first / @last inside #each
//   {{#if path}}…{{/if}}  with optional {{else}}
//   {{#each path}}…{{/each}}
//   {{> stack/name }}     resolved by the caller-supplied resolvePartial(name, ctx)
//   {{! comment }}        dropped
//   a leading <!-- cairn preset: … --> or <!-- cairn:… --> block is dropped

const TOKEN = /(\{\{!(?:(?!\}\})[\s\S])*\}\}|\{\{\{[^}]*\}\}\}|\{\{[#/>]?\s*[^}]*?\}\})/;

// Drop cairn's own editorial comments — `<!-- cairn preset: … -->` /
// `{{! … }}` — wherever they sit in a template. They document the preset for a
// human reading `presets/` and must not reach the rendered output. Then tidy the
// whitespace a block tag on its own line would otherwise leave behind (Mustache's
// "standalone" rule), and collapse the runs of blank lines that removing a
// comment block opens up.
function stripHeaderComment(src) {
  return String(src)
    .replace(/^﻿/, '')
    .replace(/[ \t]*<!--\s*cairn[:\s][\s\S]*?-->[ \t]*\n?/g, '')
    .replace(/^[ \t]*\{\{!(?:(?!\}\})[\s\S])*\}\}[ \t]*\r?\n/gm, '')
    .replace(/\{\{!(?:(?!\}\})[\s\S])*\}\}/g, '')
    .replace(/^[ \t]*(\{\{[#/][^}]*\}\}|\{\{\s*else\s*\}\})[ \t]*\r?\n/gm, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
}

function tokenize(src) {
  return src
    .split(TOKEN)
    .filter((s) => s !== '' && s !== undefined)
    .map((s) => {
      const m = s.match(/^\{\{([#/>!]?)\s*([\s\S]*?)\s*\}\}$/);
      if (!m) return { t: 'text', v: s };
      const [, sigil, body] = m;
      if (sigil === '!') return { t: 'comment' };
      if (sigil === '>') return { t: 'partial', v: body.trim() };
      if (sigil === '#') {
        const [kw, arg] = body.split(/\s+/, 2);
        return { t: 'open', kw, arg };
      }
      if (sigil === '/') return { t: 'close', kw: body.trim() };
      if (body === 'else') return { t: 'else' };
      return { t: 'var', v: body.trim() };
    });
}

// Build a nested node tree from the flat token list.
function parse(tokens) {
  const root = { kw: 'root', body: [], else: null };
  const stack = [root];
  let target = 'body';

  for (const tok of tokens) {
    const top = stack[stack.length - 1];
    const sink = target === 'else' ? top.else : top.body;

    if (tok.t === 'comment') continue;
    if (tok.t === 'text') sink.push({ t: 'text', v: tok.v });
    else if (tok.t === 'var') sink.push({ t: 'var', v: tok.v });
    else if (tok.t === 'partial') sink.push({ t: 'partial', v: tok.v });
    else if (tok.t === 'open') {
      const node = { t: 'block', kw: tok.kw, arg: tok.arg, body: [], else: [] };
      sink.push(node);
      stack.push(node);
      target = 'body';
    } else if (tok.t === 'else') {
      target = 'else';
    } else if (tok.t === 'close') {
      if (stack.length < 2 || top.kw !== tok.kw) {
        throw new Error(`template: unbalanced {{/${tok.kw}}}`);
      }
      stack.pop();
      target = 'body';
    }
  }
  if (stack.length !== 1) throw new Error(`template: unclosed {{#${stack[stack.length - 1].kw}}}`);
  return root.body;
}

function lookup(ctx, path) {
  if (path === 'this') return ctx.this;
  if (path.startsWith('@')) return ctx['@'] ? ctx['@'][path] : undefined;
  let cur = path.startsWith('this.') ? ctx.this : ctx;
  for (const key of path.replace(/^this\./, '').split('.')) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function truthy(v) {
  return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== false && v !== '';
}

function renderNodes(nodes, ctx, resolvePartial) {
  let out = '';
  for (const node of nodes) {
    if (node.t === 'text') {
      out += node.v;
    } else if (node.t === 'var') {
      const v = lookup(ctx, node.v);
      out += v === undefined || v === null ? '' : String(v);
    } else if (node.t === 'partial') {
      const resolved = resolvePartial(node.v, ctx);
      out += resolved == null ? '' : renderNodes(parse(tokenize(stripHeaderComment(resolved))), ctx, resolvePartial);
    } else if (node.t === 'block' && node.kw === 'if') {
      const branch = truthy(lookup(ctx, node.arg)) ? node.body : node.else;
      out += renderNodes(branch, ctx, resolvePartial);
    } else if (node.t === 'block' && node.kw === 'each') {
      const list = lookup(ctx, node.arg);
      if (Array.isArray(list)) {
        list.forEach((item, i) => {
          const child = {
            ...ctx,
            this: item,
            '@': {
              '@index': i,
              '@index_1': i + 1,
              '@first': i === 0,
              '@last': i === list.length - 1,
            },
          };
          out += renderNodes(node.body, child, resolvePartial);
        });
      } else if (node.else.length) {
        out += renderNodes(node.else, ctx, resolvePartial);
      }
    }
  }
  return out;
}

// Render `src` against `ctx`. `resolvePartial(name, ctx)` returns the raw text for
// a `{{> name }}` include, or null to emit nothing.
function render(src, ctx = {}, resolvePartial = () => null) {
  const clean = stripHeaderComment(String(src));
  return renderNodes(parse(tokenize(clean)), ctx, resolvePartial);
}

module.exports = { render, stripHeaderComment };
