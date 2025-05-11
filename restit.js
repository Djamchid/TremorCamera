// restit.js - Visualisation des tremblements par nœud
// Ce script crée une représentation visuelle de la main avec des cercles 
// proportionnels à l'amplitude des tremblements

(function() {
  // === Constantes ===
  const CANVAS_WIDTH = 400;
  const CANVAS_HEIGHT = 400;
  const MIN_RADIUS = 5;   // Rayon minimum pour un nœud
  const MAX_RADIUS = 30;  // Rayon maximum pour l'amplitude la plus élevée
  const BASE_COLOR = '#0066cc';  // Couleur de base pour les cercles
  
  // Positions relatives normalisées des 21 points de la main MediaPipe
  // Ces positions sont approximatives pour une main droite, paume vers le haut
  const HAND_LAYOUT = [
    {x: 0.5, y: 0.8, name: 'Poignet'},           // 0 - Poignet
    
    {x: 0.5, y: 0.7, name: ''},                  // 1 - Base pouce
    {x: 0.4, y: 0.6, name: ''},                  // 2 - Milieu pouce
    {x: 0.3, y: 0.5, name: ''},                  // 3 - Articulation pouce
    {x: 0.2, y: 0.4, name: 'Pouce'},             // 4 - Bout pouce
    
    {x: 0.5, y: 0.6, name: 'Base index'},        // 5 - Base index
    {x: 0.5, y: 0.45, name: ''},                 // 6 - Milieu index
    {x: 0.5, y: 0.3, name: ''},                  // 7 - Articulation index
    {x: 0.5, y: 0.15, name: 'Index'},            // 8 - Bout index
    
    {x: 0.6, y: 0.58, name: 'Base majeur'},      // 9 - Base majeur
    {x: 0.6, y: 0.43, name: ''},                 // 10 - Milieu majeur
    {x: 0.6, y: 0.28, name: ''},                 // 11 - Articulation majeur
    {x: 0.6, y: 0.13, name: 'Majeur'},           // 12 - Bout majeur
    
    {x: 0.7, y: 0.6, name: 'Base annulaire'},    // 13 - Base annulaire
    {x: 0.7, y: 0.45, name: ''},                 // 14 - Milieu annulaire
    {x: 0.7, y: 0.3, name: ''},                  // 15 - Articulation annulaire
    {x: 0.7, y: 0.15, name: 'Annulaire'},        // 16 - Bout annulaire
    
    {x: 0.8, y: 0.65, name: 'Base auriculaire'}, // 17 - Base auriculaire
    {x: 0.8, y: 0.5, name: ''},                  // 18 - Milieu auriculaire
    {x: 0.8, y: 0.35, name: ''},                 // 19 - Articulation auriculaire
    {x: 0.8, y: 0.2, name: 'Auriculaire'}        // 20 - Bout auriculaire
  ];
  
  // Connexions entre les nœuds (indices des points à connecter)
  const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],         // Pouce
    [0, 5], [5, 6], [6, 7], [7, 8],         // Index
    [0, 9], [9, 10], [10, 11], [11, 12],    // Majeur
    [0, 13], [13, 14], [14, 15], [15, 16],  // Annulaire
    [0, 17], [17, 18], [18, 19], [19, 20],  // Auriculaire
    [5, 9], [9, 13], [13, 17]               // Connexions entre les bases des doigts
  ];
  
  // Points clés analysés (doit correspondre à la liste du main.js)
  const KEY_POINTS = [0, 4, 5, 8, 9, 12, 13, 16, 17, 20];
  
  // === Variables ===
  let canvas, ctx;
  let resultData = null;
  
  // === Initialisation ===
  function initialize() {
    console.log("Initialisation de la visualisation de la main");
    
    // Créer le canvas s'il n'existe pas déjà
    if (!document.getElementById('handCanvas')) {
      canvas = document.createElement('canvas');
      canvas.id = 'handCanvas';
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      canvas.style.background = '#fff';
      canvas.style.border = '1px solid #ccc';
      canvas.style.borderRadius = '8px';
      canvas.style.margin = '1rem auto';
      canvas.style.display = 'block';
      
      // Ajouter le canvas à la section des résultats
      const resultsSection = document.getElementById('results');
      if (resultsSection) {
        // Ajouter un en-tête
        const heading = document.createElement('h3');
        heading.textContent = 'Visualisation des tremblements';
        resultsSection.insertBefore(heading, resultsSection.firstChild);
        
        // Ajouter le canvas après l'en-tête
        resultsSection.insertBefore(canvas, heading.nextSibling);
      } else {
        // Fallback: ajouter à la fin du document
        document.body.appendChild(canvas);
      }
    } else {
      canvas = document.getElementById('handCanvas');
    }
    
    ctx = canvas.getContext('2d');
    
    // Ajouter les événements liés à l'analyse
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
      startBtn.addEventListener('click', clearResults);
    }
    
    console.log("Restit.js initialisé avec succès");
  }
  
  // === Fonctions publiques ===
  
  // Appelée quand une nouvelle analyse commence
  function clearResults() {
    console.log("Effacement des résultats de visualisation");
    resultData = null;
    
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawEmptyHand();
    }
  }
  
  // Appelée quand l'analyse est terminée pour afficher les résultats
  function displayResults(freqs, amps) {
    console.log("Affichage des résultats de visualisation", freqs, amps);
    
    if (!ctx || !freqs || !amps || freqs.length !== amps.length) {
      console.error("Données invalides pour la visualisation");
      return;
    }
    
    // Stocker les données pour une utilisation ultérieure
    resultData = {
      frequencies: freqs.map(f => parseFloat(f)),
      amplitudes: amps.map(a => parseFloat(a))
    };
    
    // Dessiner le schéma
    drawHand();
  }
  
  // === Fonctions de dessin ===
  
  // Dessine la main sans données (seulement le squelette)
  function drawEmptyHand() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Fond légèrement teinté
    ctx.fillStyle = 'rgba(240, 245, 255, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Dessiner les connexions
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    
    HAND_CONNECTIONS.forEach(conn => {
      ctx.beginPath();
      const p1 = HAND_LAYOUT[conn[0]];
      const p2 = HAND_LAYOUT[conn[1]];
      
      ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
      ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      ctx.stroke();
    });
    
    // Dessiner les nœuds
    HAND_LAYOUT.forEach((point, i) => {
      // Nœuds clés plus visibles
      if (KEY_POINTS.includes(i)) {
        ctx.fillStyle = 'rgba(200, 220, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(
          point.x * canvas.width, 
          point.y * canvas.height, 
          MIN_RADIUS, 
          0, 
          2 * Math.PI
        );
        ctx.fill();
        
        // Ajouter le nom s'il est défini
        if (point.name) {
          ctx.fillStyle = '#999';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(
            point.name,
            point.x * canvas.width,
            point.y * canvas.height + MIN_RADIUS + 12
          );
        }
      } else {
        // Autres nœuds plus discrets
        ctx.fillStyle = 'rgba(200, 220, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(
          point.x * canvas.width, 
          point.y * canvas.height, 
          MIN_RADIUS / 2, 
          0, 
          2 * Math.PI
        );
        ctx.fill();
      }
    });
  }
  
  // Dessine la main avec les données d'amplitude et de fréquence
  function drawHand() {
    if (!resultData) {
      drawEmptyHand();
      return;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Fond légèrement teinté
    ctx.fillStyle = 'rgba(240, 245, 255, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Dessiner les connexions
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    
    HAND_CONNECTIONS.forEach(conn => {
      ctx.beginPath();
      const p1 = HAND_LAYOUT[conn[0]];
      const p2 = HAND_LAYOUT[conn[1]];
      
      ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
      ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      ctx.stroke();
    });
    
    // Trouver l'amplitude maximum pour normaliser
    const maxAmp = Math.max(...resultData.amplitudes);
    
    // Dessiner d'abord les nœuds non-clés en fond
    HAND_LAYOUT.forEach((point, i) => {
      if (!KEY_POINTS.includes(i)) {
        // Nœuds discrets en arrière-plan
        ctx.fillStyle = 'rgba(200, 220, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(
          point.x * canvas.width, 
          point.y * canvas.height, 
          MIN_RADIUS / 2, 
          0, 
          2 * Math.PI
        );
        ctx.fill();
      }
    });
    
    // Dessiner ensuite les nœuds clés avec les données
    KEY_POINTS.forEach((nodeIdx, i) => {
      const point = HAND_LAYOUT[nodeIdx];
      const freq = resultData.frequencies[i];
      const amp = resultData.amplitudes[i];
      
      // Calculer le rayon proportionnel à l'amplitude
      const radius = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * (amp / maxAmp);
      
      // Calculer la couleur en fonction de la fréquence (bleu à rouge)
      const hue = Math.max(0, Math.min(240 - (freq * 20), 240)); // 0Hz = bleu (240), 12Hz = rouge (0)
      const colorStr = `hsla(${hue}, 80%, 50%, 0.6)`;
      
      // Dessiner le cercle
      ctx.fillStyle = colorStr;
      ctx.beginPath();
      ctx.arc(
        point.x * canvas.width, 
        point.y * canvas.height, 
        radius, 
        0, 
        2 * Math.PI
      );
      ctx.fill();
      
      // Ajouter un contour
      ctx.strokeStyle = `hsla(${hue}, 80%, 40%, 0.8)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      // Ajouter la fréquence
      ctx.fillStyle = '#000';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${Math.round(freq)} Hz`,
        point.x * canvas.width,
        point.y * canvas.height + 4
      );
      
      // Ajouter le nom du point
      if (point.name) {
        ctx.fillStyle = '#555';
        ctx.font = '10px sans-serif';
        ctx.fillText(
          point.name,
          point.x * canvas.width,
          point.y * canvas.height + radius + 12
        );
      }
    });
    
    // Ajouter légende de couleur
    drawColorLegend();
  }
  
  // Dessine une légende des couleurs
  function drawColorLegend() {
    const legendWidth = 200;
    const legendHeight = 30;
    const x = canvas.width - legendWidth - 10;
    const y = canvas.height - legendHeight - 10;
    
    // Fond de la légende
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(x, y, legendWidth, legendHeight);
    ctx.strokeStyle = '#ccc';
    ctx.strokeRect(x, y, legendWidth, legendHeight);
    
    // Dégradé de couleur
    for (let i = 0; i < legendWidth - 20; i++) {
      const ratio = i / (legendWidth - 20);
      const hue = 240 - (ratio * 240);
      ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
      ctx.fillRect(x + 10 + i, y + 10, 1, 10);
    }
    
    // Texte
    ctx.fillStyle = '#333';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('1 Hz', x + 10, y + 25);
    ctx.textAlign = 'right';
    ctx.fillText('12 Hz', x + legendWidth - 10, y + 25);
    
    // Titre
    ctx.textAlign = 'center';
    ctx.fillText('Fréquence de tremblement', x + legendWidth / 2, y + 8);
  }
  
  // === Intégration au système principal ===
  
  // Enregistrer la fonction dans le window pour l'accessibilité
  window.TremorViz = {
    initialize: initialize,
    displayResults: displayResults,
    clearResults: clearResults
  };
  
  // Initialiser au chargement
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
  
})();
