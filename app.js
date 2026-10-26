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
let btnSetTime, simTimeInput, activeSimTime, intakeTimesInput;

document.addEventListener('DOMContentLoaded', () => {
  scanResult = document.getElementById('scan-result');
  productNameEl = document.getElementById('product-name');
  btnSaveSlot = document.getElementById('btn-save-slot');

  userProfileInput = document.getElementById('user-profile-input');
  btnLoadProfile = document.getElementById('btn-load-profile');
  activeProfileName = document.getElementById('active-profile-name');

  btnManualEntry = document.getElementById('btn-manual-entry');
  btnEditName = document.getElementById('btn-edit-name');

  // NEU: Elemente für Zeitsimulation & Einnahmezeiten
  btnSetTime = document.getElementById('btn-set-time');
  simTimeInput = document.getElementById('simulated-time-input');
  activeSimTime = document.getElementById('active-sim-time');
  intakeTimesInput = document.getElementById('intake-times');

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

  // 1. NEU: Test-Uhrzeit (00:00 - 24:00) live in Firebase setzen
  if (btnSetTime && simTimeInput) {
    btnSetTime.addEventListener('click', () => {
      let chosenTime = simTimeInput.value.trim();

      // Spezialfall 24:00 Uhr -> entspricht 00:00 Uhr
      if (chosenTime === "24:00") {
        chosenTime = "00:00";
      }

      if (!chosenTime) {
        chosenTime = "12:45";
      }

      if (activeSimTime) activeSimTime.innerText = `${chosenTime} Uhr`;

      if (database) {
        database.ref('/system/simulatedTime').set(chosenTime)
          .then(() => alert(`Test-Uhrzeit für ESP32-S3 auf ${chosenTime} Uhr gesetzt!`))
          .catch(err => alert("Fehler beim Setzen der Uhrzeit: " + err));
      }
    });
  }

  // 2. Manuelle Eingabe ohne Scanner -> Live in Firebase veröffentlichen
  if (btnManualEntry) {
    btnManualEntry.addEventListener('click', () => {
      const inputName = prompt("Name des Präparats / Nahrungsergänzungsmittels eingeben:", "");
      if (inputName && inputName.trim() !== "") {
        publishCurrentScan(inputName.trim());
      }
    });
  }

  // 3. Produktnamen anpassen -> Live in Firebase aktualisieren
  if (btnEditName) {
    btnEditName.addEventListener('click', () => {
      const newName = prompt("Produktname anpassen:", currentScannedName);
      if (newName && newName.trim() !== "") {
        publishCurrentScan(newName.trim());
      }
    });
  }

  // 4. HARDWARE BARCODE SCANNER INTEGRATION
  setupHardwareScannerListener();
});

// Hardware-Scanner Event Listener (Bluetooth/USB Tastatur-Emulation)
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

  // Aktives Profil zentral in Firebase sichern (für ESP32-S3)
  database.ref('/activeProfile').set(profileName);

  // A) Behälter-Daten des gewählten Profils in Echtzeit synchronisieren
  database.ref(`profiles/${profileName}`).on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      slotsData = data;
    } else {
      slotsData = {
        1: { name: 'Leer', count: 0, times: '08:00, 12:45, 18:00' },
        2: { name: 'Leer', count: 0, times: '08:00, 12:45, 18:00' },
        3: { name: 'Leer', count: 0, times: '08:00, 12:45, 18:00' },
        4: { name: 'Leer', count: 0, times: '08:00, 12:45, 18:00' }
      };
      database.ref(`profiles/${profileName}`).set(slotsData);
    }
    updateUI();
  }, (error) => {
    alert("Firebase Fehler: " + error.message);
  });

  // B) Live-Synchronisation für aktuell gescannte Produkte (Laptop <-> Smartphone)
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

  // C) Test-Uhrzeit aus Firebase synchronisieren
  database.ref('/system/simulatedTime').on('value', (snapshot) => {
    const timeVal = snapshot.val();
    if (timeVal) {
      if (simTimeInput) simTimeInput.value = timeVal;
      if (activeSimTime) activeSimTime.innerText = `${timeVal} Uhr`;
    }
  });
}

// Hilfsfunktion: Schreibt das temporäre Scan-Ergebnis live in die Cloud
function publishCurrentScan(name) {
  currentScannedName = name;
  if (database) {
    database.ref('/currentScan').set({
      name: name,
      timestamp: Date.now()
    });
  }
}

// Barcode empfangen -> Visuelles Feedback & Produktsuche
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

// Hilfsfunktion: Prüft selbsterstellte Barcodes in Firebase
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

// Unbekannter Barcode
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

// Speichern in Firebase Realtime Database (Inklusive Einnahmezeiten!)
function saveProductToSlot() {
  const selectedSlot = document.getElementById('slot-select').value;
  const count = parseInt(document.getElementById('pill-count').value) || 0;
  const times = intakeTimesInput ? (intakeTimesInput.value.trim() || "08:00, 12:45, 18:00") : "08:00, 12:45, 18:00";

  if (!currentScannedName || currentScannedName === "-") {
    alert("Bitte scann zuerst einen Barcode oder gib einen Namen ein.");
    return;
  }

  slotsData[selectedSlot] = {
    name: currentScannedName,
    count: count,
    times: times // Einnahmezeiten für den ESP32-S3 speichern
  };

  database.ref(`profiles/${currentProfile}`).set(slotsData)
    .then(() => {
      database.ref('/currentScan').remove();
      alert(`Erfolgreich gespeichert für [${currentProfile}]:\n${currentScannedName} in Behälter ${selectedSlot}\nZeiten: ${times}`);
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
      const timesDisplay = slotsData[i].times ? `⏱️ ${slotsData[i].times}` : "";

      if (nameEl) {
        nameEl.innerText = displayName;
      }
      if (countEl) {
        countEl.innerText = count;
      }

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