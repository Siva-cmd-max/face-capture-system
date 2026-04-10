import pyodbc

DB_CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=LAPTOP-P4AOTAG5;"
    "DATABASE=face_capture_db;"
    "UID=sa;PWD=P@ssw0rd;"
    "TrustServerCertificate=yes;Connection Timeout=30;"
)

conn = pyodbc.connect(DB_CONN_STR, autocommit=True)
cur = conn.cursor()
cur.execute("""
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'dbo.candidates') AND name = 'photo_base64'
)
BEGIN
    ALTER TABLE candidates ADD photo_base64 VARCHAR(MAX);
    PRINT 'Added photo_base64 column to candidates';
END
ELSE
    PRINT 'Column photo_base64 already exists';
""")
conn.close()
print("Done.")
