/**
 * audioService — the only audio in the app is the potential-human-detection alert: a short
 * synthesized chime (WebAudio) followed by a spoken line (browser speechSynthesis, if present).
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function beep(ac: AudioContext, freq: number, start: number, dur: number, gain = 0.07) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, ac.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ac.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + start);
  o.stop(ac.currentTime + start + dur + 0.05);
}

function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.volume = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* speech is best-effort */
  }
}

/** Plays the detection chime, then speaks `text` (pass null for the chime only). */
export function playDetectionAlert(text: string | null) {
  const ac = audio();
  if (ac) {
    for (let k = 0; k < 2; k++) {
      beep(ac, 880, k * 0.3, 0.14);
      beep(ac, 660, k * 0.3 + 0.15, 0.14);
    }
  }
  if (text) setTimeout(() => speak(text), 650);
}
