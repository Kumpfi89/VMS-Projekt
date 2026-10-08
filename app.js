// Eure Firebase-Konfiguration
const firebaseConfig = {
  apiKey: "AIzaSyDnwoB8gFLlEOCuLd5IAe6h3SL3rVUjT-k",
  authDomain: "smartbox-db.firebaseapp.com",
  databaseURL: "https://smartbox-db-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "smartbox-db",
  storageBucket: "smartbox-db.firebasestorage.app",
  messagingSenderId: "956387582755",
  appId: "1:956387582755:web:5687600ce69a0d0bb9a296"
};

// Sichere Initialisierung von Firebase
let database;
try {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  database = firebase.database();
} catch (e) {
  console.error("Firebase Init Fehler:", e);
}

let currentProfile = "Sebi";
let slotsData = {};
let html5QrCode = null;
let currentScannedName = "";

// Helper: Verhindert Abstürze durch Tracking Prevention
function getSafeStorage(key, fallback) {
  try {
    return window.localStorage ? window.localStorage.getItem(key) || fallback : fallback;
  } catch (e) {
    console.warn("Storage blockiert, verwende Fallback:", fallback);
    return fallback;
  }
}

function setSafeStorage(key, value) {
  try {
    if (window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch (e) {
    console.warn("Storage blockiert, konnte nicht schreiben:", e);
  }
}

// DOM-Elemente
let btnStartScan, btnStopScan, readerContainer, scanResult, productNameEl, btnSaveSlot;
let userProfileInput, btnLoadProfile, activeProfileName;
let btnManualEntry, btnEditName;

document.addEventListener('DOMContentLoaded', () => {
  btnStartScan = document.getElementById('btn-start-scan');
  btnStopScan = document.getElementById('btn-stop-scan');
  readerContainer = document.getElementById('reader-container');
  scanResult = document.getElementById('scan-result');
  productNameEl = document.getElementById('product-name');
  btnSaveSlot = document.getElementById('btn-save-slot');

  userProfileInput = document.getElementById('user-profile-input');
  btnLoadProfile = document.getElementById('btn-load-profile');
  activeProfileName = document.getElementById('active-profile-name');

  btnManualEntry = document.getElementById('btn-manual-entry');
  btnEditName = document.getElementById('btn-edit-name');

  currentProfile = getSafeStorage('smartbox_last_profile', 'Sebi');
  if (userProfileInput) userProfileInput.value = currentProfile;
  
  listenToCloudData(currentProfile);

  if (btnStartScan) btnStartScan.addEventListener('click', startCamera);
  if (btnStopScan) btnStopScan.addEventListener('click', stopCamera);
  if (btnSaveSlot) btnSaveSlot.addEventListener('click', saveProductToSlot);
  
  if (btnLoadProfile) {
    btnLoadProfile.addEventListener('click', () => {
      const newProfile = userProfileInput.value.trim() || "Sebi";
      currentProfile = newProfile;
      setSafeStorage('smartbox_last_profile', currentProfile);
      listenToCloudData(currentProfile);
    });
  }

  // 1. Direkt-Option: Name manuell ohne Barcode eingeben
  if (btnManualEntry) {
    btnManualEntry.addEventListener('click', () => {
      stopCamera();
      const inputName = prompt("Name des Präparats / Nahrungsergänzungsmittels eingeben:", "");
      if (inputName && inputName.trim() !== "") {
        currentScannedName = inputName.trim();
        productNameEl.innerText = currentScannedName;
        scanResult.classList.remove('hidden');
      }
    });
  }

  // 2. Option: Aktuellen Namen korrigieren/anpassen
  if (btnEditName) {
    btnEditName.addEventListener('click', () => {
      const newName = prompt("Produktname anpassen:", currentScannedName);
      if (newName && newName.trim() !== "") {
        currentScannedName = newName.trim();
        productNameEl.innerText = currentScannedName;
      }
    });
  }
});

// Live-Echtzeit-Verbindung zur Firebase Cloud-Datenbank
function listenToCloudData(profileName) {
  if (activeProfileName) activeProfileName.innerText = profileName;

  if (!database) {
    alert("Firebase konnte nicht geladen werden.");
    return;
  }

  database.ref(`profiles/${profileName}`).on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      slotsData = data;
    } else {
      slotsData = {
        1: { name: 'Leer', count: 0 },
        2: { name: 'Leer', count: 0 },
        3: { name: 'Leer', count: 0 },
        4: { name: 'Leer', count: 0 }
      };
      database.ref(`profiles/${profileName}`).set(slotsData);
    }
    updateUI();
  }, (error) => {
    alert("Firebase Fehler: " + error.message);
  });
}

// Kamera-Logik starten
function startCamera() {
  readerContainer.classList.remove('hidden');
  scanResult.classList.add('hidden');

  html5QrCode = new Html5Qrcode("reader");
  
  const scanConfig = {
    fps: 20,
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      return {
        width: Math.floor(viewfinderWidth * 0.85),
        height: Math.floor(minEdge * 0.5)
      };
    },
    aspectRatio: 1.0
  };

  html5QrCode.start(
    { facingMode: "environment" },
    scanConfig,
    onBarcodeScanned
  ).then(() => {
    try {
      const track = html5QrCode.getRunningTrack();
      const capabilities = track.getCapabilities();
      if (capabilities && capabilities.zoom) {
        const targetZoom = Math.min(capabilities.zoom.max, 1.8);
        track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
      }
    } catch (e) {
      console.log("Zoom nicht unterstützt:", e);
    }
  }).catch(err => {
    alert("Kamera-Fehler: " + err);
    stopCamera();
  });
}

// Barcode erkannt -> Produktsuche mit Fallback
function onBarcodeScanned(decodedText) {
  stopCamera();
  
  productNameEl.innerText = "Lade Produktdaten...";
  scanResult.classList.remove('hidden');

  fetch(`https://world.openfoodfacts.org/api/v0/product/${decodedText}.json`)
    .then(res => res.json())
    .then(data => {
      let detectedName = "";

      if (data.status === 1 && data.product) {
        const p = data.product;
        const baseName = p.product_name_de || p.product_name || p.generic_name_de || p.generic_name;
        const brand = p.brands ? p.brands.split(',')[0].trim() : "";

        if (baseName && brand) {
          detectedName = `${brand} - ${baseName}`;
        } else if (baseName) {
          detectedName = baseName;
        } else if (brand) {
          detectedName = `${brand} Präparat`;
        }
      }

      // Falls Barcode nicht in Open Food Facts gefunden wurde
      if (!detectedName) {
        detectedName = `Präparat (EAN: ${decodedText})`;
        setTimeout(() => {
          const manualFix = prompt(`Barcode ${decodedText} nicht in der Datenbank gefunden. Wie heißt das Produkt?`, "");
          if (manualFix && manualFix.trim() !== "") {
            currentScannedName = manualFix.trim();
            productNameEl.innerText = currentScannedName;
          }
        }, 300);
      }

      currentScannedName = detectedName;
      productNameEl.innerText = currentScannedName;
    })
    .catch(() => {
      currentScannedName = `Präparat (EAN: ${decodedText})`;
      productNameEl.innerText = currentScannedName;
    });
}

function stopCamera() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      readerContainer.classList.add('hidden');
    }).catch(() => {});
  } else {
    readerContainer.classList.add('hidden');
  }
}

// In Firebase Cloud speichern
function saveProductToSlot() {
  const selectedSlot = document.getElementById('slot-select').value;
  const count = parseInt(document.getElementById('pill-count').value) || 0;

  if (!currentScannedName || currentScannedName === "-") {
    alert("Bitte gib zuerst einen Produktnamen ein oder scanne einen Barcode.");
    return;
  }

  slotsData[selectedSlot] = {
    name: currentScannedName,
    count: count
  };

  database.ref(`profiles/${currentProfile}`).set(slotsData)
    .then(() => {
      scanResult.classList.add('hidden');
      alert(`Erfolgreich gespeichert für [${currentProfile}]:\n${currentScannedName} in Behälter ${selectedSlot}`);
    })
    .catch(err => alert("Speicherfehler: " + err));
}

// Entnahme simulieren
function simulateTakePill(slotId) {
  if (slotsData[slotId] && slotsData[slotId].count > 0) {
    slotsData[slotId].count--;
    
    // Sobald count == 0 erreicht ist, schaltet der Name wieder auf "Leer"
    if (slotsData[slotId].count === 0) {
      slotsData[slotId].name = "Leer";
    }

    const ledEl = document.getElementById(`led-${slotId}`);
    if (ledEl) {
      ledEl.classList.add('active-green');
      setTimeout(() => ledEl.classList.remove('active-green'), 1500);
    }

    database.ref(`profiles/${currentProfile}`).set(slotsData);
  } else {
    alert(`Behälter ${slotId} ist bereits leer!`);
  }
}

// UI aktualisieren (Farbanpassung: >0 Stk. -> Grün, 0 Stk. -> Rot)
function updateUI() {
  for (let i = 1; i <= 4; i++) {
    if (slotsData[i]) {
      const nameEl = document.getElementById(`name-${i}`);
      const countEl = document.getElementById(`count-${i}`);
      const cardEl = document.getElementById(`slot-card-${i}`);
      const ledEl = document.getElementById(`led-${i}`);

      const count = slotsData[i].count || 0;
      const displayName = (count === 0) ? "Leer" : (slotsData[i].name || "Leer");

      if (nameEl) nameEl.innerText = displayName;
      if (countEl) countEl.innerText = count;

      if (cardEl && ledEl) {
        if (count > 0) {
          cardEl.classList.remove('empty-slot');
          cardEl.classList.add('filled-slot');

          ledEl.classList.remove('red');
          ledEl.classList.add('green');
        } else {
          cardEl.classList.remove('filled-slot');
          cardEl.classList.add('empty-slot');

          ledEl.classList.remove('green');
          ledEl.classList.add('red');
        }
      }
    }
  }
}