import os
import sqlite3
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

DEFAULT_DB_PATH = os.path.join(".", "data", "newvora.db")
DB_PATH = os.getenv("DB_PATH", DEFAULT_DB_PATH)


def get_db_path() -> str:
    """Return the database file path from environment or default local path."""
    raw = os.getenv("DB_PATH", DEFAULT_DB_PATH)
    return raw.strip() if raw and raw.strip() else DEFAULT_DB_PATH


def get_db_connection() -> sqlite3.Connection:
    """Create and return a SQLite database connection with row factory enabled."""
    db_path = get_db_path()
    db_dir = os.path.dirname(os.path.abspath(db_path))
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    """Create all required tables if they do not exist and seed initial data if empty."""
    conn = get_db_connection()
    with conn:
        # 1. Members
        conn.execute("""
            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # 2. Clients
        conn.execute("""
            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                company TEXT NOT NULL,
                plan_name TEXT NOT NULL,
                monthly_fee REAL NOT NULL DEFAULT 0.0,
                establishment_fee_total REAL NOT NULL DEFAULT 0.0,
                establishment_fee_paid REAL NOT NULL DEFAULT 0.0,
                billing_day INTEGER NOT NULL DEFAULT 1,
                contract_end_date TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Dynamic migration for existing client table schema
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(clients);")
        existing_cols = {row["name"] for row in cursor.fetchall()}
        if "establishment_fee_total" not in existing_cols:
            conn.execute("ALTER TABLE clients ADD COLUMN establishment_fee_total REAL NOT NULL DEFAULT 0.0;")
        if "establishment_fee_paid" not in existing_cols:
            conn.execute("ALTER TABLE clients ADD COLUMN establishment_fee_paid REAL NOT NULL DEFAULT 0.0;")
        if "billing_day" not in existing_cols:
            conn.execute("ALTER TABLE clients ADD COLUMN billing_day INTEGER NOT NULL DEFAULT 1;")

        # 3. Tasks
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                request_type TEXT CHECK(request_type IN ('bug', 'new_feature', 'data_update', 'content_change', 'question')),
                priority TEXT CHECK(priority IN ('low', 'medium', 'high')),
                status TEXT CHECK(status IN ('todo', 'doing', 'done')) DEFAULT 'todo',
                assigned_member_id INTEGER,
                clarifying_question TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
                FOREIGN KEY (assigned_member_id) REFERENCES members (id) ON DELETE SET NULL
            );
        """)

        # 4. Activity Log
        conn.execute("""
            CREATE TABLE IF NOT EXISTS activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_name TEXT NOT NULL,
                action TEXT NOT NULL,
                details TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # 5. Income
        conn.execute("""
            CREATE TABLE IF NOT EXISTS income (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                month TEXT NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
            );
        """)

        # 6. Expenses
        conn.execute("""
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_name TEXT NOT NULL,
                amount REAL NOT NULL,
                month TEXT NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # 7. Task Comments
        conn.execute("""
            CREATE TABLE IF NOT EXISTS task_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                member_name TEXT NOT NULL,
                comment TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
            );
        """)

        # 8. Tools (Stage 7)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tools (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                monthly_cost REAL NOT NULL DEFAULT 0.0,
                renewal_date TEXT NOT NULL,
                owner_id INTEGER,
                owner_name TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES members (id) ON DELETE SET NULL
            );
        """)

        # 9. Task Notifications (Stage 7)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS task_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id INTEGER NOT NULL,
                task_id INTEGER NOT NULL,
                is_read INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE,
                FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
            );
        """)

    seed_db(conn)
    conn.close()


def seed_db(conn: sqlite3.Connection) -> None:
    """Seed sample data whenever the database is empty at startup, so the demo is never blank."""
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM members;")
    members_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM clients;")
    clients_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM tasks;")
    tasks_count = cursor.fetchone()[0]

    # Seed core tables if empty
    if members_count == 0 or clients_count == 0 or tasks_count == 0:
        with conn:
            # Seed 3 Members
            members_data = [
                ("Riya", "Founder & Full-stack Builder"),
                ("Rohan", "Client Outreach & Accounts"),
                ("Anya", "Social Media & Marketing"),
            ]
            cursor.executemany("INSERT OR IGNORE INTO members (name, role) VALUES (?, ?);", members_data)

            # Seed 3 Clients (with Stage 7 Establishment & Billing fields)
            clients_data = [
                ("Apex Dental Clinic", "Apex Healthcare", "Retainer Plus", 350.0, 1200.0, 1200.0, 1, "2026-12-31", "WhatsApp group active with Dr. Sameer. Website maintenance and patient booking portal."),
                ("Zephyr Cafe & Bakery", "Zephyr Hospitality", "Custom Growth", 500.0, 1800.0, 1000.0, 15, "2027-03-31", "Online ordering and seasonal menu updates."),
                ("Veda Health & Yoga", "Veda Wellness", "Basic Maintenance", 250.0, 800.0, 400.0, 28, "2026-11-30", "Weekly workshop schedule updates and membership landing page."),
            ]
            cursor.executemany("""
                INSERT INTO clients (name, company, plan_name, monthly_fee, establishment_fee_total, establishment_fee_paid, billing_day, contract_end_date, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, clients_data)

            # Get seeded IDs
        cursor.execute("SELECT id, name FROM members;")
        member_map = {row["name"]: row["id"] for row in cursor.fetchall()}

        cursor.execute("SELECT id, name FROM clients;")
        client_map = {row["name"]: row["id"] for row in cursor.fetchall()}

        # Seed Tasks
        tasks_data = [
            (
                client_map["Apex Dental Clinic"],
                "Fix mobile booking time slot dropdown overlap",
                "On iPhone Safari, the 4 PM slot gets hidden behind the sticky footer.",
                "bug",
                "high",
                "doing",
                member_map.get("Riya"),
                ""
            ),
            (
                client_map["Zephyr Cafe & Bakery"],
                "Add monsoon special dessert menu section",
                "Need a new tab under Menu for artisanal hot chocolates and baked cheesecakes.",
                "content_change",
                "medium",
                "todo",
                member_map.get("Anya"),
                ""
            ),
            (
                client_map["Veda Health & Yoga"],
                "Update Sunday morning meditation timing to 7:00 AM",
                "Client requested schedule shift from 7:30 AM to 7:00 AM across all portal pages.",
                "data_update",
                "low",
                "done",
                member_map.get("Rohan"),
                ""
            ),
            (
                client_map["Apex Dental Clinic"],
                "Inquire about SMS reminder integration provider",
                "Dr. Sameer asked if Twilio or MSG91 is cheaper for patient appointment SMS.",
                "question",
                "medium",
                "todo",
                member_map.get("Rohan"),
                "Would they prefer WhatsApp Business API alerts instead of standard SMS?"
            ),
        ]

        cursor.executemany("""
            INSERT INTO tasks (client_id, title, description, request_type, priority, status, assigned_member_id, clarifying_question)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        """, tasks_data)

        # Seed Activity Log
        activities = [
            ("System", "Database Initialized", "Seeded initial team members, clients, and active tasks."),
            ("Rohan", "Updated Task", "Marked 'Update Sunday morning meditation timing' as Done."),
            ("Riya", "Started Task", "Moved 'Fix mobile booking time slot dropdown overlap' to Doing."),
        ]
        cursor.executemany("""
            INSERT INTO activity_log (member_name, action, details)
            VALUES (?, ?, ?);
        """, activities)

        # Seed Income (Current Month: Zephyr is paid, Apex and Veda pending/overdue to demonstrate statuses)
        income_data = [
            (client_map["Zephyr Cafe & Bakery"], 500.0, "2026-10", "Growth plan retainer & menu updates"),
            (client_map["Apex Dental Clinic"], 350.0, "2026-09", "Monthly retainer for patient portal maintenance (September)"),
            (client_map["Veda Health & Yoga"], 250.0, "2026-09", "Basic maintenance retainer (September)"),
        ]
        cursor.executemany("""
            INSERT INTO income (client_id, amount, month, notes)
            VALUES (?, ?, ?, ?);
        """, income_data)

        # Seed Expenses (Current Month Tools)
        expenses_data = [
            ("Claude", 40.0, "2026-10", "AI model subscription for prompt prototyping"),
            ("Supabase", 25.0, "2026-10", "Client portal database hosting"),
            ("Vercel", 20.0, "2026-10", "Frontend deployments"),
            ("Cursor", 20.0, "2026-10", "Code editor subscription"),
            ("Render", 15.0, "2026-10", "Backend web service hosting"),
        ]
        cursor.executemany("""
            INSERT INTO expenses (tool_name, amount, month, notes)
            VALUES (?, ?, ?, ?);
        """, expenses_data)

    # Backfill client establishment & billing fields if empty
    with conn:
        cursor.execute("""
            UPDATE clients SET establishment_fee_total = 1200.0, establishment_fee_paid = 1200.0, billing_day = 1
            WHERE name = 'Apex Dental Clinic' AND (establishment_fee_total IS NULL OR establishment_fee_total = 0);
        """)
        cursor.execute("""
            UPDATE clients SET establishment_fee_total = 1800.0, establishment_fee_paid = 1000.0, billing_day = 15
            WHERE name = 'Zephyr Cafe & Bakery' AND (establishment_fee_total IS NULL OR establishment_fee_total = 0);
        """)
        cursor.execute("""
            UPDATE clients SET establishment_fee_total = 800.0, establishment_fee_paid = 400.0, billing_day = 28
            WHERE name = 'Veda Health & Yoga' AND (establishment_fee_total IS NULL OR establishment_fee_total = 0);
        """)
        # If Apex Dental or Veda Health has sample income for 2026-10 from initial seed, shift to 2026-09 to demonstrate Overdue and Pending statuses on Dues
        cursor.execute("SELECT id FROM clients WHERE name = 'Apex Dental Clinic';")
        apex = cursor.fetchone()
        cursor.execute("SELECT id FROM clients WHERE name = 'Veda Health & Yoga';")
        veda = cursor.fetchone()
        if apex and veda:
            cursor.execute("UPDATE income SET month = '2026-09' WHERE client_id = ? AND month = '2026-10' AND notes LIKE '%patient portal maintenance%';", (apex["id"],))
            cursor.execute("UPDATE income SET month = '2026-09' WHERE client_id = ? AND month = '2026-10' AND notes LIKE '%Basic maintenance retainer%';", (veda["id"],))

    # Seed Tools (Stage 7)
    with conn:
        cursor.execute("SELECT COUNT(*) FROM tools;")
        if cursor.fetchone()[0] == 0:
            cursor.execute("SELECT id, name FROM members;")
            m_map = {row["name"]: row["id"] for row in cursor.fetchall()}
            tools_data = [
                ("Cursor", 20.0, "2026-10-06", m_map.get("Riya"), "Riya", "AI code editor monthly subscription"),
                ("Vercel", 20.0, "2026-10-08", m_map.get("Riya"), "Riya", "Frontend hosting and client staging domains"),
                ("Claude", 40.0, "2026-10-21", m_map.get("Riya"), "Riya", "Model subscription for prompt design & copywriting"),
                ("Supabase", 25.0, "2026-10-25", m_map.get("Rohan"), "Rohan", "PostgreSQL database hosting & auth for client portals"),
                ("Render", 15.0, "2026-10-28", m_map.get("Anya"), "Anya", "Backend API web services hosting"),
            ]
            cursor.executemany("""
                INSERT INTO tools (name, monthly_cost, renewal_date, owner_id, owner_name, notes)
                VALUES (?, ?, ?, ?, ?, ?);
            """, tools_data)

    # Seed Task Notifications (Stage 7)
    with conn:
        cursor.execute("SELECT COUNT(*) FROM task_notifications;")
        if cursor.fetchone()[0] == 0:
            cursor.execute("SELECT id, assigned_member_id FROM tasks WHERE assigned_member_id IS NOT NULL;")
            assigned_tasks = cursor.fetchall()
            notifs_data = []
            for t in assigned_tasks:
                notifs_data.append((t["assigned_member_id"], t["id"], 0)) # unread
            if notifs_data:
                cursor.executemany("""
                    INSERT INTO task_notifications (member_id, task_id, is_read)
                    VALUES (?, ?, ?);
                """, notifs_data)
