/**
 * The page's own microphone capture for the Voiceover panel: the input device the user picked,
 * a gain (the panel's Volume), the browser's echo cancellation and noise suppression (the
 * panel's Echo reduction) and a level for the meter. Takes are kept as 16-bit samples for the
 * preload's `voiceoverSaveTake`.
 */

export type AudioInput = { id: string; label: string };

/**
 * Test mode's microphones (the main process says when, `recordFake`): oscillators at a quarter
 * of full scale, one tone each, so a take shows which device was picked.
 */
export const FAKE_MICS = [
  { id: "fake-mic-1", label: "Test microphone", hz: 440 },
  { id: "fake-mic-2", label: "Second test microphone", hz: 880 },
];

/** A stream that hears a tone: the stand-in for a microphone in test mode. */
export function fakeMicStream(ctx: AudioContext, id?: string): { node: AudioNode; stop: () => void } {
  const hz = (FAKE_MICS.find((m) => m.id === id) ?? FAKE_MICS[0]).hz;
  const osc = ctx.createOscillator();
  osc.frequency.value = hz;
  const level = ctx.createGain();
  level.gain.value = 0.25;
  osc.connect(level);
  osc.start();
  return { node: level, stop: () => osc.stop() };
}

/** The microphones, by name when the system has let the page see them (after a permission). */
export async function listAudioInputs(fake = false): Promise<AudioInput[]> {
  if (fake) return FAKE_MICS.map(({ id, label }) => ({ id, label }));
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput" && d.deviceId !== "communications")
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

export type MicOptions = {
  /** An id from `listAudioInputs`; none is the system's default microphone. */
  deviceId?: string;
  /** The Volume slider as a gain (1 is the microphone's own level). */
  gain: number;
  /** Echo cancellation and noise suppression on. */
  echoReduction: boolean;
  /** Called with each block's peak (0..1, after the gain) while it records. */
  onLevel: (peak: number) => void;
  /** Test mode: hear a tone instead of a microphone. */
  fake?: boolean;
};

export type MicTake = { pcm: Int16Array; rate: number; channels: number; durationSec: number };

/** Why a microphone couldn't be opened: "denied" (the system or the user refused) or "missing" (no such device). */
export class MicError extends Error {
  constructor(readonly reason: "denied" | "missing" | "other", message: string) {
    super(message);
  }
}

export class MicRecorder {
  #stream: MediaStream | null;
  #stopSource: () => void;
  #ctx: AudioContext;
  #gain: GainNode;
  #node: ScriptProcessorNode;
  #chunks: Float32Array[] = [];
  #frames = 0;
  #open = true;

  private constructor(stream: MediaStream | null, stopSource: () => void, ctx: AudioContext, gain: GainNode, node: ScriptProcessorNode) {
    this.#stream = stream;
    this.#stopSource = stopSource;
    this.#ctx = ctx;
    this.#gain = gain;
    this.#node = node;
  }

  /** Open the microphone and start keeping what it hears. */
  static async start(o: MicOptions): Promise<MicRecorder> {
    let stream: MediaStream | null = null;
    try {
      if (!o.fake) stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(o.deviceId ? { deviceId: { exact: o.deviceId } } : {}),
          echoCancellation: o.echoReduction,
          noiseSuppression: o.echoReduction,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw new MicError("denied", "microphone access denied");
      if (name === "NotFoundError" || name === "OverconstrainedError") throw new MicError("missing", "that microphone isn't available");
      throw new MicError("other", e instanceof Error ? e.message : String(e));
    }
    const ctx = new AudioContext();
    const fake = o.fake ? fakeMicStream(ctx, o.deviceId) : null;
    const source = fake ? fake.node : ctx.createMediaStreamSource(stream!);
    const gain = ctx.createGain();
    gain.gain.value = o.gain;
    const node = ctx.createScriptProcessor(2048, 1, 1);
    const rec = new MicRecorder(stream, fake?.stop ?? (() => {}), ctx, gain, node);
    node.onaudioprocess = (e) => {
      if (!rec.#open) return;
      const input = e.inputBuffer.getChannelData(0);
      rec.#chunks.push(new Float32Array(input));
      rec.#frames += input.length;
      let peak = 0;
      for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i]));
      o.onLevel(peak);
    };
    source.connect(gain);
    gain.connect(node);
    // The processor only runs while it leads somewhere; its own output stays silent.
    node.connect(ctx.destination);
    await ctx.resume();
    return rec;
  }

  /** The Volume slider moved: the take hears it from now on. */
  setGain(gain: number) {
    this.#gain.gain.value = gain;
  }

  #close() {
    this.#open = false;
    this.#node.onaudioprocess = null;
    this.#node.disconnect();
    this.#gain.disconnect();
    for (const t of this.#stream?.getTracks() ?? []) t.stop();
    this.#stopSource();
    void this.#ctx.close();
  }

  /** Stop and give the take as 16-bit samples. */
  stop(): MicTake {
    const rate = this.#ctx.sampleRate;
    this.#close();
    const pcm = new Int16Array(this.#frames);
    let at = 0;
    for (const c of this.#chunks) {
      for (let i = 0; i < c.length; i++) pcm[at++] = Math.round(Math.max(-1, Math.min(1, c[i])) * 32767);
    }
    this.#chunks = [];
    return { pcm, rate, channels: 1, durationSec: pcm.length / rate };
  }

  /** Stop and throw the take away. */
  cancel() {
    this.#close();
    this.#chunks = [];
  }
}
