import { createHash } from 'node:crypto';

import { redirectPromptFor, replyPromptFor, systemPromptFor } from './prompt';
import { TOOL_DEFINITIONS } from './tools';
import { StoreType } from '../stores/types';

/**
 * Short, stable id of the given prompt parts (part boundaries included).
 */
export const promptFingerprint = (parts: string[]) => {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 8);
};

/**
 * Version of the fixed prompts (every store type) and tool definitions, stamped on every AI call. Computed, so a prompt edit can never
 * ship under an old version. The store SOP and the per-turn Jev questions are not part of it.
 */
export const PROMPT_VERSION = promptFingerprint([
  systemPromptFor(StoreType.Food),
  replyPromptFor(StoreType.Food),
  systemPromptFor(StoreType.Retail),
  replyPromptFor(StoreType.Retail),
  redirectPromptFor(StoreType.Food),
  redirectPromptFor(StoreType.Retail),
  JSON.stringify(TOOL_DEFINITIONS)
]);
