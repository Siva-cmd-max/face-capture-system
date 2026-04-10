"""
database.py — face_capture_db on LAPTOP-P4AOTAG5
Original tables: candidates, live_verifications, photo_comparisons, photo_comparison_results
New tables:       registered_faces, folder_scan_logs, single_upload_logs, live_detection_logs
"""

import json
import logging
import struct
import numpy as np
import pyodbc
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

_MASTER_CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=LAPTOP-P4AOTAG5;"
    "DATABASE=master;"
    "UID=sa;PWD=P@ssw0rd;"
    "TrustServerCertificate=yes;Connection Timeout=30;"
)

DB_NAME = "face_capture_db"

_DB_CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=LAPTOP-P4AOTAG5;"
    f"DATABASE={DB_NAME};"
    "UID=sa;PWD=P@ssw0rd;"
    "TrustServerCertificate=yes;Connection Timeout=30;"
)


def get_connection() -> pyodbc.Connection:
    return pyodbc.connect(_DB_CONN_STR, autocommit=False)


# ── Database + original tables initialization ─────────────────────────────────

def init_database() -> None:
    """Create face_capture_db + original 4 tables (IF NOT EXISTS)."""
    try:
        conn = pyodbc.connect(_MASTER_CONN_STR, autocommit=True)
        conn.cursor().execute(
            f"IF NOT EXISTS (SELECT name FROM sys.databases WHERE name=N'{DB_NAME}') "
            f"CREATE DATABASE [{DB_NAME}]"
        )
        conn.close()
        logger.info("DB '%s' ready.", DB_NAME)
    except Exception as exc:
        logger.error("Cannot create DB: %s", exc); raise

    try:
        conn = get_connection()
        cur  = conn.cursor()

        cur.execute("""
        IF NOT EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='candidates')
        CREATE TABLE candidates (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            image_name    NVARCHAR(255) NOT NULL UNIQUE,
            embedding     NVARCHAR(MAX) NOT NULL,
            face_box_x    FLOAT, face_box_y FLOAT, face_box_w FLOAT, face_box_h FLOAT,
            img_width     INT,   img_height  INT,
            scan_time_ms  INT,   processing_ms INT,
            is_duplicate  BIT DEFAULT 0,
            uploaded_at   DATETIME DEFAULT GETDATE(),
            photo_base64  VARCHAR(MAX)
        )""")

        cur.execute("""
        IF NOT EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='live_verifications')
        CREATE TABLE live_verifications (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            image_name    NVARCHAR(255) NOT NULL,
            match_pct     FLOAT,
            matched       BIT,
            cosine_raw    FLOAT,
            scan_time_ms  INT,
            total_time_ms INT,
            verified_at   DATETIME DEFAULT GETDATE()
        )""")

        cur.execute("""
        IF NOT EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='photo_comparisons')
        CREATE TABLE photo_comparisons (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            left_image_name  NVARCHAR(255) NOT NULL,
            right_image_name NVARCHAR(255) NOT NULL,
            left_embedding   NVARCHAR(MAX),
            right_embedding  NVARCHAR(MAX),
            left_scan_ms     INT,
            right_scan_ms    INT,
            comparison_ms    INT,
            total_time_ms    INT,
            created_at       DATETIME DEFAULT GETDATE()
        )""")

        cur.execute("""
        IF NOT EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='photo_comparison_results')
        CREATE TABLE photo_comparison_results (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            comparison_id INT NOT NULL REFERENCES photo_comparisons(id),
            match_pct     FLOAT,
            matched       BIT,
            cosine_raw    FLOAT,
            compared_at   DATETIME DEFAULT GETDATE()
        )""")

        conn.commit(); conn.close()
        logger.info("Original 4 tables synced in '%s'.", DB_NAME)
    except Exception as exc:
        logger.error("Original table init failed: %s", exc); raise


# ── NEW TABLES initialization ─────────────────────────────────────────────────

def init_new_tables() -> None:
    """Create the 4 new tables for the bulk-register / live-detect feature.
    Safe to call every startup — uses IF NOT EXISTS on every table."""
    try:
        conn = get_connection()
        cur  = conn.cursor()

        # TABLE 1 — registered_faces
        cur.execute("""
        IF NOT EXISTS (
            SELECT * FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME = 'registered_faces'
        )
        BEGIN
            CREATE TABLE registered_faces (
                id                INT IDENTITY(1,1) PRIMARY KEY,
                image_name        NVARCHAR(255)  NOT NULL,
                image_path        NVARCHAR(500)  NOT NULL,
                image_hash        NVARCHAR(64)   NOT NULL UNIQUE,
                face_embedding    VARBINARY(MAX) NOT NULL,
                eye_left_x        FLOAT,
                eye_left_y        FLOAT,
                eye_right_x       FLOAT,
                eye_right_y       FLOAT,
                nose_x            FLOAT,
                nose_y            FLOAT,
                mouth_left_x      FLOAT,
                mouth_left_y      FLOAT,
                mouth_right_x     FLOAT,
                mouth_right_y     FLOAT,
                face_confidence   FLOAT,
                source            NVARCHAR(50)   DEFAULT 'folder_upload',
                registered_at     DATETIME       DEFAULT GETDATE()
            )
        END
        """)

        # TABLE 2 — folder_scan_logs
        cur.execute("""
        IF NOT EXISTS (
            SELECT * FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME = 'folder_scan_logs'
        )
        BEGIN
            CREATE TABLE folder_scan_logs (
                id                INT IDENTITY(1,1) PRIMARY KEY,
                folder_name       NVARCHAR(255)  NOT NULL,
                total_images      INT            DEFAULT 0,
                registered_count  INT            DEFAULT 0,
                duplicate_count   INT            DEFAULT 0,
                failed_count      INT            DEFAULT 0,
                total_time_sec    FLOAT,
                avg_time_ms       FLOAT,
                scanned_at        DATETIME       DEFAULT GETDATE()
            )
        END
        """)

        # TABLE 3 — single_upload_logs
        cur.execute("""
        IF NOT EXISTS (
            SELECT * FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME = 'single_upload_logs'
        )
        BEGIN
            CREATE TABLE single_upload_logs (
                id                INT IDENTITY(1,1) PRIMARY KEY,
                image_name        NVARCHAR(255)  NOT NULL,
                status            NVARCHAR(50)   NOT NULL,
                time_ms           FLOAT,
                reason            NVARCHAR(255),
                uploaded_at       DATETIME       DEFAULT GETDATE()
            )
        END
        """)

        # TABLE 4 — live_detection_logs (FK → registered_faces.id ON DELETE SET NULL)
        # ON DELETE SET NULL: deleting a registered_face keeps the audit log but clears the FK
        cur.execute("""
        IF NOT EXISTS (
            SELECT * FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME = 'live_detection_logs'
        )
        BEGIN
            CREATE TABLE live_detection_logs (
                id                INT IDENTITY(1,1) PRIMARY KEY,
                captured_image    NVARCHAR(500),
                matched_face_id   INT REFERENCES registered_faces(id) ON DELETE SET NULL,
                match_score       FLOAT,
                detection_time_ms FLOAT,
                match_status      NVARCHAR(50),
                detected_at       DATETIME       DEFAULT GETDATE()
            )
        END
        """)

        conn.commit(); conn.close()
        logger.info("New 4 tables verified/created in '%s'.", DB_NAME)
    except Exception as exc:
        logger.error("New table init failed: %s", exc); raise


# ── Helpers: embedding <-> bytes ───────────────────────────────────────────────

def _embedding_to_bytes(embedding: List[float]) -> bytes:
    """L2-normalize embedding then convert to packed binary (float32 little-endian)."""
    ev = np.array(embedding, dtype=np.float32)
    norm = np.linalg.norm(ev)
    if norm > 0:
        ev = ev / norm          # L2-normalize to unit vector
    return struct.pack(f"<{len(ev)}f", *ev.tolist())


def _bytes_to_embedding(data: bytes) -> List[float]:
    """Decode packed binary back to float list."""
    n = len(data) // 4
    return list(struct.unpack(f"<{n}f", data))


# ── registered_faces CRUD ──────────────────────────────────────────────────────

def get_registered_face_by_hash(image_hash: str) -> Optional[Dict[str, Any]]:
    """Level 1 duplicate check — by image MD5 hash."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, image_name, registered_at FROM registered_faces WHERE image_hash=?",
            image_hash
        )
        row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "image_name": row[1], "registered_at": str(row[2])}
    finally:
        conn.close()


def get_all_registered_embeddings() -> List[Dict[str, Any]]:
    """Fetch all non-deleted registered faces for 1-to-N matching."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, image_name, face_embedding, face_confidence, registered_at, "
            "eye_left_x, eye_left_y, eye_right_x, eye_right_y, nose_x, nose_y, "
            "mouth_left_x, mouth_left_y "
            "FROM registered_faces"
        )
        rows = cur.fetchall()
        results = []
        for row in rows:
            try:
                emb = _bytes_to_embedding(bytes(row[2]))
            except Exception:
                continue
            
            # Decode and L2-normalize (robustness for older un-normalized entries)
            ev = np.array(emb, dtype=np.float32)
            norm = np.linalg.norm(ev)
            if norm > 0:
                ev = ev / norm
            emb = ev.tolist()

            # Build landmark vector (pixel coordinates packed as float32)
            lm_vec = np.array([
                float(row[5] or 0), float(row[6] or 0),
                float(row[7] or 0), float(row[8] or 0),
                float(row[9] or 0), float(row[10] or 0),
                float(row[11] or 0), float(row[12] or 0)
            ], dtype=np.float32)

            results.append({
                "id":           row[0],
                "image_name":   row[1],
                "embedding":    emb,
                "confidence":   row[3],
                "registered_at": str(row[4]),
                "landmark_vec": lm_vec
            })
        return results
    finally:
        conn.close()


def insert_registered_face(
    image_name: str,
    image_path: str,
    image_hash: str,
    embedding: List[float],
    eye_left_x: float = 0, eye_left_y: float = 0,
    eye_right_x: float = 0, eye_right_y: float = 0,
    nose_x: float = 0, nose_y: float = 0,
    mouth_left_x: float = 0, mouth_left_y: float = 0,
    mouth_right_x: float = 0, mouth_right_y: float = 0,
    face_confidence: float = 1.0,
    source: str = "folder_upload",
) -> int:
    """Insert a new registered face. Returns new id or -1 on failure."""
    emb_bytes = _embedding_to_bytes(embedding)
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO registered_faces("
            "image_name,image_path,image_hash,face_embedding,"
            "eye_left_x,eye_left_y,eye_right_x,eye_right_y,"
            "nose_x,nose_y,mouth_left_x,mouth_left_y,mouth_right_x,mouth_right_y,"
            "face_confidence,source"
            ") OUTPUT INSERTED.id VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            image_name, image_path, image_hash, pyodbc.Binary(emb_bytes),
            eye_left_x, eye_left_y, eye_right_x, eye_right_y,
            nose_x, nose_y, mouth_left_x, mouth_left_y, mouth_right_x, mouth_right_y,
            face_confidence, source
        )
        row = cur.fetchone()
        conn.commit()
        return row[0] if row else -1
    except pyodbc.IntegrityError:
        # Unique constraint on image_hash — treat as duplicate
        conn.rollback()
        return -2
    finally:
        conn.close()


def get_registered_face_by_id(face_id: int) -> Optional[Dict[str, Any]]:
    """Fetch full record for Mode 2 display after a match."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id,image_name,image_path,face_confidence,registered_at "
            "FROM registered_faces WHERE id=?", face_id
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0], "image_name": row[1],
            "image_path": row[2], "confidence": row[3],
            "registered_at": str(row[4]),
        }
    finally:
        conn.close()


def count_registered_faces() -> int:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM registered_faces")
        row = cur.fetchone()
        return row[0] if row else 0
    finally:
        conn.close()


def clear_all_registered_faces() -> int:
    """Deletes all rows from registered_faces and returns the number of deleted rows."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        # Get count before deletion
        cur.execute("SELECT COUNT(*) FROM registered_faces")
        row = cur.fetchone()
        count = row[0] if row else 0

        cur.execute("DELETE FROM registered_faces")
        conn.commit()
        return count
    finally:
        conn.close()


# ── folder_scan_logs CRUD ──────────────────────────────────────────────────────

def log_folder_scan(
    folder_name: str,
    total_images: int,
    registered_count: int,
    duplicate_count: int,
    failed_count: int,
    total_time_sec: float,
    avg_time_ms: float,
) -> int:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO folder_scan_logs("
            "folder_name,total_images,registered_count,duplicate_count,"
            "failed_count,total_time_sec,avg_time_ms"
            ") OUTPUT INSERTED.id VALUES(?,?,?,?,?,?,?)",
            folder_name, total_images, registered_count,
            duplicate_count, failed_count, total_time_sec, avg_time_ms
        )
        row = cur.fetchone()
        conn.commit()
        return row[0] if row else -1
    finally:
        conn.close()


# ── single_upload_logs CRUD ────────────────────────────────────────────────────

def log_single_upload(
    image_name: str,
    status: str,
    time_ms: float,
    reason: str = "",
) -> int:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO single_upload_logs(image_name,status,time_ms,reason)"
            " OUTPUT INSERTED.id VALUES(?,?,?,?)",
            image_name, status, time_ms, reason or None
        )
        row = cur.fetchone()
        conn.commit()
        return row[0] if row else -1
    finally:
        conn.close()


# ── live_detection_logs CRUD ───────────────────────────────────────────────────

def get_live_detection_logs(limit: int = 100, status_filter: str = "") -> list:
    """Fetch live detection history, newest first."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        if status_filter:
            cur.execute(
                "SELECT TOP (?) id,captured_image,matched_face_id,match_score,"
                "detection_time_ms,match_status,detected_at "
                "FROM live_detection_logs WHERE match_status=? "
                "ORDER BY detected_at DESC",
                limit, status_filter
            )
        else:
            cur.execute(
                "SELECT TOP (?) id,captured_image,matched_face_id,match_score,"
                "detection_time_ms,match_status,detected_at "
                "FROM live_detection_logs "
                "ORDER BY detected_at DESC",
                limit
            )
        rows = cur.fetchall()
        results = []
        for row in rows:
            results.append({
                "id":                row[0],
                "captured_image":    row[1] or "",
                "matched_face_id":   row[2],
                "match_score":       row[3],
                "detection_time_ms": row[4],
                "match_status":      row[5],
                "detected_at":       str(row[6]),
            })
        return results
    finally:
        conn.close()


def get_detection_log_by_id(log_id: int) -> Optional[Dict[str, Any]]:
    """Fetch a single detection log record by id."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id,captured_image,matched_face_id,match_score,"
            "detection_time_ms,match_status,detected_at "
            "FROM live_detection_logs WHERE id=?", log_id
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id":                row[0],
            "captured_image":    row[1] or "",
            "matched_face_id":   row[2],
            "match_score":       row[3],
            "detection_time_ms": row[4],
            "match_status":      row[5],
            "detected_at":       str(row[6]),
        }
    finally:
        conn.close()


def log_live_detection(
    matched_face_id: Optional[int],
    match_score: float,
    detection_time_ms: float,
    match_status: str,
    captured_image: str = "",
) -> int:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO live_detection_logs("
            "captured_image,matched_face_id,match_score,detection_time_ms,match_status"
            ") OUTPUT INSERTED.id VALUES(?,?,?,?,?)",
            captured_image or None, matched_face_id, match_score,
            detection_time_ms, match_status
        )
        row = cur.fetchone()
        conn.commit()
        return row[0] if row else -1
    finally:
        conn.close()


# ── Original table CRUD (unchanged) ──────────────────────────────────────────

def get_candidate_by_name(image_name: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id,image_name,embedding,face_box_x,face_box_y,face_box_w,face_box_h,"
            "img_width,img_height,scan_time_ms,processing_ms,is_duplicate,uploaded_at,photo_base64 "
            "FROM candidates WHERE image_name=?", image_name.lower()
        )
        row = cur.fetchone()
        if not row: return None
        return {
            "id": row[0], "image_name": row[1],
            "embedding": json.loads(row[2]),
            "face_box_x": row[3], "face_box_y": row[4],
            "face_box_w": row[5], "face_box_h": row[6],
            "img_width": row[7], "img_height": row[8],
            "scan_time_ms": row[9], "processing_ms": row[10],
            "is_duplicate": bool(row[11]), "uploaded_at": str(row[12]),
            "photo_base64": row[13] if len(row) > 13 else None,
        }
    finally:
        conn.close()


def mark_candidate_duplicate(image_name: str) -> None:
    conn = get_connection()
    try:
        conn.cursor().execute(
            "UPDATE candidates SET is_duplicate=1 WHERE image_name=?", image_name.lower()
        )
        conn.commit()
    finally:
        conn.close()


def get_all_candidates() -> list:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id,image_name,embedding,face_box_x,face_box_y,face_box_w,face_box_h,"
            "img_width,img_height,scan_time_ms,processing_ms,is_duplicate,uploaded_at,photo_base64 "
            "FROM candidates WHERE is_duplicate=0"
        )
        rows = cur.fetchall()
        results = []
        for row in rows:
            results.append({
                "id": row[0], "image_name": row[1],
                "embedding": json.loads(row[2]),
                "face_box_x": row[3], "face_box_y": row[4],
                "face_box_w": row[5], "face_box_h": row[6],
                "img_width": row[7], "img_height": row[8],
                "scan_time_ms": row[9], "processing_ms": row[10],
                "is_duplicate": bool(row[11]), "uploaded_at": str(row[12]),
                "photo_base64": row[13] if len(row) > 13 else None,
            })
        return results
    finally:
        conn.close()


def insert_candidate(image_name, embedding, face_box_x, face_box_y,
                     face_box_w, face_box_h, img_width, img_height,
                     scan_time_ms, processing_ms, photo_base64=None) -> int:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO candidates(image_name,embedding,face_box_x,face_box_y,face_box_w,"
            "face_box_h,img_width,img_height,scan_time_ms,processing_ms,is_duplicate,photo_base64)"
            " OUTPUT INSERTED.id VALUES(?,?,?,?,?,?,?,?,?,?,0,?)",
            image_name.lower(), json.dumps(embedding),
            face_box_x, face_box_y, face_box_w, face_box_h,
            img_width, img_height, scan_time_ms, processing_ms, photo_base64
        )
        row = cur.fetchone(); conn.commit()
        return row[0] if row else -1
    finally:
        conn.close()


def insert_live_verification(image_name, match_pct, matched,
                              cosine_raw, scan_time_ms, total_time_ms) -> int:
    if not matched: return -1
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO live_verifications(image_name,match_pct,matched,cosine_raw,"
            "scan_time_ms,total_time_ms) OUTPUT INSERTED.id VALUES(?,?,?,?,?,?)",
            image_name.lower(), match_pct, 1, cosine_raw, scan_time_ms, total_time_ms
        )
        row = cur.fetchone(); conn.commit()
        return row[0] if row else -1
    finally:
        conn.close()


def insert_photo_comparison(left_image_name, right_image_name,
                             left_embedding, right_embedding,
                             left_scan_ms, right_scan_ms,
                             comparison_ms, total_time_ms) -> int:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO photo_comparisons(left_image_name,right_image_name,"
            "left_embedding,right_embedding,left_scan_ms,right_scan_ms,"
            "comparison_ms,total_time_ms) OUTPUT INSERTED.id VALUES(?,?,?,?,?,?,?,?)",
            left_image_name.lower(), right_image_name.lower(),
            json.dumps(left_embedding), json.dumps(right_embedding),
            left_scan_ms, right_scan_ms, comparison_ms, total_time_ms
        )
        row = cur.fetchone(); conn.commit()
        return row[0] if row else -1
    finally:
        conn.close()


def insert_photo_comparison_result(comparison_id, match_pct,
                                    matched, cosine_raw) -> int:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO photo_comparison_results(comparison_id,match_pct,matched,cosine_raw)"
            " OUTPUT INSERTED.id VALUES(?,?,?,?)",
            comparison_id, match_pct, 1 if matched else 0, cosine_raw
        )
        row = cur.fetchone(); conn.commit()
        return row[0] if row else -1
    finally:
        conn.close()
