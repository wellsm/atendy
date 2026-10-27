import { DEFAULT_LLM_MODEL } from './repository';

/**
 * Store model ids with this prefix run on Anthropic's own API (`ANTHROPIC_API_KEY`); every other id is an OpenRouter
 * model. GPT models only exist as OpenRouter ids.
 */
export const ANTHROPIC_DIRECT_PREFIX = 'anthropic-direct/';

/**
 * USD per million tokens. Anthropic returns tokens, not cost: keep this in sync with
 * https://platform.claude.com/docs/en/about-claude/pricing (5-minute cache writes).
 */
export type AnthropicPrice = {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  /**
   * Prices of requests whose prompt (cache reads and writes included) is over `limit` tokens.
   */
  long?: { limit: number; input: number; cacheWrite: number; cacheRead: number; output: number };
};

/**
 * Keyed by Anthropic model id. A direct model needs an entry here, or its calls would be logged at no cost.
 */
export const ANTHROPIC_PRICES: Record<string, AnthropicPrice> = {
  'claude-haiku-5-5': {
    input: 0.1,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    output: 0.5,
    long: { limit: 100_000, input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 }
  },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 }
};

/**
 * Models a store can run on. A fixed list: a typo in a free-text id would fail every turn of the store,
 * and evals compare `ai_calls` across these models only.
 */
export const LLM_MODELS: readonly string[] = [
  DEFAULT_LLM_MODEL,
  'anthropic/claude-sonnet-5.5',
  'openai/gpt-4.1-mini',
  ...Object.keys(ANTHROPIC_PRICES).map((id) => `${ANTHROPIC_DIRECT_PREFIX}${id}`)
];

export const isLlmModel = (model: string) => LLM_MODELS.includes(model);

/**
 * The Anthropic model id of a direct store model, `undefined` for OpenRouter models.
 */
export const anthropicModelId = (model: string) =>
  model.startsWith(ANTHROPIC_DIRECT_PREFIX) ? model.slice(ANTHROPIC_DIRECT_PREFIX.length) : undefined;
