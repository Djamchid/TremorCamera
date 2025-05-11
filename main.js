/* global FFT */
(function () {
  const SAMPLE_SECONDS = 10;
  const MAX_HZ = 12;
  const MIN_HZ = 1;
  const NODE_COUNT = 5;
  const SAMPLE_RATE = 30; // fps (target)

  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const ctx = overlay.getContext('2d');
  const startBtn = document.getElementById('startBtn');
  const exportBtn = document.getElementById('exportBtn');
  const restartBtn = document.getElementById('restartBtn');
  const resultsSection = document.getElementById('results');
  const chartsDiv = document.getElementById('charts');
  const summaryP = document.getElementById('summary');

  let mediaStream = null;
  let recording = false;
  let frameData = Array.from({ length: NODE_COUNT }, () => []);
  let timeStamps = [];
  let charts = [];

  async function initCamera () {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      video.srcObject = mediaStream;
      video.addEventListener('loadedmetadata', () => {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        drawGuide();
      });
    } catch (err) {
      alert('Impossible d\'accéder à la caméra : ' + err.message);
    }
  }

  function drawGuide () {
    const { width, height } = overlay;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#00cc00';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.45, 0, Math.PI * 2);
    ctx.stroke();
  }

  // --- Placeholder hand‑tracking: sample 5 static points in the circle ---
  function sampleNodes () {
    const { width, height } = overlay;
    const radius = Math.min(width, height) * 0.35;
    const angles = [0, 72, 144, 216, 288].map(a => (a * Math.PI) / 180);
    return angles.map(angle => [width / 2 + radius * Math.cos(angle), height / 2 + radius * Math.sin(angle)]);
  }

  function startRecording () {
    recording = true;
    frameData = Array.from({ length: NODE_COUNT }, () => []);
    timeStamps = [];
    const startTime = performance.now();

    function step () {
      if (!recording) return;
      const now = performance.now();
      const t = (now - startTime) / 1000; // seconds
      if (t >= SAMPLE_SECONDS) {
        recording = false;
        processData();
        return;
      }

      captureFrame();
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Capture luminance at each node (simple proxy for vertical motion)
  function captureFrame () {
    const nodes = sampleNodes();
    const vWidth = video.videoWidth;
    const vHeight = video.videoHeight;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = vWidth;
    tempCanvas.height = vHeight;
    const tctx = tempCanvas.getContext('2d');
    tctx.drawImage(video, 0, 0, vWidth, vHeight);

    const timestamp = Date.now();
    nodes.forEach((pt, idx) => {
      const [x, y] = pt;
      const data = tctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      const lum = 0.2126 * data[0] + 0.7152 * data[1] + 0.0722 * data[2];
      frameData[idx].push(lum);
    });
    timeStamps.push(timestamp);
  }

  function processData () {
    // Compute sampling frequency from actual timestamps
    const dt = (timeStamps[timeStamps.length - 1] - timeStamps[0]) / 1000; // secs
    const fs = frameData[0].length / dt;
    const freqs = [];
    const amps = [];

    chartsDiv.innerHTML = '';
    charts = [];

    frameData.forEach((series, idx) => {
      const bufferSize = 1 << Math.floor(Math.log2(series.length));
      const fft = new FFT(bufferSize, fs);
      const padded = series.slice(-bufferSize); // take last power‑of‑2 samples
      fft.forward(padded);
      const spectrum = fft.spectrum; // magnitude normalized [0,1]
      // Build frequency axis (half spectrum)
      const hzPerBin = fs / bufferSize;
      const labels = spectrum.map((_, i) => i * hzPerBin);

      // Keep only 1‑12 Hz range
      const filtered = labels.reduce((acc, f, i) => {
        if (f >= MIN_HZ && f <= MAX_HZ) acc.push({ f, mag: spectrum[i] });
        return acc;
      }, []);

      const peak = filtered.reduce((best, p) => (p.mag > best.mag ? p : best), { f: 0, mag: 0 });
      freqs.push(peak.f.toFixed(2));
      amps.push(peak.mag.toFixed(4));

      drawChart(idx + 1, filtered.map(p => p.f), filtered.map(p => p.mag));
    });

    summaryP.textContent = `Fréquences dominantes (Hz) : ${freqs.join(', ')} | Amplitudes : ${amps.join(', ')}`;
    resultsSection.hidden = false;
    exportBtn.onclick = () => exportCSV(freqs, amps);
  }

  function drawChart (nodeIdx, labels, mags) {
    const c = document.createElement('canvas');
    c.className = 'chart';
    chartsDiv.appendChild(c);
    const ctxChart = c.getContext('2d');
    charts.push(new Chart(ctxChart, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `Noeud ${nodeIdx}`,
          data: mags,
          fill: false,
        }]
      },
      options: {
        scales: {
          x: { title: { display: true, text: 'Hz' } },
          y: { title: { display: true, text: 'Magnitude (norm.)' }, beginAtZero: true }
        },
        plugins: { legend: { display: false } },
        responsive: true,
      }
    }));
  }

  function exportCSV (frequencies, amplitudes) {
    const ts = new Date().toISOString();
    const csv = `timestamp,frequency,amplitude\n${frequencies.map((f, i) => `${ts},${f},${amplitudes[i]}`).join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tremor_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  startBtn.addEventListener('click', () => {
    resultsSection.hidden = true;
    startBtn.disabled = true;
    drawGuide();
    startRecording();
  });

  restartBtn.addEventListener('click', () => {
    startBtn.disabled = false;
    resultsSection.hidden = true;
  });

  initCamera();
})();
