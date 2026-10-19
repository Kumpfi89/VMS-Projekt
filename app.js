// Firebase-Konfiguration
const firebaseConfig = {
  apiKey: "AIzaSyDnwoB8gFLlEOCuLd5IAe6h3SL3rVUjT-k",
  authDomain: "smartbox-db.firebaseapp.com",
  databaseURL: "https://smartbox-db-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "smartbox-db",
  storageBucket: "smartbox-db.firebasestorage.app",
  messagingSenderId: "956387582755",
  appId: "1:956387582755:web:5687600ce69a0d0bb9a296"
};

// Sichere Initialisierung von Firebase (Compat SDK v9)
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

// Native Scanner Variablen
let nativeStream = null;
let nativeInterval = null;

// Helper: Verhindert Abstürze durch Storage-Restrictions
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

// Mathe-Check: Mathematische Validierung von EAN-13 Prüfsummen (Modulo 10)
function isValidEAN13(ean) {
  if (!/^\d{13}$/.exec(ean)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(ean.charAt(i), 10) * (i % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(ean.charAt(12), 10);
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

  // 1. Manuelle Eingabe ohne Kamera
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

  // 2. Produktnamen anpassen
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

// Echtzeit-Verbindung zur Firebase Realtime Database
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

// Kamera-Start
function startCamera() {
  readerContainer.classList.remove('hidden');
  scanResult.classList.add('hidden');

  if ('BarcodeDetector' in window) {
    startNativeHardwareScanner();
  } else {
    startHtml5QrcodeScanner();
  }
}

// NATIVE HARDWARE-ENGINE (Strikte Formate zur Vermeidung von Fehllesungen)
async function startNativeHardwareScanner() {
  let nativeVideo = document.getElementById('native-video');
  const readerDiv = document.getElementById('reader');

  if (!nativeVideo) {
    nativeVideo = document.createElement('video');
    nativeVideo.id = 'native-video';
    nativeVideo.setAttribute('playsinline', 'true');
    nativeVideo.style.width = '100%';
    nativeVideo.style.borderRadius = '8px';
    nativeVideo.style.background = '#000';
    readerContainer.insertBefore(nativeVideo, btnStopScan);
  }

  if (readerDiv) readerDiv.classList.add('hidden');
  nativeVideo.classList.remove('hidden');

  try {
    // Nur noch echte Supermarkt-/Medikamenten-Formate zulassen!
    const barcodeDetector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']
    });

    nativeStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });

    nativeVideo.srcObject = nativeStream;
    await nativeVideo.play();

    // Optischen Zoom aktivieren
    try {
      const track = nativeStream.getVideoTracks()[0];
      if (track && track.getCapabilities) {
        const capabilities = track.getCapabilities();
        if (capabilities && capabilities.zoom) {
          const targetZoom = Math.min(capabilities.zoom.max, 2.0);
          await track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
        }
      }
    } catch (e) {
      console.log("Zoom nicht angewendet:", e);
    }

    nativeInterval = setInterval(async () => {
      try {
        if (nativeVideo.readyState < 2) return;

        const barcodes = await barcodeDetector.detect(nativeVideo);
        if (barcodes.length > 0) {
          const code = barcodes[0].rawValue;

          // Falls es ein 13-stelliger EAN ist, Prüfsumme verifizieren
          if (code.length === 13 && !isValidEAN13(code)) {
            console.warn("Fehlerhafter EAN-13 Scan ignoriert:", code);
            return;
          }

          stopCamera();
          onBarcodeScanned(code);
        }
      } catch (e) {
        console.error("Native Scan Fehler:", e);
      }
    }, 100);

  } catch (err) {
    console.warn("Native Scanner fehlgeschlagen, schalte auf HTML5 Fallback um:", err);
    startHtml5QrcodeScanner();
  }
}

// Fallback: html5-qrcode
function startHtml5QrcodeScanner() {
  const nativeVideo = document.getElementById('native-video');
  const readerDiv = document.getElementById('reader');

  if (nativeVideo) nativeVideo.classList.add('hidden');
  if (readerDiv) readerDiv.classList.remove('hidden');

  const formatsToSupport = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E
  ];

  html5QrCode = new Html5Qrcode("reader", { formatsToSupport: formatsToSupport });

  const scanConfig = {
    fps: 30,
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      return {
        width: Math.floor(viewfinderWidth * 0.9),
        height: Math.floor(minEdge * 0.35)
      };
    },
    aspectRatio: 1.0,
    videoConstraints: {
      facingMode: "environment"
    }
  };

  html5QrCode.start(
    { facingMode: "environment" },
    scanConfig,
    onBarcodeScanned
  ).catch(err => {
    alert("Kamera-Fehler: " + err);
    stopCamera();
  });
}

// Kamera stoppen
function stopCamera() {
  if (nativeInterval) {
    clearInterval(nativeInterval);
    nativeInterval = null;
  }
  if (nativeStream) {
    nativeStream.getTracks().forEach(track => track.stop());
    nativeStream = null;
  }

  const nativeVideo = document.getElementById('native-video');
  if (nativeVideo) nativeVideo.classList.add('hidden');

  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      readerContainer.classList.add('hidden');
    }).catch(() => {
      readerContainer.classList.add('hidden');
    });
  } else {
    readerContainer.classList.add('hidden');
  }
}

// Barcode erkannt -> Prüft Open Food Facts & danach die eigene Firebase-Datenbank
function onBarcodeScanned(decodedText) {
  stopCamera();
  
  productNameEl.innerText = "Lade Produktdaten...";
  scanResult.classList.remove('hidden');

  // 1. Zuerst in Open Food Facts suchen
  fetch(`https://world.openfoodfacts.org/api/v0/product/${decodedText}.json`)
    .then(res => res.json())
    .then(data => {
      let detectedName = "";

      if (data.status === 1 && data.product) {
        const p = data.product;
        const baseName = p.product_name_de || p.product_name || p.generic_name_de || p.generic_name;
        const brand = p.brands ? p.brands.split(',')[0].trim() : "";

        if (baseName && brand) {
          detectedName = `${brand} ${baseName}`;
        } else if (baseName) {
          detectedName = baseName;
        } else if (brand) {
          detectedName = `${brand} Präparat`;
        }
      }

      if (detectedName) {
        currentScannedName = detectedName;
        productNameEl.innerText = currentScannedName;
      } else {
        // 2. Falls nicht bei Open Food Facts -> Eigene Firebase-Datenbank prüfen
        checkCustomDatabase(decodedText);
      }
    })
    .catch(() => {
      checkCustomDatabase(decodedText);
    });
}

// Hilfsfunktion: Prüft/Speichert selbsterstellte Barcodes in Firebase Realtime Database
function checkCustomDatabase(barcode) {
  if (!database) {
    handleUnknownBarcode(barcode);
    return;
  }

  database.ref(`custom_barcodes/${barcode}`).once('value')
    .then((snapshot) => {
      const savedName = snapshot.val();

      if (savedName) {
        currentScannedName = savedName;
        productNameEl.innerText = currentScannedName;
      } else {
        handleUnknownBarcode(barcode);
      }
    })
    .catch(() => {
      handleUnknownBarcode(barcode);
    });
}

// Fragt den Nutzer nach dem Namen und speichert den Barcode dauerhaft in Firebase
function handleUnknownBarcode(barcode) {
  currentScannedName = `Präparat (EAN: ${barcode})`;
  productNameEl.innerText = currentScannedName;

  setTimeout(() => {
    const manualFix = prompt(`Barcode ${barcode} ist unbekannt. Wie heißt das Produkt?`, "");
    if (manualFix && manualFix.trim() !== "") {
      currentScannedName = manualFix.trim();
      productNameEl.innerText = currentScannedName;

      if (database) {
        database.ref(`custom_barcodes/${barcode}`).set(currentScannedName)
          .then(() => {
            console.log(`Barcode ${barcode} wurde dauerhaft als "${currentScannedName}" in Firebase gespeichert.`);
          })
          .catch(err => console.error("Fehler beim Speichern des Barcodes:", err));
      }
    }
  }, 300);
}

// Speichern in Firebase Realtime Database
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

// UI-Anzeige synchronisieren
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