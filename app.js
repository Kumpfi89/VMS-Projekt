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
let currentScannedName = "";

// Speichert pro Behälter (1-4) die Minute (HH:MM), in der in der App "Eingenommen" geklickt wurde
let acknowledgedTimes = { 1: "", 2: "", 3: "", 4: "" };

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

// DOM-Elemente
let scanResult, productNameEl, btnSaveSlot;
let userProfileInput, btnLoadProfile, activeProfileName;
let btnManualEntry, btnEditName;

document.addEventListener('DOMContentLoaded', () => {
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

  if (btnSaveSlot) btnSaveSlot.addEventListener('click', saveProductToSlot);
  
  if (btnLoadProfile) {
    btnLoadProfile.addEventListener('click', () => {
      const newProfile = userProfileInput.value.trim() || "Sebi";
      currentProfile = newProfile;
      setSafeStorage('smartbox_last_profile', currentProfile);
      listenToCloudData(currentProfile);
    });
  }

  // Manuelle Eingabe ohne Scanner
  if (btnManualEntry) {
    btnManualEntry.addEventListener('click', () => {
      const inputName = prompt("Name des Präparats / Nahrungsergänzungsmittels eingeben:", "");
      if (inputName && inputName.trim() !== "") {
        publishCurrentScan(inputName.trim());
      }
    });
  }

  // Produktnamen anpassen
  if (btnEditName) {
    btnEditName.addEventListener('click', () => {
      const newName = prompt("Produktname anpassen:", currentScannedName);
      if (newName && newName.trim() !== "") {
        publishCurrentScan(newName.trim());
      }
    });
  }

  // Hardware Barcode-Scanner Listener
  setupHardwareScannerListener();
});

// Hardware-Scanner Event Listener
function setupHardwareScannerListener() {
  let barcodePuffer = "";
  let lastKeyTime = Date.now();

  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      return;
    }

    const currentTime = Date.now();

    if (currentTime - lastKeyTime > 100) {
      barcodePuffer = "";
    }
    lastKeyTime = currentTime;

    if (e.key === 'Enter') {
      const cleanCode = barcodePuffer.trim();
      if (cleanCode.length >= 8) {
        console.log("Scanner-Signal empfangen:", cleanCode);
        onBarcodeScanned(cleanCode);
      }
      barcodePuffer = "";
    } else if (e.key.length === 1) {
      barcodePuffer += e.key;
    }
  });
}

// Echtzeit-Verbindung zur Firebase Realtime Database
function listenToCloudData(profileName) {
  if (activeProfileName) activeProfileName.innerText = profileName;

  if (!database) {
    alert("Firebase konnte nicht geladen werden.");
    return;
  }

  // Aktives Profil in Firebase sichern
  database.ref('/activeProfile').set(profileName);

  // Behälter-Daten synchronisieren
  database.ref(`profiles/${profileName}`).on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      slotsData = data;
    } else {
      slotsData = {
        1: { name: 'Leer', count: 0, times: '08:00, 12:00, 18:00' },
        2: { name: 'Leer', count: 0, times: '08:00, 12:00, 18:00' },
        3: { name: 'Leer', count: 0, times: '08:00, 12:00, 18:00' },
        4: { name: 'Leer', count: 0, times: '08:00, 12:00, 18:00' }
      };
      database.ref(`profiles/${profileName}`).set(slotsData);
    }
    updateUI();
  }, (error) => {
    alert("Firebase Fehler: " + error.message);
  });

  // Live-Synchronisation des aktuellen Scans
  database.ref('/currentScan').on('value', (snapshot) => {
    const scanData = snapshot.val();
    if (scanData && scanData.name) {
      currentScannedName = scanData.name;
      if (productNameEl) productNameEl.innerText = currentScannedName;
      if (scanResult) scanResult.classList.remove('hidden');
    } else {
      currentScannedName = "";
      if (scanResult) scanResult.classList.add('hidden');
    }
  });
}

function publishCurrentScan(name) {
  currentScannedName = name;
  if (database) {
    database.ref('/currentScan').set({
      name: name,
      timestamp: Date.now()
    });
  }
}

function onBarcodeScanned(decodedText) {
  const statusCard = document.querySelector('.scanner-status-card');
  if (statusCard) {
    statusCard.style.borderColor = '#28a745';
    statusCard.style.boxShadow = '0 0 12px rgba(40, 167, 69, 0.4)';
    setTimeout(() => {
      statusCard.style.borderColor = '';
      statusCard.style.boxShadow = '';
    }, 1000);
  }

  if (productNameEl) productNameEl.innerText = "Lade Produktdaten...";
  if (scanResult) scanResult.classList.remove('hidden');

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
        publishCurrentScan(detectedName);
      } else {
        checkCustomDatabase(decodedText);
      }
    })
    .catch(() => {
      checkCustomDatabase(decodedText);
    });
}

function checkCustomDatabase(barcode) {
  if (!database) {
    handleUnknownBarcode(barcode);
    return;
  }

  database.ref(`custom_barcodes/${barcode}`).once('value')
    .then((snapshot) => {
      const savedName = snapshot.val();
      if (savedName) {
        publishCurrentScan(savedName);
      } else {
        handleUnknownBarcode(barcode);
      }
    })
    .catch(() => {
      handleUnknownBarcode(barcode);
    });
}

function handleUnknownBarcode(barcode) {
  const fallbackName = `Präparat (EAN: ${barcode})`;
  publishCurrentScan(fallbackName);

  setTimeout(() => {
    const manualFix = prompt(`Barcode ${barcode} ist unbekannt. Wie heißt das Produkt?`, "");
    if (manualFix && manualFix.trim() !== "") {
      const cleanName = manualFix.trim();
      publishCurrentScan(cleanName);

      if (database) {
        database.ref(`custom_barcodes/${barcode}`).set(cleanName)
          .then(() => console.log(`Barcode ${barcode} wurde gespeichert.`))
          .catch(err => console.error("Fehler beim Speichern:", err));
      }
    }
  }, 300);
}

// Speichern der ausgefüllten Einnahmezeiten (1 bis 5 Zeiten)
function saveProductToSlot() {
  const selectedSlot = document.getElementById('slot-select').value;
  const count = parseInt(document.getElementById('pill-count').value) || 0;

  const timeInputs = document.querySelectorAll('.intake-time-input');
  const timesArray = [];

  timeInputs.forEach(input => {
    const val = input.value.trim();
    if (val !== "" && !timesArray.includes(val)) {
      timesArray.push(val);
    }
  });

  const formattedTimes = timesArray.join(', ');

  if (!currentScannedName || currentScannedName === "-") {
    alert("Bitte scann zuerst einen Barcode oder gib einen Namen ein.");
    return;
  }

  slotsData[selectedSlot] = {
    name: currentScannedName,
    count: count,
    times: formattedTimes || "08:00"
  };

  database.ref(`profiles/${currentProfile}`).set(slotsData)
    .then(() => {
      database.ref('/currentScan').remove();
      alert(`Erfolgreich gespeichert für [${currentProfile}]:\n${currentScannedName} in Behälter ${selectedSlot}\nEinnahmezeiten: ${formattedTimes || "Keine festgelegt"}`);
    })
    .catch(err => alert("Speicherfehler: " + err));
}

// Hilfsfunktion: Gibt die aktuelle lokale Uhrzeit im Format HH:MM zurück
function getFormattedCurrentTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Entnahme durch Button "Eingenommen"
function simulateTakePill(slotId) {
  if (slotsData[slotId] && slotsData[slotId].count > 0) {
    slotsData[slotId].count--;
    
    if (slotsData[slotId].count === 0) {
      slotsData[slotId].name = "Leer";
    }

    // Einnahme für die aktuelle Minute in der Web-App quittieren
    const currentTime = getFormattedCurrentTime();
    acknowledgedTimes[slotId] = currentTime;

    // Kurzes visuelles Aufleuchten der LED
    const ledEl = document.getElementById(`led-${slotId}`);
    if (ledEl) {
      ledEl.classList.add('active-green');
      setTimeout(() => ledEl.classList.remove('active-green'), 1000);
    }

    // Nach Firebase schreiben (Synchronisation mit ESP32-S3)
    database.ref(`profiles/${currentProfile}`).set(slotsData);
    
    // UI sofort aktualisieren
    updateUI();
  } else {
    alert(`Behälter ${slotId} ist bereits leer!`);
  }
}

// UI-Anzeige: Virtuelle LEDs & Linker Kachellrand synchron mit dem ESP32-S3 ansteuern
function updateUI() {
  const currentTime = getFormattedCurrentTime();

  for (let i = 1; i <= 4; i++) {
    if (slotsData[i]) {
      const nameEl = document.getElementById(`name-${i}`);
      const countEl = document.getElementById(`count-${i}`);
      const timesEl = document.getElementById(`times-${i}`);
      const cardEl = document.getElementById(`slot-card-${i}`);
      const ledEl = document.getElementById(`led-${i}`);

      const count = slotsData[i].count || 0;
      const displayName = (count === 0) ? "Leer" : (slotsData[i].name || "Leer");
      const timesStr = slotsData[i].times || "";
      const timesDisplay = (count === 0) ? "" : (timesStr ? `⏱️ Einnahme: ${timesStr}` : "⏱️ Keine Zeiten");

      if (nameEl) nameEl.innerText = displayName;
      if (countEl) countEl.innerText = count;
      if (timesEl) timesEl.innerText = timesDisplay;

      if (cardEl && ledEl) {
        // Alle dynamischen LED- und Kachel-Klassen zurücksetzen
        ledEl.classList.remove('green', 'red', 'active-green', 'blink-green', 'blink-red');
        cardEl.classList.remove('empty-slot', 'filled-slot', 'due-intake', 'warning-slot', 'empty-blink');

        // Prüfen, ob die aktuelle Uhrzeit in den eingestellten Einnahmezeiten enthalten ist
        const isDue = timesStr && timesStr.indexOf(currentTime) !== -1;

        // Prüfen, ob für diese Minute bereits in der App "Eingenommen" geklickt wurde
        const alreadyTakenInApp = (acknowledgedTimes[i] === currentTime);

        // ZUSTAND 1: Einnahmezeit erreicht, Tabletten da UND NOCH NICHT quittiert -> GRÜNER RAND & LED BLINKEN
        if (isDue && count > 0 && !alreadyTakenInApp) {
          ledEl.classList.add('blink-green');
          cardEl.classList.add('due-intake');
        }
        // ZUSTAND 2: 0 Tabletten (Leer) -> ROTER RAND & LED BLINKEN
        else if (count === 0) {
          ledEl.classList.add('blink-red');
          cardEl.classList.add('empty-blink');
        }
        // ZUSTAND 3: 1 bis 5 Tabletten (Nachfüllwarnung) -> ORANGER RAND & ROTE LED DAUERHAFT
        else if (count >= 1 && count <= 5) {
          ledEl.classList.add('red');
          cardEl.classList.add('warning-slot');
        }
        // ZUSTAND 4: Normalbetrieb / Nach der Einnahme -> STANDARDRAND (GRÜN DEZENT), LED AUS
        else {
          cardEl.classList.add('filled-slot');
        }
      }
    }
  }
}

// Automatische Sekundenauswertung für zeitgenaue LED- & Rand-Updates
setInterval(() => {
  updateUI();
}, 1000);