import { useEffect, useRef, useState } from 'react';

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

type DetectorConstructor = new (options: { formats: string[] }) => Detector;

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];

const SCAN_INTERVAL_MS = 250;

/**
 * Native `BarcodeDetector` when the browser has it, else the ponyfill (loaded only now).
 */
const loadDetector = async () => {
  const native = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;

  if (native) {
    return new native({ formats: FORMATS });
  }

  const { BarcodeDetector } = await import('barcode-detector/ponyfill');

  return new (BarcodeDetector as unknown as DetectorConstructor)({ formats: FORMATS });
};

function ScannerOverlay({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();
  const handler = useRef(onCode);

  handler.current = onCode;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | undefined;

    const scan = async (detector: Detector) => {
      const element = video.current;

      if (stopped || !element) {
        return;
      }

      const [found] = element.readyState >= 2 ? await detector.detect(element).catch(() => []) : [];

      if (stopped) {
        return;
      }

      if (found?.rawValue) {
        handler.current(found.rawValue);

        return;
      }

      timer = setTimeout(() => void scan(detector), SCAN_INTERVAL_MS);
    };

    const stopStream = () => stream?.getTracks().forEach((track) => track.stop());

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch {
        setError('Não foi possível abrir a câmera. Verifique a permissão do navegador.');

        return;
      }

      if (stopped) {
        stopStream();

        return;
      }

      let detector: Detector;

      try {
        detector = await loadDetector();
      } catch {
        // The camera is open already: release it before saying the reader is missing.
        stopStream();
        setError('Leitor indisponível neste navegador.');

        return;
      }

      try {
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
      } catch {
        stopStream();
        setError('Não foi possível abrir a câmera. Verifique a permissão do navegador.');

        return;
      }

      void scan(detector);
    };

    void start();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stopStream();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-fg">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Aponte para o código de barras</p>
          <button type="button" onClick={onClose} className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-2">
            Fechar
          </button>
        </div>
        {error ? (
          <p className="text-sm text-danger-fg">{error}</p>
        ) : (
          <video ref={video} muted playsInline className="aspect-[4/3] w-full rounded-lg bg-black object-cover" />
        )}
      </div>
    </div>
  );
}

/**
 * A "Ler código" button that opens the camera and reports the first barcode it reads. Renders nothing when the
 * browser has no camera API.
 */
export function BarcodeScanner({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false);

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 shrink-0 rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover"
      >
        Ler código
      </button>
      {open && (
        <ScannerOverlay
          onCode={(code) => {
            setOpen(false);
            onCode(code);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
