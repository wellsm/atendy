/**
 * Same stored formats as the API (`src/whatsapp/location.ts`, `src/whatsapp/media.ts`, `src/whatsapp/reaction.ts`).
 */
const LOCATION_PATTERN = /^📍 Localização: (-?\d{1,2}\.\d{6}),(-?\d{1,3}\.\d{6})$/u;

const REACTION_PATTERN = /^Reação (\S+) à mensagem: ([\s\S]*)$/u;

const MEDIA = [
  { label: '🖼️ Imagem', icon: '🖼️', name: 'Imagem' },
  { label: '🎥 Vídeo', icon: '🎥', name: 'Vídeo' },
  { label: '🎤 Áudio', icon: '🎤', name: 'Áudio' },
  { label: '📄 Documento', icon: '📄', name: 'Documento' },
  { label: '💬 Figurinha', icon: '💬', name: 'Figurinha' }
];

const TRANSCRIPT_PREFIX = '🎤 Áudio transcrito: ';

const parseMedia = (body: string) => {
  if (body.startsWith(TRANSCRIPT_PREFIX)) {
    return { ...MEDIA[2]!, caption: body.slice(TRANSCRIPT_PREFIX.length), transcript: true };
  }

  for (const media of MEDIA) {
    if (body === media.label) {
      return { ...media, caption: null };
    }

    if (body.startsWith(`${media.label}: `)) {
      return { ...media, caption: body.slice(media.label.length + 2) };
    }
  }

  return undefined;
};

const TEXT = 'whitespace-pre-wrap break-words text-[15px] leading-snug md:text-sm';

/**
 * A message body: plain text, a shared location (pin + link to Google Maps in a new tab), a reaction the bot answered,
 * or a media marker (only voice notes are downloaded: `audioUrl` plays them, with the automatic transcript if any).
 */
export function MessageBody({ body, audioUrl }: { body: string; audioUrl?: string | null }) {
  const location = LOCATION_PATTERN.exec(body);
  const reaction = REACTION_PATTERN.exec(body);

  if (reaction) {
    return (
      <p className="text-[15px] md:text-sm">
        <span className="text-lg leading-none">{reaction[1]}</span>{' '}
        <span className="text-muted">reagiu a &quot;{reaction[2]}&quot;</span>
      </p>
    );
  }

  if (location) {
    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${location[1]},${location[2]}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2.5 text-[15px] md:text-sm"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg">📍</span>
        <span className="flex flex-col">
          <span className="font-medium">Localização</span>
          <span className="text-xs font-medium text-accent-fg hover:underline">Abrir no mapa ↗</span>
        </span>
      </a>
    );
  }

  const media = parseMedia(body);

  if (!media) {
    return <p className={TEXT}>{body}</p>;
  }

  const note =
    'transcript' in media ? 'Transcrito automaticamente' : audioUrl ? null : 'Abra no WhatsApp do celular para ver';

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2.5 text-[15px] md:text-sm">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-lg">
          {media.icon}
        </span>
        <span className="flex flex-col">
          <span className="font-medium">{media.name}</span>
          {note && <span className="text-xs text-muted">{note}</span>}
        </span>
      </span>
      {audioUrl && <audio controls preload="none" src={audioUrl} className="h-10 w-64 max-w-full" />}
      {media.caption && <p className={TEXT}>{media.caption}</p>}
    </div>
  );
}
