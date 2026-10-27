import type { Client } from '@ez4/storage';
import type { DbClient } from '../db';
import type { WhatsAppProvider } from '../whatsapp/types';

/**
 * A downloaded voice note, kept in memory for the transcription of the same batch.
 */
export type VoiceNoteAudio = { base64: string; mimetype: string; seconds: number };

/**
 * Base64 length cap (about 7.5 MB of audio): longer notes keep only their label.
 */
const MAX_STORED_BASE64 = 10_000_000;

export const voiceNoteKey = (storeId: string, messageId: string) => `voice-notes/${storeId}/${messageId}`;

const voiceNoteSeconds = (voiceNote: Record<string, unknown>) => {
  const message = voiceNote.message as { audioMessage?: { seconds?: unknown } } | undefined;
  const seconds = Number(message?.audioMessage?.seconds);

  return Number.isFinite(seconds) ? seconds : 0;
};

type PendingMessage = { id: string; voice_note?: Record<string, unknown> | null };

/**
 * Downloads each pending voice note once, in parallel, stores it in the `VoiceNotes` bucket for the panel
 * (`audio_key`) and clears its raw message. Runs in bot and human mode. Best effort: a failed download or upload keeps
 * only the label. Returns the messages with the audio in memory for the transcription.
 */
export const saveVoiceNotes = async <M extends PendingMessage>(
  db: DbClient,
  input: { storeId: string; bucket: Client; provider: WhatsAppProvider; messages: M[] }
): Promise<(M & { audio?: VoiceNoteAudio })[]> => {
  const save = async (message: M, voiceNote: Record<string, unknown>) => {
    const media = await input.provider.downloadMedia({ message: voiceNote });

    if (media.base64.length > MAX_STORED_BASE64) {
      return undefined;
    }

    const key = voiceNoteKey(input.storeId, message.id);

    await input.bucket.write(key, Buffer.from(media.base64, 'base64'), { contentType: media.mimetype });
    await db.messages.updateOne({ data: { audio_key: key }, where: { id: message.id } });

    return { base64: media.base64, mimetype: media.mimetype, seconds: voiceNoteSeconds(voiceNote) };
  };

  return Promise.all(
    input.messages.map(async (message) => {
      if (!message.voice_note) {
        return message;
      }

      const audio = await save(message, message.voice_note).catch(() => undefined);

      await db.messages.updateOne({ data: { voice_note: null }, where: { id: message.id } });

      return { ...message, voice_note: null, ...(audio && { audio }) };
    })
  );
};
