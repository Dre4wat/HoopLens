const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const els = {
  playerSearch: $("#playerSearch"),
  playerDropdown: $("#playerDropdown"),
  season: $("#season"),
  seasonType: $("#seasonType"),
  searchPlayers: $("#searchPlayers"),
  playerSelect: $("#playerSelect"),
  loadGames: $("#loadGames"),
  gameSelect: $("#gameSelect"),
  mixGameSelect: $("#mixGameSelect"),
  playerVideoOnly: $("#playerVideoOnly"),
  seasonVideoOnly: $("#seasonVideoOnly"),
  gameVideoOnly: $("#gameVideoOnly"),
  loadPlayerGameEvents: $("#loadPlayerGameEvents"),
  loadSeasonEvents: $("#loadSeasonEvents"),
  loadGameMix: $("#loadGameMix"),
  loadAllVideos: $("#loadAllVideos"),
  orderMode: $("#orderMode"),
  randomizeNow: $("#randomizeNow"),
  categoryChecks: $("#categoryChecks"),
  playTypeChecks: $("#playTypeChecks"),
  shotTypeChecks: $("#shotTypeChecks"),
  specialTagChecks: $("#specialTagChecks"),
  clockTagList: $("#clockTagList"),
  detailTagList: $("#detailTagList"),
  defenseTagList: $("#defenseTagList"),
  unavailableTagList: $("#unavailableTagList"),
  clearFilters: $("#clearFilters"),
  showSelectedOnly: $("#showSelectedOnly"),
  status: $("#status"),
  events: $("#events")
};

let currentPlayer = null;
let currentGames = [];
let currentMode = "playerGame";
let currentEvents = [];
let currentFilteredEvents = [];
let playerSearchTimer = null;

function setStatus(text) {
  els.status.textContent = text || "";
}

async function api(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function eventLink(gameId, eventId) {
  return `https://www.nba.com/stats/events/?GameEventID=${encodeURIComponent(eventId)}&GameID=${encodeURIComponent(gameId)}&flag=1&sct=plot`;
}

function selectedOptionData(select) {
  const option = select.options[select.selectedIndex];
  return option?.dataset || {};
}

function playerLine(p) {
  const team = p.teamAbbreviation ? ` — ${p.teamAbbreviation}` : "";
  const years = p.fromYear && p.toYear ? ` (${p.fromYear}-${p.toYear})` : "";
  return `${p.name}${team}${years}`;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function parseGameDate(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : 0;
}

function chronologicalSort(events) {
  return [...events].sort((a, b) => {
    const dateDiff = parseGameDate(a.gameDate) - parseGameDate(b.gameDate);
    if (dateDiff) return dateDiff;
    if ((a.period || 0) !== (b.period || 0)) return (a.period || 0) - (b.period || 0);
    return (a.actionNumber || 0) - (b.actionNumber || 0);
  });
}

function resetEvents(message = "") {
  currentEvents = [];
  currentFilteredEvents = [];
  els.events.innerHTML = message ? `<div class="empty">${escapeHtml(message)}</div>` : "";
  els.loadAllVideos.disabled = true;
  resetFilters(true);
}

function setMode(mode) {
  currentMode = mode;
  $$(".tab").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === mode));
  $$(".tabPanel").forEach(panel => panel.classList.toggle("active", panel.id === mode));
  resetEvents("Choose options for this tab, then load events.");
  setStatus(mode === "seasonTape"
    ? "Season Tape scans every game for the selected player. Regular seasons can take longer because there may be 82 games."
    : mode === "gameMix"
      ? "Game Mix shows selected play types from everyone in the selected game."
      : "Player Game shows only the selected player in one selected game.");
}

function showPlayerDropdown(players) {
  if (!players.length) {
    els.playerDropdown.innerHTML = `<div class="dropEmpty">No matching players</div>`;
    els.playerDropdown.classList.remove("hidden");
    return;
  }

  els.playerDropdown.innerHTML = players.map(p => `
    <button class="playerOption" data-id="${escapeAttr(p.id)}" data-name="${escapeAttr(p.name)}">
      <strong>${escapeHtml(p.name)}</strong>
      <span>${escapeHtml([p.teamAbbreviation, p.fromYear && p.toYear ? `${p.fromYear}-${p.toYear}` : ""].filter(Boolean).join(" • "))}</span>
    </button>`).join("");
  els.playerDropdown.classList.remove("hidden");
}

function hidePlayerDropdown() {
  els.playerDropdown.classList.add("hidden");
}

function fillPlayers(players) {
  if (!players.length) {
    els.playerSelect.innerHTML = `<option value="">No matching players</option>`;
    els.playerSelect.disabled = true;
    els.loadGames.disabled = true;
    els.loadSeasonEvents.disabled = true;
    return;
  }

  els.playerSelect.innerHTML = players.map(p => (
    `<option value="${escapeAttr(p.id)}" data-name="${escapeAttr(p.name)}">${escapeHtml(playerLine(p))}</option>`
  )).join("");
  els.playerSelect.disabled = false;
  els.loadGames.disabled = false;
  els.loadSeasonEvents.disabled = false;
  currentPlayer = { id: els.playerSelect.value, name: selectedOptionData(els.playerSelect).name || "" };
}

async function searchPlayers({ fromTyping = false } = {}) {
  const q = els.playerSearch.value.trim();
  if (q.length < 2) {
    if (!fromTyping) setStatus("Type at least 2 letters of a player's name.");
    hidePlayerDropdown();
    return [];
  }

  const data = await api(`/api/search-players?q=${encodeURIComponent(q)}&season=${encodeURIComponent(els.season.value)}`);
  fillPlayers(data.players || []);
  showPlayerDropdown(data.players || []);
  if (!fromTyping) setStatus(data.players?.length ? "Pick the exact player from the dropdown or selected player box." : "No players found. Try a shorter search.");
  return data.players || [];
}

function fillGames(games) {
  currentGames = games || [];
  if (!currentGames.length) {
    const noGames = `<option value="">No games found</option>`;
    els.gameSelect.innerHTML = noGames;
    els.mixGameSelect.innerHTML = noGames;
    els.gameSelect.disabled = true;
    els.mixGameSelect.disabled = true;
    els.loadPlayerGameEvents.disabled = true;
    els.loadGameMix.disabled = true;
    return;
  }

  const options = currentGames.map(g => {
    const statLine = [g.points !== "" ? `${g.points} PTS` : "", g.rebounds !== "" ? `${g.rebounds} REB` : "", g.assists !== "" ? `${g.assists} AST` : ""].filter(Boolean).join(", ");
    const line = `${g.gameDate || "Unknown date"} — ${g.matchup || "Game"}${g.wl ? ` (${g.wl})` : ""}${statLine ? ` — ${statLine}` : ""}`;
    return `<option value="${escapeAttr(g.gameId)}" data-date="${escapeAttr(g.gameDate || "")}" data-matchup="${escapeAttr(g.matchup || "")}">${escapeHtml(line)}</option>`;
  }).join("");

  els.gameSelect.innerHTML = options;
  els.mixGameSelect.innerHTML = options;
  els.gameSelect.disabled = false;
  els.mixGameSelect.disabled = false;
  els.loadPlayerGameEvents.disabled = false;
  els.loadGameMix.disabled = false;
}

function getSelectedValues(container) {
  return [...container.querySelectorAll("input[type='checkbox']:checked")].map(input => input.value);
}

function fillChecklist(container, values, name) {
  const list = values || [];
  if (!list.length) {
    container.classList.add("emptyChecks");
    container.innerHTML = name === "Special tags"
      ? "No special/detail tags found in the loaded events. Check the guide below for every tag HoopLens can try to infer."
      : "No options for this loaded set.";
    return;
  }

  container.classList.remove("emptyChecks");
  container.innerHTML = list.map((value, index) => `
    <label class="checkItem">
      <input type="checkbox" value="${escapeAttr(value)}" data-filter-name="${escapeAttr(name)}" />
      <span>${escapeHtml(value)}</span>
    </label>`).join("");
}

function resetFilters(disabled = true) {
  fillChecklist(els.categoryChecks, [], "Event groups");
  fillChecklist(els.playTypeChecks, [], "Play types");
  fillChecklist(els.shotTypeChecks, [], "Shot types");
  fillChecklist(els.specialTagChecks, [], "Special tags");
  els.clearFilters.disabled = disabled;
  els.showSelectedOnly.disabled = disabled;
}

function hydrateFilters(filters = {}) {
  fillChecklist(els.categoryChecks, filters.categories || [], "Event groups");
  fillChecklist(els.playTypeChecks, filters.playTypes || [], "Play types");
  fillChecklist(els.shotTypeChecks, filters.shotTypes || [], "Shot types");
  fillChecklist(els.specialTagChecks, filters.specialTags || [], "Special tags");
  els.clearFilters.disabled = false;
  els.showSelectedOnly.disabled = false;
}

function eventMatchesSelectedFilters(e) {
  const categories = getSelectedValues(els.categoryChecks);
  const playTypes = getSelectedValues(els.playTypeChecks);
  const shotTypes = getSelectedValues(els.shotTypeChecks);
  const specialTags = getSelectedValues(els.specialTagChecks);

  if (categories.length && !categories.includes(e.category)) return false;
  if (playTypes.length && !playTypes.includes(e.playType)) return false;
  if (shotTypes.length && !shotTypes.includes(e.shotType)) return false;
  if (specialTags.length && !specialTags.some(tag => (e.specialTags || []).includes(tag))) return false;
  return true;
}

function applyFilters({ randomize = false } = {}) {
  let events = currentEvents.filter(eventMatchesSelectedFilters);
  if (currentMode === "seasonTape") {
    events = els.orderMode.value === "random" || randomize ? shuffle(events) : chronologicalSort(events);
  }
  currentFilteredEvents = events;
  renderEvents(events);

  const active = [
    ...getSelectedValues(els.categoryChecks),
    ...getSelectedValues(els.playTypeChecks),
    ...getSelectedValues(els.shotTypeChecks),
    ...getSelectedValues(els.specialTagChecks)
  ];
  const modeLabel = currentMode === "seasonTape" ? "season tape" : currentMode === "gameMix" ? "game mix" : "player game";
  setStatus(active.length
    ? `Showing ${events.length} filtered ${modeLabel} event(s).`
    : `Showing all ${events.length} loaded ${modeLabel} event(s).`);
  els.loadAllVideos.disabled = events.length === 0;
}

function eventCard(e, video = null) {
  const source = video?.proxyUrl || video?.videoUrl || null;
  const thumbnail = video?.thumbnail || "";
  const nbaPage = video?.nbaPageUrl || e.nbaPageUrl || eventLink(e.gameId, e.actionNumber);
  const hasVideo = Boolean(source);

  const media = hasVideo
    ? `<video controls playsinline preload="metadata" poster="${escapeAttr(thumbnail)}" src="${escapeAttr(source)}"></video>`
    : thumbnail
      ? `<img src="${escapeAttr(thumbnail)}" alt="${escapeAttr(e.description)} thumbnail" />`
      : `<button class="secondary loadOne" data-game="${escapeAttr(e.gameId)}" data-event="${escapeAttr(e.actionNumber)}">Load video</button>`;

  const specialBadges = (e.specialTags || []).map(tag => `<span class="badge special">${escapeHtml(tag)}</span>`).join("");
  const shotBadge = e.shotType && e.shotType !== "Non-shot" ? `<span class="badge shot">${escapeHtml(e.shotType)}</span>` : "";
  const playerBadge = e.playerName ? `<span class="badge ghost">${escapeHtml(e.playerName)}</span>` : "";
  const gameLine = e.gameLine || [e.gameDate, e.matchup].filter(Boolean).join(" — ");
  const locationMeta = [e.shotDistance !== null && e.shotDistance !== undefined && e.shotDistance !== "" ? `${e.shotDistance} ft` : "", e.area, e.areaDetail].filter(Boolean).join(" • ");
  const scoreLine = [e.scoreAway !== "" && e.scoreHome !== "" ? `Score: ${e.scoreAway}-${e.scoreHome}` : "", e.scoringSide ? `Scoring side: ${e.scoringSide}` : ""].filter(Boolean).join(" • ");

  const debug = video?.attempts?.length
    ? `<details class="small"><summary>Video debug</summary><pre>${escapeHtml(JSON.stringify(video.attempts, null, 2))}</pre></details>`
    : "";

  return `
    <article class="card" data-event-card="${escapeAttr(e.gameId)}-${escapeAttr(e.actionNumber)}">
      <div class="media">${media}</div>
      <div class="cardBody">
        <div class="badges">
          <span class="badge group">${escapeHtml(e.category)}</span>
          <span class="badge play">${escapeHtml(e.playType)}</span>
          ${shotBadge}
          ${specialBadges}
          ${playerBadge}
          <span class="badge">Q${escapeHtml(e.period)} ${escapeHtml(e.clock)}</span>
          <span class="badge">#${escapeHtml(e.actionNumber)}</span>
          ${video?.endpoint ? `<span class="badge ghost">${escapeHtml(video.endpoint)}</span>` : ""}
        </div>
        ${gameLine ? `<div class="small">${escapeHtml(gameLine)}</div>` : ""}
        <div class="desc">${escapeHtml(e.description || "No description")}</div>
        ${locationMeta ? `<div class="small">${escapeHtml(locationMeta)}</div>` : ""}
        ${scoreLine ? `<div class="small">${escapeHtml(scoreLine)}</div>` : ""}
        <div class="cardActions">
          ${hasVideo ? `<a href="${escapeAttr(video.videoUrl)}" target="_blank" rel="noreferrer">Open MP4</a>` : `<button class="secondary loadOne" data-game="${escapeAttr(e.gameId)}" data-event="${escapeAttr(e.actionNumber)}">Load video</button>`}
          <a href="${escapeAttr(nbaPage)}" target="_blank" rel="noreferrer">NBA page</a>
        </div>
        ${video?.message ? `<div class="small warn">${escapeHtml(video.message)}</div>` : ""}
        ${e.videoError ? `<div class="small warn">${escapeHtml(e.videoError)}</div>` : ""}
        ${debug}
      </div>
    </article>`;
}

function renderTagPills(container, values = []) {
  if (!container) return;
  container.innerHTML = values.length
    ? values.map(tag => `<span class="tagPill">${escapeHtml(tag)}</span>`).join("")
    : `<span class="guideNote">No tags listed.</span>`;
}

async function loadTagCatalog() {
  try {
    const data = await api("/api/tag-catalog");
    renderTagPills(els.clockTagList, data.clockScoreTags || []);
    renderTagPills(els.detailTagList, data.shotDetailTags || []);
    renderTagPills(els.defenseTagList, data.defenseTags || []);
    renderTagPills(els.unavailableTagList, data.unavailableTags || []);
  } catch {
    renderTagPills(els.clockTagList, ["Buzzer Beater", "Game Winner", "Clutch Shot", "Tying Shot", "Go-Ahead Shot", "Possible Game Winner"]);
    renderTagPills(els.detailTagList, ["One-Hand Dunk", "Two-Hand Dunk", "Alley-Oop", "Putback", "Reverse", "Step Back", "Pullup", "Floater", "Fadeaway", "Hook Shot"]);
    renderTagPills(els.defenseTagList, ["Defensive Stop", "Block", "Steal", "Defensive Rebound", "Shot Blocked", "Forced Turnover"]);
    renderTagPills(els.unavailableTagList, ["Scored On / Primary Defender"]);
  }
}

function renderEvents(events) {
  if (!events.length) {
    els.events.innerHTML = `<div class="empty">No events match this selection. Clear filters or try another mode.</div>`;
    return;
  }
  els.events.innerHTML = events.map(e => eventCard(e, e.video)).join("");
}

async function loadSeasons() {
  try {
    const data = await api("/api/seasons");
    els.season.innerHTML = data.seasons.map(season => `<option ${season === data.defaultSeason ? "selected" : ""}>${escapeHtml(season)}</option>`).join("");
  } catch {
    const seasons = [];
    for (let start = 2025; start >= 1946; start--) seasons.push(`${start}-${String((start + 1) % 100).padStart(2, "0")}`);
    els.season.innerHTML = seasons.map(season => `<option ${season === "2025-26" ? "selected" : ""}>${escapeHtml(season)}</option>`).join("");
  }
}

async function loadGames() {
  const playerId = els.playerSelect.value;
  if (!playerId) return setStatus("Search and select a player first.");
  const playerName = selectedOptionData(els.playerSelect).name || currentPlayer?.name || "Selected player";
  els.gameSelect.innerHTML = `<option>Loading games...</option>`;
  els.mixGameSelect.innerHTML = `<option>Loading games...</option>`;
  els.gameSelect.disabled = true;
  els.mixGameSelect.disabled = true;
  els.loadPlayerGameEvents.disabled = true;
  els.loadGameMix.disabled = true;
  resetEvents();
  setStatus(`Loading ${playerName}'s ${els.seasonType.value.toLowerCase()} games for ${els.season.value}...`);

  const data = await api(`/api/player-games?playerId=${encodeURIComponent(playerId)}&season=${encodeURIComponent(els.season.value)}&seasonType=${encodeURIComponent(els.seasonType.value)}`);
  fillGames(data.games || []);
  setStatus(data.games?.length
    ? `Loaded ${data.games.length} game(s). Use Player Game for only ${playerName}, or Game Mix for everyone in one game.`
    : `No ${els.seasonType.value.toLowerCase()} games found for ${playerName} in ${els.season.value}.`);
}

async function loadPlayerGameEvents() {
  const playerId = els.playerSelect.value;
  const gameId = els.gameSelect.value;
  if (!playerId || !gameId) return setStatus("Select a player and game first.");

  resetEvents();
  setStatus("Loading this player's event list and building checklists...");
  const data = await api(`/api/events?gameId=${encodeURIComponent(gameId)}&playerId=${encodeURIComponent(playerId)}&videoOnly=${els.playerVideoOnly.checked ? "1" : "0"}`);
  currentEvents = data.events || [];
  hydrateFilters(data.filters || {});
  applyFilters();
  setStatus(currentEvents.length ? `Loaded ${currentEvents.length} player event(s). Choose filters or load videos.` : "No events found. Try turning off Video-only.");
}

async function loadSeasonEvents() {
  const playerId = els.playerSelect.value;
  if (!playerId) return setStatus("Search and select a player first.");
  const playerName = selectedOptionData(els.playerSelect).name || currentPlayer?.name || "Selected player";
  resetEvents();
  setStatus(`Scanning every ${els.season.value} ${els.seasonType.value.toLowerCase()} game for ${playerName}. This may take a bit for a full regular season...`);

  const data = await api(`/api/player-season-events?playerId=${encodeURIComponent(playerId)}&season=${encodeURIComponent(els.season.value)}&seasonType=${encodeURIComponent(els.seasonType.value)}&videoOnly=${els.seasonVideoOnly.checked ? "1" : "0"}`);
  currentEvents = chronologicalSort(data.events || []);
  hydrateFilters(data.filters || {});
  applyFilters();

  const failureText = data.failures?.length ? ` ${data.failures.length} game(s) could not be scanned.` : "";
  setStatus(currentEvents.length
    ? `Season Tape loaded ${currentEvents.length} event(s) from ${data.gamesScanned || 0} game(s).${failureText} Use the checklists to cut the tape.`
    : `No season events found. Try turning off Video-only or changing season type.${failureText}`);
}

async function loadGameMix() {
  const gameId = els.mixGameSelect.value || els.gameSelect.value;
  if (!gameId) return setStatus("Load games and select one first.");
  resetEvents();
  setStatus("Loading every video-available event from everyone in this game...");
  const data = await api(`/api/game-events?gameId=${encodeURIComponent(gameId)}&videoOnly=${els.gameVideoOnly.checked ? "1" : "0"}`);
  currentEvents = data.events || [];
  hydrateFilters(data.filters || {});
  applyFilters();
  setStatus(currentEvents.length ? `Game Mix loaded ${currentEvents.length} event(s) from everyone. Use play-type and shot-type checklists.` : "No game events found. Try turning off Video-only.");
}

async function loadVisibleVideos() {
  const eventsToLoad = currentFilteredEvents.length ? currentFilteredEvents : currentEvents;
  if (!eventsToLoad.length) return;

  els.loadAllVideos.disabled = true;
  const loaded = [];
  for (const e of eventsToLoad) {
    try {
      setStatus(`Loading video ${loaded.length + 1} of ${eventsToLoad.length}...`);
      const video = await api(`/api/video?gameId=${encodeURIComponent(e.gameId)}&eventId=${encodeURIComponent(e.actionNumber)}`);
      loaded.push({ ...e, video });
    } catch (err) {
      loaded.push({ ...e, video: null, videoError: err.message });
    }
    els.events.innerHTML = loaded.concat(eventsToLoad.slice(loaded.length)).map(item => eventCard(item, item.video)).join("");
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  currentFilteredEvents = loaded;
  els.events.innerHTML = loaded.map(item => eventCard(item, item.video)).join("");
  els.loadAllVideos.disabled = false;
  setStatus("Finished loading visible videos. If a direct clip fails, use the NBA page button.");
}

els.searchPlayers.addEventListener("click", async () => {
  try {
    resetEvents();
    setStatus(`Searching ${els.season.value} players...`);
    await searchPlayers({ fromTyping: false });
  } catch (err) {
    setStatus(err.message);
    hidePlayerDropdown();
  }
});

els.playerSearch.addEventListener("input", () => {
  clearTimeout(playerSearchTimer);
  if (els.playerSearch.value.trim().length < 2) return hidePlayerDropdown();
  playerSearchTimer = setTimeout(async () => {
    try { await searchPlayers({ fromTyping: true }); }
    catch { hidePlayerDropdown(); }
  }, 250);
});

els.playerSearch.addEventListener("keydown", event => {
  if (event.key === "Enter") els.searchPlayers.click();
});

els.playerDropdown.addEventListener("click", event => {
  const option = event.target.closest(".playerOption");
  if (!option) return;
  const id = option.dataset.id;
  const name = option.dataset.name;
  const match = [...els.playerSelect.options].find(opt => String(opt.value) === String(id));
  if (match) els.playerSelect.value = id;
  els.playerSearch.value = name;
  currentPlayer = { id, name };
  els.loadGames.disabled = false;
  els.loadSeasonEvents.disabled = false;
  hidePlayerDropdown();
  setStatus(`${name} selected. Click Load this player's games, or go straight to Season Tape.`);
});

window.addEventListener("click", event => {
  if (!event.target.closest(".searchWrap")) hidePlayerDropdown();
});

els.playerSelect.addEventListener("change", () => {
  currentPlayer = { id: els.playerSelect.value, name: selectedOptionData(els.playerSelect).name || "" };
  if (currentPlayer.name) els.playerSearch.value = currentPlayer.name;
  fillGames([]);
  resetEvents("Player changed. Load games or build a season tape.");
});

els.loadGames.addEventListener("click", async () => {
  try { await loadGames(); }
  catch (err) { setStatus(err.message); }
});

els.loadPlayerGameEvents.addEventListener("click", async () => {
  try { await loadPlayerGameEvents(); }
  catch (err) { setStatus(err.message); }
});

els.loadSeasonEvents.addEventListener("click", async () => {
  try { await loadSeasonEvents(); }
  catch (err) { setStatus(err.message); }
});

els.loadGameMix.addEventListener("click", async () => {
  try { await loadGameMix(); }
  catch (err) { setStatus(err.message); }
});

els.loadAllVideos.addEventListener("click", async () => {
  try { await loadVisibleVideos(); }
  catch (err) { setStatus(err.message); els.loadAllVideos.disabled = false; }
});

els.gameSelect.addEventListener("change", () => {
  if (els.mixGameSelect.value !== els.gameSelect.value) els.mixGameSelect.value = els.gameSelect.value;
  resetEvents("Game changed. Load events again.");
});

els.mixGameSelect.addEventListener("change", () => {
  if (els.gameSelect.value !== els.mixGameSelect.value) els.gameSelect.value = els.mixGameSelect.value;
  resetEvents("Game changed. Load events again.");
});

for (const el of [els.season, els.seasonType]) {
  el.addEventListener("change", () => {
    fillGames([]);
    resetEvents("Season changed. Search/select the player again or load games for this season.");
    els.loadSeasonEvents.disabled = !els.playerSelect.value;
  });
}

for (const el of [els.playerVideoOnly, els.seasonVideoOnly, els.gameVideoOnly]) {
  el.addEventListener("change", () => resetEvents("Video-only setting changed. Load events again."));
}

$$('.tab').forEach(button => button.addEventListener('click', () => setMode(button.dataset.tab)));

for (const box of [els.categoryChecks, els.playTypeChecks, els.shotTypeChecks, els.specialTagChecks]) {
  box.addEventListener("change", () => applyFilters());
}

els.showSelectedOnly.addEventListener("click", () => applyFilters());
els.clearFilters.addEventListener("click", () => {
  for (const input of $$(".checks input[type='checkbox']")) input.checked = false;
  applyFilters();
});
els.orderMode.addEventListener("change", () => applyFilters({ randomize: els.orderMode.value === "random" }));
els.randomizeNow.addEventListener("click", () => {
  els.orderMode.value = "random";
  applyFilters({ randomize: true });
});

els.events.addEventListener("click", async event => {
  const btn = event.target.closest(".loadOne");
  if (!btn) return;

  const gameId = btn.dataset.game;
  const eventId = btn.dataset.event;
  try {
    btn.disabled = true;
    btn.textContent = "Loading...";
    const video = await api(`/api/video?gameId=${encodeURIComponent(gameId)}&eventId=${encodeURIComponent(eventId)}`);
    const original = currentEvents.find(e => String(e.gameId) === String(gameId) && String(e.actionNumber) === String(eventId));
    const card = document.querySelector(`[data-event-card="${CSS.escape(String(gameId))}-${CSS.escape(String(eventId))}"]`);
    if (original && card) card.outerHTML = eventCard(original, video);
    setStatus(video.videoUrl ? "Video loaded through the local proxy." : "NBA did not return a direct MP4 for that event. Use the NBA page button.");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Try again";
    setStatus(err.message);
  }
});

Promise.all([loadSeasons(), loadTagCatalog()]).then(() => {
  setStatus("Search a player, select a season, then choose Player Game, Season Tape, or Game Mix.");
});
