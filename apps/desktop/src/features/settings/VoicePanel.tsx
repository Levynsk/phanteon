import { useEffect, useRef, useState } from 'react';
import { Mic, Volume2 } from 'lucide-react';
import {
  DEVICE_LABEL,
  SCREEN_FRAME_RATES,
  SCREEN_HEIGHTS,
  applySink,
  canSelectOutput,
  listDevices,
  openMicrophone,
  useAudioStore,
  type AudioDevice,
  type AudioDeviceKind,
  type ProcessingKey,
  type ScreenQuality,
} from '../../app/stores/audio';
import { useChatStore } from '../../app/stores/chat';
import { acquireMonitorStream, monitorLevel, releaseMonitorStream } from '../../lib/audio-monitor';
import { applyScreenQuality, sharingScreen } from '../../lib/voice-session';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/Button';
import { NativeSwitch } from '../../components/ui/Switch';
import { toast } from '../../components/ui/Toast';
import { InlineSelect } from './InlineSelect';

const PROCESSING: { key: ProcessingKey; label: string; description: string }[] = [
  {
    key: 'echoCancellation',
    label: 'Cancelamento de eco',
    description: 'Evita que o som que você ouve volte pelo microfone.',
  },
  { key: 'noiseSuppression', label: 'Supressão de ruído', description: 'Atenua ventilador, teclado e ruído de fundo.' },
  { key: 'autoGainControl', label: 'Controle automático de ganho', description: 'Mantém o volume parelho enquanto você fala.' },
];

export function VoicePanel() {
  const prefs = useAudioStore((state) => state.prefs);
  const devices = useAudioStore((state) => state.devices);
  const permission = useAudioStore((state) => state.permission);
  const setPrefs = useAudioStore((state) => state.setPrefs);
  const setProcessing = useAudioStore((state) => state.setProcessing);
  const setDevices = useAudioStore((state) => state.setDevices);
  const setPermission = useAudioStore((state) => state.setPermission);
  const myVoice = useChatStore((state) => state.myVoice);
  const [requesting, setRequesting] = useState(false);
  const outputSupported = canSelectOutput();

  // Chromium hides device ids/labels until the mic was granted at least once (PipeWire/Pulse on Linux
  // included), so the panel unlocks itself on open instead of waiting for a button click.
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      listDevices().then((list) => {
        if (!cancelled) setDevices(list);
      });
    const unlockLabels = async () => {
      if (permission === 'granted' || requesting) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
        if (!cancelled) setPermission('granted');
      } catch {
        if (!cancelled) setPermission('denied');
      } finally {
        await refresh();
      }
    };
    void refresh();
    void unlockLabels();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
    };
    // runs once when the panel mounts; the button below re-runs the same path after a denial
  }, [setDevices, setPermission]);

  const askPermission = async () => {
    setRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      setPermission('granted');
      setDevices(await listDevices());
    } catch {
      setPermission('denied');
      toast.error('Microfone bloqueado', 'Autorize o acesso ao microfone nas configurações do sistema.');
    } finally {
      setRequesting(false);
    }
  };

  const inputs = withDefault(devices.filter((device) => device.kind === 'audioinput'), 'audioinput');
  const outputs = withDefault(devices.filter((device) => device.kind === 'audiooutput'), 'audiooutput');
  const inputValue = inputs.some((device) => device.deviceId === prefs.inputId) ? prefs.inputId : 'default';
  const outputValue = outputs.some((device) => device.deviceId === prefs.outputId) ? prefs.outputId : 'default';

  return (
    <div className="flex flex-col gap-6">
      {permission !== 'granted' ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-app-alt px-4 py-3">
          <p className="text-[13px] text-muted">
            {permission === 'denied'
              ? 'O navegador bloqueou o microfone. Libere o acesso nas configurações do sistema para ver os nomes dos dispositivos.'
              : 'Permita o acesso ao microfone para listar e testar seus dispositivos.'}
          </p>
          <Button size="sm" variant="primary" loading={requesting} onClick={() => void askPermission()}>
            <Mic size={14} aria-hidden /> Permitir microfone
          </Button>
        </div>
      ) : null}

      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Entrada</h3>
        <div className="rounded-md bg-app-alt p-4">
          <DeviceSelect
            label="Microfone"
            value={inputValue}
            devices={inputs}
            onChange={(inputId) => setPrefs({ inputId })}
          />
          <div className="mt-4">
            <Meter open={() => openMicrophone(prefs)} />
          </div>
          <div className="mt-4 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[13px] text-normal">
              <span>Volume de entrada</span>
              <span className="tabular-nums text-muted">{Math.round(prefs.micVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(prefs.micVolume * 100)}
              aria-label="Volume de entrada"
              onChange={(event) => setPrefs({ micVolume: Number(event.target.value) / 100 })}
              className="h-1.5 w-full cursor-pointer accent-[var(--color-brand)]"
            />
            <p className="text-xs text-faint">Ajusta o microfone local antes de enviar o áudio para a chamada.</p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Saída</h3>
        <div className="rounded-md bg-app-alt p-4">
          {outputSupported ? (
            <DeviceSelect
              label="Dispositivo de saída"
              value={outputValue}
              devices={outputs}
              onChange={(outputId) => setPrefs({ outputId })}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
            <p className="text-[13px] text-muted">
              Este sistema não permite escolher a saída pelo app (o Chromium no Linux não suporta `setSinkId`), então a chamada usa o dispositivo padrão.
            </p>
            <p className="mt-1.5 text-xs text-faint">
              Alternativa: no mixer do PipeWire/PulseAudio, mova o áudio do app “Phanteon” para o fone desejado, ou troque a saída padrão do sistema.
            </p>
            <div className="mt-3">
              <DeviceSelect
                label="Dispositivo de saída (informe o sistema)"
                value={outputValue}
                devices={outputs}
                onChange={(outputId) => {
                  setPrefs({ outputId });
                  toast.info('Saída salva', 'No Linux, aplique também no mixer do sistema — o navegador não troca sozinho.');
                }}
              />
            </div>
            </div>
          )}
          <div className="mt-4 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[13px] text-normal">
              <span>Volume de saída</span>
              <span className="tabular-nums text-muted">{Math.round(prefs.outputVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(prefs.outputVolume * 100)}
              aria-label="Volume de saída"
              onChange={(event) => setPrefs({ outputVolume: Number(event.target.value) / 100 })}
              className="h-1.5 w-full cursor-pointer accent-[var(--color-brand)]"
            />
            <p className="text-xs text-faint">
              Aplicado às vozes da chamada. {myVoice ? 'Vale agora, para quem já está falando.' : 'Vale na próxima chamada.'}
            </p>
          </div>
          <div className="mt-4">
            <OutputTest />
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Processamento de voz</h3>
        <div className="flex flex-col rounded-md bg-app-alt p-1">
          {PROCESSING.map((item) => (
            <div key={item.key} className="flex items-center gap-3 rounded-sm px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-normal">{item.label}</span>
                <span className="block text-xs text-faint">{item.description}</span>
              </span>
              <NativeSwitch
                checked={prefs.processing[item.key]}
                onChange={(value) => setProcessing(item.key, value)}
                label={item.label}
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">
          {myVoice ? 'As mudanças valem na hora, mesmo em chamada.' : 'Valem para a próxima chamada.'}
        </p>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Transmissão de tela</h3>
        <div className="rounded-md bg-app-alt p-4">
          <ScreenQualityFields />
        </div>
      </div>
    </div>
  );
}

/**
 * Resolution and frame rate for the screen share. While a share is running the
 * new values are pushed to the live capture, so viewers see the change at once.
 */
function ScreenQualityFields() {
  const quality = useAudioStore((state) => state.prefs.screenQuality);
  const setPrefs = useAudioStore((state) => state.setPrefs);
  const [error, setError] = useState<string | null>(null);

  const apply = (next: ScreenQuality) => {
    setPrefs({ screenQuality: next });
    if (!sharingScreen()) return;
    void applyScreenQuality(next)
      .then(() => setError(null))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Não foi possível aplicar a qualidade.');
      });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-normal">Resolução</span>
        <InlineSelect
          aria-label="Resolução da transmissão"
          value={String(quality.height)}
          onChange={(value) => apply({ ...quality, height: Number(value) })}
          options={SCREEN_HEIGHTS.map((height) => ({
            value: String(height),
            label: `${height}p`,
          }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-normal">Taxa de quadros</span>
        <InlineSelect
          aria-label="Taxa de quadros da transmissão"
          value={String(quality.frameRate)}
          onChange={(value) => apply({ ...quality, frameRate: Number(value) })}
          options={SCREEN_FRAME_RATES.map((rate) => ({ value: String(rate), label: `${rate} fps` }))}
        />
      </div>
      <p className={cn('text-xs', error ? 'text-red' : 'text-faint')}>
        {error
          ? error
          : sharingScreen()
            ? 'Aplicado na transmissão que está no ar, sem reiniciá-la.'
            : 'Vale para a próxima transmissão. Se você já está transmitindo, muda na hora.'}
      </p>
    </div>
  );
}

/** Always offers the system default first, matching Discord's behaviour. */
function withDefault(devices: AudioDevice[], kind: AudioDeviceKind): AudioDevice[] {
  const rest = devices.filter((device) => device.deviceId !== 'default' && device.deviceId !== '');
  return [{ deviceId: 'default', label: `Padrão do sistema (${DEVICE_LABEL[kind]})`, kind }, ...rest];
}

function DeviceSelect({
  label,
  value,
  devices,
  onChange,
}: {
  label: string;
  value: string;
  devices: AudioDevice[];
  onChange: (deviceId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-normal">{label}</span>
      <InlineSelect
        aria-label={label}
        value={value}
        onChange={onChange}
        options={devices.map((device) => ({ value: device.deviceId, label: device.label }))}
      />
    </div>
  );
}

/** Animated input level from a shared microphone preview. */
function Meter({ open }: { open: () => Promise<MediaStream> }) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef(0);
  const smoothing = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      void monitorLevel()
        .then((value) => {
          // fast attack, slow release so the bar does not flicker
          smoothing.current = Math.max(value, smoothing.current * 0.82);
          setLevel(smoothing.current);
        })
        .catch(() => undefined);
      frame.current = window.setTimeout(loop, 90);
    };
    acquireMonitorStream(open)
      .then(() => {
        if (!cancelled) loop();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Não foi possível abrir o microfone.');
      });
    return () => {
      cancelled = true;
      window.clearTimeout(frame.current);
      releaseMonitorStream();
    };
    // a new device reopens the preview
  }, [open]);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-normal">Teste do microfone</span>
      <div className="flex items-center gap-2">
        <Mic size={14} className={cn('shrink-0', level > 0.04 ? 'text-green' : 'text-muted')} aria-hidden />
        <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-tint-strong">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-green transition-[width] duration-100"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </span>
      </div>
      <p className="text-xs text-faint">
        {error ? (
          <span className="text-red">{error}</span>
        ) : level > 0.04 ? (
          'Está te ouvindo.'
        ) : (
          'Fale para ver o nível em tempo real.'
        )}
      </p>
    </div>
  );
}

/** Plays a tone into the selected output so the device can be checked. */
function OutputTest() {
  const prefs = useAudioStore((state) => state.prefs);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const play = async () => {
    if (playing) return;
    setPlaying(true);
    setError(null);
    const context = new AudioContext();
    let element: HTMLAudioElement | null = null;
    try {
      if (context.state === 'suspended') await context.resume();
      const oscillator = context.createOscillator();
      oscillator.frequency.value = 440;
      const gain = context.createGain();
      gain.gain.value = 0.12;
      // the tone must only reach the element below; a direct link to
      // `context.destination` would also play on the system default device
      const capture = context.createMediaStreamDestination();
      oscillator.connect(gain);
      gain.connect(capture);

      element = new Audio();
      element.srcObject = capture.stream;
      // beep volume follows the same slider the call uses, so the test is audible
      element.volume = Math.max(prefs.outputVolume, 0.15);
      await applySink(element, prefs.outputId);
      await element.play();
      oscillator.start();
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      oscillator.stop();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível tocar o teste.');
    } finally {
      element?.pause();
      await context.close().catch(() => undefined);
      setPlaying(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" loading={playing} onClick={() => void play()}>
          <Volume2 size={14} aria-hidden /> Testar saída
        </Button>
        {error ? <span className="text-xs text-red">{error}</span> : null}
      </div>
      <p className="text-xs text-faint">Um tom curto toca só no dispositivo escolhido acima.</p>
    </div>
  );
}
