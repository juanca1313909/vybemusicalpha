/* VYBE MUSIC — lógica local y catálogo público Supabase */
const DB_NAME = "vybe_music_db";
const DB_VERSION = 1;
const STORE = "tracks";
let db = null;
let tracks = [];
let catalogTracks = [];
let catalogGenre = "Todos";
let currentId = null;
let currentUrl = null;
let currentQueue = [];
let toastTimer = null;
let deferredInstallPrompt = null;

const audio = document.getElementById("audio-engine");
const $ = id => document.getElementById(id);

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      return reject(new Error("Este navegador no permite guardar la biblioteca."));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("addedAt", "addedAt", { unique: false });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => {
      reject(request.error || new Error("No se pudo abrir la biblioteca."));
    };
  });
}

function dbAction(mode, action) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("La biblioteca aún no está lista."));

    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let req;

    try {
      req = action(store);
    } catch (e) {
      reject(e);
      return;
    }

    tx.oncomplete = () => resolve(req ? req.result : true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Operación cancelada."));
  });
}

const saveTrack = track => dbAction("readwrite", store => store.put(track));
const deleteTrackFromDB = id => dbAction("readwrite", store => store.delete(id));
const getAllTracks = () => dbAction("readonly", store => store.getAll());

function makeId() {
  return (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "vybe-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function displayName(filename) {
  return filename.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim() || "Audio sin título";
}

function safeText(value) {
  return String(value || "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2500);
}

function switchTab(tab) {
  const valid = ["home", "catalog", "search", "library", "ai", "favorites", "party", "profile", "settings"];
  if (!valid.includes(tab)) return;

  document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));

  const target = $("view-" + tab);
  if (target) target.classList.add("active");

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  if (tab === "favorites") renderFavorites();
  if (tab === "library") renderLibrary();
  if (tab === "profile") updateProfile();
}

function showFavorites() {
  switchTab("favorites");
}

function updateCounts() {
  const label = tracks.length + (tracks.length === 1 ? " pista" : " pistas");

  $("track-count").textContent = label;
  $("library-count").textContent = label;
  $("profile-tracks").textContent = tracks.length;
  $("profile-favs").textContent = tracks.filter(t => t.favorite).length;
}

function trackRow(track, index) {
  const artist = track.artist || "Archivo local";

  return `<div class="track-row">
    <div class="track-cover">♫</div>
    <button class="track-meta" onclick="playTrack('${track.id}')">
      <strong>${safeText(track.name)}</strong>
      <small>${safeText(artist)}</small>
    </button>
    <div class="track-actions">
      <button title="${track.favorite ? "Quitar favorito" : "Añadir favorito"}"
        aria-label="Favorito" onclick="toggleFavorite('${track.id}')">
        ${track.favorite ? "♥" : "♡"}
      </button>
      <button title="Reproducir" aria-label="Reproducir"
        onclick="playTrack('${track.id}')">▶</button>
      <button title="Eliminar" aria-label="Eliminar"
        onclick="removeTrack('${track.id}')">⋯</button>
    </div>
  </div>`;
}

function renderTrackContainer(containerId, list) {
  const container = $(containerId);

  if (!list.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">♫</div>
        <h3>No hay canciones aquí todavía</h3>
        <p>Importa música desde tu dispositivo para empezar a escuchar.</p>
        <button class="outline-btn"
          onclick="document.getElementById('file-selector').click()">
          Importar música
        </button>
      </div>`;
    return;
  }

  container.innerHTML = list.map((track, i) => trackRow(track, i)).join("");
}

function renderHome() {
  const query = $("library-search").value.trim().toLowerCase();

  const filtered = tracks.filter(t =>
    (t.name + " " + (t.artist || "")).toLowerCase().includes(query)
  );

  renderTrackContainer("tracks-list", filtered);
  updateCounts();
}

function renderLibrary() {
  renderTrackContainer("library-list", tracks);
}

function renderFavorites() {
  renderTrackContainer("favorites-list", tracks.filter(t => t.favorite));
  updateCounts();
}

function updateProfile() {
  updateCounts();
}

async function importFiles(fileList) {
  const files = Array.from(fileList || []).filter(file =>
    file.type.startsWith("audio/") ||
    /\.(mp3|wav|m4a|flac|ogg|aac|opus)$/i.test(file.name)
  );

  if (!files.length) {
    return showToast("Selecciona archivos de audio compatibles.");
  }

  let added = 0;

  for (const file of files) {
    try {
      const track = {
        id: makeId(),
        name: displayName(file.name),
        artist: "Archivo local",
        fileName: file.name,
        type: file.type || "audio/mpeg",
        size: file.size,
        blob: file,
        favorite: false,
        addedAt: Date.now()
      };

      await saveTrack(track);
      added++;
    } catch (error) {
      console.error(error);
      showToast("No se pudo guardar un archivo. Puede faltar espacio.");
    }
  }

  await loadTracks();

  showToast(
    added + (added === 1 ? " canción añadida" : " canciones añadidas") +
    " a tu biblioteca."
  );

  if (added && !currentId) {
    playTrack(tracks[tracks.length - added].id);
  }
}

async function loadTracks() {
  try {
    tracks = await getAllTracks();
    tracks.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    renderHome();
    renderLibrary();
    renderFavorites();
    updateProfile();

    $("storage-status").textContent = "Activa";
  } catch (error) {
    console.error(error);
    $("storage-status").textContent = "No disponible";
    showToast("No se pudo leer la biblioteca local.");
  }
}

function findTrack(id) {
  return tracks.find(track => track.id === id) ||
    catalogTracks.find(track => String(track.id) === String(id));
}

function revokeCurrentUrl() {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

async function playTrack(id, queue) {
  const track = findTrack(id);

  if (!track) return showToast("No se encontró esa canción.");

  if (!track.blob && !track.audio_url) {
    return showToast("El audio de esta canción no está disponible.");
  }

  if (queue && queue.length) {
    currentQueue = queue.slice();
  } else if (!currentQueue.includes(id)) {
    currentQueue = (track.remote ? catalogTracks : tracks).map(t => t.id);
  }

  currentId = id;
  revokeCurrentUrl();

  if (track.blob) {
    currentUrl = URL.createObjectURL(track.blob);
    audio.src = currentUrl;
  } else {
    audio.src = track.audio_url;
  }

  audio.load();

  try {
    await audio.play();
    updatePlayerUI();
    $("mini-player").classList.remove("hidden");
    $("player-overlay").classList.remove("hidden");
  } catch (error) {
    console.warn(error);
    updatePlayerUI();
    $("mini-player").classList.remove("hidden");
    showToast("Toca reproducir para iniciar el audio.");
  }
}
function updatePlayerUI() {
  const track = findTrack(currentId);
  if (!track) return;

  $("mini-title").textContent = track.name || track.title;
  $("mini-artist").textContent = track.artist || "Artista independiente";
  $("player-title").textContent = track.name || track.title;
  $("player-artist").textContent = track.artist || "Artista independiente";

  $("mini-play-btn").textContent = audio.paused ? "▶" : "Ⅱ";
  $("big-play-btn").textContent = audio.paused ? "▶" : "Ⅱ";

  $("player-favorite").textContent = track.favorite ? "♥" : "♡";
  $("player-favorite").classList.toggle("enabled", !!track.favorite);

  const quality = document.querySelector(".quality-tag");
  if (quality) quality.textContent = track.remote ? "ONLINE" : "LOCAL";

  const foot = document.querySelector(".player-footnote");
  if (foot) {
    foot.textContent = track.remote
      ? "Reproduciendo desde el catálogo público TOP DE COLOMBIA."
      : "El audio se reproduce desde los archivos guardados en tu dispositivo.";
  }

  $("mini-player").classList.remove("hidden");
}

function togglePlay() {
  if (!audio.src) {
    if (tracks.length) playTrack(tracks[0].id);
    else showToast("Primero importa algunas canciones.");
    return;
  }

  if (audio.paused) {
    audio.play().then(updatePlayerUI)
      .catch(() => showToast("No se pudo reproducir este archivo."));
  } else {
    audio.pause();
  }

  updatePlayerUI();
}

function nextTrack() {
  if (!currentQueue.length) {
    currentQueue = tracks.map(t => t.id);
  }

  if (!currentQueue.length) return;

  let index = currentQueue.indexOf(currentId);

  if ($("shuffle-toggle").checked && currentQueue.length > 1) {
    let next = index;

    while (next === index) {
      next = Math.floor(Math.random() * currentQueue.length);
    }

    playTrack(currentQueue[next], currentQueue);
    return;
  }

  index = (index + 1) % currentQueue.length;
  playTrack(currentQueue[index], currentQueue);
}

function previousTrack() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  if (!currentQueue.length) {
    currentQueue = tracks.map(t => t.id);
  }

  const index = currentQueue.indexOf(currentId);
  const previous = (index - 1 + currentQueue.length) % currentQueue.length;

  if (currentQueue[previous]) {
    playTrack(currentQueue[previous], currentQueue);
  }
}

function openPlayer() {
  if (currentId) $("player-overlay").classList.remove("hidden");
}

function closePlayer() {
  $("player-overlay").classList.add("hidden");
}

async function toggleFavorite(id) {
  const track = findTrack(id);
  if (!track) return;

  if (track.remote) {
    return showToast("Los favoritos del catálogo estarán disponibles en una próxima actualización.");
  }

  track.favorite = !track.favorite;

  await saveTrack(track);

  renderHome();
  renderLibrary();
  renderFavorites();
  updatePlayerUI();

  showToast(track.favorite ? "Añadida a favoritos ♥" : "Quitada de favoritos");
}

function toggleCurrentFavorite() {
  if (currentId) toggleFavorite(currentId);
}

async function removeTrack(id) {
  const track = findTrack(id);
  if (!track) return;

  if (!confirm("¿Eliminar " + track.name + " de tu biblioteca?")) return;

  await deleteTrackFromDB(id);

  if (currentId === id) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    currentId = null;
    revokeCurrentUrl();

    $("mini-player").classList.add("hidden");
    $("player-overlay").classList.add("hidden");
  }

  await loadTracks();
  showToast("Canción eliminada.");
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");

  return mins + ":" + secs;
}

function updateProgress() {
  const duration = audio.duration || 0;
  const current = audio.currentTime || 0;
  const pct = duration ? current / duration : 0;

  $("mini-progress").style.width = (pct * 100) + "%";
  $("seek-bar").value = Math.round(pct * 1000);
  $("current-time").textContent = formatTime(current);
  $("duration-time").textContent = formatTime(duration);
}

function usePrompt(text) {
  $("ai-prompt").value = text;
}

function generateAI() {
  const prompt = $("ai-prompt").value.trim().toLowerCase();

  if (!prompt) return showToast("Escribe qué tipo de música quieres.");

  if (!tracks.length) {
    return showToast("Importa canciones para que VYBE pueda recomendarte.");
  }

  const groups = {
    focus: ["study", "estudi", "focus", "concentr", "ambient", "piano", "calma", "tranquil", "relaj", "lofi", "lo-fi"],
    energy: ["trap", "regga", "urbano", "rap", "drill", "gym", "entren", "energ", "rock", "dance", "techno"],
    night: ["sad", "triste", "despecho", "noche", "melanc", "love", "amor", "slow", "romant", "llor"],
    happy: ["happy", "feliz", "alegre", "party", "fiesta", "dance", "pop", "verano"]
  };

  let mood = "general";

  if (groups.focus.some(w => prompt.includes(w))) mood = "focus";
  else if (groups.energy.some(w => prompt.includes(w))) mood = "energy";
  else if (groups.night.some(w => prompt.includes(w))) mood = "night";
  else if (groups.happy.some(w => prompt.includes(w))) mood = "happy";

  const keywords = {
    focus: ["study", "estudi", "focus", "ambient", "piano", "calma", "lofi", "lo-fi", "soft"],
    energy: ["trap", "regga", "urbano", "rap", "drill", "gym", "rock", "dance", "techno", "energy"],
    night: ["sad", "triste", "despecho", "noche", "melanc", "love", "amor", "slow"],
    happy: ["happy", "feliz", "alegre", "party", "fiesta", "dance", "pop", "verano"]
  };

  let results = tracks.filter(t => {
    const name = (t.name + " " + (t.artist || "")).toLowerCase();

    return mood === "general"
      ? prompt.split(/\s+/).some(word => word.length > 3 && name.includes(word))
      : keywords[mood].some(word => name.includes(word));
  });

  if (!results.length) results = tracks.slice();

  const titles = {
    focus: "Deep Focus",
    energy: "High Energy",
    night: "Nocturne Mood",
    happy: "Good Vibes",
    general: "Tu selección VYBE"
  };

  $("ai-results").innerHTML = `
    <h3>${titles[mood]}</h3>
    <p class="result-caption">
      ${results.length === tracks.length
        ? "Una selección de tu biblioteca local."
        : "Coincidencias encontradas en tu biblioteca."}
      · ${results.length} pistas
    </p>
    <div class="track-list">
      ${results.map((t, i) => trackRow(t, i)).join("")}
    </div>
    <button class="primary-btn full-btn" id="play-mix-btn">
      ▶ Reproducir selección
    </button>`;

  $("play-mix-btn").addEventListener("click", () => {
    playTrack(results[0].id, results.map(t => t.id));
  });
}

function startParty() {
  if (!tracks.length) {
    return showToast("Importa canciones antes de crear una sesión.");
  }

  $("party-status").textContent =
    "Sesión local preparada · " + tracks.length + " pistas disponibles.";

  $("party-queue").innerHTML =
    tracks.slice(0, 5).map((t, i) => trackRow(t, i)).join("");

  showToast("Tu sesión local está lista.");
}
/* =========================================
   CATÁLOGO PÚBLICO TOP DE COLOMBIA
========================================= */

function catalogRow(song, index) {
  const cover = song.cover_url
    ? `<img src="${safeText(song.cover_url)}" alt="" loading="lazy">`
    : `<span>♫</span>`;

  return `
    <div class="track-row catalog-track">
      <div class="track-cover">${cover}</div>

      <div class="track-meta">
        <strong>${safeText(song.title || song.name)}</strong>
        <small>${safeText(song.artist || "Artista independiente")}</small>
      </div>

      <div class="track-actions">
        <span class="rank-number">${index + 1}</span>
        <button
          title="Reproducir"
          aria-label="Reproducir"
          onclick="playTrack('${String(song.id)}')">
          ▶
        </button>
      </div>
    </div>`;
}

function renderCatalog() {
  const searchInput = $("catalog-search");
  const query = searchInput
    ? searchInput.value.trim().toLowerCase()
    : "";

  const filtered = catalogTracks.filter(song => {
    const genreOk =
      catalogGenre === "Todos" ||
      (song.genre || "").toLowerCase().includes(catalogGenre.toLowerCase());

    const text = `
      ${song.title || song.name || ""}
      ${song.artist || ""}
      ${song.genre || ""}
    `.toLowerCase();

    return genreOk && (!query || text.includes(query));
  });

  $("catalog-list").innerHTML = filtered.length
    ? filtered.map((song, index) => catalogRow(song, index)).join("")
    : `
      <div class="empty-state">
        <div class="empty-icon">♫</div>
        <h3>${catalogTracks.length
          ? "No encontramos coincidencias"
          : "El catálogo está empezando"}</h3>
        <p>${catalogTracks.length
          ? "Prueba con otro nombre o género."
          : "Pronto aparecerán aquí las canciones publicadas en TOP DE COLOMBIA."}</p>
      </div>`;

  const homeSongs = filtered.slice(0, 4);

  $("catalog-home-list").innerHTML = homeSongs.length
    ? homeSongs.map((song, index) => catalogRow(song, index)).join("")
    : `<div class="catalog-empty">${
        catalogTracks.length
          ? "Busca música en el catálogo completo."
          : "Aún no hay canciones publicadas."
      }</div>`;

  $("catalog-count").textContent =
    `${filtered.length} ${filtered.length === 1 ? "canción" : "canciones"}`;
}

async function loadPublicCatalog() {
  if (
    typeof supabaseClient === "undefined" ||
    !supabaseClient
  ) {
    showToast("No se encontró la conexión con Supabase.");
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from("songs")
      .select(`
        id,
        title,
        audio_url,
        cover_url,
        plays,
        published,
        created_at,
        artist:artists(name),
        genre:genres(name)
      `)
      .eq("published", true)
      .order("plays", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    catalogTracks = (data || []).map(song => ({
      id: song.id,
      title: song.title,
      name: song.title,
      artist: song.artist?.name || "Artista independiente",
      genre: song.genre?.name || "",
      audio_url: song.audio_url,
      cover_url: song.cover_url,
      plays: song.plays || 0,
      remote: true
    }));

    renderCatalog();

  } catch (error) {
    console.error("Catálogo VYBE:", error);

    $("catalog-list").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">!</div>
        <h3>No se pudo conectar</h3>
        <p>Revisa la conexión y los permisos de lectura de Supabase.</p>
        <button class="outline-btn" onclick="loadPublicCatalog()">
          Volver a intentar
        </button>
      </div>`;

    $("catalog-home-list").innerHTML =
      `<div class="catalog-empty">No se pudo cargar TOP DE COLOMBIA.</div>`;
  }
}

/* =========================================
   BÚSQUEDA
========================================= */

function searchTracks(query, targetId) {
  const q = query.trim().toLowerCase();

  const result = q
    ? tracks.filter(t =>
        (t.name + " " + (t.artist || "") + " " + (t.fileName || ""))
          .toLowerCase()
          .includes(q)
      )
    : [];

  if (!q) {
    $(targetId).innerHTML = `
      <div class="empty-state compact">
        <div class="empty-icon">⌕</div>
        <p>Escribe algo para buscar en tu biblioteca.</p>
      </div>`;
  } else {
    renderTrackContainer(targetId, result);
  }
}

async function clearLibrary() {
  if (!tracks.length) {
    return showToast("Tu biblioteca ya está vacía.");
  }

  if (!confirm("Esto eliminará todas las canciones guardadas en VYBE MUSIC. ¿Continuar?")) {
    return;
  }

  audio.pause();
  audio.removeAttribute("src");
  audio.load();

  currentId = null;
  currentQueue = [];

  revokeCurrentUrl();

  await dbAction("readwrite", store => store.clear());

  $("mini-player").classList.add("hidden");
  $("player-overlay").classList.add("hidden");

  await loadTracks();

  showToast("Biblioteca eliminada.");
}

/* =========================================
   INSTALACIÓN Y SERVICE WORKER
========================================= */

function initInstallPrompt() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("install-btn").hidden = false;
  });

  $("install-btn").addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      return showToast("Usa el menú del navegador y selecciona Instalar aplicación.");
    }

    deferredInstallPrompt.prompt();

    await deferredInstallPrompt.userChoice;

    deferredInstallPrompt = null;
    $("install-btn").hidden = true;
  });
}

function registerServiceWorker() {
  if (
    "serviceWorker" in navigator &&
    (location.protocol === "https:" || location.hostname === "localhost")
  ) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .catch(error => console.warn("SW:", error));
    });
  }
}

/* =========================================
   EVENTOS DE LA APLICACIÓN
========================================= */

$("file-selector")?.addEventListener("change", event => {
  importFiles(event.target.files);
  event.target.value = "";
});

$("library-search")?.addEventListener("input", renderHome);

$("global-search")?.addEventListener("input", event => {
  searchTracks(event.target.value, "search-results");
});

$("catalog-search")?.addEventListener("input", renderCatalog);

document.querySelectorAll(".catalog-filter").forEach(button => {
  button.addEventListener("click", () => {
    catalogGenre = button.dataset.genre;

    document.querySelectorAll(".catalog-filter").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    renderCatalog();
  });
});

$("generate-btn")?.addEventListener("click", generateAI);

$("mini-play-btn")?.addEventListener("click", togglePlay);
$("big-play-btn")?.addEventListener("click", togglePlay);

$("prev-btn")?.addEventListener("click", previousTrack);
$("next-btn")?.addEventListener("click", nextTrack);

$("shuffle-player-btn")?.addEventListener("click", () => {
  $("shuffle-toggle").checked = !$("shuffle-toggle").checked;

  $("shuffle-player-btn").classList.toggle(
    "enabled",
    $("shuffle-toggle").checked
  );
});

$("repeat-player-btn")?.addEventListener("click", () => {
  $("repeat-toggle").checked = !$("repeat-toggle").checked;

  $("repeat-player-btn").classList.toggle(
    "enabled",
    $("repeat-toggle").checked
  );
});

$("seek-bar")?.addEventListener("input", event => {
  if (audio.duration) {
    audio.currentTime =
      (Number(event.target.value) / 1000) * audio.duration;
  }
});

$("autoplay-toggle")?.addEventListener("change", event => {
  localStorage.setItem("vybe-autoplay", event.target.checked);
});

$("repeat-toggle")?.addEventListener("change", event => {
  localStorage.setItem("vybe-repeat", event.target.checked);

  $("repeat-player-btn")?.classList.toggle(
    "enabled",
    event.target.checked
  );
});

$("shuffle-toggle")?.addEventListener("change", event => {
  localStorage.setItem("vybe-shuffle", event.target.checked);

  $("shuffle-player-btn")?.classList.toggle(
    "enabled",
    event.target.checked
  );
});

$("clear-library-btn")?.addEventListener("click", clearLibrary);

// Eventos del reproductor
if (audio) {
  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("play", updatePlayerUI);
  audio.addEventListener("pause", updatePlayerUI);

  audio.addEventListener("ended", () => {
    const repeatToggle = $("repeat-toggle");
    const autoplayToggle = $("autoplay-toggle");

    if (repeatToggle?.checked) {
      audio.currentTime = 0;
      audio.play().catch(console.warn);
    } else if (autoplayToggle?.checked) {
      nextTrack();
    } else {
      updatePlayerUI();
    }
  });

  audio.addEventListener("error", () => {
    showToast("Este formato no se pudo reproducir en el navegador.");
  });
} else {
  console.error("No se encontró el elemento audio-engine en index.html");
}

window.addEventListener("beforeunload", revokeCurrentUrl);

     

// Liberar memoria al cerrar

/* =========================================
   INICIO DE VYBE MUSIC
========================================= */

async function init() {
  $("autoplay-toggle").checked =
    localStorage.getItem("vybe-autoplay") !== "false";

  $("repeat-toggle").checked =
    localStorage.getItem("vybe-repeat") === "true";

  $("shuffle-toggle").checked =
    localStorage.getItem("vybe-shuffle") === "true";

  $("repeat-player-btn").classList.toggle(
    "enabled",
    $("repeat-toggle").checked
  );

  $("shuffle-player-btn").classList.toggle(
    "enabled",
    $("shuffle-toggle").checked
  );

  initInstallPrompt();
  registerServiceWorker();

  try {
    await openDatabase();
    await loadTracks();
    await loadPublicCatalog();
  } catch (error) {
    console.error(error);

    $("storage-status").textContent = "No disponible";

    showToast(
      "No se pudo activar el almacenamiento. Prueba en Chrome."
    );
  }
}

init();

/* ========================================================
   MEJORAS ULTIMATE PRO: WEB AUDIO API (EQ & 8D), AUTH & PRO
   ======================================================== */
let audioCtx, bassFilter, panner, eqBands = [];
let isAudioInitialized = false;
let spatialInterval = null;

function initWebAudioAPI() {
  if (isAudioInitialized) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    const srcNode = audioCtx.createMediaElementSource(audio);
    
    bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = "lowshelf";
    bassFilter.frequency.value = 80;
    bassFilter.gain.value = 0;

    panner = audioCtx.createStereoPanner();
    panner.pan.value = 0;

    const freqs = [60, 230, 910, 3600, 14000];
    let prev = bassFilter;
    freqs.forEach(f => {
      const eq = audioCtx.createBiquadFilter();
      eq.type = "peaking";
      eq.frequency.value = f;
      eq.Q.value = 1.0;
      eq.gain.value = 0;
      eqBands.push(eq);
      prev.connect(eq);
      prev = eq;
    });

    srcNode.connect(bassFilter);
    prev.connect(panner);
    panner.connect(audioCtx.destination);
    isAudioInitialized = true;
  } catch(e) {
    console.log("Web Audio API not fully supported", e);
  }
}

// Controles FX
document.getElementById("bass-toggle")?.addEventListener("change", e => {
  if(!isAudioInitialized) initWebAudioAPI();
  if(bassFilter) bassFilter.gain.value = e.target.checked ? 15 : 0;
  showToast(e.target.checked ? "🔥 Mega Bass Activado" : "Bass Boost Desactivado");
});

document.getElementById("8d-toggle")?.addEventListener("change", e => {
  if(!isAudioInitialized) initWebAudioAPI();
  if(e.target.checked) {
    let pan = 0, dir = 1;
    spatialInterval = setInterval(() => {
      pan += 0.03 * dir;
      if (pan >= 1 || pan <= -1) dir *= -1;
      if(panner) panner.pan.value = pan;
    }, 60);
    showToast("🌀 8D Audio Surround Activado");
  } else {
    clearInterval(spatialInterval);
    if(panner) panner.pan.value = 0;
    showToast("8D Audio Desactivado");
  }
});

["eq-60", "eq-230", "eq-910", "eq-3k", "eq-14k"].forEach((id, idx) => {
  document.getElementById(id)?.addEventListener("input", e => {
    if(!isAudioInitialized) initWebAudioAPI();
    if(eqBands[idx]) eqBands[idx].gain.value = parseFloat(e.target.value);
  });
});

// Trial de 1 Mes Gratis y Auth
document.getElementById("activate-trial-btn")?.addEventListener("click", () => {
  localStorage.setItem("vybe_pro", "true");
  showToast("🎉 ¡1 Mes Gratis de VYBE VIP PRO Activado!");
  document.getElementById("pro-status-box")?.classList.remove("hidden");
  document.getElementById("activate-trial-btn")?.classList.add("hidden");
});

if(localStorage.getItem("vybe_pro") === "true") {
  document.getElementById("pro-status-box")?.classList.remove("hidden");
  document.getElementById("activate-trial-btn")?.classList.add("hidden");
}

document.getElementById("login-btn")?.addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value;
  if(!email) return showToast("Ingresa tu correo");
  showToast("Iniciando sesión...");
  setTimeout(() => {
    document.getElementById("username-display").textContent = email.split("@")[0];
    document.getElementById("auth-form").classList.add("hidden");
    document.getElementById("logout-btn").classList.remove("hidden");
    showToast("✅ Cuenta enlazada correctamente");
  }, 800);
});

document.getElementById("logout-btn")?.addEventListener("click", () => {
  document.getElementById("auth-form").classList.remove("hidden");
  document.getElementById("logout-btn").classList.add("hidden");
  document.getElementById("username-display").textContent = "Oyente Local";
  showToast("Sesión cerrada");
});
