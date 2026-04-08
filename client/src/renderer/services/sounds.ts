const ctx = () => new (window.AudioContext || (window as any).webkitAudioContext)();

function playTone(freq: number, duration: number, type: OscillatorType = "sine", gain = 0.3) {
  const ac = ctx();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g);
  g.connect(ac.destination);
  osc.start();
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.stop(ac.currentTime + duration);
}

// Notification ping — short pleasant chime
export function playMessageSound() {
  const ac = ctx();
  const notes = [880, 1100];
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    g.gain.value = 0.15;
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(ac.currentTime + i * 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * 0.1 + 0.2);
    osc.stop(ac.currentTime + i * 0.1 + 0.2);
  });
}

// Rock guitar-style call ring — distorted power chord riff
export function playCallRing() {
  const ac = ctx();
  const dist = ac.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = ((Math.PI + 50) * x) / (Math.PI + 50 * Math.abs(x));
  }
  dist.curve = curve;
  dist.oversample = "4x";

  const masterGain = ac.createGain();
  masterGain.gain.value = 0.25;
  dist.connect(masterGain);
  masterGain.connect(ac.destination);

  // Power chord notes: E5, B4, E4 pattern
  const riff = [
    { freq: 164.81, start: 0, dur: 0.15 },     // E3
    { freq: 246.94, start: 0, dur: 0.15 },      // B3
    { freq: 329.63, start: 0, dur: 0.15 },      // E4
    { freq: 0, start: 0.15, dur: 0.05 },        // pause
    { freq: 196.00, start: 0.2, dur: 0.15 },    // G3
    { freq: 293.66, start: 0.2, dur: 0.15 },    // D4
    { freq: 392.00, start: 0.2, dur: 0.15 },    // G4
    { freq: 0, start: 0.35, dur: 0.05 },        // pause
    { freq: 220.00, start: 0.4, dur: 0.3 },     // A3
    { freq: 329.63, start: 0.4, dur: 0.3 },     // E4
    { freq: 440.00, start: 0.4, dur: 0.3 },     // A4
  ];

  riff.forEach(({ freq, start, dur }) => {
    if (freq === 0) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    g.gain.value = 0.4;
    osc.connect(g);
    g.connect(dist);
    osc.start(ac.currentTime + start);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + start + dur);
    osc.stop(ac.currentTime + start + dur + 0.05);
  });
}

// Call end — descending tone
export function playCallEndSound() {
  const ac = ctx();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "square";
  osc.frequency.value = 440;
  osc.frequency.exponentialRampToValueAtTime(110, ac.currentTime + 0.4);
  g.gain.value = 0.15;
  osc.connect(g);
  g.connect(ac.destination);
  osc.start();
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
  osc.stop(ac.currentTime + 0.5);
}
