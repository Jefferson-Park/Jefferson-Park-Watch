/**
 * config.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all shared constants in the Mapping Innovations
 * SaaS platform. Imported by data-service.js and dashboard.html.
 *
 * Rules:
 * • No DOM reads, no map references, no side effects on import.
 * • Every export is a plain const — nothing is written to window here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── 1. SUPABASE CONNECTION ───────────────────────────────────────────────────

export const SUPABASE_URL      = 'https://sqiioihssmnqatjrednq.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxaWlvaWhzc21ucWF0anJlZG5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MTQ2MDQsImV4cCI6MjA5MDM5MDYwNH0.7xmkq0yF_27ulgOMrOfblsg9vJsyDJtGve4bn0qgHIU';
export const FIELD_PHOTOS_BUCKET = 'field-photos'; // hyphen — confirmed from live storage URLs

// Generic non-image document bucket (PDF, DOC, DOCX, XLSX, etc.). Already
// live in Storage (referenced by v_unified_attachments / the three legacy
// thumbnail-resolution call sites in admin-app.js) — reused here rather than
// creating a second bucket, per the "live coexistence" constraint.
export const ATTACHMENTS_BUCKET = 'attachments';

// ─── 2. EXTERNAL SERVICE URLS ─────────────────────────────────────────────────
export const IS_LOCAL_SANDBOX = true; // flip to true only on your own machine, never commit true

export const TES_GEOJSON_URL = 'https://sqiioihssmnqatjrednq.supabase.co/storage/v1/object/public/geojson/unnctes.geojson';

export const ASSESSOR_FIND_URL     = 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/find';
export const ASSESSOR_IDENTIFY_URL = 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/identify';
export const ASSESSOR_QUERY_URL    = 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query';

// Nominatim viewbox — tight bounding box around the Jefferson Park / UNNC corridor
export const JP_VIEWBOX = '-118.355,34.038,-118.295,33.988';

// City/state anchor used by csv-batch-service.js's geocoder when a CSV
// address has no city of its own (mirrors JP_NIM.html's GEOCODE_CITY).
export const GEOCODE_CITY = 'Los Angeles, CA';

// ─── 3. SPATIAL DEFAULTS ─────────────────────────────────────────────────────

export const RADIUS_M = 450; // ~5 city blocks

// ─── 4. NEW CENTRAL TAXONOMY MAP ─────────────────────────────────────────────
// Decoupled classification engine containing all 30+ legacy types + 14 crime enums.
// Maps each token to its group taxonomy, visual styling, sensitivity, and fields.

export const CATEGORY_MAP = {
    // ─── Tree Inventory (tree_inventory) ─────────────────────────────────────
    // Split out from the original single 'forestry_parks' group (2026-08-04):
    // every category whose label contains "Tree" lives here, EXCEPT Tree
    // Trimming Schedule, which is a service/maintenance record rather than an
    // inventoried tree asset and stays in tree_park_services below (Sun's
    // explicit call). Reclassifying is a pure group-value change — `group` is
    // a derived CATEGORY_MAP property, never stored on the row itself, so
    // this needs no Supabase migration; every existing spatial_registry row
    // just resolves into its new group the moment this file ships.
    'tree':                { group: 'tree_inventory', label: 'Public Tree', icon: '🌳', color: '#27ae60', radius: 10, sensitiveDefault: false, fields: ['species', 'diameter', 'condition'] },
    // Residential/Parkway/Median are added as their own flat CATEGORY_MAP
    // entries — same pattern every other tree type here already follows —
    // rather than as CATEGORY_SUBTYPES sub-toggles under 'tree'. That
    // subtype mechanism (see CATEGORY_SUBTYPES below) only drives a
    // dashboard sidebar filter checkbox; it doesn't carry its own icon/color,
    // so it can't give each type its own distinct marker the way these three
    // need. Flat entries also keep each one independently filterable/
    // countable in the admin table and sidebar with zero extra plumbing.
    // Same 🌳 glyph as Urban Tree (still a tree), distinguished by circle
    // color instead. (2026-07-23)
    // Renamed Residential Tree -> Project Tree (2026-07-24), given a red
    // marker background (was #66bb6a, a light green indistinguishable from
    // Urban/Parkway/Median at a glance) so it stands out on the map — only
    // buildEmojiIcon's circle color changes, the 🌳 glyph is unchanged.
    // Key itself renamed tree_residential -> project_tree (2026-07-25) to
    // match the new label — see accompanying Supabase migration that backfills
    // every existing spatial_registry row from the old key to this one.
    'project_tree':        { group: 'tree_inventory', label: 'Project Tree', icon: '🌳', color: '#d32f2f', radius: 9,  sensitiveDefault: false, fields: ['species', 'diameter', 'condition'] },
    'tree_parkway':        { group: 'tree_inventory', label: 'Parkway Tree', icon: '🌳', color: '#2e7d32', radius: 9,  sensitiveDefault: false, fields: ['species', 'diameter', 'condition'] },
    'tree_median':         { group: 'tree_inventory', label: 'Median Tree', icon: '🌳', color: '#1b5e20', radius: 9,  sensitiveDefault: false, fields: ['species', 'diameter', 'condition'] },
    'preservation_tree':   { group: 'tree_inventory', label: 'Preservation Tree', icon: '🛡️', color: '#f9a825', radius: 9,  sensitiveDefault: false, fields: ['species', 'diameter', 'protection_status'] },
    'fruit_tree':          { group: 'tree_inventory', label: 'Fruit Tree', icon: '🍊', color: '#f39c12', radius: 9,  sensitiveDefault: false, fields: ['fruit_type', 'harvest_season'] },
    'vacant_well':         { group: 'tree_inventory', label: 'Vacant Tree Well', icon: '🕳', color: '#8bc34a', radius: 9,  sensitiveDefault: false, fields: ['width', 'pavement_damage'] },
    'dead_tree':           { group: 'tree_inventory', label: 'Dead Tree', icon: '🍂', color: '#8d6e63', radius: 9,  sensitiveDefault: false, fields: ['species', 'diameter', 'hazard_level'] },
    'stump':               { group: 'tree_inventory', label: 'Tree Stump', icon: '🪵', color: '#6d4c2a', radius: 9,  sensitiveDefault: false, fields: ['diameter', 'removal_required'] },
    'tree_trunk':          { group: 'tree_inventory', label: 'Tree Trunk', icon: '🪵', color: '#43a047', radius: 9,  sensitiveDefault: false, fields: ['diameter', 'condition'] },
    'tree_photos':         { group: 'tree_inventory', label: 'Tree Photos', icon: '📸', color: '#78909c', radius: 9,  sensitiveDefault: false, fields: ['photo_context'] },
    'tree_report':         { group: 'tree_inventory', label: 'Tree Report', icon: '📋', color: '#795548', radius: 9,  sensitiveDefault: false, fields: ['report_type', 'prepared_by', 'report_date'] },
    'project_tree_report':{ group: 'tree_inventory', label: 'Old City Tree Report', icon: '📋', color: '#d32f2f', radius: 9,  sensitiveDefault: false, fields: ['report_type', 'prepared_by', 'report_date'] },


    // ─── Trees & Parks Services (tree_park_services) ─────────────────────────
    // Every forestry/parks category WITHOUT "Tree" in its label, plus Tree
    // Trimming Schedule (a service record, not an inventoried tree asset).
    // Greening Master Plans intentionally listed first per Sun's ask.
    'greening_zone':       { group: 'tree_park_services', label: 'Greening Master Plans', icon: '🌿', color: '#4a8c3f', radius: 10, sensitiveDefault: false, fields: ['canopy_percentage_target'] },

    // Tree Trimming Schedule (2026-07-24) — LINESTRING street segments bulk-
    // imported into spatial_registry, each carrying its service history in
    // metadata.properties.fiscal_year (e.g. "2013-2014"), NOT a fixed color
    // here. `color` below is only the fallback swatch used for this
    // category's icon chip in the sidebar/legend — the actual line color on
    // the map is computed per-row by getTreeTrimColor() (see below), keyed
    // off each segment's own fiscal_year, so renderShapeLayers in both
    // dashboard-app.js and admin-app.js must call that instead of using
    // this flat color for this one category. Grouped under Trees & Parks
    // Services, not Tree Inventory (2026-08-04 ask) — this is a maintenance
    // schedule, not an inventoried tree.
    'tree_trimming_segment': { group: 'tree_park_services', label: 'Tree Trimming Schedule', icon: '✂️', color: '#f1c40f', radius: 9, sensitiveDefault: false, fields: [] },

    'planting_site':       { group: 'tree_park_services', label: 'Potential Planting Site', icon: '🌱', color: '#52be80', radius: 9,  sensitiveDefault: false, fields: ['soil_type', 'water_source'] },
    'parks':               { group: 'tree_park_services', label: 'Parks & Rec Site', icon: '⛳', color: '#1abc9c', radius: 10, sensitiveDefault: false, fields: ['amenities', 'maintenance_needs'] },
    'garden':              { group: 'tree_park_services', label: 'Community Garden', icon: '🥕', color: '#7dcea0', radius: 9,  sensitiveDefault: false, fields: ['plots_available', 'coordinator'] },
    'trail':               { group: 'tree_park_services', label: 'Walking Trail / Path', icon: '🚶', color: '#009688', radius: 9,  sensitiveDefault: false, fields: ['surface_material', 'length_miles'] },
    'canopy_goal':         { group: 'tree_park_services', label: 'Canopy Goal Area', icon: '🌲', color: '#27ae60', radius: 10, sensitiveDefault: false, fields: ['priority_index'] },
    'biodiversity':        { group: 'tree_park_services', label: 'Biodiversity Observation', icon: '🦋', color: '#16a085', radius: 10, sensitiveDefault: false, fields: ['species_count', 'habitat_type'] },

    // ─── Crime & Public Safety (public_safety) ───
    'aggravated_assault':  { group: 'public_safety', label: 'Aggravated Assault', icon: '💥', color: '#B93020', radius: 10, sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'attempt_gta':         { group: 'public_safety', label: 'Attempt GTA', icon: '🚗', color: '#e74c3c', radius: 9,  sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'battery':             { group: 'public_safety', label: 'Battery', icon: '👊', color: '#c0392b', radius: 9,  sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'bfmv':                { group: 'public_safety', label: 'Burglary From Motor Vehicle (BFMV)', icon: '📦', color: '#ff6b35', radius: 9, sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'btfv':                { group: 'public_safety', label: 'Burglary Theft From Vehicle (BTFV)', icon: '🚙', color: '#ff6b35', radius: 9, sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'burglary':            { group: 'public_safety', label: 'Burglary', icon: '🏠', color: '#7f8c8d', radius: 9,  sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'criminal_threat':     { group: 'public_safety', label: 'Criminal Threat', icon: '🗣️', color: '#9b59b6', radius: 9, sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'gta':                 { group: 'public_safety', label: 'Grand Theft Auto (GTA)', icon: '🏎️', color: '#e74c3c', radius: 9,  sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'robbery':             { group: 'public_safety', label: 'Robbery', icon: '💰', color: '#b93020', radius: 9,  sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'shots_fired':         { group: 'public_safety', label: 'Shots Fired', icon: '🔫', color: '#a50026', radius: 10, sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'theft':               { group: 'public_safety', label: 'Theft', icon: '🛍️', color: '#7f8c8d', radius: 9,  sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'tfmv':                { group: 'public_safety', label: 'Theft From Motor Vehicle (TFMV)', icon: '🚘', color: '#ff6b35', radius: 9, sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'vandalism':           { group: 'public_safety', label: 'Vandalism', icon: '🎨', color: '#d35400', radius: 9,  sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },
    'homicide':            { group: 'public_safety', label: 'Homicide', icon: '⚫', color: '#000000', radius: 10, sensitiveDefault: true, fields: ['incident_date', 'incident_time'] },

    // ─── Traffic Infrastructure & Safety (traffic_infra) ───
    // 'traffic' = Public Reported Traffic Safety parent (JP_NIM: "Traffic Accidents All").
    // 'lighting' = Street Infrastructure parent (JP_NIM: "Street Infrastructure All").
    // Finer-grained sidebar sub-toggles for both live in CATEGORY_SUBTYPES
    // below (ported from JP_NIM.html's tog-row subtype rows) rather than as
    // separate top-level CATEGORY_MAP entries — they filter WITHIN these two
    // parents by a category_data field (see SUBTYPE_MATCH_FIELD), the same
    // way JP_NIM's toggleCatSubtype() matched accident_type/infra_type.
    'traffic':             { group: 'traffic_infra', label: 'Traffic Safety Hazard', icon: '🚦', color: '#f0a500', radius: 10, sensitiveDefault: false, fields: ['intersection_type', 'speed_limit'] },
    'lighting':            { group: 'traffic_infra', label: 'Traffic Infrastructure', icon: '💡', color: '#2d8bff', radius: 9,  sensitiveDefault: false, fields: ['pole_id', 'outage_severity'] },

    // ─── Land Use & Economic Development (planning_dev) ───
    'business':            { group: 'planning_dev',  label: 'Commercial Business Registry', icon: '🏪', color: '#5B7A47', radius: 9, sensitiveDefault: false, fields: ['business_name', 'use_type'] },
    'mix_use_residential': { group: 'planning_dev',  label: 'Mixed-Use Residential Lot', icon: '🏗', color: '#9b59b6', radius: 9,  sensitiveDefault: false, fields: ['unit_count', 'floors_count'] },
    'vacant_lot':          { group: 'planning_dev',  label: 'Vacant Parcel Block', icon: '🟫', color: '#8b6914', radius: 9,  sensitiveDefault: false, fields: ['zoning_code', 'ownership'] },
    'storefront':          { group: 'planning_dev',  label: 'Retail Storefront Unit', icon: '🏬', color: '#2ecc71', radius: 9,  sensitiveDefault: false, fields: ['occupancy_status'] },
    'public_property':     { group: 'planning_dev',  label: 'Publicly Owned Asset', icon: '🏛', color: '#0096c7', radius: 9,  sensitiveDefault: false, fields: ['agency_jurisdiction'] },
    // Label reworded (2026-08-04): "Billboard Signage Structure" ->
    // "Billboard Banner Signage" — same key, same icon/color, label only.
    'billboard':           { group: 'planning_dev',  label: 'Billboard Banner Signage', icon: '📢', color: '#ff6b35', radius: 9,  sensitiveDefault: false, fields: ['permit_number', 'dimensions'] },
    'improvement':         { group: 'planning_dev',  label: 'Capital Project Improvement', icon: '🏗', color: '#5dade2', radius: 9,  sensitiveDefault: false, fields: ['funding_source', 'completion_date'] },

    // ─── Environment & Health (env_health) ───
    'hazard':              { group: 'env_health',    label: 'Environmental Waste Hazard', icon: '⚠️', color: '#f39c12', radius: 10, sensitiveDefault: false, fields: ['severity_ranking', 'contaminants'] },
    'nuisance_property':   { group: 'env_health',    label: 'Nuisance & Blight Location', icon: '🏚', color: '#c0392b', radius: 10, sensitiveDefault: false, fields: ['citation_history'] },
    'trash':               { group: 'env_health',    label: 'Illegal Dumping / Trash Pile', icon: '🗑', color: '#7f8c8d', radius: 9,  sensitiveDefault: false, fields: ['volume_estimate_cubic_yds'] },
    'remediation':         { group: 'env_health',    label: 'Soil & Site Remediation Zone', icon: '♻️', color: '#2ecc71', radius: 10, sensitiveDefault: false, fields: ['remediation_method'] },
    // Moved here from culture_comm (2026-08-04) — see CATEGORY_SUBTYPES
    // below for the five new sidebar sub-toggles (Family RV, Single RV,
    // Homeless Tent, Squatters, Encampment) matched against
    // metadata.encampment_type via SUBTYPE_MATCH_FIELD, same pattern as
    // traffic/lighting's existing subtype rows.
    'homeless_services':   { group: 'env_health',    label: 'Homeless Outreach Target', icon: '🏕', color: '#e74c3c', radius: 9,  sensitiveDefault: false, fields: ['resource_availability'] },
    // New (2026-08-04):
    'emergency_services':  { group: 'env_health',    label: 'Emergency Services', icon: '🚑', color: '#e53935', radius: 9,  sensitiveDefault: false, fields: ['service_type', 'contact_info'] },
    'shade_cooling_center': { group: 'env_health',   label: 'Shade & Cooling Center', icon: '⛱️', color: '#29b6f6', radius: 9,  sensitiveDefault: false, fields: ['capacity', 'hours_of_operation'] },
    'compost_recycling':   { group: 'env_health',    label: 'Compost & Recycling', icon: '🔄', color: '#66bb6a', radius: 9,  sensitiveDefault: false, fields: ['program_type', 'pickup_schedule'] },

    // ─── Culture & Community (culture_comm) ───
    // Label reworded (2026-08-04): "Public Art Mural" -> "Public Art & Mural".
    'art_mural':           { group: 'culture_comm',  label: 'Public Art & Mural', icon: '🎨', color: '#e91e63', radius: 9,  sensitiveDefault: false, fields: ['artist_name', 'commission_date'] },
    // 'mural' (Community Mural Fallback) removed (2026-08-04) — folded into
    // 'art_mural'. Existing rows must be reassigned category_value:
    // 'mural' -> 'art_mural' via migration BEFORE this ships (see the
    // reassignment SQL provided alongside this diff) — otherwise any row
    // still carrying the old key falls through CATEGORY_MAP lookups with no
    // icon/color/label match.
    'cultural':            { group: 'culture_comm',  label: 'Cultural Asset Facility', icon: '🏛', color: '#8e44ad', radius: 9,  sensitiveDefault: false, fields: ['historical_significance'] },
    'historic':            { group: 'culture_comm',  label: 'Historic Preservation Site', icon: '🏺', color: '#d4ac0d', radius: 10, sensitiveDefault: false, fields: ['construction_year', 'hpoz_id'] },
    'social_school':       { group: 'culture_comm',  label: 'School / Educational Asset', icon: '🏫', color: '#3498db', radius: 9,  sensitiveDefault: false, fields: ['school_district_code', 'enrollment'] },
    'social_senior':       { group: 'culture_comm',  label: 'Senior Services Hub', icon: '🧓', color: '#8e44ad', radius: 9,  sensitiveDefault: false, fields: ['program_types'] },
    'social_ngo':          { group: 'culture_comm',  label: 'NGO Non-Profit HQ', icon: '🤝', color: '#27ae60', radius: 9,  sensitiveDefault: false, fields: ['service_focus'] },
    'social_library':      { group: 'culture_comm',  label: 'Library & Literacy Node', icon: '📚', color: '#d35400', radius: 9,  sensitiveDefault: false, fields: ['public_hours'] },
    // New (2026-08-04):
    'church_spiritual_center': { group: 'culture_comm', label: 'Church & Spiritual Center', icon: '⛪', color: '#6a4c93', radius: 9,  sensitiveDefault: false, fields: ['denomination', 'service_times'] },
    'information_signage': { group: 'culture_comm',  label: 'Information Signage', icon: '🪧', color: '#607d8b', radius: 9,  sensitiveDefault: false, fields: ['sign_type', 'installed_date'] }
};

// ─── 5. RESTRUCTURED 6-GROUP TAXONOMY ────────────────────────────────────────
// Replaces original 4-group configuration to match core council committees.

export const CATEGORY_GROUPS = [
    { id: 'tree_inventory',     label: '🌳 Tree Inventory' },
    { id: 'tree_park_services', label: '🌿 Trees & Parks Services' },
    { id: 'public_safety',   label: '🚨 Crime & Public Safety' },
    { id: 'traffic_infra',   label: '🚦 Traffic Infrastructure & Safety' },
    { id: 'planning_dev',    label: '🏗 Planning & Economic Dev' },
    { id: 'env_health',      label: '🌱 Environment & Health' },
    { id: 'culture_comm',    label: '🎨 Culture & Community' }
];

// ─── 5b. PER-ORG CATEGORY GROUP VISIBILITY (dashboard use only) ─────────────
// Restricts which CATEGORY_GROUPS a given org's dashboard shows/queries. A
// group NOT listed here is shared — visible under every org. A group
// listed under one org is exclusive to that org (hidden from every other
// org's sidebar + map + record list), regardless of what any individual
// record's organization_id/committee_slug happens to say — group
// exclusivity is the authoritative rule, not a per-row property.
//
// Decision (2026-07-02): Crime & Public Safety is Jefferson Park Watch's
// own committee; Trees & Parks is UNNC's own committee (its Tree
// Committee). Everything else (traffic, planning, environment, culture) is
// shared civic infrastructure both orgs care about. Adjust this map to
// change the pairing — dashboard-app.js's buildGroupFilters() (sidebar) and
// loadRecords() (data fetch) both read from resolveVisibleGroups() below,
// so this is the one place to edit. admin-app.js does NOT currently apply
// this restriction — admins see every group regardless of org, since
// internal staff manage all committees' data, not just their own org's.
export const ORG_EXCLUSIVE_GROUPS = {
    'jefferson-park-watch': ['public_safety'],
    'unnc':                 ['tree_inventory', 'tree_park_services'],
};

/**
 * Returns the CATEGORY_GROUPS ids visible to a given org: every group NOT
 * exclusively claimed by another org, plus this org's own exclusive groups.
 * @param {string} orgSlug
 * @returns {string[]} CATEGORY_GROUPS ids
 */
export function resolveVisibleGroups(orgSlug) {
    const allExclusiveGroups = Object.values(ORG_EXCLUSIVE_GROUPS).flat();
    const ownExclusiveGroups = ORG_EXCLUSIVE_GROUPS[orgSlug] || [];
    return CATEGORY_GROUPS
        .map(g => g.id)
        .filter(id => !allExclusiveGroups.includes(id) || ownExclusiveGroups.includes(id));
}

// ─── 6. FLAT LOOKUP LISTS ────────────────────────────────────────────────────
// Programmatically built flat array derived from CATEGORY_MAP for UI selectors.

export const CATEGORY_LOOKUP = Object.entries(CATEGORY_MAP).map(([key, obj]) => ({
    value: key,
    text: obj.label,
    group: obj.group
}));

// Backward-compatible flat mapping mirroring the original map design
export const SYMBOL_MAP = Object.entries(CATEGORY_MAP).reduce((acc, [key, obj]) => {
    acc[key] = { icon: obj.icon, color: obj.color, radius: obj.radius };
    return acc;
}, {});

export const COMMITTEE_FALLBACK = {
    'tree-committee': { icon: '🌿', color: '#27ae60', radius: 9 },
    'traffic-safety': { icon: '🚦', color: '#f0a500', radius: 9 },
    'planning':       { icon: '🏗', color: '#9b59b6', radius: 9 },
    'econ-dev':       { icon: '💼', color: '#5B7A47', radius: 9 },
    'jpw':            { icon: '👮', color: '#c0392b', radius: 9 },
};

// Reverse of the above, for writes rather than display: which committee_slug
// a CSV batch row gets, based on its resolved category's CATEGORY_MAP group.
// Only populated for groups with an actual established convention elsewhere
// in the app — 'crime-report' is the existing csv-batch-service free-text
// value (predates COMMITTEE_FALLBACK's 'jpw' key, left as-is rather than
// silently changed), 'tree-committee' matches processAndUploadPhoto()'s
// hardcoded value in admin-app.js. Deliberately NOT exhaustive: a group with
// no entry here means the batch importer will skip those rows with a clear
// error rather than inventing an unestablished slug — add an entry here
// once a real convention exists for that group.
// Which committees actually belong to which org — mirrors dashboard.html's
// hardcoded committee-select options (the only place this previously lived).
// Used to validate that a resolved committee_slug actually belongs to the
// org creating the record, catching exactly the class of mismatch that let
// a public_safety record get written under UNNC with committee_slug='jpw'
// (a Jefferson Park Watch-only committee) with no error at all. Dashboard
// itself isn't wired to this yet — it still has its own separate hardcoded
// copy — that consolidation is part of the larger Dashboard rebuild, not
// done here.
export const ORG_COMMITTEES = {
    'unnc':                  ['tree-committee', 'traffic-safety', 'planning', 'econ-dev'],
    'jefferson-park-watch':  ['jpw'],
};

// ─── 6b. READ-SIDE COMMITTEE VISIBILITY (dashboard use only) ────────────────
// ORG_COMMITTEES above says which committees belong to which org. This is
// the read-side counterpart: legacy committee_slug values that mean the
// same committee for VISIBILITY purposes even though they're spelled
// differently in already-written rows. This does NOT rewrite any data —
// 'crime-report' rows stay 'crime-report' forever (per the no-DB-migration
// call already made in GROUP_COMMITTEE_SLUG's comments) — it only widens
// what a dashboard treats as "belongs to this org" when deciding what to
// show, independent of whatever organization_id a row happens to carry.
//
// Root cause this exists for (confirmed 2026-07-01): every public_safety
// spatial_registry row currently has organization_id set to UNNC's org id,
// even the ones with committee_slug='jpw' — legacy data from before the
// two orgs were split apart. Rather than requiring a data migration before
// JPW's dashboard can show its own crime data, loadRecords() in
// dashboard-app.js now shows a record if EITHER its organization_id matches
// the active org OR its (alias-resolved) committee_slug belongs to that
// org's committee list — see resolveOrgCommittees() below.
export const COMMITTEE_SLUG_ALIASES = {
    'crime-report': 'jpw', // pre-'jpw' freeform value — same committee in practice
};

/**
 * Resolves the full set of committee_slug values — including known legacy
 * aliases — that should be treated as visible under a given org slug.
 * @param {string} orgSlug
 * @returns {string[]}
 */
export function resolveOrgCommittees(orgSlug) {
    const base = ORG_COMMITTEES[orgSlug] || [];
    const aliasesForBase = Object.entries(COMMITTEE_SLUG_ALIASES)
        .filter(([, canonical]) => base.includes(canonical))
        .map(([legacy]) => legacy);
    return [...new Set([...base, ...aliasesForBase])];
}

export const GROUP_COMMITTEE_SLUG = {
    // 'crime-report' never matched any real committee dashboard.html offers —
    // Jefferson Park Watch's actual (and only) committee option is 'jpw'.
    // Existing rows already written with 'crime-report' are left as-is per
    // Sun's call — this only changes the mapping for records created from
    // here forward, no DB migration.
    public_safety:  'jpw',
    tree_inventory:     'tree-committee',
    tree_park_services: 'tree-committee',
    // UNNC's real committee structure splits Planning from Economic
    // Development — they are not the same committee, even though both
    // currently live under one CATEGORY_MAP group ('planning_dev'). This
    // routes the whole group to Planning & Zoning for now; categories that
    // actually belong under Economic Development (or need to be visible to
    // more than one committee) need a more granular, per-category routing
    // model than this group-level map currently supports — flagged as a
    // follow-up, not solved here.
    planning_dev:   'planning',
    // traffic_infra, env_health, culture_comm are deliberately absent here —
    // see SHARED_NO_COMMITTEE_GROUPS below.
};

// Groups with no dedicated committee at all (decision 2026-07-02, confirmed
// structural — not a sentinel-string workaround): traffic, environment, and
// culture/community records are shared, cross-org classifications — either
// org can create/own a record in these groups under its own
// organization_id, with committee_slug left NULL rather than forced to an
// invented single-committee value (a fictional 'shared' string was
// considered and rejected — it would create downstream filtering/reporting
// debt for a committee that doesn't actually exist). Requires
// committee_slug to be nullable on spatial_registry — see the
// `alter table ... drop not null` migration note in the deployment log.
// Callers (submitCreateRecord, commitCsvBatch, public-submission-service.js)
// must check this list before treating a null GROUP_COMMITTEE_SLUG lookup
// as an error, so a genuinely unmapped future group still fails loudly
// instead of silently behaving like a shared one.
export const SHARED_NO_COMMITTEE_GROUPS = ['traffic_infra', 'env_health', 'culture_comm'];

// ─── 6a. BOUNDARY COLOR OVERRIDES (per-feature-name fill colors) ─────────────
// Used by renderBoundaryGeoJSON() in map-core.js when opts.colorOverrides is
// passed. Keyed by the boundary's own feature.properties.name string
// (case-sensitive, must match exactly what get_boundaries_as_geojson returns).
//
// Deliberately starts empty: the distinct SLO boundary names aren't known
// from static files alone (see HANDOFF). Leaving this empty does NOT block
// per-boundary coloring, though — map-core.js falls back to a deterministic
// hash-based color for any name with no entry here, so every SLO polygon
// already gets its own stable, distinct color with zero setup. Add an entry
// below only when you want a SPECIFIC name to use a SPECIFIC brand/intentional
// color instead of the auto-generated one.
//
// Example, once you know the real names:
//   export const SLO_BOUNDARY_COLORS = {
//     'Downtown SLO':        '#2B6CB0',
//     'Wilshire Center SLO': '#9C4221',
//   };
export const SLO_BOUNDARY_COLORS = {};

// Same pattern for UNNC sub-boundaries (e.g. zones/regions within UNNC) —
// empty by default, auto-hash-colored per name until you want specific ones
// pinned to specific colors.
export const UNNC_BOUNDARY_COLORS = {};

// Citywide reference boundaries (2026-07-08) — Council Districts and
// Neighborhood Councils, same colorOverrides pattern as SLO/UNNC above:
// empty by default, auto-hash-colored per feature name/district until you
// want specific ones pinned to specific colors. Keyed by whatever property
// renderBoundaryGeoJSON's labelField resolves to for each layer — confirm
// the real property name from the console.log sample-properties line in
// admin-app.js's toggle handler before adding entries here, same as SLO's
// names had to be confirmed from real data rather than assumed.
export const COUNCIL_DISTRICT_COLORS = {};
export const NEIGHBORHOOD_COUNCIL_COLORS = {};

export const SYMBOL_DEFAULT = { icon: '📍', color: '#546e7a', radius: 9 };

// ─── Tree Trimming Schedule fiscal-year color ramp (2026-07-24) ─────────────
// Every other category gets one flat color from CATEGORY_MAP. This one
// doesn't — each LINESTRING segment's color is derived from its own
// metadata.properties.fiscal_year ("2013-2014" etc.) so recently-trimmed
// streets and long-overdue ones read differently at a glance: green =
// trimmed recently, red = overdue. Anchored to a fixed year range (not the
// live data's min/max) so a segment's color stays stable as new fiscal
// years get imported later, rather than the whole ramp shifting underneath
// already-rendered data.
export const TREE_TRIM_YEAR_MIN = 2010;
export const TREE_TRIM_YEAR_MAX = 2026;

/**
 * Pulls the starting year out of a fiscal-year string — "2013-2014" -> 2013,
 * a plain "2013" -> 2013. Returns null if nothing 4-digit-year-shaped is found.
 */
export function parseFiscalYearStart(fiscalYearStr) {
    const match = String(fiscalYearStr || '').match(/\d{4}/);
    return match ? parseInt(match[0], 10) : null;
}

/**
 * Red (overdue) -> yellow -> green (recently trimmed) gradient keyed off a
 * fiscal-year string, clamped to TREE_TRIM_YEAR_MIN/MAX above. Falls back to
 * neutral gray for a segment with no year on file, so a missing value never
 * silently renders invisible or crashes the style function.
 */
export function getTreeTrimColor(fiscalYearStr) {
    const year = parseFiscalYearStart(fiscalYearStr);
    if (year == null) return '#9e9e9e';

    const t = Math.max(0, Math.min(1, (year - TREE_TRIM_YEAR_MIN) / (TREE_TRIM_YEAR_MAX - TREE_TRIM_YEAR_MIN)));
    const stops = [[0, [192, 57, 43]], [0.5, [241, 196, 15]], [1, [39, 174, 96]]]; // red -> yellow -> green
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i][0] && t <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
    }
    const span = (hi[0] - lo[0]) || 1;
    const localT = (t - lo[0]) / span;
    const rgb = lo[1].map((c, i) => Math.round(c + (hi[1][i] - c) * localT));
    return `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Reads a tree_trimming_segment row's fiscal_year out of its metadata,
 * regardless of which app parsed metadata into an object already or left it
 * as a JSON string. Data shape (confirmed 2026-07-24): metadata.properties.
 * fiscal_year, e.g. {"source":"cd10_tree_trimming","properties":{"fiscal_year":"2013-2014",...}}.
 * Falls back to a flat metadata.fiscal_year in case a future import batch
 * writes it without the nested `properties` wrapper.
 */
export function getFiscalYearFromRow(row) {
    let meta = row?.metadata ?? row?.metadata_payload ?? null;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch (e) { meta = null; }
    }
    return meta?.properties?.fiscal_year ?? meta?.fiscal_year ?? null;
}

/**
 * Resolves a display symbol for a feature. Handles both standardized keys and raw text cases.
 * @param {string} categoryValue
 * @param {string} committeeSlug
 * @returns {{ icon: string, color: string, radius: number }}
 */
export function getSymbol(categoryValue, committeeSlug) {
    const sanitizedKey = String(categoryValue || '').toLowerCase().trim().replace(/ /g, '_');
    return CATEGORY_MAP[sanitizedKey] || COMMITTEE_FALLBACK[committeeSlug] || SYMBOL_DEFAULT;
}

// ─── 7. WOSIP GOAL LABELS ─────────────────────────────────────────────────────
// Ported verbatim from UNNC_GMP.html's WOSIP_LABELS — the previous version of
// this map had completely different (wrong) wording under the same keys.

export const WOSIP_LABELS = {
    '1': 'Safe & Resilient Communities',
    '2': 'Park & Open Space Access',
    '3': 'Water Resource Management',
    '4': 'Biodiversity',
    '5': 'Urban Forest Health',
    '6': 'Remediate Degraded Lands',
    '7': 'Extreme Heat Mitigation',
    '8': 'Wildfire Prevention',
};

// ─── 8. LAPD COLLISION TYPE CONFIG ───────────────────────────────────────────

export const LAPD_TYPE_CONFIG = {
    fatality:   { color: '#B93020', emoji: '⚫', label: 'Fatality' },
    pedestrian: { color: '#C4780A', emoji: '🚶', label: 'Pedestrian Hit' },
    bicycle:    { color: '#2B6CB0', emoji: '🚲', label: 'Bicycle Collision' },
    vehicle:    { color: '#888888', emoji: '🚗', label: 'Vehicle Collision' },
};

// ─── 8b. CATEGORY SUBTYPE FILTERS (sidebar sub-toggles) ─────────────────────
// Finer-grained toggle rows shown beneath a CATEGORY_MAP parent category in
// the dashboard sidebar — ported from JP_NIM.html's Safety & Crime / Traffic
// & Infrastructure tog-row subtype pattern (toggleCatSubtype() +
// subtypeMatches()). Each entry describes ONE sub-toggle; `match` is the
// lowercase substring checked (case-insensitively, both directions, same as
// JP_NIM) against the record's category_data field named in
// SUBTYPE_MATCH_FIELD for that parent category.
//
// 'vehicle_collision' under traffic and 'stop_sign' / 'crosswalk' under
// lighting are new additions beyond what JP_NIM had (2026-07-03 ask).
export const CATEGORY_SUBTYPES = {
    traffic: [
        { value: 'vehicle_collision', label: 'Vehicle Collision Only', icon: '🚗', match: 'vehicle' },
        { value: 'pedestrian_hit',    label: 'Pedestrian Hit',         icon: '🚶', match: 'pedestrian' },
        { value: 'bicycle_collision', label: 'Bicycle Collision',      icon: '🚲', match: 'bicycle' },
        { value: 'fatality',          label: 'Fatality',               icon: '⚫', match: 'fatality' },
    ],
    lighting: [
        { value: 'street_light_out', label: 'Street Light Out',  icon: '🔦', match: 'street light' },
        { value: 'pothole',          label: 'Pot Holes',         icon: '🕳',  match: 'pothole' },
        { value: 'sidewalk_damage',  label: 'Sidewalk Damage',   icon: '🧱', match: 'sidewalk' },
        { value: 'sign_issue',       label: 'Sign Issues',       icon: '🚧', match: 'sign issue' },
        { value: 'stop_sign',        label: 'Stop Sign',         icon: '🛑', match: 'stop sign' }, // new
        { value: 'crosswalk',        label: 'Crosswalk',         icon: '🚸', match: 'crosswalk' }, // new
        { value: 'speed_bump',       label: 'Speed Bumps',       icon: '⛰',  match: 'speed bump' },
        { value: 'traffic_light',    label: 'Traffic Lights',    icon: '🚦', match: 'traffic light' },
        { value: 'walkway_marker',   label: 'Walkway Markers',   icon: '🔲', match: 'walkway marker' },
        { value: 'other_structure',  label: 'Other Structures',  icon: '🔩', match: 'other structure' },
    ],
    // New (2026-08-04) — matched against metadata.encampment_type, see
    // SUBTYPE_MATCH_FIELD below.
    homeless_services: [
        { value: 'family_rv',     label: 'Family RV',      icon: '🚐', match: 'family rv' },
        { value: 'single_rv',     label: 'Single RV',      icon: '🚌', match: 'single rv' },
        { value: 'homeless_car',  label: 'Homeless Car',   icon: '🚗', match: 'homeless car' },
        { value: 'homeless_tent', label: 'Homeless Tent',  icon: '⛺', match: 'tent' },
        { value: 'squatters',     label: 'Squatters',      icon: '🚪', match: 'squat' },
        { value: 'encampment',    label: 'Encampment',     icon: '🏕', match: 'encampment' },
    ],
};

// Which category_data JSONB field holds the free-text subtype string for a
// given parent category — mirrors JP_NIM's subtypeMatches(): traffic reads
// category_data.accident_type, lighting reads category_data.infra_type.
export const SUBTYPE_MATCH_FIELD = {
    traffic:  'accident_type',
    lighting: 'infra_type',
    homeless_services: 'encampment_type',
};

// ─── 9. TES CHOROPLETH RAMPS ──────────────────────────────────────────────────
// Color ramps keyed by field. stops: [[upperBound, color], ...]

export const TES_RAMPS = {
    tes:        {
        label: 'TES Score',
        stops: [[20,'#d73027'],[40,'#f46d43'],[55,'#fdae61'],[65,'#fee08b'],[75,'#d9ef8b'],[100,'#4dac26']],
    },
    tc_gap:  {
        label: 'Canopy Gap',
        stops: [[0.10,'#4dac26'],[0.15,'#d9ef8b'],[0.20,'#fee08b'],[0.25,'#fdae61'],[0.30,'#f46d43'],[1,'#d73027']],
    },
    temp_diff: {
        label: 'Heat (Temp Diff)',
        // Real range runs negative-to-positive (feature values seen: -6.27..4.77 °F
        // vs city average). Diverging blue (cooler than city) → red (hotter than
        // city) ramp, centered on 0 — not a green→red scale, since "cooler" here
        // is a distinct good direction, not just "less bad."
        stops: [[-4,'#2166ac'],[-2,'#67a9cf'],[0,'#d1e5f0'],[2,'#fddbc7'],[4,'#ef8a62'],[8,'#b2182b']],
    },
    priority_i:     {
        label: 'Priority Index',
        // Real values are a 0–1 fraction (seen range ~0.38–0.59), not 0–100.
        // Sequential green (low priority/good) → red (high priority/needs work),
        // with a fully-saturated green floor instead of a washed-out light green.
        stops: [[0.30,'#1a9850'],[0.40,'#a6d96a'],[0.45,'#fee08b'],[0.50,'#fdae61'],[0.55,'#f46d43'],[1,'#a50026']],
    },
    holc_grade: {
        label: 'HOLC Grade',
        stops: [[1,'#4dac26'],[2,'#fee08b'],[3,'#f46d43'],[4,'#d73027'],[9,'#aaaaaa']],
        labels: { 1:'A', 2:'B', 3:'C', 4:'D' },
    }
};