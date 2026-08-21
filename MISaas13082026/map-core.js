/**
 * map-core.js
 * Core Modular Spatial Mapping Engine
 * Mapping Innovations Enterprise Framework
 *
 * ── MODULE BOUNDARY / ANTI-DRIFT NOTE (2026-07-26) ─────────────────────────
 * admin-app.js and dashboard-app.js both render a Leaflet map, but they are
 * separate ES6 modules with separate map instances (admin fully initializes
 * CoreMapEngine via .initialize(); dashboard runs it "headless" — see that
 * file's own header comment — and builds its own L.map directly). Nothing
 * enforces that a map FEATURE added to one also reaches the other. This is
 * not hypothetical: the LA County Assessor parcel-tile overlay, click-to-
 * identify popup, and house-number label overlay were all written directly
 * inside admin-app.js (2026-07-22) as page-local functions instead of
 * CoreMapEngine methods, and dashboard-app.js silently had none of it until
 * a 2026-07-26 manual port caught the gap.
 *
 * BEFORE adding any new map layer/overlay/interaction (to admin-app.js OR
 * dashboard-app.js), stop and check:
 *   1. Does this belong in CoreMapEngine as a shared method instead of a
 *      page-local function? If the logic doesn't depend on page-specific DOM
 *      IDs, it almost certainly does — pull it in here, not into either app.
 *   2. If it DOES need page-specific wiring (e.g. a toggle button ID that
 *      only exists on one page), still put the reusable core (fetch/render/
 *      style logic) in a CoreMapEngine method, and leave only the DOM
 *      wiring/toggle handler in the app file.
 *   3. If you add something directly to admin-app.js or dashboard-app.js
 *      anyway (time pressure, one-off), leave a comment at that call site
 *      naming the other app file explicitly, so a future grep for that
 *      feature name actually surfaces the gap instead of looking "handled."
 *   4. Known current gap, deliberately not yet fixed (needs a dedicated,
 *      full-context session — do not attempt as a drive-by edit): the
 *      Assessor parcel tile layer + click-identify popup + house-number
 *      labels still live as near-duplicate code in BOTH admin-app.js and
 *      dashboard-app.js rather than as CoreMapEngine methods. Migrating
 *      them here is the next planned step.
 * ─────────────────────────────────────────────────────────────────────────
 */
// Asset safety utilities — enforces the universal image URL protection matrix
// across all popup and sidebar rendering paths in map-core.js.
// resolveAssetUrl() returns null for slugs, domains, and HTML routes,
// preventing any browser resource request from firing against non-image strings.
import { resolveAssetUrl, resolveRowThumb } from './asset-url-resolver.js';

export class CoreMapEngine {
  constructor(elementId, { center = [34.0254, -118.3182], zoom = 15, theme = {} } = {}) {
    this.elementId = elementId;
    
    this.spatialOptions = {
      center: center,
      zoom: zoom,
      // (2026-07-27) Bumped 19 -> 21 for tree-survey placement precision —
      // admins need to place pins to the individual-tree/block-face level,
      // and 19 wasn't tight enough. Neither basemap provider actually has
      // native tile imagery this close in (see BASEMAP_NATIVE_ZOOM below),
      // so this relies on Leaflet's overzoom (maxNativeZoom) to stretch the
      // last real tile rather than requesting non-existent ones — the base
      // map gets softer at 20-21, but pins/parcels/labels stay crisp
      // (vector-drawn, not raster), which is what actually matters for
      // placement accuracy.
      maxZoom: 21
    };

    // Real native tile resolution per basemap provider — deliberately LOWER
    // than spatialOptions.maxZoom above. Passed as each tileLayer's
    // maxNativeZoom so Leaflet auto-scales the last available tile past
    // this point instead of requesting tiles that 404/come back blank.
    // CartoDB Positron confirmed native up to z20; ArcGIS World_Imagery's
    // free/public endpoint is inconsistent above z19 depending on region
    // (LA metro has 0.3m Maxar coverage but the tile cache itself caps
    // lower), so z19 is the safe floor there.
    this.BASEMAP_NATIVE_ZOOM = { clean: 20, satellite: 19 };

    this.ctx = {
        theme: {
            accent: theme.accent || '#5B7A47',
            blue: theme.blue || '#2B6CB0',
            bg: theme.bg || '#FFFFFF',
            panel: theme.panel || '#F7FAFC'
        }
    };

    this.map = null;
    this.baseLayer = null;
    this.layerChannels = {};
  }

  /**
   * Orchestrates base layer initialization and applies universal UI tokens
   */
  initialize() {
    this._injectUnifiedDesignTokens();

    this.map = L.map(this.elementId, {
      center: this.spatialOptions.center,
      zoom: this.spatialOptions.zoom,
      zoomControl: false,
      attributionControl: true
    });

    // Reference/background layers (TES choropleth, SLO/UNNC boundaries) live
    // in this pane at a lower zIndex than Leaflet's default overlayPane
    // (400), which pins and spatial_registry shapes use implicitly. Without
    // this, z-order was purely "whichever layer got added to the map most
    // recently" — and boundary layers are lazy-added on first checkbox
    // toggle, i.e. always AFTER pins/shapes are added at boot. That put
    // boundaries on top both visually and for click hit-testing, so a shape
    // polygon under an active SLO/UNNC boundary was visible but unclickable.
    // A fixed lower pane makes the stacking order correct no matter what
    // order things get toggled on in.
    this.map.createPane('referenceLayers');
    this.map.getPane('referenceLayers').style.zIndex = 395;

    // Default to clean, low-density CartoDB Positron canvas to ensure high data readability
    this.baseLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: this.spatialOptions.maxZoom,
      maxNativeZoom: this.BASEMAP_NATIVE_ZOOM.clean
    }).addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);
    return this.map;
  }

  /**
   * Switches baseline map context dynamically (e.g., Vector Canvas vs High-Res Satellite Imagery)
   * @param {string} mode - 'clean' | 'satellite'
   */
  setBasemapMode(mode) {
    const providers = {
      clean: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    };

    if (providers[mode]) {
      this.map.removeLayer(this.baseLayer);
      this.baseLayer = L.tileLayer(providers[mode], {
        maxZoom: this.spatialOptions.maxZoom,
        maxNativeZoom: this.BASEMAP_NATIVE_ZOOM[mode]
      });
      this.baseLayer.addTo(this.map);
    }
  }

  /**
   * Creates or returns an isolated Layer Group channel.
   * Keeps disparate datasets (e.g., tree pins vs. crime reports) from bleeding together.
   * @param {string} channelKey 
   */
  getLayerChannel(channelKey) {
    if (!this.layerChannels[channelKey]) {
      this.layerChannels[channelKey] = L.layerGroup().addTo(this.map);
    }
    return this.layerChannels[channelKey];
  }
/**
   * Clears a specific channel and renders new GeoJSON-like rows as interactive markers.
   * Uses buildSafePopupHtml() so that every popup thumbnail passes through the
   * asset safety gate — slugs, domains, and HTML routes never become img.src values.
   *
   * @param {Array}  rows       - Row objects from fetchSpatialData / Supabase query
   * @param {string} channelKey - Layer channel key to update (e.g., 'registry-data')
   * @param {object} [opts]     - Optional: { titleField, notesField, categoryField }
   */
  renderData(rows, channelKey = 'registry-data', opts = {}) {
    const channel = this.getLayerChannel(channelKey);
    channel.clearLayers();

    const {
      titleField    = 'title',
      notesField    = 'description_notes',
      categoryField = 'category_value',
    } = opts;

    rows.forEach(row => {
      // Support both flat lat/lng columns and GeoJSON Point geometry
      const lat = row.lat ?? row.latitude;
      const lng = row.lng ?? row.longitude;
      if (lat == null || lng == null) return;

      const marker = this.createInteractivePoint([lat, lng], {
        fillColor: this.ctx.theme.accent,
      });

      marker.feature = { properties: { category: row[categoryField] } };

      // buildSafePopupHtml() applies the full image safety gate — no raw strings
      // from the database ever reach an <img src="..."> without passing validation
      marker.bindPopup(
        this.buildSafePopupHtml(row, { titleField, notesField }),
        { className: 'mi-popup' }
      );

      channel.addLayer(marker);
    });
  }

  /**
   * Builds a safe Leaflet popup HTML string for a database row.
   *
   * This is the canonical popup builder for the MI platform. Every rendering
   * site — admin-app.js, dashboard.html, and any future portal — should call
   * this method (or the equivalent buildPopupContent() in admin-app.js which
   * uses the same _resolveThumbUrl logic) rather than constructing popup HTML
   * inline. Inline construction is where raw DB strings leak into img.src.
   *
   * IMAGE SAFETY GUARANTEE
   * ─────────────────────
   * resolveRowThumb() is called on the row before any <img> tag is emitted.
   * If it returns null (slug, domain, HTML route, UUID without extension, etc.),
   * no <img> element is included — a neutral placeholder is rendered instead.
   * The onerror attribute is included as a secondary net for edge cases where
   * the URL passes validation but the storage object has been deleted.
   *
   * @param  {object} row           - Raw database row
   * @param  {object} [opts]
   * @param  {string} [opts.titleField='title']           - Row field for the popup title
   * @param  {string} [opts.notesField='description_notes'] - Row field for the body text
   * @param  {number} [opts.maxNoteLength=100]            - Truncation limit for notes
   * @returns {string} Safe HTML string suitable for Leaflet's bindPopup()
   */
  buildSafePopupHtml(row, opts = {}) {
    if (!row) return '<div class="mi-popup-empty">No data</div>';

    const {
      titleField    = 'title',
      notesField    = 'description_notes',
      maxNoteLength = 100,
    } = opts;

    // ── Escape helper — prevents XSS from raw DB text in popup labels ─────
    const esc = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    };

    // ── Thumbnail ──────────────────────────────────────────────────────────
    // resolveRowThumb() walks all standard fields + metadata JSONB and returns
    // a safe absolute URL, or null. If null, we render no <img> at all.
    const thumbUrl = resolveRowThumb(row);

    const title  = esc(row[titleField] || row.label || row.name || row.species_common || 'Record');
    const status = esc(row.status || row.phase_status || '');
    const notes  = esc(row[notesField] || row.notes || '');
    const addr   = esc(row.reported_address || row.staged_address || '');

    let html = `<div class="mi-popup-card" style="font-size:12px;max-width:260px;font-family:sans-serif;color:#333;">`;

    if (thumbUrl) {
      // URL has already been validated by resolveRowThumb() — safe to emit.
      // onerror hides the img if the storage object was deleted after validation.
      //html += `<div style="margin-bottom:8px;text-align:center;border-radius:6px;overflow:hidden;border:1px solid #ddd;max-height:130px;background:#f5f5f5;">
      //  <img src="${thumbUrl}" alt="preview"
      //       style="max-width:100%;max-height:130px;display:block;margin:0 auto;object-fit:cover;cursor:pointer;"
      //       onclick="window.open('${thumbUrl}','_blank')"
      //       onerror="this.style.display='none'"/>
      //</div>`;

      // AVOID EGRESS -- Extract trailing file segment for clear desktop row identification 
  const fileName = thumbUrl.split('/').pop() || 'View Attached Asset';
  html += `
    <div style="margin-bottom:8px; padding:6px; background:#F4F1EB; border:1px dashed var(--border); border-radius:6px; font-size:11px;">
      <span style="color:var(--muted); display:block; margin-bottom:2px; font-family:'DM Mono', monospace; font-size:9px; text-transform:uppercase;">📷 Media File Linked:</span>
      <a href="${thumbUrl}" target="_blank" style="color:var(--accent); font-weight:600; text-decoration:underline; word-break:break-all;" title="Database source path: ${thumbUrl}">
        ${esc(fileName)}
      </a>
      </div>`;

    }

    html += `<strong>${title}</strong>`;
    if (status) html += `<br/><small style="color:#666;">Status: ${status}</small>`;
    if (addr)   html += `<br/><small style="color:#888;">${addr}</small>`;

    if (notes) {
      const short = notes.length > maxNoteLength
        ? `${notes.substring(0, maxNoteLength - 3)}…`
        : notes;
      html += `<p style="margin:4px 0;color:#555;font-size:11px;line-height:1.4;">${short}</p>`;
    }

    html += `</div>`;
    return html;
  }
  
  /**
   * Deterministic fallback color generator for per-feature boundary coloring.
   * The same name string always hashes to the same color, so a boundary
   * dataset gets stable, visually-distinct colors with zero manual config —
   * see renderBoundaryGeoJSON()'s colorOverrides option and config.js'
   * SLO_BOUNDARY_COLORS (manual overrides take priority over this when set).
   * @param {string} str - e.g. feature.properties.name
   * @returns {string|null} an hsl() color string, or null if str is empty
   * @private
   */
  _hashColorFor(str) {
    if (!str) return null;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    // Fixed sat/light keeps every auto-color in the same muted family as the
    // rest of the map's design tokens, instead of going neon/garish.
    return `hsl(${hue}, 52%, 48%)`;
  }

  /**
   * Standardized Boundary/Choropleth Polygon Styler
   * @param {string} fillColor - Hex token or variable reference
   * @param {number} opacity - Decimal scale fill visibility
   */
  getPolygonStyle(fillColor, opacity = 0.2) {
    return {
      fillColor: fillColor,
      weight: 1.5,
      opacity: 1,
      color: '#D8D3C7', // Neutral crisp boundary line divider
      fillOpacity: opacity
    };
  }

  /**
   * Generates a sleek, modern UI circle marker instead of bulky native Leaflet asset pins
   * @param {Array} latlng - [Latitude, Longitude]
   * @param {Object} styleOpts - Custom coloration configurations
   */
  createInteractivePoint(latlng, styleOpts = {}) {
    return L.circleMarker(latlng, {
      radius: styleOpts.radius || 7,
      fillColor: styleOpts.fillColor || this.ctx.theme.accent,
      color: styleOpts.strokeColor || '#FFFFFF',
      weight: styleOpts.weight || 1.5,
      fillOpacity: styleOpts.fillOpacity || 0.85
    });
  }

  /**
   * Strict CSS injection to enforce font synchronization and color rules across all client portals.
   * Eliminates system micro-typography tracking variations between browsers.
   * @private
   */
  _injectUnifiedDesignTokens() {
    const theme = this.ctx.theme;
    if (document.getElementById('mi-core-tokens')) return;

    const structuralStyle = document.createElement('style');
    structuralStyle.id = 'mi-core-tokens';
    structuralStyle.innerHTML = `
      :root {
        --accent: ${theme.accent} !important;
        --blue: ${theme.blue} !important;
        --bg: ${theme.bg} !important;
        --panel: ${theme.panel} !important;
      }
      body, html, input, select, button, textarea, table {
        font-family: 'DM Sans', system-ui, -apple-system, sans-serif !important;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      .leaflet-popup-content-wrapper {
        border-radius: 8px !important;
        box-shadow: 0 4px 16px rgba(0,0,0,0.08) !important;
      }
    `;
    document.head.appendChild(structuralStyle);
  }
  /**
   * Filters features based on the layer toggle sidebar.
   * @param {Array} allowedSubtypes - Array of active category strings
   * @param {string} channelKey - The layer channel containing your data pins
   */
  filterFeatures(allowedSubtypes, channelKey) {
    const channel = this.layerChannels[channelKey];
    if (!channel) return;

    channel.eachLayer(layer => {
      // Assumes your feature data is attached to the layer upon creation
      const featureSubtype = layer.feature?.properties?.category; 
      if (!featureSubtype) return;

      if (allowedSubtypes.includes(featureSubtype)) {
        if (!this.map.hasLayer(layer)) {
          this.map.addLayer(layer);
        }
      } else {
        if (this.map.hasLayer(layer)) {
          this.map.removeLayer(layer);
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 🌿 TES CHOROPLETH ENGINE
  // Ported from dashboard.html's TES rendering logic so admin.html and
  // dashboard.html share one implementation instead of two copies that can
  // silently drift apart. Parameterized on `ramps` + `targetLayerGroup`
  // rather than hardcoding TES_RAMPS/global map state.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Resolves a fill color for a single feature value against a ramp.
   *
   * (2026-08-16) The minVal/maxVal interpolation branch below is no longer
   * reached from loadTesChoropleth() — that call site now deliberately
   * passes null/null so every mode falls through to the fixed-threshold
   * loop at the bottom instead (Sun's call: coloring should reflect each
   * ramp's authored absolute thresholds, not a per-load relative gradient
   * that can contradict an absolute-threshold info card for the same
   * field). Left in place, not deleted, in case a genuinely-relative view
   * is wanted somewhere on purpose later — if you're re-wiring this back
   * in, make sure whatever calls it also has an absolute-threshold
   * reference (like a badge) that agrees with it, or don't.
   * @private
   */
  _tesColorFor(value, mode, ramps, minVal, maxVal) {
    const ramp = ramps[mode];
    if (!ramp || value == null) return '#cccccc';

    if (mode === 'holc_grade') {
      const holcMap = { 'A': '#4dac26', 'B': '#fee08b', 'C': '#f46d43', 'D': '#d73027' };
      return holcMap[String(value).trim().toUpperCase()] || '#aaaaaa';
    }

    const v = parseFloat(value);
    if (isNaN(v)) return '#cccccc';

    if (minVal != null && maxVal != null && maxVal > minVal) {
      const t      = (v - minVal) / (maxVal - minVal);
      const stops  = ramp.stops;
      const n      = stops.length;
      const scaled = t * (n - 1);
      const lo     = Math.min(Math.floor(scaled), n - 2);
      const hi     = lo + 1;
      const frac   = scaled - lo;
      return this._lerpHex(stops[lo][1], stops[hi][1], frac);
    }

    for (const [threshold, color] of ramp.stops) {
      if (v <= threshold) return color;
    }
    return ramp.stops[ramp.stops.length - 1][1];
  }

  /** Linearly interpolate between two hex colors. @private */
  _lerpHex(hex1, hex2, t) {
    const parse = h => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
    const [r1, g1, b1] = parse(hex1);
    const [r2, g2, b2] = parse(hex2);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /**
   * Fetches (and caches per-URL) a GeoJSON choropleth source, then renders
   * it into `targetLayerGroup` colored by `mode` against `ramps[mode].stops`.
   * Clears any prior contents of targetLayerGroup first, so calling this
   * again with a different mode re-colors the same layer group in place.
   *
   * @param {string} geojsonUrl       - e.g. config.js TES_GEOJSON_URL
   * @param {object} ramps            - e.g. config.js TES_RAMPS
   * @param {string} mode             - ramp key, e.g. 'tes'
   * @param {L.LayerGroup} targetLayerGroup - layer group to render into
   * @param {object} [opts]
   * @param {Function} [opts.onOpenSheet] - (properties, mode) => void. When
   *   given, clicking a polygon calls this instead of (in addition to) the
   *   lightweight hover tooltip — for dashboard.html's full-screen TES info
   *   card (2026-07-04 ask), which needs the raw properties object to build
   *   its own richer layout rather than a single label/value tooltip line.
   * @param {boolean} [opts.hoverTooltip=true] - set false to skip the sticky
   *   mouseover tooltip entirely (admin.html: panning across many polygons
   *   was popping tooltips constantly, so it's click-only there — the hover
   *   highlight style still applies, just without the tooltip box).
   * @param {number} [opts.fillOpacity=0.55] - base fill opacity. Lower this
   *   (e.g. 0.25-0.3) to bring a choropleth layer visually in line with a
   *   renderBoundaryGeoJSON() outline layer like SLO (default 0.08), which
   *   reads much lighter at its default than this function's old hardcoded
   *   0.55.
   * @param {number} [opts.hoverFillOpacity=0.78] - fill opacity on mouseover.
   *   Keep this noticeably higher than opts.fillOpacity so the hover
   *   highlight still reads as a highlight once the base opacity is lowered.
   * @returns {Promise<{layer: L.GeoJSON, minVal: number|null, maxVal: number|null, availableModes: string[]}|null>}
   *   minVal/maxVal are null for 'holc_grade' (string lookup, no numeric range).
   *   availableModes lists which ramps keys actually exist on this dataset's
   *   properties — lets a caller build mode-switch buttons without guessing.
   */
  async loadTesChoropleth(geojsonUrl, ramps, mode, targetLayerGroup, opts = {}) {
    // (2026-08-19) fillOpacity/hoverFillOpacity now configurable per-caller —
    // was hardcoded 0.55/0.78 below, which made CES/TES/HOLC read much
    // heavier than renderBoundaryGeoJSON()'s SLO outline (fillOpacity 0.08
    // default). Defaults here match the old hardcoded values so any caller
    // not passing these (e.g. admin.html, if it doesn't opt in) renders
    // identically to before.
    const { fillOpacity = 0.55, hoverFillOpacity = 0.78 } = opts;

    this._geojsonCache = this._geojsonCache || {};

    let geojson = this._geojsonCache[geojsonUrl];
    if (!geojson) {
      const res = await fetch(geojsonUrl);
      if (!res.ok) throw new Error(`TES fetch HTTP ${res.status}`);
      geojson = await res.json();
      this._geojsonCache[geojsonUrl] = geojson;
    }

    targetLayerGroup.clearLayers();

    const ramp = ramps[mode];
    let minVal = null, maxVal = null;
    if (mode !== 'holc_grade') {
      geojson.features.forEach(f => {
        const v = parseFloat(f.properties?.[mode]);
        if (!isNaN(v)) {
          if (minVal === null || v < minVal) minVal = v;
          if (maxVal === null || v > maxVal) maxVal = v;
        }
      });
    }

    const layer = L.geoJSON(geojson, {
      pane: 'referenceLayers',
      style: (feature) => ({
        // (2026-08-16) Deliberately pass null/null here, NOT the minVal/
        // maxVal computed above. Passing them used to make _tesColorFor()
        // take its min-max interpolation branch, which stretches the full
        // color gradient across whatever's the lowest/highest value
        // CURRENTLY LOADED rather than the fixed thresholds authored in
        // config.js's ramp.stops — meaning "red" meant "relatively lowest
        // in this view" instead of "actually a bad value," which could
        // directly contradict the absolute-threshold info card badge
        // (tesScoreBand() in dashboard-app.js) for the exact same field,
        // and actively broke temp_diff's diverging-at-zero design (real
        // min/max aren't symmetric around 0, so 0°F didn't land at the
        // ramp's middle color). Sun's call: accuracy to the data's actual
        // absolute meaning over maximizing on-screen contrast — forcing
        // null/null here always takes the fixed-threshold loop at the
        // bottom of _tesColorFor instead. minVal/maxVal are still computed
        // and returned below (some caller may want the informational
        // range), just no longer fed into the color decision itself.
        fillColor:   this._tesColorFor(feature.properties?.[mode], mode, ramps, null, null),
        fillOpacity,
        color:       '#ffffff',
        weight:      0.6,
        opacity:     0.7,
      }),
      onEachFeature: (feature, lyr) => {
        const val   = feature.properties?.[mode];
        const label = ramp?.label || mode;
        const displayVal = mode === 'holc_grade'
          ? String(val ?? '—').toUpperCase()
          : mode === 'tc_gap'
          ? (val != null ? `${(Number(val) * 100).toFixed(1)}%` : '—')
          : (val != null ? Number(val).toFixed(1) : '—');

        // (2026-08-21) Optional per-call tooltip override — BHUWC/UVI wants
        // "Area Name (Category)" on hover instead of the generic
        // "Urban Vulnerability Index: 19.0" this function shows by default.
        // TES/CES don't pass opts.tooltipHtml, so they're unaffected — same
        // fallback-when-absent pattern as opts.fillOpacity above.
        const tooltipHtml = typeof opts.tooltipHtml === 'function'
          ? opts.tooltipHtml(feature.properties || {}, val)
          : `<strong>${label}:</strong> ${displayVal}`;

        lyr.on('mouseover', function () { this.setStyle({ fillOpacity: hoverFillOpacity, weight: 1.5 }); this.bringToFront(); });
        lyr.on('mouseout',  function () { this.setStyle({ fillOpacity, weight: 0.6 }); });

        if (opts.hoverTooltip !== false) {
          lyr.bindTooltip(tooltipHtml, { className: 'mi-tooltip', sticky: true });
        }

        if (typeof opts.onOpenSheet === 'function') {
          lyr.on('click', () => opts.onOpenSheet(feature.properties || {}, mode));
        } else if (opts.hoverTooltip === false) {
          // No richer sheet handler wired up (admin.html) — click still needs
          // to show *something*, just on click instead of hover.
          lyr.bindPopup(tooltipHtml, { className: 'mi-tooltip' });
        }
      },
    });

    targetLayerGroup.addLayer(layer);

    const sample = geojson.features?.[0]?.properties || {};
    const availableModes = Object.keys(ramps).filter(k => k in sample);

    return { layer, minVal, maxVal, availableModes };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 🗺️ BOUNDARY RENDERER (UNNC / SLO and other simple outline polygons)
  // Unlike the TES choropleth, boundaries aren't colored by a data field —
  // just a clean outline + fill using the existing getPolygonStyle() token.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Renders a boundary FeatureCollection (e.g. from data-service.js'
   * fetchBoundaries()) into targetLayerGroup.
   *
   * @param {object} geojson           - FeatureCollection
   * @param {L.LayerGroup} targetLayerGroup
   * @param {object} [opts]
   * @param {string} [opts.fillColor='#5B7A47']
   * @param {number} [opts.fillOpacity=0.08]
   * @param {string} [opts.labelField='name']
   * @returns {L.GeoJSON|null}
   */
  /**
   * Generic per-polygon hover content: bolded title from labelField, then
   * every OTHER non-empty property as a label/value row. Lets any boundary
   * dataset show its full per-polygon data on hover without the caller
   * needing to enumerate field names in advance — used by renderBoundaryGeoJSON()
   * when opts.showAllProperties is true and no custom opts.popupBuilder is given.
   * @private
   */
  _buildPropsTooltip(props, labelField, excludeFields = []) {
    const excludeSet = new Set(excludeFields.map(f => String(f).toLowerCase().replace(/[\s_]/g, '')));
    const title = props[labelField] || 'Untitled';
    const rows = Object.entries(props)
      .filter(([k, v]) => {
        if (k === labelField) return false;
        if (/^id$/i.test(k)) return false;
        if (excludeSet.has(k.toLowerCase().replace(/[\s_]/g, ''))) return false;
        return v !== null && v !== undefined && v !== '';
      })
      .map(([k, v]) => `
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:11px;padding:1px 0">
          <span style="opacity:.65">${String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
          <span style="text-align:right">${v}</span>
        </div>`)
      .join('');
    return `<div style="min-width:150px;max-width:240px"><strong>${title}</strong>${rows ? `<div style="margin-top:3px">${rows}</div>` : ''}</div>`;
  }

  /** Escapes a value for safe HTML text-node insertion. @private */
  _escSheetVal(v) {
    return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * Same data-driven "every non-empty property" listing as _buildPropsTooltip,
   * but laid out with the dashboard's info-sheet-header/info-sheet-body/
   * info-row classes instead of the ad hoc inline styles sized for a small
   * 150-240px hover tooltip. Used when popupTrigger is 'sheet' — that inline
   * tooltip markup was being stuffed into the full-width bottom sheet, which
   * is why it rendered squashed/unstyled (bug report: "UNNC popup card looks
   * unformatted"). Hover/click tooltip call sites (e.g. admin.html's UNNC
   * layer, which uses the default 'hover' trigger) are untouched — they
   * still go through _buildPropsTooltip via the branch in
   * renderBoundaryGeoJSON below.
   * @private
   */
  _buildPropsSheet(props, labelField, excludeFields = []) {
    const excludeSet = new Set(excludeFields.map(f => String(f).toLowerCase().replace(/[\s_]/g, '')));
    const title = props[labelField] || 'Untitled';
    const rows = Object.entries(props)
      .filter(([k, v]) => {
        if (k === labelField) return false;
        if (/^id$/i.test(k)) return false;
        if (excludeSet.has(k.toLowerCase().replace(/[\s_]/g, ''))) return false;
        return v !== null && v !== undefined && v !== '';
      })
      .map(([k, v]) => {
        const label = String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `<div class="info-row"><span class="info-label">${this._escSheetVal(label)}</span><span class="info-value">${this._escSheetVal(v)}</span></div>`;
      })
      .join('');

    return `
      <div class="info-sheet-header" style="background:var(--accent-dim)">
        <div class="info-sheet-title">${this._escSheetVal(title)}</div>
      </div>
      <div class="info-sheet-body">
        ${rows || '<div class="info-row"><span class="info-label">No additional details on file</span></div>'}
      </div>`;
  }

  /**
   * Renders a boundary FeatureCollection (e.g. from data-service.js'
   * fetchBoundaries()) into targetLayerGroup.
   *
   * @param {object} geojson           - FeatureCollection
   * @param {L.LayerGroup} targetLayerGroup
   * @param {object} [opts]
   * @param {string} [opts.fillColor='#5B7A47'] - flat color when colorOverrides isn't passed, and the final fallback when it is
   * @param {number} [opts.fillOpacity=0.08]
   * @param {string} [opts.labelField='name']
   * @param {object} [opts.colorOverrides] - optional name→color map (e.g. config.js
   *   SLO_BOUNDARY_COLORS). Pass even an empty object ({}) to turn on PER-FEATURE
   *   coloring: each polygon's color resolves as override-for-its-name → a
   *   deterministic hash-color generated from its name → opts.fillColor. Omit
   *   this option entirely to keep the original flat single-color behavior
   *   (what UNNC's call site still uses).
   * @param {Function} [opts.popupBuilder] - (properties) => HTML string for the
   *   hover tooltip. Full override for a layer-specific layout (e.g. an SLO
   *   officer card with photo + email). Takes priority over showAllProperties.
   * @param {boolean} [opts.showAllProperties=false] - when true and no
   *   popupBuilder is given, the hover tooltip lists every non-empty property
   *   on the feature (via _buildPropsTooltip) instead of just labelField.
   * @param {'hover'|'click'|'sheet'} [opts.popupTrigger='hover'] - 'hover' preserves
   *   the original sticky-tooltip-on-mouseover behavior (admin.html's call
   *   sites keep this by default). 'click' instead binds the same content as
   *   a real L.Popup, which Leaflet triggers on click/tap by default — no
   *   separate event wiring needed, and it works on touch devices where
   *   hover doesn't exist. 'sheet' calls opts.onOpenSheet(html, props) on
   *   click instead of using a Leaflet popup at all — for dashboard.html's
   *   full-screen/bottom-sheet info cards (2026-07-04 ask), which sidestep
   *   Leaflet popups getting clipped by the map's bounding box.
   * @param {Function} [opts.onOpenSheet] - (html, properties) => void, required
   *   when popupTrigger is 'sheet'.
   * @param {string[]} [opts.excludeFields=[]] - extra property names to hide
   *   from the auto-generated card (beyond the always-hidden id), e.g. an
   *   internal road-name column or a redundant boundary_type field. Matched
   *   case-insensitively, ignoring spaces/underscores. Only applies when
   *   showAllProperties is true and no custom popupBuilder is given.
   * @returns {L.GeoJSON|null}
   */
  renderBoundaryGeoJSON(geojson, targetLayerGroup, opts = {}) {
    targetLayerGroup.clearLayers();
    if (!geojson || !geojson.features?.length) return null;

    const {
      fillColor         = this.ctx.theme.accent,
      fillOpacity       = 0.08,
      labelField        = 'name',
      colorOverrides    = null,
      popupBuilder      = null,
      showAllProperties = false,
      popupTrigger      = 'hover',
      excludeFields     = [],
    } = opts;

    const styleFn = colorOverrides
      ? (feature) => {
          const name  = feature.properties?.[labelField];
          const color = colorOverrides[name] || this._hashColorFor(name) || fillColor;
          return this.getPolygonStyle(color, fillOpacity);
        }
      : () => this.getPolygonStyle(fillColor, fillOpacity);

    const layer = L.geoJSON(geojson, {
      pane: 'referenceLayers',
      style: styleFn,
      onEachFeature: (feature, lyr) => {
        const props = feature.properties || {};
        let html = null;

        if (popupBuilder) {
          html = popupBuilder(props);
        } else if (showAllProperties) {
          html = popupTrigger === 'sheet'
            ? this._buildPropsSheet(props, labelField, excludeFields)
            : this._buildPropsTooltip(props, labelField, excludeFields);
        } else {
          html = props[labelField] || null;
        }

        if (!html) return;

        if (popupTrigger === 'sheet') {
          // Hands off to the caller's full-screen/bottom-sheet renderer
          // (dashboard-app.js's showInfoSheet) instead of a Leaflet popup —
          // avoids the map-bounding-box clipping issue Leaflet popups have
          // near the top/edges of a constrained map, and reads better on
          // mobile. Falls back to a plain L.popup if no handler is given.
          if (typeof opts.onOpenSheet === 'function') {
            lyr.on('click', () => opts.onOpenSheet(html, props));
          } else {
            lyr.bindPopup(html, { className: 'mi-popup', maxWidth: 260 });
          }
        } else if (popupTrigger === 'click') {
          lyr.bindPopup(html, { className: 'mi-popup', maxWidth: 260 });
        } else {
          lyr.bindTooltip(html, { sticky: true, className: 'mi-tooltip' });
        }
      },
    });

    targetLayerGroup.addLayer(layer);
    return layer;
  }
}