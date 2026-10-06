// Eure Firebase-Konfiguration mit euren Zugangsdaten
const firebaseConfig = {
  apiKey: "AIzaSyDnwoB8gFLlEOCuLd5IAe6h3SL3rVUjT-k",
  authDomain: "smartbox-db.firebaseapp.com",
  databaseURL: "https://smartbox-db-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "smartbox-db",
  storageBucket: "smartbox-db.firebasestorage.app",
  messagingSenderId: "956387582755",
  appId: "1:956387582755:web:5687600ce69a0d0bb9a296"
};

// Firebase initialisieren
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

let currentProfile = "Sebi";
let slotsData = {};
let html5QrCode = null;
let currentScannedName = "";

// Element-Referenzen
const btnStartScan = document.getElementById('btn-start-scan');
const btnStopScan = document.getElementById('btn-stop-scan');
const readerContainer = document.getElementById('reader-container');
const scanResult = document.getElementById('scan-result');
const productNameEl = document.getElementById('product-name');
const btnSaveSlot = document.getElementById('btn-save-slot');

const userProfileInput = document.getElementById('user-profile-input');
const btnLoadProfile = document.getElementById('btn-load-profile');
const activeProfileName = document.getElementById('active-profile-name');

document.addEventListener('DOMContentLoaded', () => {
  currentProfile = localStorage.getItem('smartbox_last_profile') || "Sebi";
  userProfileInput.value = currentProfile;
  
  listenToCloudData(currentProfile);

  btnStartScan.addEventListener('click', startCamera);
  btnStopScan.addEventListener('click', stopCamera);
  btnSaveSlot.addEventListener('click', saveProductToSlot);
  btnLoadProfile.addEventListener('click', () => {
    const newProfile = userProfileInput.value.trim() || "Sebi";
    currentProfile = newProfile;
    localStorage.setItem('smartbox_last_profile', currentProfile);
    listenToCloudData(currentProfile);
  });
});

// Live-Echtzeit-Verbindung zur Firebase Cloud-Datenbank
function listenToCloudData(profileName) {
  activeProfileName.innerText = profileName;

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
  });
}

// 1. Smartphone-Kamera starten
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

// 2. Barcode wurde von der Kamera erkannt
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

// 3. Kamera stoppen
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

// 4. Gescanntes Produkt DIREKT IN DER CLOUD speichern
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

// 5. Entnahme simulieren
function simulateTakePill(slotId) {
  if (slotsData[slotId] && slotsData[slotId].count > 0) {
    slotsData[slotId].count--;
    
    const ledEl = document.getElementById(`led-${slotId}`);
    ledEl.classList.add('active-green');
    setTimeout(() => ledEl.classList.remove('active-green'), 1500);

    database.ref(`profiles/${currentProfile}`).set(slotsData);
  } else {
    alert(`Behälter ${slotId} ist leer!`);
  }
}

// 6. UI aktualisieren
function updateUI() {
  for (let i = 1; i <= 4; i++) {
    if (slotsData[i]) {
      document.getElementById(`name-${i}`).innerText = slotsData[i].name;
      document.getElementById(`count-${i}`).innerText = slotsData[i].count;
    }
  }
}