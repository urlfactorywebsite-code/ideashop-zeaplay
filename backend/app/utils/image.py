"""Image helper utilities."""

from __future__ import annotations

from io import BytesIO
from typing import Optional, Tuple

from PIL import Image, ImageOps


def probe_image_dimensions(data: bytes) -> Tuple[Optional[int], Optional[int]]:
    """Return (width, height) if Pillow can parse the bytes, else (None, None)."""
    try:
        with Image.open(BytesIO(data)) as img:
            adjusted = ImageOps.exif_transpose(img)
            return adjusted.width, adjusted.height
    except Exception:
        return None, None
