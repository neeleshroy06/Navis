/** Target input rate for Gemini Live (16 kHz PCM). */
export const LIVE_INPUT_SAMPLE_RATE = 16_000;
/** Model output audio rate (24 kHz PCM). */
export const LIVE_OUTPUT_SAMPLE_RATE = 24_000;

export function int16ToBase64(pcm: Int16Array): string {
  const u8 = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary);
}

/** Linear resample + float [-1,1] to int16. */
export function float32ToPcm16AtRate(
  input: Float32Array,
  inputRate: number,
  outRate: number,
): Int16Array {
  if (inputRate === outRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }
    return out;
  }
  const ratio = inputRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = Math.floor(i * ratio);
    const s = Math.max(-1, Math.min(1, input[srcIdx]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Schedules 16-bit PCM chunks for playback at `sampleRate`. */
export class PcmChunkPlayer {
  private ctx: AudioContext;
  private nextTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();

  constructor(sampleRate = LIVE_OUTPUT_SAMPLE_RATE) {
    try {
      this.ctx = new AudioContext({ sampleRate });
    } catch {
      this.ctx = new AudioContext();
    }
  }

  get context(): AudioContext {
    return this.ctx;
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  enqueuePcm16(pcm: Int16Array, sampleRate: number) {
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    const n = pcm.length;
    const float32 = new Float32Array(n);
    for (let i = 0; i < n; i++) float32[i] = pcm[i] / 0x8000;
    const buffer = this.ctx.createBuffer(1, n, sampleRate);
    buffer.copyToChannel(float32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    src.onended = () => {
      this.activeSources.delete(src);
    };
    const start = Math.max(this.ctx.currentTime, this.nextTime);
    this.activeSources.add(src);
    src.start(start);
    this.nextTime = start + buffer.duration;
  }

  flush() {
    this.nextTime = this.ctx.currentTime;
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        /* ignore stale node */
      }
    }
    this.activeSources.clear();
  }

  close() {
    this.flush();
    void this.ctx.close();
  }
}

export type MicCapture = {
  stop: () => void;
};

/**
 * Captures mic as 16 kHz PCM chunks via ScriptProcessorNode (deprecated but
 * widely supported for small buffers).
 */
export function startMicPcmCapture(
  onPcmBase64: (chunk: string) => void,
  shouldSend: () => boolean,
  onSpeechStart?: () => void,
): Promise<MicCapture> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        });
        const ctx = new AudioContext();
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        const inputRate = ctx.sampleRate;
        const source = ctx.createMediaStreamSource(stream);
        const bufferSize = 4096;
        const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
        let stopped = false;
        let speaking = false;
        let speakingResetTimer: number | null = null;

        processor.onaudioprocess = (e) => {
          if (stopped || !shouldSend()) return;
          const input = e.inputBuffer.getChannelData(0);
          let sumSquares = 0;
          for (let i = 0; i < input.length; i++) {
            sumSquares += input[i] * input[i];
          }
          const rms = Math.sqrt(sumSquares / input.length);
          if (rms > 0.025 && !speaking) {
            speaking = true;
            onSpeechStart?.();
          }
          if (speakingResetTimer !== null) {
            window.clearTimeout(speakingResetTimer);
          }
          speakingResetTimer = window.setTimeout(() => {
            speaking = false;
            speakingResetTimer = null;
          }, 250);
          const copy = new Float32Array(input.length);
          copy.set(input);
          const pcm = float32ToPcm16AtRate(copy, inputRate, LIVE_INPUT_SAMPLE_RATE);
          if (pcm.length === 0) return;
          onPcmBase64(int16ToBase64(pcm));
        };

        source.connect(processor);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        processor.connect(mute);
        mute.connect(ctx.destination);

        resolve({
          stop: () => {
            stopped = true;
            if (speakingResetTimer !== null) {
              window.clearTimeout(speakingResetTimer);
            }
            processor.disconnect();
            mute.disconnect();
            source.disconnect();
            stream.getTracks().forEach((t) => t.stop());
            void ctx.close();
          },
        });
      } catch (err) {
        reject(err);
      }
    })();
  });
}
