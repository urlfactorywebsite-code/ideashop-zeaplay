import sqlite3

conn = sqlite3.connect('vee_task_manager.db')
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [row[0] for row in cursor.fetchall()]
print("All tables:", tables)

cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%template%'")
template_tables = [row[0] for row in cursor.fetchall()]
print("Tables with 'template' in name:", template_tables)

conn.close()
