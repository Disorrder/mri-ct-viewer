/**
 * Collect every file from a drag-and-drop, descending into dropped folders.
 *
 * A DICOM series is a *folder* of one-file-per-slice (unlike a single .nii), so
 * we walk directory entries via the webkit FileSystem API. Falls back to the
 * flat `DataTransfer.files` list when entry traversal isn't available.
 */
export async function gatherFiles(dt: DataTransfer): Promise<File[]> {
  const entries = dt.items
    ? Array.from(dt.items)
        .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
        .filter((e): e is FileSystemEntry => e !== null)
    : [];

  if (entries.length === 0) {
    return dt.files ? Array.from(dt.files) : [];
  }

  const files: File[] = [];
  for (const entry of entries) await walkEntry(entry, files);
  // Skip hidden/sidecar files (e.g. ".DS_Store") that aren't image slices.
  return files.filter((f) => !f.name.startsWith("."));
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await fileOf(entry as FileSystemFileEntry);
    out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most ~100 entries per call, so loop until it's dry.
    for (;;) {
      const batch = await readEntries(reader);
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, out);
    }
  }
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}
