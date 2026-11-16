(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuration & Application State
  // ---------------------------------------------------------------------------
  const CONFIG = {
    // Esri World Street Map renders labels in English without requiring an API key.
    // OpenStreetMap Standard is also included in the layer switcher for comparison.
    esriTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    esriAttribution:
      "Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, (c) OpenStreetMap contributors, and the GIS User Community",
    osmTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    osmAttribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    defaultCenter: [0, 0],
    defaultZoom: 2,
    trackingZoom: 16,
    maxZoom: 19,
    // Memory & jitter safeguards for long sessions
    maxPathPoints: 500,
    minPathStepMeters: 2,
    // Simulated demo settings (kept strictly separate from real GPS)
    simIntervalMs: 1500,
    simOrigin: [51.5055, -0.0754], // Synthetic demo loop (London Tower Bridge area)
    // Sensible trade-off between accuracy and phone battery/timeout reliability:
    // - enableHighAccuracy: requests GPS when available (may use more battery)
    // - timeout: 15s before reporting a timeout error
    // - maximumAge: allows reusing a very recent (<= 5s) fix to reduce redundant requests
    geolocationOptions: {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000
    }
  };

  // Tracks active alert messages by category so resolving one (e.g. coming back
  // online) does not accidentally hide another (e.g. an insecure HTTP warning).
  const activeAlerts = new Map();

  const state = {
    map: null,
    tileLayer: null,
    tileErrorCount: 0,
    watchId: null,
    simIntervalId: null,
    simStep: 0,
    lastMode: null, // "real" | "simulated" | null
    marker: null,
    accuracyCircle: null,
    pathLine: null,
    pathPoints: [],
    lastLatLng: null,
    hasCenteredThisSession: false
  };

  // ---------------------------------------------------------------------------
  // DOM References
  // ---------------------------------------------------------------------------
  const dom = {
    alertBanner: document.getElementById("alert-banner"),
    alertMessage: document.getElementById("alert-message"),
    simBanner: document.getElementById("sim-banner"),
    headerStatusPill: document.getElementById("header-status-pill"),
    headerStatusText: document.getElementById("header-status-text"),
    mapFallback: document.getElementById("map-fallback"),
    startBtn: document.getElementById("start-btn"),
    stopBtn: document.getElementById("stop-btn"),
    centerBtn: document.getElementById("center-btn"),
    clearPathBtn: document.getElementById("clear-path-btn"),
    simToggleBtn: document.getElementById("sim-toggle-btn"),
    statusValue: document.getElementById("status-value"),
    latValue: document.getElementById("lat-value"),
    lngValue: document.getElementById("lng-value"),
    accuracyValue: document.getElementById("accuracy-value"),
    timeValue: document.getElementById("time-value"),
    pointsValue: document.getElementById("points-value")
  };

  // ---------------------------------------------------------------------------
  // Alert & Status Helpers
  // ---------------------------------------------------------------------------
  function renderAlerts() {
    if (activeAlerts.size === 0) {
      dom.alertBanner.hidden = true;
      dom.alertMessage.textContent = "";
      return;
    }

    dom.alertMessage.textContent = Array.from(activeAlerts.values()).join(" | ");
    dom.alertBanner.hidden = false;
  }

  function setAlert(key, message) {
    activeAlerts.set(key, message);
    renderAlerts();
  }

  function clearAlert(key) {
    if (activeAlerts.delete(key)) {
      renderAlerts();
    }
  }

  function setHeaderStatus(pillState, label) {
    dom.headerStatusPill.dataset.state = pillState;
    dom.headerStatusText.textContent = label;
  }

  function updateControlButtons() {
    const isRealTracking = state.watchId !== null;
    const isSimulating = state.simIntervalId !== null;

    dom.startBtn.disabled = isRealTracking;
    dom.stopBtn.disabled = !isRealTracking;
    dom.centerBtn.disabled = state.lastLatLng === null;
    dom.clearPathBtn.disabled = state.pathPoints.length === 0;
    dom.simToggleBtn.textContent = isSimulating
      ? "Stop simulated demo"
      : "Start simulated demo";
  }

  function updatePointsReadout() {
    dom.pointsValue.textContent =
      state.pathPoints.length + " / " + CONFIG.maxPathPoints + " (memory only)";
  }

  // ---------------------------------------------------------------------------
  // Environment Checks (Secure Context & Network)
  // ---------------------------------------------------------------------------
  function checkSecureContext() {
    if (window.location.protocol === "file:") {
      setAlert(
        "insecure",
        "Opened via file://. OpenStreetMap blocks map tiles (403 Access blocked) without an HTTP Referer, and browsers may block Geolocation. Serve this folder via http://localhost or HTTPS."
      );
      return false;
    }

    if (!window.isSecureContext) {
      setAlert(
        "insecure",
        "Insecure page detected (" +
          window.location.protocol +
          "). Browsers block Geolocation unless the page is served over HTTPS or localhost."
      );
      return false;
    }
    clearAlert("insecure");
    return true;
  }

  function updateNetworkStatus() {
    if (!navigator.onLine) {
      setAlert(
        "offline",
        "You appear to be offline. Map tiles require an internet connection to load, though device GPS may still work outdoors."
      );
    } else {
      clearAlert("offline");
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 2: Leaflet Map & Tile Layers
  // ---------------------------------------------------------------------------
  function attachTileListeners(layer) {
    layer.on("tileerror", () => {
      state.tileErrorCount += 1;
      setAlert(
        "tiles",
        "Some map tiles failed to load. Check your internet connection or wait a moment if the tile server is busy."
      );
    });

    layer.on("load", () => {
      if (state.tileErrorCount > 0) {
        state.tileErrorCount = 0;
        clearAlert("tiles");
      }
    });
  }

  function initMap() {
    if (typeof window.L === "undefined") {
      setAlert(
        "leaflet",
        "Map library (Leaflet) could not be loaded. Check your internet connection and reload the page."
      );
      setHeaderStatus("error", "Map failed");
      dom.statusValue.textContent = "Map library failed to load";
      return false;
    }

    if (dom.mapFallback) {
      dom.mapFallback.remove();
    }

    state.map = L.map("map", {
      zoomControl: true
    }).setView(CONFIG.defaultCenter, CONFIG.defaultZoom);

    const esriLayer = L.tileLayer(CONFIG.esriTileUrl, {
      maxZoom: CONFIG.maxZoom,
      attribution: CONFIG.esriAttribution
    });

    const osmLayer = L.tileLayer(CONFIG.osmTileUrl, {
      maxZoom: CONFIG.maxZoom,
      attribution: CONFIG.osmAttribution
    });

    attachTileListeners(esriLayer);
    attachTileListeners(osmLayer);

    state.tileLayer = esriLayer;
    esriLayer.addTo(state.map);

    L.control
      .layers(
        {
          "English Street Map (Esri)": esriLayer,
          "OpenStreetMap (Local Labels)": osmLayer
        },
        null,
        { position: "topright" }
      )
      .addTo(state.map);

    return true;
  }

  // ---------------------------------------------------------------------------
  // Stage 3 & 4: Map Marker, Accuracy Circle, Session Path & Readout Updates
  // ---------------------------------------------------------------------------
  function formatAccuracy(accuracyMeters) {
    if (typeof accuracyMeters !== "number" || !Number.isFinite(accuracyMeters)) {
      return "Not provided by browser";
    }
    const rounded = accuracyMeters < 10 ? accuracyMeters.toFixed(1) : Math.round(accuracyMeters);
    return "±" + rounded + " m (estimate)";
  }

  function appendPathPoint(latLng, isSimulated) {
    if (!state.map) {
      return;
    }

    // Skip tiny GPS jitter updates (< 2m) so standing still does not bloat the path
    if (state.pathPoints.length > 0) {
      const previous = state.pathPoints[state.pathPoints.length - 1];
      if (state.map.distance(previous, latLng) < CONFIG.minPathStepMeters) {
        return;
      }
    }

    // Enforce memory cap using a sliding window
    if (state.pathPoints.length >= CONFIG.maxPathPoints) {
      state.pathPoints.shift();
    }
    state.pathPoints.push(latLng);

    const pathColor = isSimulated ? "#6d28d9" : "#1d4ed8";

    if (!state.pathLine) {
      state.pathLine = L.polyline(state.pathPoints, {
        color: pathColor,
        weight: 4,
        opacity: 0.85
      }).addTo(state.map);
    } else {
      state.pathLine.setStyle({ color: pathColor });
      state.pathLine.setLatLngs(state.pathPoints);
    }

    updatePointsReadout();
  }

  function updateLocationDisplay(latitude, longitude, accuracy, timestamp, isSimulated) {
    const latLng = [latitude, longitude];
    state.lastLatLng = latLng;

    dom.latValue.textContent = latitude.toFixed(6);
    dom.lngValue.textContent = longitude.toFixed(6);
    dom.accuracyValue.textContent = formatAccuracy(accuracy);
    dom.timeValue.textContent = new Date(timestamp).toLocaleTimeString();

    if (!state.map) {
      updateControlButtons();
      return;
    }

    const title = isSimulated ? "Simulated Position (Demo)" : "Current Position";
    const popupText =
      "<strong>" + title + "</strong><br>" +
      "Lat: " + latitude.toFixed(6) + "<br>" +
      "Lng: " + longitude.toFixed(6) + "<br>" +
      "Est. accuracy: " + formatAccuracy(accuracy);

    if (!state.marker) {
      state.marker = L.marker(latLng).addTo(state.map);
    } else {
      state.marker.setLatLng(latLng);
    }
    state.marker.bindPopup(popupText);

    const circleColor = isSimulated ? "#6d28d9" : "#1d4ed8";
    const circleFill = isSimulated ? "#8b5cf6" : "#3b82f6";

    if (typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 0) {
      if (!state.accuracyCircle) {
        state.accuracyCircle = L.circle(latLng, {
          radius: accuracy,
          color: circleColor,
          fillColor: circleFill,
          fillOpacity: 0.15,
          weight: 1.5
        }).addTo(state.map);
      } else {
        state.accuracyCircle.setStyle({ color: circleColor, fillColor: circleFill });
        state.accuracyCircle.setLatLng(latLng);
        state.accuracyCircle.setRadius(accuracy);
      }
    } else if (state.accuracyCircle) {
      state.accuracyCircle.remove();
      state.accuracyCircle = null;
    }

    appendPathPoint(latLng, isSimulated);

    // Centre automatically only on the first fix of a session to avoid jarring map jumps
    if (!state.hasCenteredThisSession) {
      state.map.setView(latLng, Math.max(state.map.getZoom(), CONFIG.trackingZoom));
      state.hasCenteredThisSession = true;
    }

    updateControlButtons();
  }

  function clearPath() {
    state.pathPoints = [];
    if (state.pathLine) {
      state.pathLine.remove();
      state.pathLine = null;
    }
    updatePointsReadout();
    updateControlButtons();
  }

  function clearMapSessionVisuals() {
    clearPath();
    if (state.marker) {
      state.marker.remove();
      state.marker = null;
    }
    if (state.accuracyCircle) {
      state.accuracyCircle.remove();
      state.accuracyCircle = null;
    }
    state.lastLatLng = null;
  }

  // ---------------------------------------------------------------------------
  // Stage 3: Real Browser Geolocation (watchPosition / clearWatch)
  // ---------------------------------------------------------------------------
  function handlePositionSuccess(position) {
    clearAlert("geo");

    const { latitude, longitude, accuracy } = position.coords;
    const isWeakSignal = typeof accuracy === "number" && accuracy > 150;

    setHeaderStatus("tracking", "Tracking");
    dom.statusValue.textContent = isWeakSignal
      ? "Tracking active (weak/coarse signal)"
      : "Tracking active";

    updateLocationDisplay(latitude, longitude, accuracy, position.timestamp, false);
  }

  function handlePositionError(error) {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        if (state.watchId !== null) {
          navigator.geolocation.clearWatch(state.watchId);
          state.watchId = null;
        }
        setHeaderStatus("error", "Permission denied");
        dom.statusValue.textContent = "Permission denied";
        setAlert(
          "geo",
          "Location permission was denied. To track your position, allow Location access in your browser's site settings and press Start tracking again."
        );
        updateControlButtons();
        break;

      case error.POSITION_UNAVAILABLE:
        setHeaderStatus("error", "Unavailable");
        dom.statusValue.textContent = "Location unavailable — waiting for signal";
        setAlert(
          "geo",
          "Location is currently unavailable. Check that your device's Location/GPS service is turned on, or move near a window/outdoors."
        );
        break;

      case error.TIMEOUT:
        setHeaderStatus("error", "Timed out");
        dom.statusValue.textContent = "Timed out — still waiting for a fix";
        setAlert(
          "geo",
          "Location request timed out (15s). Weak GPS or indoor interference can delay fixes; still listening for an update."
        );
        break;

      default:
        setHeaderStatus("error", "Error");
        dom.statusValue.textContent = "Location error";
        setAlert("geo", "Unable to retrieve location (" + (error.message || "unknown error") + ").");
        break;
    }
  }

  function startRealTracking() {
    // Guard against duplicate tracking sessions if Start is clicked repeatedly
    if (state.watchId !== null) {
      return;
    }

    // Keep simulated mode completely separate from real tracking
    if (state.simIntervalId !== null) {
      stopSimulation(false);
    }
    if (state.lastMode === "simulated") {
      clearMapSessionVisuals();
    }

    if (!("geolocation" in navigator)) {
      setHeaderStatus("error", "Unsupported");
      dom.statusValue.textContent = "Geolocation not supported by this browser";
      setAlert(
        "geo",
        "Your browser does not support the Geolocation API. Try a modern browser such as Chrome, Firefox, Edge, or Safari."
      );
      return;
    }

    if (!checkSecureContext()) {
      setHeaderStatus("error", "Insecure page");
      dom.statusValue.textContent = "Blocked on insecure page";
      return;
    }

    clearAlert("geo");
    state.lastMode = "real";
    state.hasCenteredThisSession = false;

    setHeaderStatus("tracking", "Requesting…");
    dom.statusValue.textContent = "Requesting permission / waiting for fix…";

    state.watchId = navigator.geolocation.watchPosition(
      handlePositionSuccess,
      handlePositionError,
      CONFIG.geolocationOptions
    );

    updateControlButtons();
  }

  function stopRealTracking() {
    if (state.watchId === null) {
      return;
    }

    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;

    clearAlert("geo");
    setHeaderStatus("stopped", "Stopped");
    dom.statusValue.textContent = "Stopped";
    updateControlButtons();
  }

  // ---------------------------------------------------------------------------
  // Stage 4: Optional Simulated Testing Mode (Strictly Separate)
  // ---------------------------------------------------------------------------
  function emitSimulatedStep() {
    // Generates a gentle ~120m walking loop around CONFIG.simOrigin
    const angle = state.simStep * 0.25;
    const latOffset = Math.sin(angle) * 0.0008;
    const lngOffset = Math.cos(angle) * 0.0012;
    const syntheticAccuracy = 12 + (state.simStep % 5);

    const lat = CONFIG.simOrigin[0] + latOffset;
    const lng = CONFIG.simOrigin[1] + lngOffset;

    state.simStep += 1;
    updateLocationDisplay(lat, lng, syntheticAccuracy, Date.now(), true);
  }

  function startSimulation() {
    if (state.simIntervalId !== null) {
      return;
    }

    // Stop any real tracking first and clear real session visuals so they never mix
    if (state.watchId !== null) {
      stopRealTracking();
    }
    if (state.lastMode === "real") {
      clearMapSessionVisuals();
    }

    clearAlert("geo");
    state.lastMode = "simulated";
    state.simStep = 0;
    state.hasCenteredThisSession = false;

    dom.simBanner.hidden = false;
    setHeaderStatus("simulated", "Simulated");
    dom.statusValue.textContent = "Simulated demo active (synthetic data)";

    emitSimulatedStep();
    state.simIntervalId = window.setInterval(emitSimulatedStep, CONFIG.simIntervalMs);
    updateControlButtons();
  }

  function stopSimulation(updateStatus = true) {
    if (state.simIntervalId === null) {
      return;
    }

    window.clearInterval(state.simIntervalId);
    state.simIntervalId = null;
    dom.simBanner.hidden = true;

    if (updateStatus) {
      setHeaderStatus("stopped", "Stopped");
      dom.statusValue.textContent = "Stopped (simulated demo)";
    }
    updateControlButtons();
  }

  function toggleSimulation() {
    if (state.simIntervalId !== null) {
      stopSimulation(true);
    } else {
      startSimulation();
    }
  }

  function centerOnLocation() {
    if (!state.map || !state.lastLatLng) {
      return;
    }
    state.map.setView(state.lastLatLng, Math.max(state.map.getZoom(), CONFIG.trackingZoom));
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  function bindEvents() {
    dom.startBtn.addEventListener("click", startRealTracking);
    dom.stopBtn.addEventListener("click", stopRealTracking);
    dom.centerBtn.addEventListener("click", centerOnLocation);
    dom.clearPathBtn.addEventListener("click", clearPath);
    dom.simToggleBtn.addEventListener("click", toggleSimulation);
  }

  function init() {
    checkSecureContext();
    updateNetworkStatus();
    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);

    initMap();
    bindEvents();
    updatePointsReadout();
    updateControlButtons();
  }

  // ---------------------------------------------------------------------------
  // Remote Shared Device Map Bridge (used by share.js)
  // ---------------------------------------------------------------------------
  let remoteMarker = null;
  let remoteCircle = null;
  let remoteLastLatLng = null;

  function updateRemoteLocation(lat, lng, accuracy, statusLabel, updatedAtMs) {
    if (!state.map || typeof window.L === "undefined") {
      return;
    }

    const latLng = [lat, lng];
    const isFirstRemoteFix = remoteLastLatLng === null;
    remoteLastLatLng = latLng;

    const popupHtml =
      "<strong>Shared Device</strong><br>" +
      "Status: " + statusLabel + "<br>" +
      "Lat: " + lat.toFixed(6) + "<br>" +
      "Lng: " + lng.toFixed(6) + "<br>" +
      "Est. accuracy: " + formatAccuracy(accuracy) + "<br>" +
      "Updated: " + (updatedAtMs ? new Date(updatedAtMs).toLocaleTimeString() : "—");

    if (!remoteMarker) {
      remoteMarker = L.circleMarker(latLng, {
        radius: 9,
        color: "#0f766e",
        fillColor: "#14b8a6",
        fillOpacity: 0.9,
        weight: 2.5
      }).addTo(state.map);
    } else {
      remoteMarker.setLatLng(latLng);
    }
    remoteMarker.bindPopup(popupHtml);

    if (typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 0) {
      if (!remoteCircle) {
        remoteCircle = L.circle(latLng, {
          radius: accuracy,
          color: "#0f766e",
          fillColor: "#14b8a6",
          fillOpacity: 0.14,
          weight: 1.5,
          dashArray: "6 4"
        }).addTo(state.map);
      } else {
        remoteCircle.setLatLng(latLng);
        remoteCircle.setRadius(accuracy);
      }
    } else if (remoteCircle) {
      remoteCircle.remove();
      remoteCircle = null;
    }

    if (isFirstRemoteFix) {
      state.map.setView(latLng, Math.max(state.map.getZoom(), CONFIG.trackingZoom));
    }
  }

  function centerOnRemote() {
    if (!state.map || !remoteLastLatLng) {
      return;
    }
    state.map.setView(remoteLastLatLng, Math.max(state.map.getZoom(), CONFIG.trackingZoom));
  }

  function clearRemoteMarker() {
    if (remoteMarker) {
      remoteMarker.remove();
      remoteMarker = null;
    }
    if (remoteCircle) {
      remoteCircle.remove();
      remoteCircle = null;
    }
    remoteLastLatLng = null;
  }

  window.GISMapBridge = {
    setAlert,
    clearAlert,
    formatAccuracy,
    updateRemoteLocation,
    centerOnRemote,
    clearRemoteMarker,
    geolocationOptions: CONFIG.geolocationOptions
  };

  init();
})();
