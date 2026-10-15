// Voice input: hands the microphone's samples to the page in small batches (40 ms at 16 kHz), so the page can show
// the level, find pauses and cut the recording into pieces for the live transcript. Nothing leaves the browser here.
class DocendoTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(640);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("docendo-tap", DocendoTap);
