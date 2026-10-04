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

        # 10. Client Payments (Stage 8 Part 2)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS client_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                month TEXT NOT NULL,
                amount_expected REAL NOT NULL,
                amount_received REAL NOT NULL DEFAULT 0.0,
                date_received TEXT,
                method TEXT,
                note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
            );
        """)

        # 11. Tool Usage Log (Stage 8 Part 3)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tool_usage_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                amount_used REAL NOT NULL,
                note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tool_id) REFERENCES tools (id) ON DELETE CASCADE
            );
        """)

        # 12. Centralized Notifications (Stage 8 Part 4)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id INTEGER,
                type TEXT NOT NULL,
                text TEXT NOT NULL,
                link_type TEXT,
                link_id INTEGER,
                is_read INTEGER NOT NULL DEFAULT 0,
                stable_key TEXT UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
            );
        """)

        # Dynamic migrations for tools table (Stage 8 Part 3)
        cursor.execute("PRAGMA table_info(tools);")
        existing_tool_cols = {row["name"] for row in cursor.fetchall()}
        if "plan_name" not in existing_tool_cols:
            conn.execute("ALTER TABLE tools ADD COLUMN plan_name TEXT DEFAULT '';")
        if "budget_amount" not in existing_tool_cols:
            conn.execute("ALTER TABLE tools ADD COLUMN budget_amount REAL NOT NULL DEFAULT 0.0;")
        if "unit" not in existing_tool_cols:
            conn.execute("ALTER TABLE tools ADD COLUMN unit TEXT NOT NULL DEFAULT 'USD';")

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

    # Seed Client Payments (Stage 8 Part 2) - 3 months demo data
    with conn:
        cursor.execute("SELECT COUNT(*) FROM client_payments;")
        if cursor.fetchone()[0] == 0:
            cursor.execute("SELECT id, name, monthly_fee FROM clients;")
            c_rows = cursor.fetchall()
            c_map = {row["name"]: row for row in c_rows}

            payments_data = []
            apex = c_map.get("Apex Dental Clinic")
            zephyr = c_map.get("Zephyr Cafe & Bakery")
            veda = c_map.get("Veda Health & Yoga")

            if apex and zephyr and veda:
                # August 2026 (All paid)
                payments_data.extend([
                    (apex["id"], "2026-08", float(apex["monthly_fee"]), float(apex["monthly_fee"]), "2026-08-01", "Bank Transfer", "August Retainer fee received"),
                    (zephyr["id"], "2026-08", float(zephyr["monthly_fee"]), float(zephyr["monthly_fee"]), "2026-08-15", "UPI", "Growth retainer (August)"),
                    (veda["id"], "2026-08", float(veda["monthly_fee"]), float(veda["monthly_fee"]), "2026-08-28", "Bank Transfer", "Basic maintenance retainer (August)"),
                ])
                # September 2026 (Veda partial)
                payments_data.extend([
                    (apex["id"], "2026-09", float(apex["monthly_fee"]), float(apex["monthly_fee"]), "2026-09-02", "Bank Transfer", "September Retainer fee received"),
                    (zephyr["id"], "2026-09", float(zephyr["monthly_fee"]), float(zephyr["monthly_fee"]), "2026-09-15", "UPI", "Growth retainer (September)"),
                    (veda["id"], "2026-09", float(veda["monthly_fee"]), 150.0, "2026-09-29", "UPI", "Partial installment, $100 balance carried over"),
                ])
                # October 2026 (Zephyr paid, Apex overdue, Veda pending)
                payments_data.extend([
                    (apex["id"], "2026-10", float(apex["monthly_fee"]), 0.0, None, None, "Due Oct 1st - awaiting transfer"),
                    (zephyr["id"], "2026-10", float(zephyr["monthly_fee"]), float(zephyr["monthly_fee"]), "2026-10-02", "UPI", "October retainer settled early"),
                    (veda["id"], "2026-10", float(veda["monthly_fee"]), 0.0, None, None, "Due Oct 28th - pending billing date"),
                ])

                cursor.executemany("""
                    INSERT INTO client_payments (client_id, month, amount_expected, amount_received, date_received, method, note)
                    VALUES (?, ?, ?, ?, ?, ?, ?);
                """, payments_data)

    # Seed 5 Tools with Budget & Usage (Stage 8 Part 3)
    with conn:
        cursor.execute("SELECT id, name FROM members;")
        m_map = {row["name"]: row["id"] for row in cursor.fetchall()}

        # 5 demo tools: Claude, Convex, Supabase, Vercel, Render
        demo_tools = [
            ("Claude", "Pro Team", 100.0, "credits", 40.0, "2026-10-21", m_map.get("Riya"), "Riya", "AI model subscriptions and prompt prototyping"),
            ("Convex", "Starter Cloud", 50000.0, "tokens", 25.0, "2026-10-18", m_map.get("Rohan"), "Rohan", "Reactive backend data sync & cache tokens"),
            ("Supabase", "Pro Database", 50.0, "USD", 25.0, "2026-10-25", m_map.get("Rohan"), "Rohan", "PostgreSQL database hosting & auth for client portals"),
            ("Vercel", "Pro Hosting", 40.0, "USD", 20.0, "2026-10-08", m_map.get("Riya"), "Riya", "Frontend deployments & client preview domains"),
            ("Render", "Web Services", 25.0, "USD", 15.0, "2026-10-28", m_map.get("Anya"), "Anya", "Backend FastAPI web services & worker hosting"),
        ]

        for name, plan, budget, unit, cost, renewal, owner_id, owner_name, notes in demo_tools:
            cursor.execute("SELECT id FROM tools WHERE name = ?;", (name,))
            existing = cursor.fetchone()
            if existing:
                cursor.execute("""
                    UPDATE tools
                    SET plan_name = ?, budget_amount = ?, unit = ?, monthly_cost = ?, renewal_date = ?, owner_id = ?, owner_name = ?, notes = ?
                    WHERE id = ?;
                """, (plan, budget, unit, cost, renewal, owner_id, owner_name, notes, existing["id"]))
            else:
                cursor.execute("""
                    INSERT INTO tools (name, plan_name, budget_amount, unit, monthly_cost, renewal_date, owner_id, owner_name, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                """, (name, plan, budget, unit, cost, renewal, owner_id, owner_name, notes))

        # Seed tool_usage_log if empty
        cursor.execute("SELECT COUNT(*) FROM tool_usage_log;")
        if cursor.fetchone()[0] == 0:
            cursor.execute("SELECT id, name FROM tools;")
            t_map = {row["name"]: row["id"] for row in cursor.fetchall()}

            usage_entries = []
            if "Claude" in t_map:
                # 85 credits used total across Oct 1-4
                usage_entries.extend([
                    (t_map["Claude"], "2026-10-01", 25.0, "Drafting weekly client content"),
                    (t_map["Claude"], "2026-10-02", 30.0, "WhatsApp intake prompts tuning"),
                    (t_map["Claude"], "2026-10-03", 20.0, "Copywriting review for Zephyr"),
                    (t_map["Claude"], "2026-10-04", 10.0, "Portal bug analysis"),
                ])
            if "Convex" in t_map:
                # 48000 tokens used total (projected run out early)
                usage_entries.extend([
                    (t_map["Convex"], "2026-10-01", 12000.0, "Initial portal data migration"),
                    (t_map["Convex"], "2026-10-02", 15000.0, "Live subscription state sync"),
                    (t_map["Convex"], "2026-10-03", 11000.0, "Realtime updates testing"),
                    (t_map["Convex"], "2026-10-04", 10000.0, "High activity webhook logs"),
                ])
            if "Supabase" in t_map:
                # 20 USD used
                usage_entries.extend([
                    (t_map["Supabase"], "2026-10-01", 10.0, "Base DB compute"),
                    (t_map["Supabase"], "2026-10-03", 10.0, "Storage & auth usage"),
                ])
            if "Vercel" in t_map:
                # 22 USD used
                usage_entries.extend([
                    (t_map["Vercel"], "2026-10-01", 12.0, "Bandwidth & preview deployments"),
                    (t_map["Vercel"], "2026-10-03", 10.0, "Edge functions executions"),
                ])
            if "Render" in t_map:
                # 11 USD used
                usage_entries.extend([
                    (t_map["Render"], "2026-10-01", 6.0, "Web service instance run time"),
                    (t_map["Render"], "2026-10-03", 5.0, "Staging environment compute"),
                ])

            if usage_entries:
                cursor.executemany("""
                    INSERT INTO tool_usage_log (tool_id, date, amount_used, note)
                    VALUES (?, ?, ?, ?);
                """, usage_entries)

