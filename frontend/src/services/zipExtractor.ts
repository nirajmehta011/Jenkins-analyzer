import JSZip from 'jszip';

export interface ExtractedFile {
  name: string;
  content: string;
  size: number;
}

const TEXT_EXTENSIONS = ['.log', '.txt', '.xml', '.json', '.out', '.err', '.csv'];

/**
 * Extract all text files from a ZIP file.
 * Returns concatenated content with file separators.
 */
export async function extractZipFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const extractedFiles: ExtractedFile[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;

    const isTextFile = TEXT_EXTENSIONS.some((ext) =>
      path.toLowerCase().endsWith(ext)
    );
    const hasNoExtension = !path.split('/').pop()?.includes('.');

    if (isTextFile || hasNoExtension) {
      try {
        const content = await entry.async('text');
        extractedFiles.push({
          name: path,
          content,
          size: content.length,
        });
      } catch {
        // Skip binary files
      }
    }
  }

  if (extractedFiles.length === 0) {
    throw new Error('No text files found in ZIP archive');
  }

  return extractedFiles
    .map((f) => `\n=== FILE: ${f.name} ===\n${f.content}`)
    .join('\n');
}

/**
 * Check if a file is a ZIP archive by extension.
 */
export function isZipFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.zip');
}

/**
 * Get list of files in a ZIP without extracting content.
 */
export async function listZipContents(file: File): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((path) => !zip.files[path].dir);
}
