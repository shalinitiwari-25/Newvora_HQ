import os
import sqlite3
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.getenv("DB_PATH", "newvora.db")


def get_db_path() -> str:
    """Return the database file path from environment or default."""
    return os.getenv("DB_PATH", "newvora.db")


def get_db_connection() -> sqlite3.Connection:
    """Create and return a SQLite database connection with row factory enabled."""
    conn = sqlite3.connect(get_db_path())
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
                contract_end_date TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

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

    seed_db(conn)
    conn.close()


def seed_db(conn: sqlite3.Connection) -> None:
    """Seed sample data if the members table is empty."""
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM members;")
    count = cursor.fetchone()[0]
    if count > 0:
        return

    with conn:
        # Seed 3 Members
        members_data = [
            ("Riya", "Founder & Full-stack Builder"),
            ("Rohan", "Client Outreach & Accounts"),
            ("Anya", "Social Media & Marketing"),
        ]
        cursor.executemany("INSERT INTO members (name, role) VALUES (?, ?);", members_data)

        # Seed 3 Clients
        clients_data = [
            ("Apex Dental Clinic", "Apex Healthcare", "Retainer Plus", 350.0, "2026-12-31", "WhatsApp group active with Dr. Sameer. Website maintenance and patient booking portal."),
            ("Zephyr Cafe & Bakery", "Zephyr Hospitality", "Custom Growth", 500.0, "2027-03-31", "Online ordering and seasonal menu updates."),
            ("Veda Health & Yoga", "Veda Wellness", "Basic Maintenance", 250.0, "2026-11-30", "Weekly workshop schedule updates and membership landing page."),
        ]
        cursor.executemany("""
            INSERT INTO clients (name, company, plan_name, monthly_fee, contract_end_date, notes)
            VALUES (?, ?, ?, ?, ?, ?);
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

        # Seed Income (Current Month)
        income_data = [
            (client_map["Apex Dental Clinic"], 350.0, "2026-10", "Monthly retainer for patient portal maintenance"),
            (client_map["Zephyr Cafe & Bakery"], 500.0, "2026-10", "Growth plan retainer & menu updates"),
            (client_map["Veda Health & Yoga"], 250.0, "2026-10", "Basic maintenance retainer"),
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
