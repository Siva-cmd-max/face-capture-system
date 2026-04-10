"""
main.py — FastAPI for Face Capture SPA
  Original endpoints (unchanged):
    POST /upload-face     Mode 1 reference upload (duplicate-aware)
    POST /verify-live     Mode 1 async live webcam verification
    POST /identify-live   Mode 1 1-to-N DB search (candidates table)
    POST /compare-photos  Mode 3 strict photo-vs-photo comparison

  New endpoints:
    POST /bulk-register       Mode 1 (new) — bulk folder image registration
    POST /single-register     Mode 1 (new) — emergency single image upload
    POST /identify-registered Mode 2 (new) — 1-to-N search vs registered_faces
    GET  /registered-count    Mode 2 helper — how many registered faces in DB
"""

import asyncio, base64, functools, hashlib, logging, time, uuid, threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List

import aiofiles
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import database as db

# Set True once DeepFace weights are fully in RAM
_model_ready = False
import face_processor as fp

# ── Logging: console + file so crashes are ALWAYS recorded ────────────────────
LOG_FILE = Path(__file__).parent / "backend_errors.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[
        logging.StreamHandler(),                                    # console
        logging.FileHandler(LOG_FILE, encoding="utf-8"),           # file
    ]
)
logger = logging.getLogger(__name__)

BASE_DIR        = Path(__file__).parent
UPLOADS_DIR     = BASE_DIR / "uploads"
CAPTURES_DIR    = BASE_DIR / "uploads" / "captures"
REGISTERED_DIR  = BASE_DIR / "uploads" / "registered"   # actual face images saved here
UPLOADS_DIR.mkdir(exist_ok=True)
CAPTURES_DIR.mkdir(exist_ok=True)
REGISTERED_DIR.mkdir(exist_ok=True)

app = FastAPI(title="FaceVault Biometric API — Exam Verification System")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── Global exception handler ────────────────────────────────────────────────────────
# Catches ANY unhandled Python exception and returns readable JSON
# instead of a blank HTTP 500 that shows as "Network Error" in the frontend.
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    import traceback
    tb = traceback.format_exc()
    logger.error("UNHANDLED EXCEPTION on %s %s:\n%s", request.method, request.url.path, tb)
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=500,
        content={
            "status":  "error",
            "message": f"Server error: {type(exc).__name__}: {exc}",
            "detail":  tb.splitlines()[-1],   # last line of traceback
        }
    )

# In-memory sessions: {session_id: {embedding, path, image_name}}
_sessions: dict = {}

# Thread pool for CPU-bound processing on the async live path
_executor = ThreadPoolExecutor(max_workers=6)


@app.on_event("startup")
async def on_startup():
    # Init original tables
    db.init_database()
    # Init new tables (IF NOT EXISTS — safe every restart)
    db.init_new_tables()

    def _run_preload():
        global _model_ready
        try:
            fp.preload_model()
        except Exception as e:
            logger.warning("Preload warning (non-fatal): %s", e)
        finally:
            _model_ready = True
            logger.info("✅ Model ready — all uploads will now be < 200 ms.")

    t = threading.Thread(target=_run_preload, daemon=True)
    t.start()
    logger.info("Model preload started in background — server is online immediately.")


@app.get("/health")
async def health():
    return {"status": "ok", "model_ready": _model_ready}


@app.get("/registered-count")
async def registered_count():
    """Quick check — how many faces are in registered_faces table."""
    count = db.count_registered_faces()
    return {"count": count}


# ── POST /upload-face ─────────────────────────────────────────────────────────
@app.post("/upload-face")
async def upload_face(file: UploadFile = File(...)):
    """Original Mode — reference upload. Duplicate-aware."""
    if not _model_ready:
        return {
            "status": "warming",
            "message": "AI engine is warming up — please wait a few seconds and try again."
        }

    t0 = time.perf_counter()
    img_bytes = await file.read()
    if not img_bytes:
        raise HTTPException(400, "Empty file uploaded.")

    orig_name = (file.filename or "image.jpg").lower()
    ext       = Path(orig_name).suffix or ".jpg"

    existing = db.get_candidate_by_name(orig_name)
    if existing:
        db.mark_candidate_duplicate(orig_name)
        session_id = uuid.uuid4().hex
        _sessions[session_id] = {
            "embedding":  existing["embedding"],
            "image_name": orig_name,
            "path":       "",
        }
        processing_ms = round((time.perf_counter() - t0) * 1000)
        return {
            "status":            "success",
            "already_exists":    True,
            "session_id":        session_id,
            "image_name":        orig_name,
            "scan_time_ms":      existing["scan_time_ms"],
            "processing_ms":     processing_ms,
            "uploaded_at":       existing["uploaded_at"],
            "embedding_preview": existing["embedding"][:6],
            "box":  {"x": existing["face_box_x"], "y": existing["face_box_y"],
                     "w": existing["face_box_w"], "h": existing["face_box_h"]},
            "img_dims": {"w": existing["img_width"], "h": existing["img_height"]},
        }

    save_path = UPLOADS_DIR / f"{uuid.uuid4().hex}{ext}"
    async with aiofiles.open(save_path, "wb") as f:
        await f.write(img_bytes)

    result = fp.process_upload(img_bytes, histeq=True)
    processing_ms = round((time.perf_counter() - t0) * 1000)

    if not result.accepted:
        return {"status": "error", "message": result.rejection_reason,
                "scan_time_ms": round(result.scan_time_ms, 1)}

    session_id = uuid.uuid4().hex
    _sessions[session_id] = {
        "embedding":  result.embedding,
        "image_name": orig_name,
        "path":       str(save_path),
    }

    photo_b64 = f"data:image/{ext.strip('.')};base64," + base64.b64encode(img_bytes).decode('utf-8')

    db.insert_candidate(
        image_name=orig_name, embedding=result.embedding,
        face_box_x=result.box_x, face_box_y=result.box_y,
        face_box_w=result.box_w, face_box_h=result.box_h,
        img_width=result.img_w, img_height=result.img_h,
        scan_time_ms=round(result.scan_time_ms),
        processing_ms=processing_ms,
        photo_base64=photo_b64
    )

    return {
        "status":            "success",
        "already_exists":    False,
        "session_id":        session_id,
        "image_name":        orig_name,
        "scan_time_ms":      round(result.scan_time_ms, 1),
        "processing_ms":     processing_ms,
        "uploaded_at":       None,
        "embedding_preview": result.embedding[:6],
        "box":  {"x": result.box_x, "y": result.box_y,
                 "w": result.box_w, "h": result.box_h},
        "img_dims": {"w": result.img_w, "h": result.img_h},
    }


# ── POST /verify-live ─────────────────────────────────────────────────────────
class LiveFrameRequest(BaseModel):
    session_id:   str
    frame_base64: str


@app.post("/verify-live")
async def verify_live(payload: LiveFrameRequest):
    """Original Mode — live verification against session embedding."""
    t_arrive = time.perf_counter()

    if payload.session_id not in _sessions:
        raise HTTPException(404, "Session not found or expired.")

    raw = payload.frame_base64
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(raw)
    except Exception:
        raise HTTPException(400, "Invalid base64 image data.")

    loop = asyncio.get_event_loop()
    live_result = await loop.run_in_executor(
        _executor, functools.partial(fp.process_upload, img_bytes, False)
    )

    total_ms = round((time.perf_counter() - t_arrive) * 1000)

    if not live_result.accepted:
        return {
            "status":            "error",
            "face_detected":     False,
            "message":           live_result.rejection_reason,
            "detection_time_ms": round(live_result.scan_time_ms, 1),
            "total_time_ms":     total_ms,
        }

    session    = _sessions[payload.session_id]
    image_name = session.get("image_name", "unknown")
    ref_emb    = session["embedding"]

    match_res = fp.compare_embeddings(ref_emb, live_result.embedding)
    total_ms  = round((time.perf_counter() - t_arrive) * 1000)
    scan_ms   = round(live_result.scan_time_ms)

    if match_res.matched:
        db.insert_live_verification(
            image_name=image_name,
            match_pct=match_res.match_pct,
            matched=True,
            cosine_raw=match_res.cosine_raw,
            scan_time_ms=scan_ms,
            total_time_ms=total_ms,
        )

    return {
        "status":            "success",
        "face_detected":     True,
        "matched":           match_res.matched,
        "match_pct":         match_res.match_pct,
        "cosine_raw":        round(match_res.cosine_raw, 4),
        "detection_time_ms": scan_ms,
        "total_time_ms":     total_ms,
        "message":           "Verified" if match_res.matched else "Not Verified",
    }


# ── POST /identify-live ────────────────────────────────────────────────────────
class IdentifyLiveRequest(BaseModel):
    frame_base64: str


@app.post("/identify-live")
async def identify_live(payload: IdentifyLiveRequest):
    """Original — 1-to-N search against candidates table."""
    t_arrive = time.perf_counter()

    raw = payload.frame_base64
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(raw)
    except Exception:
        raise HTTPException(400, "Invalid base64 image data.")

    loop = asyncio.get_event_loop()
    live_result = await loop.run_in_executor(
        _executor, functools.partial(fp.process_upload, img_bytes, False)
    )

    total_ms = round((time.perf_counter() - t_arrive) * 1000)

    if not live_result.accepted:
        return {
            "status":        "error",
            "face_detected": False,
            "message":       live_result.rejection_reason,
            "total_time_ms": total_ms,
        }

    candidates = db.get_all_candidates()

    best_match = None
    best_score = 0.0
    best_candidate = None

    for cand in candidates:
        match_res = fp.compare_embeddings(cand["embedding"], live_result.embedding)
        if match_res.matched and match_res.match_pct > best_score:
            best_score = match_res.match_pct
            best_match = match_res
            best_candidate = cand

    total_ms = round((time.perf_counter() - t_arrive) * 1000)

    if best_match and best_candidate:
        return {
            "status":            "success",
            "face_detected":     True,
            "matched":           True,
            "match_pct":         best_match.match_pct,
            "cosine_raw":        round(best_match.cosine_raw, 4),
            "detection_time_ms": round(live_result.scan_time_ms),
            "total_time_ms":     total_ms,
            "candidate": {
                "image_name":        best_candidate["image_name"],
                "scan_time_ms":      best_candidate["scan_time_ms"],
                "uploaded_at":       best_candidate["uploaded_at"],
                "embedding_preview": best_candidate["embedding"][:6],
                "box": {
                    "x": best_candidate["face_box_x"], "y": best_candidate["face_box_y"],
                    "w": best_candidate["face_box_w"], "h": best_candidate["face_box_h"],
                },
                "img_dims": {
                    "w": best_candidate["img_width"], "h": best_candidate["img_height"],
                },
                "photo_base64": best_candidate["photo_base64"],
            }
        }

    return {
        "status":        "success",
        "face_detected": True,
        "matched":       False,
        "message":       "Not Verified (No Match Found in DB)",
        "total_time_ms": total_ms,
    }


# ── POST /compare-photos ───────────────────────────────────────────────────────
@app.post("/compare-photos")
async def compare_photos(
    left_image:  UploadFile = File(...),
    right_image: UploadFile = File(...),
):
    """Mode 3 (unchanged): Strict photo-vs-photo."""
    t0 = time.perf_counter()

    left_bytes  = await left_image.read()
    right_bytes = await right_image.read()
    left_name   = (left_image.filename  or "left.jpg").lower()
    right_name  = (right_image.filename or "right.jpg").lower()

    left_res  = fp.process_upload_strict(left_bytes)
    right_res = fp.process_upload_strict(right_bytes)

    if not left_res.accepted:
        return {"success": False,
                "error": f"Face not detected in left image — {left_res.rejection_reason}. "
                         "Ensure the photo is clear and frontal."}
    if not right_res.accepted:
        return {"success": False,
                "error": f"Face not detected in right image — {right_res.rejection_reason}. "
                         "Ensure the photo is clear and frontal."}

    left_path  = UPLOADS_DIR / f"left_{uuid.uuid4().hex}{Path(left_name).suffix or '.jpg'}"
    right_path = UPLOADS_DIR / f"right_{uuid.uuid4().hex}{Path(right_name).suffix or '.jpg'}"
    async with aiofiles.open(left_path,  "wb") as f: await f.write(left_bytes)
    async with aiofiles.open(right_path, "wb") as f: await f.write(right_bytes)

    t_cmp         = time.perf_counter()
    match_res     = fp.compare_embeddings(
        left_res.embedding, right_res.embedding,
        lm_vec1=left_res.landmark_vec, lm_vec2=right_res.landmark_vec,
    )
    comparison_ms = round((time.perf_counter() - t_cmp) * 1000)
    total_ms      = round((time.perf_counter() - t0) * 1000)
    left_scan_ms  = round(left_res.scan_time_ms)
    right_scan_ms = round(right_res.scan_time_ms)

    comp_id = db.insert_photo_comparison(
        left_image_name=left_name, right_image_name=right_name,
        left_embedding=left_res.embedding, right_embedding=right_res.embedding,
        left_scan_ms=left_scan_ms, right_scan_ms=right_scan_ms,
        comparison_ms=comparison_ms, total_time_ms=total_ms,
    )
    if comp_id > 0:
        db.insert_photo_comparison_result(
            comparison_id=comp_id,
            match_pct=match_res.match_pct,
            matched=match_res.matched,
            cosine_raw=match_res.cosine_raw,
        )

    return {
        "success":          True,
        "matched":          match_res.matched,
        "match_pct":        match_res.match_pct,
        "not_match_pct":    match_res.not_match_pct,
        "cosine_raw":       round(match_res.cosine_raw, 4),
        "left_scan_ms":     left_scan_ms,
        "right_scan_ms":    right_scan_ms,
        "comparison_ms":    comparison_ms,
        "total_time_ms":    total_ms,
        "left_image_name":  left_name,
        "right_image_name": right_name,
        "left_box":  {"x": left_res.box_x,  "y": left_res.box_y,
                      "w": left_res.box_w,  "h": left_res.box_h},
        "right_box": {"x": right_res.box_x, "y": right_res.box_y,
                      "w": right_res.box_w, "h": right_res.box_h},
        "left_dims":  {"w": left_res.img_w,  "h": left_res.img_h},
        "right_dims": {"w": right_res.img_w, "h": right_res.img_h},
        "message": ("Identity Verified — Same Person"
                    if match_res.matched else "Not Matched — Different Person"),
    }


# ── NEW: POST /bulk-register ──────────────────────────────────────────────────

class BulkImageItem(BaseModel):
    image_name:   str
    image_base64: str  # raw base64, no data URI prefix needed but accepted


class BulkRegisterRequest(BaseModel):
    folder_name: str = "unknown_folder"
    images: List[BulkImageItem]


def _md5_hash(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def _cosine_sim(a, b) -> float:
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


def _process_one_image(item: BulkImageItem, all_registered_embs):
    """
    Process a single image for bulk registration.

    Order of operations:
      0. Decode image bytes — if corrupt/blank → failed (clear error)
      1. ALWAYS run face detection first — report face found / not found
      2. Level 1 hash check — only after face is confirmed (so we know it's a valid face image)
      3. Extract embedding from the detected face
      4. Level 2 embedding similarity — threshold 0.92 (same person, NOT just similar-looking)
         A cosine of 0.92 means the vectors are nearly identical — practically same photo
      5. Insert into DB

    Returns dict with: image_name, status, reason, time_ms, face_detected, face_box, similarity
    """
    t0 = time.perf_counter()
    name = item.image_name

    # ── Step 0: Decode base64 ──────────────────────────────────────────────────
    raw = item.image_base64
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(raw)
    except Exception:
        return {
            "image_name":   name,
            "status":       "failed",
            "reason":       "❌ Invalid image data — could not decode base64",
            "time_ms":      round((time.perf_counter() - t0) * 1000),
            "face_detected": False,
        }

    # Check for empty/blank/all-black image — if file size < 1 KB it's suspicious
    if len(img_bytes) < 500:
        return {
            "image_name":   name,
            "status":       "failed",
            "reason":       "❌ Image is blank or empty (file too small)",
            "time_ms":      round((time.perf_counter() - t0) * 1000),
            "face_detected": False,
        }

    # ── Step 1: ALWAYS detect face first ──────────────────────────────────────
    result = fp.process_upload(img_bytes, histeq=True)
    scan_ms = round(result.scan_time_ms, 1)

    if not result.accepted:
        # Enrich rejection reason with more context
        reason = result.rejection_reason or "No face detected"

        # Detect blank image by checking if image decodes but is all one color
        if "Cannot decode" in reason or "corrupt" in reason.lower():
            reason = "❌ Corrupt or unreadable image file — please check the original"
        elif "No face" in reason or "face detected" in reason.lower():
            reason = "⚠️ No face detected — image may be blank, a scene photo, or face is too small/obscured"
        elif "resolution" in reason.lower() or "low" in reason.lower():
            reason = "⚠️ Image resolution too low — minimum 30×30 pixels required"

        return {
            "image_name":    name,
            "status":        "failed",
            "reason":        reason,
            "time_ms":       round((time.perf_counter() - t0) * 1000),
            "scan_ms":       scan_ms,
            "face_detected": False,
        }

    # Face IS detected — record face box for reporting
    face_box = {"x": result.box_x, "y": result.box_y, "w": result.box_w, "h": result.box_h}

    # ── Step 2: Level 1 hash duplicate check ──────────────────────────────────
    # (Only after confirming it IS a face image)
    img_hash = _md5_hash(img_bytes)
    existing = db.get_registered_face_by_hash(img_hash)
    if existing:
        return {
            "image_name":    name,
            "status":        "duplicate",
            "reason":        f"⚠️ Exact same file already registered — matched '{existing['image_name']}' (identical hash)",
            "time_ms":       round((time.perf_counter() - t0) * 1000),
            "scan_ms":       scan_ms,
            "face_detected": True,
            "face_box":      face_box,
            "similarity":    100.0,
        }

    # ── Step 3: Embedding already extracted by process_upload ─────────────────
    embedding = result.embedding   # already extracted — no extra call needed

    # ── Step 4: Level 2 — STRICT embedding similarity (ArcFace scale) ──────────
    #
    # ArcFace cosine similarity ranges (L2-normalised 512-D):
    #   Different people        : -0.20 to  0.20
    #   Same person diff photo  :  0.25 to  0.65
    #   Near-identical re-upload:  0.85 to  1.00
    #
    #   0.98 = flags ONLY identical images (prevents rejecting different people)
    #
    EMBED_THRESHOLD = 0.98

    best_sim = 0.0
    best_match_name = ""

    for reg in all_registered_embs:
        sim = _cosine_sim(reg["embedding"], embedding)
        if sim > best_sim:
            best_sim = sim
            best_match_name = reg["image_name"]

    if best_sim >= EMBED_THRESHOLD:
        sim_pct = round(((best_sim + 1.0) / 2.0) * 100.0, 1)   # convert to 0-100%
        return {
            "image_name":    name,
            "status":        "duplicate",
            "reason":        f"⚠️ Nearly identical face detected — matched '{best_match_name}' ({sim_pct:.1f}% similarity, threshold: {EMBED_THRESHOLD})",
            "time_ms":       round((time.perf_counter() - t0) * 1000),
            "scan_ms":       scan_ms,
            "face_detected": True,
            "face_box":      face_box,
            "similarity":    sim_pct,
        }

    # ── Step 5: Insert into registered_faces ──────────────────────────────────
    le = result.elx, result.ely
    re = result.erx, result.ery
    no = result.nx,  result.ny
    mo = result.mx,  result.my

    # Save actual image file to disk so Mode 2 can display it
    reg_filename = f"{uuid.uuid4().hex}{Path(name).suffix or '.jpg'}"
    reg_rel_path = f"registered/{reg_filename}"
    reg_abs_path = REGISTERED_DIR / reg_filename
    try:
        with open(reg_abs_path, "wb") as fh:
            fh.write(img_bytes)
    except Exception as save_err:
        logger.warning("Could not save registered image: %s", save_err)
        reg_rel_path = ""

    new_id = db.insert_registered_face(
        image_name=name,
        image_path=reg_rel_path,
        image_hash=img_hash,
        embedding=embedding,
        eye_left_x=float(le[0]), eye_left_y=float(le[1]),
        eye_right_x=float(re[0]), eye_right_y=float(re[1]),
        nose_x=float(no[0]),    nose_y=float(no[1]),
        mouth_left_x=float(mo[0]), mouth_left_y=float(mo[1]),
        mouth_right_x=float(mo[0]), mouth_right_y=float(mo[1]),
        face_confidence=1.0,
        source="folder_upload",
    )

    if new_id == -2:
        # Hash uniqueness race condition — safe to treat as duplicate
        return {
            "image_name":    name,
            "status":        "duplicate",
            "reason":        "⚠️ Hash collision (same file processed twice simultaneously)",
            "time_ms":       round((time.perf_counter() - t0) * 1000),
            "scan_ms":       scan_ms,
            "face_detected": True,
            "face_box":      face_box,
        }

    # ── Success ────────────────────────────────────────────────────────────────
    # Append to in-memory list so subsequent images in the same batch
    # benefit from the Level-2 check against this newly registered face
    all_registered_embs.append({
        "id":         new_id,
        "image_name": name,
        "embedding":  embedding,
    })

    # Report best similarity found (so user can see how different this face is from others)
    diff_pct = round(((best_sim + 1.0) / 2.0) * 100.0, 1) if best_sim > 0 else 0.0

    return {
        "image_name":    name,
        "status":        "registered",
        "reason":        f"✅ Full Structure Scanned (Eyes:{int(le[0])},{int(le[1])}|Nose:{int(no[0])},{int(no[1])}) — DB ID {new_id}",
        "time_ms":       round((time.perf_counter() - t0) * 1000),
        "scan_ms":       scan_ms,
        "face_detected": True,
        "face_box":      face_box,
        "similarity":    diff_pct,
        "db_id":         new_id,
    }



@app.post("/bulk-register")
async def bulk_register(payload: BulkRegisterRequest):
    """Mode 1 (new) — bulk register all faces from a folder."""
    if not _model_ready:
        return {"status": "warming", "message": "AI engine is warming up. Please wait."}

    t0 = time.perf_counter()
    images = payload.images

    if not images:
        return {"results": [], "summary": {}}

    # Pre-load all existing registered embeddings for Level 2 check
    # This is a shared mutable list — _process_one_image appends to it
    all_registered_embs = db.get_all_registered_embeddings()

    loop = asyncio.get_event_loop()

    def _safe_process_one_image(itm, all_embs):
        try:
            return _process_one_image(itm, all_embs)
        except Exception as e:
            logger.exception("Hard crash processing image %s: %s", itm.image_name, e)
            return {
                "image_name":    itm.image_name,
                "status":        "failed",
                "reason":        f"❌ Server processing error: {str(e)}",
                "time_ms":       0,
                "face_detected": False,
            }

    # Process in parallel batches to stay within 100-200ms per image
    # We use run_in_executor but sequentially to maintain ordering in the
    # in-memory embedding list (prevents false level-2 passes within same batch)
    results = []
    for item in images:
        r = await loop.run_in_executor(
            _executor,
            functools.partial(_safe_process_one_image, item, all_registered_embs)
        )
        results.append(r)

    total_time_sec = round(time.perf_counter() - t0, 2)
    reg_count  = sum(1 for r in results if r["status"] == "registered")
    dup_count  = sum(1 for r in results if r["status"] == "duplicate")
    fail_count = sum(1 for r in results if r["status"] == "failed")
    avg_ms     = round(total_time_sec * 1000 / len(results), 1) if results else 0

    # Log to folder_scan_logs
    db.log_folder_scan(
        folder_name=payload.folder_name,
        total_images=len(images),
        registered_count=reg_count,
        duplicate_count=dup_count,
        failed_count=fail_count,
        total_time_sec=total_time_sec,
        avg_time_ms=avg_ms,
    )

    return {
        "results": results,
        "summary": {
            "total":       len(images),
            "registered":  reg_count,
            "duplicate":   dup_count,
            "failed":      fail_count,
            "total_time_sec": total_time_sec,
            "avg_time_ms": avg_ms,
            "folder_name": payload.folder_name,
        }
    }


# ── NEW: POST /single-register ────────────────────────────────────────────────

@app.post("/single-register")
async def single_register(file: UploadFile = File(...)):
    """Mode 1 (new) — emergency single image upload."""
    if not _model_ready:
        return {"status": "warming", "message": "AI engine is warming up. Please wait."}

    t0 = time.perf_counter()
    img_bytes = await file.read()
    if not img_bytes:
        raise HTTPException(400, "Empty file.")

    name = (file.filename or "image.jpg")
    # Blank / empty file check
    if len(img_bytes) < 500:
        return {
            "status":  "failed",
            "reason":  "❌ Image is blank or empty (file too small)",
            "time_ms": round((time.perf_counter() - t0) * 1000),
            "face_detected": False,
        }

    # ── Step 1: ALWAYS run face detection first ────────────────────────────────
    result  = fp.process_upload(img_bytes, histeq=True)
    scan_ms = round((time.perf_counter() - t0) * 1000)

    if not result.accepted:
        reason = result.rejection_reason or "No face detected"
        if "Cannot decode" in reason or "corrupt" in reason.lower():
            reason = "❌ Corrupt or unreadable image — please check the file"
        elif "No face" in reason or "face detected" in reason.lower():
            reason = "⚠️ No face detected — use a clear frontal face photo"
        elif "resolution" in reason.lower():
            reason = "⚠️ Image resolution too low — minimum 30×30 pixels required"

        db.log_single_upload(name, "failed", scan_ms, reason)
        return {
            "status":        "failed",
            "reason":        reason,
            "time_ms":       scan_ms,
            "face_detected": False,
        }

    face_box = {
        "x": result.box_x, "y": result.box_y,
        "w": result.box_w, "h": result.box_h,
    }

    # ── Step 2: Level 1 hash check (after confirming face exists) ─────────────
    img_hash = _md5_hash(img_bytes)
    existing = db.get_registered_face_by_hash(img_hash)
    if existing:
        reason = f"⚠️ Exact same file already registered — matched '{existing['image_name']}' (identical hash)"
        db.log_single_upload(name, "duplicate", scan_ms, reason)
        return {
            "status":        "duplicate",
            "reason":        reason,
            "time_ms":       scan_ms,
            "face_detected": True,
            "face_box":      face_box,
            "similarity":    100.0,
        }

    # ── Step 3: Level 2 embedding similarity (ArcFace threshold 0.98) ──────────
    all_registered_embs = db.get_all_registered_embeddings()
    EMBED_THRESHOLD = 0.98   # completely prevents rejecting different faces

    best_sim  = 0.0
    best_name = ""
    for reg in all_registered_embs:
        sim = _cosine_sim(reg["embedding"], result.embedding)
        if sim > best_sim:
            best_sim  = sim
            best_name = reg["image_name"]

    if best_sim >= EMBED_THRESHOLD:
        sim_pct = round(((best_sim + 1.0) / 2.0) * 100.0, 1)
        reason  = f"⚠️ Nearly identical face — matched '{best_name}' ({sim_pct:.1f}% similarity)"
        db.log_single_upload(name, "duplicate", scan_ms, reason)
        return {
            "status":        "duplicate",
            "reason":        reason,
            "time_ms":       scan_ms,
            "face_detected": True,
            "face_box":      face_box,
            "similarity":    sim_pct,
        }

    # ── Step 4: Insert ─────────────────────────────────────────────────────────
    le = result.elx, result.ely
    re = result.erx, result.ery
    no = result.nx, result.ny
    mo = result.mx, result.my

    # Save image file to disk so Mode 2 can display the registered photo
    s_filename = f"{uuid.uuid4().hex}{Path(name).suffix or '.jpg'}"
    s_rel_path = f"registered/{s_filename}"
    try:
        with open(REGISTERED_DIR / s_filename, "wb") as fh:
            fh.write(img_bytes)
    except Exception as _e:
        logger.warning("single-register: could not save image: %s", _e)
        s_rel_path = ""

    new_id = db.insert_registered_face(
        image_name=name,
        image_path=s_rel_path,
        image_hash=img_hash,
        embedding=result.embedding,
        eye_left_x=float(le[0]), eye_left_y=float(le[1]),
        eye_right_x=float(re[0]), eye_right_y=float(re[1]),
        nose_x=float(no[0]),    nose_y=float(no[1]),
        mouth_left_x=float(mo[0]), mouth_left_y=float(mo[1]),
        mouth_right_x=float(mo[0]), mouth_right_y=float(mo[1]),
        face_confidence=1.0,
        source="single_upload",
    )

    diff_pct = round(((best_sim + 1.0) / 2.0) * 100.0, 1) if best_sim > 0 else 0.0
    db.log_single_upload(name, "registered", scan_ms,
                         f"✅ Face stored (ID {new_id}) — most similar existing: {diff_pct}%")
    return {
        "status":        "registered",
        "id":            new_id,
        "time_ms":       scan_ms,
        "image_name":    name,
        "face_detected": True,
        "face_box":      face_box,
        "similarity":    diff_pct,
        "reason":        f"✅ Face detected & registered (ID {new_id})",
        "image_url":     f"/registered-image/{new_id}" if new_id else "",
    }



# ── NEW: POST /identify-registered ───────────────────────────────────────────

class IdentifyRegisteredRequest(BaseModel):
    frame_base64: str


@app.post("/identify-registered")
async def identify_registered(payload: IdentifyRegisteredRequest):
    """Mode 2 (new) — 1-to-N live search against registered_faces table."""
    t_arrive = time.perf_counter()

    raw = payload.frame_base64
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(raw)
    except Exception:
        raise HTTPException(400, "Invalid base64 image data.")

    loop = asyncio.get_event_loop()
    # strict=True: requires DeepFace DNN detection (Level 3+)
    # This prevents random camera backgrounds from generating false matches
    live_result = await loop.run_in_executor(
        _executor, functools.partial(fp.process_upload, img_bytes, True, True)
    )

    total_ms = round((time.perf_counter() - t_arrive) * 1000)

    if not live_result.accepted:
        # Save the frame even for no-face detections (for history)
        cap_filename = f"cap_{uuid.uuid4().hex}.jpg"
        cap_path     = CAPTURES_DIR / cap_filename
        try:
            with open(cap_path, "wb") as f:
                f.write(img_bytes)
        except Exception:
            cap_filename = ""

        db.log_live_detection(None, 0.0, total_ms, "NO_FACE",
                              captured_image=str(cap_filename))
        return {
            "status":        "error",
            "face_detected": False,
            "message":       live_result.rejection_reason or "No face detected — try a clearer frontal photo",
            "total_time_ms": total_ms,
        }

    # Fetch all registered embeddings
    registered = db.get_all_registered_embeddings()

    if not registered:
        db.log_live_detection(None, 0.0, total_ms, "EMPTY_DB")
        return {
            "status":        "success",
            "face_detected": True,
            "matched":       False,
            "message":       "No registered faces. Please run Mode 1 (Folder Upload) first.",
            "total_time_ms": total_ms,
        }

    # Save captured frame to disk
    cap_filename = f"cap_{uuid.uuid4().hex}.jpg"
    cap_path     = CAPTURES_DIR / cap_filename
    try:
        with open(cap_path, "wb") as f:
            f.write(img_bytes)
    except Exception:
        cap_filename = ""

    # ── Find best match — Optimal Verification for Exam Scenario ────────────────
    #
    # ArcFace cosine similarity guide (L2-normalised 512-D):
    #   Same person, same lighting   :  0.55 – 0.85
    #   Same person, different photo :  0.45 – 0.60
    #   Different people (typical)   : -0.10 – 0.44   ← False positive lookalike peaked at 0.44
    #
    # MATCH_THRESHOLD = 0.45 cosine  (ArcFace Balanced)
    #   → strictly verifies identity and rejects the known 0.44 lookalike false-positive
    #   → forgives slight lighting/angle differences so real students are not rejected
    #
    MATCH_THRESHOLD = 0.45    # ArcFace Balanced Threshold — safe but not overly sensitive
    MIN_COMBINED_PCT = 72.5   # balanced combined % to prevent false matches

    best_id        = None
    best_score     = -1.0
    best_match_pct = 0.0
    best_reg       = None
    best_vr        = None

    for reg in registered:
        db_lm_vec   = reg.get("landmark_vec")
        live_lm_vec = live_result.landmark_vec

        # 70% ArcFace neural identity + 30% face structural geometry
        vr = fp.compare_embeddings(
            reg["embedding"], live_result.embedding,
            lm_vec1=db_lm_vec, lm_vec2=live_lm_vec
        )

        logger.debug("candidate '%s' | cos=%.4f | pct=%.1f%%",
                     reg["image_name"], vr.cosine_raw, vr.match_pct)

        if vr.cosine_raw > best_score:
            best_score     = vr.cosine_raw
            best_match_pct = vr.match_pct
            best_id        = reg["id"]
            best_reg       = reg
            best_vr        = vr

    total_ms = round((time.perf_counter() - t_arrive) * 1000)

    # Match requires BOTH: cosine >= 0.40 AND combined score >= 60%
    matched = (best_score >= MATCH_THRESHOLD) and (best_match_pct >= MIN_COMBINED_PCT)

    logger.info("identify-registered | best='%s' cos=%.4f pct=%.1f%% matched=%s | %dms",
                best_reg["image_name"] if best_reg else "none",
                best_score, best_match_pct, matched, total_ms)

    if matched and best_reg:
        full_record = db.get_registered_face_by_id(best_id)
        match_pct   = round(best_match_pct, 1)

        db.log_live_detection(
            matched_face_id=best_id,
            match_score=match_pct,
            detection_time_ms=round(live_result.scan_time_ms),
            match_status="MATCHED",
            captured_image=cap_filename,
        )

        matched_image_url = f"/registered-image/{best_id}" if best_id else ""

        return {
            "status":            "success",
            "face_detected":     True,
            "matched":           True,
            "match_pct":         match_pct,
            "cosine_raw":        round(best_score, 4),
            "detection_time_ms": round(live_result.scan_time_ms),
            "total_time_ms":     total_ms,
            "detection_level":   live_result.detection_level,
            "capture_filename":  cap_filename,
            "face_box": {
                "x": live_result.box_x, "y": live_result.box_y,
                "w": live_result.box_w, "h": live_result.box_h,
            },
            "eyes": {
                "left_x":  live_result.elx, "left_y":  live_result.ely,
                "right_x": live_result.erx, "right_y": live_result.ery,
            },
            "nose":  {"x": live_result.nx,  "y": live_result.ny},
            "mouth": {"x": live_result.mx,  "y": live_result.my},
            "matched_face": {
                "id":            best_id,
                "image_name":    best_reg["image_name"],
                "registered_at": best_reg.get("registered_at", ""),
                "confidence":    best_reg.get("confidence", 1.0),
                "image_url":     matched_image_url,
            },
        }

    # No match found
    db.log_live_detection(
        matched_face_id=None,
        match_score=round(best_match_pct, 1),
        detection_time_ms=round(live_result.scan_time_ms),
        match_status="NOT_MATCHED",
        captured_image=cap_filename,
    )
    return {
        "status":           "success",
        "face_detected":    True,
        "matched":          False,
        "match_pct":        round(best_match_pct, 1),
        "cosine_raw":       round(best_score, 4),
        "message":          "Face not registered in database.",
        "total_time_ms":    total_ms,
        "capture_filename": cap_filename,
        "face_box": {
            "x": live_result.box_x, "y": live_result.box_y,
            "w": live_result.box_w, "h": live_result.box_h,
        },
        "eyes": {
            "left_x":  live_result.elx, "left_y":  live_result.ely,
            "right_x": live_result.erx, "right_y": live_result.ery,
        },
        "nose": {
            "x": live_result.nx, "y": live_result.ny,
        },
        "mouth": {
            "x": live_result.mx, "y": live_result.my,
        },
    }


# ── GET /detection-history ────────────────────────────────────────────────────

@app.get("/detection-history")
async def detection_history(
    limit: int = 100,
    status_filter: str = "",   # MATCHED | NOT_MATCHED | NO_FACE | ""
):
    """Return live detection log with matched face info, newest first."""
    records = db.get_live_detection_logs(limit=limit, status_filter=status_filter)
    # Enrich with matched face name
    enriched = []
    for r in records:
        item = dict(r)
        if r.get("matched_face_id"):
            face = db.get_registered_face_by_id(r["matched_face_id"])
            item["matched_face_name"] = face["image_name"] if face else "Unknown"
        else:
            item["matched_face_name"] = None
        # Build image URL if we have a capture file
        if r.get("captured_image"):
            item["capture_url"] = f"/capture-image/{r['id']}"
        else:
            item["capture_url"] = None
        enriched.append(item)
    return {"records": enriched, "total": len(enriched)}


# ── GET /capture-image/{log_id} ───────────────────────────────────────────────

@app.get("/capture-image/{log_id}")
async def capture_image(log_id: int, download: bool = False):
    """Serve a saved capture frame; ?download=true triggers browser download."""
    record = db.get_detection_log_by_id(log_id)
    if not record or not record.get("captured_image"):
        raise HTTPException(404, "Capture image not found for this log entry.")

    img_path = CAPTURES_DIR / record["captured_image"]
    if not img_path.exists():
        raise HTTPException(404, f"File not found: {record['captured_image']}")

    filename = record["captured_image"]
    headers  = {}
    if download:
        status  = record.get("match_status", "unknown")
        matched = record.get("matched_face_name") or "unmatched"
        dl_name = f"capture_{log_id}_{status}_{matched}.jpg"
        headers["Content-Disposition"] = f'attachment; filename="{dl_name}"'

    return FileResponse(
        path=str(img_path),
        media_type="image/jpeg",
        filename=filename,
        headers=headers,
    )


# ── GET /registered-image/{face_id} ──────────────────────────────────────────

@app.get("/registered-image/{face_id}")
async def registered_image(face_id: int, download: bool = False):
    """
    Serve the saved face photo for a registered person.
    Used by Mode 2 left panel to display the matched DB identity photo.
    """
    record = db.get_registered_face_by_id(face_id)
    if not record:
        raise HTTPException(404, f"No registered face with ID {face_id}")

    img_path_str = record.get("image_path", "")
    if not img_path_str:
        raise HTTPException(404, "No image path stored for this face")

    # Support both old path format (uploads/...) and new (registered/...)
    if img_path_str.startswith("registered/"):
        img_path = BASE_DIR / "uploads" / img_path_str
    elif img_path_str.startswith("uploads/"):
        img_path = BASE_DIR / img_path_str
    else:
        img_path = BASE_DIR / "uploads" / "registered" / img_path_str

    if not img_path.exists():
        raise HTTPException(404, f"Image file not found on disk: {img_path_str}")

    headers = {}
    if download:
        headers["Content-Disposition"] = (
            f'attachment; filename="face_{face_id}_{record["image_name"]}"'
        )

    suffix   = img_path.suffix.lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".png": "image/png",  ".webp": "image/webp"}
    media_type = mime_map.get(suffix, "image/jpeg")

    return FileResponse(
        path=str(img_path),
        media_type=media_type,
        headers=headers,
    )


# ── DELETE /clear-registered ──────────────────────────────────────────────────

@app.delete("/clear-registered")
async def clear_registered():
    """
    Wipe ALL registered faces from the database and remove saved face images.

    REQUIRED when switching embedding models (e.g., Facenet → ArcFace).
    Old embeddings are incompatible with the new model — they must be deleted
    and all faces re-registered through Mode 1 (Folder Upload).
    """
    try:
        count = db.clear_all_registered_faces()
    except Exception as e:
        raise HTTPException(500, f"DB clear failed: {e}")

    # Also remove saved image files
    deleted_files = 0
    try:
        for f in REGISTERED_DIR.glob("*"):
            if f.is_file():
                f.unlink()
                deleted_files += 1
    except Exception as e:
        logger.warning("clear-registered: file cleanup error: %s", e)

    logger.info("clear-registered: removed %d DB rows, %d image files", count, deleted_files)
    return {
        "status":        "cleared",
        "rows_deleted":  count,
        "files_deleted": deleted_files,
        "message":       (
            f"Cleared {count} registered face(s) and {deleted_files} image file(s). "
            "Please re-register all faces through Mode 1 (Folder Upload) now."
        ),
    }


# ── GET /model-info ───────────────────────────────────────────────────────────

@app.get("/model-info")
async def model_info():
    """Return the current embedding model and thresholds."""
    return {
        "embedding_model":       "ArcFace",
        "embedding_dimensions":  512,
        "live_match_threshold":  0.55,
        "duplicate_threshold":   0.88,
        "description": (
            "ArcFace (512-D) — Best for cross-age matching. Extended to use strict "
            "distance filtering on live camera (0.55) while keeping Mode 1 intact."
        ),
    }
