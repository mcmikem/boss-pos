import { useRef, useEffect, useState } from 'react';
import { Barcode, X, Zap, CameraOff, Keyboard } from 'lucide-react';
import Quagga from '@ericblade/quagga2';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, isOpen, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [hasCamera, setHasCamera] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      stopScanner();
      setError(null);
      setShowManual(false);
      setManualValue('');
      setHasCamera(true);
      return;
    }

    if (showManual) return;

    checkCameraAndStart();

    return () => {
      stopScanner();
    };
  }, [isOpen, showManual]);

  const checkCameraAndStart = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      if (cams.length === 0) {
        setError('No camera found on this device.');
        setShowManual(true);
        setHasCamera(false);
        return;
      }
    } catch {}

    startQuagga();
  };

  const startQuagga = () => {
    if (!scannerRef.current) return;

    Quagga.init({
      inputStream: {
        name: 'Live',
        type: 'LiveStream',
        target: scannerRef.current,
        constraints: {
          facingMode: 'environment',
          aspectRatio: { min: 1, max: 2 },
        },
        area: { top: '25%', right: '10%', left: '10%', bottom: '25%' },
      } as any,
      decoder: {
        readers: [
          'ean_reader',
          'ean_8_reader',
          'code_128_reader',
          'code_39_reader',
          'upc_reader',
          'upc_e_reader',
          'codabar_reader',
          'i2of5_reader',
        ],
      },
      locate: true,
      locator: { patchSize: 'medium', halfSample: true },
    }, (err: any) => {
      if (err) {
        const msg = err.message || String(err);
        if (msg.includes('NotAllowed') || msg.includes('permission')) {
          setError('Camera permission denied. Allow camera access in your browser settings.');
        } else if (msg.includes('NotFound') || msg.includes('not found')) {
          setError('No camera found on this device.');
        } else {
          setError(`Camera error: ${msg}`);
        }
        setShowManual(true);
        return;
      }
      Quagga.start();
    });

    Quagga.onDetected((data: any) => {
      if (data && data.codeResult && data.codeResult.code) {
        const code = data.codeResult.code;
        Quagga.offDetected(() => {});
        stopScanner();
        onScan(code);
      }
    });
  };

  const stopScanner = () => {
    try { Quagga.offDetected(() => {}); } catch {}
    try { Quagga.stop(); } catch {}
  };

  const toggleTorch = async () => {
    try {
      const track = Quagga.CameraAccess.getActiveTrack();
      if (track) {
        await track.applyConstraints({ advanced: [{ torch: !torchOn } as any] });
        setTorchOn(!torchOn);
      }
    } catch {}
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black z-[100] flex flex-col">
      <div className="flex justify-between items-center p-4 z-10">
        <div className="flex items-center gap-2">
          <Barcode className="w-5 h-5 text-gold-brand" />
          <h3 className="text-sm font-black text-white uppercase tracking-wider">Scan Barcode</h3>
        </div>
        <button onClick={onClose} className="p-2 text-white/60 hover:text-white rounded-xl hover:bg-white/10 transition-all">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        {error && !showManual ? (
          <div className="text-center p-6 max-w-sm">
            <CameraOff className="w-12 h-12 text-rose-400 mx-auto mb-4" />
            <p className="text-sm text-rose-300 font-bold">{error}</p>
            <button onClick={onClose}
              className="mt-4 px-6 h-10 bg-gold-brand text-black font-black uppercase text-xs rounded-xl">Close</button>
          </div>
        ) : showManual ? (
          <div className="w-full max-w-md p-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2 text-zinc-400">
                <Keyboard className="w-5 h-5" />
                <p className="text-xs font-bold uppercase tracking-wider">Type barcode or IMEI manually</p>
              </div>
              <input type="text" value={manualValue} onChange={(e) => setManualValue(e.target.value)}
                placeholder="Enter barcode..." autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manualValue.trim()) {
                    onScan(manualValue.trim());
                  }
                }}
                className="w-full bg-black border border-zinc-700 text-white text-center text-lg font-mono tracking-wider h-14 px-4 rounded-xl focus:border-gold-brand outline-none placeholder-zinc-600" />
              <div className="flex gap-2">
                {hasCamera && <button onClick={() => { setShowManual(false); }} className="flex-1 h-11 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl hover:bg-zinc-900">Camera</button>}
                <button onClick={() => { if (manualValue.trim()) onScan(manualValue.trim()); }}
                  className={`${hasCamera ? 'flex-1' : 'w-full'} h-11 bg-gold-brand text-black font-black text-xs rounded-xl`}>Submit</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={scannerRef} className="w-full h-full" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-72 h-1 bg-gold-brand/80 rounded-full animate-pulse shadow-[0_0_30px_rgba(255,204,0,0.6)]" />
            </div>
            <div className="absolute inset-0 border-[60px] border-black/40 pointer-events-none" />
          </>
        )}
      </div>

      {!showManual && !error && (
        <div className="p-6 flex justify-center gap-4">
          <button onClick={toggleTorch}
            className={`p-4 rounded-2xl border transition-all ${torchOn ? 'bg-gold-brand text-black border-gold-brand' : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'}`}>
            <Zap className="w-6 h-6" />
          </button>
          <button onClick={() => { stopScanner(); setShowManual(true); }}
            className="px-6 h-14 border border-white/10 text-white/60 hover:text-white font-bold text-xs rounded-2xl uppercase tracking-wider">
            Type instead
          </button>
          <button onClick={onClose}
            className="px-8 h-14 bg-gold-brand text-black font-black uppercase tracking-widest text-sm rounded-2xl">Cancel</button>
        </div>
      )}
    </div>
  );
}
