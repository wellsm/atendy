import type { Client } from '@ez4/storage';
import type { VoiceNoteAudio } from '../conversations/voice-notes';
import type { DbClient } from '../db';

import { OpenRouterClient } from './openrouter-client';
import { AiCallRepository } from './repository';
import { AiPath, AiProvider } from './types';
import { formatTranscriptBody, MediaKind, parseMediaBody } from '../whatsapp/media';

export const TRANSCRIPTION_MODEL = 'openai/whisper-large-v3-turbo';

/**
 * Longer voice notes keep the media label: they are rare in an order chat and slow to transcribe.
 */
export const MAX_VOICE_NOTE_SECONDS = 180;

/**
 * Base64 length cap (about 1.5 MB of audio), in case `seconds` is missing.
 */
const MAX_VOICE_NOTE_BASE64 = 2_000_000;

/**
 * OpenRouter `input_audio.format` for a WhatsApp mimetype (`audio/ogg; codecs=opus` for voice notes).
 */
const audioFormat = (mimetype: string) => {
  const type = mimetype.split(';')[0]!.trim();

  if (type === 'audio/mpeg') {
    return 'mp3';
  }

  if (type === 'audio/mp4' || type === 'audio/x-m4a') {
    return 'm4a';
  }

  return ['audio/aac', 'audio/wav', 'audio/webm'].includes(type) ? type.slice('audio/'.length) : 'ogg';
};

type PendingMessage = { id: string; body: string; audio?: VoiceNoteAudio; audio_key?: string | null };

/**
 * Turns the saved voice notes (`saveVoiceNotes`) into transcript bodies before the turn, in parallel: the bytes in
 * memory, else the bucket copy when the batch was saved by an earlier run (closed store, waiting for approval). Best
 * effort: one that is too long, fails to transcribe or comes back empty keeps its media label; a transcript body is
 * never transcribed again.
 */
export const transcribeVoiceNotes = async <M extends PendingMessage>(
  db: DbClient,
  input: {
    storeId: string;
    conversationId: string;
    apiKey: string;
    bucket: Client;
    messages: M[];
  }
): Promise<M[]> => {
  const transcribe = async (media: VoiceNoteAudio) => {
    if (media.seconds > MAX_VOICE_NOTE_SECONDS || media.base64.length > MAX_VOICE_NOTE_BASE64) {
      return undefined;
    }

    const result = await OpenRouterClient.transcribe({
      apiKey: input.apiKey,
      model: TRANSCRIPTION_MODEL,
      data: media.base64,
      format: audioFormat(media.mimetype),
      language: 'pt'
    });

    await AiCallRepository.record(db, {
      storeId: input.storeId,
      conversationId: input.conversationId,
      provider: AiProvider.OpenRouter,
      model: TRANSCRIPTION_MODEL,
      path: AiPath.Transcription,
      ...result.usage,
      latencyMs: result.latencyMs
    });

    return result.text || undefined;
  };

  return Promise.all(
    input.messages.map(async (message) => {
      const stored = !message.audio && message.audio_key && parseMediaBody(message.body)?.kind === MediaKind.Audio;

      if (!message.audio && !stored) {
        return message;
      }

      const text = await (async () => {
        const audio = message.audio ??
          // WhatsApp voice notes are Ogg/Opus; the duration is unknown here, the size cap still applies.
          {
            base64: (await input.bucket.read(message.audio_key!)).toString('base64'),
            mimetype: 'audio/ogg',
            seconds: 0
          };

        return transcribe(audio);
      })().catch(() => undefined);

      if (!text) {
        return message;
      }

      const body = formatTranscriptBody(text);

      await db.messages.updateOne({ data: { body }, where: { id: message.id } });

      return { ...message, body };
    })
  );
};
