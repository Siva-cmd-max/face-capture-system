"""Fix FK constraint and safely clear/reset registered_faces table."""
import pyodbc

CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=LAPTOP-P4AOTAG5;"
    "DATABASE=face_capture_db;"
    "UID=sa;PWD=P@ssw0rd;"
    "TrustServerCertificate=yes;"
)

conn = pyodbc.connect(CONN_STR, autocommit=False)
cur  = conn.cursor()

print("=" * 55)
print("  SAFE DELETE - Fixing FK constraint & clearing data")
print("=" * 55)

# Show counts before
cur.execute("SELECT COUNT(*) FROM live_detection_logs")
ld = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM registered_faces")
rf = cur.fetchone()[0]
print(f"\nBefore: registered_faces={rf}  live_detection_logs={ld}")

# Step 1: Delete child records first (live_detection_logs references registered_faces)
print("\nStep 1: Deleting live_detection_logs (child table)...")
cur.execute("DELETE FROM live_detection_logs")
print(f"  Deleted {cur.rowcount} rows from live_detection_logs")

# Step 2: Delete folder_scan_logs (safe cleanup)
cur.execute("DELETE FROM folder_scan_logs")
print(f"  Deleted {cur.rowcount} rows from folder_scan_logs")

# Step 3: Delete single_upload_logs
cur.execute("DELETE FROM single_upload_logs")
print(f"  Deleted {cur.rowcount} rows from single_upload_logs")

# Step 4: Now safely delete registered_faces
print("\nStep 2: Deleting registered_faces...")
cur.execute("DELETE FROM registered_faces")
deleted = cur.rowcount
print(f"  Deleted {deleted} rows from registered_faces")

# Step 5: Reset identity counter so IDs start from 1 again
print("\nStep 3: Resetting identity seeds...")
cur.execute("DBCC CHECKIDENT ('registered_faces', RESEED, 0)")
cur.execute("DBCC CHECKIDENT ('live_detection_logs', RESEED, 0)")
print("  Identity reset to 0 (next insert will be ID=1)")

conn.commit()

# Verify
cur.execute("SELECT COUNT(*) FROM registered_faces")
after_rf = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM live_detection_logs")
after_ld = cur.fetchone()[0]
print(f"\nAfter:  registered_faces={after_rf}  live_detection_logs={after_ld}")

conn.close()
print("\n✅ All tables cleared successfully. Ready for fresh registration.")
print("=" * 55)
