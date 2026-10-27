import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { getAdminConversationHandler } from '../../src/admin/endpoints/get-conversation';
import { getPromptHandler } from '../../src/admin/endpoints/get-prompt';
import { listAdminConversationsHandler } from '../../src/admin/endpoints/list-conversations';
import { REPLY_SYSTEM_PROMPT, SYSTEM_PROMPT } from '../../src/agent/prompt';
import { PROMPT_VERSION } from '../../src/agent/prompt-version';
import { AiCallRepository } from '../../src/agent/repository';
import { TOOL_DEFINITIONS } from '../../src/agent/tools';
import { AiPath, AiProvider } from '../../src/agent/types';
import { ConversationMode } from '../../src/conversations/types';
import { minutesAgo, seedConversation, seedStore } from '../support/fixtures';

describe('admin conversation inspector', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const identity = { userId: 'user_admin' };

  const list = (query: object) => listAdminConversationsHandler({ identity, query } as never, { db });

  const conversation = async (
    storeId: string,
    input: { minutes: number; mode?: ConversationMode; reason?: string | null }
  ) => {
    const { conversationId } = await seedConversation(db, storeId);

    await db.conversations.updateOne({
      data: {
        last_message_at: minutesAgo(input.minutes),
        mode: input.mode ?? ConversationMode.Bot,
        handoff_reason: input.reason ?? null
      },
      where: { id: conversationId }
    });

    return conversationId;
  };

  it('lists one store newest first with filters', async () => {
    const { storeId } = await seedStore(db);
    const other = await seedStore(db);

    const old = await conversation(storeId, { minutes: 30 });
    const human = await conversation(storeId, { minutes: 20, mode: ConversationMode.Human, reason: 'customer_asked' });
    const failed = await conversation(storeId, { minutes: 10, mode: ConversationMode.Human, reason: 'send_failed' });

    await conversation(other.storeId, { minutes: 5 });

    const all = await list({ storeId, filter: 'all' });

    deepEqual(
      all.body.conversations.map(({ id }) => id),
      [failed, human, old]
    );
    equal(all.body.conversations[0]?.storeName, 'Pizzaria Teste');
    equal(all.body.conversations[0]?.preview, 'oi');
    ok(all.body.conversations[0]?.customerPhone);

    deepEqual(
      (await list({ storeId, filter: 'needs_human' })).body.conversations.map(({ id }) => id),
      [failed, human]
    );
    deepEqual(
      (await list({ storeId, filter: 'errors' })).body.conversations.map(({ id }) => id),
      [failed]
    );

    const page = await list({ storeId, filter: 'all', before: all.body.conversations[0].lastMessageAt });

    deepEqual(
      page.body.conversations.map(({ id }) => id),
      [human, old]
    );
  });

  it('shows messages and AI calls of a conversation', async () => {
    const { storeId } = await seedStore(db);
    const { conversationId } = await seedConversation(db, storeId);

    const callId = await AiCallRepository.record(db, {
      storeId,
      conversationId,
      provider: AiProvider.OpenRouter,
      model: 'test/model',
      path: AiPath.LlmFallback,
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.001,
      latencyMs: 800
    });

    // camelCase on purpose: the admin must see the keys exactly as the model sent them.
    await AiCallRepository.setTools(db, callId, [{ name: 'add_item', args: { productId: 'p1', qty: 2 }, ok: true }]);

    const { body } = await getAdminConversationHandler({ identity, parameters: { conversationId } } as never, { db });

    equal(body.conversation.id, conversationId);
    equal(body.conversation.storeName, 'Pizzaria Teste');
    deepEqual(
      body.messages.map(({ body: text }) => text),
      ['oi']
    );
    equal(body.simulation, null);
    equal(body.aiCalls.length, 1);
    equal(body.aiCalls[0]?.promptVersion, PROMPT_VERSION);
    equal(body.aiCalls[0]?.costUsd, 0.001);
    const [tool] = body.aiCalls[0]?.tools ?? [];

    equal(tool?.name, 'add_item');
    equal(tool?.ok, true);
    // Postgres jsonb reorders keys; their spelling must survive.
    deepEqual(JSON.parse(tool?.args ?? 'null'), { productId: 'p1', qty: 2 });

    await rejects(
      getAdminConversationHandler({ identity, parameters: { conversationId: randomUUID() } } as never, { db }),
      HttpNotFoundError
    );
  });

  it('shows the current prompt', async () => {
    const { body } = await getPromptHandler({ identity } as never);

    deepEqual(body, {
      version: PROMPT_VERSION,
      system: SYSTEM_PROMPT,
      reply: REPLY_SYSTEM_PROMPT,
      tools: JSON.stringify(TOOL_DEFINITIONS, null, 2)
    });
  });
});
