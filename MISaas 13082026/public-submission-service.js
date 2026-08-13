/**
 * public-submission-service.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles the public "Report Concern" intake flow on the community dashboard.
 *
 * REWRITE (2026-07-02) — hybrid matrix approach.
 * spatial_registry stays the single hub; anon is treated as just another
 * permission-restricted caller against it, the same way admin staff and
 * Field Officers are, not as a caller who needs its own parallel table.
 *
 * Previous design (now abandoned): wrote to a separate `public_comments`
 * staging table. That table was a dead end — nothing in admin-app.js ever
 * read it, so submissions were invisible to review. This version writes
 * directly into spatial_registry with status='draft', which is the exact
 * same shape Field Officer records already use ("someone reports something
 * that needs review before it's live") — so a public submission shows up
 * for free in the admin table/Edit popup with zero new review UI, and stays
 * invisible on the public dashboard for free too (its anon SELECT policy
 * already excludes drafts).
 *
 * REWRITE (2026-08-12) — moved off direct table insert onto an RPC.
 * The RLS-policy-as-boundary design described below (kept here for
 * history) turned out to have a real gap: two other permissive anon
 * INSERT policies existed on spatial_registry from an earlier version of
 * this flow and were never dropped, which meant the "draft-only" policy
 * was silently unenforced — any caller hitting the REST API directly
 * (not through this file) could insert a row with any status, any
 * organization_id, anywhere in the world. Audited and fixed 2026-08-12.
 *
 * The boundary is now `submit_public_concern()`, a SECURITY DEFINER
 * Postgres function (see 02-submit-public-concern-rpc.sql) that:
 *   - looks up organization_id server-side from the org slug, rather than
 *     trusting a client-passed id
 *   - forces status='draft' — not overridable by any argument
 *   - rejects a location outside the org's real coverage area (geofence)
 *   - strips control characters and invisible/bidi-override unicode from
 *     every free-text field before it's stored
 * spatial_registry's direct INSERT grant for `anon` has been revoked
 * entirely — this file's `.rpc()` call below is now the only path a
 * public submission can take into the table, at the database level, not
 * just by policy.
 *
 * Design contract carried over:
 *   • Reuses the SAME anon Supabase client instance dashboard-app.js already
 *     created (passed in as `sb`) — never creates a second client.
 *   • group_id = id (self) for a standalone ungrouped record — same
 *     client-generated convention submitCreateRecord/commitCsvBatch use,
 *     since group_id is NOT NULL with no DB-side default.
 *   • committee_slug is derived from the category's group via
 *     GROUP_COMMITTEE_SLUG[CATEGORY_MAP[category].group] — identical
 *     convention to submitCreateRecord, not a separate public-only mapping.
 *   • 2026-07-30: NO guard against a resolved committee_slug belonging to
 *     a different org than the submitting org's tab (unlike
 *     submitCreateRecord's own guard rail, which still enforces this on
 *     the admin/staff creation path). This was previously blocked — a
 *     citizen on the JPW tab couldn't report a Trees & Parks (UNNC-only)
 *     concern at all — but per Sun's call, public intake now allows any
 *     category from any org's tab. organization_id keeps the submitting
 *     tab's org; committee_slug is still correctly derived from the
 *     category. The resulting org_id/committee_slug mismatch is expected
 *     and left for admin review to sort out at publish time, not treated
 *     as an error.
 *   • title is optional on the public form (unlike the admin Create Record
 *     form, which requires it) — spatial_registry's title column still
 *     needs a value, so a blank title gets a client-generated fallback
 *     ("{category label} reported") rather than blocking the submission.
 *   • Photo handling is intentionally NOT changed to admin's field-photos/
 *     attachments pipeline in this pass — that pipeline's storage policies
 *     are written for the authenticated admin client, and anon write access
 *     there hasn't been confirmed. Photos still go to the pre-existing,
 *     anon-writable `public-submissions` bucket — but as of 2026-07-13 are
 *     resized into the same reference/thumbnail tiers fpp-service.js's
 *     admin pipeline uses (shared logic in image-resize.js) rather than
 *     uploaded raw, with paths recorded in metadata.public_photo_path and
 *     metadata.public_photo_thumb_path. Unlike the admin pipeline, a resize
 *     failure here drops the photo attachment entirely rather than falling
 *     back to the raw original — see _uploadSubmissionPhoto's docstring for
 *     why an anonymous, unauthenticated form gets a stricter guarantee than
 *     a trusted admin upload. Surfacing these photos in admin's popup/table
 *     thumbnail resolution is a follow-up tied to the existing
 *     resolveAssetUrl domain-awareness fix already queued — not solved
 *     here, to avoid layering a second bucket onto a resolver that's
 *     already known to be incomplete.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CATEGORY_MAP, GROUP_COMMITTEE_SLUG, SHARED_NO_COMMITTEE_GROUPS } from './config.js';
import { renderImageVariants, DEFAULT_REFERENCE_VARIANT, DEFAULT_THUMB_VARIANT } from './image-resize.js';

const PUBLIC_SUBMISSIONS_BUCKET = 'public-submissions';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB client-side cap

/**
 * Validates a File before upload. Returns an error string, or null if OK.
 * Photo is optional — passing no file is valid.
 */
export function validateSubmissionPhoto(file) {
  if (!file) return null;
  if (!file.type || !file.type.startsWith('image/')) {
    return 'Please attach an image file (JPG, PNG, HEIC, or WEBP).';
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return 'That photo is too large — please attach one under 8MB.';
  }
  return null;
}

/**
 * Resizes (reference + thumbnail tiers — same shared logic and default
 * sizes fpp-service.js's admin field-photo pipeline uses, see
 * image-resize.js) and uploads a public submission's photo to the
 * public-submissions bucket. Returns { photoPath, thumbPath } — both
 * storage paths (NOT public URLs; the bucket is private, admin reads them
 * later via an authenticated Storage SELECT policy). Returns
 * { photoPath: null, thumbPath: null } if no file was given.
 *
 * DELIBERATELY DIFFERENT from fpp-service.js's failure behavior: if the
 * resize/decode fails (HEIC on a non-Safari browser is the known case —
 * see image-resize.js's docstring), this does NOT fall back to uploading
 * the raw original. fpp-service.js's admin pipeline can afford that
 * fallback — a trusted, authenticated user on their own device, where an
 * occasional multi-megabyte original is an acceptable rare exception. This
 * is a public, unauthenticated form facing arbitrary browsers/devices with
 * no way to follow up if something goes wrong — the entire point of this
 * change (2026-07-13) is guaranteeing storage/egress stay capped, so a
 * resize failure here instead drops the photo attachment (already optional
 * on this form, see validateSubmissionPhoto) and lets the text report
 * continue without one, rather than either uploading an uncapped original
 * or failing the whole submission over an image quirk.
 */
async function _uploadSubmissionPhoto(sb, file) {
  if (!file) return { photoPath: null, thumbPath: null };

  let refVariant, thumbVariant;
  try {
    [refVariant, thumbVariant] = await renderImageVariants(file, [
      DEFAULT_REFERENCE_VARIANT,
      DEFAULT_THUMB_VARIANT,
    ]);
  } catch (resizeErr) {
    console.warn(
      '[public-submission-service] Photo resize failed — submitting without a photo rather than uploading an uncapped original:',
      resizeErr.message
    );
    return { photoPath: null, thumbPath: null };
  }

  const basePath  = `submissions/${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const photoPath = `${basePath}.${refVariant.ext}`;
  const thumbPath = `${basePath}_thumb.${thumbVariant.ext}`;

  const { error: refError } = await sb.storage.from(PUBLIC_SUBMISSIONS_BUCKET).upload(photoPath, refVariant.blob, {
    contentType: refVariant.blob.type,
    upsert:      false,
  });
  if (refError) throw refError;

  const { error: thumbError } = await sb.storage.from(PUBLIC_SUBMISSIONS_BUCKET).upload(thumbPath, thumbVariant.blob, {
    contentType: thumbVariant.blob.type,
    upsert:      false,
  });
  if (thumbError) {
    // The reference photo already landed successfully above — a failed
    // thumbnail upload shouldn't sink the whole submission (same
    // non-fatal-thumbnail philosophy fpp-service.js uses). The reference
    // tier alone is still a perfectly usable photo for admin review.
    console.warn('[public-submission-service] Thumbnail upload failed — proceeding with reference photo only:', thumbError.message);
    return { photoPath, thumbPath: null };
  }

  return { photoPath, thumbPath };
}

/**
 * Submits a "Report Concern" entry directly into spatial_registry as a
 * status='draft' row.
 *
 * @param {object} sb - the dashboard's existing anon Supabase client
 * @param {object} fields
 *   {
 *     organizationId,   // _orgs[_activeOrgSlug].id — becomes the row's organization_id
 *     organizationSlug,  // _activeOrgSlug — accepted but unused by this function
 *                        // as of 2026-07-30 (previously validated committee_slug
 *                        // against it; that guard was removed, see file header)
 *     categoryValue, title, notes, address, lat, lng, contactEmail, photoFile,
 *     contactName,       // optional — reporter's name (2026-08-12 addition)
 *     contactPhone,      // optional — reporter's phone (2026-08-12 addition)
 *     metadata,          // optional extra JSONB to merge in (e.g. subtype fields
 *                        // from CATEGORY_SUBTYPES) — merged, never overwrites
 *                        // the reserved keys below
 *     isSensitive,       // optional bool — reporter checked "keep my exact
 *                        // location private" (2026-07-06 feature). When true:
 *                        //  - metadata.is_sensitive is set explicitly, which
 *                        //    _resolveIsSensitive() in admin-app.js already
 *                        //    treats as authoritative over CATEGORY_MAP's
 *                        //    sensitiveDefault — no admin-side logic changes.
 *                        //  - metadata.reporter_marked_sensitive records that
 *                        //    this was the reporter's own choice, not a
 *                        //    category default, for admin triage context.
 *                        //  - metadata.address_precision = 'exact' flags that
 *                        //    the stored address/geom is the reporter's raw,
 *                        //    unfuzzed input. This does NOT gate public
 *                        //    display (dashboard-app.js hides the address
 *                        //    for ANY is_sensitive record, blanket rule,
 *                        //    2026-07-06 simplification) — it's admin-only
 *                        //    triage context, warning that if "Sensitive"
 *                        //    is later unchecked while this flag is still
 *                        //    set, the exact raw address would then be
 *                        //    shown publicly as-is. admin-app.js clears it
 *                        //    only when the address text is actually
 *                        //    edited and saved.
 *   }
 * @returns {Promise<string>} the new record's id
 *
 * Uploads the photo first (if present) so a failed INSERT doesn't leave the
 * UI in a confusing half-submitted state — same rationale as before: a
 * stray uploaded file with no DB row is cheap to reconcile later; a DB row
 * pointing at a photo that never finished uploading is a broken link with
 * no retry path from the UI.
 */
export async function submitPublicConcern(sb, fields) {
  const photoValidationError = validateSubmissionPhoto(fields.photoFile);
  if (photoValidationError) throw new Error(photoValidationError);

  if (!fields.categoryValue) throw new Error('Please choose a category.');
  if (fields.lat == null || fields.lng == null) throw new Error('Please set a location on the map first.');
  if (!fields.organizationSlug) throw new Error('Could not determine which organization this belongs to — please refresh and try again.');
  // organizationId is no longer sent to the server (2026-08-12) —
  // submit_public_concern() resolves the real organization_id itself from
  // organizationSlug rather than trusting a client-passed id.

  // committee_slug — same derivation convention as submitCreateRecord.
  // traffic_infra, env_health, culture_comm are shared cross-org groups
  // with no dedicated committee (2026-07-02 decision) — a null lookup for
  // one of those proceeds with committee_slug: null, not an error.
  const categoryGroup = CATEGORY_MAP[fields.categoryValue]?.group;
  const committeeSlug = GROUP_COMMITTEE_SLUG[categoryGroup] || null;
  if (!committeeSlug && !SHARED_NO_COMMITTEE_GROUPS.includes(categoryGroup)) {
    throw new Error(`This category isn't mapped to a committee yet — please choose a different category or contact us directly.`);
  }

  // 2026-07-30: Deliberately NO org/committee cross-check here (this used
  // to mirror submitCreateRecord's guard and block e.g. a Trees & Parks
  // category while on the JPW tab). Public intake now allows reporting ANY
  // category from ANY org's tab — organization_id stays whatever tab the
  // citizen happened to be on (fields.organizationId, set below via the
  // existing payload), while committee_slug is still correctly derived
  // from the category itself just above. This intentionally permits an
  // org_id/committee_slug combination that wouldn't be allowed on the
  // admin/staff creation path (e.g. organization_id = JPW with
  // committee_slug = 'tree-committee') — Sun's call, since admins already
  // review every draft submission before publish and can correct/reassign
  // org_id at that point if needed. Do not re-add this guard without
  // checking that decision first.

  const { photoPath, thumbPath } = await _uploadSubmissionPhoto(sb, fields.photoFile);

  // Reporter-elected sensitivity wins over the category default, same
  // precedence _resolveIsSensitive() already applies on the admin side —
  // setting metadata.is_sensitive explicitly here means no admin-side
  // resolver logic needs to change for this to take effect.
  const reporterMarkedSensitive = !!fields.isSensitive;
  const isSensitiveVal = reporterMarkedSensitive
    ? true
    : (CATEGORY_MAP[fields.categoryValue]?.sensitiveDefault ?? false);

  const metadataPayload = {
    ...(fields.metadata || {}),
    source: 'public',
    is_sensitive: isSensitiveVal,
  };
  if (reporterMarkedSensitive) {
    metadataPayload.reporter_marked_sensitive = true;
    // Address/geom below are the reporter's raw, unfuzzed input — flag it so
    // the public dashboard withholds display until an admin reviews/saves
    // the record. admin-app.js only clears it when the address text is
    // actually edited and saved — publishing/approving alone does not.
    metadataPayload.address_precision = 'exact';
    metadataPayload.address_history = [{
      at: new Date().toISOString(),
      by: 'public',
      action: 'initial_submission',
      to_coords: { lat: Number(fields.lat), lng: Number(fields.lng) },
      to_address: fields.address?.trim() || null,
      skip_reason: 'sensitive_public_intake',
    }];
  }
  if (fields.contactEmail?.trim()) metadataPayload.reporter_email = fields.contactEmail.trim();
  if (photoPath) metadataPayload.public_photo_path = photoPath;
  // Same "not yet displayed anywhere" caveat as public_photo_path itself
  // (see this file's top-of-file docstring) — stored now so it's already
  // in place whenever the resolveAssetUrl thumbnail-resolution follow-up
  // happens, rather than needing a second backfill pass over existing rows.
  if (thumbPath) metadataPayload.public_photo_thumb_path = thumbPath;

  // 2026-08-12: title fallback, the description_notes NOT NULL guard,
  // status, address fallback, and text sanitization all moved server-side
  // into submit_public_concern() — this file no longer has (or needs) a
  // trusted path into spatial_registry, so there's no value in duplicating
  // that logic here. titleVal above is still computed for reference but
  // isn't sent — the RPC applies the same "{category label} reported"
  // fallback itself if title comes through empty.
  const { data: newRowId, error } = await sb.rpc('submit_public_concern', {
    p_organization_slug: fields.organizationSlug,
    p_category_value:    fields.categoryValue,
    p_committee_slug:    committeeSlug,
    p_title:             fields.title?.trim() || null,
    p_notes:             fields.notes?.trim() || null,
    p_address:           fields.address?.trim() || null,
    p_lat:                Number(fields.lat),
    p_lng:                Number(fields.lng),
    p_reporter_name:     fields.contactName?.trim() || null,
    p_reporter_phone:    fields.contactPhone?.trim() || null,
    p_reporter_email:    fields.contactEmail?.trim() || null,
    p_metadata:          metadataPayload,
  });
  if (error) throw error;
  return newRowId;
}
