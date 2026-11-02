class PulsePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48000 * 2;
    this.queue = new Float32Array(this.capacity);
    this.read = 0;
    this.write = 0;
    this.available = 0;
    this.port.onmessage = (event) => {
      const port = event.data;
      port.onmessage = (chunkEvent) => this.enqueue(chunkEvent.data.pcm);
      port.start();
    };
  }

  enqueue(buffer) {
    const alignedBytes = buffer.byteLength - (buffer.byteLength % 8);
    if (alignedBytes === 0) return;
    const chunk = new Float32Array(buffer, 0, alignedBytes / 4);
    const max = this.capacity;
    if (chunk.length >= max) {
      const start = chunk.length - max;
      for (let i = 0; i < max; i++) this.queue[i] = chunk[start + i];
      this.read = 0;
      this.write = 0;
      this.available = max;
      return;
    }
    const overflow = Math.max(0, this.available + chunk.length - max);
    this.read = (this.read + overflow) % max;
    this.available -= overflow;
    for (let i = 0; i < chunk.length; i++) {
      this.queue[this.write] = chunk[i];
      this.write = (this.write + 1) % max;
    }
    this.available += chunk.length;
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    const left = channels?.[0];
    const right = channels?.[1];
    if (!left) return true;
    left.fill(0);
    right?.fill(0);
    const frames = Math.min(left.length, Math.floor(this.available / 2));
    for (let frame = 0; frame < frames; frame++) {
      left[frame] = this.queue[this.read];
      this.read = (this.read + 1) % this.capacity;
      if (right) right[frame] = this.queue[this.read];
      this.read = (this.read + 1) % this.capacity;
    }
    this.available -= frames * 2;
    return true;
  }
}

registerProcessor('phanteon-pulse-pcm', PulsePcmProcessor);
