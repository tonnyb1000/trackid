import test from "node:test";
import fs from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  serverTimestamp,
  Timestamp
} from "firebase/firestore";

const PROJECT_ID = "track-id-fd62d-test";
const VALID_SHARE_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const EXPIRED_SHARE_ID = "f0e1d2c3b4a5968778695a4b3c2d1e0f";

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8085
    }
  });
});

test.after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
});

function futureTimestamp(minutes) {
  return Timestamp.fromMillis(Date.now() + minutes * 60 * 1000);
}

test("create: owner can create valid pending share, attacker/invalid fields fail", async () => {
  const ownerDb = testEnv.authenticatedContext("owner-1").firestore();
  const unauthDb = testEnv.unauthenticatedContext().firestore();

  // Unauthenticated create fails
  await assertFails(
    setDoc(doc(unauthDb, "shares", VALID_SHARE_ID), {
      ownerUid: "owner-1",
      sharerUid: null,
      requesterLabel: "Alex",
      status: "pending",
      createdAt: serverTimestamp(),
      expiresAt: futureTimestamp(30),
      location: null
    })
  );

  // Short guessable shareId fails
  await assertFails(
    setDoc(doc(ownerDb, "shares", "short-id"), {
      ownerUid: "owner-1",
      sharerUid: null,
      requesterLabel: "Alex",
      status: "pending",
      createdAt: serverTimestamp(),
      expiresAt: futureTimestamp(30),
      location: null
    })
  );

  // Extra field injection fails
  await assertFails(
    setDoc(doc(ownerDb, "shares", VALID_SHARE_ID), {
      ownerUid: "owner-1",
      sharerUid: null,
      requesterLabel: "Alex",
      status: "pending",
      createdAt: serverTimestamp(),
      expiresAt: futureTimestamp(30),
      location: null,
      extraAdminFlag: true
    })
  );

  // Expiry > 2h fails
  await assertFails(
    setDoc(doc(ownerDb, "shares", VALID_SHARE_ID), {
      ownerUid: "owner-1",
      sharerUid: null,
      requesterLabel: "Alex",
      status: "pending",
      createdAt: serverTimestamp(),
      expiresAt: futureTimestamp(180),
      location: null
    })
  );

  // Valid create succeeds
  await assertSucceeds(
    setDoc(doc(ownerDb, "shares", VALID_SHARE_ID), {
      ownerUid: "owner-1",
      sharerUid: null,
      requesterLabel: "Alex (GIS Lab)",
      status: "pending",
      createdAt: serverTimestamp(),
      expiresAt: futureTimestamp(30),
      location: null
    })
  );
});

test("list is denied, get & accept/update/stop/revoke/delete enforce access and field locks", async () => {
  const ownerDb = testEnv.authenticatedContext("owner-1").firestore();
  const sharerDb = testEnv.authenticatedContext("sharer-1").firestore();
  const strangerDb = testEnv.authenticatedContext("stranger-1").firestore();

  await assertSucceeds(
    setDoc(doc(ownerDb, "shares", VALID_SHARE_ID), {
      ownerUid: "owner-1",
      sharerUid: null,
      requesterLabel: "Alex (GIS Lab)",
      status: "pending",
      createdAt: serverTimestamp(),
      expiresAt: futureTimestamp(30),
      location: null
    })
  );

  // Collection list is denied even for owner
  await assertFails(getDocs(collection(ownerDb, "shares")));

  // Recipient can read pending invite
  await assertSucceeds(getDoc(doc(sharerDb, "shares", VALID_SHARE_ID)));

  // Out-of-range latitude is rejected on accept
  await assertFails(
    updateDoc(doc(sharerDb, "shares", VALID_SHARE_ID), {
      sharerUid: "sharer-1",
      status: "active",
      location: { lat: 120, lng: 0, accuracy: 10, updatedAtMs: Date.now() }
    })
  );

  // Valid accept succeeds
  await assertSucceeds(
    updateDoc(doc(sharerDb, "shares", VALID_SHARE_ID), {
      sharerUid: "sharer-1",
      status: "active",
      location: { lat: 51.5, lng: -0.07, accuracy: 12, updatedAtMs: Date.now() }
    })
  );

  // Stranger cannot read or update once bound
  await assertFails(getDoc(doc(strangerDb, "shares", VALID_SHARE_ID)));
  await assertFails(
    updateDoc(doc(strangerDb, "shares", VALID_SHARE_ID), {
      status: "active",
      location: { lat: 10, lng: 10, accuracy: 5, updatedAtMs: Date.now() }
    })
  );

  // Bound sharer cannot alter ownerUid or expiresAt
  await assertFails(
    updateDoc(doc(sharerDb, "shares", VALID_SHARE_ID), {
      ownerUid: "sharer-1",
      status: "active",
      location: { lat: 51.51, lng: -0.08, accuracy: 10, updatedAtMs: Date.now() }
    })
  );

  // Bound sharer can stop sharing
  await assertSucceeds(
    updateDoc(doc(sharerDb, "shares", VALID_SHARE_ID), {
      status: "stopped"
    })
  );

  // Further location updates after stop fail
  await assertFails(
    updateDoc(doc(sharerDb, "shares", VALID_SHARE_ID), {
      status: "active",
      location: { lat: 51.52, lng: -0.09, accuracy: 10, updatedAtMs: Date.now() }
    })
  );

  // Sharer cannot delete; only owner can delete
  await assertFails(deleteDoc(doc(sharerDb, "shares", VALID_SHARE_ID)));
  await assertSucceeds(deleteDoc(doc(ownerDb, "shares", VALID_SHARE_ID)));
});

test("decline blocks location payload, and expired sessions reject reads/writes", async () => {
  const ownerDb = testEnv.authenticatedContext("owner-1").firestore();
  const sharerDb = testEnv.authenticatedContext("sharer-1").firestore();

  await assertSucceeds(
    setDoc(doc(ownerDb, "shares", VALID_SHARE_ID), {
      ownerUid: "owner-1",
      sharerUid: null,
      requesterLabel: "Alex",
      status: "pending",
      createdAt: serverTimestamp(),
      expiresAt: futureTimestamp(30),
      location: null
    })
  );

  // Decline with location attached must fail
  await assertFails(
    updateDoc(doc(sharerDb, "shares", VALID_SHARE_ID), {
      sharerUid: "sharer-1",
      status: "declined",
      location: { lat: 51.5, lng: -0.07, accuracy: 10, updatedAtMs: Date.now() }
    })
  );

  // Valid decline succeeds
  await assertSucceeds(
    updateDoc(doc(sharerDb, "shares", VALID_SHARE_ID), {
      sharerUid: "sharer-1",
      status: "declined"
    })
  );

  // Seed an already-expired document bypassing rules to test expiry enforcement
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "shares", EXPIRED_SHARE_ID), {
      ownerUid: "owner-1",
      sharerUid: null,
      requesterLabel: "Alex",
      status: "pending",
      createdAt: Timestamp.fromMillis(Date.now() - 3600000),
      expiresAt: Timestamp.fromMillis(Date.now() - 60000),
      location: null
    });
  });

  // Expired pending invite cannot be read or accepted by recipient or owner
  await assertFails(getDoc(doc(sharerDb, "shares", EXPIRED_SHARE_ID)));
  await assertFails(getDoc(doc(ownerDb, "shares", EXPIRED_SHARE_ID)));
  await assertFails(
    updateDoc(doc(sharerDb, "shares", EXPIRED_SHARE_ID), {
      sharerUid: "sharer-1",
      status: "active",
      location: { lat: 51.5, lng: -0.07, accuracy: 10, updatedAtMs: Date.now() }
    })
  );

  // Seed an expired ACTIVE share with stored location to verify reads are denied for owner & sharer
  const EXPIRED_ACTIVE_ID = "11223344556677889900aabbccddeeff";
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "shares", EXPIRED_ACTIVE_ID), {
      ownerUid: "owner-1",
      sharerUid: "sharer-1",
      requesterLabel: "Alex",
      status: "active",
      createdAt: Timestamp.fromMillis(Date.now() - 3600000),
      expiresAt: Timestamp.fromMillis(Date.now() - 60000),
      location: { lat: 51.5, lng: -0.07, accuracy: 10, updatedAtMs: Date.now() - 120000 }
    });
  });

  // After expiry, neither owner nor bound sharer can read location or update it
  await assertFails(getDoc(doc(ownerDb, "shares", EXPIRED_ACTIVE_ID)));
  await assertFails(getDoc(doc(sharerDb, "shares", EXPIRED_ACTIVE_ID)));
  await assertFails(
    updateDoc(doc(sharerDb, "shares", EXPIRED_ACTIVE_ID), {
      status: "active",
      location: { lat: 51.51, lng: -0.08, accuracy: 10, updatedAtMs: Date.now() }
    })
  );

  // Owner can still delete an expired document to wipe stored data
  await assertFails(deleteDoc(doc(sharerDb, "shares", EXPIRED_ACTIVE_ID)));
  await assertSucceeds(deleteDoc(doc(ownerDb, "shares", EXPIRED_ACTIVE_ID)));
});
