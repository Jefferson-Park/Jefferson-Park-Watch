/**
 * data-service.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all Supabase I/O in the Mapping Innovations SaaS.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import _db from './js/supabase-client.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, FIELD_PHOTOS_BUCKET } from './config.js';

// ─── 3. SPATIAL REGISTRY ─────────────────────────────────────────────────────

export async function fetchSpatialData(orgId, committeeSlug) {
  const { data, error } = await _db
    .rpc('get_spatial_data_as_geojson', {
      target_org_id:   orgId,
      target_committee: committeeSlug,
    });

  if (error) {
    console.error('[data-service] fetchSpatialData RPC fault:', error.message);
    return { rows: [], error: error.message };
  }

  return { rows: data || [], error: null };
}

export async function insertSpatialRecord(record) {
  const { data, error } = await _db
    .from('spatial_registry')
    .insert(record)
    .select('id')
    .single();

  if (error) {
    console.error('[data-service] insertSpatialRecord fault:', error.message);
    return { id: null, error: error.message };
  }

  return { id: data.id, error: null };
}

// Geometry-only update for an existing spatial_registry row. Used by the
// admin "Edit Shape" flow (Leaflet.Draw vertex-drag reshape of an existing
// Polygon/LineString) once the user saves their edit. Deliberately scoped to
// just geom/geom_type — it does not touch metadata or any other column, so
// it's safe to call from a generic "shape was reshaped" save action without
// needing to know anything else about the row.
export async function updateRecordGeometry(registryId, geometry, geomType) {
  const { error } = await _db
    .from('spatial_registry')
    .update({
      geom:      JSON.stringify(geometry),
      geom_type: geomType,
    })
    .eq('id', registryId);

  if (error) {
    console.error('[data-service] updateRecordGeometry fault:', error.message);
    return { error: error.message };
  }

  return { error: null };
}

// Fetches just enough of each existing spatial_registry row (for a given org
// + set of category keys) to build dedup fingerprints client-side in
// csv-batch-service.js. incident_date lives in metadata JSONB, not a top-level
// column, same as every other category-specific field — so this can't be
// pushed down into the query itself.
export async function fetchExistingFingerprints(orgId, categoryKeys) {
  const { data, error } = await _db
    .from('spatial_registry')
    // description_notes added 2026-07-12 — admin-app.js's buildFingerprint()
    // call now takes an optional differentiator (notes/description text) so
    // genuinely distinct co-located records — e.g. four different trees at
    // one address, entered with the same survey date and no per-row time —
    // don't collide into a false DUPLICATE just because address+date+time
    // match. Without this column, the differentiator only ever worked for
    // the NEW rows being imported (which always have row.description
    // available from the parsed CSV); every EXISTING row in the DB would
    // silently fall back to an empty differentiator, which is still
    // correct, just less precise, for anything imported before this field
    // existed.
    .select('category_value, reported_address, metadata, description_notes')
    .eq('organization_id', orgId)
    .in('category_value', categoryKeys || []);

  if (error) {
    console.error('[data-service] fetchExistingFingerprints fault:', error.message);
    return { rows: [], error: error.message };
  }

  return { rows: data || [], error: null };
}



export async function seedCategoryDropdown(orgId) {
  const { data, error } = await _db
    .from('form_categories')
    .select('category_value, display_label, ui_group')
    .eq('organization_id', orgId);

  if (error) {
    console.warn('[data-service] seedCategoryDropdown fault:', error.message);
    return { rows: [], error: error.message };
  }

  const rows = (data || []).sort((a, b) =>
    (a.display_label || '').localeCompare(b.display_label || '')
  );

  return { rows, error: null };
}

// ─── 5. ORGANIZATION LOOKUP ───────────────────────────────────────────────────

export async function resolveOrgId(orgSlug) {
  const { data, error } = await _db
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .limit(1);

  if (error || !data?.length) {
    const msg = error?.message || `No org found for slug "${orgSlug}"`;
    console.error('[data-service] resolveOrgId fault:', msg);
    return { id: null, error: msg };
  }

  return { id: data[0].id, error: null };
}

// Reverse of resolveOrgId — needed because callers sometimes only have the
// organization UUID (e.g. window.userContext.organization_id) but need the
// slug for cosmetic storage-folder naming (see fpp-service.js orgSlug param).
export async function resolveOrgSlug(orgId) {
  const { data, error } = await _db
    .from('organizations')
    .select('slug')
    .eq('id', orgId)
    .limit(1);

  if (error || !data?.length) {
    const msg = error?.message || `No org found for id "${orgId}"`;
    console.error('[data-service] resolveOrgSlug fault:', msg);
    return { slug: null, error: msg };
  }

  return { slug: data[0].slug, error: null };
}

// ─── 6. GREENING PROJECTS ─────────────────────────────────────────────────────

export async function loadGreeningProjects() {
  const { data, error } = await _db
    .from('greening_projects')
    .select('id,name,region,status,wosip_goals,funding_source,amount,lat,lng,partners,notes')
    .not('lat', 'is', null)
    .not('lng', 'is', null);

  if (error) {
    console.error('[data-service] loadGreeningProjects fault:', error.message);
    return { rows: [], error: error.message };
  }

  return { rows: data || [], error: null };
}

// ─── 7. LAPD COLLISIONS (Edge Function) ───────────────────────────────────────

export async function loadLAPDCollisions(from, to, bbox) {
  const { data, error } = await _db.functions.invoke('lapd-traffic', {
    body: { from, to, ...bbox },
  });

  if (error) {
    console.warn('[data-service] loadLAPDCollisions edge fault:', error.message);
    return { records: [], count: 0, error: error.message };
  }

  return {
    records: data?.records || [],
    count:   data?.count   || 0,
    error:   null,
  };
}

// ─── 8. WIND DATA (Open-Meteo) ────────────────────────────────────────────────

export async function loadWindLayer(grid) {
  const lats = grid.map(p => p.lat.toFixed(4)).join(',');
  const lngs = grid.map(p => p.lng.toFixed(4)).join(',');
  const url  = `https://api.open-meteo.com/v1/forecast` +
               `?latitude=${lats}&longitude=${lngs}` +
               `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=mph&forecast_days=1`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
    const json = await res.json();
    return { results: Array.isArray(json) ? json : [json], error: null };
  } catch (err) {
    console.warn('[data-service] loadWindLayer fetch fault:', err.message);
    return { results: [], error: err.message };
  }
}

// ─── 9. PURPLEAIR SENSORS ─────────────────────────────────────────────────────

export async function loadPurpleAirSensors(bbox) {
  const params = new URLSearchParams({
    nwlng: bbox.west,
    nwlat: bbox.north,
    selng: bbox.east,
    selat: bbox.south,
  });

  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/purpleair-sensors?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        signal: AbortSignal.timeout(14000),
      }
    );
    if (!res.ok) throw new Error('Edge Function HTTP ' + res.status);
    const json = await res.json();
    return { fields: json.fields || [], data: json.data || [], error: null };
  } catch (err) {
    console.warn('[data-service] loadPurpleAirSensors fault:', err.message);
    return { fields: [], data: [], error: err.message };
  }
}

// ─── 10. ATTACHMENT UPLOAD ────────────────────────────────────────────────────

export async function uploadFieldPhotoBatch(files, opts = {}) {
  const { entityId, orgSlug, committeeSlug, uploadedBy, caption, isPublic = true, metadata } = opts;

  if (!entityId) {
    console.error('[data-service] uploadFieldPhotoBatch: opts.entityId is required.');
    return { attached: [], errors: [{ file: '*', reason: 'opts.entityId is required' }] };
  }

  const attached = [];
  const errors   = [];

  for (const file of Array.from(files)) {
    const timestamp = Date.now();
    const cleanBase = file.name
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 50);

    const ext         = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
    const storagePath = `${orgSlug}/${committeeSlug}/${timestamp}-${cleanBase}.${ext}`;

    const { error: uploadError } = await _db.storage
      .from(FIELD_PHOTOS_BUCKET)
      .upload(storagePath, file, { cacheControl: '3600', upsert: false });

    if (uploadError) {
      console.error('[data-service] Storage upload failed:', uploadError.message);
      errors.push({ file: file.name, reason: uploadError.message });
      continue;
    }

    const attachmentRow = {
      entity_id:    entityId,
      storage_path: storagePath,
      is_public:    isPublic,
      ...(uploadedBy && { uploaded_by: uploadedBy }),
      ...(caption    && { caption }),
    };

    if (metadata && typeof metadata === 'object') {
      attachmentRow.metadata = metadata;
    }

    const { error: dbError } = await _db
      .from('entity_attachments')
      .insert(attachmentRow);

    if (dbError) {
      console.error('[data-service] entity_attachments insert failed:', dbError.message);
      errors.push({ file: file.name, reason: dbError.message });
      console.warn('[data-service] Orphaned storage object:', storagePath);
      continue;
    }

    const { data: urlData } = _db.storage
      .from(FIELD_PHOTOS_BUCKET)
      .getPublicUrl(storagePath);

    attached.push({ storagePath, publicUrl: urlData.publicUrl });
  }

  return { attached, errors };
}

// ─── 10a. BOUNDARIES (UNNC / SLO base map polygons) ──────────────────────────
// Calls the get_boundaries_as_geojson RPC (see boundaries_rpc.sql) since
// boundaries.geometry is a PostGIS `geography` column — the same reason
// fetchSpatialData() above goes through an RPC instead of a plain select().
//
// @param {string} [boundaryType] - e.g. 'unnc' or 'slo'. Confirm these match
//   the actual values stored in boundaries.boundary_type — adjust callers
//   if your data uses different strings.
export async function fetchBoundaries(boundaryType) {
  const { data, error } = await _db
    .rpc('get_boundaries_as_geojson', { filter_type: boundaryType });

  if (error) {
    console.error('[data-service] fetchBoundaries RPC fault:', error.message);
    return { geojson: null, error: error.message };
  }

  return { geojson: data, error: null };
}

// ─── 10b. ATTACHMENT FETCH ──────────────────────────────────────────────────
// Param renamed entityId (was spatialRegistryId): v_unified_attachments' inner
// join to spatial_registry was silently dropping any attachment whose
// entity_id pointed at a map_annotations row instead. The corrected view
// drops that join and exposes entity_id directly, so this now works
// identically for spatial_registry and map_annotations records — same call
// site in admin-app.js, no caller-side change needed.
export async function fetchAttachments(entityId) {
  const { data, error } = await _db
    .from('v_unified_attachments')
    .select('id, entity_id, storage_path, caption')
    .eq('entity_id', entityId)
    .order('id', { ascending: true });

  if (error) {
    console.error('[data-service] fetchAttachments fault:', error.message);
    return { rows: [], error: error.message };
  }

  return { rows: data || [], error: null };
}

// ─── 10b-i. SINGLE ATTACHMENT DELETE ─────────────────────────────────────────
// v_unified_attachments (fetchAttachments, above) reads from TWO different
// base tables depending on domain — spatial_registry rows attach through
// entity_attachments (FK: entity_id), but v_annotations_expanded/tree rows
// attach through a separate `photos` table (FK: annotation_id). The view
// hides that difference for reads; deletes have to target the real table,
// so this needs the same per-domain mapping deleteAssetRecord() already
// uses below. If you add attachments for a new domain, add it here too.
const ATTACHMENT_TABLE_REGISTRY = {
  'spatial_registry':       { table: 'entity_attachments', bucket: 'field-photos' },
  'v_annotations_expanded': { table: 'photos',              bucket: 'crime-photos' },
};

// Deletes ONE attachment row (a single broken/unwanted photo or document),
// not the whole parent record — for that, use deleteAssetRecord() below.
// Storage cleanup is attempted but non-fatal: a "broken link" attachment by
// definition often has no real object left to remove, so a storage miss
// here is expected, not an error condition.
// ─── 10b-ii. LINK ATTACHMENT (external URL, no file upload) ────────────────
// (2026-07-28) "+ Add Link" in the Edit drawer — attaches an external URL to
// a record's gallery without uploading anything to Storage.
//
// Hardened against the link-based attack surface relevant here:
//   • Script-executing pseudo-protocols. javascript: is the obvious one;
//     data: is blocked too because a data:text/html;base64,... payload
//     executes the same way once opened, and vbscript:/file: have no
//     legitimate reason to appear in a "paste a link to a report" field.
//     Enforced as an explicit http/https ALLOWLIST — not a blocklist — so a
//     scheme nobody's thought of yet can't slip through by omission.
//   • Malformed/obfuscated strings that merely LOOK like a URL. Parsing via
//     the native URL constructor (not a regex) means anything that doesn't
//     actually parse gets rejected outright, and what's stored afterward is
//     `parsed.href` — the browser's own normalized/encoded form of the
//     input, not the raw string the admin typed.
//   • Reverse tabnabbing on the render side. This function only handles
//     validation + storage; admin-app.js's _renderAttachmentGallery is
//     responsible for rendering the resulting <a> with
//     target="_blank" rel="noopener noreferrer", and for re-running this
//     SAME validation at render time — not just on submit — so a link that
//     reached the DB some other way (direct SQL edit, a future bulk import)
//     still can't render as a clickable javascript:/data: URI. See that
//     function's comments for the render-side half of this contract.
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:']);

export function validateLinkUrl(rawUrl) {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { ok: false, url: null, reason: 'URL is empty.' };
  }
  if (trimmed.length > 2048) {
    return { ok: false, url: null, reason: 'URL is too long (2048 character limit).' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_e) {
    return { ok: false, url: null, reason: 'Not a valid URL — include the full address, e.g. https://example.com/report.pdf' };
  }

  if (!ALLOWED_LINK_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, url: null, reason: `"${parsed.protocol}" links aren't allowed here — only http:// and https:// links can be attached.` };
  }

  return { ok: true, url: parsed.href, reason: null };
}

// entity_attachments only — same domain scope as attachAssetToExistingRecord
// in fpp-service.js (v_annotations_expanded/map_annotations' `photos` table
// isn't wired for this yet). Caller should confirm _currentDomain ===
// 'spatial_registry' before calling, same as the photo-upload path.
export async function addLinkAttachment(entityId, rawUrl, caption = null) {
  if (!entityId) {
    return { id: null, error: 'entityId is required — this is the id of the record the link belongs to.' };
  }

  const { ok, url, reason } = validateLinkUrl(rawUrl);
  if (!ok) {
    return { id: null, error: reason };
  }

  const attachmentRow = {
    entity_id:    entityId,
    // Storing the full external URL directly in storage_path (there's no
    // Storage object behind a link, so no bucket path to build). Safe with
    // the existing storage-cleanup helpers: _extractStoragePath() in this
    // file only recognizes strings matching the Supabase "/public/<bucket>/"
    // URL shape or a bare image-extension path — an arbitrary external URL
    // matches neither, so it's silently skipped during storage cleanup
    // rather than misinterpreted as a bucket object to delete.
    storage_path: url,
    is_public:    true,
    metadata:     { asset_kind: 'link', source: 'manual_link_attach' },
    ...(caption && { caption }),
  };

  const { data: newRow, error: dbError } = await _db
    .from('entity_attachments')
    .insert(attachmentRow)
    .select('id')
    .single();

  if (dbError) {
    console.error('[data-service] addLinkAttachment: insert failed:', dbError.message);
    return { id: null, error: dbError.message };
  }

  return { id: newRow.id, error: null };
}

export async function deleteAttachment(attachmentId, domainKey) {
  const mapping = ATTACHMENT_TABLE_REGISTRY[domainKey];
  if (!mapping) {
    throw new Error(`[data-service] No attachment table registered for domain: "${domainKey}"`);
  }
  const { table, bucket } = mapping;

  // .maybeSingle() — same tolerance as deleteAssetRecord's pre-fetch: an
  // already-gone row here (e.g. a double-click, or someone else cleaned it
  // up first) is harmless, not an error.
  const { data: row, error: fetchErr } = await _db
    .from(table)
    .select('storage_path')
    .eq('id', attachmentId)
    .maybeSingle();

  if (fetchErr) {
    console.warn('[data-service] deleteAttachment: pre-fetch warning:', fetchErr.message);
  }

  if (row?.storage_path) {
    const classified = _extractStoragePath(row.storage_path, bucket);
    if (classified) {
      try {
        const { error: storErr } = await _db.storage.from(classified.bucket).remove([classified.path]);
        if (storErr) {
          console.warn('[data-service] deleteAttachment: storage removal error —', storErr.message || storErr);
        }
      } catch (storageEx) {
        console.warn('[data-service] deleteAttachment: storage removal threw —', storageEx.message || storageEx);
      }
    }
  }

  const { error: dbError, count: deletedCount } = await _db
    .from(table)
    .delete({ count: 'exact' })
    .eq('id', attachmentId);

  if (dbError) throw dbError;
  if (deletedCount === 0) {
    // Same RLS-blind-spot risk as deleteAssetRecord — no error, zero rows
    // affected. Log clearly rather than let a blocked delete look like a
    // successful one at the call site.
    console.warn('[data-service] deleteAttachment: DELETE affected 0 rows for id', attachmentId, '— RLS may be blocking this delete silently, or the row was already gone.');
  }

  return { success: true };
}

// ─── 10c. RECORD GROUPING (lifecycle joins) ──────────────────────────────────
// Generic, table-agnostic mechanism for "one pin, many records" — e.g. a tree
// pin whose history is tree → dead → stump, each stage its own row with its
// own metadata/photo, sharing a group_id, with exactly one row per group
// flagged is_active_parent (the one rendered as the map pin). Re-parenting
// later is two row updates regardless of group size — no cascading rewrites.
//
// Requires (run once per table you want this on):
//   ALTER TABLE <table> ADD COLUMN group_id uuid;
//   ALTER TABLE <table> ADD COLUMN is_active_parent boolean NOT NULL DEFAULT true;
//   UPDATE <table> SET group_id = id WHERE group_id IS NULL;
//   ALTER TABLE <table> ALTER COLUMN group_id SET NOT NULL;

/**
 * Join two or more existing records into one group. The chosen parent keeps
 * (or starts) the group_id that all members will share; every other selected
 * record is demoted to is_active_parent = false under that same group_id.
 * Nothing is deleted — every record's own columns/metadata stay intact.
 *
 * @param {string} baseTable  Real table name, e.g. 'map_annotations' (NOT a view)
 * @param {string} parentId   id of the record to become the active parent
 * @param {string[]} memberIds  All selected ids, including parentId
 */
/**
 * Postgres error 42703 = undefined_column. All three grouping functions hit
 * group_id/is_active_parent immediately, so this single check catches "this
 * table hasn't been migrated for grouping yet" everywhere it can occur and
 * turns a raw DB fault into something a user can act on.
 */
function _friendlyGroupingError(error, baseTable) {
  if (error?.code === '42703') {
    return `"${baseTable}" doesn't have grouping columns yet — run the group_id / is_active_parent migration on this table first.`;
  }
  return error?.message || 'Unknown database error';
}

export async function joinRecordsAsGroup(baseTable, parentId, memberIds) {
  if (!baseTable || !parentId || !Array.isArray(memberIds) || memberIds.length === 0) {
    return { success: false, error: 'baseTable, parentId, and at least one memberId are required' };
  }

  const allIds = Array.from(new Set([parentId, ...memberIds]));

  // Fetch current group_id for EVERY record being merged, not just the
  // parent. A selected member may already anchor its own pre-existing group
  // (e.g. it already has a child attached from an earlier join). Without
  // this, only the explicitly-selected rows moved into the new group and
  // any such child was left behind pointing at a group_id nothing else
  // referenced anymore — silently vanishing from the lifecycle history and
  // off the map. (Found 2026-08-06 testing removeFromGroup; see handoff.)
  const { data: rows, error: fetchErr } = await _db
    .from(baseTable)
    .select('id, group_id')
    .in('id', allIds);

  if (fetchErr || !rows || rows.length === 0) {
    const msg = _friendlyGroupingError(fetchErr, baseTable);
    console.error('[data-service] joinRecordsAsGroup fetch fault:', msg);
    return { success: false, error: msg };
  }

  const parentRow = rows.find(r => r.id === parentId);
  if (!parentRow) {
    return { success: false, error: 'Parent record not found.' };
  }

  // Reuse the parent's existing group_id if it already anchors a group;
  // otherwise the parent becomes the root of a brand-new group.
  const groupId = parentRow.group_id || parentRow.id;

  // Every OLD group any of the merged records already anchored. Cascading
  // these forward is what pulls along children that weren't explicitly
  // selected in the join dialog — the actual fix for the missing-child bug.
  const oldGroupIds = rows
    .map(r => r.group_id)
    .filter(gid => gid && gid !== groupId);

  if (oldGroupIds.length > 0) {
    const { error: cascadeErr } = await _db
      .from(baseTable)
      .update({ group_id: groupId, is_active_parent: false })
      .in('group_id', oldGroupIds);

    if (cascadeErr) {
      console.error('[data-service] joinRecordsAsGroup cascade fault:', cascadeErr.message);
      return { success: false, error: cascadeErr.message };
    }
  }

  // Explicitly cover the selected records themselves too — needed for any
  // member that was fully standalone (group_id null/unset), which the
  // cascade above wouldn't have matched on its own.
  const { error: memberUpdateErr } = await _db
    .from(baseTable)
    .update({ group_id: groupId, is_active_parent: false })
    .in('id', allIds);

  if (memberUpdateErr) {
    console.error('[data-service] joinRecordsAsGroup member update fault:', memberUpdateErr.message);
    return { success: false, error: memberUpdateErr.message };
  }

  const { error: parentUpdateErr } = await _db
    .from(baseTable)
    .update({ is_active_parent: true })
    .eq('id', parentId);

  if (parentUpdateErr) {
    console.error('[data-service] joinRecordsAsGroup parent update fault:', parentUpdateErr.message);
    return { success: false, error: parentUpdateErr.message };
  }

  return { success: true, groupId };
}

/**
 * Re-parent a group: a different member becomes the one visible pin / active
 * record (e.g. a "tree" record demoted, its "stump" record promoted). Exactly
 * two UPDATE statements regardless of how many records are in the group.
 *
 * @param {string} baseTable
 * @param {string} groupId
 * @param {string} newParentId  Must already belong to groupId
 */
export async function promoteToParent(baseTable, groupId, newParentId) {
  if (!baseTable || !groupId || !newParentId) {
    return { success: false, error: 'baseTable, groupId, and newParentId are required' };
  }

  const { error: demoteErr } = await _db
    .from(baseTable)
    .update({ is_active_parent: false })
    .eq('group_id', groupId);

  if (demoteErr) {
    const msg = _friendlyGroupingError(demoteErr, baseTable);
    console.error('[data-service] promoteToParent demote fault:', msg);
    return { success: false, error: msg };
  }

  // Scoped to .eq('group_id', groupId) as well — refuses to promote a record
  // that doesn't actually belong to this group, even if a bad id is passed in.
  const { error: promoteErr, count } = await _db
    .from(baseTable)
    .update({ is_active_parent: true })
    .eq('id', newParentId)
    .eq('group_id', groupId);

  if (promoteErr) {
    console.error('[data-service] promoteToParent promote fault:', promoteErr.message);
    return { success: false, error: promoteErr.message };
  }

  return { success: true };
}

/**
 * Fetch every record sharing a group_id, oldest first — the full lifecycle
 * history for one physical pin (e.g. tree → dead → stump).
 *
 * @param {string} baseTable
 * @param {string} groupId
 */
export async function fetchGroupMembers(baseTable, groupId) {
  if (!baseTable || !groupId) {
    return { rows: [], error: 'baseTable and groupId are required' };
  }

  const { data, error } = await _db
    .from(baseTable)
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });

  if (error) {
    const msg = _friendlyGroupingError(error, baseTable);
    console.error('[data-service] fetchGroupMembers fault:', msg);
    return { rows: [], error: msg };
  }

  return { rows: data || [], error: null };
}

/**
 * Fully detach one member from a group, restoring it to a standalone record
 * (group_id = its own id, is_active_parent = true). The counterpart to
 * joinRecordsAsGroup — currently the only way out of a group is
 * promoteToParent, which re-parents but never actually shrinks the group.
 *
 * Refuses to remove the current active parent — promote a different member
 * first (existing promoteToParent action), otherwise the remaining members
 * would be left with no active parent and nothing would render on the map.
 *
 * If removing the member leaves exactly one record behind, that record is
 * also reset to its own group_id — a "group" of one is just an ungrouped
 * record, and leaving it pointed at a group_id that no longer matches its
 * own id would be a dangling reference of the same shape as the storage
 * orphan issues found in the 2026-08-06 cleanup session.
 *
 * @param {string} baseTable
 * @param {string} groupId
 * @param {string} memberId  Must currently belong to groupId and NOT be is_active_parent
 */
export async function removeFromGroup(baseTable, groupId, memberId) {
  if (!baseTable || !groupId || !memberId) {
    return { success: false, error: 'baseTable, groupId, and memberId are required' };
  }

  const { data: memberRow, error: fetchErr } = await _db
    .from(baseTable)
    .select('id, group_id, is_active_parent')
    .eq('id', memberId)
    .eq('group_id', groupId)
    .maybeSingle();

  if (fetchErr) {
    const msg = _friendlyGroupingError(fetchErr, baseTable);
    console.error('[data-service] removeFromGroup fetch fault:', msg);
    return { success: false, error: msg };
  }

  if (!memberRow) {
    return { success: false, error: 'That record does not belong to this group.' };
  }

  if (memberRow.is_active_parent) {
    return {
      success: false,
      error: 'This record is the active parent — promote a different member first, then remove this one.'
    };
  }

  const { error: removeErr } = await _db
    .from(baseTable)
    .update({ group_id: memberId, is_active_parent: true })
    .eq('id', memberId);

  if (removeErr) {
    console.error('[data-service] removeFromGroup update fault:', removeErr.message);
    return { success: false, error: removeErr.message };
  }

  // Collapse a now-orphaned group of one back to a plain standalone record.
  const { data: remaining, error: remainingErr } = await _db
    .from(baseTable)
    .select('id')
    .eq('group_id', groupId);

  if (!remainingErr && Array.isArray(remaining) && remaining.length === 1) {
    const lastId = remaining[0].id;
    const { error: collapseErr } = await _db
      .from(baseTable)
      .update({ group_id: lastId, is_active_parent: true })
      .eq('id', lastId);
    if (collapseErr) {
      // Non-fatal: the primary removal already succeeded. This is just
      // tidiness for the last remaining member's group_id.
      console.warn('[data-service] removeFromGroup: could not collapse final group member:', collapseErr.message);
    }
  }

  return { success: true };
}

// ─── 11. REALTIME SUBSCRIPTION ───────────────────────────────────────────────

export function subscribeToSpatialRegistry(onEvent, existingChannel = null) {
  if (existingChannel) {
    _db.removeChannel(existingChannel);
  }

  return _db
    .channel('registry-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'spatial_registry' },
      onEvent
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('[data-service] realtime channel active on spatial_registry');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[data-service] realtime channel error:', err?.message || status);
      }
    });
}

// ─── 12. CASCADING DELETION ENGINE ───────────────────────────────────────────

// Recognizes heic/heif in addition to the always-supported web formats —
// iPhone field photos are frequently raw HEIC, and a photo_url ending in
// .heic was previously failing this test, silently skipping it from the
// delete-from-storage queue (root cause of orphaned originals surviving a
// "successful" table-view deletion).
const _IMAGE_EXT_RE_DS = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;

// Exported so asset-url-resolver.js (and any other module that needs to know
// which bucket a domain's photos live in) can read the same mapping the
// deletion engine uses, instead of keeping a second, separately-maintained copy.
export const DOMAIN_DELETION_REGISTRY = {
  'spatial_registry': {
    baseTable:     'spatial_registry',
    primaryBucket: 'field-photos',
  },
  'v_annotations_expanded': {
    baseTable:     'map_annotations',
    primaryBucket: 'crime-photos',
  },
  'greening_projects': {
    baseTable:     'greening_projects',
    primaryBucket: 'field-photos',
  },
};

function _extractStoragePath(rawVal, primaryBucket) {
  if (!rawVal || typeof rawVal !== 'string') return null;
  let v = rawVal.trim();
  if (!v) return null;

  if (v.startsWith('https://') || v.startsWith('http://')) {
    if (!_IMAGE_EXT_RE_DS.test(v)) return null;
    const publicIdx = v.indexOf('/public/');
    if (publicIdx === -1) return null;
    const afterPublic = v.slice(publicIdx + '/public/'.length);
    const slashIdx    = afterPublic.indexOf('/');
    if (slashIdx === -1) return null;
    const urlBucket = afterPublic.slice(0, slashIdx);
    const filePath  = afterPublic.slice(slashIdx + 1);
    if (!filePath || !_IMAGE_EXT_RE_DS.test(filePath)) return null;
    return { bucket: urlBucket, path: filePath };
  }

  if (!_IMAGE_EXT_RE_DS.test(v)) return null;
  const clean = v.replace(/^\/+/, '');
  const bucket = (clean.startsWith('Field_IMG') || clean.startsWith('field_img'))
    ? 'field-photos'
    : primaryBucket;
  return { bucket, path: clean };
}

function _collectPath(rawVal, primaryBucket, acc) {
  const classified = _extractStoragePath(rawVal, primaryBucket);
  if (!classified) return;
  if (!acc.has(classified.bucket)) acc.set(classified.bucket, []);
  acc.get(classified.bucket).push(classified.path);
}

export async function deleteAssetRecord(recordId, domainKey) {
  const mapping = DOMAIN_DELETION_REGISTRY[domainKey];
  if (!mapping) {
    throw new Error(`[data-service] No deletion mapping registered for domain: "${domainKey}"`);
  }

  const { baseTable, primaryBucket } = mapping;

  // .maybeSingle() (not .single()) — this pre-fetch already tolerates the
  // record being gone (see `if (record) {...}` below), so demanding exactly
  // one row via .single() was the wrong call: it makes PostgREST return a
  // 406 whenever the row's already been deleted (e.g. a retried delete, or
  // stale UI state), which is harmless but shows up as a scary-looking
  // network error in the console. .maybeSingle() returns null on zero rows
  // with no error at all — same tolerance, no noise.
  const { data: record, error: fetchErr } = await _db
    .from(baseTable)
    .select('*')
    .eq('id', recordId)
    .maybeSingle();

  if (fetchErr) {
      console.warn('[data-service] deleteAssetRecord: pre-fetch warning:', fetchErr.message);
  }

  const acc = new Map();

  if (record) {
    _collectPath(record.photo_url, primaryBucket, acc);
    // (2026-08-06) thumbnail_url is a separate storage object from photo_url
    // (see fpp-service.js's renderImageVariants reference/thumb tiers) — it
    // was never collected here, so every record with a generated thumbnail
    // leaked that file into storage on delete. Same bucket as photo_url
    // (both tiers upload to targetBucket together), so primaryBucket is
    // correct for this too.
    _collectPath(record.thumbnail_url, primaryBucket, acc);
    try {
      const meta = typeof record.metadata === 'string' ? JSON.parse(record.metadata) : record.metadata;
      if (meta && typeof meta === 'object') {
        _collectPath(meta.url, primaryBucket, acc);
        _collectPath(meta.storage_path, primaryBucket, acc);
        if (Array.isArray(meta.attachments)) {
          for (const att of meta.attachments) {
            const candidate = (att && typeof att === 'object') ? (att.storage_path || att.path || att.url || null) : att;
            _collectPath(candidate, primaryBucket, acc);
          }
        }
      }
    } catch (_e) {}
  }

  if (domainKey === 'spatial_registry') {
    try {
      const { data: eaRows, error: eaErr } = await _db
        .from('entity_attachments')
        .select('storage_path, metadata')
        .eq('entity_id', recordId);
      if (!eaErr && Array.isArray(eaRows)) {
        eaRows.forEach(r => {
          _collectPath(r.storage_path, primaryBucket, acc);
          // (2026-08-06, corrected) entity_attachments has no dedicated
          // thumbnail_url COLUMN — per attachAssetToExistingRecord's own
          // comment in fpp-service.js, the thumb URL is preserved inside
          // metadata.thumbnail_url (JSONB) instead. Original fix wrongly
          // selected a top-level thumbnail_url column that doesn't exist
          // (confirmed by a live 42703 error) — reading it out of metadata
          // here instead.
          try {
            const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
            if (meta && meta.thumbnail_url) _collectPath(meta.thumbnail_url, primaryBucket, acc);
          } catch (_e) {}
        });
      }
    } catch (e) {}
  }

  if (domainKey === 'v_annotations_expanded') {
    try {
      const { data: photoRows, error: photoErr } = await _db
        .from('photos')
        .select('storage_path')
        .eq('annotation_id', recordId);
      if (photoErr) {
        console.error('[data-service] deleteAssetRecord: photos table read failed (storage cleanup for this record will be incomplete):', photoErr.message || photoErr);
      } else if (Array.isArray(photoRows)) {
        photoRows.forEach(r => _collectPath(r.storage_path, primaryBucket, acc));
      }
    } catch (e) {
      console.error('[data-service] deleteAssetRecord: photos table read exception:', e.message || e);
    }
  }

  for (const [bucket, paths] of acc.entries()) {
    if (!paths.length) continue;
    try {
      const { error: storErr } = await _db.storage.from(bucket).remove(paths);
      if (storErr) {
        // Non-fatal: storage object may already be gone. Log but continue so
        // the DB row delete still runs rather than aborting the whole operation.
        console.warn('[data-service] deleteAssetRecord: storage removal error for bucket', bucket, '—', storErr.message || storErr);
      }
    } catch (storageEx) {
      console.warn('[data-service] deleteAssetRecord: storage removal threw for bucket', bucket, '—', storageEx.message || storageEx);
    }
  }

  if (domainKey === 'spatial_registry') {
    const { error: eaDeleteErr } = await _db.from('entity_attachments').delete().eq('entity_id', recordId);
    if (eaDeleteErr) {
      // Non-fatal orphan risk: the registry row will still be deleted below,
      // but these attachment rows will be left behind. Log clearly so it can
      // be caught during ops review rather than silently compounding.
      console.error('[data-service] deleteAssetRecord: entity_attachments cleanup failed — rows may be orphaned:', eaDeleteErr.message || eaDeleteErr);
    }
  }

  if (domainKey === 'v_annotations_expanded') {
    const { error: photosDeleteErr } = await _db.from('photos').delete().eq('annotation_id', recordId);
    if (photosDeleteErr) {
      console.error('[data-service] deleteAssetRecord: photos row cleanup failed — row left orphaned:', photosDeleteErr.message || photosDeleteErr);
    }
  }

  const { error: dbError, count: deletedCount } = await _db
    .from(baseTable)
    .delete({ count: 'exact' })
    .eq('id', recordId);
  if (dbError) throw dbError;
  if (deletedCount === 0) {
    // RLS can silently block a delete: no error is raised, but 0 rows are
    // removed. This makes a failed delete look identical to a successful one
    // at the call site. Log prominently so it surfaces during ops review.
    // Root cause is most likely a missing DELETE policy for the current role.
    console.warn('[data-service] deleteAssetRecord: DELETE affected 0 rows for id', recordId, '— RLS may be blocking this delete silently.');
  }

  return { success: true };
}