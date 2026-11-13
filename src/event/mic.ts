// Listens to the MC's mic and ducks the music while they talk. The mic is only measured, never played out.
import type { Mixer } from '../audio/mixer'
import { GATE_DEFAULT, gate, rmsDb, type GateConfig, type GateState } from './gate'

export const MIC_DUCK_DB = 12
const POLL_MS = 50

export class MicDucker {
  level = -100 // dBFS, for the meter
  open = false
  config: GateConfig = { ...GATE_DEFAULT }
  private readonly onChange: () => void

  private stream: MediaStream | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private state: GateState = { open: false, lastAbove: -Infinity }
  private readonly mixer: Mixer

  constructor(mixer: Mixer, onChange: () => void) {
    this.mixer = mixer
    this.onChange = onChange
  }

  setThreshold(db: number) {
    this.config = { ...this.config, thresholdDb: db }
    this.onChange()
  }

  get running() { return this.stream !== null }

  /** Audio inputs, labelled once the browser has granted mic permission. */
  static async inputs() {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
  }

  async start(deviceId?: string) {
    this.stop()
    // Raw signal: the browser's voice processing would fight the gate (auto gain lifts room noise over the threshold).
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    await this.mixer.resume()
    const source = this.mixer.ctx.createMediaStreamSource(this.stream)
    const analyser = new AnalyserNode(this.mixer.ctx, { fftSize: 2048 })
    source.connect(analyser) // deliberately not connected to the speakers
    const buf = new Float32Array(analyser.fftSize)
    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      this.level = rmsDb(buf)
      const next = gate(this.state, this.level, performance.now() / 1000, this.config)
      if (next.open !== this.state.open) {
        // Fast down so the first word is heard, slower back up so it doesn't pump between sentences.
        this.mixer.duck('mic', next.open ? MIC_DUCK_DB : null, next.open ? 0.15 : 1)
      }
      this.state = next
      this.open = next.open
      this.onChange()
    }, POLL_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.state = { open: false, lastAbove: -Infinity }
    this.open = false
    this.level = -100
    this.mixer.duck('mic', null, 1)
    this.onChange()
  }
}
