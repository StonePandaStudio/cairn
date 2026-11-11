'use strict';

// A problem with what the user gave cairn (a malformed config, a missing file), as opposed to
// a bug. The CLI prints the message on one line and exits 2, with no stack trace.
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.userError = true;
  }
}

module.exports = { UserError };
