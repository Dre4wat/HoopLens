// HoopLens - NBA event video explorer
// No npm install needed. Requires Node.js 18+ because it uses built-in fetch.
// This is an unofficial local project that reads NBA.com Stats endpoints through your own local Node server.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL, URLSearchParams } = require("url");
const { Readable } = require("stream");

const PORT = process.env.PORT || 3000;
const NBA_STATS_BASE = "https://stats.nba.com/stats";
const PUBLIC_DIR = path.join(__dirname, "public");
const CACHE_MS = 1000 * 60 * 30;
const cache = new Map();

const TAG_CATALOG = {
  clockScoreTags: [
    "Buzzer Beater",
    "Game Winner",
    "Clutch",
    "Clutch Shot",
    "Clutch Free Throw",
    "Tying Shot",
    "Tying Free Throw",
    "Go-Ahead Shot",
    "Go-Ahead Free Throw",
    "Possible Game Winner"
  ],
  shotDetailTags: [
    "One-Hand Dunk",
    "Two-Hand Dunk",
    "Alley-Oop",
    "Alley-Oop Dunk",
    "Alley-Oop Layup",
    "Putback",
    "Putback Dunk",
    "Putback Layup",
    "Reverse",
    "Driving",
    "Running",
    "Standing",
    "Cutting",
    "Step Back",
    "Pullup",
    "Floater",
    "Fadeaway",
    "Hook Shot",
    "Tip Shot",
    "Bank Shot",
    "Finger Roll",
    "Turnaround",
    "3PT Shot",
    "Fast Break",
    "Second Chance",
    "And-1 Chance"
  ],
  defenseTags: [
    "Defensive Stop",
    "Block",
    "Steal",
    "Defensive Rebound",
    "Offensive Rebound",
    "Shot Blocked",
    "Forced Turnover",
    "Loose Ball",
    "Charge / Offensive Foul"
  ],
  unavailableTags: [
    "Scored On / Primary Defender",
    "Direct Matchup Assignment",
    "Contest Quality",
    "Shot Coverage Distance"
  ]
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  cache.set(key, { time: Date.now(), data });
}

function assertGameId(gameId) {
  if (!/^\d{10}$/.test(gameId || "")) {
    const err = new Error("GameID must be a 10-digit NBA game id, like 0042500405.");
    err.status = 400;
    throw err;
  }
}

function assertNumberLike(value, name) {
  if (!/^\d+$/.test(String(value || ""))) {
    const err = new Error(`${name} must be numeric.`);
    err.status = 400;
    throw err;
  }
}

function normalizeSeason(season) {
  const value = String(season || "2025-26").trim();
  if (!/^\d{4}-\d{2}$/.test(value)) {
    const err = new Error("Season must look like 2025-26.");
    err.status = 400;
    throw err;
  }
  return value;
}

function normalizeSeasonType(seasonType) {
  const allowed = ["Regular Season", "Playoffs", "Pre Season"];
  const value = String(seasonType || "Playoffs").trim();
  if (!allowed.includes(value)) {
    const err = new Error("Season Type must be Regular Season, Playoffs, or Pre Season.");
    err.status = 400;
    throw err;
  }
  return value;
}

function nbaHeaders(extra = {}) {
  return {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Origin": "https://www.nba.com",
    "Referer": "https://www.nba.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
    ...extra
  };
}

async function nbaFetch(endpoint, params) {
  if (typeof fetch !== "function") {
    const err = new Error("This app needs Node.js 18 or newer. Run: node -v");
    err.status = 500;
    throw err;
  }

  const qs = new URLSearchParams(params);
  const url = `${NBA_STATS_BASE}/${endpoint}?${qs.toString()}`;
  const cached = cacheGet(url);
  if (cached) return cached;

  const res = await fetch(url, { headers: nbaHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`NBA request failed on ${endpoint}: ${res.status} ${res.statusText} ${body.slice(0, 160)}`);
    err.status = 502;
    throw err;
  }

  const json = await res.json();
  cacheSet(url, json);
  return json;
}

function tableRows(headers, rowSet) {
  if (!Array.isArray(headers) || !Array.isArray(rowSet)) return [];
  return rowSet.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}

function resultSet(json, wantedName) {
  const wanted = String(wantedName || "").toLowerCase();
  const sets = json?.resultSets || json?.resultSet;

  if (Array.isArray(sets)) {
    const set = sets.find(s => String(s.name || s.Name || "").toLowerCase() === wanted);
    if (!set) return [];
    return tableRows(set.headers || set.Headers || [], set.rowSet || set.RowSet || []);
  }

  if (sets && typeof sets === "object") {
    const set = Object.entries(sets).find(([name]) => String(name).toLowerCase() === wanted)?.[1];
    if (!set) return [];
    if (Array.isArray(set) && set.every(x => typeof x === "object" && !Array.isArray(x))) return set;
    if (set?.headers && set?.rowSet) return tableRows(set.headers, set.rowSet);
    if (set?.Headers && set?.RowSet) return tableRows(set.Headers, set.RowSet);
  }

  return [];
}

function lowerKeyObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    out[String(key).toLowerCase()] = value;
  }
  return out;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function collectArraysDeep(value, predicate, found = []) {
  if (!value || typeof value !== "object") return found;

  if (Array.isArray(value)) {
    if (value.length && value.every(x => x && typeof x === "object" && !Array.isArray(x)) && predicate(value)) {
      found.push(value);
    }
    for (const item of value) collectArraysDeep(item, predicate, found);
    return found;
  }

  for (const item of Object.values(value)) collectArraysDeep(item, predicate, found);
  return found;
}

function extractVideoRows(json) {
  const rows = [];
  const sets = json?.resultSets || {};

  rows.push(...asArray(sets?.Meta?.videoUrls));
  rows.push(...asArray(sets?.Meta?.VideoUrls));
  rows.push(...asArray(sets?.meta?.videoUrls));
  rows.push(...asArray(sets?.videoUrls));
  rows.push(...asArray(json?.videoUrls));
  rows.push(...resultSet(json, "videoUrls"));

  const deep = collectArraysDeep(json, arr => {
    const keys = Object.keys(lowerKeyObject(arr[0] || {}));
    return keys.includes("uuid") && (keys.some(k => ["lurl", "murl", "surl", "url", "video_url"].includes(k)) || keys.includes("dur") || keys.includes("sdur") || keys.includes("ldur"));
  });
  for (const arr of deep) rows.push(...arr);

  const seen = new Set();
  return rows.filter(row => {
    if (!row || typeof row !== "object") return false;
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractPlaylistRows(json) {
  const rows = [];
  const sets = json?.resultSets || {};

  rows.push(...asArray(sets?.playlist));
  rows.push(...asArray(sets?.Playlist));
  rows.push(...asArray(json?.playlist));
  rows.push(...resultSet(json, "playlist"));

  const deep = collectArraysDeep(json, arr => {
    const keys = Object.keys(lowerKeyObject(arr[0] || {}));
    return keys.includes("gi") && (keys.includes("ei") || keys.includes("dsc"));
  });
  for (const arr of deep) rows.push(...arr);

  const seen = new Set();
  return rows.filter(row => {
    if (!row || typeof row !== "object") return false;
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pick(row, keys) {
  const lower = lowerKeyObject(row);
  for (const key of keys) {
    const value = lower[String(key).toLowerCase()];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function urlLooksPlayable(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url) && (url.includes(".mp4") || url.includes("videos.nba.com") || url.includes("nba.com"));
}

function buildCandidateUrls(videoRow, playlistRow, gameId, eventId) {
  const row = lowerKeyObject(videoRow || {});
  const play = lowerKeyObject(playlistRow || {});
  const uuid = row.uuid || row.guid || null;
  const y = play.y || play.year;
  const m = String(play.m || play.month || "").padStart(2, "0");
  const d = String(play.d || play.day || "").padStart(2, "0");
  if (!uuid || !y || !m || !d) return [];
  return ["1280x720", "960x540", "640x360", "320x180"].map(res => `https://videos.nba.com/nba/pbp/media/${y}/${m}/${d}/${gameId}/${eventId}/${uuid}_${res}.mp4`);
}

function normalizeVideoAsset(json, gameId, eventId, endpoint = "unknown") {
  const videoRows = extractVideoRows(json).map(lowerKeyObject);
  const playlistRows = extractPlaylistRows(json).map(lowerKeyObject);
  const firstWithUrl = videoRows.find(row => pick(row, ["lurl", "murl", "surl", "url", "video_url", "videoUrl", "src"]));
  const first = firstWithUrl || videoRows[0] || {};
  const play = playlistRows[0] || {};

  const directUrls = [];
  for (const row of videoRows) {
    for (const key of ["lurl", "murl", "surl", "url", "video_url", "videourl", "src", "lurl2", "murl2", "surl2"]) {
      const value = pick(row, [key]);
      if (urlLooksPlayable(value)) directUrls.push(value);
    }
  }

  const candidateUrls = directUrls.length ? directUrls : buildCandidateUrls(first, play, gameId, eventId);
  const videoUrl = candidateUrls[0] || null;
  const thumbnail = pick(first, ["lth", "mth", "sth", "ltp", "mtp", "stp", "thumbnail", "thumb", "image"]);
  const proxyUrl = videoUrl ? `/api/clip?u=${encodeURIComponent(videoUrl)}` : null;
  const nbaPageUrl = `https://www.nba.com/stats/events/?GameEventID=${encodeURIComponent(eventId)}&GameID=${encodeURIComponent(gameId)}&flag=1&sct=plot`;

  return {
    endpoint,
    videoUrl,
    proxyUrl,
    candidateUrls: [...new Set(candidateUrls)].slice(0, 6),
    thumbnail: urlLooksPlayable(thumbnail) ? thumbnail : null,
    uuid: pick(first, ["uuid", "guid"]),
    duration: pick(first, ["ldur", "mdur", "sdur", "dur"]),
    description: pick(play, ["dsc", "description"]),
    nbaPageUrl,
    message: videoUrl ? null : "The NBA returned this event but did not return a direct MP4 URL. Use the NBA page button for this clip.",
    rawCounts: { videoRows: videoRows.length, playlistRows: playlistRows.length }
  };
}

async function getVideoAsset(gameId, eventId) {
  assertGameId(gameId);
  assertNumberLike(eventId, "eventId");

  const endpoints = ["videoeventsasset", "videoevents"];
  const attempts = [];
  let best = null;

  for (const endpoint of endpoints) {
    try {
      const json = await nbaFetch(endpoint, {
        GameID: gameId,
        GameEventID: String(eventId)
      });
      const asset = normalizeVideoAsset(json, gameId, eventId, endpoint);
      attempts.push({ endpoint, ok: true, rawCounts: asset.rawCounts, hasVideoUrl: Boolean(asset.videoUrl) });
      if (!best || asset.videoUrl) best = asset;
      if (asset.videoUrl) break;
    } catch (err) {
      attempts.push({ endpoint, ok: false, error: err.message });
    }
  }

  if (!best) {
    return {
      endpoint: null,
      videoUrl: null,
      proxyUrl: null,
      candidateUrls: [],
      thumbnail: null,
      uuid: null,
      duration: null,
      description: null,
      nbaPageUrl: `https://www.nba.com/stats/events/?GameEventID=${encodeURIComponent(eventId)}&GameID=${encodeURIComponent(gameId)}&flag=1&sct=plot`,
      message: "NBA video asset request failed. Try the NBA page button.",
      attempts
    };
  }

  return { ...best, attempts };
}

function buildSeasonList() {
  const seasons = [];
  // NBA.com Stats usually accepts seasons in YYYY-YY format. This keeps every NBA season selectable.
  for (let start = 2025; start >= 1946; start--) {
    seasons.push(`${start}-${String((start + 1) % 100).padStart(2, "0")}`);
  }
  return seasons;
}

async function getAllPlayers(season) {
  season = normalizeSeason(season);
  const json = await nbaFetch("commonallplayers", {
    LeagueID: "00",
    Season: season,
    IsOnlyCurrentSeason: "0"
  });

  const rows = resultSet(json, "CommonAllPlayers");
  return rows.map(r => ({
    id: Number(r.PERSON_ID || r.personId || r.PlayerID || 0),
    name: r.DISPLAY_FIRST_LAST || r.DISPLAY_LAST_COMMA_FIRST || r.PLAYER_NAME || r.playerName || "",
    firstLast: r.DISPLAY_FIRST_LAST || "",
    lastFirst: r.DISPLAY_LAST_COMMA_FIRST || "",
    rosterStatus: Number(r.ROSTERSTATUS ?? 0),
    fromYear: r.FROM_YEAR || "",
    toYear: r.TO_YEAR || "",
    playerCode: r.PLAYERCODE || "",
    teamId: Number(r.TEAM_ID || 0),
    teamCity: r.TEAM_CITY || "",
    teamName: r.TEAM_NAME || "",
    teamAbbreviation: r.TEAM_ABBREVIATION || "",
    gamesPlayedFlag: r.GAMES_PLAYED_FLAG || ""
  })).filter(p => p.id && p.name);
}

async function searchPlayers(query, season) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) {
    const err = new Error("Type at least 2 letters of a player's name.");
    err.status = 400;
    throw err;
  }

  const players = await getAllPlayers(season);
  const clean = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const qClean = clean(q);

  return players
    .map(p => {
      const name = clean(p.name);
      const lastFirst = clean(p.lastFirst);
      const exact = name === qClean || lastFirst === qClean ? 100 : 0;
      const starts = name.startsWith(qClean) || lastFirst.startsWith(qClean) ? 40 : 0;
      const wordStarts = name.split(" ").some(part => part.startsWith(qClean)) ? 30 : 0;
      const includes = name.includes(qClean) || lastFirst.includes(qClean) ? 20 : 0;
      const activeBoost = p.rosterStatus ? 5 : 0;
      return { ...p, score: exact + starts + wordStarts + includes + activeBoost };
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.toYear) - Number(a.toYear) || a.name.localeCompare(b.name))
    .slice(0, 30)
    .map(({ score, ...p }) => p);
}

async function getPlayerGames(playerId, season, seasonType) {
  assertNumberLike(playerId, "playerId");
  season = normalizeSeason(season);
  seasonType = normalizeSeasonType(seasonType);

  const json = await nbaFetch("playergamelog", {
    DateFrom: "",
    DateTo: "",
    LeagueID: "00",
    PlayerID: String(playerId),
    Season: season,
    SeasonType: seasonType
  });

  const rows = resultSet(json, "PlayerGameLog");
  return rows.map(r => ({
    gameId: String(r.Game_ID || r.GAME_ID || r.gameId || ""),
    gameDate: r.GAME_DATE || r.Game_Date || r.gameDate || "",
    matchup: r.MATCHUP || r.matchup || "",
    wl: r.WL || "",
    minutes: r.MIN || "",
    points: r.PTS ?? "",
    rebounds: r.REB ?? "",
    assists: r.AST ?? "",
    steals: r.STL ?? "",
    blocks: r.BLK ?? "",
    turnovers: r.TOV ?? ""
  })).filter(g => /^\d{10}$/.test(g.gameId));
}

function parsePersonIdsFilter(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);
  return String(value || "")
    .split(/[,:|;\s]+/)
    .map(x => Number(x))
    .filter(Boolean);
}

function titleCase(input) {
  const raw = String(input || "")
    .replace(/[_-]/g, " ")
    .replace(/\b3pt\b/gi, "3PT")
    .replace(/\b2pt\b/gi, "2PT")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  return raw.split(" ").map(word => {
    const low = word.toLowerCase();
    if (["3pt", "2pt", "ast", "blk", "stl"].includes(low)) return low.toUpperCase();
    if (/^\d/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ");
}

function normalizeSpaces(input) {
  return String(input || "").replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
}

function boolFromValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const text = String(value ?? "").toLowerCase();
  return ["1", "true", "yes", "y"].includes(text);
}

function parseClockToSeconds(clock) {
  const raw = String(clock || "").trim();
  if (!raw) return null;

  // PlayByPlayV3 often returns ISO-ish values like PT05M34.00S.
  const iso = raw.match(/^PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) return (Number(iso[1] || 0) * 60) + Number(iso[2] || 0);

  // Older rows often look like 5:34 or 00:01.
  const colon = raw.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (colon) return (Number(colon[1]) * 60) + Number(colon[2]);

  const seconds = raw.match(/^(\d+(?:\.\d+)?)$/);
  if (seconds) return Number(seconds[1]);
  return null;
}

function parseScoreValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const m = String(value ?? "").match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

function getScorePair(e) {
  const home = parseScoreValue(e.scoreHome);
  const away = parseScoreValue(e.scoreAway);
  if (home === null || away === null) return null;
  return { home, away };
}

function addUniqueTag(tags, label) {
  if (label && !tags.includes(label)) tags.push(label);
}

function hasAny(text, patterns) {
  return patterns.some(pattern => {
    if (pattern instanceof RegExp) return pattern.test(text);
    return text.includes(pattern);
  });
}

function addGeneralDetailTags(e) {
  const tags = e.specialTags || (e.specialTags = []);
  const raw = [e.description, e.actionType, e.subType, e.descriptor, e.qualifiers, e.area, e.areaDetail]
    .filter(Boolean)
    .join(" ");
  const text = cleanForMatch(raw);
  const shotType = cleanForMatch(buildShotType(e));
  const isShot = isShotEvent(e) && !isFreeThrowEvent(e);
  const isDunk = text.includes("dunk") || shotType.includes("dunk");
  const isLayup = text.includes("layup") || shotType.includes("layup");

  if (isShot && (text.includes("3pt") || text.includes("3 point") || shotType.includes("3pt"))) addUniqueTag(tags, "3PT Shot");

  if (isDunk && hasAny(text, ["one hand", "one handed", "1 hand", "1 handed"])) addUniqueTag(tags, "One-Hand Dunk");
  if (isDunk && hasAny(text, ["two hand", "two handed", "2 hand", "2 handed"])) addUniqueTag(tags, "Two-Hand Dunk");

  if (hasAny(text, ["alley oop", "alleyoop", "lob dunk", "lob layup"])) {
    addUniqueTag(tags, "Alley-Oop");
    if (isDunk) addUniqueTag(tags, "Alley-Oop Dunk");
    if (isLayup) addUniqueTag(tags, "Alley-Oop Layup");
  }

  if (text.includes("putback")) {
    addUniqueTag(tags, "Putback");
    if (isDunk) addUniqueTag(tags, "Putback Dunk");
    if (isLayup) addUniqueTag(tags, "Putback Layup");
  }

  if (text.includes("reverse")) addUniqueTag(tags, "Reverse");
  if (text.includes("driving")) addUniqueTag(tags, "Driving");
  if (text.includes("running")) addUniqueTag(tags, "Running");
  if (text.includes("standing")) addUniqueTag(tags, "Standing");
  if (text.includes("cutting")) addUniqueTag(tags, "Cutting");
  if (text.includes("step back") || text.includes("stepback")) addUniqueTag(tags, "Step Back");
  if (text.includes("pullup") || text.includes("pull up")) addUniqueTag(tags, "Pullup");
  if (text.includes("floating") || text.includes("floater")) addUniqueTag(tags, "Floater");
  if (text.includes("fadeaway") || text.includes("fade away")) addUniqueTag(tags, "Fadeaway");
  if (text.includes("hook shot") || (isShot && text.includes(" hook "))) addUniqueTag(tags, "Hook Shot");
  if (text.includes("tip shot") || text.includes("tip layup") || text.includes("tip dunk") || text.includes("tip in") || text.includes("tipshot")) addUniqueTag(tags, "Tip Shot");
  if (text.includes("bank shot") || text.includes("bank")) addUniqueTag(tags, "Bank Shot");
  if (text.includes("finger roll")) addUniqueTag(tags, "Finger Roll");
  if (text.includes("turnaround") || text.includes("turn around")) addUniqueTag(tags, "Turnaround");
  if (text.includes("fast break")) addUniqueTag(tags, "Fast Break");
  if (text.includes("second chance")) addUniqueTag(tags, "Second Chance");
  if (isShot && shotResultLabel(e) === "Made" && (text.includes("and 1") || text.includes("and one") || (text.includes("foul") && text.includes("free throw")))) addUniqueTag(tags, "And-1 Chance");

  if (text.includes("defensive rebound") || text.includes("def rebound") || text.includes("dreb") || text.includes("def ")) {
    addUniqueTag(tags, "Defensive Rebound");
    addUniqueTag(tags, "Defensive Stop");
  }
  if (text.includes("offensive rebound") || text.includes("off rebound") || text.includes("oreb") || text.includes("off ")) addUniqueTag(tags, "Offensive Rebound");
  if (e.blockPersonId || text.includes(" block ") || text.includes(" blocked ") || text.includes(" blk ")) {
    addUniqueTag(tags, "Block");
    addUniqueTag(tags, "Shot Blocked");
    addUniqueTag(tags, "Defensive Stop");
  }
  if (e.stealPersonId || text.includes(" steal ") || text.includes(" steals ") || text.includes(" stl ")) {
    addUniqueTag(tags, "Steal");
    addUniqueTag(tags, "Forced Turnover");
    addUniqueTag(tags, "Defensive Stop");
  }
  if (text.includes("loose ball")) addUniqueTag(tags, "Loose Ball");
  if (text.includes("offensive foul") || text.includes("charge")) addUniqueTag(tags, "Charge / Offensive Foul");
}

function playerContextTags(e, playerId, role) {
  const tags = [];
  const id = Number(playerId || 0);
  if (!id) return tags;
  const text = cleanForMatch([e.description, e.actionType, e.subType].filter(Boolean).join(" "));

  if (role === "Block") {
    addUniqueTag(tags, "Block");
    addUniqueTag(tags, "Defensive Stop");
  }
  if (role === "Steal") {
    addUniqueTag(tags, "Steal");
    addUniqueTag(tags, "Forced Turnover");
    addUniqueTag(tags, "Defensive Stop");
  }
  if (role === "Primary" && isShotEvent(e) && !isFreeThrowEvent(e) && e.blockPersonId && e.blockPersonId !== id) {
    addUniqueTag(tags, "Shot Blocked");
  }
  if (role === "Primary" && (text.includes("defensive rebound") || text.includes("def rebound") || text.includes("dreb") || text.includes("def "))) {
    addUniqueTag(tags, "Defensive Rebound");
    addUniqueTag(tags, "Defensive Stop");
  }
  if (role === "Primary" && (text.includes("offensive rebound") || text.includes("off rebound") || text.includes("oreb") || text.includes("off "))) {
    addUniqueTag(tags, "Offensive Rebound");
  }
  return tags;
}

function scoreMarginForSide(side, home, away) {
  if (side === "home") return home - away;
  if (side === "away") return away - home;
  return null;
}

function addTimelineContext(events) {
  const sorted = [...events].sort((a, b) => a.period - b.period || a.actionNumber - b.actionNumber);

  let finalScore = null;
  for (const e of sorted) {
    const pair = getScorePair(e);
    if (pair) finalScore = pair;
  }

  let lastScore = { home: 0, away: 0 };
  for (const e of sorted) {
    const currentScore = getScorePair(e);
    e.clockSeconds = parseClockToSeconds(e.clock);
    e.specialTags = [];
    e.scoreDeltaHome = 0;
    e.scoreDeltaAway = 0;
    e.scoringSide = null;

    const desc = cleanForMatch(e.description);
    addGeneralDetailTags(e);
    if (desc.includes("buzzer")) addUniqueTag(e.specialTags, "Buzzer Beater");
    if (desc.includes("game winner") || desc.includes("game-winning") || desc.includes("game winning")) addUniqueTag(e.specialTags, "Game Winner");
    if (desc.includes("clutch")) addUniqueTag(e.specialTags, "Clutch");

    if (currentScore) {
      e.scoreDeltaHome = currentScore.home - lastScore.home;
      e.scoreDeltaAway = currentScore.away - lastScore.away;

      if (e.scoreDeltaHome > 0 && e.scoreDeltaHome >= e.scoreDeltaAway) e.scoringSide = "home";
      if (e.scoreDeltaAway > 0 && e.scoreDeltaAway > e.scoreDeltaHome) e.scoringSide = "away";

      if (e.scoringSide) {
        const beforeMargin = scoreMarginForSide(e.scoringSide, lastScore.home, lastScore.away);
        const afterMargin = scoreMarginForSide(e.scoringSide, currentScore.home, currentScore.away);
        const finalMargin = finalScore ? scoreMarginForSide(e.scoringSide, finalScore.home, finalScore.away) : null;
        const secs = e.clockSeconds;
        const lateGame = e.period >= 4;
        const isShot = isShotEvent(e) && !isFreeThrowEvent(e);
        const isFreeThrow = isFreeThrowEvent(e);
        const made = isShot ? shotResultLabel(e) === "Made" : true;

        if (isShot && made && secs !== null && secs <= 1.5) addUniqueTag(e.specialTags, "Buzzer Beater");

        if (lateGame && secs !== null && secs <= 300 && (isShot || isFreeThrow)) {
          const closeAfter = Math.abs(currentScore.home - currentScore.away) <= 5;
          if (closeAfter) addUniqueTag(e.specialTags, isFreeThrow ? "Clutch Free Throw" : "Clutch Shot");
          if (beforeMargin < 0 && afterMargin === 0) addUniqueTag(e.specialTags, isFreeThrow ? "Tying Free Throw" : "Tying Shot");
          if (beforeMargin <= 0 && afterMargin > 0) addUniqueTag(e.specialTags, isFreeThrow ? "Go-Ahead Free Throw" : "Go-Ahead Shot");
          if (secs <= 24 && beforeMargin <= 0 && afterMargin > 0 && finalMargin !== null && finalMargin > 0) {
            addUniqueTag(e.specialTags, "Possible Game Winner");
          }
        }
      }

      lastScore = currentScore;
    }
  }

  return events;
}

function mapPbpAction(r, gameId) {
  const description = r.description || r.DESCRIPTION || r.HOMEDESCRIPTION || r.VISITORDESCRIPTION || r.NEUTRALDESCRIPTION || "";
  const personIdsFilter = parsePersonIdsFilter(r.personIdsFilter || r.PERSONIDSFILTER || r.personIds || r.person_ids_filter || "");
  const assistPersonId = Number(r.assistPersonId || r.ASSIST_PERSON_ID || r.assist_person_id || 0);
  const blockPersonId = Number(r.blockPersonId || r.BLOCK_PERSON_ID || r.block_person_id || 0);
  const stealPersonId = Number(r.stealPersonId || r.STEAL_PERSON_ID || r.steal_person_id || 0);
  const personId = Number(r.personId || r.PLAYER1_ID || r.player1_id || 0);

  for (const maybeId of [personId, assistPersonId, blockPersonId, stealPersonId]) {
    if (maybeId && !personIdsFilter.includes(maybeId)) personIdsFilter.push(maybeId);
  }

  return {
    gameId: r.gameId || r.GAME_ID || gameId,
    actionNumber: Number(r.actionNumber ?? r.EVENTNUM ?? r.eventNum ?? r.orderNumber ?? r.event_num ?? 0),
    actionId: r.actionId ?? r.action_id ?? null,
    clock: r.clock || r.PCTIMESTRING || "",
    period: Number(r.period || r.PERIOD || 0),
    teamId: Number(r.teamId || r.PLAYER1_TEAM_ID || r.offense_team_id || 0),
    teamTricode: r.teamTricode || r.team_tricode || "",
    personId,
    personIdsFilter,
    assistPersonId,
    assistPlayerName: r.assistPlayerNameInitial || r.assistPlayerName || r.ASSIST_PLAYER_NAME || "",
    blockPersonId,
    blockPlayerName: r.blockPlayerName || r.BLOCK_PLAYER_NAME || "",
    stealPersonId,
    stealPlayerName: r.stealPlayerName || r.STEAL_PLAYER_NAME || "",
    playerName: r.playerName || r.PLAYER1_NAME || r.player1_name || "",
    description,
    actionType: r.actionType || r.action_type || "Other",
    subType: r.subType || r.sub_type || "",
    descriptor: r.descriptor || r.DESCRIPTOR || "",
    qualifiers: Array.isArray(r.qualifiers) ? r.qualifiers.join(", ") : (r.qualifiers || r.QUALIFIERS || ""),
    area: r.area || r.AREA || "",
    areaDetail: r.areaDetail || r.area_detail || "",
    side: r.side || r.SIDE || "",
    shotResult: r.shotResult || r.shot_result || "",
    shotDistance: r.shotDistance ?? r.shot_distance ?? null,
    pointsTotal: r.pointsTotal ?? r.POINTS_TOTAL ?? null,
    x: r.x ?? r.X ?? r.xLegacy ?? null,
    y: r.y ?? r.Y ?? r.yLegacy ?? null,
    scoreHome: r.scoreHome || r.home_score || "",
    scoreAway: r.scoreAway || r.away_score || "",
    isFieldGoal: boolFromValue(r.isFieldGoal ?? r.IS_FIELD_GOAL ?? false),
    videoAvailable: Number(r.videoAvailable ?? r.VIDEO_AVAILABLE_FLAG ?? r.video_available ?? 0)
  };
}

async function getPlayByPlay(gameId) {
  assertGameId(gameId);
  const json = await nbaFetch("playbyplayv3", {
    GameID: gameId,
    StartPeriod: 1,
    EndPeriod: 10
  });

  let rows = [];
  if (Array.isArray(json?.game?.actions)) rows = json.game.actions;
  if (!rows.length) rows = resultSet(json, "PlayByPlay");
  if (!rows.length && Array.isArray(json?.actions)) rows = json.actions;

  const mapped = rows.map(r => mapPbpAction(r, gameId)).filter(e => e.actionNumber > 0);
  return addTimelineContext(mapped);
}

function cleanForMatch(input) {
  return String(input || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function isFreeThrowEvent(e) {
  const action = cleanForMatch(e.actionType);
  const sub = cleanForMatch(e.subType);
  const desc = cleanForMatch(e.description);
  return action.includes("freethrow") || action.includes("free throw") || sub.includes("free throw") || desc.includes("free throw");
}

function isShotEvent(e) {
  if (e.isFieldGoal) return true;
  const action = cleanForMatch(e.actionType);
  const sub = cleanForMatch(e.subType);
  const desc = cleanForMatch(e.description);
  return Boolean(
    e.shotResult ||
    action === "2pt" ||
    action === "3pt" ||
    action.includes("shot") ||
    sub.includes("shot") ||
    sub.includes("dunk") ||
    sub.includes("layup") ||
    sub.includes("hook") ||
    sub.includes("tip") ||
    desc.includes("makes") ||
    desc.includes("misses") ||
    desc.includes("jumper") ||
    desc.includes("layup") ||
    desc.includes("dunk") ||
    desc.includes("hook shot") ||
    desc.includes("tip shot")
  );
}

function isGenericShotLabel(value) {
  const text = cleanForMatch(value);
  return !text || [
    "field goal",
    "fg",
    "shot",
    "2pt",
    "3pt",
    "2pt field goal",
    "3pt field goal",
    "made field goal",
    "missed field goal"
  ].includes(text);
}

function normalizeShotWords(input) {
  let text = normalizeSpaces(input)
    .replace(/\bthree[- ]?point(?:er)?\b/ig, "3PT")
    .replace(/\btwo[- ]?point(?:er)?\b/ig, "2PT")
    .replace(/\b3[- ]?point(?:er)?\b/ig, "3PT")
    .replace(/\b2[- ]?point(?:er)?\b/ig, "2PT")
    .replace(/\b3pt\b/ig, "3PT")
    .replace(/\b2pt\b/ig, "2PT")
    .replace(/\bjumper\b/ig, "Jump Shot")
    .replace(/\bfg\b/ig, "Field Goal")
    .replace(/\s+/g, " ")
    .trim();

  // Common NBA text can become "Jump Shot Shot" after normalizing "jumper".
  // Keep labels like "Dunk Shot" and "Layup Shot" because NBA uses them as detailed play types.
  text = text
    .replace(/\bJump Shot Shot\b/ig, "Jump Shot")
    .replace(/\s+/g, " ")
    .trim();

  return titleCase(text);
}

function stripPlayerPrefix(text, playerName = "") {
  let out = normalizeSpaces(text)
    .replace(/^MISS\s+/i, "")
    .replace(/^BLOCK\s+/i, "")
    .replace(/^STEAL\s+/i, "")
    .replace(/^Turnover\s+/i, "")
    .trim();

  // Cut everything before and including a shot distance: "Hart 14' Pullup Jump Shot" -> "Pullup Jump Shot"
  const distance = out.match(/(?:^|\s)(?:\d+(?:\.\d+)?\s*(?:'|’)|\d+(?:\.\d+)?\s*-?\s*foot)\s+(.+)$/i);
  if (distance?.[1]) return distance[1].trim();

  // V3 descriptions often start with the player's last name: "Hart Driving Layup".
  const lastName = String(playerName || "").trim().split(/\s+/).pop();
  if (lastName) {
    const escaped = lastName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^.*?\\b${escaped}\\b\\s+`, "i");
    out = out.replace(re, "").trim();
  }

  // If the exact player name is present, remove everything through it.
  if (playerName) {
    const escapedFull = String(playerName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reFull = new RegExp(`^.*?\\b${escapedFull}\\b\\s+`, "i");
    out = out.replace(reFull, "").trim();
  }

  return out.trim();
}

function inferShotTypeFromDescription(e) {
  const desc = String(e?.description || "");
  if (!desc) return "";

  // Remove scoring/assist details after the shot phrase.
  let core = desc.split("(")[0].trim();

  // Classic NBA.com wording: "makes 12-foot pullup jump shot" / "misses 3PT jumper".
  const makesMisses = core.match(/\b(?:makes|misses)\s+(?:(?:\d+(?:\.\d+)?)\s*(?:-| )?foot\s+|\d+(?:\.\d+)?\s*(?:'|’)\s*)?(.+)$/i);
  if (makesMisses?.[1]) {
    const cleaned = normalizeShotWords(makesMisses[1]);
    if (cleaned && !isGenericShotLabel(cleaned)) return cleaned;
  }

  // PlayByPlayV3 wording: "MISS Hart 12' Pullup Jump Shot" or "Hart Driving Floating Jump Shot".
  core = stripPlayerPrefix(core, e?.playerName || "");

  // Remove leftover made/miss words if they survived the earlier cleanup.
  core = core.replace(/\b(?:makes|misses|made|missed)\b\s*/ig, "").trim();

  const cleaned = normalizeShotWords(core);
  return isGenericShotLabel(cleaned) ? "" : cleaned;
}

function buildShotType(e) {
  if (!isShotEvent(e) || isFreeThrowEvent(e)) return "";

  const action = titleCase(e.actionType);
  const descriptor = titleCase(e.descriptor);
  const subType = titleCase(e.subType);
  const parsed = inferShotTypeFromDescription(e);

  const descriptorGeneric = isGenericShotLabel(descriptor);
  const subGeneric = isGenericShotLabel(subType);
  const parsedGood = parsed && !isGenericShotLabel(parsed);

  let combined = "";

  if (!descriptorGeneric && !subGeneric) {
    const dClean = cleanForMatch(descriptor);
    const sClean = cleanForMatch(subType);
    combined = sClean.includes(dClean) ? subType : `${descriptor} ${subType}`;
  } else if (!subGeneric) {
    combined = subType;
  } else if (!descriptorGeneric) {
    combined = descriptor;
  }

  // If the API only says "Field Goal", trust the card description because it usually has the detailed NBA play type.
  if (!combined || isGenericShotLabel(combined)) combined = parsedGood ? parsed : "";

  if (!combined) {
    if (cleanForMatch(action) === "3pt") combined = "3PT Field Goal";
    else if (cleanForMatch(action) === "2pt") combined = "2PT Field Goal";
    else combined = "Field Goal";
  }

  const actionClean = cleanForMatch(action);
  if (actionClean === "3pt" && !/^(3PT|Three)/i.test(combined) && !/\b3PT\b|\bthree\b/i.test(combined)) {
    combined = `3PT ${combined}`;
  }
  if (actionClean === "2pt" && !/^(2PT|Two)/i.test(combined) && !/\b2PT\b|\btwo\b/i.test(combined)) {
    combined = `2PT ${combined}`;
  }

  return normalizeShotWords(combined);
}

function shotResultLabel(e) {
  const result = cleanForMatch(e.shotResult);
  const desc = cleanForMatch(e.description);
  if (result === "made" || desc.includes("makes")) return "Made";
  if (result === "missed" || desc.includes("misses")) return "Missed";
  return "Unknown";
}

function primaryCategory(e) {
  const action = cleanForMatch(e.actionType);
  const sub = cleanForMatch(e.subType);
  const desc = cleanForMatch(e.description);

  if (isFreeThrowEvent(e)) return "Free Throws";
  if (isShotEvent(e)) return `${shotResultLabel(e) === "Missed" ? "Missed" : shotResultLabel(e) === "Made" ? "Made" : ""} Field Goals`.trim();

  if (action.includes("rebound") || desc.includes("rebound")) {
    if (sub.includes("offensive") || desc.includes("off:")) return "Offensive Rebounds";
    if (sub.includes("defensive") || desc.includes("def:")) return "Defensive Rebounds";
    return "Rebounds";
  }
  if (action.includes("turnover") || desc.includes("turnover")) return "Turnovers";
  if (action.includes("steal") || desc.includes("steal")) return "Steals";
  if (action.includes("block") || desc.includes("block")) return "Blocks";
  if (action.includes("assist") || desc.includes("assist")) return "Assists";
  if (action.includes("jumpball") || desc.includes("jump ball")) return "Jump Balls";
  if (action.includes("foul") || desc.includes("foul")) return "Fouls";
  if (action.includes("violation") || desc.includes("violation")) return "Violations";
  if (action.includes("substitution") || action.includes("sub")) return "Substitutions";
  if (action.includes("timeout") || desc.includes("timeout")) return "Timeouts";
  return "Other";
}

function primaryPlayType(e) {
  const action = titleCase(e.actionType);
  const sub = titleCase(e.subType);
  const descriptor = titleCase(e.descriptor);
  const desc = cleanForMatch(e.description);

  if (isFreeThrowEvent(e)) {
    const label = sub && !cleanForMatch(sub).includes("free throw") ? `${sub} Free Throw` : "Free Throw";
    return titleCase(label);
  }
  if (isShotEvent(e)) return buildShotType(e);

  if (cleanForMatch(action).includes("rebound") || desc.includes("rebound")) {
    if (cleanForMatch(sub).includes("offensive") || desc.includes("off:")) return "Offensive Rebound";
    if (cleanForMatch(sub).includes("defensive") || desc.includes("def:")) return "Defensive Rebound";
    return "Rebound";
  }

  const joined = [descriptor, sub || action].filter(Boolean).join(" ");
  return titleCase(joined || action || "Other");
}

function eventRole(e, playerId) {
  const id = Number(playerId || 0);
  if (!id) return "Event";
  if (e.personId === id) return "Primary";
  if (e.assistPersonId === id || /\bast\b/i.test(e.description || "")) return "Assist";
  if (e.blockPersonId === id || /\bblk\b/i.test(e.description || "")) return "Block";
  if (e.stealPersonId === id || /\bstl\b/i.test(e.description || "")) return "Steal";
  return "Secondary";
}

function eventCategory(e, playerId) {
  if (!Number(playerId || 0)) return primaryCategory(e);
  const role = eventRole(e, playerId);
  if (role === "Assist") return "Assists";
  if (role === "Block") return "Blocks";
  if (role === "Steal") return "Steals";
  return primaryCategory(e);
}

function eventPlayType(e, playerId) {
  const role = eventRole(e, playerId);
  const base = primaryPlayType(e);
  if (!Number(playerId || 0)) return base;
  if (role === "Assist") return isShotEvent(e) ? `Assist on ${base}` : "Assist";
  if (role === "Block") return isShotEvent(e) ? `Block on ${base}` : "Block";
  if (role === "Steal") return "Steal";
  if (role === "Secondary") return `Involved in ${base}`;
  return base;
}

function eventInvolvesPlayer(e, playerId) {
  const id = Number(playerId || 0);
  if (!id) return false;
  return e.personId === id || e.assistPersonId === id || e.blockPersonId === id || e.stealPersonId === id || e.personIdsFilter.includes(id);
}

function enrichEvent(e, playerId = null, extra = {}) {
  const shotType = buildShotType(e);
  const role = eventRole(e, playerId);
  const playerMode = Number(playerId || 0) > 0;
  return {
    ...e,
    ...extra,
    category: eventCategory(e, playerId),
    playType: eventPlayType(e, playerId),
    shotType: shotType || "Non-shot",
    shotResult: isShotEvent(e) && !isFreeThrowEvent(e) ? shotResultLabel(e) : (e.shotResult || ""),
    role,
    primaryAction: playerMode ? e.personId === Number(playerId) : true,
    hasDirectRole: playerMode ? (e.personId === Number(playerId) || e.assistPersonId === Number(playerId) || e.blockPersonId === Number(playerId) || e.stealPersonId === Number(playerId)) : true,
    specialTags: uniqueSorted([...(Array.isArray(e.specialTags) ? e.specialTags : []), ...playerContextTags(e, playerId, role)]),
    nbaPageUrl: `https://www.nba.com/stats/events/?GameEventID=${encodeURIComponent(e.actionNumber)}&GameID=${encodeURIComponent(e.gameId)}&flag=1&sct=plot`
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(v => v && String(v).trim()))].sort((a, b) => String(a).localeCompare(String(b)));
}

async function eventsForPlayerInGame(gameId, playerId, options = {}) {
  assertGameId(gameId);
  assertNumberLike(playerId, "playerId");

  const videoOnly = options.videoOnly !== false;
  const pbp = await getPlayByPlay(gameId);
  let events = pbp
    .filter(e => eventInvolvesPlayer(e, playerId))
    .map(e => enrichEvent(e, playerId));

  if (videoOnly) events = events.filter(e => e.videoAvailable === 1);

  const filters = {
    categories: uniqueSorted(events.map(e => e.category)),
    playTypes: uniqueSorted(events.map(e => e.playType)),
    shotTypes: uniqueSorted(events.filter(e => e.shotType !== "Non-shot").map(e => e.shotType)),
    roles: uniqueSorted(events.map(e => e.role)),
    specialTags: uniqueSorted(events.flatMap(e => e.specialTags || [])),
    periods: uniqueSorted(events.map(e => e.period).filter(Boolean).map(p => `Q${p}`))
  };

  return { filters, events };
}

function buildFilters(events, includeRoles = true) {
  const filters = {
    categories: uniqueSorted(events.map(e => e.category)),
    playTypes: uniqueSorted(events.map(e => e.playType)),
    shotTypes: uniqueSorted(events.filter(e => e.shotType !== "Non-shot").map(e => e.shotType)),
    specialTags: uniqueSorted(events.flatMap(e => e.specialTags || [])),
    periods: uniqueSorted(events.map(e => e.period).filter(Boolean).map(p => `Q${p}`))
  };
  if (includeRoles) filters.roles = uniqueSorted(events.map(e => e.role));
  return filters;
}

async function eventsForGame(gameId, options = {}) {
  assertGameId(gameId);
  const videoOnly = options.videoOnly !== false;
  const pbp = await getPlayByPlay(gameId);
  let events = pbp.map(e => enrichEvent(e, null));
  if (videoOnly) events = events.filter(e => e.videoAvailable === 1);
  return { filters: buildFilters(events, false), events };
}

function parseGameDateForSort(gameDate) {
  const t = Date.parse(String(gameDate || ""));
  return Number.isFinite(t) ? t : 0;
}

async function eventsForPlayerSeason(playerId, season, seasonType, options = {}) {
  assertNumberLike(playerId, "playerId");
  const videoOnly = options.videoOnly !== false;
  const games = await getPlayerGames(playerId, season, seasonType);
  const chronologicalGames = [...games].sort((a, b) => parseGameDateForSort(a.gameDate) - parseGameDateForSort(b.gameDate));
  const events = [];
  const failures = [];

  for (const game of chronologicalGames) {
    try {
      const { events: gameEvents } = await eventsForPlayerInGame(game.gameId, playerId, { videoOnly });
      for (const e of gameEvents) {
        events.push({
          ...e,
          gameDate: game.gameDate || "",
          matchup: game.matchup || "",
          gameLine: `${game.gameDate || "Unknown date"} — ${game.matchup || game.gameId}`
        });
      }
      await new Promise(resolve => setTimeout(resolve, 60));
    } catch (err) {
      failures.push({ gameId: game.gameId, matchup: game.matchup, gameDate: game.gameDate, error: err.message });
    }
  }

  events.sort((a, b) => parseGameDateForSort(a.gameDate) - parseGameDateForSort(b.gameDate) || a.period - b.period || a.actionNumber - b.actionNumber);
  return { filters: buildFilters(events, true), events, gamesScanned: chronologicalGames.length, failures };
}

async function proxyClip(req, reqUrl, res) {
  const raw = reqUrl.searchParams.get("u") || "";
  let videoUrl;
  try {
    videoUrl = new URL(raw);
  } catch {
    return sendText(res, 400, "Bad video URL");
  }

  const allowedHost = /(^|\.)nba\.com$/i.test(videoUrl.hostname);
  if (!allowedHost || !/^https:$/i.test(videoUrl.protocol)) {
    return sendText(res, 400, "Only https NBA video URLs are allowed");
  }

  const headers = nbaHeaders({
    "Accept": "video/mp4,video/*,*/*",
    "Referer": "https://www.nba.com/stats/events/"
  });
  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = await fetch(videoUrl.toString(), { headers });
  if (!upstream.ok && upstream.status !== 206) {
    const text = await upstream.text().catch(() => "");
    return sendText(res, 502, `NBA clip request failed: ${upstream.status} ${upstream.statusText} ${text.slice(0, 120)}`);
  }

  const outHeaders = {
    "Content-Type": upstream.headers.get("content-type") || "video/mp4",
    "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    "Cache-Control": "public, max-age=300",
    "Access-Control-Allow-Origin": "*"
  };
  for (const h of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(h);
    if (value) outHeaders[h] = value;
  }

  res.writeHead(upstream.status, outHeaders);
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

async function handleApi(req, reqUrl, res) {
  const pathname = reqUrl.pathname;
  const gameId = reqUrl.searchParams.get("gameId") || "";

  if (pathname === "/api/clip") return proxyClip(req, reqUrl, res);

  if (pathname === "/api/tag-catalog") {
    return sendJson(res, 200, TAG_CATALOG);
  }

  if (pathname === "/api/seasons") {
    return sendJson(res, 200, { seasons: buildSeasonList(), defaultSeason: "2025-26" });
  }

  if (pathname === "/api/search-players") {
    const q = reqUrl.searchParams.get("q") || "";
    const season = normalizeSeason(reqUrl.searchParams.get("season") || "2025-26");
    const players = await searchPlayers(q, season);
    return sendJson(res, 200, { players });
  }

  if (pathname === "/api/player-games") {
    const playerId = reqUrl.searchParams.get("playerId");
    const season = normalizeSeason(reqUrl.searchParams.get("season") || "2025-26");
    const seasonType = normalizeSeasonType(reqUrl.searchParams.get("seasonType") || "Playoffs");
    const games = await getPlayerGames(playerId, season, seasonType);
    return sendJson(res, 200, { games });
  }

  if (pathname === "/api/game-events") {
    const videoOnly = reqUrl.searchParams.get("videoOnly") !== "0";
    const data = await eventsForGame(gameId, { videoOnly });
    return sendJson(res, 200, data);
  }

  if (pathname === "/api/player-season-events") {
    const playerId = reqUrl.searchParams.get("playerId");
    const season = normalizeSeason(reqUrl.searchParams.get("season") || "2025-26");
    const seasonType = normalizeSeasonType(reqUrl.searchParams.get("seasonType") || "Playoffs");
    const videoOnly = reqUrl.searchParams.get("videoOnly") !== "0";
    const data = await eventsForPlayerSeason(playerId, season, seasonType, { videoOnly });
    return sendJson(res, 200, data);
  }

  if (pathname === "/api/events") {
    const playerId = reqUrl.searchParams.get("playerId");
    const videoOnly = reqUrl.searchParams.get("videoOnly") !== "0";
    const data = await eventsForPlayerInGame(gameId, playerId, { videoOnly });
    return sendJson(res, 200, data);
  }

  if (pathname === "/api/video") {
    const eventId = reqUrl.searchParams.get("eventId");
    const asset = await getVideoAsset(gameId, eventId);
    return sendJson(res, 200, asset);
  }

  if (pathname === "/api/events-with-video") {
    const playerId = reqUrl.searchParams.get("playerId");
    const videoOnly = reqUrl.searchParams.get("videoOnly") !== "0";
    const { events } = await eventsForPlayerInGame(gameId, playerId, { videoOnly });

    const output = [];
    for (const e of events) {
      try {
        const video = await getVideoAsset(gameId, String(e.actionNumber));
        output.push({ ...e, video });
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (videoErr) {
        output.push({
          ...e,
          video: null,
          videoError: videoErr.message,
          nbaPageUrl: `https://www.nba.com/stats/events/?GameEventID=${encodeURIComponent(e.actionNumber)}&GameID=${encodeURIComponent(gameId)}&flag=1&sct=plot`
        });
      }
    }

    return sendJson(res, 200, { events: output });
  }

  return sendJson(res, 404, { error: "API route not found" });
}

function serveStatic(reqUrl, res) {
  let requested = decodeURIComponent(reqUrl.pathname);
  if (requested === "/") requested = "/index.html";

  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");

  fs.readFile(filePath, (err, data) => {
    if (err) return sendText(res, 404, "Not found");
    const ext = path.extname(filePath).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    if (reqUrl.pathname.startsWith("/api/")) return await handleApi(req, reqUrl, res);
    return serveStatic(reqUrl, res);
  } catch (err) {
    return sendJson(res, err.status || 500, { error: err.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log("============================================");
  console.log(`HoopLens running at http://localhost:${PORT}`);
  console.log("Open that link in Chrome/Edge.");
  console.log("Press Ctrl+C in this window to stop the server.");
  console.log("============================================");
});
