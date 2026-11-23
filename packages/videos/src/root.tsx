import { Composition } from 'remotion';

import { FullConversation } from './full-conversation.tsx';
import { SCRIPTS } from './scripts/index.ts';
import { buildTimeline, FPS } from './timeline.ts';

export const Root = () => (
  <>
    {SCRIPTS.map((script) => (
      <Composition
        key={script.slug}
        id={`conversation-${script.slug}`}
        component={FullConversation}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={buildTimeline(script).totalFrames}
        defaultProps={{ script }}
      />
    ))}
  </>
);
