// =========================================================================
// BAGIAN 1: KONFIGURASI, KONEKSI MQTT REMOTE HP & JADWAL ADZAN KEMENAG
// =========================================================================
const defaultConfig = {
  name: "Muhammad Nasrul Mahdi Ibnu Rowi",
  theme: "dark",
  gmt: 7,
  switchHour: 15,
  prayerCity: "Kab. Bogor",
  prayerOffset: 0,
  alarmEnabled: "true",
  weatherMode: "auto",
  weatherName: "Cisarua, Bogor",
  weatherCoords: "-6.6745, 106.9325",
  eventName: "Ujian Akhir Semester",
  eventDate: "2026-12-07",
  ticker: "Belajar itu capek, tapi bodoh lebih mahal. Kesalahan saat belajar adalah biasa, yang bahaya kalau malas mencoba!",
  todos: "PR Matematika Hal 45, Tugas Merangkum Sejarah, Bawa Baju Olahraga",
  schedule: {
    1: "Putih Abu-Abu + Topi | Upacara, Matematika, Bahasa Indonesia, Fisika",
    2: "Putih Abu-Abu | Bahasa Inggris, Kimia, Sejarah, Seni Budaya",
    3: "Batik Sekolah | Biologi, Ekonomi, Geografi, PPKn",
    4: "Baju Olahraga / Praktek | Penjasorkes, Informatika, Bahasa Sunda",
    5: "Baju Muslim / Koko | Pendidikan Agama Islam, Prakarya",
    6: "Kaos Ekskul / Bebas | Ekstrakurikuler, Kerja Kelompok",
    0: "Libur | Istirahat, Review Materi, Siapkan Buku Besok"
  }
};

function loadSavedConfig() {
  try {
    const saved = localStorage.getItem("tvDashboardConfig");
    if (saved) return { ...defaultConfig, ...JSON.parse(saved) };
  } catch (e) {}
  return { ...defaultConfig };
}

let config = loadSavedConfig();
let prayerTimes = { Subuh: "04:15", Dzuhur: "11:45", Ashar: "15:05", Maghrib: "17:55", Isya: "19:08" };
let lastTriggeredPrayer = "";
let lastFetchedDate = "";
let mqttClient = null;
let currentCode = "";

const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Koneksi MQTT Super Cepat untuk Remote HP
function initPeerReceiver() {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }

  currentCode = Math.floor(100000 + Math.random() * 900000).toString();
  document.getElementById("dispRandomCode").textContent = currentCode;
  document.getElementById("connStatus").textContent = "Menghubungkan ke server...";

  const topicBase = "smarttv-dash-id/" + currentCode;
  mqttClient = mqtt.connect("wss://broker.emqx.io:8084/mqtt", {
    clientId: "tv_" + currentCode + "_" + Math.random().toString(16).slice(2, 6),
    clean: true,
    connectTimeout: 5000
  });

  mqttClient.on("connect", () => {
    mqttClient.subscribe(topicBase + "/cmd", (err) => {
      if (!err) {
        document.getElementById("connStatus").textContent = "Siap! Silakan masukkan kode ini di HP Anda.";
      }
    });
  });

  mqttClient.on("message", (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      if (!data || !data.type) return;

      // HP meminta data pengaturan saat ini
      if (data.type === "HELLO_FROM_HP") {
        document.getElementById("connStatus").textContent = "HP berhasil terhubung! Mengatur di HP...";
        mqttClient.publish(topicBase + "/sync", JSON.stringify({
          type: "SYNC_CONFIG",
          payload: config
        }));
      }
      // HP mengirim pengaturan baru
      else if (data.type === "UPDATE_CONFIG" && data.payload) {
        closeCodeModal();
        showLoadingAndApply(data.payload);
      }
      // HP menekan tombol tes alarm
      else if (data.type === "TEST_ADZAN") {
        triggerAdzan("Test Adzan dari HP");
      }
    } catch (e) {}
  });

  mqttClient.on("error", () => {
    document.getElementById("connStatus").textContent = "Koneksi bermasalah, mencoba ulang...";
  });
}

function openCodeModal() {
  document.getElementById("codeModal").classList.add("active");
  initPeerReceiver();
}

function closeCodeModal() {
  document.getElementById("codeModal").classList.remove("active");
}

function showLoadingAndApply(newConfig) {
  const loader = document.getElementById("loadingScreen");
  loader.classList.add("active");

  setTimeout(() => {
    config = { ...defaultConfig, ...newConfig };
    try {
      localStorage.setItem("tvDashboardConfig", JSON.stringify(config));
    } catch (e) {}

    lastFetchedDate = "";
    applyConfigToUI();
    updateClock();
    loader.classList.remove("active");
  }, 2000);
}

function adjustTimeMinutes(timeStr, offsetMinutes) {
  if (!timeStr || !offsetMinutes || offsetMinutes === 0) return timeStr;
  const parts = timeStr.split(":");
  if (parts.length < 2) return timeStr;

  const h = parseInt(parts, 10);
  const m = parseInt(parts, 10);
  const dateObj = new Date(2000, 0, 1, h, m + parseInt(offsetMinutes, 10));
  return `${String(dateObj.getHours()).padStart(2, "0")}:${String(dateObj.getMinutes()).padStart(2, "0")}`;
}

async function fetchPrayerTimes(dateStrYYYYMMDD) {
  const cityQuery = (config.prayerCity || "Kab. Bogor").trim();
  const offset = parseInt(config.prayerOffset, 10) || 0;

  try {
    const searchRes = await fetch(`https://myquran.com{encodeURIComponent(cityQuery)}`);
    const searchData = await searchRes.json();

    if (searchData.status && Array.isArray(searchData.data) && searchData.data.length > 0) {
      const cityId = searchData.data.id;
      const [year, month, day] = dateStrYYYYMMDD.split("-");

      const schedRes = await fetch(`https://myquran.com{cityId}/${year}/${month}/${day}`);
      const schedData = await schedRes.json();

      if (schedData.status && schedData.data && schedData.data.jadwal) {
        const j = schedData.data.jadwal;
        prayerTimes = {
          Subuh: adjustTimeMinutes(j.subuh, offset),
          Dzuhur: adjustTimeMinutes(j.dzuhur, offset),
          Ashar: adjustTimeMinutes(j.ashar, offset),
          Maghrib: adjustTimeMinutes(j.maghrib, offset),
          Isya: adjustTimeMinutes(j.isya, offset)
        };
        updatePrayerUI();
        return;
      }
    }
    throw new Error("Kota tidak ditemukan di myQuran");
  } catch (err) {
    try {
      const res = await fetch(`https://aladhan.com{encodeURIComponent(cityQuery)}&country=Indonesia&method=20`);
      const data = await res.json();
      if (data.code === 200 && data.data && data.data.timings) {
        const t = data.data.timings;
        prayerTimes = {
          Subuh: adjustTimeMinutes(t.Fajr.slice(0, 5), offset),
          Dzuhur: adjustTimeMinutes(t.Dhuhr.slice(0, 5), offset),
          Ashar: adjustTimeMinutes(t.Asr.slice(0, 5), offset),
          Maghrib: adjustTimeMinutes(t.Maghrib.slice(0, 5), offset),
          Isya: adjustTimeMinutes(t.Isha.slice(0, 5), offset)
        };
        updatePrayerUI();
      }
    } catch (e) {}
  }
}

function updatePrayerUI() {
  document.getElementById("pSubuh").textContent = prayerTimes.Subuh;
  document.getElementById("pDzuhur").textContent = prayerTimes.Dzuhur;
  document.getElementById("pAshar").textContent = prayerTimes.Ashar;
  document.getElementById("pMaghrib").textContent = prayerTimes.Maghrib;
  document.getElementById("pIsya").textContent = prayerTimes.Isya;
}


// 
// =========================================================================
// BAGIAN 2: ALARM ADZAN, PELACAKAN CUACA & JAM REAL-TIME
// =========================================================================
function checkPrayerStatus(currentHHMM) {
  const order = ["Subuh", "Dzuhur", "Ashar", "Maghrib", "Isya"];
  let nextName = "Subuh (Besok)";
  let nextTime = prayerTimes.Subuh;

  for (const name of order) {
    if (currentHHMM < prayerTimes[name]) {
      nextName = name;
      nextTime = prayerTimes[name];
      break;
    }
  }

  document.getElementById("dispNextPrayer").textContent = `Adzan Selanjutnya: ${nextName} ${nextTime}`;

  for (const name of order) {
    const triggerKey = `${name}-${currentHHMM}`;
    if (currentHHMM === prayerTimes[name] && lastTriggeredPrayer !== triggerKey) {
      lastTriggeredPrayer = triggerKey;
      if (String(config.alarmEnabled) === "true") triggerAdzan(name);
    }
  }
}

function triggerAdzan(prayerName) {
  document.getElementById("adzanTitle").textContent = `Waktunya Sholat ${prayerName}!`;
  document.getElementById("adzanAlert").classList.add("active");
  const audio = document.getElementById("adzanAudio");
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }
}

function stopAdzan() {
  document.getElementById("adzanAlert").classList.remove("active");
  const audio = document.getElementById("adzanAudio");
  if (audio) audio.pause();
}

async function fetchWeather() {
  const locEl = document.getElementById("dispWeatherLoc");
  if (locEl) locEl.textContent = "Melacak lokasi...";

  if (config.weatherMode === "auto") {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const cityName = await reverseGeocode(lat, lon);
          await loadWeatherByCoords(lat, lon, cityName);
        },
        async () => {
          await detectLocationByIP();
        },
        { timeout: 6000, maximumAge: 300000 }
      );
    } else {
      await detectLocationByIP();
    }
  } else {
    try {
      const cityQuery = (config.weatherName || "Bogor").trim();
      const geoRes = await fetch(`https://open-meteo.com{encodeURIComponent(cityQuery)}&count=1&language=id&format=json`);
      const geoData = await geoRes.json();

      if (geoData.results && geoData.results.length > 0) {
        const place = geoData.results[0];
        const displayName = place.admin2 ? `${place.name}, ${place.admin2}` : place.name;
        await loadWeatherByCoords(place.latitude, place.longitude, displayName);
      } else {
        const [lat, lon] = config.weatherCoords.split(",").map(s => s.trim());
        await loadWeatherByCoords(lat, lon, config.weatherName);
      }
    } catch (e) {
      if (locEl) locEl.textContent = config.weatherName;
    }
  }
}

async function detectLocationByIP() {
  try {
    const ipRes = await fetch("https://ipapi.co");
    const ipData = await ipRes.json();
    if (ipData && ipData.latitude && ipData.longitude) {
      const locLabel = ipData.city ? `${ipData.city}, ${ipData.region}` : "Lokasi Terdeteksi";
      await loadWeatherByCoords(ipData.latitude, ipData.longitude, locLabel);
      return;
    }
  } catch (e) {}

  const [lat, lon] = config.weatherCoords.split(",").map(s => s.trim());
  await loadWeatherByCoords(lat, lon, config.weatherName);
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`https://bigdatacloud.net{lat}&longitude=${lon}&localityLanguage=id`);
    const data = await res.json();
    const locality = data.locality || data.city || "";
    const city = data.city || data.principalSubdivision || "";
    if (locality && city && locality !== city) return `${locality}, ${city}`;
    return locality || city || "Lokasi GPS Terdeteksi";
  } catch (e) {
    return "Lokasi GPS Terdeteksi";
  }
}

async function loadWeatherByCoords(lat, lon, locationLabel) {
  try {
    const res = await fetch(`https://open-meteo.com{lat}&longitude=${lon}&current_weather=true`);
    const data = await res.json();
    const cw = data.current_weather;

    document.getElementById("dispTemp").textContent = `${Math.round(cw.temperature)}°C`;
    document.getElementById("dispWeatherLoc").textContent = locationLabel;

    const code = cw.weathercode;
    let desc = "Cerah";
    let iconFile = "icons/sunny.png";

    if (code >= 1 && code <= 3) { desc = "Berawan"; iconFile = "icons/cloudy.png"; }
    else if (code >= 45 && code <= 48) { desc = "Berkabut"; iconFile = "icons/fog.png"; }
    else if (code >= 51 && code <= 67) { desc = "Hujan"; iconFile = "icons/rain.png"; }
    else if (code >= 80 && code <= 99) { desc = "Hujan Petir"; iconFile = "icons/storm.png"; }

    document.getElementById("dispWeatherDesc").textContent = desc;
    const weatherImg = document.getElementById("dispWeatherIcon");
    if (weatherImg) {
      weatherImg.style.display = "block";
      weatherImg.src = iconFile;
    }
  } catch (e) {
    document.getElementById("dispWeatherLoc").textContent = locationLabel;
  }
}

function applyConfigToUI() {
  document.body.className = config.theme === "light" ? "light-theme" : "";
  document.getElementById("dispName").textContent = config.name;

  const gmtVal = parseInt(config.gmt, 10) || 0;
  document.getElementById("dispGmt").textContent = `GMT ${gmtVal >= 0 ? "+" : ""}${gmtVal}:00`;
  document.getElementById("dispTicker").textContent = config.ticker;

  const todoListEl = document.getElementById("dispTodoList");
  todoListEl.innerHTML = "";
  const todos = (config.todos || "").split(",").map(t => t.trim()).filter(Boolean);

  if (todos.length === 0) {
    todoListEl.innerHTML = `
      <li class="empty-todo">
        <img src="icons/done.png" alt="Done" class="icon-sm" onerror="this.style.display='none'">
        <span>Tidak ada PR / tugas menumpuk!</span>
      </li>`;
  } else {
    todos.forEach(item => {
      const li = document.createElement("li");
      li.textContent = item;
      todoListEl.appendChild(li);
    });
  }

  if (config.eventDate) {
    const target = new Date(config.eventDate + "T00:00:00");
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target - now) / (1000 * 60 * 60 * 24));
    const badge = document.getElementById("dispCountdown");

    if (diffDays > 0) badge.textContent = `${config.eventName}: ${diffDays} Hari Lagi`;
    else if (diffDays === 0) badge.textContent = `Hari Ini: ${config.eventName}!`;
    else badge.textContent = `${config.eventName} Selesai`;
  }

  fetchWeather();
}

function updateClock() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const gmtOffset = parseInt(config.gmt, 10) || 7;
  const localTime = new Date(utc + 3600000 * gmtOffset);

  const year = localTime.getFullYear();
  const month = String(localTime.getMonth() + 1).padStart(2, "0");
  const day = String(localTime.getDate()).padStart(2, "0");
  const todayStr = `${year}-${month}-${day}`;

  if (lastFetchedDate !== todayStr) {
    lastFetchedDate = todayStr;
    fetchPrayerTimes(todayStr);
  }

  const h = String(localTime.getHours()).padStart(2, "0");
  const m = String(localTime.getMinutes()).padStart(2, "0");
  const s = String(localTime.getSeconds()).padStart(2, "0");

  document.getElementById("dispClock").textContent = `${h}.${m}.${s}`;

  const dayIdx = localTime.getDay();
  document.getElementById("dispDate").textContent =
    `${NAMA_HARI[dayIdx]}, ${localTime.getDate()} ${NAMA_BULAN[localTime.getMonth()]} ${year}`;

  const switchHour = parseInt(config.switchHour, 10) || 15;
  const isTomorrow = localTime.getHours() >= switchHour;
  const targetDayIdx = isTomorrow ? (dayIdx + 1) % 7 : dayIdx;

  document.getElementById("dispScheduleDay").textContent = isTomorrow
    ? `Besok (${NAMA_HARI[targetDayIdx]})`
    : `Hari Ini (${NAMA_HARI[dayIdx]})`;

  const rawSched = (config.schedule && config.schedule[targetDayIdx]) || "Bebas | Tidak ada jadwal";
  const [uniform, mapelsStr] = rawSched.split("|");

  document.getElementById("dispUniform").textContent = `Seragam: ${(uniform || "Bebas").trim()}`;

  const mapelListEl = document.getElementById("dispMapelList");
  mapelListEl.innerHTML = "";
  (mapelsStr || "").split(",").forEach(mItem => {
    if (mItem.trim()) {
      const li = document.createElement("li");
      li.textContent = mItem.trim();
      mapelListEl.appendChild(li);
    }
  });

  checkPrayerStatus(`${h}:${m}`);
}

applyConfigToUI();
updateClock();
setInterval(updateClock, 1000);
setInterval(fetchWeather, 600000);
