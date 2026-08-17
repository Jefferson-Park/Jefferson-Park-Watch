/**
 * dashboard-app.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Public-facing community dashboard for Mapping Innovations SaaS.
 *
 * Design contract:
 *   • Read-only. No admin functions, no auth.
 *   • Creates its own anon Supabase client (persistSession:false) so it never
 *     inherits an admin session that happens to be open in the same browser.
 *   • Queries spatial_registry directly (no RPC) filtered to non-draft status.
 *   • All category/symbol data comes from config.js — no hardcoded lists here.
 *
 * ── Supabase Studio prerequisite ──────────────────────────────────────────────
 * The dashboard won't show any records until this policy is added:
 *
 *   CREATE POLICY "Public read active records"
 *   ON spatial_registry FOR SELECT TO anon
 *   USING (status != 'draft');
 *
 * Without it, the anon key sees zero rows (confirmed gap from 2026-06-29 session).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  CATEGORY_MAP,
  CATEGORY_GROUPS,
  getSymbol,
  SYMBOL_DEFAULT,
  resolveVisibleGroups,
  TES_GEOJSON_URL,
  TES_RAMPS,
  WOSIP_LABELS,
  SLO_BOUNDARY_COLORS,
  UNNC_BOUNDARY_COLORS,
  COUNCIL_DISTRICT_COLORS,
  NEIGHBORHOOD_COUNCIL_COLORS,
  LAPD_TYPE_CONFIG,
  RADIUS_M,
  GROUP_COMMITTEE_SLUG,
  COMMITTEE_SLUG_ALIASES,
  CATEGORY_SUBTYPES,
  SUBTYPE_MATCH_FIELD,
  ASSESSOR_IDENTIFY_URL,
  ASSESSOR_QUERY_URL,
  getTreeTrimColor,
  getFiscalYearFromRow,
  VIEW_PROFILES,
  resolveCommitteeSlugsForGroups,
} from './config.js';

import { submitPublicConcern, validateSubmissionPhoto } from './public-submission-service.js';
import { forwardGeocode, reverseGeocode } from './geocode-service.js';
import { fetchAttachments, validateLinkUrl } from './data-service.js';
import { resolveAssetUrl } from './asset-url-resolver.js';

// CoreMapEngine is used here in "headless" mode — only its pure geo-rendering
// methods (renderBoundaryGeoJSON, loadTesChoropleth, getPolygonStyle,
// _hashColorFor) are called, never .initialize(), so it never creates a
// second Leaflet map instance or touches Supabase. This reuses the exact
// same boundary/TES rendering logic as admin.html instead of a second copy
// drifting apart on the public dashboard (see map-core.js's own header note).
import { CoreMapEngine } from './map-core.js';

// ─── Supabase — dedicated anon client, never inherits admin session ───────────
// window.supabase is the UMD global loaded via <script> in dashboard.html.
const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// ─── Paginated fetch (2026-07-23) ──────────────────────────────────────────
// Supabase/PostgREST caps any single .select() response at 1000 rows by
// default (the project's "Max Rows" setting), silently — no error, just a
// truncated array. loadRecords() below used to do one unbounded select and
// broke the moment spatial_registry crossed 1000 total rows (7,266 tree
// records pushed it well past that). This loops with .range() until a page
// comes back short of PAGE_SIZE, so callers always get the true full set
// regardless of how the project's Max Rows setting is configured.
// `configure` receives the query builder after .select() and should attach
// .eq()/.neq()/.order()/etc. — .range() itself is applied by this helper.
const PAGE_SIZE = 1000;
async function _fetchAllRows(table, selectCols, configure) {
  let allRows = [];
  let from = 0;
  while (true) {
    let q = sb.from(table).select(selectCols).range(from, from + PAGE_SIZE - 1);
    if (configure) q = configure(q);
    const { data, error } = await q;
    if (error) return { data: null, error };
    allRows = allRows.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break; // short page = last page
    from += PAGE_SIZE;
  }
  return { data: allRows, error: null };
}

// ─── Org registry ─────────────────────────────────────────────────────────────
// Loaded once from the organizations table so we're data-driven, not hardcoded.
// Map of slug → { id, slug, display_name }
let _orgs = {};

// View profile (single-purpose wrapper pages, e.g. unnc.html) — set by the
// wrapper's own inline <script> BEFORE this module script tag runs. Plain
// dashboard.html never sets window.MI_VIEW_PROFILE, so _viewProfile is null
// there and every branch below falls through to today's normal behavior.
const _activeViewProfileKey = window.MI_VIEW_PROFILE || null;
const _viewProfile = _activeViewProfileKey ? (VIEW_PROFILES[_activeViewProfileKey] || null) : null;
if (_activeViewProfileKey && !_viewProfile) {
  console.warn('[dashboard] Unknown view profile:', _activeViewProfileKey, '— falling back to normal dashboard behavior.');
}

let _activeOrgSlug = _viewProfile?.orgSlug || 'unnc';

// Short tab labels, keyed by org slug — not derived from display_name.
// The old approach did display_name.replace('United Neighborhoods
// Neighborhood Council', 'UNNC'), but the org's actual legal name is
// "United Neighbors Neighborhood Council" (Neighbors, not Neighborhoods),
// so that string match silently never fired: the full un-shortened legal
// name rendered in the tab, overflowed its box, and got truncated
// (reported 2026-08 field test, screenshot showed "United Neighborhoo...").
// A direct slug→label map can't drift out of sync with display_name text
// the way a substring match can.
const ORG_SHORT_LABELS = {
  'unnc': 'UNNC',
  'jefferson-park-watch': 'JPW',
};

// ─── Filter state ─────────────────────────────────────────────────────────────
// Category-level granularity. Starts EMPTY — nothing plotted on the map
// until the reporter/visitor opts into specific categories via the sidebar
// checkboxes (2026-07-02 default-state change). Count badges are NOT tied
// to this set — see updateStats(), which counts against the status filter
// only, so badges stay populated and useful even while everything here is
// unchecked.
let _activeCategories = new Set();

// Sub-toggle state for CATEGORY_SUBTYPES rows (e.g. traffic's "Vehicle
// Collision Only", lighting's "Stop Sign") — keyed 'parentCat|subtypeValue'.
// Ported from JP_NIM.html's activeSubtypes. Empty means no sub-filter is
// applied for that parent category (all of its records show, same as
// JP_NIM's hasActiveSub() short-circuit).
let _activeSubtypes = new Set();
// Crime (public_safety group) date-range filter — null means "no bound set",
// so both empty is "show all crime records regardless of date".
let _crimeDateFrom = null;
let _crimeDateTo   = null;

// ─── Data state ───────────────────────────────────────────────────────────────
let _allRecords = [];   // all rows from the last fetch
let _visibleRecords = []; // post-filter subset rendered on map + list

// ─── Map state ────────────────────────────────────────────────────────────────
let _map = null;
let _isPickingReportLocation = false; // true while "Tap map to set pin" is armed — suppresses boundary info-sheet popups so the tap only sets the report pin
let _markersLayer = null; // L.layerGroup holding all current point (emoji) markers
let _shapesLayer = null;  // L.layerGroup holding all current Polygon/LineString shapes
// Map from record.id → L.Marker | L.GeoJSON so the record list can pan/highlight
let _markerById = {};

// ─── Locate-me / address-search state ──────────────────────────────────────────
let _userLocationMarker = null; // "you are here" dot from the locate control
let _searchResultMarker = null; // transient pin dropped by the address search bar

// ─── Level 1: Base Map / Assessor Parcels state ────────────────────────────────
let _baseLayer = null;         // current L.tileLayer (Street or Satellite)
let _parcelsLayer = null;      // L.tileLayer for LA County Assessor parcel tiles
let _parcelLabelsLayer = null; // L.layerGroup of house-number labels drawn over the parcel tiles — see loadParcelLabels() below (ported from admin-app.js, 2026-07-26)
let _parcelsActive = false;
const BASEMAP_PROVIDERS = {
  clean:     'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};
// Single Fused Map Cache ArcGIS tile service — confirmed live at
// LACounty_Cache/LACounty_Parcel (same MapServer as config.js's
// ASSESSOR_QUERY_URL, /tile/{z}/{y}/{x} instead of /0/query).
const PARCELS_TILE_URL = 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/tile/{z}/{y}/{x}';
const PARCELS_MIN_ZOOM = 16; // egress guard — parcel tiles only load once zoomed in close

// Egress guards for the other bbox-scoped, moveend-refreshed overlays
// (LAPD collisions, PurpleAir sensors, wind grid). Without a floor, panning
// out to a city-wide view re-queries a city-wide bbox on every moveend —
// the same class of spike the parcel tiles were already guarded against.
const LAPD_MIN_ZOOM = 13;
const ENV_MIN_ZOOM   = 12; // wind grid + PurpleAir sensor bbox query

// ─── Level 2: Boundary / TES state ──────────────────────────────────────────────
// Headless CoreMapEngine instance — see import comment above. Never call
// .initialize() on this; it exists purely to reuse renderBoundaryGeoJSON()
// and loadTesChoropleth().
const _geoEngine = new CoreMapEngine('map');
let _sloLayer = null;
let _unncBoundaryLayer = null;
// Citywide reference boundaries (2026-07-08) — same lazy-load-on-first-open
// pattern as SLO/UNNC above.
let _councilDistrictsLayer = null;
let _neighborhoodCouncilsLayer = null;
let _councilDistrictsActive = false;
let _neighborhoodCouncilsActive = false;
let _tesLayer = null;
let _sloActive = false;
let _unncBoundaryActive = false;
let _tesActive = false;
let _tesMode = 'tes';

// ─── LAPD Collisions state ──────────────────────────────────────────────────────
let _lapdLayer = null;
let _lapdData = [];
let _lapdActive = false;
const _lapdSubtypeActive = { vehicle: false, pedestrian: false, bicycle: false, fatality: false };
let _lapdDateFrom = null;
let _lapdDateTo = null;
let _lapdBoundsLoaded = false; // fire-once guard for _loadLAPDDatasetBounds() — see that fn, added 2026-07-30

// ─── Wind / PurpleAir state ──────────────────────────────────────────────────────
let _windLayer = null;
let _purpleairLayer = null;
let _windActive = false;
let _purpleairActive = false;
let _windMoveHandler = null;
let _purpleairMoveHandler = null;

// ─── Show Nearby (5-block radius) state ──────────────────────────────────────────
// Ported from admin-app.js's radius filter — adapted to dashboard-app.js's
// layer model: _markersLayer holds L.marker instances directly (like
// admin's layersRegistry.pins) and _shapesLayer holds one L.geoJSON group
// per row (like admin's layersRegistry.shapes).
let _radiusActive = false;
let _radiusCircle = null;
const _radiusHidden = new Map(); // layer -> parent group, for restoring on toggle-off

// ─── Search All Layers state ─────────────────────────────────────────────────
// Current lowercased/trimmed query from #search-all-input. Empty string means
// "no active search". Read by applyFiltersAndRender() to override every other
// map filter — same override precedence _radiusActive already has over
// category/subtype/date (see that block below).
let _searchQuery = '';

// ─── Report Concern (public intake) state ──────────────────────────────────────
let _reportLatLng = null;     // { lat, lng } currently selected in the open form
let _reportPinMarker = null;  // draggable pin shown on the map while the form is open

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Reverse of config.js's GROUP_COMMITTEE_SLUG (group -> committee_slug),
// used as a fallback signal below when a row's category_value doesn't
// resolve to a CATEGORY_MAP group at all.
const REVERSE_GROUP_COMMITTEE = Object.fromEntries(
  Object.entries(GROUP_COMMITTEE_SLUG).map(([group, slug]) => [slug, group])
);

/**
 * Resolves the CATEGORY_GROUPS id a spatial_registry row belongs to, for
 * group-exclusivity purposes (Crime & Public Safety hidden from UNNC, Trees
 * & Parks hidden from JPW — see resolveVisibleGroups() in config.js).
 *
 * category_value is the primary signal. When it doesn't resolve to a known
 * CATEGORY_MAP key (typo, legacy free-text value, etc.), this falls back to
 * the row's committee_slug (alias-resolved) via REVERSE_GROUP_COMMITTEE —
 * this is the fix for the confirmed legacy bug where every public_safety
 * row's organization_id is UNNC's (see COMMITTEE_SLUG_ALIASES's comment in
 * config.js): committee_slug is the one field on those rows that's actually
 * reliable, so it's used as a second opinion rather than letting an
 * unresolved category_value silently fall through the exclusivity check and
 * leak crime data into UNNC's dashboard.
 */
function _resolveRowGroup(row) {
  const key = String(row.category_value || '').toLowerCase().trim().replace(/ /g, '_');
  const group = CATEGORY_MAP[key]?.group;
  if (group) return group;

  const slug = row.committee_slug;
  if (!slug) return undefined;
  const canonicalSlug = COMMITTEE_SLUG_ALIASES[slug] || slug;
  return REVERSE_GROUP_COMMITTEE[canonicalSlug];
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Extracts a {lat, lng} from a spatial_registry row.
 * Handles the GeoJSON Point stored in the `geom` column (JSON-stringified).
 * Mirrors getRowCoordinates() in admin-app.js — keep in sync if that changes.
 */
function getRowCoordinates(row) {
  if (!row) return null;
  if (row.lat != null && row.lng != null) return { lat: Number(row.lat), lng: Number(row.lng) };
  if (row.latitude != null && row.longitude != null) return { lat: Number(row.latitude), lng: Number(row.longitude) };

  const geom = row.geom || row.geojson_geometry || row.geometry;
  if (!geom) return null;

  let coords = geom;
  if (typeof geom === 'string') {
    try { coords = JSON.parse(geom); }
    catch (e) { return null; }
  }

  if (coords?.type === 'Point' && Array.isArray(coords.coordinates)) {
    return { lat: Number(coords.coordinates[1]), lng: Number(coords.coordinates[0]) };
  }
  return null;
}

/**
 * Builds a safe popup HTML string for a record.
 * Does NOT call resolveAssetUrl (not imported here) — omits thumbnail entirely
 * for the public dashboard, which is fine for v1.
 */
// Greening Master Plan popups (sectioned header/description/funding/WOSIP
// goals, see buildGreeningPopupHtml) need more width than the compact
// generic card — 260px was fine for a title/address/notes stack but clips
// the funding row's right-aligned partner list and wraps goal tags onto
// nearly every line. The distinct className lets the close-button styling
// below target only these popups, leaving every other category's popup
// exactly as it was.
function _popupOptionsFor(row) {
  if (row.category_value === 'greening_zone') {
    return { className: 'mi-popup mi-popup-greening', maxWidth: 320 };
  }
  return { className: 'mi-popup', maxWidth: 260 };
}

// Categories carrying a metadata.diameter value (see CATEGORY_MAP's `fields`
// arrays) — used by buildPopupHtml below to surface DBH on the popup card,
// which nothing previously rendered despite the CSV importer/Edit drawer
// both already writing it. (2026-07-24)
const TREE_DIAMETER_CATEGORIES = new Set(['tree', 'project_tree', 'tree_parkway', 'tree_median', 'tree_trunk', 'stump', 'dead_tree', 'preservation_tree', 'project_tree_report']);

// project_tree_report shows its diameter labeled as "DBH" (diameter at
// breast height — the arborist term already used on its report forms)
// rather than the generic "Diameter" label the other tree categories use.
// (2026-08)
const DBH_LABEL_CATEGORIES = new Set(['project_tree_report']);

/**
 * Compact popup for a Tree Trimming Schedule LINESTRING segment — just the
 * street segment name and the fiscal year(s) it was serviced. Skips the
 * generic card's thumbnail/status/notes rows, none of which this category
 * has data for. (2026-07-24)
 */
function buildTreeTrimPopupHtml(row) {
  const title = esc(row.title || 'Tree Trimming Segment');
  const fiscalYear = getFiscalYearFromRow(row);
  const addr = esc(row.reported_address || '');
  let html = `<div class="mi-popup-card">`;
  html += `<strong>✂️ ${title}</strong>`;
  html += `<div class="popup-meta" style="margin-top:2px;">🗓️ Year Trimmed: ${fiscalYear ? esc(fiscalYear) : 'Not on file'}</div>`;
  if (addr) html += `<div class="popup-meta" style="margin-top:2px;">📍 ${addr}</div>`;
  html += `</div>`;
  return html;
}

function buildPopupHtml(row) {
  if (row.category_value === 'greening_zone') return buildGreeningPopupHtml(row);
  if (row.category_value === 'tree_trimming_segment') return buildTreeTrimPopupHtml(row);

  const sym = getSymbol(row.category_value, row.committee_slug);
  const title   = esc(row.title || 'Untitled');
  const addr    = _isAddressWithheld(row) ? '' : esc(row.reported_address || '');
  const notes   = esc(row.description_notes || '');
  const catLabel = CATEGORY_MAP[row.category_value]?.label || esc(row.category_value || '');
  const statusText = esc(row.status || '');
  // Falls back to legacy metadata.date/.time keys (written by the CSV batch
  // importer before 2026-07-06) so older imported records still show their
  // date/time here.
  const meta = getRowMetadata(row) || {};
  const incidentDate = meta.incident_date || meta.date || '';
  const incidentTime = meta.incident_time || meta.time || '';
  const dateTimeText = [incidentDate, incidentTime].filter(Boolean).join(' ');
  const diameter = meta.diameter || meta.dbh || '';

  let html = `<div class="mi-popup-card">`;

  // Thumbnail (2026-07-23): every current record's thumbnail_url/photo_url
  // is already a directly-usable public URL — written that way by the batch
  // upload pipeline's resize step — so this renders it as-is. No
  // resolveAssetUrl() bucket-path reconstruction needed (or available) here;
  // that helper solved a different, now-abandoned problem (locating assets
  // that predated the batch pipeline) and was never wired into this file.
  // This was the actual reason NO record's photo ever appeared on the public
  // dashboard, grouped or not — buildPopupHtml never referenced
  // thumbnail_url despite loadRecords() already selecting the column.
  if (row.thumbnail_url) {
    html += `<img src="${row.thumbnail_url}" loading="lazy" style="width:100%; max-height:130px; object-fit:cover; border-radius:6px; margin-bottom:4px; display:block;" onerror="this.style.display='none';" />`;
    if (row.photo_url && row.photo_url !== row.thumbnail_url) {
      html += `<a href="${row.photo_url}" target="_blank" rel="noopener" style="display:block; font-size:10px; color:var(--accent, #2f855a); text-decoration:underline; margin-bottom:6px;">View Full Resolution</a>`;
    }
  }

  html += `<strong>${sym.icon || '📍'} ${title}</strong>`;
  html += `<div class="popup-meta">${catLabel}`;
  // "Published" is the status on nearly every record the public dashboard
  // shows (drafts are filtered out upstream), so announcing it on every
  // card was pure noise — skip it here to free up popup space, while
  // still surfacing other statuses (pending/active/etc.) that do carry
  // information. (2026-08)
  if (statusText && statusText.toLowerCase() !== 'published') {
    html += ` · <span style="color:${statusColor(row.status)}">${statusText}</span>`;
  }
  html += `</div>`;
  if (dateTimeText) html += `<div class="popup-meta" style="margin-top:2px;">🕐 ${esc(dateTimeText)}</div>`;
  if (addr) html += `<div class="popup-meta" style="margin-top:2px;">📍 ${addr}</div>`;
  if (TREE_DIAMETER_CATEGORIES.has(row.category_value) && diameter) {
    const diameterLabel = DBH_LABEL_CATEGORIES.has(row.category_value) ? 'DBH' : 'Diameter';
    html += `<div class="popup-meta" style="margin-top:2px;">📏 ${diameterLabel}: ${esc(diameter)}${/\d$/.test(String(diameter)) ? '"' : ''}</div>`;
  }
  if (notes) {
    const short = notes.length > 120 ? notes.substring(0, 117) + '…' : notes;
    html += `<div class="popup-notes">${short}</div>`;
  }
  // Placeholder for _loadPopupChildrenPublic() — populated on 'popupopen',
  // mirrors admin-app.js's identical pattern. Stays empty/invisible for
  // ungrouped records or records with no children. (2026-07-23)
  html += `<div id="popup-children-${row.id}"></div>`;

  // Placeholder for _loadPopupAttachmentsPublic() — populated on
  // 'popupopen', same lazy pattern as popup-children just above. (2026-07-28)
  html += `<div id="popup-attachments-${row.id}"></div>`;

  html += `</div>`;
  return html;
}


// ─── Group children preview in public popups (2026-07-23) ──────────────────
// Mirrors admin-app.js's _loadPopupChildren(), scoped for this dashboard:
// read-only, so there's no Edit drawer to jump to on click — selecting a
// child from the dropdown swaps the preview card in place to show that
// child's own thumbnail/notes/address instead. Only ever queries
// spatial_registry (the only grouped table this dashboard reads) and only
// ever pulls non-draft rows, matching the same visibility rule the parent
// itself had to pass to be on the map at all.
//
// thumbnail_url is used as-is (already a full public URL, per fpp-service.js
// — same assumption buildPopupHtml's admin-app.js counterpart makes).
// photo_url isn't resolved here since resolveAssetUrl isn't imported into
// this file (same "omits thumbnail entirely for v1" tradeoff already noted
// on buildPopupHtml above) — a child with only a raw photo_url falls back to
// the 📎 icon rather than a broken <img>.
async function _loadPopupChildrenPublic(row) {
  if (!row?.group_id) return;
  const container = document.getElementById(`popup-children-${row.id}`);
  if (!container) return; // popup already closed before this resolved

  const { data: members, error } = await sb
    .from('spatial_registry')
    .select('id, title, category_value, status, reported_address, description_notes, photo_url, thumbnail_url, metadata, metadata_payload')
    .eq('group_id', row.group_id)
    .neq('status', 'draft');

  if (error || !members) return;

  const children = members.filter(m => m.id !== row.id);
  if (!children.length) return; // ungrouped or sole member — leave placeholder empty

  const childLabel = (m) => esc(m.title || 'Untitled');

  // (2026-08-08) Previously only the FIRST child got a real preview, and
  // only for groups with 2+ children — a group with exactly one child
  // (the common case: one photo re-linked to another) rendered a tiny
  // 32px icon + label with no way to see the child's actual photo, address,
  // or notes at all. Now every case renders the same full expanded card
  // (thumbnail, address, notes) immediately for whichever child is
  // "current" (defaulting to the first), and the dropdown — shown whenever
  // there's more than one child — just switches which child's full card is
  // displayed, instead of being the only way to see any detail whatsoever.
  const renderChildCard = (child) => {
    const thumb = child.thumbnail_url
      ? `<img src="${child.thumbnail_url}" loading="lazy" style="width:100%; max-height:110px; object-fit:cover; border-radius:6px; margin-bottom:4px; display:block;" onerror="this.style.display='none';" />`
      : '';
    // (2026-08-08) Same "View Full Resolution" pattern as the parent's own
    // card above (line ~362) — a plain new-tab link, not a custom lightbox;
    // this codebase doesn't have one and there's no reason to invent a
    // second pattern here. Without this, the child card showed a thumbnail
    // sized identically to the parent's own preview with no way to reach
    // the full-resolution image or view the child independently — the
    // actual point of a "click-out" for a public visitor, project manager,
    // or field officer who needs the real photo, not just a small preview.
    const fullRes = (child.photo_url && child.photo_url !== child.thumbnail_url)
      ? `<a href="${child.photo_url}" target="_blank" rel="noopener" style="display:block; font-size:10px; color:var(--accent, #2f855a); text-decoration:underline; margin-bottom:6px;">View Full Resolution</a>`
      : '';
    const addr = child.reported_address ? `<div class="popup-meta" style="margin-top:2px;">📍 ${esc(child.reported_address)}</div>` : '';
    const notesRaw = child.description_notes || '';
    const notes = notesRaw ? `<div class="popup-notes">${esc(notesRaw.length > 120 ? notesRaw.slice(0, 117) + '…' : notesRaw)}</div>` : '';
    return `${thumb}${fullRes}<strong style="font-size:12px;">${childLabel(child)}</strong>${addr}${notes}`;
  };

  const [firstChild, ...restChildren] = children;

  let html = `
    <div style="margin-top:8px; padding-top:8px; border-top:1px solid #e9ecef;">
      <div style="font-size:10px; color:#888; text-transform:uppercase; margin-bottom:4px;">
        📎 ${children.length} linked record${children.length === 1 ? '' : 's'}
      </div>
      <div class="popup-child-preview">${renderChildCard(firstChild)}</div>`;

  // (2026-08-08) Every child gets a real <option>, including whichever one
  // is currently displayed (firstChild) — previously the dropdown only
  // listed the OTHER children plus a dummy placeholder option with
  // value="". That meant once you switched away from firstChild, there was
  // no option left that mapped back to it — selecting the placeholder
  // looked up id "" (no match), silently did nothing, and firstChild's card
  // became permanently unreachable for the rest of that popup's life.
  if (children.length > 1) {
    html += `
      <select class="popup-child-select" style="width:100%; font-size:11px; padding:3px; margin-top:6px;">
        ${children.map(m => `<option value="${m.id}"${m.id === firstChild.id ? ' selected' : ''}>${childLabel(m)}</option>`).join('')}
      </select>`;
  }

  html += `</div>`;
  // (2026-07-28) No Popup.update() call — that re-renders from whatever
  // was ORIGINALLY passed to bindPopup(), wiping this injection right back
  // out. See admin-app.js's _loadPopupAttachments for the full explanation;
  // a prior attempt at "fixing" a sizing concern this way made
  // children/attachments disappear entirely. Reverted.
  container.innerHTML = html;

  const swapPreviewTo = (child) => {
    const preview = container.querySelector('.popup-child-preview');
    if (!preview) return;
    preview.innerHTML = renderChildCard(child);
  };

  container.querySelector('.popup-child-select')?.addEventListener('change', (e) => {
    const chosen = children.find(c => String(c.id) === e.target.value);
    if (chosen) swapPreviewTo(chosen);
  });
}

// ─── Attachment links/files preview in public popups (2026-07-28, files
// wired 2026-07-30) ──────────────────────────────────────────────────────
// Mirrors admin-app.js's _loadPopupAttachments(): renders both link chips
// (🔗, manually-added via "+ Add Link" — storage_path IS already the full
// external URL) and file/document chips (📎, uploaded via "+ Add Photo" —
// storage_path is a bucket-relative path that needs resolveAssetUrl() to
// become a viewable URL). Previously this file didn't import
// resolveAssetUrl at all, so every file/document attachment was silently
// skipped here — that's now fixed by the asset-url-resolver.js import
// above. (The other half of that same gap — resolveAssetUrl blocking
// documents outright, everywhere, not just here — was fixed directly in
// asset-url-resolver.js itself; see its _DOCUMENT_EXT_RE comment.)
//
// This dashboard only ever queries spatial_registry (see file header), so
// the domainKey passed to resolveAssetUrl is hardcoded rather than derived.
//
// No is_public/draft filtering is done in this JS — that's enforced at the
// database level (entity_attachments' anon SELECT policy, added 2026-07-28)
// so a visitor hitting the API directly gets the same restriction the
// dashboard UI does; fetchAttachments() here returns exactly what the
// anon role is allowed to see, nothing more.
const _DASHBOARD_ATTACHMENT_DOMAIN = 'spatial_registry';

async function _loadPopupAttachmentsPublic(row) {
  const container = document.getElementById(`popup-attachments-${row.id}`);
  if (!container) return; // popup already closed before this resolved

  const { rows: attachments, error } = await fetchAttachments(row.id);
  if (error || !attachments || !attachments.length) return; // leave placeholder empty

  const chipsHtml = attachments
    .map(att => {
      const rawPath = (att.storage_path || '').trim();
      const linkCheck = validateLinkUrl(rawPath);

      let href, label;
      if (linkCheck.ok) {
        href = linkCheck.url;
        label = `🔗 ${esc(att.caption || rawPath)}`;
      } else {
        href = resolveAssetUrl(rawPath, _DASHBOARD_ATTACHMENT_DOMAIN);
        const fileName = rawPath.split('/').pop() || 'Attachment';
        label = `📎 ${esc(att.caption || fileName)}`;
      }

      // A file that fails to resolve (unrecognized extension, no domain
      // route) renders as inert text with its raw path as a tooltip, same
      // as admin-app.js's popup — never a broken/blocked href.
      return href
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:block; font-size:11px; color:var(--accent, #2f855a); text-decoration:underline; word-break:break-all; margin-bottom:2px;">${label}</a>`
        : `<span style="display:block; font-size:11px; color:#888; word-break:break-all; margin-bottom:2px;" title="${esc(rawPath)}">${label}</span>`;
    })
    .join('');

  if (!chipsHtml) return; // nothing renderable — leave placeholder empty

  // (2026-07-28) No Popup.update() call — that re-renders from whatever was
  // ORIGINALLY passed to bindPopup(), wiping this injection right back out.
  // A prior attempt at "fixing" a sizing concern this way made links
  // disappear entirely on every popup open. Reverted.
  container.innerHTML = `
    <div style="margin-top:8px; padding-top:8px; border-top:1px solid #e9ecef;">
      ${chipsHtml}
    </div>`;
}

// Ported from UNNC_GMP.html's buildGreeningPopup() — that legacy popup
// (status badge header, Project Description/Funding/WOSIP Goals sections)
// is what Sun asked to match, since these greening_zone records are the
// direct migration of that app's GREENING_PROJECTS data into spatial_registry
// (see file-header note re: greening_projects → spatial_registry, 2026-07-02).
// name/desc/status map onto real columns (title/description_notes/status);
// region/funding/area/partners/wosip have no dedicated columns yet, so this
// reads them out of metadata under a few plausible key spellings (CSV custom
// columns land under whatever the source header normalized to) rather than
// assuming one exact name. Any field genuinely missing is simply omitted —
// this never throws or shows a placeholder for data that isn't there yet.
const GREENING_STATUS_COLORS = {
  proposed: { bg: '#FFF8E1', text: '#C17D11', dot: '#C17D11' },
  funded:   { bg: '#E8F5E9', text: '#2D7A2D', dot: '#4CAF50' },
  active:   { bg: '#E3F2FD', text: '#1565C0', dot: '#2196F3' },
  complete: { bg: '#F3E5F5', text: '#6A1B9A', dot: '#9C27B0' },
};

function _firstMetaValue(meta, keys) {
  for (const k of keys) {
    if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') return meta[k];
  }
  return null;
}

// Accepts a real array, a comma/pipe/semicolon-delimited string, or nothing.
function _toList(raw) {
  if (Array.isArray(raw)) return raw.map(v => String(v).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(/[,|;]/).map(v => v.trim()).filter(Boolean);
  return [];
}

function buildGreeningPopupHtml(row) {
  const meta = getRowMetadata(row) || {};
  const status = (row.status || 'proposed').toLowerCase();
  const sc = GREENING_STATUS_COLORS[status] || GREENING_STATUS_COLORS.proposed;
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

  const name    = esc(row.title || 'Untitled Project');
  const region  = esc(_firstMetaValue(meta, ['region', 'area_label', 'zone']) || '');
  const desc    = esc(row.description_notes || '');
  const funding = esc(_firstMetaValue(meta, ['funding', 'funding_source', 'funding_status']) || '');
  const area    = esc(_firstMetaValue(meta, ['project_area', 'area', 'corridor_length']) || '');
  const partners = _toList(_firstMetaValue(meta, ['partners', 'partner_agencies'])).map(esc);
  const wosipGoals = _toList(_firstMetaValue(meta, ['wosip', 'wosip_goals']))
    .map(g => parseInt(g, 10))
    .filter(g => !isNaN(g));

  let html = `
    <div class="gp-header">
      <div class="gp-status-badge" style="background:${sc.bg};color:${sc.text}">
        <span class="gp-status-dot" style="background:${sc.dot}"></span>${statusLabel}
      </div>
      <div class="gp-title">${name}</div>
      ${region ? `<div class="gp-region">${region}</div>` : ''}
    </div>`;

  if (desc) {
    html += `
    <div class="gp-section">
      <div class="gp-sec-title">📋 Project Description</div>
      <div class="gp-desc">${desc}</div>
    </div>`;
  }

  if (funding || area || partners.length) {
    html += `<div class="gp-section"><div class="gp-sec-title">💰 Funding</div>`;
    if (funding) html += `<div class="gp-funding-line">${funding}</div>`;
    if (area) html += `<div class="gp-row"><span class="gp-row-label">Project area</span><span class="gp-row-val">${area}</span></div>`;
    if (partners.length) html += `<div class="gp-row"><span class="gp-row-label">Partners</span><span class="gp-row-val">${partners.join(', ')}</span></div>`;
    html += `</div>`;
  }

  if (wosipGoals.length) {
    html += `
    <div class="gp-section">
      <div class="gp-sec-title">🎯 WOSIP Goals</div>
      <div class="gp-goal-wrap">
        ${wosipGoals.map(g => `<span class="gp-goal-tag">Goal ${g}: ${esc(WOSIP_LABELS[g] || '')}</span>`).join('')}
      </div>
    </div>`;
  }

  return `<div class="gp-popup">${html}</div>`;
}

function statusColor(status) {
  if (!status) return '#718096';
  const s = status.toLowerCase();
  if (s === 'published') return '#2f855a';
  if (s.includes('pending') || s.includes('active')) return '#d69e2e';
  if (s === 'draft') return '#718096';
  return '#718096';
}

function statusDotColor(status) {
  if (!status) return '#CBD5E0';
  const s = status.toLowerCase();
  if (s === 'published') return '#48BB78';
  if (s.includes('pending') || s.includes('active')) return '#F6AD55';
  return '#CBD5E0';
}

/**
 * Returns true when a record should be shown. The public dashboard has no
 * status toggle anymore (the old Active/All buttons were removed — they
 * weren't producing a visible difference for reporters) — every non-draft
 * record is shown; 'draft' is filtered here as defense-in-depth alongside
 * the `.neq('status', 'draft')` query clause in loadRecords().
 */
function passesStatusFilter(row) {
  const s = (row.status || '').toLowerCase().trim();
  return s !== 'draft';
}

/**
 * Returns true when a record's individual category checkbox is currently
 * checked. Mirrors getSymbol()'s key-sanitizing so a category_value like
 * "Street Lighting" and "street_lighting" resolve to the same checkbox state.
 */
function passesCategoryFilter(row) {
  const key = String(row.category_value || '').toLowerCase().trim().replace(/ /g, '_');
  if (!CATEGORY_MAP[key]) return true; // unknown category — show it rather than hide
  return _activeCategories.has(key);
}

/**
 * Resolves a spatial_registry row's JSONB metadata, preferring `metadata`
 * (the column admin-app.js's edit drawer actively reads/writes via its
 * _editRecordMetadata merge-not-overwrite cache) and falling back to the
 * older `metadata_payload` column, same fallback order already used
 * elsewhere in the app for asset-URL/detail lookups.
 */
function getRowMetadata(row) {
  return row.metadata || row.metadata_payload || null;
}

/**
 * Dashboard-local mirror of admin-app.js's _resolveIsSensitive(): explicit
 * metadata.is_sensitive wins if set, else CATEGORY_MAP's sensitiveDefault.
 * Kept as a separate copy rather than a shared import per the existing
 * architecture constraint — dashboard-app.js never imports admin-app.js.
 */
function _resolveIsSensitive(categoryVal, explicitFlag) {
  if (typeof explicitFlag === 'boolean') return explicitFlag;
  return !!CATEGORY_MAP[categoryVal]?.sensitiveDefault;
}

/**
 * Returns true if this row's address must be omitted from public display.
 * Blanket rule (2026-07-06, simplified): ANY record resolving is_sensitive
 * true hides its address — no placeholder text, the address line is simply
 * not rendered. Deliberately uniform whether the underlying address is
 * already block-level (CSV-ingested crime data, fuzzed at ingestion by the
 * batch privacy geocoder) or still raw/exact (new public sensitive-intake
 * submissions, metadata.address_precision === 'exact') — a viewer seeing
 * "no address" can't tell which case it is, which is the point: it reads
 * as "assume approximate" uniformly rather than singling out the unreviewed
 * ones with a "withheld" label.
 *
 * SCOPE NOTE: this only affects what's rendered in the DOM. The row's real
 * reported_address and exact geom are still present in the fetched Supabase
 * payload and inspectable via devtools/network tab — actually keeping that
 * data off the wire needs server-side fuzzing (a Postgres view/RPC the anon
 * client reads instead of the raw table). Parked as a known, accepted gap
 * per 2026-07-06 discussion, not solved by this function.
 */
function _isAddressWithheld(row) {
  const meta = getRowMetadata(row) || {};
  return _resolveIsSensitive(row.category_value, meta.is_sensitive);
}

/**
 * Date-range filter for the public_safety (crime) category group, mirroring
 * the LAPD Traffic Incidents date-range control but for spatial_registry's
 * own crime records rather than the external Edge Function layer. Only
 * gates public_safety rows — everything else passes through untouched, same
 * "unrelated categories aren't affected" pattern as passesSubtypeFilter.
 * A record with no date on file passes through even when a range is set —
 * hiding it would be indistinguishable from "filtered out by date" when
 * it's really "we don't know," which is worse than just showing it.
 */
function passesCrimeDateRangeFilter(row) {
  if (CATEGORY_MAP[row.category_value]?.group !== 'public_safety') return true;
  if (!_crimeDateFrom && !_crimeDateTo) return true;
  const meta = getRowMetadata(row) || {};
  const d = meta.incident_date || meta.date || null;
  if (!d) return true;
  if (_crimeDateFrom && d < _crimeDateFrom) return false;
  if (_crimeDateTo   && d > _crimeDateTo)   return false;
  return true;
}

/**
 * Ported from JP_NIM.html's subtypeMatches(). If the row's category has no
 * active sub-toggles at all, it passes through unfiltered (sub-toggles are
 * an additional narrowing layer, not a replacement for the parent
 * category's own on/off state). If at least one sub-toggle is active for
 * that category, the row must match one of them via a case-insensitive,
 * two-way substring check against the metadata field named in
 * SUBTYPE_MATCH_FIELD (e.g. traffic → accident_type, lighting → infra_type).
 */
function passesSubtypeFilter(row) {
  const key = String(row.category_value || '').toLowerCase().trim().replace(/ /g, '_');
  const subtypes = CATEGORY_SUBTYPES[key];
  if (!subtypes) return true; // category has no sub-toggle rows at all

  const activeForCat = subtypes.filter(s => _activeSubtypes.has(key + '|' + s.value));
  if (activeForCat.length === 0) return true; // no sub-filter active — show all

  const fieldName = SUBTYPE_MATCH_FIELD[key];
  const typeField = fieldName ? getRowMetadata(row)?.[fieldName] : null;
  if (!typeField) return false; // sub-filter is active but row has no matchable field

  const typeFieldLower = String(typeField).toLowerCase();
  return activeForCat.some(s =>
    typeFieldLower.includes(s.match) || s.match.includes(typeFieldLower)
  );
}

// ─── Map initialisation ───────────────────────────────────────────────────────

function initMap() {
  _map = L.map('map', {
    center: [34.0195, -118.3222],
    zoom: 14,
    zoomControl: false,
    attributionControl: true,
  });

  _baseLayer = L.tileLayer(BASEMAP_PROVIDERS.clean, {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19,
  }).addTo(_map);

  L.control.zoom({ position: 'topright' }).addTo(_map);

  // referenceLayers pane: required because _geoEngine (map-core.js's
  // CoreMapEngine) runs headless here — .initialize() is never called on it,
  // so its own createPane() step never runs. renderBoundaryGeoJSON() hardcodes
  // `pane: 'referenceLayers'` on every layer it builds (TES choropleth, SLO/
  // UNNC boundaries), so this map instance needs the pane created directly or
  // Leaflet's getPane() returns undefined on add/remove. Must match map-core.js's
  // zIndex (395) so stacking stays below the default overlayPane (400) that
  // pins/shapes use.
  _map.createPane('referenceLayers');
  _map.getPane('referenceLayers').style.zIndex = 395;

  // Leaflet.markercluster (2026-07-06) — replaces the plain L.layerGroup so
  // records landing on the same or nearby coordinates (jittered crime
  // records sharing a block, several trees on one parkway, etc.) bubble
  // into a cluster and spiderfy apart on click instead of silently
  // stacking. Same L.LayerGroup-compatible API (clearLayers/addLayer/
  // eachLayer), so no other call site below needed to change.
  _markersLayer = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    maxClusterRadius: 50,
  }).addTo(_map);
  _shapesLayer  = L.layerGroup().addTo(_map);

  // Level 1/2 overlay channels — created once, toggled on/off via addLayer/
  // removeLayer rather than re-instantiated, so cached data survives a
  // toggle-off/toggle-on cycle.
  _parcelsLayer       = L.tileLayer(PARCELS_TILE_URL, { maxZoom: 19, minZoom: PARCELS_MIN_ZOOM, opacity: 0.85 });
  _parcelLabelsLayer  = L.layerGroup();
  _sloLayer           = L.layerGroup();
  _unncBoundaryLayer  = L.layerGroup();
  _councilDistrictsLayer     = L.layerGroup();
  _neighborhoodCouncilsLayer = L.layerGroup();
  _tesLayer           = L.layerGroup();
  _lapdLayer          = L.layerGroup();
  _windLayer          = L.layerGroup();
  _purpleairLayer     = L.layerGroup();

  _addLocateControl();
}

/**
 * Swaps the visible base tile layer (Street <-> Satellite). Assessor
 * Parcels is a separate overlay toggle (see toggleParcelsLayer) so it can
 * sit on top of either basemap rather than being mutually exclusive with it.
 */
function setBasemap(mode) {
  if (!BASEMAP_PROVIDERS[mode]) return;
  if (_baseLayer) _map.removeLayer(_baseLayer);
  _baseLayer = L.tileLayer(BASEMAP_PROVIDERS[mode], { maxZoom: 19 }).addTo(_map);
  // Parcels/boundaries/data layers were added after the base layer originally —
  // re-adding the swapped tile layer first, then bringing it to back, keeps
  // every overlay on top without having to re-add each one individually.
  _baseLayer.bringToBack();

  document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.basemap === mode);
  });
}

// ─── Parcel house-number label overlay (ported from admin-app.js, 2026-07-26) ─
//
// ⚠ DRIFT RISK — see map-core.js header note (2026-07-26). This block, plus
// the parcel tile layer and click-identify popup above/below it, is
// near-duplicated in admin-app.js instead of living in CoreMapEngine. Any
// edit here needs the matching edit in admin-app.js's equivalent block, or
// better, do the planned migration into a shared map-core.js method.
// LA County's Parcels tile layer above is a pre-rendered "single fused"
// cache — whatever LA County baked into those tile images can't be
// relabeled by us via any request parameter. This is a separate, live
// overlay: query the same Assessor layer (ASSESSOR_QUERY_URL) for parcels
// in the current viewport, and draw just the house number over each one as
// a small Leaflet label. Street names aren't included here — they're
// already visible on the basemap underneath; a bare house number is enough
// to disambiguate a parcel and stays readable at this density.
const PARCEL_LABEL_OUTFIELDS = 'SitusHouseNo';
const PARCEL_LABEL_MAX_RECORDS = 500; // client-side sanity cap — the county's own maxRecordCount already limits a single response, this just avoids rendering an unreadable wall of text if a huge viewport slips through
let _parcelLabelDebounceTimer = null;

function _buildHouseNumberIcon(houseNum) {
  return L.divIcon({
    className: '',
    html: `<div style="
             font-family:'DM Mono', monospace; font-size:10px; font-weight:600;
             color:#1a1a1a; background:rgba(255,255,255,0.82);
             padding:1px 4px; border-radius:3px; white-space:nowrap;
             transform:translate(-50%, -50%); pointer-events:none;
           ">${houseNum}</div>`,
    iconSize: [0, 0], // sized by content, anchored via the transform above
  });
}

// Rough centroid via vertex averaging — fine for label placement (doesn't
// need to be the true area centroid, just "somewhere inside the parcel").
function _ringCentroid(rings) {
  if (!rings || !rings.length) return null;
  let sumX = 0, sumY = 0, n = 0;
  for (const ring of rings) {
    for (const [x, y] of ring) { sumX += x; sumY += y; n++; }
  }
  return n ? { lat: sumY / n, lng: sumX / n } : null;
}

async function loadParcelLabels() {
  if (!_map) return;
  _parcelLabelsLayer.clearLayers();
  if (_map.getZoom() < PARCELS_MIN_ZOOM) return; // matches the tile layer's own gate — no point querying a huge extent

  const bounds = _map.getBounds();
  const params = new URLSearchParams({
    geometry:       [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(','),
    geometryType:   'esriGeometryEnvelope',
    inSR:           '4326',
    spatialRel:     'esriSpatialRelIntersects',
    outFields:      PARCEL_LABEL_OUTFIELDS,
    returnGeometry: 'true',
    outSR:          '4326',
    f:              'json',
  });

  try {
    const res = await fetch(ASSESSOR_QUERY_URL + '?' + params, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const data = await res.json();
    const feats = (data?.features || []).slice(0, PARCEL_LABEL_MAX_RECORDS);

    feats.forEach(feat => {
      const houseNum = feat.attributes?.SitusHouseNo;
      if (!houseNum) return;
      const centroid = _ringCentroid(feat.geometry?.rings);
      if (!centroid) return;
      L.marker([centroid.lat, centroid.lng], {
        icon: _buildHouseNumberIcon(houseNum),
        interactive: false, // labels are decorative — clicks still fall through to onParcelMapClick's identify
        keyboard: false,
      }).addTo(_parcelLabelsLayer);
    });
  } catch (err) {
    console.warn('[parcel labels] load failed:', err.message);
  }
}

function _scheduleParcelLabelLoad() {
  clearTimeout(_parcelLabelDebounceTimer);
  _parcelLabelDebounceTimer = setTimeout(loadParcelLabels, 400);
}

/**
 * Toggles the LA County Assessor parcel-line overlay. Gated to
 * PARCELS_MIN_ZOOM+ to avoid pulling the full county's cached tile set at
 * low zoom — an egress guard, same spirit as csv-batch-service.js's
 * block+jitter privacy geocoder being left untouched for its own reasons.
 */
function toggleParcelsLayer() {
  _parcelsActive = !_parcelsActive;
  const btn = document.getElementById('parcels-toggle-btn');
  btn?.classList.toggle('active', _parcelsActive);

  if (_parcelsActive) {
    _parcelsLayer.addTo(_map);
    _parcelLabelsLayer.addTo(_map);
    _map.on('click', onParcelMapClick);
    _map.on('moveend zoomend', _scheduleParcelLabelLoad);
    loadParcelLabels();
    if (_map.getZoom() < PARCELS_MIN_ZOOM) {
      alert(`Zoom in to at least level ${PARCELS_MIN_ZOOM} to see parcel lines.`);
    }
  } else {
    _map.removeLayer(_parcelsLayer);
    _map.removeLayer(_parcelLabelsLayer);
    _parcelLabelsLayer.clearLayers();
    _map.off('click', onParcelMapClick);
    _map.off('moveend zoomend', _scheduleParcelLabelLoad);
    clearTimeout(_parcelLabelDebounceTimer);
    closeParcelPopup();
  }
}

// ─── Assessor parcel click popup (ported from JP_NIM.html) ──────────────────
// Only active while the Assessor Parcels overlay is on (see
// toggleParcelsLayer above) — clicking the map then identifies whichever
// parcel is under the cursor via the same LA County MapServer /identify
// endpoint JP_NIM used, and shows a small fixed-position popup with the
// address, APN, and owner, matching JP_NIM's openParcelPopup/renderParcelBody.
let _parcelPopupEl = null;

function closeParcelPopup() {
  if (_parcelPopupEl) { _parcelPopupEl.remove(); _parcelPopupEl = null; }
}

async function identifyParcelAt(latlng) {
  const mapSize = _map.getSize();
  const bounds = _map.getBounds();
  const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',');

  const params = new URLSearchParams({
    geometry:       `${latlng.lng},${latlng.lat}`,
    geometryType:   'esriGeometryPoint',
    sr:             '4326',
    layers:         'all:0',
    tolerance:      '2',
    mapExtent:      bbox,
    imageDisplay:   `${mapSize.x},${mapSize.y},96`,
    returnGeometry: 'false',
    outFields:      'AIN,APN,SitusHouseNo,SitusDirection,SitusStreet,SitusCity,SitusZip,SitusFullAddress,OwnerName,UseDescription,UseType',
    f:              'json',
  });

  const res = await fetch(ASSESSOR_IDENTIFY_URL + '?' + params, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.error) { console.warn('[parcel identify] error:', data.error.message); return null; }
  const result = data.results && data.results[0];
  if (!result) return null;

  const attrs = result.attributes || {};
  const houseNum  = attrs.SitusHouseNo   || '';
  const dir       = attrs.SitusDirection ? attrs.SitusDirection + ' ' : '';
  const street    = attrs.SitusStreet    || '';
  const shortAddr = [houseNum, dir + street].filter(Boolean).join(' ').trim();
  const ain       = attrs.AIN || attrs.APN || '';

  return { shortAddr, ain, attrs, city: attrs.SitusCity || 'Los Angeles', zip: attrs.SitusZip || '' };
}

function renderParcelBody(ain, attrs) {
  const body = document.getElementById('parcel-popup-body');
  if (!body) return;

  const fmt = (v) => (v && String(v).trim()) ? String(v).trim() : null;
  const apn     = fmt(attrs.APN || attrs.AIN || ain) || ain || '—';
  // Assessor MapServer layer 0 gives both a short UseType ("Residential")
  // and a longer human-readable UseDescription ("Single Family Residence");
  // prefer the more specific one, fall back to the short one.
  const landUse = fmt(attrs.UseDescription) || fmt(attrs.UseType);
  const owner   = fmt(attrs.OwnerName);

  const row = (label, val, cls = '') => val
    ? `<div class="parcel-row"><span class="parcel-label">${esc(label)}</span><span class="parcel-value${cls ? ' ' + cls : ''}">${esc(val)}</span></div>`
    : '';

  body.innerHTML =
    row('APN', apn, 'highlight') +
    (landUse ? row('Land Use', landUse) : '') +
    (owner ? row('Owner', owner) : '') +
    `<div style="font-size:10px;color:var(--muted);padding:6px 0 2px;text-align:center">
      Full details via Assessor Record ↗
    </div>`;
}

function openParcelPopup(mouseEvent, shortAddr, city, zip, ain, attrs) {
  closeParcelPopup();

  const x = Math.max(8, Math.min(mouseEvent.clientX + 12, window.innerWidth  - 296));
  const y = Math.max(8, Math.min(mouseEvent.clientY - 20, window.innerHeight - 320));

  const el = document.createElement('div');
  el.className = 'parcel-popup';
  el.style.left = x + 'px';
  el.style.top  = y + 'px';

  const cityLine = [city, zip].filter(Boolean).join(' ');

  el.innerHTML = `
    <div class="parcel-popup-header">
      <div class="parcel-popup-addr">📋 ${esc(shortAddr || 'Unknown Address')}</div>
      ${cityLine ? `<div class="parcel-popup-city">${esc(cityLine)}</div>` : ''}
      <button type="button" class="parcel-popup-close" aria-label="Close">✕</button>
    </div>
    <div class="parcel-popup-body" id="parcel-popup-body">
      <div class="parcel-loading">Loading assessor data…</div>
    </div>
    ${ain ? `<div class="parcel-popup-footer">
      <a href="https://portal.assessor.lacounty.gov/parceldetail/${esc(ain)}" target="_blank" rel="noopener">
        Full Assessor Record ↗
      </a>
    </div>` : ''}
  `;

  document.body.appendChild(el);
  _parcelPopupEl = el;
  el.querySelector('.parcel-popup-close')?.addEventListener('click', closeParcelPopup);

  renderParcelBody(ain, attrs);
}

async function onParcelMapClick(e) {
  try {
    openParcelPopup(e.originalEvent, '…', '', '', '', {}); // loading state, shows instantly
    const info = await identifyParcelAt(e.latlng);
    if (!info) { closeParcelPopup(); return; }
    openParcelPopup(e.originalEvent, info.shortAddr, info.city, info.zip, info.ain, info.attrs);
  } catch (err) {
    console.warn('[parcel click] identify failed:', err.message);
    closeParcelPopup();
  }
}

// Close the popup when clicking anywhere outside it (JP_NIM parity).
document.addEventListener('click', (e) => {
  if (_parcelPopupEl && !_parcelPopupEl.contains(e.target)) closeParcelPopup();
});

// ─── Level 2: Boundaries (SLO / UNNC / TES) ─────────────────────────────────────
// Boundary polygons come from data-service.js's fetchBoundaries() RPC
// (get_boundaries_as_geojson). dashboard-app.js can't import data-service.js
// directly — that module pulls in js/supabase-client.js's shared client,
// which could carry an authenticated admin session if the same browser has
// admin.html open (see this file's header docstring). Calling the same RPC
// through this file's own dedicated anon `sb` client keeps that boundary
// intact while still hitting the identical database function.
async function _fetchBoundaryGeoJSON(boundaryType) {
  const { data, error } = await sb.rpc('get_boundaries_as_geojson', { filter_type: boundaryType });
  if (error) {
    console.error(`[dashboard] fetchBoundaries('${boundaryType}') fault:`, error.message);
    return null;
  }
  return data;
}

// ─── Info sheet (SLO / UNNC / TES click popups) ──────────────────────────────
// Full-screen/bottom-sheet replacement for Leaflet's bindPopup on boundary
// layers — a Leaflet popup anchored to a map pixel can get clipped by the
// map's own bounding box (reported 2026-07-04, worst near the top edge).
// This instead renders into a fixed DOM element that's always centered on
// desktop and a full-screen bottom sheet on mobile, so it's fully legible
// no matter where on the map was clicked. See map-core.js's 'sheet'
// popupTrigger mode, which calls showInfoSheet() via opts.onOpenSheet.
function showInfoSheet(html) {
  if (_isPickingReportLocation) return; // suppress boundary popups while a Report-a-Concern pin tap is armed
  const sheet = document.getElementById('info-sheet');
  const backdrop = document.getElementById('info-sheet-backdrop');
  const content = document.getElementById('info-sheet-content');
  if (!sheet || !backdrop || !content) return;
  content.innerHTML = html;
  sheet.classList.add('open');
  backdrop.classList.add('open');
}

function closeInfoSheet() {
  document.getElementById('info-sheet')?.classList.remove('open');
  document.getElementById('info-sheet-backdrop')?.classList.remove('open');
  document.querySelectorAll('.record-item').forEach(el => el.classList.remove('highlighted')); // no-op unless a marker (e.g. greening_zone) opened this sheet
}

function initInfoSheet() {
  document.getElementById('info-sheet-close')?.addEventListener('click', closeInfoSheet);
  document.getElementById('info-sheet-backdrop')?.addEventListener('click', closeInfoSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfoSheet(); });
}

/**
 * SLO officer card — ported field-for-field from JP_NIM.html's SLO popup
 * (rd, slo_name, email, cell), reordered per the 2026-07-04 ask: name up
 * top as the title, then Email, then Cell.
 */
function buildSloSheet(props) {
  const rd    = props.rd || '';
  const name  = props.slo_name || props.name || 'SLO Officer';
  const email = props.email || '';
  const cell  = props.cell || '';

  return `
    <div class="info-sheet-header" style="background:var(--accent-dim)">
      ${rd ? `<div class="info-sheet-eyebrow" style="color:var(--accent-dark)">RD ${esc(rd)}</div>` : ''}
      <div class="info-sheet-title">${esc(name)}</div>
    </div>
    <div class="info-sheet-body">
      ${email ? `<div class="info-row"><span class="info-label">Email</span><span class="info-value">${esc(email)}</span></div>` : ''}
      ${cell ? `<div class="info-row"><span class="info-label">Cell</span><span class="info-value">${esc(cell)}</span></div>` : ''}
      ${(!email && !cell) ? `<div class="info-row"><span class="info-label">No contact info on file</span></div>` : ''}
    </div>
  `;
}

async function toggleSloBoundary() {
  _sloActive = !_sloActive;
  const btn = document.querySelector('.boundary-btn[data-boundary="slo"]');
  btn?.classList.toggle('active', _sloActive);

  if (!_sloActive) { _map.removeLayer(_sloLayer); return; }

  _sloLayer.addTo(_map);
  if (_sloLayer.getLayers().length === 0) {
    const geojson = await _fetchBoundaryGeoJSON('slo');
    if (!geojson) { alert('Could not load SLO boundary data.'); _sloActive = false; btn?.classList.remove('active'); _map.removeLayer(_sloLayer); return; }
    _geoEngine.renderBoundaryGeoJSON(geojson, _sloLayer, {
      colorOverrides: SLO_BOUNDARY_COLORS,
      labelField: 'slo_name',
      popupBuilder: buildSloSheet,
      popupTrigger: 'sheet',
      onOpenSheet: showInfoSheet,
    });
  }
}

async function toggleUnncBoundary() {
  _unncBoundaryActive = !_unncBoundaryActive;
  const btn = document.querySelector('.boundary-btn[data-boundary="unnc"]');
  btn?.classList.toggle('active', _unncBoundaryActive);

  if (!_unncBoundaryActive) { _map.removeLayer(_unncBoundaryLayer); return; }

  _unncBoundaryLayer.addTo(_map);
  if (_unncBoundaryLayer.getLayers().length === 0) {
    const geojson = await _fetchBoundaryGeoJSON('unnc');
    if (!geojson) { alert('Could not load UNNC boundary data.'); _unncBoundaryActive = false; btn?.classList.remove('active'); _map.removeLayer(_unncBoundaryLayer); return; }
    _geoEngine.renderBoundaryGeoJSON(geojson, _unncBoundaryLayer, {
      colorOverrides: UNNC_BOUNDARY_COLORS,
      labelField: 'name',
      showAllProperties: true,
      popupTrigger: 'sheet',
      onOpenSheet: showInfoSheet,
      excludeFields: ['boundary_type'],
    });
  }
}

// Citywide reference boundaries (2026-07-08). labelField: 'name' is a first
// guess, same as admin-app.js's toggle handlers for these two — check the
// console.log right after fetch against your actual imported data and
// adjust if the real property name differs. showAllProperties:true means
// the info sheet still shows every field either way while that's unconfirmed.
async function toggleCouncilDistrictsBoundary() {
  _councilDistrictsActive = !_councilDistrictsActive;
  const btn = document.querySelector('.boundary-btn[data-boundary="council-districts"]');
  btn?.classList.toggle('active', _councilDistrictsActive);

  if (!_councilDistrictsActive) { _map.removeLayer(_councilDistrictsLayer); return; }

  _councilDistrictsLayer.addTo(_map);
  if (_councilDistrictsLayer.getLayers().length === 0) {
    const geojson = await _fetchBoundaryGeoJSON('council_districts');
    if (!geojson) { alert('Could not load Council Districts boundary data.'); _councilDistrictsActive = false; btn?.classList.remove('active'); _map.removeLayer(_councilDistrictsLayer); return; }
    console.log('[Council Districts] sample properties (confirm labelField matches):', geojson.features?.[0]?.properties);
    _geoEngine.renderBoundaryGeoJSON(geojson, _councilDistrictsLayer, {
      colorOverrides: COUNCIL_DISTRICT_COLORS,
      labelField: 'name', // ← confirm against the console.log above
      showAllProperties: true,
      popupTrigger: 'sheet',
      onOpenSheet: showInfoSheet,
      excludeFields: ['boundary_type'],
    });
  }
}

async function toggleNeighborhoodCouncilsBoundary() {
  _neighborhoodCouncilsActive = !_neighborhoodCouncilsActive;
  const btn = document.querySelector('.boundary-btn[data-boundary="neighborhood-councils"]');
  btn?.classList.toggle('active', _neighborhoodCouncilsActive);

  if (!_neighborhoodCouncilsActive) { _map.removeLayer(_neighborhoodCouncilsLayer); return; }

  _neighborhoodCouncilsLayer.addTo(_map);
  if (_neighborhoodCouncilsLayer.getLayers().length === 0) {
    const geojson = await _fetchBoundaryGeoJSON('neighborhood_councils');
    if (!geojson) { alert('Could not load Neighborhood Councils boundary data.'); _neighborhoodCouncilsActive = false; btn?.classList.remove('active'); _map.removeLayer(_neighborhoodCouncilsLayer); return; }
    console.log('[Neighborhood Councils] sample properties (confirm labelField matches):', geojson.features?.[0]?.properties);
    _geoEngine.renderBoundaryGeoJSON(geojson, _neighborhoodCouncilsLayer, {
      colorOverrides: NEIGHBORHOOD_COUNCIL_COLORS,
      labelField: 'name', // ← confirm against the console.log above
      showAllProperties: true,
      popupTrigger: 'sheet',
      onOpenSheet: showInfoSheet,
      excludeFields: ['boundary_type'],
    });
  }
}

/** Builds the TES sub-mode pill row (TES Score / Canopy Gap / Heat / Priority / HOLC). */
function buildTesModeRow() {
  const row = document.getElementById('tes-mode-row');
  row.innerHTML = Object.entries(TES_RAMPS).map(([mode, ramp]) => `
    <button type="button" class="tes-mode-btn${mode === _tesMode ? ' active' : ''}" data-tes-mode="${mode}">${esc(ramp.label)}</button>
  `).join('');

  row.querySelectorAll('.tes-mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      _tesMode = btn.dataset.tesMode;
      row.querySelectorAll('.tes-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (_tesActive) await _renderTes();
    });
  });
}

function renderTesLegend() {
  const el = document.getElementById('tes-legend-rows');
  const ramp = TES_RAMPS[_tesMode];
  if (!ramp) { el.classList.remove('visible'); el.innerHTML = ''; return; }
  el.innerHTML = ramp.stops.map(([threshold, color]) => {
    const label = ramp.labels?.[threshold] ?? threshold;
    return `<span class="tes-legend-chip" style="background:${color}">${esc(String(label))}</span>`;
  }).join('');
  el.classList.add('visible');
}

/**
 * TES score card — matches the 2026-07-04 target screenshot field-for-field,
 * built against the REAL unnctes.geojson properties (confirmed from an
 * actual data export, not a guess): GEOID, place, county, tes, rank,
 * rankgrpsz, treecanopy, tc_goal, tc_gap, cnpysource, temp_diff, _tot1200/
 * _veg1200/_bld1200, _tot1500/_veg1500/_bld1500, _tot1800/_veg1800/_bld1800,
 * pctpoc, pctpov, unemplrate, dep_perc, linguistic, ej_disadva, holc_grade,
 * cbg_pop, land_area (km²), biome, priority_i, _veg1200.
 *
 * Score tiers, the canopy progress bar math, the Children & Seniors field,
 * and the WOSIP goal chips are all ported verbatim from UNNC_GMP.html
 * (tesTier(), buildTESPopup(), getWOSIPGoals()) — that legacy app turned out
 * to be the actual source of truth for all of these, including WOSIP: it's
 * not a separate fetch at all, just threshold rules computed from the same
 * properties every polygon already has.
 */
const HOLC_GRADE_DESC = {
  A: 'Historically "Best" (Greenlined)',
  B: 'Historically "Still Desirable"',
  C: 'Historically "Declining"',
  D: 'Historically "Hazardous" (Redlined)',
};

function tesScoreBand(score) {
  // Ported from UNNC_GMP.html's tesTier() — the dashboard's previous 3-tier
  // version (Good 75+ / Moderate 55+ / Low) used different cutoffs than the
  // legacy app's 4-tier system, which is why the same score (e.g. 63) showed
  // as "MODERATE" here but "Below Average" there. This now matches exactly.
  const s = parseFloat(score);
  if (s == null || isNaN(s)) return { label: '—', color: '#888' };
  if (s >= 80) return { label: 'GOOD', color: '#2D7A2D' };
  if (s >= 70) return { label: 'ADEQUATE', color: '#1565C0' };
  if (s >= 60) return { label: 'BELOW AVERAGE', color: '#C17D11' };
  return { label: 'CRITICAL NEED', color: '#B71C1C' };
}

/**
 * Ported verbatim from UNNC_GMP.html's getWOSIPGoals(). This is the answer
 * to "where does the WOSIP dynamic fetch live" — it isn't a fetch at all.
 * The legacy app derives goal chips on the fly from thresholds on the same
 * TES properties every polygon already has (no separate table/layer).
 */
function getWOSIPGoals(p) {
  const goals = [];
  if (parseFloat(p.tc_gap) > 0.12) goals.push(5);
  if (parseFloat(p.temp_diff) > 1.5) goals.push(7);
  if (parseFloat(p.priority_i) > 0.5 && !goals.includes(5)) goals.push(5);
  const veg = parseFloat(p._veg1200 || 0);
  if (veg < 0.10) goals.push(3);
  if (parseFloat(p.pctpoc) > 0.8 || parseFloat(p.pctpov) > 0.2) goals.push(1);
  if (parseFloat(p.dep_perc) > 0.35) goals.push(2);
  return [...new Set(goals)];
}

function buildTesSheet(props) {
  const score    = parseFloat(props.tes);
  const band     = tesScoreBand(score);
  const place    = props.place || 'This Area';
  const geoId    = props.GEOID || '';
  const county   = props.county || '';
  const blockGrp = geoId ? geoId.slice(-6) : '';
  const pct      = (v, digits = 1) => (v == null || isNaN(v)) ? null : (Number(v) * 100).toFixed(digits) + '%';

  const row = (label, val) => (val === null || val === undefined || val === '')
    ? '' : `<div class="info-row"><span class="info-label">${esc(label)}</span><span class="info-value">${esc(String(val))}</span></div>`;

  // ── Tree Canopy ── current/goal/gap + a simple progress bar, per screenshot
  const current = parseFloat(props.treecanopy);
  const goal    = parseFloat(props.tc_goal);
  const gapPts  = (!isNaN(current) && !isNaN(goal)) ? (current - goal) * 100 : null; // negative = below goal
  let canopyBar = '';
  if (!isNaN(current) && !isNaN(goal) && goal > 0) {
    const ratio = current / goal;
    const fillPct = Math.min(100, ratio * 100);
    const barColor = ratio < 0.5 ? '#B71C1C' : ratio < 0.8 ? '#C4780A' : '#2D7A2D';
    canopyBar = `
      <div style="height:8px;border-radius:4px;background:var(--panel-border);margin:6px 0 10px;overflow:hidden">
        <div style="height:100%;width:${fillPct}%;background:${barColor};border-radius:4px"></div>
      </div>`;
  }
  const canopyTopRow = (!isNaN(current) || !isNaN(goal) || gapPts != null) ? `
    <div style="display:flex;justify-content:space-between;font-size:13px">
      ${!isNaN(current) ? `<span>Current: <strong>${pct(current, 1)}</strong></span>` : '<span></span>'}
      ${!isNaN(goal) ? `<span style="color:#2d7d32">Goal: <strong>${pct(goal, 0)}</strong></span>` : ''}
      ${gapPts != null ? `<span style="color:#C4780A">Gap: <strong>${gapPts >= 0 ? '+' : ''}${gapPts.toFixed(1)}%</strong></span>` : ''}
    </div>` : '';
  const canopySection = (canopyTopRow || props.cnpysource) ? `
    <div class="info-sheet-section">
      <div class="info-sheet-section-label">🌳 Tree Canopy</div>
      ${canopyTopRow}
      ${canopyBar}
      ${row('Canopy source', props.cnpysource)}
    </div>` : '';

  // ── Heat & Climate ──
  const temp = parseFloat(props.temp_diff);
  const heatRow = !isNaN(temp) ? row('Heat vs City Average', `${temp >= 0 ? '+' : ''}${temp.toFixed(2)}°F`) : '';
  const shadeSpec = [
    ['Noon', props._tot1200, props._veg1200, props._bld1200],
    ['3 PM', props._tot1500, props._veg1500, props._bld1500],
    ['6 PM', props._tot1800, props._veg1800, props._bld1800],
  ];
  const shadeCells = shadeSpec
    .filter(([, tot]) => tot != null)
    .map(([label, tot, veg, bld]) => `
      <div style="flex:1;background:var(--bg);border:1px solid var(--panel-border);border-radius:8px;padding:8px;text-align:center">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase">${esc(label)}</div>
        <div style="font-size:16px;font-weight:700;color:var(--text)">${pct(tot, 1)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">🌳 ${pct(veg, 1) || '—'} / 🏢 ${pct(bld, 1) || '—'}</div>
      </div>`).join('');
  const heatSection = (heatRow || shadeCells) ? `
    <div class="info-sheet-section">
      <div class="info-sheet-section-label">🌡️ Heat &amp; Climate</div>
      ${heatRow}
      ${shadeCells ? `
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-top:8px">☀️ Shade Coverage</div>
        <div style="display:flex;gap:6px;margin-top:6px">${shadeCells}</div>` : ''}
    </div>` : '';

  // ── Community Equity ──
  // "Children & Seniors" is props.dep_perc directly in the legacy app, NOT
  // child_perc + seniorperc summed (they're not the same denominator —
  // dep_perc runs noticeably higher for the same block group).
  const equityRows =
    row('People of Color', pct(props.pctpoc)) +
    row('Below Poverty Line', pct(props.pctpov)) +
    row('Unemployment Rate', pct(props.unemplrate)) +
    row('Children & Seniors', pct(props.dep_perc)) +
    row('Linguistic isolation', pct(props.linguistic));
  const epaBadge = String(props.ej_disadva).toLowerCase() === 'yes'
    ? `<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:#fdf1d6;color:#8a5a00;font-size:12px;font-weight:600">✅ EPA Disadvantaged Community (IRA)</div>` : '';
  const holcDesc = props.holc_grade ? HOLC_GRADE_DESC[String(props.holc_grade).toUpperCase()] : null;
  const holcBadge = holcDesc
    ? `<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:#fbe4e4;color:#8a1f1f;font-size:12px;font-weight:600">🏚️ HOLC Grade ${esc(String(props.holc_grade).toUpperCase())} — ${esc(holcDesc)}</div>` : '';
  const equitySection = (equityRows || epaBadge || holcBadge) ? `
    <div class="info-sheet-section">
      <div class="info-sheet-section-label">👥 Community Equity</div>
      ${equityRows}${epaBadge}${holcBadge}
    </div>` : '';

  // ── WOSIP ── dynamically computed from this feature's own properties
  // (getWOSIPGoals above) — not a separate lookup table.
  const wosipGoals = getWOSIPGoals(props);
  const wosipSection = wosipGoals.length ? `
    <div class="info-sheet-section">
      <div class="info-sheet-section-label">🎯 WOSIP Priority Goals for this area</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${wosipGoals.map(g => `<span class="goal-tag">Goal ${g}: ${esc(WOSIP_LABELS[g] || '')}</span>`).join('')}
      </div>
    </div>` : '';

  // ── Demographics ──
  const demoRows =
    row('Census population (2020)', props.cbg_pop != null ? Number(props.cbg_pop).toLocaleString() : null) +
    row('Land Area', props.land_area != null ? `${props.land_area} km²` : null) +
    row('Biome', props.biome);
  const demoSection = demoRows ? `
    <div class="info-sheet-section">
      <div class="info-sheet-section-label">📊 Demographics</div>
      ${demoRows}
    </div>` : '';

  const rankLine = (props.rank != null && props.rankgrpsz != null)
    ? `Rank ${Number(props.rank).toLocaleString()} of ${Number(props.rankgrpsz).toLocaleString()} in LA` : null;

  return `
    <div class="info-sheet-header" style="background:${band.color}22">
      <div class="info-sheet-eyebrow" style="color:${band.color}">${esc(band.label)}</div>
      <div class="info-sheet-title">${esc(place)}</div>
      ${(blockGrp || county) ? `<div class="info-sheet-subtitle">${esc([blockGrp ? `Block Group ${blockGrp}` : '', county].filter(Boolean).join(' · '))}</div>` : ''}
      ${!isNaN(score) ? `
        <div style="font-size:40px;font-weight:800;color:${band.color};margin-top:8px">${score.toFixed(0)}<span style="font-size:13px;font-weight:600;color:var(--text);margin-left:8px">Tree Equity Score</span></div>
        ${rankLine ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(rankLine)}</div>` : ''}` : ''}
    </div>
    ${canopySection}${heatSection}${equitySection}${wosipSection}${demoSection}
  `;
}

let _tesDiagnosed = false;


async function _renderTes() {
  try {
    const result = await _geoEngine.loadTesChoropleth(TES_GEOJSON_URL, TES_RAMPS, _tesMode, _tesLayer, {
      onOpenSheet: (props) => showInfoSheet(buildTesSheet(props)),
    });
    renderTesLegend();

    // One-time diagnostic: if a mode's field isn't actually present on the
    // dataset, loadTesChoropleth silently colors every polygon flat gray
    // (indistinguishable from "the button did nothing"). Log the real
    // property keys once so a naming mismatch (e.g. b_can_gap vs can_gap)
    // is obvious in devtools instead of a mystery, and gray out any
    // sub-mode button whose field genuinely isn't in this data.
    if (result && !_tesDiagnosed) {
      _tesDiagnosed = true;
      const allModes = Object.keys(TES_RAMPS);
      const missing = allModes.filter(m => !result.availableModes.includes(m));
      // _tesLayer.getLayers()[0] is the L.geoJSON wrapper (a FeatureGroup) that
      // loadTesChoropleth adds in — it has no .feature itself; drill one level
      // deeper into its sublayers to get an actual polygon feature.
      console.log('[TES] sample feature properties:', _tesLayer.getLayers()[0]?.getLayers?.()[0]?.feature?.properties);
      console.log('[TES] ramp keys expected:', allModes, '| present in data:', result.availableModes);
      if (missing.length) {
        console.warn('[TES] these ramp keys are NOT present on the geojson properties — their buttons will not recolor the map:', missing);
      }
      document.querySelectorAll('.tes-mode-btn').forEach(btn => {
        const isMissing = missing.includes(btn.dataset.tesMode);
        btn.classList.toggle('tes-mode-btn--unavailable', isMissing);
        btn.title = isMissing ? 'This field was not found on the TES dataset — check console for the real property names.' : '';
      });
    }
  } catch (err) {
    console.error('[dashboard] TES choropleth fault:', err.message);
    alert('Could not load the TES overlay.');
  }
}

async function toggleTesLayer() {
  _tesActive = !_tesActive;
  const btn = document.querySelector('.boundary-btn[data-boundary="tes"]');
  btn?.classList.toggle('active', _tesActive);
  document.getElementById('tes-mode-row').classList.toggle('visible', _tesActive);

  if (!_tesActive) {
    _map.removeLayer(_tesLayer);
    document.getElementById('tes-legend-rows').classList.remove('visible');
    return;
  }

  _tesLayer.addTo(_map);
  await _renderTes();
}

function initBoundaryUI() {
  document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.addEventListener('click', () => setBasemap(btn.dataset.basemap));
  });
  document.getElementById('parcels-toggle-btn')?.addEventListener('click', toggleParcelsLayer);

  document.querySelector('.boundary-btn[data-boundary="slo"]')?.addEventListener('click', toggleSloBoundary);
  document.querySelector('.boundary-btn[data-boundary="unnc"]')?.addEventListener('click', toggleUnncBoundary);
  document.querySelector('.boundary-btn[data-boundary="tes"]')?.addEventListener('click', toggleTesLayer);
  document.querySelector('.boundary-btn[data-boundary="council-districts"]')?.addEventListener('click', toggleCouncilDistrictsBoundary);
  document.querySelector('.boundary-btn[data-boundary="neighborhood-councils"]')?.addEventListener('click', toggleNeighborhoodCouncilsBoundary);

  buildTesModeRow();
}

// ─── "Find me" geolocation ──────────────────────────────────────────────────────

function _addLocateControl() {
  const LocateControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      const btn = L.DomUtil.create('button', 'mi-locate-btn');
      btn.type = 'button';
      btn.title = 'Find my location';
      btn.setAttribute('aria-label', 'Find my location');
      btn.innerHTML = '🎯';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', () => locateUser(true));
      return btn;
    },
  });
  new LocateControl().addTo(_map);
}

/**
 * Centers the map on the browser's geolocation and drops a "you are here"
 * marker. Also used by the Report Concern form's "Use my location" button
 * (with recenter=false there, since jumping the map while filling out a
 * form is disorienting — the pin placement is enough feedback).
 *
 * @param {boolean} recenter - whether to pan/zoom the map to the result
 * @returns {Promise<{lat:number,lng:number}|null>}
 */
function locateUser(recenter) {
  if (!navigator.geolocation) {
    alert('Location services are not available in this browser.');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        if (_userLocationMarker) _map.removeLayer(_userLocationMarker);
        _userLocationMarker = L.circleMarker([lat, lng], {
          radius: 8, color: '#fff', weight: 2, fillColor: '#2B6CB0', fillOpacity: 1,
        }).addTo(_map).bindPopup('You are here');

        if (recenter) _map.setView([lat, lng], 16, { animate: true });
        resolve({ lat, lng });
      },
      (err) => {
        console.warn('[dashboard] geolocation failed:', err.message);
        alert('Could not determine your location — check your browser/device location permissions.');
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// ─── Address search bar ──────────────────────────────────────────────────────────
// Forward-geocodes via Nominatim, mirroring the intersection-cleaning + LA
// anchor convention from admin-app.js's commitStagingBatch() address
// back-fill path, so "X and Y" style intersections resolve the same way
// here as they do in the admin console.

function initAddressSearch() {
  const toggleBtn = document.getElementById('address-search-toggle');
  const bar       = document.getElementById('address-search-bar');
  const input     = document.getElementById('address-search-input');
  const goBtn     = document.getElementById('address-search-go');
  const closeBtn  = document.getElementById('address-search-close');

  toggleBtn?.addEventListener('click', () => {
    bar.classList.toggle('open');
    if (bar.classList.contains('open')) input.focus();
  });
  closeBtn?.addEventListener('click', () => bar.classList.remove('open'));

  const runSearch = () => geocodeAndPan(input.value);
  goBtn?.addEventListener('click', runSearch);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
}

async function geocodeAndPan(rawQuery) {
  const query = (rawQuery || '').trim();
  if (!query) return;

  const result = await forwardGeocode(query);

  if (!result || result.lat == null) {
    alert(result?.reason || 'No matching address found nearby — try adding more detail (e.g. nearest cross street).');
    return;
  }

  const { lat, lng, label, precision } = result;
  const popupLabel = precision === 'exact'
    ? esc(label || query)
    : `${esc(label || query)} <span style="opacity:0.7;font-size:0.85em;">(approximate)</span>`;

  if (_searchResultMarker) _map.removeLayer(_searchResultMarker);
  _searchResultMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      html: '<div class="mi-search-pin">📍</div>',
      className: 'mi-emoji-icon-wrapper',
      iconSize: [30, 30],
      iconAnchor: [15, 28],
    }),
  }).addTo(_map).bindPopup(popupLabel).openPopup();

  _map.setView([lat, lng], 17, { animate: true });
  document.getElementById('address-search-bar').classList.remove('open');
}

// ─── Shape geometry helpers ────────────────────────────────────────────────────
// Mirrors _isShapeGeomType / _parseStoredGeometry in admin-app.js's
// renderShapeLayers() — kept in sync if that changes. Scoped to
// spatial_registry only, same as admin.

function _isShapeGeomType(geomType) {
  const t = (geomType || '').toString().toUpperCase();
  return t === 'POLYGON' || t === 'MULTIPOLYGON' || t === 'LINESTRING' || t === 'MULTILINESTRING';
}

function _parseStoredGeometry(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed?.type && parsed?.coordinates) return parsed;
  } catch (e) {
    console.warn('[_parseStoredGeometry] could not parse geom value:', raw, e);
  }
  return null;
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadOrgs() {
  const { data, error } = await sb.from('organizations').select('id, slug, display_name').order('display_name');
  if (error || !data?.length) {
    console.warn('[dashboard] Could not load organizations:', error?.message);
    return;
  }

  _orgs = {};
  data.forEach(o => { _orgs[o.slug] = o; });

  // Rebuild org tab labels from live data. Short, fixed labels via
  // ORG_SHORT_LABELS (see declaration above) — falls back to the org's
  // real display_name only if a new org shows up without an entry there,
  // so a future org addition degrades gracefully instead of breaking.
  document.querySelectorAll('.org-tab').forEach(tab => {
    const slug = tab.dataset.slug;
    if (_orgs[slug]) {
      tab.textContent = ORG_SHORT_LABELS[slug] || _orgs[slug].display_name;
      tab.title = _orgs[slug].display_name; // full legal name available on hover/long-press
    }
  });
}

async function loadRecords(orgSlug) {
  const org = _orgs[orgSlug];
  if (!org) {
    console.warn('[dashboard] Unknown org slug:', orgSlug, '— known:', Object.keys(_orgs));
    return;
  }

  setLoading(true);
  const warningEl = document.getElementById('policy-warning');

  try {
    // Fetch every non-draft record — no organization_id filtering at the
    // query level, ever. Visibility is decided entirely by the client-side
    // group-exclusivity check below (resolveVisibleGroups()), which is the
    // actual authoritative rule. The org/committee .or() clause that used to
    // live here caused a real bug: it excluded *shared*-group records
    // (traffic_infra, planning_dev, env_health, culture_comm) from an org's
    // fetch whenever that record's organization_id belonged to the *other*
    // org and its committee_slug wasn't in this org's own committee list
    // (e.g. a `planning` committee_slug row, or a NULL committee_slug per
    // SHARED_NO_COMMITTEE_GROUPS) — so those shared categories never even
    // reached the tab they were supposed to be visible under. The RLS
    // policy (`status != 'draft'`) already has no org restriction, so
    // fetching everything and filtering client-side is both simpler and
    // correct. See COMMITTEE_SLUG_ALIASES in config.js for the legacy
    // organization_id mistagging this replaces a workaround for.
    //
    // The 2026-08-16 scoped-fetch block just below adds a committee_slug
    // pre-filter for narrow VIEW_PROFILE pages ONLY — it is NOT the same
    // mechanism as the buggy org/committee filter above and doesn't
    // reintroduce that bug: it's keyed off the profile's explicit
    // visibleGroups list, not organization_id, and always includes the
    // FULL null-committee bucket (every SHARED_NO_COMMITTEE_GROUPS row)
    // whenever any shared group is visible, rather than narrowing shared
    // rows down to "this org's committees" the way the old code did.
    //
    // geom_type added alongside geom so renderShapeLayers() can tell Point
    // rows (handled by getRowCoordinates/renderMarkers) apart from
    // Polygon/LineString rows (handled by renderShapeLayers) without having
    // to inspect the parsed GeoJSON just to find out which renderer applies.
    // Paginated (2026-07-23) — see _fetchAllRows above. A plain .select()
    // here used to silently cap at 1000 rows once spatial_registry crossed
    // that count. .order() needs a tiebreaker column (id) added alongside
    // created_at: without one, rows sharing an identical created_at
    // timestamp could sort in a different relative order between pages,
    // letting .range() skip or duplicate a row at the page boundary.
    //
    // (2026-08-16) Scoped-fetch optimization: narrow-purpose VIEW_PROFILE
    // pages (JPW.html, TreeInventory.html — anything with visibleGroups set)
    // add a committee_slug pre-filter here so they don't have to download
    // every org's ENTIRE dataset just to show 2-3 groups. This was flagged
    // as the real cause of JPW.html's slow load on iPhone: the fetch above
    // was unconditionally pulling the whole spatial_registry table before
    // this change, regardless of how few groups a wrapper page actually
    // shows. See resolveCommitteeSlugsForGroups() in config.js for exactly
    // why this filters on committee_slug and not category_value (short
    // version: category_value casing is known-inconsistent in real data;
    // committee_slug is the field _resolveRowGroup() already trusts more).
    // This is a narrowing pass only — the client-side group-exclusivity
    // filter just below (resolveVisibleGroups()/_resolveRowGroup()) still
    // runs unchanged afterward as the actual authoritative rule. Plain
    // dashboard.html has no VIEW_PROFILE (_viewProfile is null there), so
    // this whole block is skipped and it keeps fetching everything exactly
    // as before.
    let queryConfigure = (q) => q.neq('status', 'draft').order('created_at', { ascending: false }).order('id', { ascending: true });
    if (_viewProfile?.visibleGroups) {
      const { slugs, includeNull } = resolveCommitteeSlugsForGroups(_viewProfile.visibleGroups);
      if (slugs.length || includeNull) {
        const orParts = [];
        if (slugs.length) orParts.push(`committee_slug.in.(${slugs.join(',')})`);
        if (includeNull) orParts.push('committee_slug.is.null');
        const orExpr = orParts.join(',');
        queryConfigure = (q) => q.neq('status', 'draft').or(orExpr).order('created_at', { ascending: false }).order('id', { ascending: true });
      }
      // slugs.length === 0 && !includeNull would mean a VIEW_PROFILE whose
      // visibleGroups resolve to nothing fetchable — leave queryConfigure at
      // its unscoped default rather than building an .or() with zero
      // conditions (which would be either a Supabase error or an
      // accidental fetch-nothing, neither of which is the intended
      // behavior for a misconfigured profile).
    }
    const { data, error } = await _fetchAllRows(
      'spatial_registry',
      'id, title, category_value, metadata, metadata_payload, committee_slug, status, reported_address, description_notes, geom, geom_type, photo_url, thumbnail_url, created_at, group_id, is_active_parent',
      queryConfigure
    );

    if (error) throw error;

    // Group-exclusivity is enforced here, client-side, as the authoritative
    // rule. This is what actually keeps Crime & Public Safety out of UNNC's
    // dashboard and Trees & Parks out of JPW's, per resolveVisibleGroups()
    // in config.js — independent of any legacy/mistagged organization_id on
    // individual rows, and independent of which org "owns" a shared-group
    // record.
    //
    // (2026-08-08) The is_active_parent === false exclusion that used to
    // live here — dropping every grouped child from _allRecords entirely —
    // has moved to applyFiltersAndRender()'s non-search branches instead.
    // Filtering it out THIS early meant children were invisible to Search
    // All Layers too, not just the map/list: _allRecords is the one shared
    // root every other view derives from, so a record excluded here could
    // never be found by name no matter what. That was never the intent —
    // the comment this replaced only ever meant to stop a duplicate pin
    // showing next to its parent during ordinary browsing, not to make
    // linked children unsearchable. See handoff (IMG 8979/8980 case).
    const visibleGroupIds = new Set(resolveVisibleGroups(orgSlug, _activeViewProfileKey));
    _allRecords = (data || []).filter(row => {
      const group = _resolveRowGroup(row);
      return !(group && !visibleGroupIds.has(group));
    });

    // Zero rows most commonly means the anon SELECT policy hasn't been
    // added yet — restore the default guidance message for that case (a
    // prior connection-error message may have overwritten it).
    if (_allRecords.length === 0) {
      warningEl.textContent = '⚠ No records visible — add an anon SELECT policy on spatial_registry in Supabase Studio.';
      warningEl.style.display = 'block';
    } else {
      warningEl.style.display = 'none';
    }

    applyFiltersAndRender({ fit: true }); // initial org load — frame the data, unlike ordinary filter toggles
  } catch (err) {
    // Real connection/query failure (network down, bad org id, RLS error,
    // etc.) — surface the actual message rather than silently showing zero
    // records with no explanation.
    console.error('[dashboard] spatial_registry fetch error:', err);
    warningEl.textContent = `⚠ Connection error: ${err.message || 'could not load records.'}`;
    warningEl.style.display = 'block';
  } finally {
    setLoading(false);
  }
}

// ─── Filtering & rendering ────────────────────────────────────────────────────

/**
 * Resolves a single [lat, lng] to measure distance from, for either a Point
 * row (getRowCoordinates already handles this) or a Polygon/LineString row
 * (no single point — uses the geometry's bounds center, letting Leaflet do
 * the actual math rather than hand-rolling a centroid calc). Returns null
 * only if the geometry is missing or unparseable.
 */
function _getRowLatLngForDistance(row) {
  const pt = getRowCoordinates(row);
  if (pt) return [pt.lat, pt.lng];

  const geom = row.geom || row.geojson_geometry || row.geometry;
  if (!geom) return null;
  let parsed = geom;
  if (typeof geom === 'string') {
    try { parsed = JSON.parse(geom); } catch (e) { return null; }
  }
  try {
    const c = L.geoJSON(parsed).getBounds().getCenter();
    return [c.lat, c.lng];
  } catch (e) { return null; } // degenerate/empty geometry
}

// Matches a row against the current search query the same way the "Search
// All Layers" dropdown does (title/notes/address/category text) — kept as
// its own function so applyFiltersAndRender() and _searchRecords() share one
// definition of "matches" rather than drifting apart.
function _passesSearchQuery(row) {
  if (!_searchQuery) return true;
  const hay = [row.title, row.description_notes, row.notes, row.reported_address, row.staged_address, row.category_value]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(_searchQuery);
}

// (2026-07-26) `fit` defaults to false — auto-fitting the viewport used to
// fire on EVERY call, including a simple category checkbox toggle (Trees &
// Parks, a subtype switch, a crime date filter), which reframed the whole
// map to fit that category's full extent and threw the user off whatever
// area they'd deliberately zoomed into. Only two call sites now opt in with
// { fit: true }: the initial per-org data load, and starting a new Search
// All Layers query (both are "take me somewhere new" actions, unlike a
// filter toggle which should leave the viewport alone). See usingRadiusFilter
// below for the pre-existing radius-mode exception, which is unaffected by
// this change and still skips fitToBounds regardless of `fit`.
function applyFiltersAndRender({ fit = false } = {}) {
  // Status-filtered but NOT yet category-filtered — used for the filter-panel
  // badge counts, so an unchecked category still shows how many records it
  // has available rather than always reading 0.
  const statusFiltered = _allRecords.filter(passesStatusFilter);

  // Grouped children (is_active_parent === false) stay out of default
  // browsing — no marker, no sidebar entry, no badge count — same as
  // before 2026-08-08's dataset-load change, just applied one step later
  // now so a search can still reach them. is_active_parent undefined
  // (pre-grouping-feature rows) still passes through, unchanged.
  const browsableFiltered = statusFiltered.filter(row => row.is_active_parent !== false);

  // Show Nearby supersedes category/subtype/date filters entirely (2026-07-08).
  // This is a discovery tool for "what's happening within 5 blocks of me" —
  // it should show every published record in range, not whatever subset the
  // sidebar happens to have checked. Filtering by distance HERE (before
  // rendering) rather than hiding markers after the fact is deliberate: the
  // previous approach rendered every published record then removed
  // out-of-radius ones from the map layer, but renderRecordList() still
  // listed the full unfiltered set — so the sidebar could list records with
  // no marker actually on the map, and clicking one tried to zoom to a
  // marker that had been detached from the layer group and rendered
  // nothing. Filtering first guarantees the list and the map are always
  // exactly the same set, and every listed record has a real marker/shape
  // to zoom to.
  let radiusCenter = null;
  if (_radiusActive && _map) {
    const c = _map.getCenter();
    radiusCenter = [c.lat, c.lng];
  }

  // A live search query takes the SAME override precedence radius already
  // has over category/subtype/date — and additionally overrides radius
  // itself. Typing "theft" into Search All Layers is a deliberate "find this
  // specific thing" request; it should never come back empty (or partial)
  // just because a category checkbox is off or the record sits outside the
  // 5-block radius ring. This also guarantees every search result has a real
  // marker/shape rendered on the map (via renderMarkers/renderShapeLayers
  // below), fixing the previous bug where a search hit outside the visible
  // layer set would zoom the map to empty space with no icon to show.
  const usingRadiusFilter = !_searchQuery && !!radiusCenter;

  if (_searchQuery) {
    // Deliberately searches `statusFiltered`, not `browsableFiltered` — a
    // search is an explicit "find this specific thing" request, and a
    // grouped child matching by name should be reachable even though it's
    // hidden during ordinary browsing. See the 2026-08-08 comments above.
    _visibleRecords = statusFiltered.filter(_passesSearchQuery);
  } else {
    _visibleRecords = usingRadiusFilter
      ? browsableFiltered.filter(row => {
          const ll = _getRowLatLngForDistance(row);
          return ll && _map.distance(ll, radiusCenter) <= RADIUS_M;
        })
      : browsableFiltered.filter(passesCategoryFilter).filter(passesSubtypeFilter).filter(passesCrimeDateRangeFilter);
  }

  const pointBounds = renderMarkers(_visibleRecords);
  const shapeBoundsList = renderShapeLayers(_visibleRecords);
  // Skip auto-fit unless the caller explicitly asked for it (fit:true — see
  // function header) OR an actual radius filter is driving the view — the
  // user deliberately panned/zoomed to "here" to see what's nearby, and
  // re-fitting bounds would fight that (fitBounds fires 'moveend', which
  // radius mode also listens on to re-filter as the user pans — auto-fitting
  // here would trigger that handler again on every render, a feedback loop).
  if (fit && !usingRadiusFilter) fitToBounds(pointBounds, shapeBoundsList);
  renderRecordList(_visibleRecords);
  updateStats(browsableFiltered);

  // Draws/updates the radius ring and sweeps the LAPD/PurpleAir overlays
  // (which aren't spatial_registry records and don't get the distance
  // pre-filter above, so they still need the old hide/show pass). Skipped
  // while a search is active — same override reasoning as above — and the
  // ring itself is cleared so it doesn't sit on screen looking like it's
  // still filtering when it isn't (see initSearchAllLayers).
  if (_radiusActive && !_searchQuery) _applyRadiusFilter();
}

/**
 * Builds an emoji-in-a-circle L.divIcon from a getSymbol() result, replacing
 * the flat colored-dot L.circleMarker look with the same icon/color language
 * used in the admin console's popups and the sidebar record list.
 */
function buildEmojiIcon(sym) {
  const size = Math.max(22, (sym.radius || 9) * 2 + 8);
  const fontSize = Math.round(size * 0.55);
  const html = `<div class="mi-emoji-marker" style="width:${size}px;height:${size}px;font-size:${fontSize}px;background:${sym.color || SYMBOL_DEFAULT.color};">${sym.icon || SYMBOL_DEFAULT.icon}</div>`;
  return L.divIcon({
    html,
    className: 'mi-emoji-icon-wrapper',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

/**
 * Renders Point-geometry records as emoji markers. Returns the array of
 * [lat, lng] pairs rendered, for the caller to fold into a combined
 * fitBounds() call alongside shape bounds (see fitToBounds).
 */
function renderMarkers(records) {
  _markersLayer.clearLayers();
  _markerById = {};

  const bounds = [];

  records.forEach(row => {
    const coords = getRowCoordinates(row);
    if (!coords) return; // Polygon/LineString rows have no single point — handled by renderShapeLayers

    bounds.push([coords.lat, coords.lng]);

    const sym = getSymbol(row.category_value, row.committee_slug);

    const marker = L.marker([coords.lat, coords.lng], { icon: buildEmojiIcon(sym) });

    // Greening Master Plan popups (header/description/funding/WOSIP goals —
    // see buildGreeningPopupHtml) are the tallest cards on the dashboard.
    // As a Leaflet bindPopup bubble anchored to the marker's pixel position,
    // that height routinely ran off the top or bottom of the map on mobile
    // with no scroll, i.e. truncated. Route these through the same
    // showInfoSheet bottom-sheet used for TES/boundary layers instead —
    // same fix, same reasoning as the 2026-07-04 boundary-popup clipping
    // issue, just applied to a marker instead of a boundary layer.
    if (row.category_value === 'greening_zone') {
      marker.on('click', () => {
        showInfoSheet(buildPopupHtml(row));
        _loadPopupChildrenPublic(row);
        _loadPopupAttachmentsPublic(row);
        document.querySelectorAll('.record-item').forEach(el => el.classList.remove('highlighted'));
        const listItem = document.querySelector(`.record-item[data-id="${row.id}"]`);
        if (listItem) {
          listItem.classList.add('highlighted');
          listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
      _markersLayer.addLayer(marker);
      _markerById[row.id] = marker;
      return;
    }

    marker.bindPopup(buildPopupHtml(row), _popupOptionsFor(row));

    // Highlight matching list item when popup opens
    marker.on('popupopen', () => {
      _loadPopupChildrenPublic(row);
      _loadPopupAttachmentsPublic(row);
      document.querySelectorAll('.record-item').forEach(el => el.classList.remove('highlighted'));
      const listItem = document.querySelector(`.record-item[data-id="${row.id}"]`);
      if (listItem) {
        listItem.classList.add('highlighted');
        listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    marker.on('popupclose', () => {
      document.querySelectorAll('.record-item').forEach(el => el.classList.remove('highlighted'));
    });

    _markersLayer.addLayer(marker);
    _markerById[row.id] = marker;
  });

  return bounds;
}

/**
 * Renders Polygon/MultiPolygon/LineString/MultiLineString spatial_registry
 * rows as styled L.geoJSON layers — previously these had no rendering path
 * at all on the public dashboard (getRowCoordinates only ever resolves
 * Point geometry). Mirrors admin-app.js's renderShapeLayers().
 *
 * Called with the already-filtered _visibleRecords on every
 * applyFiltersAndRender() pass, and always starts from clearLayers(), so a
 * shape whose category gets unchecked (or whose status no longer passes
 * the filter) is removed from the map on the very next render rather than
 * lingering behind.
 *
 * Returns the array of L.LatLngBounds for each shape rendered, so the
 * caller can fold them into one combined fitBounds() call.
 */
function renderShapeLayers(records) {
  _shapesLayer.clearLayers();

  const boundsList = [];

  records.forEach(row => {
    try {
      const geomType = row.geom_type || row.geomType;
      if (!_isShapeGeomType(geomType)) return;

      const geometry = _parseStoredGeometry(row.geom);
      if (!geometry) return;

      const sym = getSymbol(row.category_value, row.committee_slug);
      // tree_trimming_segment is the one category whose color isn't flat —
      // each segment's stroke color comes from its own fiscal_year via the
      // red(overdue)->green(recent) ramp instead of CATEGORY_MAP.color, so
      // 1,000+ segments read at a glance instead of all rendering identically.
      const shapeColor = row.category_value === 'tree_trimming_segment'
        ? getTreeTrimColor(getFiscalYearFromRow(row))
        : (sym.color || SYMBOL_DEFAULT.color);

      const layer = L.geoJSON(geometry, {
        style: { color: shapeColor, weight: 2.5, opacity: 0.85, fillColor: shapeColor, fillOpacity: 0.15 },
      });

      layer.bindPopup(buildPopupHtml(row), _popupOptionsFor(row));

      layer.on('popupopen', () => {
        _loadPopupChildrenPublic(row);
        _loadPopupAttachmentsPublic(row);
        document.querySelectorAll('.record-item').forEach(el => el.classList.remove('highlighted'));
        const listItem = document.querySelector(`.record-item[data-id="${row.id}"]`);
        if (listItem) {
          listItem.classList.add('highlighted');
          listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
      layer.on('popupclose', () => {
        document.querySelectorAll('.record-item').forEach(el => el.classList.remove('highlighted'));
      });

      _shapesLayer.addLayer(layer);
      _markerById[row.id] = layer; // record-list click needs this for both points and shapes

      const b = layer.getBounds();
      if (b && b.isValid()) boundsList.push(b);
    } catch (loopError) {
      console.error(`[renderShapeLayers] Failed to render shape for row ID: ${row?.id}`, loopError);
    }
  });

  return boundsList;
}

/**
 * Combines point-marker bounds ([lat,lng] pairs) and shape bounds
 * (L.LatLngBounds instances) into a single fitBounds() call. Doesn't jump
 * the map around if the current filter combination has nothing to show.
 */
function fitToBounds(pointBounds, shapeBoundsList) {
  const combined = L.latLngBounds([]);
  let has = false;

  pointBounds.forEach(pt => { combined.extend(pt); has = true; });
  shapeBoundsList.forEach(b => { combined.extend(b); has = true; });

  if (!has) return;

  try {
    _map.fitBounds(combined, { padding: [40, 40], maxZoom: 16, animate: true });
  } catch (e) { /* ignore fitBounds edge cases, e.g. a single identical point */ }
}

// Rendering all matched records (plus a per-item click listener each) in one
// synchronous pass was the actual cause of the dashboard hanging/freezing on
// large result sets (230 records, reported 2026-08) — not a layout bug. The
// freeze made the page unresponsive to scroll input, which read as "the
// record list dominates the sidebar and I can't reach the toggles." Fixed by
// (1) rendering in capped batches with a "Show more" button, and (2) one
// delegated click listener on the container instead of N individual ones.
const RECORD_LIST_PAGE_SIZE = 4;
let _recordListFullData = [];
let _recordListShownCount = 0;

function renderRecordList(records) {
  const countLabel = document.getElementById('list-count-label');
  countLabel.textContent = `${records.length} record${records.length !== 1 ? 's' : ''} visible`;

  _recordListFullData = records;
  _recordListShownCount = Math.min(RECORD_LIST_PAGE_SIZE, records.length);
  _renderRecordListBatch();
}

function _renderRecordListBatch() {
  const container = document.getElementById('record-list');
  const records = _recordListFullData;

  if (records.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <strong>No records match</strong>
      Try checking more category groups above.
    </div>`;
    return;
  }

  const visible = records.slice(0, _recordListShownCount);

  const itemsHtml = visible.map(row => {
    const sym      = getSymbol(row.category_value, row.committee_slug);
    const catLabel = CATEGORY_MAP[row.category_value]?.label || (row.category_value || 'Unknown');
    const addr     = _isAddressWithheld(row) ? '' : (row.reported_address || '');
    const meta     = [catLabel, addr].filter(Boolean).join(' · ');

    return `<div class="record-item" data-id="${esc(row.id)}" title="${esc(row.title || 'Untitled')}">
      <div class="record-icon">${sym.icon || '📍'}</div>
      <div class="record-info">
        <div class="record-title">${esc(row.title || 'Untitled')}</div>
        <div class="record-meta">${esc(meta)}</div>
      </div>
      <div class="record-status-dot" style="background:${statusDotColor(row.status)}"
           title="${esc(row.status || '')}"></div>
    </div>`;
  }).join('');

  const remaining = records.length - _recordListShownCount;
  const loadMoreHtml = remaining > 0
    ? `<button type="button" id="record-list-load-more" class="record-list-load-more">Show More (${remaining} remaining)</button>`
    : '';

  container.innerHTML = itemsHtml + loadMoreHtml;

  document.getElementById('record-list-load-more')?.addEventListener('click', () => {
    _recordListShownCount = Math.min(_recordListShownCount + RECORD_LIST_PAGE_SIZE, records.length);
    _renderRecordListBatch();
  });
}

// One delegated listener, set up once (see initMobileUI), instead of one
// addEventListener per record — handles clicks for whatever batch of
// .record-item elements currently exists in the container after any render.
function _handleRecordListClick(e) {
  const el = e.target.closest('.record-item');
  if (!el) return;
  const id = el.dataset.id;
  const target = _markerById[id];
  if (!target) return;

  if (typeof target.getLatLng === 'function') {
    // Point marker. Now that _markersLayer is a MarkerClusterGroup
    // (2026-07-06), the marker may currently be hidden inside a cluster
    // bubble rather than present on the map directly — a plain
    // setView+openPopup would silently do nothing in that case.
    // zoomToShowLayer zooms/spiderfies as needed first, then opens the
    // popup once the marker is actually visible.
    _markersLayer.zoomToShowLayer(target, () => target.openPopup());
  } else if (typeof target.getBounds === 'function') {
    // Polygon/LineString shape layer (an L.geoJSON FeatureGroup). Zoom
    // first — this part always worked.
    try { _map.fitBounds(target.getBounds(), { padding: [40, 40], maxZoom: 16, animate: true }); }
    catch (e) { /* ignore fitBounds edge cases, e.g. a degenerate geometry */ }

    // openPopup() on the FeatureGroup itself is a silent no-op: bindPopup
    // propagated the popup content down to each child layer individually
    // (that's why clicking the shape on the map already worked), but the
    // FeatureGroup wrapper never got its own _popup set, so calling
    // openPopup() directly on `target` here did nothing — this was the
    // actual "polygon doesn't zoom like point data" bug (the zoom itself
    // silently succeeded, but nothing else visibly happened afterward,
    // reading as "it didn't do anything"). Open the popup on the first
    // child layer instead, where bindPopup's content actually lives.
    let popupLayer = null;
    if (typeof target.eachLayer === 'function') {
      target.eachLayer(l => { if (!popupLayer) popupLayer = l; });
    }
    popupLayer?.openPopup();
  }
  closeMobileSidebar(); // no-op on desktop (classList.remove on an unopened drawer)
}

/**
 * Updates the header total, the per-group badges, and the new per-category
 * badges. Badge counts come from `statusFiltered` (status filter applied,
 * category checkboxes NOT applied) so a category shows how many records it
 * has available even while its own checkbox is unchecked — the header total
 * still reflects the fully-filtered _visibleRecords actually on the map.
 */
function updateStats(statusFiltered) {
  document.getElementById('total-count').textContent = _visibleRecords.length;

  CATEGORY_GROUPS.forEach(group => {
    const badge = document.querySelector(`.group-badge[data-group="${group.id}"]`);
    if (!badge) return;
    const count = statusFiltered.filter(r => CATEGORY_MAP[r.category_value]?.group === group.id).length;
    badge.textContent = count;
  });

  Object.keys(CATEGORY_MAP).forEach(catKey => {
    const badge = document.querySelector(`.category-badge[data-category="${catKey}"]`);
    if (!badge) return;
    const count = statusFiltered.filter(r => {
      const key = String(r.category_value || '').toLowerCase().trim().replace(/ /g, '_');
      return key === catKey;
    }).length;
    badge.textContent = count;
  });

  // Sub-toggle counts (traffic's Vehicle Collision Only, lighting's Stop
  // Sign, etc.) — counted against the parent category's own records
  // (status-filtered, not yet category/subtype-filtered), same "always
  // show what's available" rule as the category badges above.
  Object.entries(CATEGORY_SUBTYPES).forEach(([catKey, subtypes]) => {
    const fieldName = SUBTYPE_MATCH_FIELD[catKey];
    const catRecords = statusFiltered.filter(r => {
      const key = String(r.category_value || '').toLowerCase().trim().replace(/ /g, '_');
      return key === catKey;
    });
    subtypes.forEach(sub => {
      const badge = document.querySelector(`.toggle-count[data-subtype="${catKey}|${sub.value}"]`);
      if (!badge) return;
      const count = catRecords.filter(r => {
        const typeField = fieldName ? getRowMetadata(r)?.[fieldName] : null;
        if (!typeField) return false;
        const t = String(typeField).toLowerCase();
        return t.includes(sub.match) || sub.match.includes(t);
      }).length;
      badge.textContent = count;
    });
  });
}

// ─── Sidebar UI build ─────────────────────────────────────────────────────────

/**
 * Returns every CATEGORY_MAP entry belonging to a given group, as
 * { value, label, icon, color, ... } objects — value is the CATEGORY_MAP key
 * (e.g. 'tree'), everything else spreads from the CATEGORY_MAP definition.
 */
function categoriesForGroup(groupId) {
  return Object.entries(CATEGORY_MAP)
    .filter(([, def]) => def.group === groupId)
    .map(([value, def]) => ({ value, ...def }));
}

/**
 * Builds the icon-chip background used by toggle-row's .toggle-icon, from a
 * CATEGORY_MAP hex color, matching JP_NIM's rgba(...,.15) tinted-icon look.
 */
function tintFor(hexColor, alpha) {
  const hex = (hexColor || '#546e7a').replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildGroupFilters() {
  const container = document.getElementById('group-filters');
  const visibleGroupIds = new Set(resolveVisibleGroups(_activeOrgSlug, _activeViewProfileKey));

  container.innerHTML = CATEGORY_GROUPS
    .filter(group => visibleGroupIds.has(group.id))
    .map(group => {
    const cats = categoriesForGroup(group.id);
    const itemsHtml = cats.map(cat => {
      // Sub-toggle rows (JP_NIM tog-row subtype pattern) — only categories
      // present in CATEGORY_SUBTYPES get these (currently traffic, lighting).
      const subtypes = CATEGORY_SUBTYPES[cat.value] || [];
      const subtypeRows = subtypes.map(sub => `
        <div class="toggle-row sub category-subtype-row" data-parent-category="${cat.value}" data-subtype="${sub.value}">
          <div class="toggle-icon" style="background:${tintFor(cat.color, 0.10)}">${sub.icon}</div>
          <span class="toggle-label">↳ ${esc(sub.label)}</span>
          <span class="toggle-count" data-subtype="${cat.value}|${sub.value}">0</span>
          <div class="toggle-switch category-subtype-check" data-parent-category="${cat.value}" data-subtype="${sub.value}"></div>
        </div>
      `).join('');

      return `
        <div class="toggle-row category-filter-row" data-category="${cat.value}" data-group="${group.id}">
          <div class="toggle-icon" style="background:${tintFor(cat.color, 0.15)}">${cat.icon || '📍'}</div>
          <span class="toggle-label">${esc(cat.label)}</span>
          <span class="toggle-count category-badge" data-category="${cat.value}">0</span>
          <div class="toggle-switch category-check" data-category="${cat.value}" data-group="${group.id}"></div>
        </div>
        ${subtypeRows}
      `;
    }).join('');

    return `
      <div class="layer-group" data-group="${group.id}">
        <div class="layer-group-header">
          <button type="button" class="group-collapse-btn" data-group="${group.id}" aria-expanded="false" title="Expand / collapse">▸</button>
          <span class="group-label">${group.label}</span>
          <span class="group-badge" data-group="${group.id}">0</span>
        </div>
        <div class="layer-group-items collapsed" data-group="${group.id}">
          ${group.id === 'public_safety' ? `
          <div class="crime-date-filter">
            <div class="crime-date-filter-row">
              <input type="date" id="crime-date-from" value="${_crimeDateFrom || ''}">
              <span>–</span>
              <input type="date" id="crime-date-to" value="${_crimeDateTo || ''}">
            </div>
            <div class="crime-date-filter-actions">
              <button type="button" id="crime-date-apply">Apply</button>
              <button type="button" id="crime-date-clear">Clear</button>
            </div>
            ${(_crimeDateFrom || _crimeDateTo) ? `<div class="crime-date-filter-hint">Filtering crime records by date</div>` : ''}
          </div>` : ''}
          ${itemsHtml}
        </div>
      </div>
    `;
  }).join('');

  // Collapse / expand a group's item list (independent of filter state).
  container.querySelectorAll('.group-collapse-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      const itemsEl = container.querySelector(`.layer-group-items[data-group="${group}"]`);
      const collapsed = itemsEl.classList.toggle('collapsed');
      btn.textContent = collapsed ? '▸' : '▾';
      btn.setAttribute('aria-expanded', String(!collapsed));
    });
  });

  // Crime date-range filter (public_safety group only) — Apply/Clear mirror
  // the LAPD Traffic Incidents Load/Clear pattern, but filter client-side
  // over already-loaded records rather than re-fetching from an Edge
  // Function, since spatial_registry crime rows are already in _allRecords.
  // Deliberately does NOT call buildGroupFilters() again to refresh the
  // "Filtering..." hint — that would reset every group's expand/collapse
  // state back to default, which would be a worse UX regression than a
  // stale hint. The hint is updated directly instead.
  const crimeApplyBtn = document.getElementById('crime-date-apply');
  const crimeClearBtn = document.getElementById('crime-date-clear');
  const _updateCrimeDateHint = () => {
    const filterEl = document.querySelector('.crime-date-filter');
    if (!filterEl) return;
    let hintEl = filterEl.querySelector('.crime-date-filter-hint');
    const active = !!(_crimeDateFrom || _crimeDateTo);
    if (active && !hintEl) {
      hintEl = document.createElement('div');
      hintEl.className = 'crime-date-filter-hint';
      hintEl.textContent = 'Filtering crime records by date';
      filterEl.appendChild(hintEl);
    } else if (!active && hintEl) {
      hintEl.remove();
    }
  };
  if (crimeApplyBtn) {
    crimeApplyBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let the click bubble into the group-collapse toggle
      _crimeDateFrom = document.getElementById('crime-date-from').value || null;
      _crimeDateTo   = document.getElementById('crime-date-to').value || null;
      applyFiltersAndRender();
      _updateCrimeDateHint();
    });
  }
  if (crimeClearBtn) {
    crimeClearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _crimeDateFrom = null;
      _crimeDateTo   = null;
      document.getElementById('crime-date-from').value = '';
      document.getElementById('crime-date-to').value = '';
      applyFiltersAndRender();
      _updateCrimeDateHint();
    });
  }

  // Individual category toggle-switches (replaces the old checkboxes,
  // 2026-07-03 ask) — click anywhere on the row flips the switch and
  // re-renders. The group-level "toggle all" checkbox was removed
  // (2026-07-04 ask); each category is switched independently.
  container.querySelectorAll('.category-filter-row').forEach(row => {
    row.addEventListener('click', () => {
      const sw = row.querySelector('.category-check');
      const isOn = sw.classList.toggle('on');
      const cat = sw.dataset.category;
      if (isOn) _activeCategories.add(cat);
      else _activeCategories.delete(cat);
      applyFiltersAndRender();
    });
  });

  // Sub-toggle rows (traffic's Vehicle Collision Only, lighting's Stop
  // Sign, etc.) — independent of the parent category's own on/off state,
  // same relationship as JP_NIM's toggleCatSubtype() vs toggleCatLayer().
  container.querySelectorAll('.category-subtype-row').forEach(row => {
    row.addEventListener('click', () => {
      const sw = row.querySelector('.category-subtype-check');
      const isOn = sw.classList.toggle('on');
      const key = sw.dataset.parentCategory + '|' + sw.dataset.subtype;
      if (isOn) _activeSubtypes.add(key);
      else _activeSubtypes.delete(key);
      applyFiltersAndRender();
    });
  });
}

function buildOrgTabs() {
  document.querySelectorAll('.org-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.classList.contains('active')) return;
      document.querySelectorAll('.org-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _activeOrgSlug = tab.dataset.slug;
      _activeCategories = new Set(); // fresh start — the visible group set can differ per org
      _activeSubtypes = new Set();   // sub-toggle rows get rebuilt fresh below too
      buildGroupFilters(); // re-render sidebar: this org may see a different set of groups
      loadRecords(_activeOrgSlug);
      applyOrgGeofence(_activeOrgSlug);
    });
  });
}

// ─── Org geofencing ────────────────────────────────────────────────────────────
// UNNC is geofenced to the UNNC council boundary; Jefferson Park Watch is
// geofenced to the SLO (Streetscape/Landscape/Overlay committee) boundary.
// Falls back to the combined extent of whichever boundary geometry is
// available if the org-specific one fails to load, rather than leaving
// panning completely unrestricted.
const ORG_BOUNDARY_TYPE = {
  'unnc': 'unnc',
  'jefferson-park-watch': 'slo',
};

/**
 * Returns cached bounds from an already-rendered boundary layer (SLO/UNNC
 * toggle was switched on) if present, otherwise fetches just the geometry
 * needed to compute bounds — without going through _geoEngine.renderBoundaryGeoJSON,
 * so geofencing works even if the reporter never toggles that boundary on.
 */
async function _getBoundaryBounds(boundaryType) {
  const existingLayer = boundaryType === 'slo' ? _sloLayer : boundaryType === 'unnc' ? _unncBoundaryLayer : null;
  if (existingLayer && existingLayer.getLayers().length > 0) {
    try { const b = existingLayer.getBounds(); if (b.isValid()) return b; } catch (e) { /* fall through to fetch */ }
  }
  const geojson = await _fetchBoundaryGeoJSON(boundaryType);
  if (!geojson) return null;
  try {
    const b = L.geoJSON(geojson).getBounds();
    return b.isValid() ? b : null;
  } catch (e) {
    console.warn(`[dashboard] could not compute bounds for '${boundaryType}':`, e.message);
    return null;
  }
}

async function applyOrgGeofence(orgSlug) {
  const boundaryType = ORG_BOUNDARY_TYPE[orgSlug];
  let bounds = boundaryType ? await _getBoundaryBounds(boundaryType) : null;

  if (!bounds) {
    // Fall back to max extent of whatever boundary geometry we do have
    // rather than leaving panning unrestricted.
    const combined = L.latLngBounds([]);
    let has = false;
    for (const type of ['slo', 'unnc']) {
      const b = await _getBoundaryBounds(type);
      if (b) { combined.extend(b); has = true; }
    }
    bounds = has ? combined : null;
  }

  if (!bounds) { _map.setMaxBounds(null); return; }

  // Two different paddings for two different jobs:
  //  - maxBoundsPad is generous slack on every side so panning near an edge
  //    (e.g. the top of the UNNC boundary) doesn't feel like it's slamming
  //    into a wall right at the boundary line.
  //  - the fitBounds() pixel padding below actually centers the boundary in
  //    the viewport on load/org-switch, instead of leaving whatever the
  //    default center/zoom happened to be — that mismatch was the real
  //    cause of the boundary looking "clipped at the top": maxBounds alone
  //    restricts where you *can* pan to, it doesn't move the current view.
  _map.setMaxBounds(bounds.pad(0.25));
  _map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16, animate: true });
}

// ─── Mobile drawer (sidebar open/close) ────────────────────────────────────────
// On phones/small tablets #sidebar becomes a fixed off-canvas drawer (see the
// max-width: 768px media query in dashboard.html) instead of disappearing —
// this wires the hamburger button, the in-drawer close button, the backdrop,
// and auto-closes the drawer after a record tap so the map is visible again.

function openMobileSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('open');
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
}

function initMobileUI() {
  document.getElementById('mobile-filter-toggle')?.addEventListener('click', openMobileSidebar);
  document.getElementById('sidebar-close-btn')?.addEventListener('click', closeMobileSidebar);
  document.getElementById('sidebar-backdrop')?.addEventListener('click', closeMobileSidebar);
  document.getElementById('record-list')?.addEventListener('click', _handleRecordListClick);
}

// ─── Report Concern (public intake) ─────────────────────────────────────────────
// Scope (2026-07-02): Point pin + category + optional title + notes + one
// optional photo. Writes directly into spatial_registry as a status='draft'
// row via public-submission-service.js — same shape as a Field Officer
// draft, so it shows up in admin's existing table/Edit popup for review
// with no separate staging table and no new admin UI.

function buildReportCategorySelect() {
  const select = document.getElementById('report-category');
  if (!select) return;

  // Rebuilt every time this is called (not just once at boot) for
  // consistency with the org-switching pattern elsewhere, though the group
  // set itself is no longer org-filtered — see below.
  select.querySelectorAll('optgroup').forEach(og => og.remove());

  // 2026-07-30: Deliberately NOT filtered through resolveVisibleGroups()/
  // ORG_EXCLUSIVE_GROUPS here. That helper exists to decide which map
  // LAYERS an org's dashboard displays (sidebar toggles, loadRecords()) —
  // it has nothing to do with what a resident is allowed to REPORT. Using
  // it here meant a citizen viewing the JPW tab could never select a
  // Trees & Parks category (UNNC-exclusive) and vice versa, even though
  // the concern itself is perfectly real. Public intake shows every
  // category regardless of active org tab; submitPublicConcern() derives
  // committee_slug from the category itself (via GROUP_COMMITTEE_SLUG),
  // not from org-committee membership — see that file's 2026-07-30 note.
  const optgroups = CATEGORY_GROUPS
    .map(group => {
      const opts = categoriesForGroup(group.id)
        .map(cat => `<option value="${cat.value}">${cat.icon || '📍'} ${esc(cat.label)}</option>`)
        .join('');
      return `<optgroup label="${esc(group.label)}">${opts}</optgroup>`;
    }).join('');

  select.insertAdjacentHTML('beforeend', optgroups);
}

/**
 * Shows/populates the "What kind of issue is it?" subtype dropdown when the
 * chosen report category has CATEGORY_SUBTYPES entries (currently traffic
 * and lighting — includes the new Stop Sign / Crosswalk / Vehicle Collision
 * Only classes, 2026-07-04 ask), hides it otherwise. This is the only place
 * a public submission can set accident_type/infra_type, so without it the
 * new sidebar sub-toggle filters would have no real data to match against
 * for citizen-reported concerns.
 */
function updateReportSubtypeField() {
  const category = document.getElementById('report-category')?.value;
  const field = document.getElementById('report-subtype-field');
  const select = document.getElementById('report-subtype');
  if (!field || !select) return;

  const subtypes = CATEGORY_SUBTYPES[category];
  if (!subtypes || subtypes.length === 0) {
    field.style.display = 'none';
    select.innerHTML = '<option value="">Not sure / other</option>';
    return;
  }

  select.innerHTML = '<option value="">Not sure / other</option>' +
    subtypes.map(s => `<option value="${esc(s.value)}">${s.icon} ${esc(s.label)}</option>`).join('');
  field.style.display = '';
}

// The report panel now docks over part of the screen (right side on
// desktop, a bottom sheet on mobile) instead of floating centered over the
// map — nudges a freshly-placed pin into the portion of the screen that's
// still visible, in the same move as the initial setView, rather than
// dropping it dead-center where it can land right under the panel.
// Pixel-based (panBy), so it holds regardless of zoom level. Deliberately
// NOT called after a manual drag (see the marker's 'dragend' handler below)
// — once the reporter is dragging the pin themselves they can already see
// exactly where the panel is and are placing it relative to that, so
// re-centering out from under them on every drag would just be disorienting.
function _shiftMapForReportPanel() {
  if (!_map) return;
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (isMobile) {
    const sheetHeightPx = window.innerHeight * 0.46; // matches #report-modal's mobile max-height
    _map.panBy([0, Math.round(sheetHeightPx / 2)], { animate: true });
  } else {
    const panelWidthPx = Math.min(380, window.innerWidth * 0.92); // matches #report-modal's desktop width
    _map.panBy([Math.round(panelWidthPx / 2), 0], { animate: true });
  }
}

function setReportLocation(lat, lng, opts = {}) {
  _reportLatLng = { lat, lng };

  if (_reportPinMarker) _map.removeLayer(_reportPinMarker);
  _reportPinMarker = L.marker([lat, lng], {
    draggable: true,
    icon: L.divIcon({
      html: '<div class="mi-report-pin">🚩</div>',
      className: 'mi-emoji-icon-wrapper',
      iconSize: [30, 30],
      iconAnchor: [15, 28],
    }),
  }).addTo(_map);

  _reportPinMarker.on('dragend', () => {
    const ll = _reportPinMarker.getLatLng();
    _reportLatLng = { lat: ll.lat, lng: ll.lng };
    updateReportLocationStatus();
    _refreshReportAddressFromLatLng(ll.lat, ll.lng);
  });

  _map.setView([lat, lng], Math.max(_map.getZoom(), 16), { animate: true });
  _shiftMapForReportPanel();
  updateReportLocationStatus();

  // skipAddressLookup is set when the location came FROM the address field
  // itself (typed → geocoded → pin moved) — reverse-geocoding it right back
  // would just flicker the field and could overwrite the admin's own typed
  // text with a slightly different label for the same spot.
  if (!opts.skipAddressLookup) _refreshReportAddressFromLatLng(lat, lng);
}

/**
 * Reverse-geocodes lat/lng into the "Reference Street Location" field,
 * mirroring demo_dashboard.html's snapFormToPosition/address-fill behavior.
 * Only overwrites the field if it still holds our own loading placeholder —
 * if the reporter already typed something while the lookup was in flight,
 * their input wins.
 */
async function _refreshReportAddressFromLatLng(lat, lng) {
  const addressInput = document.getElementById('report-address');
  if (!addressInput) return;
  const loadingLabel = '🔍 Looking up nearest address…';
  addressInput.value = loadingLabel;
  const resolved = await reverseGeocode(lat, lng, _map);
  if (addressInput.value === loadingLabel) {
    addressInput.value = resolved || '';
  }
}

function updateReportLocationStatus() {
  const el = document.getElementById('report-location-status');
  if (!el) return;
  if (_reportLatLng) {
    el.textContent = `📍 Location set (${_reportLatLng.lat.toFixed(5)}, ${_reportLatLng.lng.toFixed(5)}) — drag the pin to fine-tune.`;
    el.classList.add('set');
  } else {
    el.textContent = 'No location set yet — use one of the buttons above.';
    el.classList.remove('set');
  }
}

function openReportModal() {
  buildReportCategorySelect();
  updateReportSubtypeField();
  document.getElementById('report-modal')?.classList.add('open');
  document.getElementById('report-modal-backdrop')?.classList.add('open');
  document.body.classList.add('report-modal-open');
  closeMobileSidebar();
}

function closeReportModal() {
  document.getElementById('report-modal')?.classList.remove('open');
  document.getElementById('report-modal-backdrop')?.classList.remove('open');
  document.body.classList.remove('report-modal-open');
  _isPickingReportLocation = false; // safety net if the reporter backs out before completing a map tap
  if (_map) _map.getContainer().style.cursor = '';
}

function resetReportForm() {
  const form = document.getElementById('report-form');
  form?.reset();
  if (form) form.style.display = '';
  const stepLocation = document.getElementById('report-step-location');
  if (stepLocation) stepLocation.style.display = '';
  document.getElementById('report-success')?.classList.remove('show');
  document.getElementById('report-error')?.classList.remove('show');
  const preview = document.getElementById('report-photo-preview');
  if (preview) preview.innerHTML = '';

  if (_reportPinMarker) { _map.removeLayer(_reportPinMarker); _reportPinMarker = null; }
  _reportLatLng = null;
  updateReportLocationStatus();
}

function initReportConcernUI() {
  buildReportCategorySelect();
  updateReportLocationStatus();

  document.getElementById('report-concern-btn')?.addEventListener('click', openReportModal);
  document.getElementById('report-category')?.addEventListener('change', updateReportSubtypeField);
  document.getElementById('report-modal-close')?.addEventListener('click', closeReportModal);
  document.getElementById('report-cancel-btn')?.addEventListener('click', closeReportModal);
  document.getElementById('report-another-btn')?.addEventListener('click', resetReportForm);

  document.getElementById('report-use-mylocation')?.addEventListener('click', async () => {
    const loc = await locateUser(false); // don't recenter — the pin placement is feedback enough
    if (loc) setReportLocation(loc.lat, loc.lng);
  });

  // "Tap map to set pin" — briefly hides the panel for an unobstructed
  // full-screen tap, then restores it. Not strictly required anymore now
  // that the panel is docked and non-blocking rather than a full-screen
  // overlay, but still nice for the one moment where the reporter is
  // aiming a tap at a specific spot.
  document.getElementById('report-pick-onmap')?.addEventListener('click', () => {
    document.getElementById('report-modal')?.classList.remove('open');
    document.getElementById('report-modal-backdrop')?.classList.remove('open');
    _map.getContainer().style.cursor = 'crosshair';
    _isPickingReportLocation = true; // arm — suppresses boundary info-sheet popups until this tap lands

    _map.once('click', (e) => {
      _map.getContainer().style.cursor = '';
      _isPickingReportLocation = false;
      setReportLocation(e.latlng.lat, e.latlng.lng);
      document.getElementById('report-modal')?.classList.add('open');
      document.getElementById('report-modal-backdrop')?.classList.add('open');
    });
  });

  // Typing/pasting an address into "Reference Street Location" and tabbing
  // away geocodes it and moves the pin to match — same shared pipeline used
  // by admin's Add Record form and the header address search bar.
  document.getElementById('report-address')?.addEventListener('change', async (e) => {
    const typed = e.target.value.trim();
    if (!typed || typed.startsWith('🔍')) return;

    const loadingLabel = '🔍 Looking up address…';
    e.target.value = loadingLabel;

    let result;
    try {
      result = await forwardGeocode(typed);
    } catch (err) {
      // forwardGeocode's own internal stages already catch their errors and
      // return null/{reason} rather than throwing — this is a last-resort
      // safety net so a genuinely unexpected failure (e.g. a network
      // condition neither stage anticipated) can't leave the field stuck
      // on the loading placeholder forever.
      console.error('[dashboard-app] address geocode failed unexpectedly:', err);
      if (e.target.value === loadingLabel) e.target.value = typed;
      alert('Address lookup failed — please try again.');
      return;
    }
    if (e.target.value !== loadingLabel) return; // reporter typed something else while this was in flight

    if (result && result.lat != null) {
      // Only replace the reporter's typed text with the geocoder's own
      // label on a precise match (Assessor parcel/interpolation, or a
      // Nominatim house-number match). A lower-confidence fallback is fine
      // for placing the pin, but relabeling the field with it silently
      // swaps an exact typed address for a vaguer one — same fix as the
      // admin Create/Edit forms.
      if (result.precision === 'exact') {
        e.target.value = result.label;
      } else {
        e.target.value = typed;
      }
      setReportLocation(result.lat, result.lng, { skipAddressLookup: true });
    } else {
      e.target.value = typed;
      alert(result?.reason || 'Address not found — try a cross-street or add "Los Angeles".');
    }
  });

  document.getElementById('report-photo')?.addEventListener('change', (e) => {
    const file = e.target.files[0] || null;
    const preview = document.getElementById('report-photo-preview');
    const errorEl = document.getElementById('report-error');
    preview.innerHTML = '';

    const validationError = validateSubmissionPhoto(file);
    if (validationError) {
      errorEl.textContent = validationError;
      errorEl.classList.add('show');
      e.target.value = '';
      return;
    }
    errorEl.classList.remove('show');

    if (file) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      preview.appendChild(img);
    }
  });

  document.getElementById('report-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('report-error');
    errorEl.classList.remove('show');

    const submitBtn = document.getElementById('report-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      const org = _orgs[_activeOrgSlug];
      const categoryValue = document.getElementById('report-category').value;
      const subtypeValue  = document.getElementById('report-subtype')?.value || '';
      const subtypeDef    = (CATEGORY_SUBTYPES[categoryValue] || []).find(s => s.value === subtypeValue);
      const metaField     = SUBTYPE_MATCH_FIELD[categoryValue];
      // Confirmed 2026-07-06: submitPublicConcern() now accepts `metadata`
      // (merged in, reserved keys untouched) and `isSensitive`.
      const metadata = (subtypeDef && metaField) ? { [metaField]: subtypeDef.label } : undefined;

      await submitPublicConcern(sb, {
        organizationId:   org?.id,
        organizationSlug: _activeOrgSlug,
        categoryValue,
        metadata,
        isSensitive:    document.getElementById('report-sensitive')?.checked || false,
        title:          document.getElementById('report-title').value,
        notes:          document.getElementById('report-notes').value,
        address:        document.getElementById('report-address').value,
        lat:            _reportLatLng?.lat,
        lng:            _reportLatLng?.lng,
        contactName:    document.getElementById('report-name').value,
        contactPhone:   document.getElementById('report-phone').value,
        contactEmail:   document.getElementById('report-email').value,
        photoFile:      document.getElementById('report-photo').files[0] || null,
      });

      document.getElementById('report-form').style.display = 'none';
      document.getElementById('report-step-location').style.display = 'none';
      document.getElementById('report-success').classList.add('show');
    } catch (err) {
      console.error('[dashboard] report submission failed:', err);
      errorEl.textContent = err.message || 'Something went wrong — please try again.';
      errorEl.classList.add('show');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Report';
    }
  });
}

// ─── LAPD Collision Reports ──────────────────────────────────────────────────
// Edge Function 'lapd-traffic' invoked directly through this file's own
// dedicated anon `sb` client — mirrors data-service.js's loadLAPDCollisions()
// exactly, but stays inside this file's client boundary (see the Boundaries
// section comment above for why data-service.js itself isn't imported here).

function _lapdAccidentType(r) {
  const codes = (r.mo_codes || '').trim().split(/\s+/).filter(Boolean);
  if (codes.includes('3001') || (r.description || '').toUpperCase().includes('FATAL')) return 'fatality';
  if (codes.some(c => ['3002', '3003', '3004', '3005', '3022'].includes(c)) ||
      (r.description || '').toUpperCase().includes('PEDESTRIAN')) return 'pedestrian';
  if (codes.includes('3016') || (r.description || '').toUpperCase().includes('BICYCLE')) return 'bicycle';
  return 'vehicle';
}

function _lapdIcon(type) {
  const cfg = LAPD_TYPE_CONFIG[type] || LAPD_TYPE_CONFIG.vehicle;
  return L.divIcon({
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${cfg.color};border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;box-shadow:0 1px 5px rgba(0,0,0,.45)">${cfg.emoji}</div>`,
    className: '', iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

// Fetches the LAPD collision dataset's TRUE known date extent (added
// 2026-07-30) — separate from and independent of whatever from/to range a
// citizen is currently searching. Populates the static "Full dataset: ..."
// caption below the dynamic per-query date-range span, so a search that
// legitimately falls in LAPD's publishing lag (this dataset was observed to
// lag well over a year as of mid-2026) reads as "the data doesn't go that
// recent yet" instead of a confusing/silent zero-record result. Fire-once
// per session — the dataset's outer bound doesn't change fast enough to be
// worth a fresh call every time the layer is toggled on, and it's a
// fire-and-forget call so it never delays the actual collision markers.
async function _loadLAPDDatasetBounds() {
  if (_lapdBoundsLoaded) return;
  _lapdBoundsLoaded = true; // set before the await — a fast double-toggle can't queue a second in-flight call

  try {
    const { data, error } = await sb.functions.invoke('lapd-traffic', { body: { mode: 'bounds' } });
    if (error) throw new Error(error.message || 'Edge Function error');

    const el = document.getElementById('lapd-data-bounds');
    if (el && data?.min_date && data?.max_date) {
      const fmt = d => { const [y, m] = d.split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };
      el.textContent = `Full dataset: ${fmt(data.min_date)} – ${fmt(data.max_date)} (LAPD publishing lag — recent collisions may not be in yet)`;
    }
  } catch (err) {
    console.warn('[dashboard] LAPD bounds fetch failed:', err.message);
    // Silent otherwise — this caption is a nice-to-have, not worth
    // surfacing an error banner over. _lapdBoundsLoaded stays true; no
    // retry mid-session, same tradeoff as everything else on this panel.
  }
}

async function loadLAPDCollisions() {
  const statusEl = document.getElementById('lapd-status');
  const hintEl   = document.getElementById('lapd-hint');

  // Egress guard: a city-wide bbox at a low zoom is the same problem the
  // parcel tiles were already gated against — skip the fetch and tell the
  // reporter to zoom in instead of pulling a huge date-range x bbox query.
  if (_map.getZoom() < LAPD_MIN_ZOOM) {
    if (statusEl) statusEl.textContent = 'zoom in to load';
    if (hintEl) { hintEl.textContent = `↑ Zoom in (level ${LAPD_MIN_ZOOM}+) to load collisions for this area`; hintEl.style.display = ''; }
    return;
  }

  if (statusEl) statusEl.textContent = 'Loading…';
  if (hintEl) hintEl.style.display = '';

  const from = _lapdDateFrom || (() => {
    const d = new Date(); d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  })();
  const to = _lapdDateTo || new Date().toISOString().slice(0, 10);

  const bounds = _map.getBounds();
  const bbox = {
    north: bounds.getNorth().toFixed(6), south: bounds.getSouth().toFixed(6),
    east: bounds.getEast().toFixed(6), west: bounds.getWest().toFixed(6),
  };

  try {
    const { data, error } = await sb.functions.invoke('lapd-traffic', { body: { from, to, ...bbox } });
    if (error) throw new Error(error.message || 'Edge Function error');

    _lapdData = (data?.records || []).map(r => ({ ...r, accidentType: _lapdAccidentType(r) }));

    const counts = { all: _lapdData.length, vehicle: 0, pedestrian: 0, bicycle: 0, fatality: 0 };
    _lapdData.forEach(r => { if (counts[r.accidentType] !== undefined) counts[r.accidentType]++; });

    const capped = (data?.count || 0) >= 800;
    if (statusEl) statusEl.textContent = capped ? `${data.count}+ (cap — zoom in)` : `${data?.count || 0} records`;

    const dates = _lapdData.map(r => r.date).filter(Boolean).sort();
    if (dates.length) {
      const fmt = d => { const [y, m] = d.split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };
      const el = document.getElementById('lapd-date-range');
      if (el) el.textContent = `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
    }

    if (capped && hintEl) {
      hintEl.textContent = '⚠ Cap hit · zoom in for deeper history';
      hintEl.style.display = '';
    } else if (hintEl) {
      hintEl.style.display = 'none';
    }

    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl('ct-lapd-all', counts.all);
    setEl('ct-lapd-vehicle', counts.vehicle);
    setEl('ct-lapd-pedestrian', counts.pedestrian);
    setEl('ct-lapd-bicycle', counts.bicycle);
    setEl('ct-lapd-fatality', counts.fatality);

    if (_lapdActive) _renderLAPDCollisions();
  } catch (err) {
    console.warn('[dashboard] LAPD fetch failed:', err.message);
    if (statusEl) statusEl.textContent = 'Unavailable';
    if (hintEl) { hintEl.textContent = '↑ Set dates & click Load'; hintEl.style.display = ''; }
  }
}

function _renderLAPDCollisions() {
  _lapdLayer.clearLayers();
  if (!_lapdActive) return;

  const activeSubs = Object.keys(_lapdSubtypeActive).filter(k => _lapdSubtypeActive[k]);
  const showAll = activeSubs.length === 0;

  _lapdData
    .filter(r => showAll || activeSubs.includes(r.accidentType))
    .forEach(r => {
      const cfg = LAPD_TYPE_CONFIG[r.accidentType] || LAPD_TYPE_CONFIG.vehicle;
      const marker = L.marker([r.lat, r.lng], { icon: _lapdIcon(r.accidentType) });
      marker.bindPopup(`
        <div class="mi-popup-card">
          <strong style="color:${cfg.color}">${cfg.emoji} ${esc(cfg.label)}</strong>
          <div class="popup-meta">${esc(r.date || '—')}</div>
          <div class="popup-meta">📍 ${esc(r.address || 'Unknown location')}</div>
          <p class="popup-notes">${esc(r.description || 'Traffic Collision')}</p>
        </div>`, { className: 'mi-popup', maxWidth: 260 });
      _lapdLayer.addLayer(marker);
    });

  if (_radiusActive) _applyRadiusFilter();
}

function toggleLAPDLayer() {
  _lapdActive = !_lapdActive;
  document.getElementById('sw-lapd-all')?.classList.toggle('on', _lapdActive);
  if (_lapdActive) {
    _lapdLayer.addTo(_map);
    _loadLAPDDatasetBounds(); // fire-and-forget, one-time per session — see fn docstring
    if (!_lapdData.length) loadLAPDCollisions(); else _renderLAPDCollisions();
  } else {
    _map.removeLayer(_lapdLayer);
  }
}

function toggleLAPDSubtype(type) {
  _lapdSubtypeActive[type] = !_lapdSubtypeActive[type];
  document.getElementById('sw-lapd-' + type)?.classList.toggle('on', _lapdSubtypeActive[type]);
  if (!_lapdActive && _lapdSubtypeActive[type]) toggleLAPDLayer();
  else _renderLAPDCollisions();
}

function applyLAPDDate() {
  _lapdDateFrom = document.getElementById('lapd-df-from').value || null;
  _lapdDateTo   = document.getElementById('lapd-df-to').value || null;
  loadLAPDCollisions();
  if (!_lapdActive) toggleLAPDLayer();
}

function clearLAPDDate() {
  _lapdDateFrom = null; _lapdDateTo = null;
  document.getElementById('lapd-df-from').value = '';
  document.getElementById('lapd-df-to').value = '';
  _lapdData = [];
  _lapdLayer.clearLayers();
  document.getElementById('lapd-status').textContent = 'cleared';
  ['ct-lapd-all', 'ct-lapd-vehicle', 'ct-lapd-pedestrian', 'ct-lapd-bicycle', 'ct-lapd-fatality']
    .forEach(id => { document.getElementById(id).textContent = '0'; });
  _lapdActive = false;
  document.getElementById('sw-lapd-all')?.classList.remove('on');
  ['vehicle', 'pedestrian', 'bicycle', 'fatality'].forEach(t => {
    _lapdSubtypeActive[t] = false;
    document.getElementById('sw-lapd-' + t)?.classList.remove('on');
  });
  if (_map.hasLayer(_lapdLayer)) _map.removeLayer(_lapdLayer);
}

function initLapdUI() {
  document.getElementById('lapd-row-all')?.addEventListener('click', toggleLAPDLayer);
  document.querySelectorAll('[data-lapd-sub]').forEach(row => {
    row.addEventListener('click', () => toggleLAPDSubtype(row.dataset.lapdSub));
  });
  document.getElementById('lapd-load-btn')?.addEventListener('click', applyLAPDDate);
  document.getElementById('lapd-clear-btn')?.addEventListener('click', clearLAPDDate);
}

// ─── Wind Flow + PurpleAir Sensors ───────────────────────────────────────────
// Wind: Open-Meteo (no key, CORS-friendly, called directly — zero Supabase
// dependency). PurpleAir: Edge Function 'purpleair-sensors', called through
// this file's own anon client's URL/key rather than importing
// data-service.js's version (same client-boundary reasoning as LAPD/boundaries).

function _aqiColorFromPm25(pm) {
  if (pm == null || isNaN(pm)) return '#aaaaaa';
  if (pm <= 12.0) return '#00e400';
  if (pm <= 35.4) return '#ffff00';
  if (pm <= 55.4) return '#ff7e00';
  if (pm <= 150.4) return '#ff0000';
  if (pm <= 250.4) return '#8f3f97';
  return '#7e0023';
}
function _aqiLabelFromPm25(pm) {
  if (pm == null || isNaN(pm)) return 'No data';
  if (pm <= 12.0) return 'Good';
  if (pm <= 35.4) return 'Moderate';
  if (pm <= 55.4) return 'Unhealthy for Sensitive Groups';
  if (pm <= 150.4) return 'Unhealthy';
  if (pm <= 250.4) return 'Very Unhealthy';
  return 'Hazardous';
}
function _compassDir(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45)];
}
function _windAnimDuration(speedMph) {
  const clamped = Math.max(0, Math.min(60, speedMph || 0));
  return (4 - (clamped / 60) * 3.2).toFixed(2) + 's';
}
function _buildWindGrid() {
  const b = _map.getBounds();
  const n = b.getNorth(), s = b.getSouth(), e = b.getEast(), w = b.getWest();
  const rows = 4, cols = 4;
  const latStep = (n - s) / (rows + 1), lngStep = (e - w) / (cols + 1);
  const pts = [];
  for (let r = 1; r <= rows; r++)
    for (let c = 1; c <= cols; c++)
      pts.push({ lat: s + latStep * r, lng: w + lngStep * c });
  return pts;
}

async function loadWindLayer() {
  const statusEl = document.getElementById('ct-wind');
  _windLayer.clearLayers();

  // Egress guard — same reasoning as parcels/LAPD: a zoomed-out grid query
  // covers a huge area for no visual gain (arrows would overlap anyway).
  if (_map.getZoom() < ENV_MIN_ZOOM) {
    if (statusEl) statusEl.textContent = 'zoom in';
    return;
  }

  if (statusEl) statusEl.textContent = '…';
  const grid = _buildWindGrid();
  const lats = grid.map(p => p.lat.toFixed(4)).join(',');
  const lngs = grid.map(p => p.lng.toFixed(4)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
              `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=mph&forecast_days=1`;

  let weatherArr;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
    const json = await res.json();
    weatherArr = Array.isArray(json) ? json : [json];
  } catch (err) {
    console.warn('[dashboard] wind fetch failed:', err.message);
    if (statusEl) statusEl.textContent = 'err';
    return;
  }

  let rendered = 0;
  weatherArr.forEach((w, i) => {
    const pt = grid[i]; if (!pt) return;
    const speed = w?.current?.wind_speed_10m;
    const dir   = w?.current?.wind_direction_10m;
    if (speed == null || dir == null) return;

    const bearing = (dir + 180) % 360;
    const duration = _windAnimDuration(speed);
    const intensity = Math.min(1, 0.3 + (speed / 30) * 0.7);
    const sz = Math.round(28 + Math.min(speed / 2, 16));
    const blueShift = Math.min(speed / 25, 1);
    const strokeColor = `rgb(${Math.round(100 + blueShift * 100)},${Math.round(160 + blueShift * 70)},220)`;

    // Rotation is a static inline transform on the wrapper (bearing never
    // animates — only the dash pattern does), so the "flow" cue reads as
    // dashes scrolling along the direction the arrow already points.
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:${sz}px;height:${sz}px;transform:rotate(${bearing}deg);opacity:${intensity.toFixed(2)};filter:drop-shadow(0 0 3px rgba(100,160,255,.55))">
        <svg width="${sz}" height="${sz}" viewBox="0 0 24 24">
          <line class="mi-wind-flow-path" x1="12" y1="22" x2="12" y2="5" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" style="animation-duration:${duration}"/>
          <polyline points="7,11 12,4 17,11" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg></div>`,
      iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
    });

    const marker = L.marker([pt.lat, pt.lng], { icon, zIndexOffset: -200 });
    marker.bindPopup(`
      <div class="mi-popup-card">
        <strong>🌬 Wind Conditions</strong>
        <div class="popup-meta">Speed: ${speed.toFixed(1)} mph</div>
        <div class="popup-meta">From: ${_compassDir(dir)} (${Math.round(dir)}°)</div>
        <div class="popup-meta">Moving toward: ${_compassDir(bearing)}</div>
      </div>`, { className: 'mi-popup', maxWidth: 240 });
    _windLayer.addLayer(marker);
    rendered++;
  });

  if (statusEl) statusEl.textContent = rendered ? rendered + ' pts' : 'no data';
}

function toggleWindLayer() {
  _windActive = !_windActive;
  document.getElementById('sw-wind')?.classList.toggle('on', _windActive);
  if (_windActive) {
    _windLayer.addTo(_map);
    loadWindLayer();
    _windMoveHandler = () => loadWindLayer();
    _map.on('moveend', _windMoveHandler);
  } else {
    _map.removeLayer(_windLayer);
    _windLayer.clearLayers();
    if (_windMoveHandler) { _map.off('moveend', _windMoveHandler); _windMoveHandler = null; }
    const s = document.getElementById('ct-wind'); if (s) s.textContent = '—';
  }
}

async function loadPurpleAirSensors() {
  const statusEl = document.getElementById('ct-purpleair');
  _purpleairLayer.clearLayers();

  // Egress guard — same reasoning as the wind grid above.
  if (_map.getZoom() < ENV_MIN_ZOOM) {
    if (statusEl) statusEl.textContent = 'zoom in';
    return;
  }

  if (statusEl) statusEl.textContent = '…';

  const b = _map.getBounds();
  const params = new URLSearchParams({
    nwlng: b.getWest().toFixed(4), nwlat: b.getNorth().toFixed(4),
    selng: b.getEast().toFixed(4), selat: b.getSouth().toFixed(4),
  });

  let data;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/purpleair-sensors?${params}`, {
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) throw new Error('Edge Function HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    console.warn('[dashboard] PurpleAir fetch failed:', err.message);
    if (statusEl) statusEl.textContent = 'err';
    return;
  }

  const fields  = data.fields || [];
  const rows    = data.data || [];
  const sensors = rows.map(row => { const obj = {}; fields.forEach((f, i) => { obj[f] = row[i]; }); return obj; });

  let rendered = 0;
  sensors.forEach(s => {
    const lat = parseFloat(s.latitude), lng = parseFloat(s.longitude);
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;

    const pm = parseFloat(s['pm2.5_60minute'] ?? s['pm2.5_10minute']);
    const color = _aqiColorFromPm25(pm);
    const label = _aqiLabelFromPm25(pm);
    const textColor = (pm <= 35.4) ? '#000' : '#fff';
    const sz = pm <= 12 ? 22 : pm <= 35.4 ? 24 : pm <= 55.4 ? 27 : 31;

    const icon = L.divIcon({
      className: '',
      html: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};color:${textColor};display:flex;align-items:center;justify-content:center;font-size:${sz <= 22 ? 8 : 9}px;font-weight:700;border:2px solid ${textColor === '#000' ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.85)'}">${isNaN(pm) ? '?' : Math.round(pm)}</div>`,
      iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
    });

    const pmDisplay = isNaN(pm) ? '—' : pm.toFixed(1);
    const sensorName = s.name || 'Sensor #' + (s.sensor_index || '');
    const marker = L.marker([lat, lng], { icon, zIndexOffset: 50 });
    marker.bindPopup(`
      <div class="mi-popup-card">
        <strong>🟣 ${esc(sensorName)}</strong>
        <div style="display:inline-block;background:${color};color:${textColor};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;margin:4px 0">${esc(label)}</div>
        <div class="popup-meta">PM2.5 (60 min avg): ${pmDisplay} µg/m³</div>
      </div>`, { className: 'mi-popup', maxWidth: 250 });
    _purpleairLayer.addLayer(marker);
    rendered++;
  });

  if (statusEl) statusEl.textContent = String(rendered);
  if (_radiusActive) _applyRadiusFilter();
}

function togglePurpleAirLayer() {
  _purpleairActive = !_purpleairActive;
  document.getElementById('sw-purpleair')?.classList.toggle('on', _purpleairActive);
  if (_purpleairActive) {
    _purpleairLayer.addTo(_map);
    loadPurpleAirSensors();
    _purpleairMoveHandler = () => loadPurpleAirSensors();
    _map.on('moveend', _purpleairMoveHandler);
  } else {
    _map.removeLayer(_purpleairLayer);
    _purpleairLayer.clearLayers();
    if (_purpleairMoveHandler) { _map.off('moveend', _purpleairMoveHandler); _purpleairMoveHandler = null; }
    const s = document.getElementById('ct-purpleair'); if (s) s.textContent = '0';
  }
}

function initEnvUI() {
  document.getElementById('wind-row')?.addEventListener('click', toggleWindLayer);
  document.getElementById('purpleair-row')?.addEventListener('click', togglePurpleAirLayer);
}

// ─── Collapsible sidebar sections (LAPD / Env) ───────────────────────────────

function initCollapsibleSections() {
  [['lapd-header', 'lapd-body'], ['env-header', 'env-body']].forEach(([headerId, bodyId]) => {
    const header = document.getElementById(headerId);
    const body   = document.getElementById(bodyId);
    const chevron = header?.querySelector('.chevron');
    header?.addEventListener('click', () => {
      const collapsed = body.classList.toggle('collapsed');
      if (chevron) chevron.textContent = collapsed ? '▸' : '▾';
    });
  });
}

// ─── Search All Layers ────────────────────────────────────────────────────────
// Searches across every currently-loaded dataset — spatial_registry records,
// loaded LAPD collisions, and loaded PurpleAir sensors. Typing a query sets
// _searchQuery and re-runs applyFiltersAndRender() (same pattern as the
// radius toggle button), which overrides category/subtype/date/radius and
// renders every matching spatial_registry record on the map — so results
// here are read back from _visibleRecords/_markerById rather than
// re-filtered from _allRecords, guaranteeing every result actually has a
// marker/shape on the map to zoom to (previously the dropdown searched
// _allRecords directly, so a match outside the checked categories or radius
// ring had no marker at all — "zooms to but no icon appears"). LAPD/
// PurpleAir aren't part of the spatial_registry hub-and-spoke render
// pipeline, so they keep their own direct jump-to-coordinates behavior.

function _searchRecords() {
  return _visibleRecords
    .slice(0, 8)
    .map(r => {
      const sym = getSymbol(r.category_value, r.committee_slug);
      return {
        icon: sym.icon || SYMBOL_DEFAULT.icon,
        title: r.title || r.label || sym.icon + ' Record',
        meta: _isAddressWithheld(r) ? '' : (r.reported_address || r.staged_address || ''),
        source: 'Record',
        onSelect: () => {
          const coords = getRowCoordinates(r);
          const layer = _markerById[r.id];
          if (layer && typeof layer.getLatLng === 'function') {
            // Point marker — may be hidden inside a cluster bubble (see the
            // record-list click handler above for the same fix/rationale).
            _markersLayer.zoomToShowLayer(layer, () => layer.openPopup());
          } else if (layer?.getBounds) {
            _map.fitBounds(layer.getBounds(), { maxZoom: 17 });
          } else if (coords) {
            _map.setView([coords.lat, coords.lng], 17, { animate: true });
          }
        },
      };
    });
}

function _searchLapd(query) {
  if (!_lapdActive || !_lapdData.length) return [];
  return _lapdData
    .filter(r => (r.address || '').toLowerCase().includes(query) || (r.description || '').toLowerCase().includes(query))
    .slice(0, 5)
    .map(r => {
      const cfg = LAPD_TYPE_CONFIG[r.accidentType] || LAPD_TYPE_CONFIG.vehicle;
      return {
        icon: cfg.emoji,
        title: r.address || cfg.label,
        meta: r.date || '',
        source: 'LAPD',
        onSelect: () => _map.setView([r.lat, r.lng], 17, { animate: true }),
      };
    });
}

function runSearchAllLayers(rawQuery) {
  const query = (rawQuery || '').trim().toLowerCase();
  const resultsEl = document.getElementById('search-all-results');

  // Search is mutually exclusive with Show Nearby — starting a search turns
  // radius fully off (state, ring, moveend listener, button) rather than
  // leaving _radiusActive true and relying on render-time checks alone,
  // which is what let the LAPD/PurpleAir refresh handlers keep redrawing
  // the ring underneath the search. See _deactivateRadiusFilter.
  if (query && _radiusActive) _deactivateRadiusFilter();

  // Drives the map/record-list the same way toggling radius does. Runs even
  // when query is empty so clearing the search box restores normal
  // category filtering rather than leaving the map stuck on the last search.
  _searchQuery = query;
  applyFiltersAndRender({ fit: !!query }); // non-empty query = jump to results; clearing the box just restores normal filtering in place

  if (!query) { resultsEl.innerHTML = ''; return; }

  const results = [..._searchRecords(), ..._searchLapd(query)];

  if (results.length === 0) {
    resultsEl.innerHTML = `<div class="search-all-empty">No matches in currently loaded layers.</div>`;
    return;
  }

  resultsEl.innerHTML = results.map((r, i) => `
    <div class="search-result-item" data-idx="${i}">
      <span class="search-result-icon">${r.icon}</span>
      <span class="search-result-text">
        <div class="search-result-title">${esc(r.title)}</div>
        ${r.meta ? `<div class="search-result-meta">${esc(r.meta)}</div>` : ''}
      </span>
      <span class="search-result-source">${esc(r.source)}</span>
    </div>
  `).join('');

  resultsEl.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => {
      results[Number(el.dataset.idx)].onSelect();
    });
  });
}

function initSearchAllLayers() {
  const input = document.getElementById('search-all-input');
  let debounceTimer = null;
  input?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearchAllLayers(input.value), 200);
  });
}

// ─── Show Nearby (5-block radius) ────────────────────────────────────────────
// Ported from admin-app.js's _applyRadiusFilter/_testAndHideRadiusLayer —
// see that file for the original comments. Adapted here to also sweep the
// LAPD, wind, and PurpleAir layer groups, all of which hold L.marker
// instances directly (same shape as _markersLayer), so one shared
// eachLayer() pass style covers every overlay this dashboard has.

function _testAndHideRadiusLayer(layer, parent, center) {
  let lat = null, lng = null;
  try {
    if (layer.getLatLng) {
      const ll = layer.getLatLng();
      lat = ll.lat; lng = ll.lng;
    } else if (layer.getBounds) {
      const c = layer.getBounds().getCenter();
      lat = c.lat; lng = c.lng;
    }
  } catch (e) { /* layer has neither — skip it */ }

  if (lat == null || !_map) return;
  if (_map.distance([lat, lng], center) > RADIUS_M) {
    parent.removeLayer(layer);
    _radiusHidden.set(layer, parent);
  }
}

function _applyRadiusFilter() {
  if (!_radiusActive || !_map) return;
  const center = _map.getCenter();

  if (_radiusCircle) _map.removeLayer(_radiusCircle);
  _radiusCircle = L.circle([center.lat, center.lng], {
    radius: RADIUS_M, color: '#5B7A47', weight: 2,
    fillColor: '#5B7A47', fillOpacity: 0.05, dashArray: '6 4',
  }).addTo(_map);

  // spatial_registry markers/shapes are no longer swept here — they're
  // pre-filtered by distance in applyFiltersAndRender() itself (2026-07-08),
  // which is what keeps the sidebar list and the map in sync (see that
  // function's comment). Only LAPD/PurpleAir still use the old hide/show
  // pass, since they're synthetic overlay data outside spatial_registry and
  // don't go through that pre-filter.
  if (_radiusHidden.size > 0) {
    _radiusHidden.forEach((parent, layer) => {
      try { parent.addLayer(layer); } catch (e) { /* stale parent — nothing to restore it into */ }
    });
    _radiusHidden.clear();
  }

  if (_lapdActive) _lapdLayer.eachLayer(marker => _testAndHideRadiusLayer(marker, _lapdLayer, center));
  if (_purpleairActive) _purpleairLayer.eachLayer(marker => _testAndHideRadiusLayer(marker, _purpleairLayer, center));
}

// Turns radius filtering off: unbinds the moveend re-filter, removes the
// ring, un-toggles the button, and restores anything the LAPD/PurpleAir
// sweep-based hide/show pass had hidden. Factored out of toggleRadiusFilter
// so a search can call this directly (see runSearchAllLayers) — this is
// what makes Search and Show Nearby genuinely either-or at the STATE level,
// not just at render time. The previous render-time-only skip (checking
// _searchQuery inside applyFiltersAndRender/_applyRadiusFilter callers) left
// _radiusActive itself sitting true while a search ran, so anything else
// that independently calls _applyRadiusFilter() when _radiusActive is true —
// the LAPD and PurpleAir re-render functions both do this on their own
// refresh cycles — kept redrawing the ring underneath the search, which is
// the "ring persists / click-off doesn't work" glitch. (2026-07-09 fix)
function _deactivateRadiusFilter() {
  _radiusActive = false;
  document.getElementById('nearby-toggle-btn')?.classList.remove('active');
  _map.off('moveend', applyFiltersAndRender);
  if (_radiusCircle) { _map.removeLayer(_radiusCircle); _radiusCircle = null; }
  _radiusHidden.forEach((parent, layer) => {
    try { parent.addLayer(layer); } catch (e) { /* stale parent — nothing to restore it into */ }
  });
  _radiusHidden.clear();
}

function toggleRadiusFilter() {
  if (_radiusActive) {
    _deactivateRadiusFilter();
    applyFiltersAndRender();
    return;
  }

  // Turning radius ON is mutually exclusive with an active search — clear
  // it first so the two features never end up fighting over which one is
  // driving the map (same either-or as the search-input handler below).
  if (_searchQuery) {
    const input = document.getElementById('search-all-input');
    if (input) input.value = '';
    _searchQuery = '';
    const resultsEl = document.getElementById('search-all-results');
    if (resultsEl) resultsEl.innerHTML = '';
  }

  _radiusActive = true;
  document.getElementById('nearby-toggle-btn')?.classList.add('active');
  // applyFiltersAndRender() reads _radiusActive to decide whether to use
  // the full published set (radius on) or the category/subtype/date
  // -filtered set (radius off) — see that function. Calling it here means
  // toggling either direction switches the underlying record set
  // immediately, not just what's hidden/shown by the ring.
  applyFiltersAndRender();
  // Bound to applyFiltersAndRender (not _applyRadiusFilter directly) so
  // panning the map re-filters spatial_registry records against the new
  // center, not just redraws the ring in place. Safe from a feedback
  // loop because applyFiltersAndRender() skips fitToBounds() while radius
  // mode is active — panning fires 'moveend' → re-filter/re-render, but
  // that render doesn't itself move the map again.
  _map.on('moveend', applyFiltersAndRender);
}

function initNearbyUI() {
  document.getElementById('nearby-toggle-btn')?.addEventListener('click', toggleRadiusFilter);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function setLoading(on) {
  document.getElementById('loading-indicator').style.display = on ? 'block' : 'none';
  if (on) document.getElementById('total-count').textContent = '…';
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Maps a VIEW_PROFILE's defaultBoundary string to the toggle function that
// already exists for it — reusing the same functions the boundary buttons
// call, not new activation logic, so this can't drift out of sync with them.
const _BOUNDARY_TOGGLE_FNS = {
  'slo': toggleSloBoundary,
  'unnc': toggleUnncBoundary,
  'tes': toggleTesLayer,
  'council-districts': toggleCouncilDistrictsBoundary,
  'neighborhood-councils': toggleNeighborhoodCouncilsBoundary,
};

async function boot() {
  // Must run before initBoundaryUI() (which calls buildTesModeRow() and
  // reads _tesMode to mark the initially-active mode button) and before the
  // defaultBoundary toggle further down (which calls toggleTesLayer() ->
  // _renderTes(), also reading _tesMode). If a profile doesn't set
  // defaultTesMode, _tesMode keeps its 'tes' (TES Score) module-level
  // default from where it's declared above.
  if (_viewProfile?.defaultTesMode) _tesMode = _viewProfile.defaultTesMode;

  initMap();
  buildGroupFilters();
  buildOrgTabs();
  initMobileUI();
  initAddressSearch();
  initBoundaryUI();
  initLapdUI();
  initEnvUI();
  initCollapsibleSections();
  initInfoSheet();
  initSearchAllLayers();
  initNearbyUI();
  initReportConcernUI();

  if (_viewProfile?.lockOrg) {
    document.getElementById('org-tabs').style.display = 'none';
  }

  await loadOrgs();
  await loadRecords(_activeOrgSlug);
  applyOrgGeofence(_activeOrgSlug); // don't block first paint on the boundary fetch

  if (_viewProfile?.defaultBoundary) {
    const toggleFn = _BOUNDARY_TOGGLE_FNS[_viewProfile.defaultBoundary];
    if (toggleFn) toggleFn();
    else console.warn('[dashboard] VIEW_PROFILE defaultBoundary has no matching toggle function:', _viewProfile.defaultBoundary);
  }
}

boot().catch(err => console.error('[dashboard] boot failed:', err));
