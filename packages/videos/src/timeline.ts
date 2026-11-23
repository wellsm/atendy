import type { VideoScript } from './types.ts';

export const FPS = 30;
export const HOOK_FRAMES = 90;
// "digitando…" before each bot message.
export const TYPING_FRAMES = 12;
export const MIN_HOLD_FRAMES = 30;
export const MAX_HOLD_FRAMES = 90;
export const FRAMES_PER_CHAR = 1.2;
export const CLOSE_FRAMES = 120;
// Fits a three-item order summary (the longest real message).
export const MAX_MESSAGE_CHARS = 200;

export type Timeline = {
  // Same order as script.messages.
  messages: { appearAt: number; typingFrom: number | null }[];
  // The phone steps back and the closing lines start.
  closeAt: number;
  totalFrames: number;
};

const holdFrames = (text: string) => {
  return Math.min(MAX_HOLD_FRAMES, Math.max(MIN_HOLD_FRAMES, Math.round(text.length * FRAMES_PER_CHAR)));
};

export const buildTimeline = (script: VideoScript): Timeline => {
  let cursor = HOOK_FRAMES;

  const messages = script.messages.map(({ from, text }) => {
    const typingFrom = from === 'bot' ? cursor : null;
    const appearAt = typingFrom === null ? cursor : cursor + TYPING_FRAMES;

    cursor = appearAt + holdFrames(text);

    return { appearAt, typingFrom };
  });

  return { messages, closeAt: cursor, totalFrames: cursor + CLOSE_FRAMES };
};
