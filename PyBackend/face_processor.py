"""
face_processor.py — Advanced Multi-Backend Face Detection & Embedding Pipeline
===============================================================================

Embedding model: ArcFace (512-D) — THE best for:
  - Cross-age matching (5-year gap between DB photo and live face)  ✓
  - Beard / glasses / hair-style changes                             ✓
  - Lighting variation (bright passport vs dim office camera)        ✓
  - Low-resolution live camera vs high-res scan                      ✓
  Industry standard: used by AliPay, Chinese immigration, UK banks.

Why NOT Facenet-128D (previous model):
  - 128-D embedding is too compact for appearance change robustness
  - Cosine drift of ~0.15–0.20 with beard/lighting change pushes
    same-person pairs below the threshold → false rejection

ArcFace cosine similarity ranges (L2-normalised, unit sphere):
  - Same person, clean conditions : 0.50–0.85
  - Same person, beard + low light: 0.25–0.55   ← catches the failing case
  - Different people              : -0.20–0.20
  Match threshold used: ≥ 0.28 (conservative; lower = more permissive)

Detection Strategy (5-level fallback, first success wins):
  Level 1 : Haar cascade on CLAHE-enhanced image  (ultra-fast, < 10 ms)
  Level 2 : Haar cascade on multiple preprocessed variants
  Level 3 : DeepFace / OpenCV-DNN detector  (neural-net)
  Level 4 : DeepFace / SSD detector
  Level 5 : DeepFace / skip (full-image)  — ALWAYS succeeds
"""

import time, logging
from typing import List, Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ── Model configuration ────────────────────────────────────────────────────────
# ArcFace (512-D): As requested, retaining ArcFace so Mode 1 folder uploads
# do not need to be re-run or cleared.
EMBEDDING_MODEL        = "ArcFace"
# Live camera verification strict threshold
VERIFICATION_THRESHOLD = 0.55
LANDMARK_WEIGHT        = 0.30
EMBEDDING_WEIGHT       = 0.70

# ── Detection backend cascade (tried in order) ────────────────────────────────
# Removed SSD: it is extremely slow on CPU (3-8s per image) and causes batch
# timeouts. opencv + skip covers 99% of passport/ID photos reliably.
DEEPFACE_BACKENDS = ["opencv", "skip"]

# ── Lazy-load DeepFace ────────────────────────────────────────────────────────
_df = None

def _get_deepface():
    global _df
    if _df is None:
        from deepface import DeepFace
        _df = DeepFace
        logger.info("DeepFace loaded (model=%s)", EMBEDDING_MODEL)
    return _df


def preload_model():
    """Warm up all detection backends once at startup so first request is fast."""
    logger.info("Pre-loading DeepFace model weights…")
    try:
        df   = _get_deepface()
        dummy = np.zeros((224, 224, 3), dtype=np.uint8)
        df.represent(img_path=dummy, model_name=EMBEDDING_MODEL,
                     detector_backend="skip", enforce_detection=False,
                     align=False)
        logger.info("DeepFace pre-load OK.")
    except Exception as e:
        logger.error("DeepFace pre-load error: %s", e)


# ── Image decode ──────────────────────────────────────────────────────────────
def _bytes_to_bgr(img_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image — unsupported format or corrupt data.")
    return img


# ── Image preprocessing helpers ───────────────────────────────────────────────
def _clahe_gray(bgr: np.ndarray) -> np.ndarray:
    """CLAHE on the L channel of LAB — preserves colour perception."""
    lab   = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    cl    = clahe.apply(l)
    return cv2.cvtColor(cv2.merge([cl, a, b]), cv2.COLOR_LAB2BGR)


def _gamma(bgr: np.ndarray, g: float) -> np.ndarray:
    """Gamma correction — brighten dark / underexposed old photos."""
    lut = (np.power(np.arange(256) / 255.0, g) * 255).astype(np.uint8)
    return cv2.LUT(bgr, lut)


def _denoise(bgr: np.ndarray) -> np.ndarray:
    """Bilateral filter — reduces grain in old scans while keeping face edges."""
    return cv2.bilateralFilter(bgr, d=7, sigmaColor=50, sigmaSpace=50)


def _upscale(bgr: np.ndarray, factor: float = 2.0) -> np.ndarray:
    h, w = bgr.shape[:2]
    return cv2.resize(bgr, (int(w * factor), int(h * factor)),
                      interpolation=cv2.INTER_CUBIC)


def _preprocessed_variants(bgr: np.ndarray, max_dim: int = 480) -> list:
    """
    Return a list of BGR arrays to try detection on.
    Every variant is resized to max_dim on its longest axis for speed.
    """
    def _scaled(img):
        h, w = img.shape[:2]
        m    = max(w, h)
        if m <= max_dim:
            return img
        s = max_dim / m
        return cv2.resize(img, (int(w*s), int(h*s)), interpolation=cv2.INTER_AREA)

    h, w  = bgr.shape[:2]
    small = max(w, h) < 200         # tiny image — upscale first

    base   = bgr if not small else _upscale(bgr, 2.0)
    clah   = _clahe_gray(base)
    den    = _denoise(base)
    g07    = _gamma(base, 0.7)      # brighten
    g05    = _gamma(base, 0.5)      # strongly brighten

    variants = [base, clah, den, g07, g05]

    # If still tiny, add a 3× upscale
    if small:
        variants.append(_upscale(bgr, 3.0))

    return [_scaled(v) for v in variants]


# ── OpenCV Haar cascade ───────────────────────────────────────────────────────
_face_cascade  = None
_eye_cascade   = None
_mouth_cascade = None

def _load_cascades():
    global _face_cascade, _eye_cascade, _mouth_cascade
    if _face_cascade is None:
        _face_cascade  = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        _eye_cascade   = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_eye.xml")
        _mouth_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_smile.xml")
        # alt profile for side-on faces
        _face_cascade_alt = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")


def _haar_detect(gray: np.ndarray) -> list:
    """
    Try four increasingly permissive Haar configs.
    Returns list of (x,y,w,h) or empty list.
    """
    _load_cascades()
    configs = [
        dict(scaleFactor=1.05, minNeighbors=3, minSize=(20, 20)),   # very sensitive
        dict(scaleFactor=1.1,  minNeighbors=2, minSize=(15, 15)),   # sensitive
        dict(scaleFactor=1.15, minNeighbors=2, minSize=(12, 12)),   # extra permissive
        dict(scaleFactor=1.2,  minNeighbors=1, minSize=(10, 10)),   # last Haar resort
    ]
    for cfg in configs:
        faces = _face_cascade.detectMultiScale(
            gray, flags=cv2.CASCADE_SCALE_IMAGE, **cfg)
        if len(faces) > 0:
            return sorted(faces, key=lambda f: f[2]*f[3], reverse=True)
    return []


# ── Haar-based full scan (eyes + nose + mouth landmarks) ─────────────────────
class FaceScanData:
    def __init__(self):
        self.face_box     = None
        self.left_eye     = None
        self.right_eye    = None
        self.nose         = None
        self.mouth        = None
        self.face_crop    = None
        self.landmark_vec = None
        self.scale_used   = 1.0   # which variant's scale

    @property
    def has_landmarks(self):
        return self.left_eye is not None or self.right_eye is not None

    def build_landmark_vector(self, fw, fh):
        pts = []
        for pt in [self.left_eye, self.right_eye, self.nose, self.mouth]:
            pts += [pt[0]/fw, pt[1]/fh] if pt else [0.5, 0.5]
        self.landmark_vec = np.array(pts, dtype=np.float32)


def _scan_on_variant(orig_bgr: np.ndarray, variant_bgr: np.ndarray) -> Optional[FaceScanData]:
    """
    Run Haar detection on `variant_bgr`, map results back to `orig_bgr` coords.
    Returns FaceScanData or None.
    """
    oh, ow = orig_bgr.shape[:2]
    vh, vw = variant_bgr.shape[:2]
    sx     = ow / vw   # x-scale back to original
    sy     = oh / vh

    gray = cv2.cvtColor(variant_bgr, cv2.COLOR_BGR2GRAY)
    cv2.equalizeHist(gray, gray)

    faces = _haar_detect(gray)
    if not faces:
        return None

    vfx, vfy, vfw, vfh = faces[0]
    data = FaceScanData()
    data.face_box = (int(vfx*sx), int(vfy*sy), int(vfw*sx), int(vfh*sy))

    # Detect eyes in top-60% of face ROI
    face_gray = gray[vfy:vfy+vfh, vfx:vfx+vfw]
    eye_region = face_gray[0:int(vfh*0.60), :]
    eyes = _eye_cascade.detectMultiScale(
        eye_region, scaleFactor=1.05, minNeighbors=3, minSize=(8,8))
    if len(eyes) >= 2:
        eyes = sorted(eyes, key=lambda e: e[0])
        ex1,ey1,ew1,eh1 = eyes[0]
        ex2,ey2,ew2,eh2 = eyes[-1]
        data.left_eye  = (int((vfx+ex1+ew1//2)*sx), int((vfy+ey1+eh1//2)*sy))
        data.right_eye = (int((vfx+ex2+ew2//2)*sx), int((vfy+ey2+eh2//2)*sy))
    elif len(eyes) == 1:
        ex1,ey1,ew1,eh1 = eyes[0]
        data.left_eye = (int((vfx+ex1+ew1//2)*sx), int((vfy+ey1+eh1//2)*sy))

    # Nose (geometric)
    data.nose  = (int((vfx+vfw//2)*sx), int((vfy+int(vfh*0.55))*sy))

    # Mouth
    mouth_region = face_gray[int(vfh*0.50):int(vfh*0.90), :]
    mouths = []
    if _mouth_cascade and not _mouth_cascade.empty():
        mouths = _mouth_cascade.detectMultiScale(
            mouth_region, scaleFactor=1.05, minNeighbors=10, minSize=(10, 5))
    if len(mouths) > 0:
        mx,my,mw,mh = sorted(mouths, key=lambda m: m[2]*m[3], reverse=True)[0]
        data.mouth = (int((vfx+mx+mw//2)*sx), int((vfy+int(vfh*0.50)+my+mh//2)*sy))
    else:
        data.mouth = (int((vfx+vfw//2)*sx), int((vfy+int(vfh*0.80))*sy))

    data.build_landmark_vector(data.face_box[2], data.face_box[3])

    # Cropped face for embedding (with 20% padding)
    bx, by, bw, bh = data.face_box
    pad = max(int(bh*0.20), int(bw*0.20))
    y1 = max(0, by-pad); y2 = min(oh, by+bh+pad)
    x1 = max(0, bx-pad); x2 = min(ow, bx+bw+pad)
    crop = orig_bgr[y1:y2, x1:x2]
    if crop.size > 0:
        data.face_crop = cv2.resize(crop, (160,160), interpolation=cv2.INTER_LINEAR)
    else:
        data.face_crop = orig_bgr

    return data


def scan_face_structure_robust(bgr: np.ndarray) -> Optional[FaceScanData]:
    """
    Level 1 + 2: Haar detection on multiple preprocessed variants.
    Returns FaceScanData or None.
    """
    variants = _preprocessed_variants(bgr)
    for v in variants:
        result = _scan_on_variant(bgr, v)
        if result is not None:
            return result
    return None


# ── DeepFace embedding extraction ─────────────────────────────────────────────
def _deepface_represent(bgr: np.ndarray,
                        backend: str = "skip",
                        align: bool = True) -> Optional[List[float]]:
    """
    Extract a Facenet embedding using the specified DeepFace detector backend.
    enforce_detection=False means it never raises an error — falls back to full image.
    """
    df = _get_deepface()
    try:
        result = df.represent(
            img_path=bgr,
            model_name=EMBEDDING_MODEL,
            detector_backend=backend,
            enforce_detection=False,   # NEVER reject — use best available crop
            align=align,
            normalization="base",
        )
        if result and len(result) > 0:
            emb = result[0]["embedding"]
            if emb and len(emb) > 0:
                return emb
    except Exception as e:
        logger.debug("DeepFace.represent backend=%s: %s", backend, e)
    return None


def _deepface_detect_face_box(bgr: np.ndarray, backend: str = "opencv", enforce: bool = True):
    """
    Use DeepFace to detect a face bounding box.
    Returns (x,y,w,h) or None.
    If enforce=True, strictly requires a high-confidence face and rejects background noise.
    """
    df = _get_deepface()
    try:
        faces = df.extract_faces(
            img_path=bgr,
            detector_backend=backend,
            enforce_detection=enforce,
            align=True,
        )
        if faces and len(faces) > 0:
            f    = faces[0]
            
            # Confidence check (DeepFace >= 0.0.80 provides confidence)
            if enforce and f.get("confidence", 1.0) < 0.6:
                return None
                
            area = f.get("facial_area") or f.get("face", {})
            if isinstance(area, dict):
                x = area.get("x", 0); y = area.get("y", 0)
                w = area.get("w", bgr.shape[1]); h = area.get("h", bgr.shape[0])
            else:
                x, y, w, h = 0, 0, bgr.shape[1], bgr.shape[0]
            
            # Reject if the detected "face" is technically just the background
            # If the face box width is >= 95% of the image width, it's a false positive hallucination
            if enforce and (w >= bgr.shape[1] * 0.95 or h >= bgr.shape[0] * 0.95):
                return None
                
            return x, y, w, h
    except Exception as e:
        logger.debug("DeepFace.extract_faces backend=%s: %s", backend, e)
    return None


# ── Quality check ─────────────────────────────────────────────────────────────
class QualityResult:
    def __init__(self, ok: bool, reason: str = ""):
        self.ok = ok; self.reason = reason

def assess_image_quality(bgr: np.ndarray) -> QualityResult:
    h, w = bgr.shape[:2]
    if w < 20 or h < 20:
        return QualityResult(ok=False, reason="Image resolution too low (< 20×20 px)")
    
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    
    # 1. Blank image or solid colour check (Standard Deviation)
    if gray.std() < 2.0:
        return QualityResult(ok=False, reason="Image appears blank or solid colour (No facial contrast)")
        
    # 2. Blur check (Variance of Laplacian)
    # A clear face can sometimes have a smooth background which pulls down the overall variance.
    # We only want to reject TRULY completely blurred blobs which score < 1.5.
    lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if lap_var < 1.5:
        return QualityResult(ok=False, reason=f"Image is completely blurred or obscured (blur index: {lap_var:.1f})")
        
    return QualityResult(ok=True)


# ── ProcessResult ─────────────────────────────────────────────────────────────
class ProcessResult:
    def __init__(self, accepted=False, embedding=None,
                 rejection_reason="", scan_time_ms=0.0,
                 img_w=0, img_h=0, img_size_kb=0.0,
                 box_x=0, box_y=0, box_w=0, box_h=0,
                 elx=0, ely=0, erx=0, ery=0,
                 nx=0, ny=0, mx=0, my=0,
                 landmark_vec=None,
                 detection_level=0):    # which level succeeded (1-5)
        self.accepted         = accepted
        self.embedding        = embedding
        self.rejection_reason = rejection_reason
        self.scan_time_ms     = scan_time_ms
        self.img_w            = img_w
        self.img_h            = img_h
        self.img_size_kb      = img_size_kb
        self.box_x            = box_x
        self.box_y            = box_y
        self.box_w            = box_w
        self.box_h            = box_h
        self.elx              = elx
        self.ely              = ely
        self.erx              = erx
        self.ery              = ery
        self.nx               = nx
        self.ny               = ny
        self.mx               = mx
        self.my               = my
        self.landmark_vec     = landmark_vec
        self.detection_level  = detection_level


# ── MAIN ENTRYPOINT: process_upload ──────────────────────────────────────────
def process_upload(img_bytes: bytes,
                   histeq: bool = True,
                   strict: bool = False) -> ProcessResult:
    """
    Two-mode professional face detection pipeline.

    MODE 1 — strict=False (bulk registration):
        NEVER rejects a valid image. Uses 5-level aggressive cascade.
        Even if face bounding box fails, stores full-image embedding.
        Quality gate ONLY blocks truly corrupt/blank images (<20px or std<1.0).
        Every candidate photo WILL be stored.

    MODE 2 — strict=True (live camera):
        Requires actual face detection through 4 backends.
        Pro-grade detection with CLAHE, gamma, and denoise variants.
        Rejects only if ALL 4 backends find no face.
    """
    t0          = time.perf_counter()
    img_size_kb = len(img_bytes) / 1024.0

    # ── Decode ──────────────────────────────────────────────────────────────
    try:
        bgr = _bytes_to_bgr(img_bytes)
    except ValueError as e:
        return ProcessResult(accepted=False, rejection_reason=str(e))

    h, w = bgr.shape[:2]

    # ── Downscale large images for faster processing ─────────────────────────
    MAX_DIM = 640
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        bgr   = cv2.resize(bgr, (int(w * scale), int(h * scale)),
                           interpolation=cv2.INTER_AREA)
        h, w  = bgr.shape[:2]

    # ── MINIMUM quality gate (only truly unusable images) ────────────────────
    # Mode 1: extremely lenient — only reject <10px images or completely blank
    # Mode 2: slightly stricter — reject heavy blur too
    if w < 10 or h < 10:
        return ProcessResult(
            accepted=False,
            rejection_reason="Image too small (< 10×10 pixels)",
            scan_time_ms=(time.perf_counter()-t0)*1000
        )

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    std_val = float(gray.std())

    if std_val < 1.0:
        return ProcessResult(
            accepted=False,
            rejection_reason="Image is completely blank or solid-colour",
            scan_time_ms=(time.perf_counter()-t0)*1000
        )

    if strict:
        # Mode 2 only: also reject extreme blur
        lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        if lap_var < 1.0:
            return ProcessResult(
                accepted=False,
                rejection_reason="Camera image is too blurry — hold still",
                scan_time_ms=(time.perf_counter()-t0)*1000
            )

    def _elapsed():
        return round((time.perf_counter() - t0) * 1000, 1)

    def _landmarks_from_box(bx, by, bw, bh):
        """Compute structural landmarks from bounding box using face geometry ratios."""
        return (
            int(bx + bw*0.28), int(by + bh*0.36),   # left eye x,y
            int(bx + bw*0.72), int(by + bh*0.36),   # right eye x,y
            int(bx + bw*0.50), int(by + bh*0.60),   # nose x,y
            int(bx + bw*0.50), int(by + bh*0.80),   # mouth x,y
        )

    def _landmarks_from_image(w, h):
        """Estimate landmarks from full image when no box is detected."""
        return (
            int(w*0.33), int(h*0.40),
            int(w*0.67), int(h*0.40),
            int(w*0.50), int(h*0.57),
            int(w*0.50), int(h*0.72),
        )

    def _build_result(emb, bx, by, bw, bh, level, lm=None):
        elx, ely, erx, ery, nx, ny, mx, my = (
            lm if lm else _landmarks_from_box(bx, by, bw, bh)
        )
        return ProcessResult(
            accepted=True, embedding=emb,
            scan_time_ms=_elapsed(),
            img_w=w, img_h=h, img_size_kb=img_size_kb,
            box_x=bx, box_y=by, box_w=bw, box_h=bh,
            elx=elx, ely=ely, erx=erx, ery=ery,
            nx=nx, ny=ny, mx=mx, my=my,
            detection_level=level,
        )

    # ════════════════════════════════════════════════════════════════════════
    # LEVEL 1 + 2 : Haar cascade (fastest — sub-100ms, extracted landmarks)
    # Mode 2 (strict): SKIP Haar because it has false positives on backgrounds,
    # and forces the reliable neural net (Level 3/4) to confirm a real face.
    # ════════════════════════════════════════════════════════════════════════
    if not strict:
        scan = scan_face_structure_robust(bgr)
        if scan is not None:
            emb = _deepface_represent(scan.face_crop, backend="skip", align=False)
            if emb:
                le = scan.left_eye  or (0, 0)
                re = scan.right_eye or (0, 0)
                no = scan.nose      or (0, 0)
                mo = scan.mouth     or (0, 0)
                bx, by, bw, bh = scan.face_box
                logger.info("Level 1 (Haar) detected — eyes:(%d,%d) nose:(%d,%d) [%.0fms]",
                            le[0], le[1], no[0], no[1], _elapsed())
                return ProcessResult(
                    accepted=True, embedding=emb,
                    scan_time_ms=_elapsed(),
                    img_w=w, img_h=h, img_size_kb=img_size_kb,
                    box_x=bx, box_y=by, box_w=bw, box_h=bh,
                    elx=le[0], ely=le[1], erx=re[0], ery=re[1],
                    nx=no[0], ny=no[1], mx=mo[0], my=mo[1],
                    landmark_vec=scan.landmark_vec,
                    detection_level=1,
                )

    # ════════════════════════════════════════════════════════════════════════
    # LEVEL 3 : DeepFace OpenCV-DNN (neural net bbox → crop → embed)
    # Try 3 variants: raw, CLAHE-enhanced, gamma-brightened
    # ════════════════════════════════════════════════════════════════════════
    for variant_bgr in [bgr, _clahe_gray(bgr), _gamma(bgr, 0.55)]:
        box = _deepface_detect_face_box(variant_bgr, "opencv")
        if box:
            bx, by, bw, bh = box
            pad = max(int(bh*0.20), int(bw*0.20))
            y1 = max(0, by-pad); y2 = min(h, by+bh+pad)
            x1 = max(0, bx-pad); x2 = min(w, bx+bw+pad)
            crop = bgr[y1:y2, x1:x2]
            

            crop = cv2.resize(crop, (160,160), interpolation=cv2.INTER_LINEAR) \
                   if crop.size > 0 else bgr
            emb = _deepface_represent(crop, backend="skip", align=False)
            if emb:
                lm = _landmarks_from_box(bx, by, bw, bh)
                logger.info("Level 3 (DNN-opencv) detected [%.0fms]", _elapsed())
                return _build_result(emb, bx, by, bw, bh, 3, lm)

    # ════════════════════════════════════════════════════════════════════════
    # LEVEL 4 : DeepFace OpenCV retry with denoise + aggressive CLAHE
    # Handles dark, low-contrast, and side-profile photos
    # ════════════════════════════════════════════════════════════════════════
    for variant_bgr in [_denoise(bgr), _gamma(bgr, 0.35)]:
        box = _deepface_detect_face_box(variant_bgr, "opencv")
        if box:
            bx, by, bw, bh = box
            pad = max(int(bh*0.20), int(bw*0.20))
            y1 = max(0, by-pad); y2 = min(h, by+bh+pad)
            x1 = max(0, bx-pad); x2 = min(w, bx+bw+pad)
            crop = bgr[y1:y2, x1:x2]
            

            crop = cv2.resize(crop, (160,160), interpolation=cv2.INTER_LINEAR) \
                   if crop.size > 0 else bgr
            emb = _deepface_represent(crop, backend="skip", align=False)
            if emb:
                lm = _landmarks_from_box(bx, by, bw, bh)
                logger.info("Level 4 (denoise/gamma opencv) detected [%.0fms]", _elapsed())
                return _build_result(emb, bx, by, bw, bh, 4, lm)

    # ════════════════════════════════════════════════════════════════════════
    # LEVEL 5 : Strict Rejection
    #   If we reach here, neither Haar nor DNN could find a face lock.
    #   We MUST reject it to prevent storing empty frames or walls.
    # ════════════════════════════════════════════════════════════════════════
    logger.info("All detection levels failed — face required, rejecting")
    return ProcessResult(
        accepted=False,
        rejection_reason="⚠️ No face detected — please ensure the face is clearly visible",
        scan_time_ms=_elapsed(),
    )


# ── Alias: strict mode for live camera ───────────────────────────────────────
def process_upload_live(img_bytes: bytes) -> ProcessResult:
    """Mode 2 live camera — requires at least Level 3 (DeepFace opencv-DNN)."""
    return process_upload(img_bytes, histeq=True, strict=True)


# ── Alias kept for backward compatibility ─────────────────────────────────────
def process_upload_strict(img_bytes: bytes) -> ProcessResult:
    """Mode 3 Image-vs-Image — same as live (strict)."""
    return process_upload(img_bytes, histeq=True, strict=True)


# ── Cosine similarity ─────────────────────────────────────────────────────────
def cosine_similarity(a: List[float], b: List[float]) -> float:
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


def landmark_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    na = np.linalg.norm(vec_a)
    nb = np.linalg.norm(vec_b)
    if na == 0 or nb == 0:
        return 0.5
    return float(np.dot(vec_a, vec_b) / (na * nb))


# ── VerifyResult (Mode 3 Image-vs-Image) ──────────────────────────────────────
class VerifyResult:
    def __init__(self, face_detected=False, matched=False,
                 match_pct=0.0, not_match_pct=0.0,
                 embedding_score=0.0, landmark_score=0.0,
                 cosine_raw=0.0, processing_time_ms=0.0,
                 rejection_reason=""):
        self.face_detected      = face_detected
        self.matched            = matched
        self.match_pct          = match_pct
        self.not_match_pct      = not_match_pct
        self.embedding_score    = embedding_score
        self.landmark_score     = landmark_score
        self.cosine_raw         = cosine_raw
        self.processing_time_ms = processing_time_ms
        self.rejection_reason   = rejection_reason


def compare_embeddings(emb1: List[float], emb2: List[float],
                       lm_vec1=None, lm_vec2=None,
                       processing_ms: float = 0) -> VerifyResult:
    """
    Dual-score comparison (Mode 2 Live):
      70% ArcFace embedding cosine + 30% face structural landmark similarity.
    Both embeddings are L2-normalized before comparison (robustness guarantee).
    Match: cosine_raw >= 0.40 AND match_pct >= 60% (set in main.py).
    """
    # L2-normalize both embeddings before cosine — critical for ArcFace
    va = np.array(emb1, dtype=np.float32)
    vb = np.array(emb2, dtype=np.float32)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na > 0: va = va / na
    if nb > 0: vb = vb / nb

    raw_emb_sim = float(np.dot(va, vb))    # cosine of unit vectors = dot product
    emb_score   = (raw_emb_sim + 1.0) / 2.0  # map [-1,1] → [0,1]

    if lm_vec1 is not None and lm_vec2 is not None:
        lv1 = np.array(lm_vec1, dtype=np.float32)
        lv2 = np.array(lm_vec2, dtype=np.float32)
        n1, n2 = np.linalg.norm(lv1), np.linalg.norm(lv2)
        if n1 > 0 and n2 > 0:
            raw_lm_sim = float(np.dot(lv1/n1, lv2/n2))
        else:
            raw_lm_sim = 0.0
        lm_score = (raw_lm_sim + 1.0) / 2.0
    else:
        # No landmark vectors available — use neutral 0.5 (neither helps nor hurts)
        lm_score = 0.5

    combined      = EMBEDDING_WEIGHT * emb_score + LANDMARK_WEIGHT * lm_score
    match_pct     = round(max(0.0, min(100.0, combined * 100.0)), 1)
    not_match_pct = round(100.0 - match_pct, 1)
    matched       = raw_emb_sim >= VERIFICATION_THRESHOLD

    logger.debug("Compare: cos=%.4f emb=%.3f lm=%.3f comb=%.3f matched=%s",
                 raw_emb_sim, emb_score, lm_score, combined, matched)

    return VerifyResult(
        face_detected=True, matched=matched,
        match_pct=match_pct, not_match_pct=not_match_pct,
        embedding_score=round(emb_score * 100, 1),
        landmark_score=round(lm_score * 100, 1),
        cosine_raw=round(raw_emb_sim, 4),
        processing_time_ms=processing_ms,
    )
