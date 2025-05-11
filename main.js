(function () {
  // === Paramètres généraux ===
  const SAMPLE_SECONDS = 10;       // durée d’acquisition
  const NODE_COUNT     = 12;       // tous les nœuds (12 points régulièrement espacés)
  const MA_WINDOW      = 5;        // K = 5 frames pour moyenne glissante
  const MIN_HZ = 1, MAX_HZ = 12;   // bande d’intérêt

  // === Sélecteurs DOM ===
  const video       = document.getElementById('video');
  const overlay     = document.getElementById('overlay');
  const octx        = overlay.getContext('2d');
  const statusP     = document.getElementById('status');
  const startBtn    = document.getElementById('startBtn');
  const exportBtn   = document.getElementById('exportBtn');
  const restartBtn  = document.getElementById('restartBtn');
  const resultsSec  = document.getElementById('results');
  const chartsDiv   = document.getElementById('charts');
  const summaryP    = document.getElementById('summary');

  // === Buffers ===
  let recording = false;
  let v2Series  = [];     // [[v²_t] pour chaque nœud]
  let timeStamps = [];
  let lastPos    = Array(NODE_COUNT).fill(null);

  // ---------- 1. Caméra ----------
  async function initCamera () {
    if (!location.protocol.startsWith('https') && location.hostname !== 'localhost') {
      statusP.textContent = '⚠️ HTTPS requis';
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
    } catch (e) {
      statusP.textContent = 'Erreur caméra : ' + e.message;
    }
  }

  // ---------- 2. Aide visuelle ----------
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

  // ---------- 3. Enregistrement ----------
  function startRecording () {
    v2Series  = Array.from({ length: NODE_COUNT }, () => []);
    lastPos   = Array(NODE_COUNT).fill(null);
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
      const now = Date.now();
      nodes.forEach((pt, idx) => {
        const pos = { x: pt[0], y: pt[1] };
        if (lastPos[idx]) {
          const dx = pos.x - lastPos[idx].x;
          const dy = pos.y - lastPos[idx].y;
          const v2 = dx * dx + dy * dy;            // carré de la norme  ||Δp||²
          v2Series[idx].push(v2);
        }
        lastPos[idx] = pos;
      });
      timeStamps.push(now);
      requestAnimationFrame(loop);
    })();
  }

  // ---------- 4. Pré‑traitement (dédrift & Welch) ----------
  function detrend (arr) {
    const out = new Float32Array(arr.length);
    for (let t = 0; t < arr.length; t++) {
      const start = Math.max(0, t - MA_WINDOW + 1);
      let mean = 0;
      for (let k = start; k <= t; k++) mean += arr[k];
      mean /= (t - start + 1);
      out[t] = arr[t] - mean;
    }
    return out;
  }

  function welchPSD (series, fs) {
    const N = series.length;
    const segLen = Math.min(256, 1 << Math.floor(Math.log2(N)));
    if (segLen < 32) return { freqs: [], psd: [] }; // trop court
    const step = segLen / 2;
    const fft = new FFT(segLen);
    const hann = Float32Array.from({ length: segLen }, (_, n) => 0.5 * (1 - Math.cos(2 * Math.PI * n / (segLen - 1))));

    const psdAccu = new Float32Array(segLen / 2).fill(0);
    let segments = 0;

    for (let start = 0; start + segLen <= N; start += step) {
      const re = new Float32Array(segLen);
      const im = new Float32Array(segLen);
      for (let n = 0; n < segLen; n++) re[n] = series[start + n] * hann[n];
      fft.transform(re, im);
      for (let k = 0; k < segLen / 2; k++) {
        const mag2 = (re[k] * re[k] + im[k] * im[k]) / segLen;
        psdAccu[k] += mag2;
      }
      segments++;
    }
    const psd = Array.from(psdAccu, v => v / segments);
    const hzPerBin = fs / segLen;
    const freqs = psd.map((_, k) => k * hzPerBin);
    return { freqs, psd };
  }

  // ---------- 5. Analyse ----------
  function analyse () {
    // fréquence d’échantillonnage réelle (v² est calculé frame‑à‑frame)
    const duration = (timeStamps.at(-1) - timeStamps[0]) / 1000;
    const fs = v2Series[0].length / duration;

    chartsDiv.innerHTML = '';
    const peakFreqs = [], peakAmps = [];

    v2Series.forEach((raw, idx) => {
      if (raw.length < 32) return; // série trop courte
      const cleaned = detrend(raw);
      const { freqs, psd } = welchPSD(cleaned, fs);

      // filtrage bande 1‑12 Hz
      const inBand = freqs.map((f, i) => ({ f, m: psd[i] }))
                         .filter(p => p.f >= MIN_HZ && p.f <= MAX_HZ);
      const peak = inBand.reduce((a, b) => (b.m > a.m ? b : a), { f: 0, m: 0 });
      peakFreqs.push(peak.f.toFixed(2));
      peakAmps.push(peak.m.toFixed(4));

      drawChart(idx + 1, inBand.map(p => p.f), inBand.map(p => p.m));
    });

    summaryP.textContent = `Dominantes : ${peakFreqs.join(' Hz, ')} Hz`;
    resultsSec.hidden = false;
    exportBtn.onclick = () => exportCSV(peakFreqs, peakAmps);
    statusP.textContent = 'Analyse terminée';
  }

  // ---------- 6. Visualization / Export ----------
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

  function exportCSV (freqs, amps) {
    const ts = new Date().toISOString();
    const lines = freqs.map((f, i) => `${ts},${f},${amps[i]}`);
    const csv = 'timestamp,frequency,amplitude\n' + lines.join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `tremor_${ts}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- 7. UI ----------
  startBtn.addEventListener('click', () => {
    startBtn.disabled = true; resultsSec.hidden = true; startRecording();
  });
  restartBtn.addEventListener('click', () => {
    startBtn.disabled = false; resultsSec.hidden = true; statusP.textContent = 'Prêt !';
  });

  initCamera();
})();
