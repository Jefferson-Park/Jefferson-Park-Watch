/**
 * geocode-service.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Central geocoding + reverse-address-lookup module for the Mapping
 * Innovations platform. Ported from demo_dashboard.html's confirmed-working
 * "LA County Assessor Geocoding Engine" (consolidated 2026-07-02) — same
 * pipeline, not a rewrite, so behavior matches what was already known to
 * work there.
 *
 * Before this module existed there were three separate, inconsistent
 * implementations:
 *   • admin-app.js had a reverse-only pipeline (_reverseGeocodeAddress) —
 *     no forward geocoding (typed address → coordinates) existed anywhere
 *     in admin-app.js at all.
 *   • admin-app.js's commitStagingBatch() had its own simpler forward-only
 *     Nominatim fallback (bare free-text search, no Assessor stage, no LA
 *     County result filtering) for photos with no EXIF GPS.
 *   • dashboard-app.js's address search bar had its own bare Nominatim-only
 *     forward geocode.
 * All three now call into this module instead. (csv-batch-service.js's
 * block+jitter privacy geocoder for sensitive crime addresses is NOT
 * touched — it's deliberately a different, privacy-preserving algorithm
 * per its own file comments, not a duplicate of this one.)
 *
 * Three-stage pipeline for forward geocoding, same order everywhere it's used:
 *   Stage 1  — LA County Assessor ArcGIS services: authoritative and
 *              parcel-accurate, but LA County only, and forward lookups
 *              need a leading house number (so intersections naturally
 *              fall through to Stage 2 below).
 *   Stage 1b — Neighbor-parcel interpolation: for a house number with no
 *              direct Assessor match (new construction, a city-owned/vacant
 *              gap parcel — the Assessor's situs-address data lags
 *              real-world additions), place it between the nearest
 *              same-parity neighbors it DOES have on that street.
 *   Stage 2  — Nominatim (OpenStreetMap): fallback for anything outside
 *              Assessor coverage, intersections, or when Stages 1/1b fail.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ASSESSOR_FIND_URL, ASSESSOR_QUERY_URL, JP_VIEWBOX } from './config.js';

export function isInLACounty(lat, lng) {
  return lat >= 33.5 && lat <= 34.9 && lng >= -118.95 && lng <= -117.6;
}

// Shared by queryAssessorParcel's /find search AND the interpolation
// street-name parser below — one list instead of two copies that can drift
// apart. Matches a trailing street-type word (abbreviated or spelled out,
// with or without a period) so "Edgehill Drive" and "EDGEHILL DR" (the
// Assessor's own abbreviated convention) both reduce to the same bare
// "EDGEHILL" search term rather than silently failing to match each other.
const STREET_SUFFIX_RE = /\s+(BLVD|BOULEVARD|AVE|AVENUE|ST|STREET|DR|DRIVE|RD|ROAD|LN|LANE|CT|COURT|PL|PLACE|WAY|PKWY|PARKWAY|TERR|TER|TERRACE|CIR|CIRCLE|EXPY|EXPRESSWAY)\.?\s*$/i;

/**
 * Pulls a leading house number and the bare street name (direction prefix,
 * street-type suffix, and any trailing ", City, ST" chunk all dropped) out
 * of a typed address, for the neighbor-parcel interpolation query below.
 * Both direction and suffix are dropped rather than kept, so the LIKE
 * search matches regardless of how differently the admin's phrasing and
 * the Assessor's own stored convention abbreviate them — SitusStreet
 * itself never includes the direction prefix (separate field), and
 * suffixes are inconsistently abbreviated between typed input and the
 * Assessor's data, so a bare street name is the only reliably shared
 * substring.
 */
function _extractHouseNumberAndStreetName(rawAddress) {
  const clean = (rawAddress || '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const m = clean.match(/^(\d+)\s*(?:[½¼¾])?\s*(.*)$/);
  if (!m) return null;
  const houseNo = parseInt(m[1], 10);
  if (!Number.isFinite(houseNo) || houseNo <= 0) return null;

  let streetName = m[2].replace(/^(NE|NW|SE|SW|N|S|E|W)\.?\s+/i, '').trim();
  streetName = streetName.split(',')[0].trim();
  streetName = streetName.replace(STREET_SUFFIX_RE, '').trim();
  if (!streetName) return null;

  return { houseNo, streetName };
}

// A typical LA County block runs roughly 100 house numbers; capping the
// bracket search at 300 either side keeps the CANDIDATE POOL within a
// couple of blocks of the target instead of pulling in the entire street
// city-wide. This is just a pre-filter — the real safety check is the
// physical-distance plausibility test below, since house-number proximity
// alone isn't reliable on a street whose name is shared across
// disconnected segments (common on LA hillside streets, which don't always
// form one contiguous run).
const MAX_INTERPOLATION_NEIGHBOR_DELTA = 300;

// Rough planar distance in meters — plenty accurate at LA-block scale, no
// need for true haversine.
function _approxMetersBetween(lat1, lng1, lat2, lng2) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
  const dLat = (lat2 - lat1) * mPerDegLat;
  const dLng = (lng2 - lng1) * mPerDegLng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Fallback for addresses that miss the Assessor's direct SitusAddress match
 * (Stage 1) — a real, common gap, not a query-formatting problem: a parcel
 * with no recorded structure (city-owned, vacant, or a newer building not
 * yet re-assessed) simply has no situs-address row at all, even though the
 * Assessor layer has neighboring parcels on the same block.
 *
 * Queries the Assessor /query endpoint for other parcels on the same
 * street, then interpolates a position between the nearest same-parity
 * house numbers bracketing the target (e.g. 3102 and 3128 bracketing
 * 3118) using the layer's own CENTER_LAT/CENTER_LON fields — no extra
 * centroid round-trip needed. Falls back to the single nearest neighbor if
 * only one side brackets (and it's genuinely close by number). Same-parity
 * filtering matters because the two sides of a street are numbered
 * independently in essentially every LA grid — interpolating across both
 * would draw a line across the street rather than along it.
 *
 * Also sanity-checks that a candidate bracket is physically close, not just
 * numerically close — LA hillside streets in particular often have
 * disconnected/looping segments that share the same street name without
 * being physically adjacent, so a numerically-close "neighbor" a mile away
 * on a different segment gets rejected rather than trusted.
 *
 * @param {string} rawAddress
 * @returns {Promise<{lat:number,lng:number,label:string,precision:'exact'|'interpolated'|'interpolated_single_neighbor'}|null>}
 *   null if the address doesn't parse, the query fails (network error,
 *   including a CORS-blocked browser request — this is a public county
 *   ArcGIS endpoint and some browsers/environments may not get CORS
 *   headers back from it, so failure here should always be a quiet
 *   fall-through, never a thrown error), or no usable neighbor exists.
 */
export async function interpolateFromNeighboringParcels(rawAddress) {
  const parts = _extractHouseNumberAndStreetName(rawAddress);
  if (!parts) return null;
  const { houseNo, streetName } = parts;

  const escapedStreet = streetName.replace(/'/g, "''");
  const params = new URLSearchParams({
    // No SitusCity filter here — Stage 1 (queryAssessorParcel) doesn't
    // filter on it either, it just bounds the final result with
    // isInLACounty() after the fact. An exact 'LOS ANGELES' text match
    // would silently exclude legitimate LA County parcels sitting in
    // unincorporated pockets, small enclave cities, or with a blank/
    // differently-formatted SitusCity — which is almost certainly why a
    // real neighboring parcel wasn't turning up. Same broad bounding-box
    // check applied to the candidates below instead, for consistency.
    where: `UPPER(SitusStreet) LIKE '%${escapedStreet}%'`,
    outFields: 'AIN,SitusHouseNo,SitusStreet,SitusCity,SitusFullAddress,CENTER_LAT,CENTER_LON',
    returnGeometry: 'false',
    outSR: '4326',
    resultRecordCount: '500',
    f: 'json',
  });

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let res;
  try {
    res = await fetch(ASSESSOR_QUERY_URL + '?' + params, { signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    console.warn('[geocode-service] interpolateFromNeighboringParcels: request failed (network error or CORS):', e.message);
    return null;
  }
  clearTimeout(timer);
  if (!res.ok) return null;

  let data;
  try { data = await res.json(); } catch { return null; }
  if (data.error || !Array.isArray(data.features)) return null;

  const candidates = [];
  for (const f of data.features) {
    const attrs = f.attributes || {};
    const n   = parseInt(attrs.SitusHouseNo, 10);
    const lat = attrs.CENTER_LAT, lng = attrs.CENTER_LON;
    if (!Number.isFinite(n) || n <= 0) continue;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!isInLACounty(lat, lng)) continue; // same broad bound Stage 1 uses, in place of the removed SitusCity text filter
    if (Math.abs(n - houseNo) > MAX_INTERPOLATION_NEIGHBOR_DELTA) continue;
    candidates.push({ n, lat, lng, fullAddr: attrs.SitusFullAddress });
  }
  if (!candidates.length) return null;

  const sameParity = candidates.filter(c => c.n % 2 === houseNo % 2);
  const pool = sameParity.length ? sameParity : candidates;

  let lower = null, upper = null;
  for (const c of pool) {
    if (c.n === houseNo) {
      // It's actually in the parcel data after all — /find's text search
      // just missed it. Use it directly at full precision.
      return { lat: c.lat, lng: c.lng, label: c.fullAddr || rawAddress, precision: 'exact' };
    }
    if (c.n < houseNo && (!lower || c.n > lower.n)) lower = c;
    if (c.n > houseNo && (!upper || c.n < upper.n)) upper = c;
  }

  if (lower && upper) {
    const numberSpan = upper.n - lower.n;
    const dist = _approxMetersBetween(lower.lat, lower.lng, upper.lat, upper.lng);
    // LA residential frontages run roughly 15-45m per house-number step;
    // even a generous commercial/hillside allowance doesn't justify much
    // more than ~25m per number between two genuine same-block neighbors.
    // A bracket that blows past this is more likely two points on a
    // disconnected segment of a looping street that happens to share the
    // same name (a real pattern on LA hillside streets) than an actual
    // gap-parcel pair — better to fall through to Nominatim's honestly
    // vague street-level match than confidently place a pin on the wrong
    // block.
    const maxPlausibleMeters = Math.max(150, numberSpan * 25);
    if (dist <= maxPlausibleMeters) {
      const frac = (houseNo - lower.n) / numberSpan;
      return {
        lat: lower.lat + frac * (upper.lat - lower.lat),
        lng: lower.lng + frac * (upper.lng - lower.lng),
        label: rawAddress,
        precision: 'interpolated',
      };
    }
    console.warn(
      `[geocode-service] interpolation bracket rejected as implausible: ` +
      `${lower.n}-${upper.n} spans ~${Math.round(dist)}m — likely a disconnected same-name street segment, not the actual block.`
    );
    return null;
  }

  // Only one side bracketed — no second point to sanity-check distance
  // against, so lean conservative and only trust it when it's genuinely
  // adjacent (within ~20 house numbers). A single far-off "neighbor" from
  // a mis-matched street segment is exactly the failure mode above, just
  // with nothing to cross-check it against.
  const single = lower || upper;
  if (single && Math.abs(single.n - houseNo) <= 20) {
    return { lat: single.lat, lng: single.lng, label: rawAddress, precision: 'interpolated_single_neighbor' };
  }

  return null;
}

// ─── Stage 1: LA County Assessor parcel lookup (forward) ───────────────────────

/**
 * Forward-geocodes a street address via the LA County Assessor parcel
 * service, using a 3-tier centroid strategy (direct point → /query centroid
 * via AIN → bbox center of rings) — ported verbatim from
 * demo_dashboard.html's queryAssessorParcel().
 * @param {string} streetAddr
 * @returns {Promise<{lat:number,lng:number,ain:string,matchAddr:string}|null>}
 */
export async function queryAssessorParcel(streetAddr) {
  const clean = (streetAddr || '')
    .replace(/\*+/g, '')
    .replace(/\b1\/2\b/g, '½').replace(/\b1\/4\b/g, '¼').replace(/\b3\/4\b/g, '¾')
    .replace(/\s+/g, ' ').trim().toUpperCase();

  const numMatch = clean.match(/^(\d+\s*[½¼¾]?)/);
  if (!numMatch) return null; // no leading house number — not something Assessor /find can resolve (e.g. an intersection)
  const houseNo = numMatch[1].trim();

  let streetPart = clean.slice(numMatch[0].length).trim();
  streetPart = streetPart.replace(/^(NE|NW|SE|SW|N|S|E|W)\.(\s+)/i, '$1$2');

  const streetBase = streetPart
    .replace(STREET_SUFFIX_RE, '')
    .trim();
  if (!streetBase) return null;

  const searchText = `${houseNo} ${streetBase}`;

  const doFind = async (searchFields) => {
    const params = new URLSearchParams({
      searchText, searchFields,
      layers: '0', returnGeometry: 'true', outSR: '4326', f: 'json',
    });
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await fetch(ASSESSOR_FIND_URL + '?' + params, { signal: ctrl.signal });
    } finally { clearTimeout(timer); }
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return (data.results && data.results.length) ? data.results[0] : null;
  };

  try {
    let result = await doFind('SitusAddress');
    if (!result) result = await doFind('SitusFullAddress');
    if (!result) return null;

    const attrs = result.attributes || {};
    let lat = null, lng = null;
    const geom = result.geometry;

    if (geom && geom.x !== undefined && geom.y !== undefined) {
      // Tier 1: service returned a point directly
      lng = geom.x; lat = geom.y;
    } else {
      // Tier 2: we got rings — ask /query for the Assessor's own
      // pre-computed label point via returnCentroid=true (far more
      // accurate than any client-side calculation).
      const ain = attrs.AIN || attrs.APN || '';
      if (ain) {
        try {
          const qParams = new URLSearchParams({
            where:           `AIN='${ain}'`,
            outFields:       'AIN,SitusFullAddress',
            returnGeometry:  'false',
            returnCentroid:  'true',
            outSR:           '4326',
            f:               'json',
          });
          const qCtrl  = new AbortController();
          const qTimer = setTimeout(() => qCtrl.abort(), 10000);
          let qRes;
          try {
            qRes = await fetch(ASSESSOR_QUERY_URL + '?' + qParams, { signal: qCtrl.signal });
          } finally { clearTimeout(qTimer); }

          if (qRes.ok) {
            const qData = await qRes.json();
            const feat  = qData.features && qData.features[0];
            const c     = feat?.centroid;
            if (c && c.x !== undefined && c.y !== undefined) {
              lng = c.x; lat = c.y;
            }
          }
        } catch (qErr) {
          console.warn('[geocode-service] Assessor /query centroid failed:', qErr.message);
        }
      }

      // Tier 3: /query failed or no AIN — bbox center of rings
      if ((lat == null || lng == null) && geom && geom.rings && geom.rings.length) {
        const ring = geom.rings[0];
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const p of ring) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
        lng = (minX + maxX) / 2;
        lat = (minY + maxY) / 2;
      }
    }
    if (lat == null || lng == null) return null;

    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      lng = lng / 20037508.34 * 180;
      lat = Math.atan(Math.exp(lat / 20037508.34 * Math.PI)) * 360 / Math.PI - 90;
    }
    if (!isInLACounty(lat, lng)) return null;

    return {
      lat, lng,
      ain:       attrs.AIN || attrs.APN || '',
      matchAddr: attrs.SitusFullAddress || attrs.SitusAddress || searchText,
    };
  } catch (e) {
    console.warn('[geocode-service] queryAssessorParcel exception:', e.message);
    return null;
  }
}

// ─── Stage 2: Nominatim (forward) ───────────────────────────────────────────────

function _buildNominatimParams(rawAddress, limit) {
  const query_ = rawAddress
    .replace(/\b1\/2\b/g, '½').replace(/\b1\/4\b/g, '¼').replace(/\b3\/4\b/g, '¾');
  const hasCity = /,/.test(query_.trim());
  let street = query_.trim(), city = 'Los Angeles', state = 'CA';
  if (hasCity) {
    const parts = query_.trim().split(',').map(s => s.trim());
    street      = parts[0];
    const rest  = parts.slice(1).join(' ');
    const stateM = rest.match(/\b([A-Z]{2})\b/);
    state = stateM ? stateM[1] : 'CA';
    city  = rest.replace(/\b[A-Z]{2}\b/, '').replace(/\d{5}/, '').trim().replace(/,$/, '').trim() || 'Los Angeles';
  }
  const params = new URLSearchParams({
    street, city, state, country: 'US',
    format: 'json', limit: String(limit),
    addressdetails: '1', zoom: '19',
    email: 'info@mappinginnovations.com',
  });
  params.set('viewbox', JP_VIEWBOX);
  params.set('bounded', '0');
  return params;
}

function _pickBestNominatimResult(nomData) {
  const inCounty = nomData.filter(r => isInLACounty(parseFloat(r.lat), parseFloat(r.lon)));
  return (
    inCounty.find(r => (r.address?.city || '').toLowerCase() === 'los angeles' && r.address?.house_number) ||
    inCounty.find(r => r.address?.house_number) ||
    inCounty[0] ||
    null
  );
}

function _labelForNominatimResult(best) {
  const a = best.address || {};
  let label = '';
  if (a.house_number && a.road) label = `${a.house_number} ${a.road}`;
  else if (a.road)              label = a.road;
  else                          label = best.display_name.split(',').slice(0, 2).join(',').trim();
  const resultCity = a.city || a.town || a.suburb || '';
  if (resultCity) label += `, ${resultCity}`;
  return label;
}

/**
 * Full forward-geocode pipeline: Assessor parcel lookup first (Stage 1),
 * Nominatim second (Stage 2). Intersections ("5th and Normandie", "5th &
 * Normandie") are detected and routed to Nominatim's free-text search
 * (structured street=/city=/state= params don't handle cross-streets well);
 * ordinary single addresses use the structured search for better precision.
 *
 * @param {string} rawAddress
 * @returns {Promise<{lat:number,lng:number,label:string,precision:'exact'|'interpolated'|'interpolated_single_neighbor'|'approximate'}|{reason:string}|null>}
 *   null only for an empty input; a real lookup always resolves to either a
 *   location or a {reason} the caller can show the user. precision:'exact'
 *   means an Assessor parcel match or a Nominatim house-number match on the
 *   requested street — safe to display/store as the address. 'interpolated'
 *   / 'interpolated_single_neighbor' means no parcel exists for this exact
 *   house number, but it was placed between (or next to) real neighboring
 *   parcels on the same street. 'approximate' means a lower-confidence
 *   fallback (intersection, or a road/suburb-level Nominatim match with no
 *   house number). Anything other than 'exact' is safe to use for placing
 *   a pin, but callers should NOT use its label to overwrite text the admin
 *   already typed.
 */
export async function forwardGeocode(rawAddress) {
  const typed = (rawAddress || '').trim();
  if (!typed) return null;

  // Stage 1 — Assessor (no-ops/returns null for intersections, since those
  // have no leading house number for /find to match on).
  const streetOnly = typed.split(',')[0].trim();
  const parcel = await queryAssessorParcel(streetOnly);
  if (parcel) {
    // Parcel-level match — exact, so callers are safe to overwrite the
    // admin's typed text with this label.
    return { lat: parcel.lat, lng: parcel.lng, label: parcel.matchAddr, precision: 'exact' };
  }

  // Stage 1b — no direct parcel match. Before falling all the way to a
  // street-level Nominatim guess, check whether this house number sits
  // between (or next to) parcels we DO have on this street — covers new
  // construction and city-owned/vacant gap parcels the Assessor hasn't
  // re-recorded yet.
  const interpolated = await interpolateFromNeighboringParcels(streetOnly);
  if (interpolated) {
    return interpolated;
  }

  // Stage 2 — Nominatim.
  const isIntersection = /\s+(and|&|at|@)\s+/i.test(typed);

  try {
    let nomRes;
    if (isIntersection) {
      let searchAddress = typed.replace(/\s+(and|&|at|@)\s+/i, ', ');
      if (!/los angeles|,\s*ca\b/i.test(searchAddress)) searchAddress += ', Los Angeles, CA';
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}&viewbox=${JP_VIEWBOX}&bounded=0&limit=5&addressdetails=1`;
      nomRes = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    } else {
      const nomParams = _buildNominatimParams(typed, 5);
      nomRes = await fetch('https://nominatim.openstreetmap.org/search?' + nomParams, {
        headers: { 'Accept-Language': 'en' },
      });
    }

    const nomData = await nomRes.json();
    const best = _pickBestNominatimResult(nomData);

    if (best) {
      // A Nominatim match with a house_number on the SAME street the admin
      // typed is genuinely precise. Anything else — an intersection, or a
      // road-level/suburb-level match returned because nothing closer was
      // found (the inCounty[0] fallback in _pickBestNominatimResult) — is a
      // best-effort approximation, often the nearest indexed point on that
      // road rather than the actual address, which is how a typed exact
      // address ends up relabeled several blocks off. Callers should treat
      // 'approximate' as "safe to move the pin, not safe to overwrite the
      // admin's typed text."
      const precision = (!isIntersection && best.address?.house_number) ? 'exact' : 'approximate';
      return {
        lat: parseFloat(best.lat),
        lng: parseFloat(best.lon),
        label: _labelForNominatimResult(best),
        precision,
      };
    }

    const inCounty = nomData.filter(r => isInLACounty(parseFloat(r.lat), parseFloat(r.lon)));
    const outCity = nomData[0]?.address?.city || nomData[0]?.address?.town || 'another city';
    const reason = nomData.length && !inCounty.length
      ? `Match found in ${outCity} — try adding "Los Angeles"`
      : 'Address not found — try a cross-street or add "Los Angeles"';
    return { reason };
  } catch (err) {
    console.error('[geocode-service] forwardGeocode failed:', err);
    return { reason: 'Geocoding failed — please try again.' };
  }
}

// ─── Reverse geocode ──────────────────────────────────────────────────────────
//
// Two-pass Assessor lookup, both against ASSESSOR_QUERY_URL (layer 0),
// neither dependent on zoom level or map container size:
//
//   Pass 1 — exact point-in-polygon. Correct whenever the coordinate
//            actually falls inside a parcel boundary.
//   Pass 2 — small envelope query + real distance-to-boundary comparison,
//            for coordinates that fall outside every parcel (streets,
//            sidewalks, alleys — exactly where a tree or utility pole
//            usually sits). Picks whichever candidate parcel's boundary is
//            geometrically closest to the point, not just whichever the
//            server happened to return first. (2026-07-22 accuracy fix,
//            replacing the old zoom/map-size-dependent /identify lookup)
const _ASSESSOR_OUTFIELDS = 'AIN,APN,SitusHouseNo,SitusDirection,SitusStreet,SitusCity,SitusZip,SitusFullAddress';
const _NEAREST_PARCEL_BUFFER_DEG = 0.00018; // ≈20m at LA's latitude — plenty for a curb/sidewalk offset

async function _queryNearestParcel(lat, lng) {
  // Pass 1: point-in-polygon
  const ptParams = new URLSearchParams({
    geometry:       `${lng},${lat}`,
    geometryType:   'esriGeometryPoint',
    inSR:           '4326',
    spatialRel:     'esriSpatialRelIntersects',
    outFields:      _ASSESSOR_OUTFIELDS,
    returnGeometry: 'false',
    f:              'json',
  });
  const ptCtrl  = new AbortController();
  const ptTimer = setTimeout(() => ptCtrl.abort(), 10000);
  let ptRes;
  try {
    ptRes = await fetch(ASSESSOR_QUERY_URL + '?' + ptParams, { signal: ptCtrl.signal });
  } finally {
    clearTimeout(ptTimer);
  }
  if (ptRes.ok) {
    const ptData = await ptRes.json();
    const hit = ptData?.features?.[0]?.attributes;
    if (hit) return hit;
  }

  // Pass 2: point missed every parcel — envelope query + nearest-boundary pick
  const b = _NEAREST_PARCEL_BUFFER_DEG;
  const envParams = new URLSearchParams({
    geometry:       `${lng - b},${lat - b},${lng + b},${lat + b}`,
    geometryType:   'esriGeometryEnvelope',
    inSR:           '4326',
    spatialRel:     'esriSpatialRelIntersects',
    outFields:      _ASSESSOR_OUTFIELDS,
    returnGeometry: 'true',
    outSR:          '4326',
    f:              'json',
  });
  const envCtrl  = new AbortController();
  const envTimer = setTimeout(() => envCtrl.abort(), 10000);
  let envRes;
  try {
    envRes = await fetch(ASSESSOR_QUERY_URL + '?' + envParams, { signal: envCtrl.signal });
  } finally {
    clearTimeout(envTimer);
  }
  if (!envRes.ok) return null;

  const envData = await envRes.json();
  const feats = envData?.features || [];
  if (!feats.length) return null;

  let best = null, bestDist = Infinity;
  for (const feat of feats) {
    const d = _minDistToRings(lat, lng, feat.geometry?.rings);
    if (d < bestDist) { bestDist = d; best = feat.attributes; }
  }
  return best;
}

// Approximate min distance (in decimal degrees) from a point to a polygon's
// boundary rings, via point-to-segment distance on every edge. Precise
// enough at this scale (comparing a handful of candidate parcels within
// ~20m of each other) — not meant for survey-grade geodesy.
function _minDistToRings(lat, lng, rings) {
  if (!rings || !rings.length) return Infinity;
  let min = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      min = Math.min(min, _distToSegment(lng, lat, x1, y1, x2, y2));
    }
  }
  return min;
}

function _distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Reverse-geocodes a lat/lng into a human-readable address label. Assessor
 * lookup first (parcel-accurate SitusFullAddress), Nominatim reverse second.
 *
 * 2026-07-22: replaced the old /identify pixel-tolerance lookup. /identify's
 * match radius depends on the caller's current mapExtent + imageDisplay
 * (i.e. zoom level and map container size at the moment of the call), so
 * the exact same coordinate could resolve to a different — and not
 * necessarily nearest — parcel depending on how zoomed in the admin
 * happened to be. That's the "address isn't the nearest parcel" bug.
 *
 * Now does an exact point-in-polygon /query first (correct whenever the
 * point actually falls inside a parcel), then falls back to a small
 * envelope /query + real distance-to-boundary comparison for points that
 * fall outside every parcel — the common case for trees, poles, and other
 * street/sidewalk assets. Neither pass depends on zoom or map size.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {object} [mapRef] - unused for the Assessor lookup now; kept for
 *   backward compatibility with existing callers.
 * @returns {Promise<string|null>}
 */
export async function reverseGeocode(lat, lng, mapRef) {
  // Stage 1: LA County Assessor — point-in-polygon, then nearest-parcel fallback
  try {
    const parcel = await _queryNearestParcel(lat, lng);
    if (parcel?.SitusFullAddress) return parcel.SitusFullAddress;
  } catch (idErr) {
    console.warn('[geocode-service] reverseGeocode: Assessor query failed:', idErr.message);
  }

  // Stage 2: Nominatim reverse fallback
  try {
    const nomCtrl  = new AbortController();
    const nomTimer = setTimeout(() => nomCtrl.abort(), 8000);
    let nomRes;
    try {
      nomRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' }, signal: nomCtrl.signal }
      );
    } finally {
      clearTimeout(nomTimer);
    }

    if (nomRes.ok) {
      const nomData = await nomRes.json();
      const a = nomData?.address || {};
      if (a.house_number && a.road) return `Near ${a.house_number} ${a.road}`;
      if (a.road)                   return `Near ${a.road}`;
      if (nomData?.display_name)    return `Near ${nomData.display_name.split(',').slice(0, 2).join(',').trim()}`;
    }
  } catch (nomErr) {
    console.warn('[geocode-service] reverseGeocode: Nominatim reverse failed:', nomErr.message);
  }

  return null;
}
