"""
Fix FK constraint on live_detection_logs so that DELETE FROM registered_faces
works from SSMS without any FK error.
Changes: REFERENCES registered_faces(id)  →  ON DELETE SET NULL
"""
import pyodbc

CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=LAPTOP-P4AOTAG5;"
    "DATABASE=face_capture_db;"
    "UID=sa;PWD=P@ssw0rd;"
    "TrustServerCertificate=yes;"
)

conn = pyodbc.connect(CONN_STR, autocommit=True)
cur  = conn.cursor()

print("Fixing FK constraint on live_detection_logs.matched_face_id ...")

# Find the FK constraint name
cur.execute("""
    SELECT name FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID('live_detection_logs')
      AND referenced_object_id = OBJECT_ID('registered_faces')
""")
fk_row = cur.fetchone()
if fk_row:
    fk_name = fk_row[0]
    print(f"  Found FK: {fk_name}")

    # Drop old FK
    cur.execute(f"ALTER TABLE live_detection_logs DROP CONSTRAINT [{fk_name}]")
    print(f"  Dropped old FK: {fk_name}")

    # Re-add with ON DELETE SET NULL
    cur.execute("""
        ALTER TABLE live_detection_logs
        ADD CONSTRAINT FK_live_detection_matched_face
        FOREIGN KEY (matched_face_id) REFERENCES registered_faces(id)
        ON DELETE SET NULL
    """)
    print("  Added new FK with ON DELETE SET NULL")
else:
    print("  No FK found — may already be fixed or column is nullable without FK")

# Verify
cur.execute("""
    SELECT fk.name, fk.delete_referential_action_desc
    FROM sys.foreign_keys fk
    WHERE fk.parent_object_id = OBJECT_ID('live_detection_logs')
""")
for r in cur.fetchall():
    print(f"  FK name: {r[0]}  delete_action: {r[1]}")

conn.close()
print("\n✅ FK fixed. You can now DELETE FROM registered_faces from SSMS freely.")
