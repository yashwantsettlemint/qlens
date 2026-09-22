"""OpenCV preprocessing, applied before every OCR call. Matters more with a
self-hosted engine than a cloud API — less built-in tolerance for messy input.

cv2 / numpy are imported lazily so importing this module (tests) is cheap.
"""

from __future__ import annotations

from .config import OCR_MAX_DESKEW_DEG, OCR_UPSCALE


def preprocess(image):
    """np.ndarray (BGR or gray) -> deskewed, denoised, binarised, upscaled gray."""
    import cv2

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    gray = _deskew(gray)
    denoised = cv2.fastNlMeansDenoising(gray, h=10)
    binarised = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
    )
    if OCR_UPSCALE and abs(OCR_UPSCALE - 1.0) > 1e-6:
        binarised = cv2.resize(
            binarised, None, fx=OCR_UPSCALE, fy=OCR_UPSCALE, interpolation=cv2.INTER_CUBIC
        )
    # PaddleOCR's pipeline expects H×W×3 — hand back a 3-channel image.
    return cv2.cvtColor(binarised, cv2.COLOR_GRAY2BGR)


def _deskew(gray):
    """Estimate skew from the text pixels (Otsu-thresholded foreground) and
    rotate to level. Skips when the estimate is unreliable — near-blank pages,
    or an implausibly large angle (> OCR_MAX_DESKEW_DEG) which means the estimate
    is garbage rather than a genuinely rotated invoice.
    """
    import cv2
    import numpy as np

    try:
        thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        coords = np.column_stack(np.where(thr > 0))
        if len(coords) < 50:
            return gray
        angle = cv2.minAreaRect(coords)[-1]
        angle = -(90 + angle) if angle < -45 else -angle
        if abs(angle) > OCR_MAX_DESKEW_DEG:
            return gray
        h, w = gray.shape
        m = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
        return cv2.warpAffine(
            gray, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
        )
    except Exception:
        return gray
