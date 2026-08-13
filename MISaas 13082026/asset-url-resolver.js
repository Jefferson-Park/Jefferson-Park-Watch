// asset-url-resolver.js
// ─────────────────────────────────────────────────────────────────────────────
// Universal image URL safety utility for the Mapping Innovations platform.
//
// PURPOSE
// -------
// Database columns like photo_url, storage_path, website, and metadata JSONB
// fields are heterogeneous: they can hold fully-qualified image URLs, naked
// filenames, Supabase bucket-relative paths, website domains, HTML page routes,
// or plain text slugs. Passing any of these blindly into an <img src="...">
// attribute causes the browser to fire HTTP requests against strings that are
// not valid image endpoints — producing a flood of 400 Bad Request console
// errors for values like 'kazuo-inouye', 'crenshaw-theatre.html', 'explore',
// 'stjosephctr.org', and '2800-jefferson'.
//
// This module provides a single function, resolveAssetUrl(), that every
// image-rendering site in the application must call before constructing an
// <img> element or setting img.src. If resolveAssetUrl() returns null, no
// image element should be created — render a fallback icon (📁 or 📷) instead.
//
// DOMAIN AWARENESS
// -----------------
// Bucket choice for a bare filename depends on which domain the record
// belongs to — 'spatial_registry' and 'greening_projects' photos live in
// 'field-photos', but 'v_annotations_expanded' (map_annotations) photos live
// in 'crime-photos'. That mapping is NOT duplicated here; it's imported
// directly from DOMAIN_DELETION_REGISTRY in data-service.js, the same table
// the cascading-deletion engine already uses, so there is exactly one source
// of truth for "which bucket does this domain's photos live in." Callers
// must pass the current domainKey ('spatial_registry', 'v_annotations_expanded',
// or 'greening_projects') for bare-filename resolution to work — without it,
// resolveAssetUrl() returns null rather than guessing a bucket.
//
// ROUTING RULES (applied in this exact order)
// --------------------------------------------
//  1. Null / empty / non-string input         → null
//  2. Fully-qualified http(s) URL             → only accepted if the URL also
//     (starts with http:// or https://)          ends in a recognised image
//                                                extension (.jpg .jpeg .png
//                                                .gif .webp). Domain strings
//                                                like 'https://stjosephctr.org'
//                                                are rejected here.
//  3. String ends in a document extension     → ATTACHMENTS_BUCKET, always,
//     (.pdf .doc .docx .xls .xlsx)               regardless of domain — only
//                                                the fpp-service.js attachment
//                                                pipeline writes these, and it
//                                                always uses this one bucket.
//  4. String ends in an image extension       → classified by filename, not
//     (naked filename or bucket-relative path)   by folder structure (both
//                                                'field-photos' and
//                                                'crime-photos' contain their
//                                                own nested subfolders, so
//                                                presence of a '/' is not a
//                                                useful signal):
//                                                 • Field_IMG* / field_img* prefix
//                                                   → field-photos, always,
//                                                     regardless of domain
//                                                 • anything else
//                                                   → DOMAIN_DELETION_REGISTRY
//                                                     [domainKey].primaryBucket
//                                                 • no domainKey passed and no
//                                                   Field_IMG prefix → null
//                                                   (don't guess a bucket)
//  5. Everything else                         → null
//     (slugs, .html routes, domain names,
//      UUIDs without extension, bare words)
//
// USAGE
// -----
//   import { resolveAssetUrl, resolveRowThumb } from './asset-url-resolver.js';
//
//   // Single path — domainKey is whichever of 'spatial_registry',
//   // 'v_annotations_expanded', or 'greening_projects' the row belongs to:
//   const src = resolveAssetUrl(row.photo_url, domainKey);
//   if (src) {
//     const img = document.createElement('img');
//     img.src = src;
//     container.appendChild(img);
//   } else {
//     container.textContent = '📁';
//   }
//
//   // Full row scan (walks all standard candidate fields + metadata JSONB):
//   const src = resolveRowThumb(row, domainKey);
// ─────────────────────────────────────────────────────────────────────────────

import { DOMAIN_DELETION_REGISTRY } from './data-service.js';
import { ATTACHMENTS_BUCKET } from './config.js';

const _SUPABASE_PROJECT = 'sqiioihssmnqatjrednq';
const _SUPABASE_BASE    = `https://${_SUPABASE_PROJECT}.supabase.co/storage/v1/object/public`;
const _IMAGE_EXT_RE     = /\.(jpg|jpeg|png|gif|webp)$/i;

// Document attachments ("+ Add Photo" in the Edit drawer also accepts these
// per admin.html's accept="...,.pdf,.doc,.docx,.xls,.xlsx" — see
// fpp-service.js's attachAssetToExistingRecord). These never carry a
// Field_IMG/field_img prefix and never match _IMAGE_EXT_RE, so without this
// rule they fell through to "return null" at Rule 4 regardless of domainKey —
// resolveAssetUrl had no route to ATTACHMENTS_BUCKET at all. (2026-07-30)
const _DOCUMENT_EXT_RE  = /\.(pdf|docx?|xlsx?)$/i;

/**
 * Resolve a single raw database string into a safe, absolute image URL.
 *
 * @param  {*}      rawVal     — Any value from a database column or JSONB field.
 * @param  {string} [domainKey] — One of 'spatial_registry', 'v_annotations_expanded',
 * 'greening_projects'. Required for bare-filename resolution of non-Field_IMG
 * files — without it, those resolve to null instead of guessing a bucket.
 * @returns {string|null}   — An absolute https:// image URL, or null if the
 * value cannot be safely rendered as an image.
 */
export function resolveAssetUrl(rawVal, domainKey) {
  if (!rawVal || typeof rawVal !== 'string') return null;

  const v = rawVal.trim();
  if (!v) return null;

  // ── Rule 2: fully-qualified URL ───────────────────────────────────────────
  if (v.startsWith('https://') || v.startsWith('http://')) {
    // Accept ONLY if the URL path ends in a recognised image extension.
    // This rejects bare domains ('https://stjosephctr.org'), web pages
    // ('https://example.com/explore'), and redirect URLs that happen to
    // start with https but don't serve an image directly.
    return _IMAGE_EXT_RE.test(v) ? v : null;
  }

  // ── Rule 3: naked filename or bucket-relative path ────────────────────────
  const clean = v.replace(/^\/+/, ''); // strip any leading slashes

  // Rule 3a: document attachments — domain-agnostic, same reasoning as the
  // Field_IMG special case just below: only one pipeline (fpp-service.js's
  // attachAssetToExistingRecord) ever writes non-image files, and it always
  // sends them to ATTACHMENTS_BUCKET regardless of which domain/table the
  // parent record belongs to, so no domainKey lookup is needed or correct
  // here.
  if (_DOCUMENT_EXT_RE.test(clean)) {
    return `${_SUPABASE_BASE}/${ATTACHMENTS_BUCKET}/${clean}`;
  }

  if (!_IMAGE_EXT_RE.test(clean)) return null; // slug / .html / UUID / domain → block

  // Field photos from the FPP pipeline carry this filename prefix regardless
  // of which domain they're attached to — always field-photos, no domain
  // lookup needed. NOTE: this is a filename-prefix check, not a folder check —
  // both buckets contain their own nested subfolders, so a '/' in the path
  // says nothing about which bucket the file lives in.
  if (clean.startsWith('Field_IMG') || clean.startsWith('field_img')) {
    return `${_SUPABASE_BASE}/field-photos/${clean}`;
  }

  // Everything else routes by domain, via the same DOMAIN_DELETION_REGISTRY
  // the cascading-deletion engine reads — one source of truth, no separate
  // bucket-exclusion list here.
  const bucket = domainKey && DOMAIN_DELETION_REGISTRY[domainKey]
    ? DOMAIN_DELETION_REGISTRY[domainKey].primaryBucket
    : null;

  if (!bucket) return null; // no domain context — don't guess a bucket

  return `${_SUPABASE_BASE}/${bucket}/${clean}`;
}

/**
 * Walk all standard candidate fields on a database row and return the first
 * resolvable image URL. Falls back into metadata JSONB if direct fields yield
 * nothing. Returns null if no safe image URL can be found anywhere on the row.
 *
 * @param  {object} row          — A raw database row object (spatial_registry, etc.).
 * @param  {string} [domainKey]  — 'spatial_registry', 'v_annotations_expanded', or
 * 'greening_projects'. Passed through to resolveAssetUrl() for bucket lookup.
 * @returns {string|null}
 */
export function resolveRowThumb(row, domainKey) {
  if (!row || typeof row !== 'object') return null;

  // ── Pass 1: direct field candidates ──────────────────────────────────────
  const directFields = [
    row.photo_url,
    row.photoUrl,
    row.preview_url,
    row.thumbnail,
    row.file_url,
    row.media_url,
  ];

  for (const candidate of directFields) {
    const resolved = resolveAssetUrl(candidate, domainKey);
    if (resolved) return resolved;
  }

  // ── Pass 2: metadata JSONB deep scan ─────────────────────────────────────
  try {
    const meta = typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : row.metadata;

    if (meta && typeof meta === 'object') {
      // Scalar keys
      const fromScalar = resolveAssetUrl(meta.url, domainKey) || resolveAssetUrl(meta.storage_path, domainKey);
      if (fromScalar) return fromScalar;

      // Attachments array — each element may be a plain path string or an object
      if (Array.isArray(meta.attachments)) {
        for (const att of meta.attachments) {
          const candidate = (att && typeof att === 'object')
            ? (att.storage_path || att.path || att.url || null)
            : att;
          const resolved = resolveAssetUrl(candidate, domainKey);
          if (resolved) return resolved;
        }
      }
    }
  } catch (_e) {
    // Malformed JSONB — skip silently; don't surface parse errors in the UI
  }

  return null;
}

/**
 * Convenience: render an image element or a fallback icon into a container.
 * Handles onerror replacement automatically.
 *
 * @param {HTMLElement} container — The DOM element to append into.
 * @param {string|null} src       — The resolved URL from resolveAssetUrl() or resolveRowThumb().
 * @param {object}      [opts]    — Optional overrides: { width, height, className, rawPath }
 */
export function renderAssetOrFallback(container, src, opts = {}) {
  const {
    width     = '100px',
    height    = '100px',
    className = 'img-thumbnail m-1',
    rawPath   = '',           // original unresolved value, used as title tooltip on fallback icons
    fallback  = '📁',
  } = opts;

  if (src) {
    const img = document.createElement('img');
    img.src         = src;
    img.className   = className;
    img.style.width = width;
    img.style.height = height;
    img.style.objectFit = 'cover';
    img.style.cursor    = 'pointer';
    img.addEventListener('click', () => window.open(src, '_blank'));
    img.onerror = () => {
      // Swap broken image for the fallback icon — don't leave a broken-image glyph
      const icon = document.createElement('span');
      icon.textContent  = fallback;
      icon.style.cssText = `font-size:${width === '32px' ? '14px' : '28px'}; display:inline-block; margin:4px; vertical-align:middle;`;
      icon.title = rawPath || src;
      img.replaceWith(icon);
    };
    container.appendChild(img);
  } else {
    // No valid image resolved — render the fallback icon immediately
    const icon = document.createElement('span');
    icon.textContent  = fallback;
    icon.style.cssText = 'font-size:28px; display:inline-block; margin:4px; vertical-align:middle; cursor:default;';
    icon.title = rawPath || 'No image';
    container.appendChild(icon);
  }
}