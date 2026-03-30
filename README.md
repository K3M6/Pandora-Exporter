# Pandora Data Exporter

Export your Pandora stations, thumbs (likes/dislikes), and saved music library. Runs entirely in your browser — your credentials are sent only to Pandora, never to any third party.

## What it exports

- All your stations
- Thumbs up and thumbs down for each station
- Saved songs, albums, artists, and playlists
- A CSV of liked tracks for easy import into Spotify, YouTube Music, or Apple Music

## Output files

| File | Contents | Share safely? |
|------|----------|---------------|
| `pandora_export_YYYY-MM-DD.json` | Full raw API data | No — contains internal account IDs |
| `pandora_export_YYYY-MM-DD_sanitized.json` | Same data with identifiers stripped | Yes |
| `pandora_liked_tracks_YYYY-MM-DD.csv` | Track Name, Artist, Album, Station (only if you have liked tracks) | Yes |

## How to use

1. Go to [pandora.com](https://www.pandora.com)
2. Open DevTools: `F12` (Windows/Linux) or `Cmd+Option+I` (Mac)
3. Click the **Console** tab
4. Copy the entire contents of [`pandora-exporter.js`](pandora-exporter.js) and paste it into the console
5. Press **Enter**
6. Enter your email and password when prompted
7. Wait — files download automatically when done

To stop the export mid-run, type `window.__pandoraExportAbort()` in the console.

## Importing liked tracks to another service

The CSV file (`pandora_liked_tracks_*.csv`) contains columns that most playlist import tools expect:

- **[TuneMyMusic](https://www.tunemymusic.com/)** — upload the CSV, select Spotify/YouTube Music/Apple Music as destination
- **[Soundiiz](https://soundiiz.com/)** — import CSV, map columns to Track/Artist/Album, export to any supported service
- **Manual** — open the CSV in a spreadsheet and search for each track on your new service

## Security

**This script runs entirely in your browser on pandora.com.** Your password is sent only to Pandora's servers over HTTPS, never stored, and cleared from memory immediately after login. The session is logged out automatically when the export finishes.

### Verifying the script before running it

Before pasting any script into your browser console, verify it yourself:

1. Search the script for `fetch(` — every network call should go to `https://www.pandora.com/api` and nowhere else
2. Check that the `BASE` constant near the top points to `https://www.pandora.com/api`
3. The script is ~400 lines and fully readable. If a fork is significantly longer or obfuscated, do not run it
4. **Never run a minified version of this script**

### What's in the exported JSON

The raw export (`pandora_export_*.json`) contains whatever Pandora's API returns, which may include:

- `listenerId`, `listenerIdToken` — unique account identifiers
- `pandoraId`, `stationToken` — internal resource IDs
- `artUrl`, `albumArtUrl` — CDN URLs that may contain tracking parameters
- Timestamps showing when you thumbed or saved each item

The sanitized export strips these fields. **Use the sanitized version if sharing your data publicly.**

To manually strip identifiers from the raw export:

```bash
jq 'walk(if type == "object" then del(.listenerId, .listenerIdToken, .pandoraId, .listenerPandoraId, .stationToken, .feedbackId, .artUrl, .albumArtUrl, .thumbnailUrl) else . end)' pandora_export_*.json > clean.json
```

## Disclaimer

This tool is for **personal data export only**. It is not affiliated with or endorsed by Pandora or SiriusXM. Use of this script is at your own risk and subject to Pandora's Terms of Service. If Pandora provides an official data export tool, prefer that instead.

Users have a right to their own data under GDPR, CCPA, and similar regulations. This tool helps exercise that right.

## Limitations

- Tested against Pandora's internal API v1 as of March 2026. The API is undocumented and may change without notice.
- Very large accounts (1000+ stations) may take a long time. The script includes rate-limit handling and will retry up to 5 times if Pandora asks it to slow down.
- `prompt()` shows your password in cleartext in the dialog — this is a browser limitation. Your password is never logged or saved.
- Listening history and podcast subscriptions are not currently exported (these endpoints have not been verified).

## License

[MIT](LICENSE)
