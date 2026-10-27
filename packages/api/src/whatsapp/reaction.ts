import { MessageAuthor, MessageDirection } from '../conversations/types';

const REACTION_PATTERN = /^Reação (\S+) à mensagem: ([\s\S]*)$/u;

const EXCERPT_LENGTH = 120;

/**
 * Stored body of a reaction the bot answers (`isAnswerReaction`): the emoji and the start of the reacted message. The
 * panel renders it, like the location and media bodies.
 */
export const formatReactionBody = (emoji: string, reactedBody: string) => {
  const text = reactedBody.replace(/\s+/g, ' ').trim();
  const excerpt = text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text;

  return `Reação ${emoji} à mensagem: ${excerpt}`;
};

export const parseReactionBody = (body: string) => {
  const match = REACTION_PATTERN.exec(body);

  return match ? { emoji: match[1]!, excerpt: match[2]! } : undefined;
};

const REACTION_FOR_MODEL = '[o cliente reagiu com ';

export const reactionBodyForModel = (body: string) => {
  const reaction = parseReactionBody(body);

  return reaction && `${REACTION_FOR_MODEL}${reaction.emoji} à sua última mensagem: "${reaction.excerpt}"]`;
};

/**
 * A model text (`bodyForModel`) that is a reaction: its meaning depends on the question, so Jev never acts on it.
 */
export const isReactionForModel = (text: string) => text.startsWith(REACTION_FOR_MODEL);

/**
 * A reaction the bot should read as an answer: to its own latest message, when that message asked something. Any other
 * reaction ("saiu para entrega", staff messages, older messages, removals) only shows on the bubble.
 */
export const isAnswerReaction = (input: {
  emoji: string;
  reacted: { id: string; direction: MessageDirection; author: MessageAuthor; body: string };
  latestOutboundId: string | undefined;
}) =>
  !!input.emoji &&
  input.reacted.direction === MessageDirection.Out &&
  input.reacted.author === MessageAuthor.Bot &&
  input.reacted.id === input.latestOutboundId &&
  input.reacted.body.includes('?');
