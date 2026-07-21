/**
 * Guards against zip-bomb uploads: a small compressed archive that expands
 * to an enormous amount of data in memory. multer's fileSize limit only
 * bounds the *compressed* upload size, which does nothing against a high
 * compression-ratio archive.
 */
import type JSZip from 'jszip';

// Defaults sized for a constrained ~512MB-1GB hosting instance (e.g. Render's
// free/Starter tier), not just "big enough to stop an obvious zip-bomb". A
// single request's real resident memory (zipBuffer + JSZip's internal entry
// graph + string-copy overhead from repeated .replace()/.split() passes) runs
// well above the raw decompressed-byte count these limits track — roughly
// 2-3x in practice — so these are set with that overhead multiplier in mind,
// not just a raw "how much text is too much" guess. Override via env var on
// a larger-RAM deployment.
export const MAX_ZIP_ENTRY_UNCOMPRESSED_MB = parseInt(process.env['MAX_ZIP_ENTRY_UNCOMPRESSED_MB'] || '25', 10);
export const MAX_ZIP_TOTAL_UNCOMPRESSED_MB = parseInt(process.env['MAX_ZIP_TOTAL_UNCOMPRESSED_MB'] || '150', 10);

const MAX_ENTRY_BYTES = MAX_ZIP_ENTRY_UNCOMPRESSED_MB * 1024 * 1024;
const MAX_TOTAL_BYTES = MAX_ZIP_TOTAL_UNCOMPRESSED_MB * 1024 * 1024;

export class ZipBombError extends Error {}

/**
 * JSZip has no public API for an entry's declared uncompressed size before
 * decompression, but it does parse the ZIP central directory's
 * uncompressedSize field into a `_data` property during loadAsync(). This is
 * an internal/undocumented field (jszip's own index.d.ts comments it out as
 * "if/when made public"), but it has been stable for years and is the
 * standard way to reject an obvious zip bomb before ever decompressing it —
 * JSZip has no public streaming-with-size-limit API. Access is defensive:
 * if this shape ever changes, it just returns undefined and callers fall
 * back to the post-decompression checkActual() safety net below.
 */
export function getDeclaredUncompressedSize(entry: JSZip.JSZipObject): number | undefined {
  const internal = entry as unknown as { _data?: { uncompressedSize?: number } };
  return internal._data?.uncompressedSize;
}

/**
 * Tracks cumulative decompressed bytes across a single archive's entries and
 * throws once either the per-entry or aggregate limit is exceeded. Call
 * `checkDeclared` with the entry's central-directory uncompressed size
 * *before* decompressing (cheap, catches obvious bombs early), and
 * `checkActual` with the real decompressed length afterward (catches
 * archives that lie about their declared size).
 */
export class ZipSizeTracker {
  private totalBytes = 0;

  checkDeclared(path: string, declaredUncompressedSize: number | undefined): void {
    if (declaredUncompressedSize === undefined) return;

    if (declaredUncompressedSize > MAX_ENTRY_BYTES) {
      throw new ZipBombError(
        `Zip entry "${path}" would decompress to ${(declaredUncompressedSize / 1024 / 1024).toFixed(1)} MB, ` +
        `exceeding the ${MAX_ZIP_ENTRY_UNCOMPRESSED_MB} MB per-file limit.`
      );
    }
    if (this.totalBytes + declaredUncompressedSize > MAX_TOTAL_BYTES) {
      throw new ZipBombError(
        `Zip archive would decompress past the ${MAX_ZIP_TOTAL_UNCOMPRESSED_MB} MB total size limit.`
      );
    }
  }

  checkActual(path: string, actualBytes: number): void {
    this.totalBytes += actualBytes;

    if (actualBytes > MAX_ENTRY_BYTES) {
      throw new ZipBombError(
        `Zip entry "${path}" decompressed to ${(actualBytes / 1024 / 1024).toFixed(1)} MB, ` +
        `exceeding the ${MAX_ZIP_ENTRY_UNCOMPRESSED_MB} MB per-file limit.`
      );
    }
    if (this.totalBytes > MAX_TOTAL_BYTES) {
      throw new ZipBombError(
        `Zip archive decompressed past the ${MAX_ZIP_TOTAL_UNCOMPRESSED_MB} MB total size limit.`
      );
    }
  }
}
