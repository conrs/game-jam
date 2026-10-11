// Sound effects synthesized with WebAudio: no audio files.
// The AudioContext can only start after a user gesture, so call unlock() from input.

let ac = null;
let master = null;
let muted = false;
const VOLUME = 0.5;

try {
  muted = JSON.parse(localStorage.getItem('settings') || '{}').muted === true;
} catch {
  // Storage blocked: default to sound on.
}

export function unlock() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume();
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : VOLUME;
  try {
    localStorage.setItem('settings', JSON.stringify({ muted }));
  } catch {
    // Not persisted; fine.
  }
  return muted;
}

function tone(freq, dur, { type = 'triangle', vol = 0.1, to = null, at = 0 } = {}) {
  if (!ac) return;
  const t0 = ac.currentTime + at;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, { vol = 0.3, freq = 800, type = 'lowpass', at = 0, attack = 0 } = {}) {
  if (!ac) return;
  const t0 = ac.currentTime + at;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(attack ? 0.001 : vol, t0);
  if (attack) g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

function melody(notes, step, opts) {
  notes.forEach((n, i) => n && tone(n, step * 0.9, { ...opts, at: i * step }));
}

// Fire catching: a crackly burst with a little rising whoomp.
export function light() {
  noise(0.4, { vol: 0.35, freq: 2500, type: 'bandpass' });
  noise(0.08, { vol: 0.3, freq: 4000, type: 'highpass', at: 0.1 });
  noise(0.08, { vol: 0.25, freq: 4000, type: 'highpass', at: 0.22 });
  tone(90, 0.3, { to: 180, type: 'sine', vol: 0.25 });
}

export const noLogs = () => tone(140, 0.15, { type: 'square', vol: 0.06 });
export const rescue = () => tone(880, 0.12, { to: 1320, vol: 0.05 });
export const land = () => noise(0.06, { vol: 0.05, freq: 1500 });
export const log = () => melody([523, 784], 0.05, { vol: 0.04 });
export const start = () => melody([392, 494, 587, 784], 0.1, { vol: 0.08 });

export function gust() {
  noise(1.8, { vol: 0.18, freq: 500, type: 'bandpass', attack: 0.6 });
}

export function snow() {
  noise(2.5, { vol: 0.25, freq: 300, type: 'lowpass', attack: 0.8 });
  melody([392, 330, 294, 196], 0.35, { vol: 0.08, type: 'sine' });
}
