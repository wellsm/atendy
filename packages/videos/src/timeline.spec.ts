import type { VideoScript } from './types.ts';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SCRIPTS } from './scripts/index.ts';
import { buildTimeline, MAX_MESSAGE_CHARS } from './timeline.ts';

const script: VideoScript = {
  slug: 't',
  storeName: 'T',
  storeType: 'food',
  hook: 'h',
  caption: 'c',
  messages: [
    { from: 'customer', text: 'x'.repeat(10) }, // hold 30 (minimum)
    { from: 'bot', text: 'x'.repeat(50) }, // hold 60
    { from: 'customer', text: 'x'.repeat(100) } // hold 90 (maximum)
  ]
};

test('places messages, typing and close', () => {
  assert.deepEqual(buildTimeline(script), {
    messages: [
      { appearAt: 90, typingFrom: null },
      { appearAt: 132, typingFrom: 120 },
      { appearAt: 192, typingFrom: null }
    ],
    closeAt: 282,
    totalFrames: 402
  });
});

for (const real of SCRIPTS) {
  test(`${real.slug}: fits the video rules`, () => {
    const { totalFrames } = buildTimeline(real);

    assert.ok(totalFrames >= 600 && totalFrames <= 900, `${totalFrames} frames`);
    assert.ok(real.messages.every((message) => message.text.length <= MAX_MESSAGE_CHARS));

    const steps = real.messages.flatMap((message) => (message.step ? [message.step] : []));

    assert.deepEqual(steps, [1, 2, 3, 4]);

    if (real.storeType === 'retail') {
      const all = [
        real.hook,
        real.caption,
        ...real.messages.flatMap((message) => [message.text, message.label ?? ''])
      ].join(' ');

      assert.doesNotMatch(all, /cozinha|cardápio/i);
    }
  });
}
