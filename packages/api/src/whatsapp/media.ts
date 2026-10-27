export const enum MediaKind {
  Image = 'image',
  Video = 'video',
  Audio = 'audio',
  Document = 'document',
  Sticker = 'sticker'
}

const LABELS: Record<MediaKind, string> = {
  [MediaKind.Image]: '🖼️ Imagem',
  [MediaKind.Video]: '🎥 Vídeo',
  [MediaKind.Audio]: '🎤 Áudio',
  [MediaKind.Document]: '📄 Documento',
  [MediaKind.Sticker]: '💬 Figurinha'
};

/**
 * What the model is told it received instead (it cannot open any media yet).
 */
const FOR_MODEL: Record<MediaKind, string> = {
  [MediaKind.Image]: '[o cliente enviou uma imagem, que você não consegue ver]',
  [MediaKind.Video]: '[o cliente enviou um vídeo, que você não consegue ver]',
  [MediaKind.Audio]: '[o cliente enviou um áudio, que você não consegue ouvir]',
  [MediaKind.Document]: '[o cliente enviou um documento, que você não consegue abrir]',
  [MediaKind.Sticker]: '[o cliente enviou uma figurinha]'
};

const TRANSCRIPT_PREFIX = '🎤 Áudio transcrito: ';

const TRANSCRIPT_FOR_MODEL =
  '[áudio do cliente, transcrito automaticamente: pode ter erros de reconhecimento; confirme itens e quantidades se algo parecer estranho]';

/**
 * Sent instead of a model turn when the customer sent only media without text.
 */
export const MEDIA_ONLY_REPLY =
  '🙈 Ainda não consigo ver imagens e vídeos nem ouvir alguns áudios por aqui.\nPode me escrever o que você precisa? ✍️';

/**
 * Stored body of a WhatsApp media message: the kind as a readable label, plus the caption when there is one. The
 * panel and the turn parse it back (`parseMediaBody`), like the location body.
 */
export const formatMediaBody = (kind: MediaKind, caption?: string) =>
  caption ? `${LABELS[kind]}: ${caption}` : LABELS[kind];

export const parseMediaBody = (body: string): { kind: MediaKind; caption: string | null } | undefined => {
  for (const [kind, label] of Object.entries(LABELS) as [MediaKind, string][]) {
    if (body === label) {
      return { kind, caption: null };
    }

    if (body.startsWith(`${label}: `)) {
      return { kind, caption: body.slice(label.length + 2) };
    }
  }

  return undefined;
};

/**
 * Stored body of a transcribed voice note. Not a caption: `parseMediaBody` does not match it, so it is never media-only.
 */
export const formatTranscriptBody = (text: string) => `${TRANSCRIPT_PREFIX}${text}`;

export const parseTranscriptBody = (body: string) =>
  body.startsWith(TRANSCRIPT_PREFIX) ? body.slice(TRANSCRIPT_PREFIX.length) : undefined;

export const mediaBodyForModel = (body: string) => {
  const transcript = parseTranscriptBody(body);

  if (transcript !== undefined) {
    return `${TRANSCRIPT_FOR_MODEL} ${transcript}`;
  }

  const media = parseMediaBody(body);

  if (!media) {
    return body;
  }

  return media.caption ? `${FOR_MODEL[media.kind]} ${media.caption}` : FOR_MODEL[media.kind];
};

/**
 * Media without a caption: nothing the bot can read (stickers count too).
 */
export const isMediaOnly = (body: string) => parseMediaBody(body)?.caption === null;
