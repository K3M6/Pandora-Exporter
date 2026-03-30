/**
 * Pandora Browser Data Exporter v7
 * ==================================
 * Paste this entire script into your browser's DevTools console
 * while on pandora.com (the script handles login — you don't need
 * to be logged in first).
 *
 * What it exports (JSON + CSV):
 *   - All your stations (with seed info)
 *   - Thumbs up & thumbs down per station
 *   - Saved songs, albums, artists, and playlists
 *   - A CSV of liked tracks for easy Spotify/YouTube Music/Apple Music import
 *
 * To stop the export mid-run:
 *   Type `window.__pandoraExportAbort()` in the console.
 *
 * NOTE: The exported JSON contains raw Pandora API responses, which
 * may include internal identifiers. Fields prefixed with _ (like
 * _stationName) were added by this script, not Pandora. Review the
 * file before sharing it publicly.
 *
 * If no login prompt appears, your browser may be blocking dialogs.
 *
 * Tested against Pandora API v1 as of 2026-03-29. If endpoints
 * return 404, the API may have changed.
 *
 * SPDX-License-Identifier: MIT
 *
 * SECURITY: Before running, verify this script only makes requests
 * to https://www.pandora.com — search for "fetch(" to confirm.
 *
 * Instructions:
 *   1. Go to https://www.pandora.com
 *   2. Open DevTools: F12 (Windows/Linux) or Cmd+Option+I (Mac)
 *   3. Click the "Console" tab
 *   4. Paste this entire script and press Enter
 *   5. Enter your email and password when prompted
 *   6. Wait — files will download automatically when done
 */

(async () => {

  // ── Domain check ─────────────────────────────────────────────────────────────
  if (!/(?:^|\.)pandora\.com$/.test(location.hostname)) {
    console.error(
      "This script must be run on pandora.com.\n" +
      "Navigate to https://www.pandora.com and try again."
    );
    return;
  }

  const BASE = "https://www.pandora.com/api";
  const MAX_RETRIES = 5;
  const MAX_RETRY_WAIT = 60;

  // ── Abort support ────────────────────────────────────────────────────────────
  const abortController = new AbortController();
  window.__pandoraExportAbort = () => {
    abortController.abort();
    console.log("Aborting export...");
  };
  const signal = abortController.signal;

  function checkAbort() {
    if (signal.aborted) throw new Error("Export aborted by user.");
  }

  // Pandora uses double-submit CSRF: the server checks that the X-CsrfToken
  // header matches the csrftoken cookie. Any value works as long as they match.
  // If Pandora switches to server-validated tokens, this will fail with a 403.
  function getCsrf() {
    const fromCookie = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
    if (fromCookie) return fromCookie;
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    const generated = Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
    document.cookie = `csrftoken=${generated}; path=/; domain=.pandora.com`;
    return generated;
  }

  // H2 fix: remove abort listener on happy path to prevent listener accumulation
  const sleep = ms => new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new Error("Export aborted by user.")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

  async function api(path, body, authToken, retries = 0) {
    checkAbort();
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "include",
      signal,
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "X-CsrfToken":  getCsrf(),
        "X-AuthToken":  authToken ?? "",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      if (retries >= MAX_RETRIES) {
        throw new Error(`Rate limited on ${path} after ${MAX_RETRIES} retries. Try again in a few minutes.`);
      }
      const raw = parseInt(res.headers.get("Retry-After") || "15", 10);
      const wait = Math.min(isNaN(raw) ? 15 : raw, MAX_RETRY_WAIT);
      console.warn(`  Pandora is asking us to slow down. Waiting ${wait}s (retry ${retries + 1}/${MAX_RETRIES})...`);
      await sleep(wait * 1000);
      return api(path, body, authToken, retries + 1);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} on ${path}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  async function login(email, password) {
    const result = await api("/v1/auth/login", { username: email, password }, "");
    const token = result?.authToken ?? result?.userAuthToken;
    if (!token) {
      console.debug("Login response (for troubleshooting):", result);
      throw new Error(
        "Login failed — no auth token received. Possible causes:\n" +
        "  - Incorrect email or password\n" +
        "  - Account requires CAPTCHA or email verification\n" +
        "  - Pandora API format has changed\n" +
        "Check the console for the raw response above."
      );
    }
    return token;
  }

  // ── Download helpers ─────────────────────────────────────────────────────────
  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function downloadJSON(filename, data) {
    downloadFile(filename, JSON.stringify(data, null, 2), "application/json");
  }

  // H4 fix: CSV formula injection prevention + M1 fix: handle \r
  function toCSV(headers, rows) {
    const escape = v => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const lines = [headers.map(escape).join(",")];
    for (const row of rows) {
      lines.push(headers.map(h => escape(row[h])).join(","));
    }
    return lines.join("\n");
  }

  // L2 fix: UTF-8 BOM for Excel compatibility
  function downloadCSV(filename, headers, rows) {
    downloadFile(filename, "\uFEFF" + toCSV(headers, rows), "text/csv;charset=utf-8");
  }

  // ── Paginated fetch helper ───────────────────────────────────────────────────
  // M10 fix: reduced inter-page sleep from 300ms to 100ms
  async function fetchAllPages(path, body, resultKey, authToken) {
    const all = [];
    let startIndex = 0;
    const pageSize = body.pageSize ?? 100;
    while (true) {
      checkAbort();
      const data = await api(path, { ...body, startIndex }, authToken);
      const page = data?.[resultKey] ?? [];
      for (const item of page) all.push(item);
      if (page.length < pageSize) break;
      startIndex += page.length;
      await sleep(100);
    }
    return all;
  }

  // ── Fetch all stations ───────────────────────────────────────────────────────
  async function fetchStations(authToken) {
    console.log("Fetching stations...");
    const stations = await fetchAllPages(
      "/v1/station/getStations",
      { pageSize: 250 },
      "stations",
      authToken,
    );
    console.log(`  Found ${stations.length} stations`);
    return stations;
  }

  // ── Fetch thumbs for one station ─────────────────────────────────────────────
  async function fetchThumbsForStation(station, authToken) {
    const id = station.stationId;
    if (!id) return { up: [], down: [] };

    const fetchFeedback = async (positive) => {
      try {
        return await fetchAllPages(
          "/v1/station/getStationFeedback",
          { stationId: id, pageSize: 100, positive },
          "feedback",
          authToken,
        );
      } catch (e) {
        if (signal.aborted) throw e;
        console.warn(`    Skipping ${positive ? "thumbs up" : "thumbs down"} for "${station.name}": ${e.message}`);
        return [];
      }
    };

    const [up, down] = await Promise.all([fetchFeedback(true), fetchFeedback(false)]);
    return { up, down };
  }

  // ── Fetch thumbs sequentially ──────────────────────────────────────────────
  async function fetchAllThumbs(stations, authToken) {
    const thumbsUp = [];
    const thumbsDown = [];

    for (let i = 0; i < stations.length; i++) {
      const station = stations[i];
      checkAbort();
      console.log(`  [${i + 1}/${stations.length}] ${station.name}`);
      const { up, down } = await fetchThumbsForStation(station, authToken);
      for (const t of up)   { t._stationName = station.name; thumbsUp.push(t); }
      for (const t of down) { t._stationName = station.name; thumbsDown.push(t); }
      await sleep(200);
    }

    return { thumbsUp, thumbsDown };
  }

  // ── Fetch collection (saved songs, albums, artists, playlists) ───────────────
  async function fetchCollection(authToken) {
    console.log("Fetching collection...");
    const types = { songs: "TR", albums: "AL", artists: "AR", playlists: "PL" };
    const result = {};

    for (const [label, type] of Object.entries(types)) {
      checkAbort();
      try {
        result[label] = await fetchAllPages(
          "/v1/collection/getSortedItems",
          { type, sortOrder: "DATE_ADDED_DESC", pageSize: 100 },
          "items",
          authToken,
        );
        console.log(`  ${label}: ${result[label].length}`);
      } catch (e) {
        if (signal.aborted) throw e;
        console.warn(`  Skipping ${label}: ${e.message}`);
        result[label] = [];
      }
      await sleep(50);
    }

    return result;
  }

  // ── Strip internal identifiers for sharing ───────────────────────────────────
  const SENSITIVE_KEYS = new Set([
    "listenerId", "listenerIdToken", "listenerPandoraId",
    "pandoraId", "stationToken", "feedbackId",
    "artUrl", "albumArtUrl", "thumbnailUrl",
  ]);

  function sanitize(obj) {
    if (Array.isArray(obj)) return obj.map(sanitize);
    if (obj && typeof obj === "object") {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!SENSITIVE_KEYS.has(k)) out[k] = sanitize(v);
      }
      return out;
    }
    return obj;
  }

  // ── Main ─────────────────────────────────────────────────────────────────────
  let authToken;
  let password;
  const startTime = Date.now();
  try {
    console.log("Pandora Data Exporter v7");
    console.log("To abort: type window.__pandoraExportAbort()\n");

    const email = prompt("Pandora email address:");
    if (!email) return console.log("Cancelled.");
    password = prompt("Pandora password (sent only to pandora.com over HTTPS):");
    if (!password) return console.log("Cancelled.");

    console.log("Logging in...");
    authToken = await login(email.trim(), password);
    password = null;
    console.log("Login successful\n");

    // ── Stations ───────────────────────────────────────────────────────────────
    const stations = await fetchStations(authToken);

    if (stations.length === 0) {
      console.warn(
        "No stations found. This could mean:\n" +
        "  - The account is new or empty\n" +
        "  - You're logged into the wrong account\n" +
        "  - Pandora returned an unexpected response"
      );
    }

    // ── Thumbs ─────────────────────────────────────────────────────────────────
    let thumbsUp = [];
    let thumbsDown = [];

    if (stations.length > 0) {
      console.log("\nFetching thumbs for each station...");
      const thumbs = await fetchAllThumbs(stations, authToken);
      thumbsUp = thumbs.thumbsUp;
      thumbsDown = thumbs.thumbsDown;
    }

    console.log(`\nTotal thumbs up:   ${thumbsUp.length}`);
    console.log(`Total thumbs down: ${thumbsDown.length}`);

    // ── Collection ─────────────────────────────────────────────────────────────
    const collection = await fetchCollection(authToken);

    // ── Build exports ──────────────────────────────────────────────────────────
    const dateStr = new Date().toISOString().slice(0, 10);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

    const fullExport = {
      _notice: "This file contains raw Pandora API data. Review before sharing — it may include internal account identifiers. Fields prefixed with _ were added by this exporter.",
      _fieldsToReviewBeforeSharing: [...SENSITIVE_KEYS],
      exportedAt: new Date().toISOString(),
      stations,
      thumbsUp,
      thumbsDown,
      collection,
    };

    const sanitized = sanitize(fullExport);
    downloadJSON(`pandora_export_${dateStr}.json`, fullExport);
    downloadJSON(`pandora_export_${dateStr}_sanitized.json`, sanitized);

    // CSV of liked tracks (for Spotify/YouTube Music/Apple Music import)
    if (thumbsUp.length > 0) {
      const csvRows = thumbsUp.map(t => ({
        "Track Name": t.songName ?? t.songTitle ?? t.trackName ?? "",
        "Artist Name": t.artistName ?? t.artist ?? "",
        "Album Name": t.albumName ?? t.albumTitle ?? t.album ?? "",
        "Station": t._stationName ?? "",
      }));
      downloadCSV(
        `pandora_liked_tracks_${dateStr}.csv`,
        ["Track Name", "Artist Name", "Album Name", "Station"],
        csvRows,
      );
      console.log(`  Liked tracks CSV exported (${csvRows.length} tracks)`);
    } else {
      console.log("  No liked tracks — CSV export skipped.");
    }

    console.log(`\nDone in ${elapsed}s!`);
    console.log(`Stations:     ${stations.length}`);
    console.log(`Thumbs up:    ${thumbsUp.length}`);
    console.log(`Thumbs down:  ${thumbsDown.length}`);
    console.log(`Saved songs:  ${collection.songs?.length ?? 0}`);
    console.log(`Saved albums: ${collection.albums?.length ?? 0}`);
    console.log(`Artists:      ${collection.artists?.length ?? 0}`);
    console.log(`Playlists:    ${collection.playlists?.length ?? 0}`);
    console.log("\nFiles downloaded:");
    console.log(`  pandora_export_${dateStr}.json (full raw data)`);
    console.log(`  pandora_export_${dateStr}_sanitized.json (safe to share)`);
    if (thumbsUp.length > 0) {
      console.log(`  pandora_liked_tracks_${dateStr}.csv (for Spotify/YT Music import)`);
    }

  } catch (err) {
    // L5 fix: null password on error path too
    password = null;
    console.error("\nExport failed:", err);
  } finally {
    delete window.__pandoraExportAbort;
    // H1 fix: use raw fetch for logout, bypassing abort-aware api() wrapper
    if (authToken) {
      fetch(`${BASE}/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CsrfToken": getCsrf(),
          "X-AuthToken": authToken,
        },
        body: "{}",
      }).catch(() => {});
    }
  }

})();
