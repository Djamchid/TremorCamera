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

  let recording = false, frames = [], timeStamps = [], charts = [];
  let offCanvas, offCtx;

  // --- 1. Init Camera
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
        offCanvas = document.createElement('canvas');
        offCanvas.width = video.videoWidth;
        offCanvas.height = video.videoHeight;
        // Le contexte d’étude lit souvent les pixels ; on signale l’usage intensif :
        offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
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

  // --- 2. Guide overlay
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
      const angle = (i * 360 / NODE_COUNT) * Math.PI / 180;
      return [width / 2 + r * Math.cos(angle), height / 2 + r * Math.sin(angle)];
    });
  }

  // --- 3. Recording loop
  function startRecording () {
    frames = Array.from({ length: NODE_COUNT }, () => []);
    timeStamps = [];
    recording = true;
    statusP.textContent = 'Enregistrement…';
    const t0 = performance.now();

    const loop = () => {
      if (!recording) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= SAMPLE_SECONDS) {
        recording = false;
        statusP.textContent = 'Analyse…';
        analyse();
        return;
      }
      captureFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  function captureFrame () {
    offCtx.drawImage(video, 0, 0, offCanvas.width, offCanvas.height);
    const nodes = sampleNodes();
    const ts = Date.now();
    nodes.forEach((pt, idx) => {
      const [x, y] = pt.map(Math.floor);
      const { data } = offCtx.getImageData(x, y, 1, 1);
      const lum = 0.2126 * data[0] + 0.7152 * data[1] + 0.0722 * data[2];
      frames[idx].push(lum);
    });
    timeStamps.push(ts);
  }

  // --- 4. Analyse FFT
  function analyse () {
    // Résolution temporelle réelle
    const duration = (timeStamps.at(-1) - timeStamps[0]) / 1000;
    const fs = frames[0].length / duration;
    const FFTCtor = typeof FFT !== 'undefined' ? FFT : (typeof DSP !== 'undefined' && DSP.FFT ? DSP.FFT : null);
    if (!FFTCtor) {
      alert('Librairie FFT non trouvée');
      return;
    }

    chartsDiv.innerHTML = '';
    const freqPeaks = [], ampPeaks = [];

    frames.forEach((series, idx) => {
      const n = 1 << Math.floor(Math.log2(series.length));
      const fft = new FFTCtor(n, fs);
      fft.forward(series.slice(-n));
      const spec = fft.spectrum; // half‑spectrum, length n/2
      const hzPerBin = fs / n;
      const hz = spec.map((_, i) => i * hzPerBin);

      const points = hz.map((h, i) => ({ h, m: spec[i] }))
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

  function drawChart (idx, labels, mags) {
    const c = document.createElement('canvas');
    c.className = 'chart';
    chartsDiv.appendChild(c);
    new Chart(c, {
      type: 'line',
      data: { labels, datasets: [{ label: `Nœud ${idx}`, data: mags, fill: false }] },
      options: { scales: { x: { title: { display: true, text: 'Hz' } }, y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
    });
  }

  // --- 5. Export CSV
  function exportCSV (freqs, amps) {
    const ts = new Date().toISOString();
    const lines = freqs.map((f, i) => `${ts},${f},${amps[i]}`);
    const csv = 'timestamp,frequency,amplitude\n' + lines.join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `tremor_${ts}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // --- 6. UI events
  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    resultsSec.hidden = true;
    startRecording();
  });

  restartBtn.addEventListener('click', () => {
    startBtn.disabled = false;
    resultsSec.hidden = true;
    statusP.textContent = 'Prêt !';
  });

  initCamera();
})();
