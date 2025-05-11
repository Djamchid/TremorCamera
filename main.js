(function () {
  console.log("=== Démarrage de l'application ===");
  
  // === Paramètres généraux ===
  const SAMPLE_SECONDS = 10;       // durée d'acquisition
  const NODE_COUNT     = 21;       // utilisons les 21 points de MediaPipe pour une meilleure précision
  const MA_WINDOW      = 5;        // K = 5 frames pour moyenne glissante
  const MIN_HZ = 1, MAX_HZ = 12;   // bande d'intérêt

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
  let waitingForHand = false;
  let v2Series  = [];
  let timeStamps = [];
  let lastPos    = Array(NODE_COUNT).fill(null);
  let currentLandmarks = null;
  let camera = null;
  let handDetected = false;

  // Définition manuelle de HAND_CONNECTIONS si elle n'existe pas
  if (typeof HAND_CONNECTIONS === 'undefined') {
    console.log("Définition manuelle de HAND_CONNECTIONS");
    window.HAND_CONNECTIONS = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12],
      [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20],
      [5, 9], [9, 13], [13, 17], [0, 5], [0, 17]
    ];
  }
  
  // Vérifier que les bibliothèques sont chargées
  function checkLibraries() {
    console.log("Vérification des bibliothèques...");
    
    if (typeof Hands === 'undefined') {
      console.error("MediaPipe Hands n'est pas chargé");
      statusP.textContent = "Erreur: MediaPipe Hands non chargé. Actualisez la page ou vérifiez la console.";
      return false;
    }
    
    if (typeof Camera === 'undefined') {
      console.error("MediaPipe Camera n'est pas chargé");
      statusP.textContent = "Erreur: MediaPipe Camera non chargé. Actualisez la page ou vérifiez la console.";
      return false;
    }
    
    if (typeof drawConnectors === 'undefined') {
      console.error("MediaPipe Drawing Utils n'est pas chargé");
      statusP.textContent = "Erreur: MediaPipe Drawing Utils non chargé. Actualisez la page ou vérifiez la console.";
      return false;
    }
    
    console.log("Toutes les bibliothèques sont chargées correctement");
    return true;
  }

  // === Configuration MediaPipe Hands ===
  let hands;
  
  // ---------- 1. Caméra et MediaPipe ----------
  async function initCamera() {
    console.log("initCamera() appelé");
    if (!location.protocol.startsWith('https') && location.hostname !== 'localhost') {
      statusP.textContent = '⚠️ HTTPS requis pour accéder à la caméra';
      return;
    }

    try {
      // Vérifier que les bibliothèques sont chargées
      if (!checkLibraries()) {
        return;
      }

      console.log("Création de l'objet Hands...");
      hands = new Hands({
        locateFile: (file) => {
          console.log(`Demande du fichier: ${file}`);
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });
      
      console.log("Configuration des options Hands...");
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      console.log("Définition du callback onResults...");
      hands.onResults((results) => {
        try {
          onHandResults(results);
        } catch (e) {
          console.error("Erreur dans onHandResults:", e);
        }
      });

      // Initialiser la caméra
      console.log("Création de l'objet Camera...");
      camera = new Camera(video, {
        onFrame: async () => {
          try {
            if (hands) await hands.send({image: video});
          } catch (e) {
            console.error("Erreur pendant hands.send:", e);
          }
        },
        width: 640,
        height: 480
      });

      console.log("Configuration des événements vidéo...");
      video.onloadedmetadata = () => {
        console.log("Vidéo chargée, dimensions:", video.videoWidth, "x", video.videoHeight);
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        drawGuide();
      };

      console.log("Démarrage de la caméra...");
      try {
        await camera.start();
        console.log("Caméra démarrée avec succès");
        statusP.textContent = 'Placez votre main dans le cercle et restez immobile';
        startBtn.disabled = false;
      } catch (e) {
        console.error("Erreur lors du démarrage de la caméra:", e);
        statusP.textContent = 'Erreur démarrage caméra: ' + e.message;
      }
    } catch (e) {
      console.error('Erreur générale dans initCamera:', e);
      statusP.textContent = 'Erreur caméra : ' + e.message;
    }
  }

  // Traitement des résultats de détection de main
  function onHandResults(results) {
    // Effacer le canvas
    octx.clearRect(0, 0, overlay.width, overlay.height);
    
    // Dessiner le guide
    drawGuide();
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      // Stocker les landmarks pour le traitement pendant l'enregistrement
      currentLandmarks = results.multiHandLandmarks[0];
      handDetected = true;
      
      try {
        // Dessiner la main détectée (version standard)
        drawConnectors(octx, currentLandmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
        
        // Dessiner les nœuds avec une visualisation personnalisée
        // Points clés (ceux qui sont analysés) en surbrillance
        const keyPoints = [0, 4, 5, 8, 9, 12, 13, 16, 17, 20];
        
        currentLandmarks.forEach((landmark, idx) => {
          const x = landmark.x * overlay.width;
          const y = landmark.y * overlay.height;
          
          if (keyPoints.includes(idx)) {
            // Nœuds clés avec étiquette
            let nodeName = "";
            if (idx === 0) nodeName = "Poignet";
            else if (idx === 4) nodeName = "Pouce";
            else if (idx === 8) nodeName = "Index";
            else if (idx === 12) nodeName = "Majeur";
            else if (idx === 16) nodeName = "Annulaire";
            else if (idx === 20) nodeName = "Auriculaire";
            else if (idx === 5) nodeName = "Base I";
            else if (idx === 9) nodeName = "Base M";
            else if (idx === 13) nodeName = "Base A";
            else if (idx === 17) nodeName = "Base Au";
            
            // Cercle extérieur de mise en évidence
            octx.beginPath();
            octx.arc(x, y, 12, 0, 2 * Math.PI);
            octx.fillStyle = 'rgba(255, 100, 0, 0.3)';
            octx.fill();
            
            // Point central
            octx.beginPath();
            octx.arc(x, y, 6, 0, 2 * Math.PI);
            octx.fillStyle = 'rgba(255, 50, 0, 0.8)';
            octx.fill();
            
            // Étiquette du nœud
            if (nodeName) {
              octx.font = '12px Arial';
              octx.fillStyle = 'white';
              octx.textAlign = 'center';
              octx.strokeStyle = 'black';
              octx.lineWidth = 3;
              octx.strokeText(nodeName, x, y - 15);
              octx.fillText(nodeName, x, y - 15);
            }
            
            // Numéro du point pour référence (optionnel)
            octx.font = '10px Arial';
            octx.fillStyle = 'white';
            octx.textAlign = 'center';
            octx.fillText(idx.toString(), x, y + 4);
          } else {
            // Autres nœuds (non analysés)
            octx.beginPath();
            octx.arc(x, y, 3, 0, 2 * Math.PI);
            octx.fillStyle = 'rgba(0, 255, 0, 0.5)';
            octx.fill();
          }
        });
      } catch (e) {
        console.error("Erreur lors du dessin de la main:", e);
      }
      
      // Si nous sommes en attente d'une main, commencer l'enregistrement
      if (waitingForHand && !recording) {
        console.log("Main détectée, démarrage de l'enregistrement");
        waitingForHand = false;
        startRecording();
      }
      // Si l'enregistrement est en cours, traiter les données
      else if (recording) {
        processHandData();
      }
    } else {
      // Main non détectée
      currentLandmarks = null;
      handDetected = false;
      
      // Si nous étions en train d'enregistrer et que la main disparaît
      if (recording) {
        statusP.textContent = 'Main non détectée! Replacez votre main dans le cercle';
      }
      // Si nous attendons une main
      else if (waitingForHand) {
        statusP.textContent = 'En attente de la détection d\'une main...';
      }
    }
  }

  // Traiter les données de la main pour l'analyse des tremblements
  function processHandData() {
    if (!currentLandmarks) return;
    
    const now = Date.now();
    
    // Si c'est le premier frame, initialiser le temps de départ
    if (timeStamps.length === 0) {
      console.log("Premier frame d'enregistrement capturé");
    }
    
    currentLandmarks.forEach((landmark, idx) => {
      // Convertir les coordonnées normalisées [0-1] en pixels
      const pos = {
        x: landmark.x * overlay.width,
        y: landmark.y * overlay.height
      };
      
      if (lastPos[idx]) {
        const dx = pos.x - lastPos[idx].x;
        const dy = pos.y - lastPos[idx].y;
        const v2 = dx * dx + dy * dy;  // carré de la norme ||Δp||²
        
        // S'assurer que le tableau existe pour ce nœud
        if (!v2Series[idx]) v2Series[idx] = [];
        
        v2Series[idx].push(v2);
      }
      
      lastPos[idx] = pos;
    });
    
    timeStamps.push(now);
    
    // Afficher la progression
    const elapsed = (now - timeStamps[0]) / 1000;
    statusP.textContent = `Enregistrement en cours... ${Math.round(elapsed)}/${SAMPLE_SECONDS}s`;
    
    // Vérifier si nous avons atteint la durée d'enregistrement
    if (elapsed >= SAMPLE_SECONDS) {
      stopRecording();
    }
  }

  // ---------- 2. Aide visuelle ----------
  // Fonction modifiée pour dessiner une ellipse inscrite au cadre
  function drawGuide() {
    const { width, height } = overlay;
    
    // Centre de l'ellipse
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Rayons de l'ellipse (ajustés pour s'inscrire dans le cadre)
    const radiusX = width / 2 - 2; // -2 pour assurer une petite marge
    const radiusY = height / 2 - 2;
    
    // Dessiner l'ellipse
    octx.strokeStyle = '#0c0'; // Vert
    octx.lineWidth = 4;
    octx.beginPath();
    
    // L'API Canvas ne fournit pas de méthode directe pour dessiner une ellipse complète,
    // donc nous utilisons une approximation avec des courbes de Bézier
    const kappa = 0.5522848; // Constante mathématique pour approximation d'ellipse
    const ox = radiusX * kappa; // Contrôle horizontal
    const oy = radiusY * kappa; // Contrôle vertical
    
    // Commencer en haut
    octx.moveTo(centerX, centerY - radiusY);
    
    // Dessiner la partie supérieure droite
    octx.bezierCurveTo(
      centerX + ox, centerY - radiusY,
      centerX + radiusX, centerY - oy,
      centerX + radiusX, centerY
    );
    
    // Dessiner la partie inférieure droite
    octx.bezierCurveTo(
      centerX + radiusX, centerY + oy,
      centerX + ox, centerY + radiusY,
      centerX, centerY + radiusY
    );
    
    // Dessiner la partie inférieure gauche
    octx.bezierCurveTo(
      centerX - ox, centerY + radiusY,
      centerX - radiusX, centerY + oy,
      centerX - radiusX, centerY
    );
    
    // Dessiner la partie supérieure gauche
    octx.bezierCurveTo(
      centerX - radiusX, centerY - oy,
      centerX - ox, centerY - radiusY,
      centerX, centerY - radiusY
    );
    
    octx.stroke();
    
    // Lignes repères (en option)
    octx.strokeStyle = 'rgba(0, 204, 0, 0.3)';
    octx.lineWidth = 1;
    octx.beginPath();
    
    // Ligne horizontale
    octx.moveTo(centerX - radiusX, centerY);
    octx.lineTo(centerX + radiusX, centerY);
    
    // Ligne verticale
    octx.moveTo(centerX, centerY - radiusY);
    octx.lineTo(centerX, centerY + radiusY);
    
    octx.stroke();
  }

  // ---------- 3. Enregistrement ----------
  function startRecording() {
    
    // Modifier également la fonction startRecording() pour effacer les résultats précédents
    // Ajouter cette ligne au début de la fonction startRecording() :
    if (window.TremorViz && typeof window.TremorViz.clearResults === 'function') {
      window.TremorViz.clearResults();
    }
    console.log("Démarrage de l'enregistrement...");
    v2Series = Array(NODE_COUNT).fill().map(() => []);
    lastPos = Array(NODE_COUNT).fill(null);
    timeStamps = [];
    recording = true;
    statusP.textContent = 'Enregistrement en cours... Gardez votre main visible';
  }

  function stopRecording() {
    console.log("Arrêt de l'enregistrement...");
    recording = false;
    waitingForHand = false;
    statusP.textContent = 'Analyse des données...';
    
    // Lancer l'analyse après un court délai pour permettre à l'interface de se mettre à jour
    setTimeout(analyse, 100);
  }

  // ---------- 4. Pré‑traitement (dédrift & Welch) ----------
  function detrend(arr) {
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

  // ---------- Implémentation manuelle de la FFT ----------
  // Transformée de Fourier rapide récursive
  function fft(inputReal, inputImag) {
    const n = inputReal.length;
    
    // Vérifier que la taille est une puissance de 2
    if (n & (n - 1)) {
      throw new Error("La taille des données doit être une puissance de 2");
    }
    
    // Cas de base
    if (n === 1) {
      return { real: [inputReal[0]], imag: [inputImag[0]] };
    }
    
    // Diviser
    const halfN = n / 2;
    const evenReal = new Array(halfN);
    const evenImag = new Array(halfN);
    const oddReal = new Array(halfN);
    const oddImag = new Array(halfN);
    
    for (let i = 0; i < halfN; i++) {
      evenReal[i] = inputReal[i * 2];
      evenImag[i] = inputImag[i * 2];
      oddReal[i] = inputReal[i * 2 + 1];
      oddImag[i] = inputImag[i * 2 + 1];
    }
    
    // Appels récursifs
    const evenResult = fft(evenReal, evenImag);
    const oddResult = fft(oddReal, oddImag);
    
    // Combiner les résultats
    const result = { real: new Array(n), imag: new Array(n) };
    
    for (let k = 0; k < halfN; k++) {
      const angle = -2 * Math.PI * k / n;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      
      // Facteur de rotation
      const twiddleReal = cos * oddResult.real[k] - sin * oddResult.imag[k];
      const twiddleImag = sin * oddResult.real[k] + cos * oddResult.imag[k];
      
      // Papillon
      result.real[k] = evenResult.real[k] + twiddleReal;
      result.imag[k] = evenResult.imag[k] + twiddleImag;
      result.real[k + halfN] = evenResult.real[k] - twiddleReal;
      result.imag[k + halfN] = evenResult.imag[k] - twiddleImag;
    }
    
    return result;
  }

  // Transformée de Fourier Discrète (plus lente mais fonctionnelle)
  function dft(inputSignal) {
    const n = inputSignal.length;
    const real = new Array(n).fill(0);
    const imag = new Array(n).fill(0);
    
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < n; t++) {
        const angle = -2 * Math.PI * k * t / n;
        real[k] += inputSignal[t] * Math.cos(angle);
        imag[k] += inputSignal[t] * Math.sin(angle);
      }
    }
    
    return { real, imag };
  }

  // Fonction de calcul de la PSD par la méthode de Welch (basée sur FFT)
  function welchPSD(series, fs) {
    console.log("Démarrage analyse fréquentielle par FFT");
    const N = series.length;
    
    // Paramètres pour la méthode de Welch
    const segLen = Math.min(256, 1 << Math.floor(Math.log2(N)));
    if (segLen < 32) {
      console.warn("Signal trop court pour analyse spectrale");
      return { freqs: [], psd: [] }; 
    }
    
    // 50% de chevauchement entre segments
    const step = Math.floor(segLen / 2);
    
    // Fenêtre de Hann pour réduire les fuites spectrales
    const hann = new Float32Array(segLen);
    for (let i = 0; i < segLen; i++) {
      hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (segLen - 1)));
    }
    
    // Accumulateur pour moyenner les spectres
    const psdAccu = new Float32Array(Math.floor(segLen / 2) + 1).fill(0);
    let segments = 0;
    
    // Traiter chaque segment avec chevauchement
    for (let start = 0; start + segLen <= N; start += step) {
      // Appliquer la fenêtre au segment
      const segment = new Float32Array(segLen);
      for (let i = 0; i < segLen; i++) {
        segment[i] = series[start + i] * hann[i];
      }
      
      // Préparer pour la FFT
      const inputReal = new Float32Array(segment);
      const inputImag = new Float32Array(segLen).fill(0);
      
      // Calculer la FFT
      let result;
      try {
        result = fft(inputReal, inputImag);
      } catch (e) {
        console.warn("FFT rapide a échoué, utilisation de la DFT", e);
        result = dft(segment);
      }
      
      // Calculer le spectre de puissance (|X(f)|²)
      for (let k = 0; k <= segLen / 2; k++) {
        const re = result.real[k];
        const im = result.imag[k];
        // Le carré du module est toujours positif ou nul par définition
        psdAccu[k] += (re * re + im * im) / segLen;
      }
      
      segments++;
    }
    
    // Si aucun segment n'a pu être traité
    if (segments === 0) {
      console.warn("Aucun segment n'a pu être analysé");
      return { freqs: [], psd: [] };
    }
    
    // Moyenner les spectres de puissance
    const psd = Array.from(psdAccu, v => v / segments);
    
    // Générer les fréquences correspondantes
    const hzPerBin = fs / segLen;
    const freqs = psd.map((_, k) => k * hzPerBin);
    
    // Créer des points {f, m} et filtrer pour la bande d'intérêt
    const points = freqs.map((f, i) => ({ f, m: psd[i] }))
                       .filter(p => p.f >= MIN_HZ && p.f <= MAX_HZ);
    
    console.log("Analyse FFT réussie:", points.length, "points dans la bande d'intérêt");
    
    return { 
      freqs: points.map(p => p.f),
      psd: points.map(p => p.m)
    };
  }

  // ---------- 5. Analyse ----------
  function analyse() {
    console.log("Démarrage de l'analyse...");
    
    // Vérifier si nous avons suffisamment de données
    if (timeStamps.length < 10) {
      statusP.textContent = "Pas assez de données pour l'analyse. Essayez à nouveau.";
      startBtn.disabled = false;
      return;
    }
    
    // Fréquence d'échantillonnage réelle
    const duration = (timeStamps.at(-1) - timeStamps[0]) / 1000;
    const fs = v2Series[0].length / duration;
    
    console.log(`Fréquence d'échantillonnage: ${fs.toFixed(2)} Hz`);

    chartsDiv.innerHTML = '';
    const peakFreqs = [], peakAmps = [];
    
    // Sélectionner les landmarks les plus informatifs pour l'analyse
    // Points des doigts (4, 8, 12, 16, 20) et articulations principales (5, 9, 13, 17)
    const keyPoints = [0, 4, 5, 8, 9, 12, 13, 16, 17, 20];
    
    // ===== AJOUT: Création du graphique de somme des PSD avec contributions individuelles =====
    // Structure pour stocker les PSD des points clés
    const nodeData = [];

    // Première passe: collecter toutes les fréquences uniques
    const allFreqs = new Set();
    keyPoints.forEach((pointIdx) => {
      if (v2Series[pointIdx] && v2Series[pointIdx].length >= 32) {
        const cleaned = detrend(v2Series[pointIdx]);
        const { freqs } = welchPSD(cleaned, fs);
        freqs.forEach(f => allFreqs.add(f));
      }
    });

    // Convertir en tableau trié
    const freqArray = Array.from(allFreqs).sort((a, b) => a - b);
    const filteredFreqs = freqArray.filter(f => f >= MIN_HZ && f <= MAX_HZ);

    // Deuxième passe: calculer les PSD individuelles et les puissances totales
    keyPoints.forEach((pointIdx) => {
      if (v2Series[pointIdx] && v2Series[pointIdx].length >= 32) {
        const cleaned = detrend(v2Series[pointIdx]);
        const { freqs, psd } = welchPSD(cleaned, fs);
        
        // Créer un tableau pour stocker les valeurs de PSD pour chaque fréquence commune
        const nodePSD = new Array(filteredFreqs.length).fill(0);
        
        // Calculer la puissance totale dans la fenêtre 1-12 Hz
        let totalPower = 0;
        
        // Pour chaque fréquence du spectre filtré
        filteredFreqs.forEach((freq, i) => {
          // Trouver l'index le plus proche dans le spectre du point actuel
          const closestIdx = freqs.reduce((closest, f, idx) => {
            return Math.abs(f - freq) < Math.abs(freqs[closest] - freq) ? idx : closest;
          }, 0);
          
          // Stocker la valeur PSD
          nodePSD[i] = psd[closestIdx];
          
          // Ajouter à la puissance totale
          totalPower += psd[closestIdx];
        });
        
        // Nommer le nœud selon la convention MediaPipe
        let pointName;
        if (pointIdx === 0) pointName = "Poignet";
        else if (pointIdx === 4) pointName = "Pouce";
        else if (pointIdx === 8) pointName = "Index";
        else if (pointIdx === 12) pointName = "Majeur";
        else if (pointIdx === 16) pointName = "Annulaire";
        else if (pointIdx === 20) pointName = "Auriculaire";
        else if (pointIdx === 5) pointName = "Base I";
        else if (pointIdx === 9) pointName = "Base M";
        else if (pointIdx === 13) pointName = "Base A";
        else if (pointIdx === 17) pointName = "Base Au";
        else pointName = `Point ${pointIdx}`;
        
        // Stocker les données
        nodeData.push({
          index: pointIdx,
          name: pointName,
          psd: nodePSD,
          totalPower: totalPower
        });
      }
    });

    // Trier les nœuds par puissance totale décroissante
    nodeData.sort((a, b) => b.totalPower - a.totalPower);

    // Créer le graphique de la somme (pleine largeur)
    const sumChartDiv = document.createElement('div');
    sumChartDiv.style.gridColumn = '1 / -1';
    sumChartDiv.style.marginBottom = '20px';

    const sumCanvas = document.createElement('canvas');
    sumCanvas.className = 'chart sumChart';
    sumChartDiv.appendChild(sumCanvas);
    chartsDiv.appendChild(sumChartDiv);

    // Calculer le PSD total et sa puissance totale
    const totalPSD = new Array(filteredFreqs.length).fill(0);
    let grandTotalPower = 0;
    nodeData.forEach(node => {
      node.psd.forEach((val, i) => {
        totalPSD[i] += val;
      });
    });
    grandTotalPower = totalPSD.reduce((sum, val) => sum + val, 0);

    // Préparer les datasets pour le graphique
    const datasets = [
      // Ajouter le dataset du total en premier
      {
        label: `Total: ${Math.round(grandTotalPower)}`,
        data: totalPSD,
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        borderColor: 'rgba(0, 0, 0, 0.5)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.3
      }
    ];

    // Ajouter les datasets individuels
    datasets.push(...nodeData.map((node, idx) => {
      // Générer une couleur basée sur la position dans le tableau
      const hue = (idx * 360 / nodeData.length) % 360;
      return {
        label: `${Math.round(node.totalPower)} - ${node.name}`,
        data: node.psd,
        backgroundColor: `hsla(${hue}, 70%, 50%, 0.6)`,
        borderColor: `hsla(${hue}, 70%, 40%, 0.8)`,
        borderWidth: 1,
        pointRadius: 0,
        fill: true,
        tension: 0.3
      };
    }));

    // Créer le graphique avec Chart.js
    new Chart(sumCanvas, {
      type: 'line', // On utilise line avec fill:true pour avoir des aires
      data: {
        labels: filteredFreqs.map(f => f.toFixed(1)),
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: {
              display: true,
              text: 'Fréquence (Hz)'
            },
            ticks: {
              maxTicksLimit: 10
            }
          },
          y: {
            beginAtZero: true,
            min: 0,
            title: {
              display: true,
              text: 'Amplitude'
            },
            stacked: true // Changé de false à true pour empiler les graphiques
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              // Callback personnalisé pour les étiquettes de légende
              generateLabels: function(chart) {
                const datasets = chart.data.datasets;
                return datasets.map((dataset, i) => {
                  return {
                    text: dataset.label,
                    fillStyle: dataset.backgroundColor,
                    strokeStyle: dataset.borderColor,
                    lineWidth: dataset.borderWidth,
                    hidden: !chart.isDatasetVisible(i),
                    index: i
                  };
                });
              }
            }
          },
          title: {
            display: true,
            text: 'Analyse spectrale des tremblements - Contributions par point',
            font: {
              size: 16
            }
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              title: (items) => `${items[0].label} Hz`,
              label: (item) => `${item.dataset.label.split(' - ')[1]}: ${item.raw.toFixed(5)}`
            }
          }
        },
        animation: {
          duration: 500
        }
      }
    });

    // Si nous avons des données, trouver le pic principal global pour l'information récapitulative
    if (nodeData.length > 0) {
      // Calculer la PSD totale à chaque fréquence
      const totalPSD = new Array(filteredFreqs.length).fill(0);
      nodeData.forEach(node => {
        node.psd.forEach((val, i) => {
          totalPSD[i] += val;
        });
      });
      
      // Trouver le pic principal
      let maxVal = 0;
      let maxIdx = 0;
      totalPSD.forEach((val, i) => {
        if (val > maxVal) {
          maxVal = val;
          maxIdx = i;
        }
      });
      
      const peakFreq = filteredFreqs[maxIdx];
      console.log(`Somme des PSD: pic principal à ${peakFreq.toFixed(2)} Hz avec amplitude ${maxVal.toFixed(4)}`);
      
      // Ajouter cette information au titre du graphique
      const chartInstance = Chart.getChart(sumCanvas);
      if (chartInstance) {
        chartInstance.options.plugins.title.text = 
          `Analyse spectrale des tremblements - Pic principal: ${peakFreq.toFixed(2)} Hz`;
        chartInstance.update();
      }
    }
    // ===== FIN AJOUT =====
    
    keyPoints.forEach((pointIdx, idx) => {
      if (!v2Series[pointIdx] || v2Series[pointIdx].length < 32) {
        console.warn(`Série ${pointIdx} trop courte ou manquante (${v2Series[pointIdx]?.length || 0} échantillons)`);
        return; // série trop courte
      }
      
      console.log(`Analyse de la série ${pointIdx}: ${v2Series[pointIdx].length} points`);
      const cleaned = detrend(v2Series[pointIdx]);
      const { freqs, psd } = welchPSD(cleaned, fs);

      // Création des points {f, m} pour le filtrage
      const inBand = freqs.map((f, i) => ({ f, m: psd[i] }));
      
      // Si on a des données valides
      if (inBand.length > 0) {
        // Trouver le pic principal
        const peak = inBand.reduce((a, b) => (b.m > a.m ? b : a), { f: 0, m: 0 });
        
        // Ne garder que les pics significatifs
        if (peak.m > 0.1) {
          peakFreqs.push(peak.f.toFixed(2));
          peakAmps.push(peak.m.toFixed(4));
        }
      } else {
        console.warn(`Aucune donnée valide pour la série ${pointIdx}`);
      }
    });

    // Afficher les résultats
    if (peakFreqs.length > 0) {
      // Calculer la fréquence moyenne pondérée par l'amplitude
      const weightedSum = peakFreqs.reduce((sum, freq, i) => sum + parseFloat(freq) * parseFloat(peakAmps[i]), 0);
      const totalWeight = peakAmps.reduce((sum, amp) => sum + parseFloat(amp), 0);
      const avgFreq = (weightedSum / totalWeight).toFixed(2);
      
      let tremorType = "";
      if (avgFreq < 4) tremorType = "Tremblement repos (parkinsonien)";
      else if (avgFreq < 7) tremorType = "Tremblement essentiel";
      else tremorType = "Tremblement physiologique ou d'anxiété";
      
      summaryP.innerHTML = `<strong>Fréquence dominante: ${avgFreq} Hz</strong><br>
                          Classification possible: ${tremorType}<br>
                          Fréquences détectées: ${peakFreqs.join(' Hz, ')} Hz`;
      resultsSec.hidden = false;
      exportBtn.onclick = () => exportCSV(peakFreqs, peakAmps);
    } else {
      summaryP.textContent = "Aucune fréquence dominante détectée. Veuillez réessayer en gardant la main plus stable dans le cercle.";
      resultsSec.hidden = false;
      
      // Modifier la fonction analyse() pour intégrer la visualisation
      if (window.TremorViz && typeof window.TremorViz.displayResults === 'function') {
        window.TremorViz.displayResults(peakFreqs, peakAmps);
      }
    }
    
    statusP.textContent = 'Analyse terminée';
  }

  // ---------- 6. Visualization / Export ----------
  function drawChart(label, freqs, mags) {
    const c = document.createElement('canvas');
    c.className = 'chart';
    chartsDiv.appendChild(c);
    new Chart(c, {
      type: 'line',
      data: { 
        labels: freqs.map(f => f.toFixed(1)), 
        datasets: [{ 
          label: label, 
          data: mags, 
          borderColor: '#0066cc',
          backgroundColor: 'rgba(0, 102, 204, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true
        }] 
      },
      options: { 
        scales: { 
          x: { 
            title: { display: true, text: 'Hz' },
            ticks: { maxTicksLimit: 10 }
          }, 
          y: { 
            beginAtZero: true,
            min: 0, // Garantir que l'axe commence à 0
          } 
        },
        plugins: { 
          legend: { display: true, position: 'top' },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0].label} Hz`,
              label: (item) => `Amplitude: ${item.raw.toFixed(5)}`
            }
          }
        },
        animation: {
          duration: 500
        }
      }
    });
  }

  function exportCSV(freqs, amps) {
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
    console.log("Bouton démarrer cliqué");
    
    // Passer en mode "attente d'une main"
    waitingForHand = true;
    startBtn.disabled = true;
    resultsSec.hidden = true;
    
    // Vérifier si une main est déjà détectée
    if (handDetected && currentLandmarks) {
      console.log("Main déjà détectée, démarrage immédiat de l'enregistrement");
      waitingForHand = false;
      startRecording();
    } else {
      // Sinon, attendre qu'une main soit détectée
      statusP.textContent = 'En attente de la détection d\'une main...';
      console.log("En attente de la détection d'une main");
    }
  });
  
  restartBtn.addEventListener('click', () => {
    console.log("Bouton redémarrer cliqué");
    startBtn.disabled = false;
    waitingForHand = false;
    resultsSec.hidden = true; 
    statusP.textContent = 'Prêt ! Placez votre main dans le cercle.';
  });

  // Définir une fonction pour gérer les erreurs non capturées
  window.onerror = function(message, source, lineno, colno, error) {
    console.error("Erreur globale:", message, "à", source, "ligne:", lineno, error);
    return false;
  };

  // Alternative: utiliser le DOMContentLoaded pour s'assurer que tout est chargé
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCamera);
  } else {
    // Démarrer l'application
    console.log("Démarrage de l'application...");
    setTimeout(initCamera, 100); // Petit délai pour s'assurer que tout est prêt
  }
})();
