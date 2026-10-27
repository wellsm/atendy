import type { Http } from '@ez4/gateway';
import type { AdminIdentity } from '../types';

import { REPLY_SYSTEM_PROMPT, SYSTEM_PROMPT } from '../../agent/prompt';
import { PROMPT_VERSION } from '../../agent/prompt-version';
import { TOOL_DEFINITIONS } from '../../agent/tools';

export declare class GetPromptRequest implements Http.Request {
  identity: AdminIdentity;
}

export declare class GetPromptResponse implements Http.Response {
  status: 200;
  body: {
    version: string;
    /**
     * Without the store SOP, which each store appends.
     */
    system: string;
    reply: string;
    /**
     * Tool definitions sent to the model, as formatted JSON.
     */
    tools: string;
  };
}

/**
 * The fixed prompts of the current code, read only.
 */
export function getPromptHandler(_request: Http.Incoming<GetPromptRequest>): GetPromptResponse {
  return {
    status: 200,
    body: {
      version: PROMPT_VERSION,
      system: SYSTEM_PROMPT,
      reply: REPLY_SYSTEM_PROMPT,
      tools: JSON.stringify(TOOL_DEFINITIONS, null, 2)
    }
  };
}
