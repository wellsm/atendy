let context: AudioContext | undefined;

/**
 * Short two-tone beep with Web Audio (no asset). Browsers allow it only after a user gesture: call
 * `unlockSound` from a click first.
 */
export const unlockSound = () => {
  context ??= new AudioContext();

  return context.resume();
};

export const playBeep = () => {
  if (!context || context.state !== 'running') {
    return;
  }

  [880, 1175].forEach((frequency, index) => {
    const start = context!.currentTime + index * 0.18;
    const oscillator = context!.createOscillator();
    const gain = context!.createGain();

    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.25, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);

    oscillator.connect(gain).connect(context!.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.16);
  });
};
