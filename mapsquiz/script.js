"use strict";

// Редактируйте этот массив, чтобы заменить фотографии, координаты и ответы.
const locations = [
  { id: "location-1", image: "./assets/photos/photo-1.jpg", coordinates: { lat: 55.827423, lng: 37.571622 }, answer: "Москва" },
  { id: "location-2", image: "./assets/photos/photo-2.jpg", coordinates: { lat: 55.6554789, lng: 38.0740981 }, answer: "д. Вялки" },
  { id: "location-3", image: "./assets/photos/photo-3.jpg", coordinates: { lat: 43.2015348, lng: 19.0889712 }, answer: "Чуревац, Тара Каньон" },
  { id: "location-4", image: "./assets/photos/photo-4.jpg", coordinates: { lat: 44.2226542, lng: 39.9056033 }, answer: "Гуамское ущелье" },
  { id: "location-5", image: "./assets/photos/photo-5.jpg", coordinates: { lat: 41.2917178, lng: 69.2444365 }, answer: "Ташкент" }
];

const PRIZE_URL = "https://www.ozon.ru/geo/moskva/1404736/";
const TELEGRAM_URL = "https://t.me/efilonov";
const INITIAL_MAP_CENTER = [55.7558, 37.6176];
const INITIAL_MAP_ZOOM = 4;
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const STORAGE_KEY = "mapsquiz-state-v1";

const elements = {
  appError: document.querySelector("#appError"), gameLayout: document.querySelector("#gameLayout"),
  photoPanel: document.querySelector("#photoPanel"), progress: document.querySelector("#roundProgress"),
  attempts: document.querySelector("#attemptsText"), photo: document.querySelector("#locationPhoto"),
  fallback: document.querySelector("#photoFallback"), photoPath: document.querySelector("#photoPath"),
  answer: document.querySelector("#answerName"), hint: document.querySelector("#hint"),
  next: document.querySelector("#nextButton"), mapError: document.querySelector("#mapError"),
  modal: document.querySelector("#victoryModal"), prize: document.querySelector("#prizeLink"),
  telegram: document.querySelector("#telegramLink"), modalAttempts: document.querySelector("#modalAttempts"),
  copyStats: document.querySelector("#copyStatsButton"), copyStatus: document.querySelector("#copyStatus"),
  viewMap: document.querySelector("#viewMapButton"), modalReset: document.querySelector("#modalResetButton"),
  summary: document.querySelector("#finalSummary"), finalAttempts: document.querySelector("#finalAttempts"),
  summaryReset: document.querySelector("#summaryResetButton"), canvas: document.querySelector("#celebrationCanvas")
};

const game = {
  map: null, state: null, currentGuessMarker: null, temporaryLine: null,
  completedLayers: [], previousAttempt: null, roundLocked: false, celebrationFrame: null
};

function validateLocations() {
  const errors = [];
  const ids = new Set();
  if (locations.length !== 5) errors.push("В конфигурации должно быть ровно 5 мест.");
  locations.forEach((location, index) => {
    const label = `Место ${index + 1}`;
    if (!location.id || typeof location.id !== "string") errors.push(`${label}: отсутствует id.`);
    if (!location.image || typeof location.image !== "string") errors.push(`${label}: отсутствует image.`);
    if (!location.answer || typeof location.answer !== "string") errors.push(`${label}: отсутствует answer.`);
    if (!Number.isFinite(location.coordinates?.lat) || location.coordinates.lat < -90 || location.coordinates.lat > 90) errors.push(`${label}: некорректная широта.`);
    if (!Number.isFinite(location.coordinates?.lng) || location.coordinates.lng < -180 || location.coordinates.lng > 180) errors.push(`${label}: некорректная долгота.`);
    if (ids.has(location.id)) errors.push(`${label}: id должен быть уникальным.`);
    ids.add(location.id);
  });
  if (errors.length) {
    console.error("Ошибки конфигурации mapsquiz:", errors);
    elements.appError.textContent = "Не удалось запустить игру: проверьте конфигурацию мест в script.js.";
    elements.appError.hidden = false;
    return false;
  }
  return true;
}

function shuffleLocations() {
  const ids = locations.map(({ id }) => id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

function createInitialState() {
  return { order: shuffleLocations(), currentIndex: 0, completed: [], attemptsById: {}, totalAttempts: 0, finished: false };
}

function isValidSavedState(value) {
  if (!value || !Array.isArray(value.order) || value.order.length !== locations.length) return false;
  const validIds = new Set(locations.map(({ id }) => id));
  if (new Set(value.order).size !== locations.length || value.order.some((id) => !validIds.has(id))) return false;
  if (!Number.isInteger(value.currentIndex) || value.currentIndex < 0 || value.currentIndex >= locations.length) return false;
  if (!Array.isArray(value.completed) || !Number.isFinite(value.totalAttempts) || typeof value.attemptsById !== "object") return false;
  return value.completed.every((item) => validIds.has(item.id) && Number.isFinite(item.guess?.lat) && Number.isFinite(item.guess?.lng));
}

function loadGameState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return isValidSavedState(saved) ? saved : createInitialState();
  } catch (error) {
    console.warn("Сохранение игры повреждено и было сброшено.", error);
    localStorage.removeItem(STORAGE_KEY);
    return createInitialState();
  }
}

function saveGameState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(game.state)); }
  catch (error) { console.warn("Не удалось сохранить прогресс игры.", error); }
}

function initializeMap() {
  if (typeof window.L === "undefined") {
    elements.mapError.hidden = false;
    return false;
  }
  try {
    game.map = L.map("map", { worldCopyJump: true }).setView(INITIAL_MAP_CENTER, INITIAL_MAP_ZOOM);
    const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION });
    tiles.on("tileerror", () => { elements.mapError.hidden = false; });
    tiles.on("load", () => { elements.mapError.hidden = true; });
    tiles.addTo(game.map);
    game.map.on("click", handleMapClick);
    return true;
  } catch (error) {
    console.error("Ошибка инициализации карты:", error);
    elements.mapError.hidden = false;
    return false;
  }
}

function getCurrentLocation() {
  return locations.find(({ id }) => id === game.state.order[game.state.currentIndex]);
}

function renderCurrentRound() {
  const location = getCurrentLocation();
  game.roundLocked = false;
  game.previousAttempt = null;
  removeTransientLayers();
  document.body.classList.remove("final-mode");
  elements.summary.hidden = true;
  elements.photoPanel.hidden = false;
  elements.progress.textContent = `Фото ${game.state.currentIndex + 1} из ${locations.length}`;
  const count = game.state.attemptsById[location.id] || 0;
  elements.attempts.textContent = `Попыток: ${count} · всего: ${game.state.totalAttempts}`;
  elements.answer.hidden = true;
  elements.next.hidden = true;
  setHint("Нажми на карту, чтобы сделать попытку.", "neutral");
  elements.fallback.hidden = true;
  elements.photo.hidden = false;
  elements.photo.alt = `Фотография №${game.state.currentIndex + 1}: угадай место съёмки`;
  elements.photo.onload = () => { elements.photo.hidden = false; elements.fallback.hidden = true; };
  elements.photo.onerror = () => {
    elements.photo.hidden = true;
    elements.fallback.hidden = false;
    elements.photoPath.textContent = location.image;
  };
  elements.photo.src = location.image;
  requestAnimationFrame(() => game.map?.invalidateSize());
}

function restoreCurrentRound() {
  renderCurrentRound();
  const location = getCurrentLocation();
  const completed = game.state.completed.find(({ id }) => id === location.id);
  if (!completed) return;
  game.roundLocked = true;
  elements.answer.textContent = location.answer;
  elements.answer.hidden = false;
  setHint(`Угадано! Это ${location.answer}.`, "success");
  elements.next.hidden = false;
}

function calculateDistanceKm(pointA, pointB) {
  const radius = 6371;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(pointB.lat - pointA.lat);
  const longitudeDelta = toRadians(pointB.lng - pointA.lng);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(toRadians(pointA.lat)) * Math.cos(toRadians(pointB.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDistanceCategory(distanceKm) {
  if (distanceKm <= 1) return { key: "success", text: "Угадано!" };
  if (distanceKm <= 10) return { key: "boiling", text: "Очень горячо!" };
  if (distanceKm <= 100) return { key: "hot", text: "Горячо!" };
  if (distanceKm <= 1000) return { key: "warm", text: "Тепло." };
  return { key: "cold", text: "Холодно." };
}

function getTemperatureComparison(previousAttempt, currentAttempt) {
  if (!previousAttempt || previousAttempt.category !== currentAttempt.category) return "";
  const relativeDifference = Math.abs(currentAttempt.distance - previousAttempt.distance) / Math.max(previousAttempt.distance, 0.001);
  if (relativeDifference <= 0.01) return "Примерно так же.";
  return currentAttempt.distance < previousAttempt.distance ? "Теплее!" : "Холоднее!";
}

function createIcon(type) {
  const isAnswer = type === "answer";
  return L.divIcon({
    className: `${type}-marker`,
    html: isAnswer ? '<span class="marker-star" aria-hidden="true">★</span>' : '<span class="marker-dot" aria-hidden="true"></span>',
    iconSize: isAnswer ? [30, 30] : [20, 20], iconAnchor: isAnswer ? [15, 15] : [10, 10]
  });
}

function showGuessMarker(coordinates) {
  if (game.currentGuessMarker) game.map.removeLayer(game.currentGuessMarker);
  game.currentGuessMarker = L.marker(coordinates, { icon: createIcon("guess"), keyboard: false, interactive: false }).addTo(game.map);
}

function setHint(text, category) {
  elements.hint.className = `hint hint-${category}`;
  elements.hint.textContent = text;
}

function handleMapClick(event) {
  if (game.roundLocked || game.state.finished) return;
  const location = getCurrentLocation();
  const guess = { lat: event.latlng.lat, lng: event.latlng.lng };
  const distance = calculateDistanceKm(guess, location.coordinates);
  const category = getDistanceCategory(distance);
  game.state.totalAttempts += 1;
  game.state.attemptsById[location.id] = (game.state.attemptsById[location.id] || 0) + 1;
  elements.attempts.textContent = `Попыток: ${game.state.attemptsById[location.id]} · всего: ${game.state.totalAttempts}`;
  showGuessMarker(guess);
  saveGameState();
  if (category.key === "success") {
    completeCurrentRound(guess);
    return;
  }
  const currentAttempt = { distance, category: category.key };
  const comparison = getTemperatureComparison(game.previousAttempt, currentAttempt);
  setHint(comparison || category.text, category.key);
  game.previousAttempt = currentAttempt;
}

function addCompletedMarkers(completed) {
  const location = locations.find(({ id }) => id === completed.id);
  if (!location) return;
  const answerMarker = L.marker(location.coordinates, { icon: createIcon("answer"), keyboard: false })
    .bindPopup(`${location.answer} — правильное место`).addTo(game.map);
  const playerMarker = L.marker(completed.guess, { icon: createIcon("player"), keyboard: false })
    .bindPopup(`${location.answer} — твой успешный ответ`).addTo(game.map);
  game.completedLayers.push(answerMarker, playerMarker);
}

function completeCurrentRound(guessCoordinates) {
  const location = getCurrentLocation();
  game.roundLocked = true;
  if (game.currentGuessMarker) { game.map.removeLayer(game.currentGuessMarker); game.currentGuessMarker = null; }
  const completed = {
    id: location.id,
    guess: guessCoordinates,
    distanceMeters: Math.round(calculateDistanceKm(guessCoordinates, location.coordinates) * 1000)
  };
  game.state.completed.push(completed);
  addCompletedMarkers(completed);
  game.temporaryLine = L.polyline([guessCoordinates, location.coordinates], { color: "#ffd84a", weight: 3, dashArray: "7 8", interactive: false }).addTo(game.map);
  elements.answer.textContent = location.answer;
  elements.answer.hidden = false;
  setHint(`Угадано! Это ${location.answer}.`, "success");
  if (game.state.currentIndex === locations.length - 1) {
    game.state.finished = true;
    saveGameState();
    window.setTimeout(showVictoryModal, 450);
  } else {
    elements.next.hidden = false;
    saveGameState();
  }
}

function removeTransientLayers() {
  if (!game.map) return;
  if (game.currentGuessMarker) game.map.removeLayer(game.currentGuessMarker);
  if (game.temporaryLine) game.map.removeLayer(game.temporaryLine);
  game.currentGuessMarker = null;
  game.temporaryLine = null;
}

function renderCompletedMarkers() {
  game.completedLayers.forEach((layer) => game.map.removeLayer(layer));
  game.completedLayers = [];
  game.state.completed.forEach(addCompletedMarkers);
}

function goToNextRound() {
  if (!game.roundLocked || game.state.finished) return;
  game.state.currentIndex += 1;
  saveGameState();
  renderCurrentRound();
}

function showVictoryModal() {
  game.roundLocked = true;
  removeTransientLayers();
  elements.modalAttempts.textContent = getStatisticsText();
  elements.copyStatus.textContent = "";
  elements.modal.hidden = false;
  startCelebration();
  requestAnimationFrame(() => game.map?.invalidateSize());
  elements.viewMap.focus();
}

function getStatisticsText() {
  const lines = [`Всего попыток: ${game.state.totalAttempts}`];
  game.state.completed.forEach((completed) => {
    const location = locations.find(({ id }) => id === completed.id);
    if (!location) return;
    const distanceMeters = Number.isFinite(completed.distanceMeters)
      ? completed.distanceMeters
      : Math.round(calculateDistanceKm(completed.guess, location.coordinates) * 1000);
    const attempts = game.state.attemptsById[completed.id] || 0;
    lines.push(`${location.answer} - попыток: ${attempts}. Расстояние от цели: ${distanceMeters} метров`);
  });
  return lines.join("\n");
}

async function copyStatistics() {
  const statistics = getStatisticsText();
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(statistics);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = statistics;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      const copied = document.execCommand("copy");
      textArea.remove();
      if (!copied) throw new Error("Команда копирования не поддерживается");
    }
    elements.copyStatus.textContent = "Статистика скопирована!";
  } catch (error) {
    console.warn("Не удалось скопировать статистику.", error);
    elements.copyStatus.textContent = "Не удалось скопировать. Выделите текст вручную.";
  }
}

function hideVictoryModal() {
  elements.modal.hidden = true;
  stopCelebration();
}

function fitMapToAllCompletedPoints() {
  const points = [];
  game.state.completed.forEach((completed) => {
    const location = locations.find(({ id }) => id === completed.id);
    if (location) points.push(location.coordinates, completed.guess);
  });
  if (!points.length) return;
  game.map.fitBounds(L.latLngBounds(points), { padding: [45, 45], maxZoom: 13 });
}

function showFinalMap() {
  hideVictoryModal();
  removeTransientLayers();
  document.body.classList.add("final-mode");
  elements.summary.hidden = false;
  elements.finalAttempts.textContent = `Общее количество попыток: ${game.state.totalAttempts}`;
  requestAnimationFrame(() => {
    game.map.invalidateSize();
    fitMapToAllCompletedPoints();
  });
}

function resetGame() {
  hideVictoryModal();
  localStorage.removeItem(STORAGE_KEY);
  removeTransientLayers();
  game.completedLayers.forEach((layer) => game.map?.removeLayer(layer));
  game.completedLayers = [];
  game.state = createInitialState();
  saveGameState();
  game.map?.setView(INITIAL_MAP_CENTER, INITIAL_MAP_ZOOM);
  renderCurrentRound();
}

function startCelebration() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = elements.canvas;
  const context = canvas.getContext("2d");
  const colors = ["#ffd84a", "#5be7ff", "#ff628e", "#9d79ff", "#70efaa"];
  const particles = Array.from({ length: 150 }, () => ({
    x: Math.random(), y: Math.random() * -1, vx: (Math.random() - .5) * .0018,
    vy: .0015 + Math.random() * .003, size: 3 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)], rotation: Math.random() * Math.PI
  }));
  function draw() {
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    context.clearRect(0, 0, width, height);
    particles.forEach((particle) => {
      particle.x += particle.vx; particle.y += particle.vy;
      particle.rotation += .04;
      if (particle.y > 1.1) { particle.y = -.08; particle.x = Math.random(); }
      context.save(); context.translate(particle.x * width, particle.y * height); context.rotate(particle.rotation);
      context.fillStyle = particle.color; context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * .55); context.restore();
    });
    game.celebrationFrame = requestAnimationFrame(draw);
  }
  draw();
}

function stopCelebration() {
  cancelAnimationFrame(game.celebrationFrame);
  game.celebrationFrame = null;
  const context = elements.canvas.getContext("2d");
  context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
}

function initializeGame() {
  elements.prize.href = PRIZE_URL;
  elements.telegram.href = TELEGRAM_URL;
  if (!validateLocations() || !initializeMap()) return;
  game.state = loadGameState();
  saveGameState();
  renderCompletedMarkers();
  if (game.state.finished) showVictoryModal();
  else restoreCurrentRound();
}

elements.next.addEventListener("click", goToNextRound);
elements.viewMap.addEventListener("click", showFinalMap);
elements.copyStats.addEventListener("click", copyStatistics);
elements.modalReset.addEventListener("click", resetGame);
elements.summaryReset.addEventListener("click", resetGame);
window.addEventListener("resize", () => game.map?.invalidateSize());
document.addEventListener("DOMContentLoaded", initializeGame);
