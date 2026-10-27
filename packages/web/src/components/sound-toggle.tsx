import type { PanelConversation, PanelOrder } from '../lib/queries';

import { useEffect, useRef, useState } from 'react';

import { staffActed } from '../lib/format';
import { playBeep, unlockSound } from '../lib/sound';

const SOUND_KEY = 'atendy:sound';

const readSoundPreference = () => {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
};

const writeSoundPreference = (on: boolean) => {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode: the toggle still works for this visit.
  }
};

/**
 * A conversation that calls for someone at the store: an approval, or a handoff the store did not start itself.
 * Keyed by reason, so the same conversation beeps again when it needs a person for something new.
 */
const attentionKeys = (conversations: PanelConversation[]) =>
  conversations.flatMap((conversation) => {
    if (conversation.approval_reason) {
      return [`${conversation.id}:${conversation.approval_reason}`];
    }

    return conversation.mode === 'human' && !staffActed(conversation.handoff_reason)
      ? [`${conversation.id}:${conversation.handoff_reason}`]
      : [];
  });

type Props = { openOrders: PanelOrder[] | undefined; conversations: PanelConversation[] | undefined };

/**
 * Sound switch. When on: one beep for every new order and another for every conversation that starts needing a
 * person, both only for what shows up after the first load.
 */
export function SoundToggle({ openOrders, conversations }: Props) {
  const [sound, setSound] = useState(false);
  const seen = useRef<Set<string>>(undefined);
  const waiting = useRef<Set<string>>(undefined);

  useEffect(() => setSound(readSoundPreference()), []);

  // The preference is remembered, but browsers unlock audio only after a gesture on this visit: the first click
  // or key anywhere on the page does it.
  useEffect(() => {
    if (!sound) {
      return;
    }

    const unlock = () => void unlockSound();

    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });

    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [sound]);

  useEffect(() => {
    if (!openOrders) {
      return;
    }

    const placed = openOrders.filter(({ status }) => status === 'placed').map(({ id }) => id);
    const arrived = seen.current ? placed.filter((id) => !seen.current!.has(id)) : [];

    if (arrived.length && sound) {
      playBeep('order');
    }

    seen.current = new Set([...(seen.current ?? []), ...placed]);
  }, [openOrders, sound]);

  // Compared with the previous poll only: a conversation that was solved and needs a person again beeps again.
  useEffect(() => {
    if (!conversations) {
      return;
    }

    const keys = attentionKeys(conversations);
    const arrived = waiting.current ? keys.filter((key) => !waiting.current!.has(key)) : [];

    if (arrived.length && sound) {
      playBeep('attention');
    }

    waiting.current = new Set(keys);
  }, [conversations, sound]);

  const toggle = async () => {
    const next = !sound;

    if (next) {
      await unlockSound();
      playBeep('order');
    }

    setSound(next);
    writeSoundPreference(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={sound}
      onClick={() => void toggle()}
      title="Avisa com um som cada pedido novo e cada conversa que precisa de você"
      className="flex shrink-0 items-center gap-2 text-[13px]"
    >
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${sound ? 'bg-on' : 'bg-off'}`}>
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${sound ? 'left-4.5' : 'left-0.5'}`}
        />
      </span>
      <span className={sound ? 'font-medium text-ok-fg' : 'text-muted'}>Som</span>
    </button>
  );
}
