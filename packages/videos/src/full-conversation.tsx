import type { CSSProperties, ReactNode } from 'react';
import type { ScriptMessage, VideoScript } from './types.ts';

import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import { buildTimeline, FPS, HOOK_FRAMES } from './timeline.ts';

export const CLOSING_LINE = 'Você só entra\nquando precisa.';
export const CLOSING_CTA = 'Ficou com dúvida?\nÉ só responder aqui.';

const ACCENT = '#E35205';
const BACKGROUND = '#0f172a';
const FONT = '-apple-system, "Helvetica Neue", Arial, sans-serif';
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
// Rough bubble metrics (in 1080-wide pixels) used only to animate a bubble's height while it enters.
const CHARS_PER_LINE = 30;
const LINE_HEIGHT = 54;
const TYPING_HEIGHT = 96;

const pop = (frame: number, from: number) => {
  return spring({ frame: frame - from, fps: FPS, config: { damping: 16, stiffness: 180 } });
};

const estimatedHeight = (text: string) => {
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);

  return lines * LINE_HEIGHT + 60;
};

// Emoji glyphs are wider than their advance: one space after them looks like none.
const spaced = (text: string) => text.replace(/(\p{Extended_Pictographic}\uFE0F?) /gu, '$1  ');

// WhatsApp bold: *text*.
const formatted = (text: string): ReactNode[] => {
  return spaced(text)
    .split(/(\*[^*\n]+\*)/)
    .map((part, index) => (/^\*[^*\n]+\*$/.test(part) ? <b key={index}>{part.slice(1, -1)}</b> : part));
};

const TypingDots = ({ frame, u }: { frame: number; u: number }) => (
  <div style={{ display: 'flex', gap: 10 * u, padding: `${12 * u}px ${6 * u}px` }}>
    {[0, 1, 2].map((dot) => (
      <div
        key={dot}
        style={{
          width: 16 * u,
          height: 16 * u,
          borderRadius: '50%',
          background: '#94a3b8',
          opacity: 0.4 + 0.6 * Math.abs(Math.sin((frame - dot * 3) / 4))
        }}
      />
    ))}
  </div>
);

type BubbleProps = {
  message: ScriptMessage;
  appearAt: number;
  typingFrom: number | null;
  frame: number;
  u: number;
};

const Bubble = ({ message, appearAt, typingFrom, frame, u }: BubbleProps) => {
  const visibleFrom = typingFrom ?? appearAt;

  if (frame < visibleFrom) {
    return null;
  }

  const fromBot = message.from === 'bot';
  const typing = frame < appearAt;
  const enter = pop(frame, visibleFrom);
  const reveal = pop(frame, appearAt);
  const typingHeight = typingFrom === null ? 0 : TYPING_HEIGHT;
  const fullHeight = estimatedHeight(message.text) * 1.3;

  // The wrapper grows instead of popping in, so older bubbles slide up smoothly.
  const maxHeight = typing
    ? typingHeight * enter
    : reveal > 0.99
      ? undefined
      : interpolate(reveal, [0, 1], [typingHeight, fullHeight]);

  return (
    <div
      style={{
        maxHeight: maxHeight === undefined ? undefined : maxHeight * u,
        flexShrink: 0,
        display: 'flex',
        justifyContent: fromBot ? 'flex-start' : 'flex-end',
        marginTop: 14 * u * enter
      }}
    >
      <div
        style={{
          maxWidth: '84%',
          padding: `${16 * u}px ${24 * u}px`,
          borderRadius: 26 * u,
          background: fromBot ? '#ffffff' : '#d9fdd3',
          color: '#111b21',
          fontSize: 40 * u,
          lineHeight: `${LINE_HEIGHT * u}px`,
          whiteSpace: 'pre-wrap',
          boxShadow: `0 ${2 * u}px ${4 * u}px rgba(0,0,0,0.12)`,
          opacity: enter,
          transform: `scale(${0.9 + 0.1 * (typing ? enter : reveal)})`,
          transformOrigin: fromBot ? 'bottom left' : 'bottom right'
        }}
      >
        {typing ? <TypingDots frame={frame} u={u} /> : formatted(message.text)}
      </div>
    </div>
  );
};

const centered: CSSProperties = {
  justifyContent: 'center',
  alignItems: 'center',
  textAlign: 'center',
  whiteSpace: 'pre-line',
  color: '#ffffff',
  fontWeight: 800
};

export const FullConversation = ({ script }: { script: VideoScript }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const u = width / 1080;

  const timeline = buildTimeline(script);
  const { closeAt } = timeline;

  const hookOpacity =
    interpolate(frame, [0, 12], [0, 1], CLAMP) * interpolate(frame, [HOOK_FRAMES - 10, HOOK_FRAMES], [1, 0], CLAMP);

  const sceneIn = pop(frame, HOOK_FRAMES - 8);
  const sceneOut = interpolate(frame, [closeAt, closeAt + 12], [0, 1], CLAMP);

  const step = script.messages.reduce((current, message, index) => {
    return message.step && frame >= timeline.messages[index]!.appearAt ? message.step : current;
  }, 0);

  const stepSince = script.messages.reduce((since, message, index) => {
    return message.step === step ? timeline.messages[index]!.appearAt : since;
  }, 0);

  const labels = script.messages.flatMap((message, index) => {
    return message.label ? [{ text: message.label, at: timeline.messages[index]!.appearAt }] : [];
  });

  const lineOpacity =
    interpolate(frame, [closeAt + 8, closeAt + 18], [0, 1], CLAMP) *
    interpolate(frame, [closeAt + 50, closeAt + 58], [1, 0], CLAMP);

  const brandIn = pop(frame, closeAt + 58);

  return (
    <AbsoluteFill style={{ background: BACKGROUND, fontFamily: FONT }}>
      <AbsoluteFill style={{ ...centered, padding: 80 * u, fontSize: 84 * u, lineHeight: 1.2, opacity: hookOpacity }}>
        <div style={{ transform: `translateY(${interpolate(frame, [0, 12], [40 * u, 0], CLAMP)}px)` }}>
          {script.hook}
        </div>
      </AbsoluteFill>

      {frame >= HOOK_FRAMES - 8 && frame < closeAt + 12 && (
        <AbsoluteFill
          style={{
            opacity: sceneIn * (1 - sceneOut),
            transform: `translateY(${(1 - sceneIn) * 200 * u}px) scale(${1 - 0.1 * sceneOut})`
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 180 * u,
              left: 70 * u,
              right: 70 * u,
              textAlign: 'center',
              color: '#ffffff',
              fontSize: 52 * u,
              fontWeight: 800,
              lineHeight: 1.2
            }}
          >
            {script.caption}
          </div>

          <div
            style={{ position: 'absolute', top: 340 * u, left: 120 * u, right: 120 * u, display: 'flex', gap: 14 * u }}
          >
            {[1, 2, 3, 4].map((segment) => (
              <div
                key={segment}
                style={{ flex: 1, height: 12 * u, borderRadius: 6 * u, background: '#334155', overflow: 'hidden' }}
              >
                <div
                  style={{
                    height: '100%',
                    background: ACCENT,
                    width:
                      segment < step
                        ? '100%'
                        : segment === step
                          ? `${interpolate(frame, [stepSince, stepSince + 10], [0, 100], CLAMP)}%`
                          : '0%'
                  }}
                />
              </div>
            ))}
          </div>

          <div
            style={{
              position: 'absolute',
              top: 400 * u,
              left: 110 * u,
              width: 860 * u,
              height: 1130 * u,
              borderRadius: 60 * u,
              border: `${10 * u}px solid #1e293b`,
              background: '#efeae2',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 22 * u,
                padding: `${24 * u}px ${30 * u}px`,
                background: '#0b5d52',
                color: '#ffffff'
              }}
            >
              <div
                style={{
                  width: 76 * u,
                  height: 76 * u,
                  borderRadius: '50%',
                  background: ACCENT,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 40 * u,
                  fontWeight: 800
                }}
              >
                {script.storeName.charAt(0)}
              </div>
              <div>
                <div style={{ fontSize: 40 * u, fontWeight: 700, whiteSpace: 'nowrap' }}>{script.storeName}</div>
                <div style={{ fontSize: 28 * u, opacity: 0.85 }}>online</div>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                overflow: 'hidden',
                padding: `${10 * u}px ${24 * u}px ${70 * u}px`
              }}
            >
              {script.messages.map((message, index) => (
                <Bubble key={index} message={message} frame={frame} u={u} {...timeline.messages[index]!} />
              ))}
            </div>
          </div>

          {labels.map((label, index) => {
            const replacedAt = labels[index + 1]?.at;
            const fade = replacedAt === undefined ? 1 : interpolate(frame, [replacedAt - 6, replacedAt], [1, 0], CLAMP);
            const enter = pop(frame, label.at);
            const tilt = index % 2 === 0 ? 1 : -1;

            // One label at a time, on the phone's bottom edge: it never covers a bubble.
            return (
              <div
                key={label.text}
                style={{
                  position: 'absolute',
                  top: 1485 * u,
                  left: 0,
                  right: 0,
                  display: 'flex',
                  justifyContent: 'center',
                  opacity: Math.min(1, enter) * fade,
                  transform: `translateX(${tilt * 60 * u}px) scale(${enter}) rotate(${tilt * 2}deg)`
                }}
              >
                <div
                  style={{
                    padding: `${20 * u}px ${36 * u}px`,
                    borderRadius: 999,
                    background: '#ffffff',
                    color: '#0f172a',
                    fontSize: 44 * u,
                    fontWeight: 800,
                    whiteSpace: 'pre',
                    boxShadow: `0 ${12 * u}px ${32 * u}px rgba(0,0,0,0.45)`
                  }}
                >
                  {spaced(label.text)}
                </div>
              </div>
            );
          })}
        </AbsoluteFill>
      )}

      <AbsoluteFill style={{ ...centered, padding: 80 * u, fontSize: 88 * u, lineHeight: 1.2, opacity: lineOpacity }}>
        {CLOSING_LINE}
      </AbsoluteFill>

      {frame >= closeAt + 58 && (
        <AbsoluteFill style={{ ...centered, gap: 36 * u, opacity: Math.min(1, brandIn) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 * u, transform: `scale(${brandIn})` }}>
            <Img src={staticFile('logo.svg')} style={{ width: 150 * u, height: 150 * u }} />
            <div style={{ fontSize: 120 * u, letterSpacing: -2 * u }}>Atendy</div>
          </div>
          <div style={{ fontSize: 60 * u, fontWeight: 700, lineHeight: 1.25 }}>{CLOSING_CTA}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
