(() => {
  "use strict";

  const STALE_THRESHOLD_MS = 30000;
  const IP_LOOKUP_URL = "https://ipwho.is/";

  const shareState = {
    auth: null,
    db: null,
    uid: null,
    activeShareId: null,
    unsubscribeOwner: null,
    unsubscribeSharer: null,
    staleTimerId: null,
    sharerExpiryTimerId: null,
    lastRemoteUpdatedMs: null,
    lastRemoteStatus: null,
    expiresAtMs: null,
    sharerWatchId: null,
    sharerAccepted: false
  };

  const dom = {
    mainContent: document.getElementById("main-content"),
    sharerConsentView: document.getElementById("sharer-consent-view"),
    consentSummary: document.getElementById("consent-summary"),
    consentRequester: document.getElementById("consent-requester"),
    consentExpires: document.getElementById("consent-expires"),
    sharerStatusText: document.getElementById("sharer-status-text"),
    consentDecisionActions: document.getElementById("consent-decision-actions"),
    consentActiveActions: document.getElementById("consent-active-actions"),
    acceptShareBtn: document.getElementById("accept-share-btn"),
    declineShareBtn: document.getElementById("decline-share-btn"),
    stopSharingBtn: document.getElementById("stop-sharing-btn"),

    requesterNameInput: document.getElementById("requester-name-input"),
    shareDurationSelect: document.getElementById("share-duration-select"),
    createShareBtn: document.getElementById("create-share-btn"),
    shareSessionPanel: document.getElementById("share-session-panel"),
    shareLinkOutput: document.getElementById("share-link-output"),
    copyShareBtn: document.getElementById("copy-share-btn"),
    remoteStatusValue: document.getElementById("remote-status-value"),
    remoteCoordsValue: document.getElementById("remote-coords-value"),
    remoteAccuracyValue: document.getElementById("remote-accuracy-value"),
    remoteTimeValue: document.getElementById("remote-time-value"),
    remoteExpiresValue: document.getElementById("remote-expires-value"),
    centerRemoteBtn: document.getElementById("center-remote-btn"),
    revokeShareBtn: document.getElementById("revoke-share-btn"),

    ipConsentCheckbox: document.getElementById("ip-consent-checkbox"),
    ipLookupBtn: document.getElementById("ip-lookup-btn"),
    ipReadout: document.getElementById("ip-readout"),
    ipLocationValue: document.getElementById("ip-location-value"),
    ipIspValue: document.getElementById("ip-isp-value")
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function bridge() {
    return window.GISMapBridge || null;
  }

  function showGeoAlert(msg) {
    if (bridge()) {
      bridge().setAlert("share", msg);
    }
  }

  function clearGeoAlert() {
    if (bridge()) {
      bridge().clearAlert("share");
    }
  }

  function generateShareId() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function isFirebaseConfigured() {
    const cfg = window.FIREBASE_CONFIG;
    return (
      typeof window.firebase !== "undefined" &&
      cfg &&
      typeof cfg.apiKey === "string" &&
      cfg.apiKey.length > 0 &&
      !cfg.apiKey.startsWith("YOUR_") &&
      typeof cfg.projectId === "string" &&
      !cfg.projectId.startsWith("YOUR_")
    );
  }

  async function ensureFirebaseAuth() {
    if (shareState.uid) {
      return shareState.uid;
    }
    if (!isFirebaseConfigured()) {
      throw new Error(
        "Firebase is not configured yet. Add your Firebase Web config in firebase-config.js (see README.md)."
      );
    }

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(window.FIREBASE_CONFIG);
    }
    shareState.auth = window.firebase.auth();
    shareState.db = window.firebase.firestore();

    if (!shareState.auth.currentUser) {
      const cred = await shareState.auth.signInAnonymously();
      shareState.uid = cred.user.uid;
    } else {
      shareState.uid = shareState.auth.currentUser.uid;
    }
    return shareState.uid;
  }

  function formatAge(ms) {
    const secs = Math.max(0, Math.round(ms / 1000));
    if (secs < 60) {
      return secs + "s ago";
    }
    const mins = Math.floor(secs / 60);
    return mins + "m " + (secs % 60) + "s ago";
  }

  // ---------------------------------------------------------------------------
  // Requester (Owner) Flow
  // ---------------------------------------------------------------------------
  function refreshRemoteStaleStatus() {
    if (!shareState.activeShareId) {
      return;
    }
    const now = Date.now();

    if (shareState.expiresAtMs && now >= shareState.expiresAtMs) {
      dom.remoteStatusValue.textContent = "Expired — link is no longer valid";
      return;
    }

    if (shareState.lastRemoteStatus === "active") {
      if (!shareState.lastRemoteUpdatedMs) {
        dom.remoteStatusValue.textContent = "Active — waiting for first coordinates…";
        return;
      }
      const age = now - shareState.lastRemoteUpdatedMs;
      if (age > STALE_THRESHOLD_MS) {
        dom.remoteStatusValue.textContent =
          "Active — STALE (last update " + formatAge(age) + ")";
      } else {
        dom.remoteStatusValue.textContent = "Active — receiving live updates";
      }
    }
  }

  async function createShareLink() {
    clearGeoAlert();
    const label = (dom.requesterNameInput.value || "").trim() || "GIS Assignment User";
    const minutes = Math.min(60, Math.max(15, Number(dom.shareDurationSelect.value) || 30));

    try {
      dom.createShareBtn.disabled = true;
      const uid = await ensureFirebaseAuth();

      // Do not abandon an existing active share in Firestore: delete it first.
      if (shareState.activeShareId) {
        const deleted = await revokeAndDeleteShare();
        if (!deleted) {
          showGeoAlert(
            "Could not delete your previous share link. Retry deleting it before creating a new one."
          );
          return;
        }
      }

      if (bridge()) {
        bridge().clearRemoteMarker();
      }

      const shareId = generateShareId();
      const expiresMs = Date.now() + minutes * 60 * 1000;
      const expiresAt = window.firebase.firestore.Timestamp.fromMillis(expiresMs);

      await shareState.db.collection("shares").doc(shareId).set({
        ownerUid: uid,
        sharerUid: null,
        requesterLabel: label.slice(0, 80),
        status: "pending",
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        expiresAt,
        location: null
      });

      shareState.activeShareId = shareId;
      shareState.expiresAtMs = expiresMs;
      shareState.lastRemoteUpdatedMs = null;
      shareState.lastRemoteStatus = "pending";

      const shareUrl =
        window.location.origin + window.location.pathname + "?share=" + encodeURIComponent(shareId);
      dom.shareLinkOutput.value = shareUrl;
      dom.remoteExpiresValue.textContent = new Date(expiresMs).toLocaleTimeString();
      dom.remoteStatusValue.textContent = "Waiting for recipient to open and accept";
      dom.remoteCoordsValue.textContent = "—";
      dom.remoteAccuracyValue.textContent = "—";
      dom.remoteTimeValue.textContent = "—";
      dom.centerRemoteBtn.disabled = true;
      dom.shareSessionPanel.hidden = false;

      subscribeOwnerToShare(shareId);
    } catch (err) {
      showGeoAlert(err.message || "Could not create share link.");
    } finally {
      dom.createShareBtn.disabled = false;
    }
  }

  function subscribeOwnerToShare(shareId) {
    if (shareState.staleTimerId) {
      window.clearInterval(shareState.staleTimerId);
    }
    shareState.staleTimerId = window.setInterval(refreshRemoteStaleStatus, 5000);

    shareState.unsubscribeOwner = shareState.db
      .collection("shares")
      .doc(shareId)
      .onSnapshot(
        (doc) => {
          if (!doc.exists) {
            dom.remoteStatusValue.textContent = "Revoked / deleted";
            return;
          }

          const data = doc.data();
          const expiresMs = data.expiresAt ? data.expiresAt.toMillis() : shareState.expiresAtMs;
          shareState.expiresAtMs = expiresMs;
          shareState.lastRemoteStatus = data.status;

          const isExpired = expiresMs && Date.now() >= expiresMs;

          if (data.status === "declined") {
            dom.remoteStatusValue.textContent = "Declined by recipient";
          } else if (data.status === "revoked") {
            dom.remoteStatusValue.textContent = "Revoked by you";
          } else if (data.status === "stopped") {
            dom.remoteStatusValue.textContent = "Sharing stopped by device owner";
          } else if (isExpired) {
            dom.remoteStatusValue.textContent = "Expired — link is no longer valid";
          } else if (data.status === "pending") {
            dom.remoteStatusValue.textContent = "Waiting for recipient to accept";
          }

          if (data.location && typeof data.location.lat === "number") {
            const { lat, lng, accuracy, updatedAtMs } = data.location;
            shareState.lastRemoteUpdatedMs = updatedAtMs || Date.now();

            dom.remoteCoordsValue.textContent = lat.toFixed(6) + ", " + lng.toFixed(6);
            dom.remoteAccuracyValue.textContent = bridge()
              ? bridge().formatAccuracy(accuracy)
              : "±" + Math.round(accuracy) + " m";
            dom.remoteTimeValue.textContent = new Date(
              shareState.lastRemoteUpdatedMs
            ).toLocaleTimeString();
            dom.centerRemoteBtn.disabled = false;

            if (bridge()) {
              bridge().updateRemoteLocation(
                lat,
                lng,
                accuracy,
                data.status === "stopped" ? "Stopped" : isExpired ? "Expired" : "Active",
                shareState.lastRemoteUpdatedMs
              );
            }
          }

          refreshRemoteStaleStatus();
        },
        (err) => {
          if (shareState.unsubscribeOwner) {
            shareState.unsubscribeOwner();
            shareState.unsubscribeOwner = null;
          }
          if (shareState.staleTimerId) {
            window.clearInterval(shareState.staleTimerId);
            shareState.staleTimerId = null;
          }
          if (err && err.code === "permission-denied") {
            dom.remoteStatusValue.textContent = "Expired — access denied after expiry";
            showGeoAlert(
              "Share link expired and location access is now blocked by security rules. You can delete the expired session."
            );
          } else {
            showGeoAlert("Unable to listen for shared updates: " + err.message);
          }
        }
      );
  }

  async function copyShareLink() {
    if (!dom.shareLinkOutput.value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(dom.shareLinkOutput.value);
      dom.copyShareBtn.textContent = "Copied";
      window.setTimeout(() => {
        dom.copyShareBtn.textContent = "Copy";
      }, 1500);
    } catch {
      dom.shareLinkOutput.select();
    }
  }

  async function revokeAndDeleteShare() {
    if (!shareState.activeShareId || !shareState.db) {
      return true;
    }

    const idToDelete = shareState.activeShareId;
    dom.revokeShareBtn.disabled = true;
    dom.revokeShareBtn.textContent = "Deleting…";

    try {
      await shareState.db.collection("shares").doc(idToDelete).delete();
    } catch (err) {
      // Keep the session visible and activeShareId intact so the user can retry
      dom.revokeShareBtn.disabled = false;
      dom.revokeShareBtn.textContent = "Retry delete";
      showGeoAlert("Could not delete remote share document: " + err.message + " (You can retry.)");
      return false;
    }

    shareState.activeShareId = null;
    if (shareState.unsubscribeOwner) {
      shareState.unsubscribeOwner();
      shareState.unsubscribeOwner = null;
    }
    if (shareState.staleTimerId) {
      window.clearInterval(shareState.staleTimerId);
      shareState.staleTimerId = null;
    }
    if (bridge()) {
      bridge().clearRemoteMarker();
    }

    dom.revokeShareBtn.disabled = false;
    dom.revokeShareBtn.textContent = "Revoke & delete";
    dom.shareSessionPanel.hidden = true;
    dom.shareLinkOutput.value = "";
    return true;
  }

  // ---------------------------------------------------------------------------
  // Sharer (Recipient) Flow (?share=<shareId>)
  // ---------------------------------------------------------------------------
  function stopLocalSharerWatch() {
    if (shareState.sharerWatchId !== null) {
      navigator.geolocation.clearWatch(shareState.sharerWatchId);
      shareState.sharerWatchId = null;
    }
    if (shareState.sharerExpiryTimerId !== null) {
      window.clearTimeout(shareState.sharerExpiryTimerId);
      shareState.sharerExpiryTimerId = null;
    }
  }

  async function initSharerConsentView(shareId) {
    // Focus the recipient strictly on the consent screen
    dom.mainContent.hidden = true;
    dom.sharerConsentView.hidden = false;

    try {
      await ensureFirebaseAuth();
    } catch (err) {
      dom.consentSummary.textContent = err.message;
      dom.sharerStatusText.textContent = "Unavailable (Firebase not configured)";
      return;
    }

    const docRef = shareState.db.collection("shares").doc(shareId);

    try {
      const snap = await docRef.get();
      if (!snap.exists) {
        dom.consentSummary.textContent =
          "This share link does not exist, has been revoked, or was deleted.";
        dom.sharerStatusText.textContent = "Invalid or revoked link";
        return;
      }

      const data = snap.data();
      const expiresMs = data.expiresAt ? data.expiresAt.toMillis() : 0;

      dom.consentRequester.textContent = data.requesterLabel || "Unknown requester";
      dom.consentExpires.textContent = expiresMs
        ? new Date(expiresMs).toLocaleString()
        : "Unknown";

      if (expiresMs && Date.now() >= expiresMs) {
        dom.consentSummary.textContent = "This share link has expired. No location can be shared.";
        dom.sharerStatusText.textContent = "Expired";
        return;
      }

      if (data.status !== "pending") {
        dom.consentSummary.textContent =
          "This invite is no longer pending (current status: " + data.status + ").";
        dom.sharerStatusText.textContent = "Closed (" + data.status + ")";
        return;
      }

      dom.consentSummary.textContent =
        (data.requesterLabel || "Someone") +
        " is asking to see your live device location until " +
        new Date(expiresMs).toLocaleTimeString() +
        ".";
      dom.acceptShareBtn.disabled = false;
      dom.declineShareBtn.disabled = false;

      // Enforce automatic UI & GPS stop the moment expiresAt is reached
      if (expiresMs && expiresMs > Date.now()) {
        shareState.sharerExpiryTimerId = window.setTimeout(() => {
          stopLocalSharerWatch();
          dom.acceptShareBtn.disabled = true;
          dom.declineShareBtn.disabled = true;
          dom.consentDecisionActions.hidden = true;
          dom.consentActiveActions.hidden = true;
          dom.sharerStatusText.textContent = "Link expired — sharing stopped automatically";
        }, expiresMs - Date.now());
      }

      // Listen in case the requester revokes, deletes, or the session expires
      shareState.unsubscribeSharer = docRef.onSnapshot(
        (updatedSnap) => {
          if (!updatedSnap.exists) {
            stopLocalSharerWatch();
            dom.consentDecisionActions.hidden = true;
            dom.consentActiveActions.hidden = true;
            dom.sharerStatusText.textContent = "Link was revoked/deleted by requester";
            return;
          }
          const updated = updatedSnap.data();
          if (updated.status === "revoked") {
            stopLocalSharerWatch();
            dom.consentDecisionActions.hidden = true;
            dom.consentActiveActions.hidden = true;
            dom.sharerStatusText.textContent = "Revoked by requester";
          }
        },
        (err) => {
          stopLocalSharerWatch();
          if (shareState.unsubscribeSharer) {
            shareState.unsubscribeSharer();
            shareState.unsubscribeSharer = null;
          }
          dom.acceptShareBtn.disabled = true;
          dom.declineShareBtn.disabled = true;
          dom.consentDecisionActions.hidden = true;
          dom.consentActiveActions.hidden = true;
          dom.sharerStatusText.textContent =
            err && err.code === "permission-denied"
              ? "Link expired or access ended — sharing stopped"
              : "Connection/access error — sharing stopped (" + err.message + ")";
        }
      );

      dom.declineShareBtn.addEventListener("click", async () => {
        dom.acceptShareBtn.disabled = true;
        dom.declineShareBtn.disabled = true;
        try {
          await docRef.update({
            sharerUid: shareState.uid,
            status: "declined"
          });
          dom.sharerStatusText.textContent = "Declined — your location was NOT shared";
          dom.consentDecisionActions.hidden = true;
        } catch (err) {
          dom.sharerStatusText.textContent = "Could not record decline: " + err.message;
        }
      });

      dom.acceptShareBtn.addEventListener("click", () => {
        if (!("geolocation" in navigator)) {
          dom.sharerStatusText.textContent = "Geolocation is not supported by this browser.";
          return;
        }
        if (!window.isSecureContext) {
          dom.sharerStatusText.textContent =
            "Blocked: this page must be opened over HTTPS to share location.";
          return;
        }

        dom.acceptShareBtn.disabled = true;
        dom.declineShareBtn.disabled = true;
        dom.sharerStatusText.textContent = "Requesting browser location permission…";

        const geoOpts = bridge()
          ? bridge().geolocationOptions
          : { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 };

        shareState.sharerWatchId = navigator.geolocation.watchPosition(
          async (pos) => {
            if (shareState.sharerWatchId === null) {
              return;
            }
            if (expiresMs && Date.now() >= expiresMs) {
              stopLocalSharerWatch();
              dom.consentActiveActions.hidden = true;
              dom.sharerStatusText.textContent = "Link expired — sharing stopped automatically";
              return;
            }

            const payload = {
              status: "active",
              location: {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy ?? null,
                updatedAtMs: Date.now()
              }
            };
            // Bind sharerUid only on the initial pending -> active transition
            if (!shareState.sharerAccepted) {
              payload.sharerUid = shareState.uid;
            }

            try {
              await docRef.update(payload);
              shareState.sharerAccepted = true;
              dom.consentDecisionActions.hidden = true;
              dom.consentActiveActions.hidden = false;
              dom.sharerStatusText.textContent =
                "Sharing active (last sent " + new Date().toLocaleTimeString() + ")";
            } catch (err) {
              stopLocalSharerWatch();
              dom.consentActiveActions.hidden = true;
              dom.sharerStatusText.textContent = "Sharing blocked/expired: " + err.message;
            }
          },
          (err) => {
            if (err.code === err.PERMISSION_DENIED) {
              stopLocalSharerWatch();
              dom.sharerStatusText.textContent =
                "Location permission denied — nothing was shared.";
              dom.acceptShareBtn.disabled = false;
              dom.declineShareBtn.disabled = false;
            } else if (err.code === err.TIMEOUT) {
              dom.sharerStatusText.textContent =
                "Waiting for GPS signal (request timed out)…";
            } else {
              dom.sharerStatusText.textContent =
                "Location unavailable — waiting for signal…";
            }
          },
          geoOpts
        );
      });

      dom.stopSharingBtn.addEventListener("click", async () => {
        stopLocalSharerWatch();
        dom.stopSharingBtn.disabled = true;
        try {
          if (shareState.sharerAccepted) {
            await docRef.update({ status: "stopped" });
          }
          dom.consentActiveActions.hidden = true;
          dom.sharerStatusText.textContent = "Stopped — no further updates will be sent";
        } catch (err) {
          dom.sharerStatusText.textContent = "Stopped locally (" + err.message + ")";
        }
      });
    } catch (err) {
      dom.consentSummary.textContent = "Could not load share request: " + err.message;
      dom.sharerStatusText.textContent = "Error loading request";
    }
  }

  // ---------------------------------------------------------------------------
  // Optional Separate IP Network Location Lookup (With Explicit Agreement)
  // ---------------------------------------------------------------------------
  async function runIpLookup() {
    if (!dom.ipConsentCheckbox.checked) {
      return;
    }

    dom.ipLookupBtn.disabled = true;
    dom.ipLookupBtn.textContent = "Checking network estimate…";

    try {
      const response = await fetch(IP_LOOKUP_URL);
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || "Lookup failed");
      }

      const place = [data.city, data.region, data.country].filter(Boolean).join(", ");
      const isp = (data.connection && data.connection.isp) || data.org || "Unknown ISP";

      dom.ipLocationValue.textContent =
        (place || "Unknown") + " (approximate network location only)";
      dom.ipIspValue.textContent = isp + " (IP: " + (data.ip || "—") + ")";
      dom.ipReadout.hidden = false;
    } catch (err) {
      showGeoAlert("Approximate IP lookup failed: " + err.message);
    } finally {
      dom.ipLookupBtn.textContent = "Check approximate IP location";
      dom.ipLookupBtn.disabled = !dom.ipConsentCheckbox.checked;
    }
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  function init() {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("share");

    if (shareId) {
      initSharerConsentView(shareId);
      return;
    }

    dom.createShareBtn.addEventListener("click", createShareLink);
    dom.copyShareBtn.addEventListener("click", copyShareLink);
    dom.centerRemoteBtn.addEventListener("click", () => {
      if (bridge()) {
        bridge().centerOnRemote();
      }
    });
    dom.revokeShareBtn.addEventListener("click", revokeAndDeleteShare);

    dom.ipConsentCheckbox.addEventListener("change", () => {
      dom.ipLookupBtn.disabled = !dom.ipConsentCheckbox.checked;
    });
    dom.ipLookupBtn.addEventListener("click", runIpLookup);
  }

  init();
})();
