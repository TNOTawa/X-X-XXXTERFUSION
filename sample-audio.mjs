// Toy loads only predecoded drum cues; full backing is an explicit legacy debug option.
export class SampleAudio {
  constructor(context, { backingEnabled = false } = {}) {
    this.backingEnabled = backingEnabled;
    this.context = context;
    this.ready = false;
    this.hitsEnabled = true;
    this.voices = new Set();
    this.backingSource = null;
    this.manifest = null;
    this.master = context.createGain();
    this.master.gain.value = .9;
    this.backingGain = context.createGain();
    this.backingGain.gain.value = .85;
    this.hitGain = context.createGain();
    this.setHitVolume(150);
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = .003;
    this.limiter.release.value = .08;
    this.backingGain.connect(this.master);
    this.hitGain.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(context.destination);
  }

  setHitVolume(percent) {
    const safe=Number.isFinite(percent)?Math.max(0,Math.min(300,percent)):150;
    this.hitVolume=safe;
    const gain=this.hitGain.gain;
    if(typeof gain.setTargetAtTime==='function') {
      gain.cancelScheduledValues?.(this.context.currentTime);
      gain.setTargetAtTime(safe/100,this.context.currentTime,.01);
    } else gain.value=safe/100;
    return safe;
  }

  setAssets(manifest, backingBuffer, atlasBuffer) {
    for (const [id, cue] of Object.entries(manifest.cues)) {
      if (!(cue.durationSeconds > 0) || !(cue.offsetSeconds >= 0) || cue.offsetSeconds+cue.durationSeconds > atlasBuffer.duration+.001) {
        throw new Error(`Invalid original-drum cue: ${id}`);
      }
    }
    this.manifest = manifest;
    this.backingBuffer = this.backingEnabled ? backingBuffer : null;
    this.atlasBuffer = atlasBuffer;
    this.ready = true;
  }

  async load(manifest, fetcher = globalThis.fetch) {
    const urls = this.backingEnabled ? [manifest.backingUrl, manifest.atlasUrl] : [manifest.atlasUrl];
    const buffers = await Promise.all(urls.map(async url => {
      const response = await fetcher(url);
      if (!response.ok) throw new Error(`音轨加载失败：${url} (${response.status})`);
      return this.context.decodeAudioData(await response.arrayBuffer());
    }));
    this.setAssets(manifest, this.backingEnabled ? buffers[0] : null, buffers.at(-1));
  }

  attachVideo(video, { muted = false } = {}) {
    video.defaultMuted = muted;
    video.muted = muted;
    if (!muted) {
      if (this.videoSilence) this.videoSilence.gain.value = 1;
      return; // Native video owns the backing: no Web Audio routing or duplicate song.
    }
    if (this.videoSource) return;
    this.videoSource = this.context.createMediaElementSource(video);
    this.videoSilence = this.context.createGain();
    this.videoSilence.gain.value = 0;
    this.videoSource.connect(this.videoSilence);
    this.videoSilence.connect(this.master);
  }

  async unlock() {
    if (!this.ready) throw new Error('训练音轨尚未加载完成');
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.context.state !== 'running') throw new Error('音频设备未就绪，请再次点击开始');
  }

  playHit(result) {
    if (!this.ready || !this.hitsEnabled || this.hitVolume===0 || this.context.state !== 'running') return false;
    if (!['criticalPerfect', 'perfect', 'great', 'good'].includes(result?.rating)) return false;
    const cue = this.manifest.cues[result.note?.id];
    if (!cue) return false;
    const source = this.context.createBufferSource();
    source.buffer = this.atlasBuffer;
    const level = this.context.createGain();
    level.gain.value = Number.isFinite(cue.gain) ? Math.max(0, Math.min(1,cue.gain)) : 1;
    source.connect(level);
    level.connect(this.hitGain);
    this.voices.add(source);
    source.onended = () => { this.voices.delete(source); source.disconnect(); level.disconnect(); };
    // Respond to the actual press immediately. Do not quantize back to the scheduled chart time.
    source.start(this.context.currentTime, cue.offsetSeconds, cue.durationSeconds);
    return true;
  }

  sync(videoMs, playing, rate = 1) {
    if (!this.ready || !playing || !(rate > 0) || this.context.state !== 'running') {
      this.stop();
      return;
    }
    if (!this.backingEnabled || !this.backingBuffer) return;
    const desiredMs = Math.max(0, videoMs+(this.manifest.backingOffsetMs || 0));
    if (desiredMs >= this.backingBuffer.duration*1000) { this.stop(); return; }
    const expectedMs = this.backingSource ? this.backingPositionMs+(this.context.currentTime-this.backingStartedAt)*this.backingRate*1000 : NaN;
    if (this.backingSource && Math.abs(expectedMs-desiredMs) <= 45 && this.backingRate === rate) return;
    this.stopBacking();
    const source = this.context.createBufferSource();
    source.buffer = this.backingBuffer;
    source.playbackRate.value = rate;
    source.connect(this.backingGain);
    this.backingPositionMs = desiredMs;
    this.backingStartedAt = this.context.currentTime;
    this.backingRate = rate;
    this.backingSource = source;
    source.onended = () => {
      source.disconnect();
      if (this.backingSource === source) this.backingSource = null;
    };
    source.start(this.context.currentTime, desiredMs/1000);
  }

  stopBacking() {
    const source = this.backingSource;
    this.backingSource = null;
    if (source) {
      try { source.stop(); } catch (error) { if (error.name !== 'InvalidStateError') throw error; }
    }
  }

  stop() {
    this.stopBacking();
    for (const source of this.voices) {
      try { source.stop(); } catch (error) { if (error.name !== 'InvalidStateError') throw error; }
    }
    this.voices.clear();
  }

  async dispose() {
    this.stop();
    this.videoSource?.disconnect();
    this.videoSilence?.disconnect();
    this.master.disconnect();
    this.limiter.disconnect();
    if (this.context.state !== 'closed') await this.context.close();
  }
}
