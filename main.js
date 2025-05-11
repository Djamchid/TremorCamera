(function () {
  const SAMPLE_SECONDS = 10;
  const MIN_HZ = 1, MAX_HZ = 12, NODE_COUNT = 5;

  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const octx = overlay.getContext('2d');
  const statusP = document.getElementById('status');
  const startBtn = document.getElementById('startBtn');
  const exportBtn = document.getElementById('exportBtn');
  const restartBtn = document.getElementById('restartBtn');
  const resultsSec = document.getElementById('results');
  const chartsDiv = document.getElementById('charts');
  const summaryP = document.getElementById('summary');

  let recording = false, frames = [], timeStamps = [];

  // ---------- Camera ----------
  async function initCamera () {
    if (!location.protocol.startsWith('https') && location.hostname !== 'localhost') {
      statusP.textContent = '⚠️ HTTPS requis pour la caméra';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        drawGuide();
      };
      video.oncanplay = () => {
        statusP.textContent = 'Prêt !';
        startBtn.disabled = false;
      };
    } catch (err) {
      statusP.textContent = 'Erreur caméra : ' + err.message;
    }
  }

  // ---------- Overlay ----------
  function drawGuide () {
    const { width, height } = overlay;
    octx.clearRect(0, 0, width, height);
    octx.strokeStyle = '#0c0';
    octx.lineWidth = 4;
    octx.beginPath();
    octx.arc(width / 2, height / 2, Math.min(width, height) * 0.45, 0, 2 * Math.PI);
    octx.stroke();
  }

  function sampleNodes () {
    const { width, height } = overlay;
    const r = Math.min(width, height) * 0.35;
    return [...Array(NODE_COUNT).keys()].map(i => {
      const a = (i * 360 / NODE_COUNT) * Math.PI / 180;
      return [width / 2 + r * Math.cos(a), height / 2 + r * Math.sin(a)];
    });
  }

  // ---------- Capture ----------
  function startRecording () {
    frames = Array.from({ length: NODE_COUNT }, () => []);
    timeStamps = [];
    recording = true;
    statusP.textContent = 'Enregistrement…';
    const off = document.createElement('canvas');
    off.width = video.videoWidth; off.height = video.videoHeight;
    const ictx = off.getContext('2d', { willReadFrequently: true });
    const t0 = performance.now();

    (function loop () {
      if (!recording) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= SAMPLE_SECONDS) {
        recording = false;
        statusP.textContent = 'Analyse…';
        analyse();
        return;
      }
      ictx.drawImage(video, 0, 0);
      const nodes = sampleNodes();
      const ts = Date.now();
      nodes.forEach((pt, idx) => {
        const [x, y] = pt.map(Math.floor);
        const d = ictx.getImageData(x, y, 1, 1).data;
        const lum = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
        frames[idx].push(lum);
      });
      timeStamps.push(ts);
      requestAnimationFrame(loop);
    })();
  }

  // ---------- FFT helpers ----------
  function simpleFFT (buffer) {
    // Cooley‑Tukey radix‑2, recursive (for educational purposes, N must be power‑of‑2)
    const N = buffer.length;
    if (N <= 1) return [buffer];
    const even = simpleFFT(buffer.filter((_, i) => !(i & 1))).map(x => ({ re: x[0], im: x[1] }));
    const odd  = simpleFFT(buffer.filter((_, i) => i & 1)).map(x => ({ re: x[0], im: x[1] }));
    const T = [];
    for (let k = 0; k < N / 2; k++) {
      const exp = -2 * Math.PI * k / N;
      const cos = Math.cos(exp), sin = Math.sin(exp);
      const tref = odd[k];
      T.push({ re: cos * tref.re - sin * tref.im, im: cos * tref.im + sin * tref.re });
    }
    const out = Array(N);
    for (let k = 0; k < N / 2; k++) {
      const e = even[k]; const t = T[k];
      out[k] = { re: e.re + t.re, im: e.im + t.im };
      out[k + N / 2] = { re: e.re - t.re, im: e.im - t.im };
    }
    return out;
  }

  function magnitudeSpectrum (buffer) {
    const N = buffer.length;
    // Convert real‑valued buffer -> complex pairs [re, im]
    const complex = buffer.map(v => [v, 0]);
    const fftOut = simpleFFT(complex);
    return fftOut.slice(0, N / 2).map(c => Math.sqrt(c.re * c.re + c.im * c.im) / N);
  }

  // ---------- Analyse ----------
  function analyse () {
    const duration = (timeStamps.at(-1) - timeStamps[0]) / 1000;
    const fs = frames[0].length / duration;

    const freqPeaks = [], ampPeaks = [];
    chartsDiv.innerHTML = '';

    frames.forEach((series, idx) => {
      const n = 1 << Math.floor(Math.log2(series.length));
      const windowed = series.slice(-n);
      const spectrum = magnitudeSpectrum(windowed);
      const hzPerBin = fs / n;

      const points = spectrum.map((mag, i) => ({ h: i * hzPerBin, m: mag }))
        .filter(p => p.h >= MIN_HZ && p.h <= MAX_HZ);
      const peak = points.reduce((a, b) => (b.m > a.m ? b : a), { h: 0, m: 0 });
      freqPeaks.push(peak.h.toFixed(2));
      ampPeaks.push(peak.m.toFixed(4));

      drawChart(idx + 1, points.map(p => p.h), points.map(p => p.m));
    });

    summaryP.textContent = `Dominantes : ${freqPeaks.join(' Hz, ')} Hz`;
    resultsSec.hidden = false;
    exportBtn.onclick = () => exportCSV(freqPeaks, ampPeaks);
    statusP.textContent = 'Analyse terminée';
  }

  // ---------- Chart / CSV ----------
  function drawChart (idx, labels, mags) {
    const c = document.createElement('canvas');
    c.className = 'chart';
    chartsDiv.appendChild(c);
    new Chart(c, { type: 'line', data: { labels, datasets: [{ label: `Nœud ${idx}`, data: mags, fill: false }] }, options: { scales: { x: { title: { display: true, text: 'Hz' } }, y: { beginAtZero: true } }, plugins: { legend: { display: false } } } });
  }

  function exportCSV (freqs, amps) {
    const ts = new Date().toISOString();
    const lines = freqs.map((f, i) => `${ts},${f},${amps[i]}`);
    const csv = 'timestamp,frequency,amplitude\\n' + lines.join('\\n') + '\\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `tremor_${ts}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- UI ----------
  startBtn.addEventListener('click', () => {
    startBtn.disabled = true; resultsSec.hidden = true; startRecording();
  });
  restartBtn.addEventListener('click', () => {
    startBtn.disabled = false; resultsSec.hidden = true; statusP.textContent = 'Prêt !';
  });

  initCamera();
})();
