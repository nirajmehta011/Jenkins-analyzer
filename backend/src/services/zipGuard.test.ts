import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { ZipSizeTracker, ZipBombError, getDeclaredUncompressedSize, MAX_ZIP_ENTRY_UNCOMPRESSED_MB, MAX_ZIP_TOTAL_UNCOMPRESSED_MB } from './zipGuard';

describe('getDeclaredUncompressedSize', () => {
  it('reads the real uncompressed size from a loaded zip entry before decompression', async () => {
    const zip = new JSZip();
    const payload = 'hello world'.repeat(1000); // 11,000 bytes
    zip.file('a.txt', payload);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const loaded = await JSZip.loadAsync(buffer);
    const entry = loaded.files['a.txt'];
    expect(getDeclaredUncompressedSize(entry)).toBe(payload.length);
  });
});

describe('ZipSizeTracker', () => {
  it('allows entries within both per-file and aggregate limits', () => {
    const tracker = new ZipSizeTracker();
    expect(() => tracker.checkDeclared('a.log', 1024)).not.toThrow();
    expect(() => tracker.checkActual('a.log', 1024)).not.toThrow();
  });

  it('rejects a single entry that declares more than the per-file limit (zip-bomb preflight)', () => {
    const tracker = new ZipSizeTracker();
    const bombBytes = (MAX_ZIP_ENTRY_UNCOMPRESSED_MB + 1) * 1024 * 1024;
    expect(() => tracker.checkDeclared('bomb.log', bombBytes)).toThrow(ZipBombError);
  });

  it('rejects once the aggregate across many entries exceeds the total limit', () => {
    // Mirrors the real per-entry call order used in analyze.ts: checkDeclared
    // (preflight) then checkActual (post-decompression, which is what
    // actually commits to the running total) for each entry in sequence.
    const tracker = new ZipSizeTracker();
    const chunkBytes = 50 * 1024 * 1024; // 50 MB per entry, under the per-file cap
    const entriesNeeded = Math.ceil((MAX_ZIP_TOTAL_UNCOMPRESSED_MB * 1024 * 1024) / chunkBytes) + 1;

    expect(() => {
      for (let i = 0; i < entriesNeeded; i++) {
        tracker.checkDeclared(`file-${i}.log`, chunkBytes);
        tracker.checkActual(`file-${i}.log`, chunkBytes);
      }
    }).toThrow(ZipBombError);
  });

  it('checkActual also rejects an entry that decompressed larger than declared (lying entry)', () => {
    const tracker = new ZipSizeTracker();
    const bombBytes = (MAX_ZIP_ENTRY_UNCOMPRESSED_MB + 1) * 1024 * 1024;
    // No declared size known — only the post-decompression check catches it.
    expect(() => tracker.checkActual('bomb.log', bombBytes)).toThrow(ZipBombError);
  });
});
