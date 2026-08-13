/**
 * image-resize.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared client-side image resize/re-encode helper. No server-side image
 * transform, no Supabase Image Transformations dependency (Pro-plan
 * feature, 403s on this project's free tier) — pure canvas.
 *
 * Extracted 2026-07-13 from fpp-service.js's original single-file
 * `_renderImageVariants` so every upload path that needs to cap stored
 * photo size (the admin field-photo pipeline, the public "Report a
 * Concern" form, and any future one) shares the exact same resize
 * mechanics and the exact same default tier sizes — one source of truth,
 * so "every photo in the app gets the same two tiers" is actually
 * guaranteed rather than something two separately-maintained copies happen
 * to agree on today.
 *
 * No DOM reads beyond what resizing itself requires (Image/canvas) — no
 * network calls, no Supabase client, no map references.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Default tiers — used by both fpp-service.js (admin field photos) and
// public-submission-service.js (public "Report a Concern" photos) unless a
// caller has a specific reason to override. Keeping these here rather than
// re-declared per-file means a future decision to change the reference
// resolution, say, only has to happen once.
export const DEFAULT_REFERENCE_VARIANT = { maxDimension: 1800, quality: 0.82 };
export const DEFAULT_THUMB_VARIANT     = { maxDimension: 320,  quality: 0.7  };

/**
 * Decodes an image file ONCE via an offscreen <img>/canvas, then renders it
 * at each requested {maxDimension, quality} — avoids decoding the same
 * source image multiple times, which matters on a mobile browser (a field
 * officer working through a photo batch, or a public reporter on a phone).
 *
 * Each variant tries WebP first (better compression at a given quality than
 * JPEG), falling back to JPEG per-variant using an explicit blob.type check
 * rather than trusting canvas.toBlob()'s own behavior: per spec, toBlob()
 * silently returns a PNG — not a JPEG — when the requested MIME type isn't
 * supported, which would silently produce larger files than intended on
 * older Safari.
 *
 * Never enlarges a smaller source image — a screenshot or already-small
 * photo passes through a given variant at its native size, just re-encoded.
 *
 * KNOWN LIMITATION: HEIC/HEIF files only decode here on Safari/macOS/iOS
 * (the only engines with native HEIC image-decoding support). On
 * Chrome/Windows (or Android browsers without HEIC support) img.onload
 * simply never fires for a HEIC file, and this rejects after a short
 * timeout — a silent miss, not a crash. Callers should treat a rejection as
 * "fall back to the raw file, or drop the attachment" rather than failing
 * the whole operation — which of those two is appropriate depends on the
 * caller's trust model (see fpp-service.js vs public-submission-service.js
 * for the two different calls made on this same limitation).
 *
 * @param   {File} file       Raw uploaded asset
 * @param   {{maxDimension:number, quality:number}[]} variants
 * @returns {Promise<{blob:Blob, ext:'webp'|'jpg'}[]>}  Same length/order as
 *   `variants`. Rejects (does not resolve a partial array) if the source
 *   can't be decoded at all, or if any single variant's canvas encode fails.
 */
export function renderImageVariants(file, variants) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(objectUrl);

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Image decode timed out (likely an undecodable format, e.g. HEIC on a non-Safari browser)'));
    }, 8000);

    const img = new Image();
    img.onload = async () => {
      clearTimeout(timeoutId);
      try {
        const results = [];
        for (const { maxDimension, quality } of variants) {
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDimension) { height *= maxDimension / width; width = maxDimension; }
          } else {
            if (height > maxDimension) { width *= maxDimension / height; height = maxDimension; }
          }

          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width);
          canvas.height = Math.round(height);
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          // A blank canvas defaults to transparent black, so any source pixel
          // with alpha < 1 (a cropped/annotated screenshot with transparent
          // padding or rounded corners) would otherwise flatten onto black
          // once re-encoded as WebP/JPEG below, since neither format
          // supports transparency. Filling white first is a no-op for
          // fully-opaque images and fixes that case for free.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const variantResult = await new Promise((res) => {
            canvas.toBlob((webpBlob) => {
              if (webpBlob && webpBlob.type === 'image/webp') {
                res({ blob: webpBlob, ext: 'webp' });
                return;
              }
              canvas.toBlob((jpegBlob) => {
                res(jpegBlob ? { blob: jpegBlob, ext: 'jpg' } : null);
              }, 'image/jpeg', quality);
            }, 'image/webp', quality);
          });

          if (!variantResult) {
            throw new Error('Canvas compression produced an empty blob (both WebP and JPEG attempts failed)');
          }
          results.push(variantResult);
        }
        cleanup();
        resolve(results);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
    img.onerror = () => {
      clearTimeout(timeoutId);
      cleanup();
      reject(new Error('Image failed to decode for resize'));
    };
    img.src = objectUrl;
  });
}
