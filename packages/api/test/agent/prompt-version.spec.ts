import { equal, match, notEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REPLY_SYSTEM_PROMPT, SYSTEM_PROMPT } from '../../src/agent/prompt';
import { PROMPT_VERSION, promptFingerprint } from '../../src/agent/prompt-version';
import { TOOL_DEFINITIONS } from '../../src/agent/tools';

describe('prompt version', () => {
  it('is a short hash of the prompts and tool definitions', () => {
    match(PROMPT_VERSION, /^[0-9a-f]{8}$/);
    equal(PROMPT_VERSION, promptFingerprint([SYSTEM_PROMPT, REPLY_SYSTEM_PROMPT, JSON.stringify(TOOL_DEFINITIONS)]));
  });

  it('changes when any prompt part changes', () => {
    notEqual(promptFingerprint(['a', 'b']), promptFingerprint(['a', 'c']));
    // Part boundaries count: ["ab", ""] is not ["a", "b"].
    notEqual(promptFingerprint(['ab', '']), promptFingerprint(['a', 'b']));
  });
});
