// Sound effects synthesized with WebAudio; music looped from assets/ (credits in README).
// The AudioContext can only start after a user gesture, so call unlock() from input.

let ac = null;
let master = null;
let musicBus = null; // music and sound effects each have a player-set level into master
let sfxBus = null;
const SETTINGS_KEY = 'game-jam:settings'; // namespaced: itch.io shares one origin across games
const VOLUME = 0.5;
const settings = { muted: false, music: 1, sfx: 1 }; // levels 0..1

// Music tracks by name.
const TRACKS = {
  menu: 'assets/menu.mp3',
  game: 'assets/game.mp3',
};
const MUSIC_VOLUME = 0.3; // under the sound effects (playtest: music sat a touch loud)
const FADE = 1.2; // seconds
const playing = {};
let wanted = null;

// Download now; decoding needs the AudioContext, which waits for a gesture.
const bytes = Object.fromEntries(
  Object.entries(TRACKS).map(([name, url]) => [name, fetch(url).then((r) => r.arrayBuffer())]),
);

try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  settings.muted = saved.muted === true;
  for (const k of ['music', 'sfx']) if (typeof saved[k] === 'number') settings[k] = Math.min(1, Math.max(0, saved[k]));
} catch {
  // Storage blocked: default to sound on, full levels.
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not persisted; fine.
  }
}

export function unlock() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = settings.muted ? 0 : VOLUME;
    master.connect(ac.destination);
    musicBus = ac.createGain();
    musicBus.gain.value = settings.music;
    musicBus.connect(master);
    sfxBus = ac.createGain();
    sfxBus.gain.value = settings.sfx;
    sfxBus.connect(master);
    Object.keys(TRACKS).forEach(track);
    music(wanted);
  }
  if (ac.state === 'suspended') ac.resume();
}

// Tracks are decoded into memory and looped by WebAudio: <audio loop> leaves a gap at
// the loop point in most browsers. Each plays through its own gain into the music bus,
// so the music level and mute cover it.
function track(name) {
  if (!playing[name]) {
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(musicBus);
    const buffer = bytes[name].then((b) => ac.decodeAudioData(b));
    buffer.catch(() => {}); // a missing track just stays silent
    playing[name] = { gain, buffer, source: null };
  }
  return playing[name];
}

async function startLoop(name) {
  const tr = playing[name];
  const buffer = await tr.buffer;
  if (wanted !== name || tr.source) return; // moved on, or already playing
  tr.source = ac.createBufferSource();
  tr.source.buffer = buffer;
  tr.source.loop = true;
  tr.source.connect(tr.gain);
  tr.source.start();
}

function stopLoop(tr) {
  tr.source?.stop();
  tr.source = null;
}

function fadeTo(gain, value) {
  const t = ac.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(value, t + FADE);
}

// Crossfade to a track by name; a name with no track (or null) fades to silence.
export function music(name) {
  wanted = TRACKS[name] ? name : null;
  if (!ac) return; // unlock() starts it
  for (const [n, tr] of Object.entries(playing)) {
    if (n === wanted) continue;
    fadeTo(tr.gain, 0);
    setTimeout(() => n !== wanted && stopLoop(tr), FADE * 1000);
  }
  if (!wanted) return;
  const tr = track(wanted);
  startLoop(wanted).catch(() => {});
  fadeTo(tr.gain, MUSIC_VOLUME);
}

// The pause menu: the current track drops under, then comes back up on resume.
export function duck(on) {
  if (!ac || !wanted) return;
  fadeTo(playing[wanted].gain, MUSIC_VOLUME * (on ? 0.4 : 1));
}

// Betacade pauses the game: freeze all audio where it is.
export function pauseMusic(paused) {
  if (!ac) return;
  if (paused) ac.suspend();
  else ac.resume();
}

export function isMuted() {
  return settings.muted;
}

export function toggleMute() {
  settings.muted = !settings.muted;
  if (master) master.gain.value = settings.muted ? 0 : VOLUME;
  persistSettings();
  return settings.muted;
}

// Player-set levels, 0..1: 'music' or 'sfx'.
export function getLevel(kind) {
  return settings[kind];
}

export function setLevel(kind, value) {
  settings[kind] = Math.min(1, Math.max(0, value));
  const bus = kind === 'music' ? musicBus : sfxBus;
  if (bus) bus.gain.value = settings[kind];
  persistSettings();
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
  o.connect(g).connect(sfxBus);
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
  src.connect(f).connect(g).connect(sfxBus);
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
