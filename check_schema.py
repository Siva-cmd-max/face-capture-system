import pyodbc

conn_str = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=LAPTOP-P4AOTAG5;"
    "DATABASE=face_verification_systemDB;"
    "UID=sa;"
    "PWD=P@ssw0rd;"
    "TrustServerCertificate=yes;"
)

try:
    conn = pyodbc.connect(conn_str)
    cursor = conn.cursor()
    cursor.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='FaceEmbeddings'")
    rows = cursor.fetchall()
    for row in rows:
        print(f"{row.COLUMN_NAME}: {row.DATA_TYPE}")
    conn.close()
except Exception as e:
    print("Error:", e)
