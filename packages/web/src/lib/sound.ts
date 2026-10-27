let context: AudioContext | undefined;

/**
 * Short beeps with Web Audio (no asset). Browsers allow them only after a user gesture: call `unlockSound` from a
 * click first.
 */
export const unlockSound = () => {
  context ??= new AudioContext();

  return context.resume();
};

/**
 * `order`: rising two-tone (new order). `attention`: three quick low pulses (a conversation needs a person).
 */
const TONES = {
  order: [880, 1175],
  attention: [523, 523, 523]
} as const;

export type Beep = keyof typeof TONES;

export const playBeep = (beep: Beep = 'order') => {
  if (!context || context.state !== 'running') {
    return;
  }

  const step = beep === 'order' ? 0.18 : 0.13;
  const length = beep === 'order' ? 0.16 : 0.09;

  TONES[beep].forEach((frequency, index) => {
    const start = context!.currentTime + index * step;
    const oscillator = context!.createOscillator();
    const gain = context!.createGain();

    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.25, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + length);

    oscillator.connect(gain).connect(context!.destination);
    oscillator.start(start);
    oscillator.stop(start + length);
  });
};
