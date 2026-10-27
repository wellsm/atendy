import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MessageAuthor, MessageDirection } from '../../src/conversations/types';
import { bodyForModel } from '../../src/whatsapp/location';
import { formatReactionBody, isAnswerReaction, parseReactionBody } from '../../src/whatsapp/reaction';

describe('reactions', () => {
  const question = {
    id: 'm2',
    direction: MessageDirection.Out,
    author: MessageAuthor.Bot,
    body: 'Confere o resumo? Posso confirmar o pedido?'
  };

  it('answers only a reaction to the latest bot message that asks something', () => {
    equal(isAnswerReaction({ emoji: '👍', reacted: question, latestOutboundId: 'm2' }), true);

    // Removed, older, staff status, a statement, the customer's own message.
    equal(isAnswerReaction({ emoji: '', reacted: question, latestOutboundId: 'm2' }), false);
    equal(isAnswerReaction({ emoji: '👍', reacted: question, latestOutboundId: 'm3' }), false);
    equal(
      isAnswerReaction({
        emoji: '👍',
        reacted: { ...question, author: MessageAuthor.Staff, body: 'Seu pedido saiu para entrega!' },
        latestOutboundId: 'm2'
      }),
      false
    );
    equal(
      isAnswerReaction({ emoji: '❤️', reacted: { ...question, body: 'Pedido confirmado!' }, latestOutboundId: 'm2' }),
      false
    );
    equal(
      isAnswerReaction({
        emoji: '👍',
        reacted: { ...question, direction: MessageDirection.In, author: MessageAuthor.Customer },
        latestOutboundId: 'm2'
      }),
      false
    );
  });

  it('stores the emoji with a short excerpt and tells the model what was answered', () => {
    const body = formatReactionBody('👍', `Posso confirmar?\n${'x'.repeat(200)}`);

    equal(body.startsWith('Reação 👍 à mensagem: Posso confirmar? xxx'), true);
    equal(body.endsWith('…'), true);
    equal(parseReactionBody(body)?.emoji, '👍');
    equal(parseReactionBody('👍 legal'), undefined);
    equal(
      bodyForModel(formatReactionBody('❤️', 'Posso confirmar?')),
      '[o cliente reagiu com ❤️ à sua última mensagem: "Posso confirmar?"]'
    );
  });
});
