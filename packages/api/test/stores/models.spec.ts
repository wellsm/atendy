import { equal, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isLlmModel, LLM_MODELS } from '../../src/stores/models';
import { DEFAULT_LLM_MODEL } from '../../src/stores/repository';

describe('LLM models', () => {
  it('offers the default model and no duplicates', () => {
    ok(LLM_MODELS.includes(DEFAULT_LLM_MODEL));
    equal(new Set(LLM_MODELS).size, LLM_MODELS.length);
  });

  it('accepts only listed ids', () => {
    ok(isLlmModel(DEFAULT_LLM_MODEL));
    equal(isLlmModel('anthropic/claude-haiku-5'), false);
    equal(isLlmModel(''), false);
  });
});
