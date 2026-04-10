"""Full database health audit for face_capture_db."""
import pyodbc, struct, numpy as np

CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=LAPTOP-P4AOTAG5;"
    "DATABASE=face_capture_db;"
    "UID=sa;PWD=P@ssw0rd;"
    "TrustServerCertificate=yes;Connection Timeout=15;"
)

conn = pyodbc.connect(CONN_STR)
cur  = conn.cursor()

SEP = "=" * 60

print(SEP)
print("  FULL DATABASE HEALTH CHECK - face_capture_db")
print(SEP)

# ── 1. All tables ──────────────────────────────────────────────────────────────
print("\n[1] TABLES IN DATABASE")
cur.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME")
tables = [r[0] for r in cur.fetchall()]
for t in tables:
    cur.execute(f"SELECT COUNT(*) FROM {t}")
    cnt = cur.fetchone()[0]
    print(f"  {t:<35} -> {cnt} rows")

# ── 2. registered_faces deep check ────────────────────────────────────────────
print("\n[2] registered_faces AUDIT")
cur.execute("SELECT COUNT(*) FROM registered_faces")
total = cur.fetchone()[0]
print(f"  Total records             : {total}")

cur.execute("SELECT COUNT(*) FROM registered_faces WHERE face_embedding IS NULL")
null_emb = cur.fetchone()[0]
print(f"  NULL embeddings           : {null_emb}  {'❌ PROBLEM' if null_emb > 0 else '✅ OK'}")

cur.execute("SELECT COUNT(*) FROM registered_faces WHERE eye_left_x=0 AND eye_right_x=0 AND nose_x=0 AND mouth_left_x=0")
zero_lm = cur.fetchone()[0]
print(f"  All-zero landmarks        : {zero_lm}  {'⚠ WARNING' if zero_lm > 0 else '✅ OK'}")

cur.execute("SELECT COUNT(*) FROM registered_faces WHERE image_hash IS NULL OR image_hash=''")
null_hash = cur.fetchone()[0]
print(f"  NULL/empty image_hash     : {null_hash}  {'❌ PROBLEM' if null_hash > 0 else '✅ OK'}")

cur.execute("SELECT COUNT(*) FROM registered_faces WHERE image_name IS NULL OR image_name=''")
null_name = cur.fetchone()[0]
print(f"  NULL/empty image_name     : {null_name}  {'❌ PROBLEM' if null_name > 0 else '✅ OK'}")

cur.execute("SELECT image_name, COUNT(*) AS cnt FROM registered_faces GROUP BY image_name HAVING COUNT(*) > 1")
dup_names = cur.fetchall()
print(f"  Duplicate image names     : {len(dup_names)}  {'⚠ WARNING' if dup_names else '✅ OK'}")
for d in dup_names[:5]:
    print(f"    -> {d[0]} appears {d[1]}x")

# ── 3. Embedding norm check ────────────────────────────────────────────────────
print("\n[3] EMBEDDING QUALITY  (norm must be ~1.0 for correct cosine math)")
cur.execute("SELECT id, face_embedding FROM registered_faces")
rows = cur.fetchall()
bad_norm = good_norm = zero_norm = 0
min_norm = 999.0
max_norm = 0.0
for row in rows:
    if not row[1]:
        continue
    blob = bytes(row[1])
    n    = len(blob) // 4
    ev   = np.array(struct.unpack(f"{n}f", blob), dtype=np.float32)
    norm = float(np.linalg.norm(ev))
    if norm < 0.001:
        zero_norm += 1
    elif abs(norm - 1.0) > 0.05:
        bad_norm += 1
    else:
        good_norm += 1
    min_norm = min(min_norm, norm)
    max_norm = max(max_norm, norm)

print(f"  Correct norm (0.95-1.05)  : {good_norm}/{len(rows)}  {'✅ OK' if bad_norm==0 else ''}")
print(f"  Wrong norm (un-normalized): {bad_norm}/{len(rows)}  {'❌ NEEDS MIGRATION' if bad_norm > 0 else '✅ OK'}")
print(f"  Zero/corrupt embedding    : {zero_norm}/{len(rows)}  {'❌ PROBLEM' if zero_norm > 0 else '✅ OK'}")
if rows:
    print(f"  Norm range                : {min_norm:.6f} → {max_norm:.6f}")

# ── 4. Landmark coverage ───────────────────────────────────────────────────────
print("\n[4] LANDMARK COVERAGE")
cur.execute("SELECT COUNT(*) FROM registered_faces WHERE eye_left_x > 0")
el = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM registered_faces WHERE eye_right_x > 0")
er = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM registered_faces WHERE nose_x > 0")
nx = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM registered_faces WHERE mouth_left_x > 0")
mx = cur.fetchone()[0]
print(f"  eye_left_x  > 0  : {el}/{total}  ({el*100//total if total else 0}%)")
print(f"  eye_right_x > 0  : {er}/{total}  ({er*100//total if total else 0}%)")
print(f"  nose_x      > 0  : {nx}/{total}  ({nx*100//total if total else 0}%)")
print(f"  mouth_left_x> 0  : {mx}/{total}  ({mx*100//total if total else 0}%)")

# ── 5. live_detection_logs ─────────────────────────────────────────────────────
print("\n[5] live_detection_logs AUDIT")
cur.execute("SELECT COUNT(*) FROM live_detection_logs")
ld_total = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM live_detection_logs WHERE match_status='MATCHED'")
ld_match = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM live_detection_logs WHERE match_status='NOT_MATCHED'")
ld_no    = cur.fetchone()[0]
print(f"  Total logs         : {ld_total}")
print(f"  MATCHED            : {ld_match}")
print(f"  NOT_MATCHED        : {ld_no}")
if ld_total > 0:
    cur.execute("SELECT TOP 5 match_status, match_score, detection_time_ms, detected_at FROM live_detection_logs ORDER BY id DESC")
    for r in cur.fetchall():
        print(f"  -> {r[0]:<12}  score={r[1]:.1f}%  detect={r[2]}ms  at={r[3]}")

# ── 6. folder_scan_logs ────────────────────────────────────────────────────────
print("\n[6] folder_scan_logs AUDIT")
cur.execute("SELECT COUNT(*) FROM folder_scan_logs")
fl_total = cur.fetchone()[0]
print(f"  Total scan sessions: {fl_total}")
if fl_total > 0:
    cur.execute("SELECT TOP 3 folder_name,total_images,registered_count,failed_count,scanned_at FROM folder_scan_logs ORDER BY id DESC")
    for r in cur.fetchall():
        print(f"  -> {r[0][:20]:<20}  total={r[1]}  ok={r[2]}  fail={r[3]}  at={r[4]}")

# ── 7. Sample records ──────────────────────────────────────────────────────────
print("\n[7] LATEST 10 REGISTERED RECORDS")
cur.execute("SELECT TOP 10 id,image_name,eye_left_x,eye_right_x,nose_x,mouth_left_x,face_confidence,source,registered_at FROM registered_faces ORDER BY id DESC")
for r in cur.fetchall():
    print(f"  ID={r[0]:4d} | {r[1][:28]:<28} | eye=({r[2]:.0f}/{r[3]:.0f}) nose={r[4]:.0f} mouth={r[5]:.0f} | src={r[7]} | {r[8]}")

# ── 8. Oldest records ─────────────────────────────────────────────────────────
print("\n[8] OLDEST 5 REGISTERED RECORDS")
cur.execute("SELECT TOP 5 id,image_name,eye_left_x,nose_x,registered_at FROM registered_faces ORDER BY id ASC")
for r in cur.fetchall():
    print(f"  ID={r[0]:4d} | {r[1][:30]:<30} | eye={r[2]:.0f} nose={r[3]:.0f} | {r[4]}")

conn.close()
print()
print(SEP)
print("  AUDIT COMPLETE - No connection issues")
print(SEP)
