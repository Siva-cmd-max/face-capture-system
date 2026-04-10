"""Full audit of Mode 1, Mode 2 and DB health."""
import requests, base64, os, struct, sys
import numpy as np
import importlib.util

BASE = "http://localhost:8000"

# ── 1. Health ──────────────────────────────────────────────────────────────────
print("====== BACKEND HEALTH ======")
try:
    h = requests.get(f"{BASE}/health", timeout=5).json()
    print(f"status={h.get('status')}  model_ready={h.get('model_ready')}")
except Exception as e:
    print("Backend NOT running:", e)
    sys.exit(1)

c = requests.get(f"{BASE}/registered-count", timeout=5).json()
print(f"Registered faces in DB: {c.get('count')}")

# ── 2. Mode 1 test ─────────────────────────────────────────────────────────────
print()
print("====== MODE 1  (bulk-register) ======")
reg_dir = "uploads/registered"
files   = [f for f in os.listdir(reg_dir) if f.lower().endswith((".jpg",".png",".jpeg"))]
if files:
    with open(os.path.join(reg_dir, files[0]), "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode()
    payload = {
        "folder_name": "audit_test",
        "images": [{"image_name": "AUDIT_TEST.jpg", "image_base64": b64}]
    }
    r = requests.post(f"{BASE}/bulk-register", json=payload, timeout=60)
    print(f"HTTP {r.status_code}")
    if r.status_code == 200:
        res = r.json().get("results", [{}])[0]
        print(f"  status       = {res.get('status')}")
        print(f"  face_detected= {res.get('face_detected')}")
        print(f"  time_ms      = {res.get('time_ms')}")
        print(f"  reason       = {res.get('reason','')[:100]}")
    else:
        print("  ERROR:", r.text[:300])
else:
    print("No images on disk to test with")

# ── 3. Mode 1 code checks ──────────────────────────────────────────────────────
print()
print("====== MODE 1  CODE CHECKS ======")
spec = importlib.util.spec_from_file_location("fp", "face_processor.py")
fp   = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fp)
import cv2

blank   = np.zeros((100,100,3), dtype=np.uint8)
white   = np.ones((100,100,3),  dtype=np.uint8)*255
noisy   = np.random.randint(0,255,(100,100,3), dtype=np.uint8)

q1 = fp.assess_image_quality(blank)
q2 = fp.assess_image_quality(white)
q3 = fp.assess_image_quality(noisy)
print(f"Blank image  : ok={q1.ok}  reason={q1.reason}")
print(f"White image  : ok={q2.ok}  reason={q2.reason}")
print(f"Noisy image  : ok={q3.ok}  (should be ok=True)")

# ── 4. compare_embeddings check ────────────────────────────────────────────────
print()
print("====== MODE 2  MATCHING LOGIC ======")
np.random.seed(42)
e1 = np.random.randn(512).astype(np.float32);  e1 /= np.linalg.norm(e1)
e2 = e1 + np.random.randn(512).astype(np.float32)*0.30;  e2 /= np.linalg.norm(e2)
e3 = np.random.randn(512).astype(np.float32);  e3 /= np.linalg.norm(e3)

vr_same = fp.compare_embeddings(e1.tolist(), e2.tolist())
vr_diff = fp.compare_embeddings(e1.tolist(), e3.tolist())
print(f"Same person  : cos={vr_same.cosine_raw:.4f}  pct={vr_same.match_pct:.1f}%")
print(f"Diff person  : cos={vr_diff.cosine_raw:.4f}  pct={vr_diff.match_pct:.1f}%")
threshold_ok = vr_same.cosine_raw >= 0.40 and vr_diff.cosine_raw < 0.40
print(f"Threshold 0.40 works correctly: {threshold_ok}")

# ── 5. DB embedding norms ──────────────────────────────────────────────────────
print()
print("====== DB EMBEDDING NORMS ======")
import pyodbc
conn = pyodbc.connect(
    "DRIVER={ODBC Driver 17 for SQL Server};SERVER=LAPTOP-P4AOTAG5;"
    "DATABASE=face_capture_db;UID=sa;PWD=P@ssw0rd;TrustServerCertificate=yes;"
)
cur = conn.cursor()
cur.execute("SELECT id, face_embedding FROM registered_faces")
rows      = cur.fetchall()
bad_norm  = 0
good_norm = 0
for row in rows:
    blob = bytes(row[1])
    n    = len(blob) // 4
    emb  = np.array(struct.unpack(str(n)+"f", blob), dtype=np.float32)
    norm = float(np.linalg.norm(emb))
    if abs(norm - 1.0) > 0.05:
        bad_norm += 1
    else:
        good_norm += 1
print(f"Correct norm (≈1.0) : {good_norm}/{len(rows)}")
print(f"Wrong norm (old)    : {bad_norm}/{len(rows)}")

cur.execute("SELECT TOP 3 id, image_name, eye_left_x, eye_right_x, nose_x, mouth_left_x FROM registered_faces ORDER BY id DESC")
print()
print("Latest 3 DB records:")
for r in cur.fetchall():
    print(f"  ID={r[0]} {r[1][:28]:<28} eye_l={r[2]:.0f} eye_r={r[3]:.0f} nose={r[4]:.0f} mouth={r[5]:.0f}")

cur.execute("SELECT TOP 3 match_status, match_score, detection_time_ms, detected_at FROM live_detection_logs ORDER BY id DESC")
live_rows = cur.fetchall()
if live_rows:
    print()
    print("Latest 3 live detection logs:")
    for r in live_rows:
        print(f"  {r[0]:<12} score={r[1]:.1f}%  detect={r[2]}ms  at={r[3]}")
conn.close()

print()
print("====== ALL CHECKS DONE ======")
