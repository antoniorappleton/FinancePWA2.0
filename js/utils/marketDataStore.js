import { db } from "../firebase-config.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { cleanTicker } from "./scoring.js";
import { enrichETFAsset, isKnownETF } from "../engines/etf-overlap.js";

/**
 * Single source of truth for `acoesDividendos` (+ `etfHoldings`) on the client.
 * Replaces the per-screen onSnapshot/getDocs calls that each screen used to
 * open independently, and the two competing writers of window._marketDataMap.
 */

let acoesSnap = null;
let etfHoldingsSnap = null;
let marketDataMap = new Map();
let lastUpdatedAt = null;
let started = false;

const subscribers = new Set();

function toDateSafe(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

function rebuildMap() {
  const map = new Map();

  acoesSnap?.forEach((d) => {
    const x = d.data();
    if (x.ticker) map.set(String(x.ticker).toUpperCase(), x);
  });

  etfHoldingsSnap?.forEach((d) => {
    const x = d.data();
    const rawTicker = String(x.ticker || d.id || "").toUpperCase();
    if (!rawTicker) return;
    const cleanT = cleanTicker(rawTicker).toUpperCase();
    const patch = {
      holdings: Array.isArray(x.holdings) ? x.holdings : undefined,
      sectors: Array.isArray(x.sectors) ? x.sectors : undefined,
      geography: Array.isArray(x.geography) ? x.geography : undefined,
      holdings_count: Array.isArray(x.holdings) ? x.holdings.length : undefined,
      _etfHoldingsDoc: x,
    };

    [rawTicker, cleanT].filter(Boolean).forEach((key) => {
      const existing = map.get(key) || map.get(cleanT) || {};
      map.set(key, { ...existing, ...patch, ticker: existing.ticker || cleanT || rawTicker });
    });
  });

  // Centralized ETF enrichment (holdings quality / sector / geo diversity),
  // done once here instead of duplicated per screen.
  map.forEach((asset, ticker) => {
    if (isKnownETF(asset.ticker || ticker)) enrichETFAsset(asset, map);
  });

  // Freshness derived from the documents' own `updatedAt`, not from when
  // this listener happened to fire (that's what atividade.js's old
  // "Preços: agora" badge was actually measuring).
  let latest = null;
  acoesSnap?.forEach((d) => {
    const date = toDateSafe(d.data()?.updatedAt);
    if (date && (!latest || date > latest)) latest = date;
  });
  lastUpdatedAt = latest;

  marketDataMap = map;
  window._marketDataMap = map;

  subscribers.forEach((cb) => {
    try {
      cb(marketDataMap, acoesSnap);
    } catch (err) {
      console.error("[marketDataStore] subscriber error:", err);
    }
  });
}

function ensureStarted() {
  if (started) return;
  started = true;
  onSnapshot(collection(db, "acoesDividendos"), (snap) => {
    acoesSnap = snap;
    rebuildMap();
  });
  onSnapshot(collection(db, "etfHoldings"), (snap) => {
    etfHoldingsSnap = snap;
    rebuildMap();
  });
}

/**
 * Real-time subscription. Fires immediately with the current data if
 * already loaded, then again on every update. Returns an unsubscribe fn.
 */
export function subscribeMarketData(callback) {
  ensureStarted();
  subscribers.add(callback);
  if (acoesSnap) callback(marketDataMap, acoesSnap);
  return () => subscribers.delete(callback);
}

/**
 * One-shot read of the cached map, for consumers that used to re-fetch
 * with getDocs() on every click/modal open. Resolves with current data if
 * already loaded, otherwise waits for the first snapshot.
 */
export function getMarketDataSnapshot() {
  ensureStarted();
  return new Promise((resolve) => {
    const cb = (map) => {
      subscribers.delete(cb);
      resolve(map);
    };
    subscribers.add(cb);
    if (acoesSnap) cb(marketDataMap, acoesSnap);
  });
}

/**
 * One-shot list of every real asset (one entry per acoesDividendos document,
 * already enriched), for consumers that iterate all assets rather than look
 * one up by ticker. Iterating marketDataMap directly is NOT equivalent: it
 * can contain extra alias keys patched in from etfHoldings (e.g. both
 * "NASDAQ:VOO" and "VOO") that point at the same underlying asset, which
 * would show up as duplicate rows if enumerated as a list.
 */
export function getMarketDataList() {
  ensureStarted();
  return new Promise((resolve) => {
    const cb = (map, snap) => {
      subscribers.delete(cb);
      const list = [];
      snap?.forEach((d) => {
        const tickerRaw = String(d.data()?.ticker || "").toUpperCase();
        if (!tickerRaw) return;
        list.push(map.get(tickerRaw) || d.data());
      });
      resolve(list);
    };
    subscribers.add(cb);
    if (acoesSnap) cb(marketDataMap, acoesSnap);
  });
}

export function getLastUpdatedAt() {
  return lastUpdatedAt;
}
