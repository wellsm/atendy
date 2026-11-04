import { equal, match, notEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { redirectPromptFor, replyPromptFor, systemPromptFor } from '../../src/agent/prompt';
import { PROMPT_VERSION, promptFingerprint } from '../../src/agent/prompt-version';
import { TOOL_DEFINITIONS } from '../../src/agent/tools';
import { StoreType } from '../../src/stores/types';

describe('prompt version', () => {
  it('is a short hash of the prompts of every store type and the tool definitions', () => {
    match(PROMPT_VERSION, /^[0-9a-f]{8}$/);
    equal(
      PROMPT_VERSION,
      promptFingerprint([
        systemPromptFor(StoreType.Food),
        replyPromptFor(StoreType.Food),
        systemPromptFor(StoreType.Retail),
        replyPromptFor(StoreType.Retail),
        redirectPromptFor(StoreType.Food),
        redirectPromptFor(StoreType.Retail),
        JSON.stringify(TOOL_DEFINITIONS)
      ])
    );
  });

  it('changes when any prompt part changes', () => {
    notEqual(promptFingerprint(['a', 'b']), promptFingerprint(['a', 'c']));
    // Part boundaries count: ["ab", ""] is not ["a", "b"].
    notEqual(promptFingerprint(['ab', '']), promptFingerprint(['a', 'b']));
  });
});
