# Live Location Tracker — University GIS Assignment

A consent-based, single-page web application that tracks the user's own device location in real time using the browser **Geolocation API** and displays it on an interactive **Leaflet** map. All coordinates and session path points stay strictly in browser tab memory.

---

## 1. Project Structure

- `index.html` — Semantic, accessible HTML structure: header with status pill, alert/simulation banners, map container, tracking controls, live telemetry readout, separated Simulated Testing card, and privacy notice.
- `styles.css` — Mobile-first responsive CSS (`50vh` map on phones, sticky two-column layout at `>= 960px`), `>= 44px` touch targets, high-contrast palette, and visible `:focus-visible` keyboard rings.
- `app.js` — Application logic:
  - Secure-context (`HTTPS` / `localhost`) and `file://` checks
  - Online/offline detection and tile-load error handling
  - Leaflet map with **English Street Map (Esri)** default and **OpenStreetMap (Local Labels)** in the layer switcher
  - `watchPosition` / `clearWatch` tracking with duplicate-session protection
  - Marker, estimated accuracy circle, "Centre on location", and in-memory session polyline (capped at 500 points, `>= 2 m` step filter)
  - Isolated **Simulated Testing Mode** for indoor/desktop testing
- `README.md` — Run/deploy instructions, testing checklist, and assignment explanation notes.

---

## 2. Running Locally

Do **not** double-click `index.html` (`file://`), because browsers restrict Geolocation on `file://` and OpenStreetMap blocks tile requests without an HTTP `Referer` (`403 Access blocked`).

Start a local web server in this folder:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

---

## 3. Deploying to a Free HTTPS Host (For Phone Testing)

Phone browsers require **HTTPS** for `navigator.geolocation` (except `localhost` on the same device). Two free options with no backend needed:

### Option A: GitHub Pages (Recommended)
1. Create a public GitHub repository and push `index.html`, `styles.css`, `app.js`, and `README.md` to the `main` branch.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, choose `main` / `/ (root)`, and click **Save**.
4. Wait ~1–2 minutes for GitHub to publish your `https://<username>.github.io/<repo>/` URL, then open it on your phone.

### Option B: Netlify Drop (Fastest, No Git Required)
1. Go to [https://app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop the `gis-live-tracker` folder onto the page.
3. Open the generated `https://...netlify.app` URL on your phone.

### Hosting & Map-Service Limitations
- **Free static hosts** (GitHub Pages / Netlify) have bandwidth soft limits and no backend compute—ideal for a client-side privacy-preserving app.
- **Public tile servers** (Esri World Street Map and OpenStreetMap) are rate-limited and intended for light/educational use, not heavy commercial traffic. Required map attributions must remain visible.
- **Network privacy:** Even without a backend of our own, loading map tiles sends HTTP requests (and therefore the user's IP address) to Esri or OpenStreetMap tile servers.

---

## 4. Testing Results & Phone Verification Checklist

### Verified in Local Development Environment
- **Static HTTP serving:** `python -m http.server` served `/`, `/styles.css`, and `/app.js` with `HTTP 200`.
- **Esri tile endpoint check:** Fetching a sample tile (`.../World_Street_Map/MapServer/tile/2/1/2`) returned `HTTP 200` (`image/jpeg`, `24638` bytes).
- **Zero persistence / backend scan:** Searching `app.js` for `localStorage`, `sessionStorage`, `indexedDB`, `fetch(`, `XMLHttpRequest`, and `sendBeacon` returned `0` matches.
- **Not tested in this environment:** Interactive browser DOM execution, real phone GPS hardware, permission prompts, and mobile touch layout (Node.js is also not installed in this environment).

### Manual Checklist (Verify on Your Phone & Laptop)

| Test Case | Steps to Verify | Expected Result | Status |
| :--- | :--- | :--- | :--- |
| **Granting permission** | Open HTTPS URL on phone → tap **Start tracking** → tap **Allow** | Status changes to `Tracking active`; marker, accuracy circle, and coordinates appear | Not tested (verify on phone) |
| **Denying permission** | Tap **Start tracking** → tap **Block / Don't Allow** | Status shows `Permission denied`; alert explains how to re-enable in site settings; no fake coordinates shown | Not tested |
| **Start, stop, restart** | Start tracking → wait for fix → tap **Stop tracking** → tap **Start tracking** again | Stopping calls `clearWatch`, shows `Stopped`, and keeps the last marker visible; restarting resumes updates | Not tested |
| **Repeated Start clicks** | Click/tap **Start tracking** rapidly multiple times | Button disables after first click; `watchId` guard prevents duplicate sessions | Not tested |
| **Marker & readout updates** | Walk outdoors with phone for 1–2 minutes | Marker moves, coordinates and timestamp update, estimated accuracy displays in metres | Not tested |
| **Path drawing & clearing** | Walk > 2 m so polyline draws → tap **Clear path** | Blue trail follows movement (max 500 points); **Clear path** removes the line and resets counter to `0 / 500` | Not tested |
| **Simulated mode separation** | Run **Start simulated demo**, then click **Start tracking** | Purple `SIMULATED MODE ACTIVE` banner appears during demo and clears cleanly before real tracking starts | Not tested |
| **Location timeout** | Test deep indoors or throttle/block GPS fix for > 15 s | After ~15 s, alert reports timeout and explains weak signal while continuing to listen | Not tested |
| **Offline & tile errors** | Turn on Airplane Mode / disconnect Wi-Fi and pan the map | Offline banner and/or tile-load alert appears without crashing the app | Not tested |
| **HTTPS vs. insecure page** | Open via `http://<your-pc-lan-ip>:8080` on phone (or `file://`) | Alert banner warns that Geolocation is blocked on insecure pages | Not tested |
| **Phone & desktop layouts** | View on phone portrait + laptop wide screen | Phone stacks map above controls; laptop shows map on left and controls on right | Not tested |
| **Accessibility basics** | Press `Tab` through all controls; use `Enter`/`Space` | Skip link works, focus ring is clearly visible, all buttons/labels are readable | Not tested |
| **No saved/sent data** | Open Browser DevTools → **Network** & **Application** tabs | Only tile/CDN requests appear; no coordinate payloads sent; `localStorage`/`IndexedDB` remain empty | Not tested (code scan = 0) |

---

## 5. Assignment Explanation Notes (For Your Lecturer)

### App Design & Development Approach
- Built with **plain HTML, CSS, and JavaScript** plus **Leaflet** (`1.9.4`) to keep dependencies minimal, transparent, and easy to inspect without a build step.
- Designed around **explicit consent** and **data minimization**: no accounts, no database, and no persistent storage.

### How Browser Geolocation & GIS Web Mapping Work
- The browser **Geolocation API** (`navigator.geolocation.watchPosition`) returns **WGS84** latitude/longitude coordinates (in decimal degrees) and an estimated horizontal accuracy radius (in metres).
- **Leaflet** projects those WGS84 coordinates onto **Web Mercator (`EPSG:3857`)** raster map tiles fetched over HTTPS (`{z}/{x}/{y}` zoom/column/row grid).

### Accuracy Limitations & Location Sources
- Browsers **do not guarantee GPS alone**. Depending on the device and environment, the OS/browser blends:
  - **GPS / GNSS satellites:** Best accuracy outdoors (~3–15 m), weak or unavailable indoors, higher battery cost.
  - **Wi-Fi positioning:** Uses nearby router MAC addresses (~15–100 m), fast indoors.
  - **Cell-tower triangulation:** Broad area estimate (~100 m–several km).
  - **IP geolocation (desktop fallback):** City/region level only (kilometres of error).
- That is why the UI explicitly labels accuracy as an **estimate, not a guarantee** and draws an accuracy circle around the marker.
- **Background limits:** Mobile browsers throttle or pause JavaScript and `watchPosition` when the screen locks or the tab moves to the background.

### Privacy Safeguards
- Tracking starts only after an explicit button press and browser permission grant.
- Stopping calls `clearWatch` immediately; clearing the path wipes the in-memory array.
- Simulated mode is visually and programmatically isolated so test data is never mistaken for real user location.

### Implemented Now vs. Future Work
- **Implemented:** Consent-gated `watchPosition`/`clearWatch`, live telemetry readout, accuracy circle, recenter button, 500-point in-memory polyline, clear path, error/offline/secure-context handling, English/OSM basemap switcher, and isolated simulated demo.
- **Future Work (Not Implemented):** User-initiated GPX/GeoJSON export, Service Worker caching for offline map tiles, speed/heading display, or configurable sampling intervals.

---

## 6. Cross-Device Consent Sharing (Firebase + HTTPS Tunnel)

### New Files Added
- `firebase-config.js` — Holds your public Firebase Web App configuration (`apiKey`, `authDomain`, `projectId`, `appId`). These are public client identifiers, **not** server secrets; never put an Admin SDK private key in client code.
- `firestore.rules` — Server-enforced Firestore Security Rules requiring Firebase Authentication, restricting `list` queries to `ownerUid`, binding `sharerUid` on accept/decline, blocking updates after `expiresAt`, `declined`, `stopped`, or `revoked`, and allowing only `ownerUid` to delete the document.
- `share.js` — Handles creating time-limited share links, the recipient consent screen (`?share=<id>`), live remote marker/stale-age display, revocation/deletion, and the separate consent-gated approximate IP lookup.

### Firebase Setup (Free Spark Plan)
1. Create a project at [https://console.firebase.google.com](https://console.firebase.google.com).
2. Register a **Web App** (`</>`) and copy its `firebaseConfig` object into `firebase-config.js`.
3. In **Build → Authentication → Sign-in method**, enable **Anonymous**.
   *(For stricter identity in production, you can require Email/Google sign-in for the requester instead of Anonymous Auth.)*
4. In **Build → Firestore Database**, create a database in **Production mode**, then paste the contents of `firestore.rules` into the **Rules** tab and click **Publish**.

### Testing on Two Devices Locally Using HTTPS (`ngrok`)
Phones require **HTTPS** for `navigator.geolocation`, so `http://<local-ip>:8080` will be blocked by mobile browsers. Use an HTTPS tunnel such as `ngrok`:

1. Start the local server in this folder:
   ```powershell
   python -m http.server 8080
   ```
2. In a second terminal, start an HTTPS tunnel to port `8080`:
   ```powershell
   ngrok http 8080
   ```
3. Open the `https://....ngrok-free.app` URL on **Device A (Laptop)**, enter your name/label, choose an expiry duration, and click **Generate share link**.
4. Send that `?share=...` link to **Device B (Phone)** and open it in the phone's browser.

### Revoking Sharing & Stored Data
- **Stop sharing (Device B):** Calls `clearWatch`, sets `status: "stopped"` in Firestore, and stops all future coordinate writes (enforced by `firestore.rules`). The last shared position remains visible on Device A marked as **Sharing stopped by device owner**.
- **Revoke & delete (Device A):** Click **Revoke & delete** to delete the `shares/{shareId}` document from Firestore and remove the shared marker from the map immediately.

### Browser Background Update Limits
- Mobile browsers (iOS Safari, Android Chrome) throttle or pause JavaScript timers and `navigator.geolocation.watchPosition` when the screen locks, the browser is minimized, or the tab is backgrounded. Continuous background tracking requires a native app or platform-specific permissions, which standard web pages cannot guarantee.

### Two-Device Verification Checklist (Not Tested Here — Requires Firebase Config + 2 Devices)

| Scenario | How to Test | Expected Result | Status |
| :--- | :--- | :--- | :--- |
| **Accept & share** | Open `?share=...` on phone → tap **Accept and share** → allow browser location | Phone shows **Stop sharing**; laptop map shows teal shared marker, accuracy, and live time | Not tested (requires Firebase + 2 devices) |
| **Decline** | Open a fresh `?share=...` link → tap **Decline** | Phone confirms nothing shared; laptop shows `Declined by recipient` | Not tested |
| **Denied browser permission** | Tap **Accept and share** → tap **Block** on browser prompt | Phone shows permission denied; no coordinates written to Firestore | Not tested |
| **Stop sharing** | While active, tap **Stop sharing** on phone | Phone stops `watchPosition`; laptop shows `Sharing stopped by device owner` | Not tested |
| **Stale indicator** | Lock phone or pause updates for > 30 s while active | Laptop status changes to `Active — STALE (last update Xs ago)` | Not tested |
| **Link expiry** | Wait past `expiresAt` (or test an expired link) | Firestore rules reject further writes; both devices show `Expired` | Not tested |
| **Access restriction** | Try opening the share doc from a 3rd browser after it is accepted | `firestore.rules` blocks read/write because `auth.uid` is neither `ownerUid` nor `sharerUid` | Not tested |
| **Lost connection** | Put phone in Airplane Mode while sharing | Updates pause; laptop marks last update as `STALE` once > 30 s old | Not tested |
| **Separate IP lookup** | Check agreement box → click **Check approximate IP location** | Shows ISP/city estimate clearly labelled as approximate network location only | Not tested in browser (`ipwho.is` HTTP 200 verified) |
