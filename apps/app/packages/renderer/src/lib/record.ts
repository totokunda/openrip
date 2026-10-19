import { recordPick } from "@app/preload";
import { MicError } from "./mic";

/**
 * Recording the screen, the camera or both (the Media tab's Record): the page captures them
 * with getDisplayMedia and getUserMedia and a MediaRecorder keeps a WebM, which the preload's
 * `recordingSave` makes into an MP4 in the project's media. "Both" draws the camera as a small
 * picture over the screen on a canvas and records that. In test mode a screen source whose id
 * starts with "fake:" is a canvas the page draws itself (nothing real is captured).
 */

export type RecordMode = "screen" | "camera" | "both";

export type RecordOptions = {
  mode: RecordMode;
  /** A source id from the main process's list (screen and both). */
  sourceId?: string;
  /** A video input's id (camera and both); none is the system's default camera. */
  cameraId?: string;
  /** Also record the microphone (the Voiceover panel's input device). */
  microphone: boolean;
  /** Called if the capture ends by itself (the shared window was closed). */
  onEnded?: () => void;
};

export type VideoInput = { id: string; label: string };

export async function listVideoInputs(): Promise<VideoInput[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

/** The microphone the Voiceover panel was last set to (its remembered device), or none. */
const rememberedMic = (): string | undefined => {
  try {
    const raw = window.localStorage.getItem("openrip:voiceover:device");
    const id = raw ? (JSON.parse(raw) as string) : "";
    return id || undefined;
  } catch {
    return undefined;
  }
};

/** A moving picture the page draws itself, for tests. */
function fakeScreen(): { stream: MediaStream; stop: () => void } {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const g = canvas.getContext("2d")!;
  let n = 0;
  const draw = () => {
    g.fillStyle = "#1d3b5c";
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = "#f2c94c";
    g.fillRect(40 + ((n * 6) % 480), 100 + Math.round(60 * Math.sin(n / 8)), 80, 80);
    g.fillStyle = "#ffffff";
    g.font = "24px sans-serif";
    g.fillText(`screen ${n}`, 24, 40);
    n++;
  };
  draw();
  const timer = setInterval(draw, 33);
  return { stream: canvas.captureStream(30), stop: () => clearInterval(timer) };
}

const denied = (e: unknown) => ["NotAllowedError", "SecurityError"].includes((e as DOMException)?.name);

export class Recorder {
  #recorder: MediaRecorder;
  #chunks: Blob[] = [];
  #cleanup: (() => void)[];
  #hasAudio: boolean;
  #stopped: Promise<Blob>;
  #discard = false;
  /** The recording's picture size and frame rate. */
  readonly width: number;
  readonly height: number;

  private constructor(stream: MediaStream, cleanup: (() => void)[], hasAudio: boolean, size: { width: number; height: number }) {
    this.#cleanup = cleanup;
    this.#hasAudio = hasAudio;
    this.width = size.width;
    this.height = size.height;
    const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    this.#recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 8_000_000 });
    this.#stopped = new Promise((resolve) => {
      this.#recorder.onstop = () => resolve(new Blob(this.#chunks, { type: "video/webm" }));
    });
    this.#recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.#chunks.push(e.data);
    };
    this.#recorder.start(1000);
  }

  get hasAudio() {
    return this.#hasAudio;
  }

  /** Open what's to be recorded and start. Rejects with a MicError("denied") when the system refuses. */
  static async start(o: RecordOptions): Promise<Recorder> {
    const cleanup: (() => void)[] = [];
    const tracks: MediaStreamTrack[] = [];
    const fail = (e: unknown): never => {
      for (const c of cleanup) c();
      if (denied(e)) throw new MicError("denied", "access denied");
      if ((e as DOMException)?.name === "NotFoundError") throw new MicError("missing", "no such device");
      throw new MicError("other", e instanceof Error ? e.message : String(e));
    };
    let screen: MediaStream | null = null;
    let camera: MediaStream | null = null;
    try {
      if (o.mode !== "camera") {
        if (o.sourceId?.startsWith("fake:")) {
          const fake = fakeScreen();
          screen = fake.stream;
          cleanup.push(fake.stop);
        } else {
          await recordPick(o.sourceId ?? null);
          screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
        }
        cleanup.push(() => screen?.getTracks().forEach((t) => t.stop()));
      }
      if (o.mode !== "screen") {
        camera = await navigator.mediaDevices.getUserMedia({
          video: { ...(o.cameraId ? { deviceId: { exact: o.cameraId } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        cleanup.push(() => camera?.getTracks().forEach((t) => t.stop()));
      }
      let audio: MediaStream | null = null;
      if (o.microphone) {
        const id = rememberedMic();
        audio = await navigator.mediaDevices.getUserMedia({ audio: { ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        cleanup.push(() => audio?.getTracks().forEach((t) => t.stop()));
      }

      let video: MediaStreamTrack;
      let size: { width: number; height: number };
      if (o.mode === "both" && screen && camera) {
        // The camera's picture in a corner of the screen's, drawn on a canvas that is recorded.
        const settings = screen.getVideoTracks()[0].getSettings();
        const W = settings.width || 1280;
        const H = settings.height || 720;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const g = canvas.getContext("2d")!;
        const play = async (s: MediaStream) => {
          const v = document.createElement("video");
          v.muted = true;
          v.srcObject = s;
          await v.play();
          return v;
        };
        const screenVideo = await play(screen);
        const cameraVideo = await play(camera);
        const pw = Math.round(W * 0.22);
        const ph = Math.round((pw * (cameraVideo.videoHeight || 9)) / (cameraVideo.videoWidth || 16));
        const margin = Math.round(W * 0.02);
        const timer = setInterval(() => {
          g.drawImage(screenVideo, 0, 0, W, H);
          g.drawImage(cameraVideo, W - pw - margin, H - ph - margin, pw, ph);
          g.strokeStyle = "#ffffff";
          g.lineWidth = 3;
          g.strokeRect(W - pw - margin, H - ph - margin, pw, ph);
        }, 33);
        cleanup.push(() => clearInterval(timer));
        video = canvas.captureStream(30).getVideoTracks()[0];
        size = { width: W, height: H };
      } else {
        const source = (screen ?? camera)!;
        video = source.getVideoTracks()[0];
        const s = video.getSettings();
        size = { width: s.width || 1280, height: s.height || 720 };
      }
      tracks.push(video);
      const mic = audio?.getAudioTracks()[0];
      if (mic) tracks.push(mic);
      // The capture ending by itself (the shared window closed, the camera unplugged).
      if (screen && o.onEnded) screen.getVideoTracks()[0].addEventListener("ended", o.onEnded);
      if (camera && o.mode === "camera" && o.onEnded) camera.getVideoTracks()[0].addEventListener("ended", o.onEnded);
      return new Recorder(new MediaStream(tracks), cleanup, !!mic, size);
    } catch (e) {
      return fail(e);
    }
  }

  /** Stop and give the WebM. */
  async stop(): Promise<Blob> {
    if (this.#recorder.state !== "inactive") this.#recorder.stop();
    const blob = await this.#stopped;
    for (const c of this.#cleanup) c();
    return blob;
  }

  /** Stop and throw it away. */
  cancel() {
    this.#discard = true;
    if (this.#recorder.state !== "inactive") this.#recorder.stop();
    for (const c of this.#cleanup) c();
    this.#chunks = [];
  }

  get discarded() {
    return this.#discard;
  }
}
