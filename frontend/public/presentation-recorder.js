/* Audio and slide events share a sample clock, including across pauses. */
class PresentationRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = 0;
    this.active = false;
    this.started = false;
    this.finished = false;
    this.slide = 1;
    this.buffer = new Float32Array(4096);
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (this.finished) return;
      if (data.type === "start" && !this.started) {
        this.started = true;
        this.active = true;
        this.origin = currentTime;
        this.slide = data.slide;
      } else if (!this.started) return;
      else if (data.type === "slide") this.slide = data.slide;
      else if (data.type === "pause" && this.active) this.active = false;
      else if (data.type === "resume" && !this.active) this.active = true;
      else if (data.type === "finish") {
        this.finish();
        return;
      } else return;
      this.event(data.type);
    };
  }
  event(type) {
    this.port.postMessage({
      type: "event",
      event: {
        type,
        slide: this.slide,
        time: this.samples / sampleRate,
        wall_time: currentTime - this.origin,
      },
    });
  }
  flush() {
    if (!this.offset) return;
    const chunk = this.buffer.slice(0, this.offset);
    this.port.postMessage({ type: "chunk", chunk }, [chunk.buffer]);
    this.offset = 0;
  }
  finish() {
    this.active = false;
    this.finished = true;
    this.flush();
    this.event("finish");
  }
  process(inputs, outputs) {
    // Keep the graph alive without playing the microphone through the speakers.
    for (const channel of outputs[0] || []) channel.fill(0);
    const input = inputs[0]?.[0];
    if (this.active && input) {
      for (const value of input) {
        this.buffer[this.offset++] = value;
        this.samples++;
        if (this.offset === this.buffer.length) this.flush();
        if (this.samples >= sampleRate * 900) {
          this.finish();
          break;
        }
      }
      const second = Math.floor(this.samples / sampleRate);
      if (second !== this.lastSecond) {
        this.lastSecond = second;
        this.port.postMessage({
          type: "clock",
          time: this.samples / sampleRate,
        });
      }
    }
    return !this.finished;
  }
}
registerProcessor("presentation-recorder", PresentationRecorder);
