'use strict';

// One place that reads a JSON file a user wrote or edited, and says what is wrong with it:
// the file, the problem, and (through UserError) exit 2 with no stack trace. Every command
// reads its config through here rather than calling JSON.parse itself.

const fs = require('fs');
const { UserError } = require('./errors');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'object') return 'an object';
  return `${typeof v} ${JSON.stringify(v)}`;
}

// Parse text that is meant to be JSON. A leading byte-order mark (some editors add one) is not
// part of the document. `file` only labels the error.
function parseJson(text, file) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!body.trim()) throw new UserError(`${file}: the file is empty`);
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new UserError(`${file}: invalid JSON — ${err.message}`);
  }
}

// Read and parse. `optional` returns undefined for a file that does not exist; every other
// failure (unreadable, a directory, empty, malformed) is a UserError.
function readJsonFile(file, { optional = false } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && optional) return undefined;
    throw new UserError(`${file}: cannot read it — ${err.code || err.message}`);
  }
  return parseJson(text, file);
}

const nonEmptyString = (s) => typeof s === 'string' && s.trim() !== '';

// type: 'object' | 'array' | 'string' | 'boolean' | 'integer' | 'string[]' | 'stack'
// ('stack' is a string or an array of strings). `where` names the key, e.g. 'repos[1].path'.
// An absent (undefined) value passes unless `required`.
function expect(file, where, value, type, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw new UserError(`${file}: "${where}" is required`);
    return;
  }
  const bad = (want) => {
    throw new UserError(`${file}: "${where}" must be ${want}, not ${typeName(value)}`);
  };
  switch (type) {
    case 'object':
      if (!isObject(value)) bad('an object');
      break;
    case 'array':
      if (!Array.isArray(value)) bad('an array');
      break;
    case 'string':
      if (!nonEmptyString(value)) bad('a non-empty string');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') bad('true or false');
      break;
    case 'integer':
      if (!Number.isInteger(value)) bad('a whole number');
      break;
    case 'string[]':
      if (!Array.isArray(value) || !value.every(nonEmptyString)) bad('an array of non-empty strings');
      break;
    case 'stack':
      if (!nonEmptyString(value) && !(Array.isArray(value) && value.every(nonEmptyString))) {
        bad('a string or an array of strings');
      }
      break;
    default:
      throw new Error(`expect: unknown type ${type}`);
  }
}

module.exports = { readJsonFile, parseJson, expect, isObject, typeName };
