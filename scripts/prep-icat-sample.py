"""
Prepare a compact, viewer-ready sample from the real i-CAT dental CBCT
(Medimodel "Class 3 malocclusion", JPEG-compressed). Steps:

  1. read ImagePositionPatient from every slice (header only) and sort by z,
  2. pick COUNT evenly-spaced slices spanning the whole scan,
  3. decompress each (dcmdjpeg) and downsample in-plane to TARGET×TARGET,
  4. save as uncompressed Explicit VR Little Endian, keeping the original tags
     (incl. the de-identification sequences — good for testing sequence-skip),
  5. write index.json manifest.

The full 640×640×518 series is ~425 MB; this trimmed/downsampled preview is a
few MB while staying a real dental scan. Requires dcmtk (dcmdjpeg) on PATH and
pydicom + numpy + pillow.

Usage: python scripts/prep-icat-sample.py <src DICOM dir> <out dir>
"""

import json
import os
import subprocess
import sys

import numpy as np
import pydicom
from PIL import Image

TARGET = 256  # in-plane size (from 640)
COUNT = 80  # slices to keep, evenly spaced across the scan
DCMDJPEG = "/opt/homebrew/bin/dcmdjpeg"

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

# 1. sort slices by patient-z (header only — no pixel decode needed).
items = []
for name in os.listdir(src):
    path = os.path.join(src, name)
    if not os.path.isfile(path):
        continue
    try:
        ds = pydicom.dcmread(path, stop_before_pixels=True, force=True)
        z = float(ds.ImagePositionPatient[2])
        items.append((z, path))
    except Exception:
        pass  # skip DICOMDIR / non-image files
items.sort()
print(f"found {len(items)} slices")

# 2. pick COUNT evenly-spaced slices.
idx = np.unique(np.linspace(0, len(items) - 1, COUNT).round().astype(int))
selected = [items[i] for i in idx]

tmp = "/tmp/icat_decompressed.dcm"
names = []
for k, (_z, path) in enumerate(selected):
    # 3. decompress + downsample.
    subprocess.run([DCMDJPEG, path, tmp], check=True, capture_output=True)
    ds = pydicom.dcmread(tmp)
    arr = ds.pixel_array.astype(np.float32)
    small = np.asarray(Image.fromarray(arr).resize((TARGET, TARGET), Image.BILINEAR))
    small = np.clip(np.round(small), 0, 65535).astype(np.uint16)

    src_cols = int(ds.Columns)
    ds.Rows = TARGET
    ds.Columns = TARGET
    ps = [float(x) for x in ds.PixelSpacing]
    ds.PixelSpacing = [ps[0] * src_cols / TARGET, ps[1] * src_cols / TARGET]
    ds.PixelData = small.tobytes()
    for t in ("SmallestImagePixelValue", "LargestImagePixelValue"):
        if t in ds:
            delattr(ds, t)

    # 4. save uncompressed Explicit VR LE (dcmdjpeg already produced that syntax).
    name = f"slice_{k:03d}.dcm"
    ds.save_as(os.path.join(out, name), enforce_file_format=True)
    names.append(name)

# 5. manifest (reversed, so the loader's position sort is exercised).
json.dump(list(reversed(names)), open(os.path.join(out, "index.json"), "w"))
total = sum(os.path.getsize(os.path.join(out, n)) for n in names)
print(f"wrote {len(names)} slices, {TARGET}x{TARGET}  ->  {total / 1048576:.1f} MB")
