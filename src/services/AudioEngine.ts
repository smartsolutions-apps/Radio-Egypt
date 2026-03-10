/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private noiseNode: AudioWorkletNode | ScriptProcessorNode | null = null;
  private noiseGain: GainNode | null = null;
  private radioGain: GainNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;

  constructor() {
    // Initialized on first user interaction
  }

  private init() {
    if (this.audioContext) return;
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Create white noise
    const bufferSize = 2 * this.audioContext.sampleRate;
    const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this.audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    this.noiseGain = this.audioContext.createGain();
    this.noiseGain.gain.value = 0;

    noiseSource.connect(this.noiseGain);
    this.noiseGain.connect(this.audioContext.destination);
    noiseSource.start();

    // Setup for radio stream clarity
    this.radioGain = this.audioContext.createGain();
    this.radioGain.gain.value = 1;
    this.radioGain.connect(this.audioContext.destination);
  }

  public setMix(signalStrength: number) {
    this.init();
    if (!this.noiseGain || !this.radioGain || !this.audioContext) return;

    // signalStrength is 0 to 1
    // 1 = clear radio, 0 noise
    // 0 = no radio, full noise
    
    const now = this.audioContext.currentTime;
    
    // Smooth transition
    this.noiseGain.gain.setTargetAtTime((1 - signalStrength) * 0.15, now, 0.1);
    this.radioGain.gain.setTargetAtTime(signalStrength, now, 0.1);
  }

  public connectStream(audioElement: HTMLAudioElement) {
    this.init();
    if (!this.audioContext || !this.radioGain) return;
    
    try {
      const source = this.audioContext.createMediaElementSource(audioElement);
      source.connect(this.radioGain);
    } catch (e) {
      // Source already connected or other error
      console.warn("AudioEngine: Stream already connected or error", e);
    }
  }

  public resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }
}

export const audioEngine = new AudioEngine();
