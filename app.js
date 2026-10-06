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

// Kamera-Logik
function startCamera() {
  readerContainer.classList.remove('hidden');
  scanResult.classList.add('hidden');
  btnStartScan.classList.add('hidden');

  html5QrCode = new Html5Qrcode("reader");
  
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    onBarcodeScanned
  ).catch(err => {
    alert("Kamera-Fehler: " + err);
    stopCamera();
  });
}

function onBarcodeScanned(decodedText) {
  stopCamera();
  
  productNameEl.innerText = "Lade Produktdaten...";
  scanResult.classList.remove('hidden');

  fetch(`https://world.openfoodfacts.org/api/v0/product/${decodedText}.json`)
    .then(res => res.json())
    .then(data => {
      if (data.product && data.product.product_name) {
        currentScannedName = data.product.product_name;
      } else {
        currentScannedName = "Präparat (EAN: " + decodedText + ")";
      }
      productNameEl.innerText = currentScannedName;
    })
    .catch(() => {
      currentScannedName = "Präparat (EAN: " + decodedText + ")";
      productNameEl.innerText = currentScannedName;
    });
}

function stopCamera() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      readerContainer.classList.add('hidden');
      btnStartScan.classList.remove('hidden');
    }).catch(() => {});
  } else {
    readerContainer.classList.add('hidden');
    btnStartScan.classList.remove('hidden');
  }
}

// In der Cloud speichern
function saveProductToSlot() {
  const selectedSlot = document.getElementById('slot-select').value;
  const count = parseInt(document.getElementById('pill-count').value) || 0;

  slotsData[selectedSlot] = {
    name: currentScannedName,
    count: count
  };

  database.ref(`profiles/${currentProfile}`).set(slotsData)
    .then(() => {
      scanResult.classList.add('hidden');
      alert(`In der Cloud gespeichert für [${currentProfile}]: ${currentScannedName} in Behälter ${selectedSlot}!`);
    })
    .catch(err => alert("Speicherfehler: " + err));
}

// Entnahme simulieren
function simulateTakePill(slotId) {
  if (slotsData[slotId] && slotsData[slotId].count > 0) {
    slotsData[slotId].count--;
    
    const ledEl = document.getElementById(`led-${slotId}`);
    if (ledEl) {
      ledEl.classList.add('active-green');
      setTimeout(() => ledEl.classList.remove('active-green'), 1500);
    }

    database.ref(`profiles/${currentProfile}`).set(slotsData);
  } else {
    alert(`Behälter ${slotId} ist leer!`);
  }
}

// UI aktualisieren
function updateUI() {
  for (let i = 1; i <= 4; i++) {
    if (slotsData[i]) {
      const nameEl = document.getElementById(`name-${i}`);
      const countEl = document.getElementById(`count-${i}`);
      if (nameEl) nameEl.innerText = slotsData[i].name;
      if (countEl) countEl.innerText = slotsData[i].count;
    }
  }
}