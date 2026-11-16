'use strict';

// A flow made of steps, so the user can go back. Each step is { id, when?(s), run(p, s) }: `run`
// asks its question and stores the answer on the shared state `s`; `when` says whether the step
// applies at all (a step that is skipped must not prompt, or going back would bounce off it).
//
// A prompt that throws Back (Esc, or `<` on a pipe) sends the flow to the nearest earlier step that
// applies, which is asked again with its old answer still on `s` for use as the default. Back at the
// first applicable step throws Back out of the flow, to whatever called it.

const { Back } = require('../errors');

async function runSteps(p, steps, s) {
  let i = 0;
  let dir = 1;
  while (i < steps.length) {
    const step = steps[i];
    if (step.when && !step.when(s)) {
      i += dir;
      if (i < 0) throw new Back();
      continue;
    }
    try {
      await step.run(p, s);
      dir = 1;
      i += 1;
    } catch (err) {
      if (!(err && err.isBack)) throw err;
      dir = -1;
      i -= 1;
      if (i < 0) throw err;
    }
  }
  return s;
}

// Index of `value` in options, or `fallback`: the default a re-asked choose() starts on.
function indexOfValue(options, value, fallback = 0) {
  const i = options.findIndex((o) => o.value === value);
  return i >= 0 ? i : fallback;
}

module.exports = { runSteps, indexOfValue };
