import os
import uvicorn
import datetime
from typing import Optional, List
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from backend.db import init_db, get_db_connection
from backend.ai import parse_whatsapp_message, normalize_request_type, normalize_priority, call_ai

load_dotenv()

PORT = int(os.getenv("PORT", "8000"))
ACCESS_CODE = os.getenv("ACCESS_CODE", "newvora2026").strip()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schema and sample seed data
    init_db()
    yield


app = FastAPI(title="Newvora HQ API", lifespan=lifespan)

# Allow CORS for development convenience
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==============================================================================
# Pydantic Models
# ==============================================================================

class MemberCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    role: str = Field("Team Member", max_length=100)


class ClientCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    company: str = Field(..., min_length=1, max_length=150)
    plan_name: str = Field("Standard Retainer", max_length=100)
    monthly_fee: float = Field(0.0, ge=0.0)
    establishment_fee_total: float = Field(0.0, ge=0.0)
    establishment_fee_paid: float = Field(0.0, ge=0.0)
    billing_day: int = Field(1, ge=1, le=31)
    contract_end_date: Optional[str] = ""
    notes: Optional[str] = ""
    creator_name: Optional[str] = "Team"


class ClientUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    company: str = Field(..., min_length=1, max_length=150)
    plan_name: str = Field("Standard Retainer", max_length=100)
    monthly_fee: float = Field(0.0, ge=0.0)
    establishment_fee_total: float = Field(0.0, ge=0.0)
    establishment_fee_paid: float = Field(0.0, ge=0.0)
    billing_day: int = Field(1, ge=1, le=31)
    contract_end_date: Optional[str] = ""
    notes: Optional[str] = ""
    updater_name: Optional[str] = "Team"


class ToolCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    monthly_cost: float = Field(..., gt=0.0)
    renewal_date: str = Field(..., min_length=10, max_length=10)
    owner_name: Optional[str] = "Team"
    notes: Optional[str] = ""
    creator_name: Optional[str] = "Team"


class MarkPaidRequest(BaseModel):
    client_id: int
    month: str
    fee_type: str = "monthly"  # "monthly" or "establishment"
    amount: Optional[float] = None
    creator_name: Optional[str] = "Team"


class ParseMessageRequest(BaseModel):
    client_id: int
    message: Optional[str] = ""
    image_base64: Optional[str] = ""
    image_mime_type: Optional[str] = "image/png"


class TaskCreate(BaseModel):
    client_id: int
    title: str = Field(..., min_length=1, max_length=250)
    description: Optional[str] = ""
    request_type: str = "content_change"
    priority: str = "medium"
    status: str = "todo"
    assigned_member_id: Optional[int] = None
    clarifying_question: Optional[str] = ""
    creator_name: Optional[str] = "Team"


class TaskStatusUpdate(BaseModel):
    status: str
    updater_name: Optional[str] = "Team"


class TaskAssignUpdate(BaseModel):
    assigned_member_id: Optional[int] = None
    updater_name: Optional[str] = "Team"


class CommentCreate(BaseModel):
    member_name: Optional[str] = "Team"
    comment: str = Field(..., min_length=1)


class IncomeCreate(BaseModel):
    client_id: int
    amount: float = Field(..., gt=0.0)
    month: str = Field(..., min_length=4)
    notes: Optional[str] = ""
    creator_name: Optional[str] = "Team"


class ExpenseCreate(BaseModel):
    tool_name: str = Field(..., min_length=1, max_length=100)
    amount: float = Field(..., gt=0.0)
    month: str = Field(..., min_length=4)
    notes: Optional[str] = ""
    creator_name: Optional[str] = "Team"


class WeeklyUpdateRequest(BaseModel):
    client_id: int


# ==============================================================================
# API ROUTES
# ==============================================================================

@app.get("/api/health")
def health_check():
    return {"status": "ok", "app": "Newvora HQ"}


# ------------------------------------------------------------------------------
# Authentication / Access Code (Stage 7 / Security Gate)
# ------------------------------------------------------------------------------

class AuthVerifyRequest(BaseModel):
    access_code: str


@app.get("/api/auth/status")
def auth_status():
    expected = os.getenv("ACCESS_CODE", "newvora2026").strip()
    return {"required": bool(expected)}


@app.post("/api/auth/verify")
def auth_verify(payload: AuthVerifyRequest):
    expected = os.getenv("ACCESS_CODE", "newvora2026").strip()
    if not expected:
        return {"valid": True, "required": False}
    if payload.access_code.strip() == expected:
        return {"valid": True, "required": True}
    raise HTTPException(status_code=401, detail="Invalid access passcode.")


def verify_access_code(
    x_access_code: Optional[str] = Header(None, alias="X-Access-Code"),
    authorization: Optional[str] = Header(None),
):
    expected = os.getenv("ACCESS_CODE", "newvora2026").strip()
    if not expected:
        return True

    token = (x_access_code or "").strip()
    if not token and authorization:
        if authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        else:
            token = authorization.strip()

    if not token or token != expected:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing access passcode. Please provide a valid X-Access-Code header."
        )
    return True


# ------------------------------------------------------------------------------
# Members
# ------------------------------------------------------------------------------

@app.get("/api/members")
def get_members():
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT id, name, role, created_at FROM members ORDER BY id ASC;").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/members")
def create_member(payload: MemberCreate):
    name = payload.name.strip()
    role = payload.role.strip() or "Team Member"
    if not name:
        raise HTTPException(status_code=400, detail="Member name cannot be empty.")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM members WHERE LOWER(name) = LOWER(?);", (name,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail=f"Member '{name}' already exists.")

        cursor.execute("INSERT INTO members (name, role) VALUES (?, ?);", (name, role))
        member_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (name, "Joined Team", f"Added as team member ({role}).")
        )
        conn.commit()
        return {"id": member_id, "name": name, "role": role}
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Clients (Stage 3)
# ------------------------------------------------------------------------------

@app.get("/api/clients")
def get_clients():
    conn = get_db_connection()
    try:
        query = """
            SELECT c.*, 
                   COUNT(t.id) as task_count,
                   SUM(CASE WHEN t.status != 'done' THEN 1 ELSE 0 END) as active_task_count
            FROM clients c
            LEFT JOIN tasks t ON c.id = t.client_id
            GROUP BY c.id
            ORDER BY c.name ASC;
        """
        rows = conn.execute(query).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/api/clients/{client_id}")
def get_client_detail(client_id: int):
    conn = get_db_connection()
    try:
        client_row = conn.execute("SELECT * FROM clients WHERE id = ?;", (client_id,)).fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found.")

        task_rows = conn.execute("""
            SELECT t.*, m.name AS member_name
            FROM tasks t
            LEFT JOIN members m ON t.assigned_member_id = m.id
            WHERE t.client_id = ?
            ORDER BY t.created_at DESC;
        """, (client_id,)).fetchall()

        return {
            "client": dict(client_row),
            "tasks": [dict(t) for t in task_rows]
        }
    finally:
        conn.close()


@app.post("/api/clients")
def create_client(payload: ClientCreate):
    name = payload.name.strip()
    company = payload.company.strip()
    if not name or not company:
        raise HTTPException(status_code=400, detail="Client name and company are required.")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO clients (name, company, plan_name, monthly_fee, establishment_fee_total, establishment_fee_paid, billing_day, contract_end_date, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            name,
            company,
            payload.plan_name.strip() or "Standard Retainer",
            float(payload.monthly_fee),
            float(payload.establishment_fee_total),
            float(payload.establishment_fee_paid),
            int(payload.billing_day),
            (payload.contract_end_date or "").strip(),
            (payload.notes or "").strip()
        ))
        client_id = cursor.lastrowid

        creator = (payload.creator_name or "Team").strip()
        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (creator, "Added Client", f"Added client '{name}' ({company}) on plan '{payload.plan_name}'.")
        )
        conn.commit()

        created = conn.execute("SELECT * FROM clients WHERE id = ?;", (client_id,)).fetchone()
        return dict(created)
    finally:
        conn.close()


@app.put("/api/clients/{client_id}")
def update_client(client_id: int, payload: ClientUpdate):
    name = payload.name.strip()
    company = payload.company.strip()
    if not name or not company:
        raise HTTPException(status_code=400, detail="Client name and company are required.")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name FROM clients WHERE id = ?;", (client_id,))
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Client not found.")

        cursor.execute("""
            UPDATE clients
            SET name = ?, company = ?, plan_name = ?, monthly_fee = ?,
                establishment_fee_total = ?, establishment_fee_paid = ?, billing_day = ?,
                contract_end_date = ?, notes = ?
            WHERE id = ?;
        """, (
            name,
            company,
            payload.plan_name.strip() or "Standard Retainer",
            float(payload.monthly_fee),
            float(payload.establishment_fee_total),
            float(payload.establishment_fee_paid),
            int(payload.billing_day),
            (payload.contract_end_date or "").strip(),
            (payload.notes or "").strip(),
            client_id
        ))

        updater = (payload.updater_name or "Team").strip()
        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (updater, "Updated Client", f"Updated details for client '{name}'.")
        )
        conn.commit()

        updated = conn.execute("SELECT * FROM clients WHERE id = ?;", (client_id,)).fetchone()
        return dict(updated)
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Tasks & Board (Stage 4)
# ------------------------------------------------------------------------------

@app.get("/api/tasks")
def get_tasks():
    conn = get_db_connection()
    try:
        query = """
            SELECT t.*, c.name AS client_name, c.company AS client_company, m.name AS member_name,
                   (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) as comment_count
            FROM tasks t
            LEFT JOIN clients c ON t.client_id = c.id
            LEFT JOIN members m ON t.assigned_member_id = m.id
            ORDER BY t.created_at DESC;
        """
        rows = conn.execute(query).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/tasks")
def create_task(payload: TaskCreate):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Task title cannot be empty.")

    req_type = normalize_request_type(payload.request_type)
    priority = normalize_priority(payload.priority)
    status = payload.status if payload.status in ("todo", "doing", "done") else "todo"

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM clients WHERE id = ?;", (payload.client_id,))
        client_row = cursor.fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found.")
        client_name = client_row["name"]

        cursor.execute("""
            INSERT INTO tasks (client_id, title, description, request_type, priority, status, assigned_member_id, clarifying_question)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            payload.client_id,
            title,
            (payload.description or "").strip(),
            req_type,
            priority,
            status,
            payload.assigned_member_id,
            (payload.clarifying_question or "").strip()
        ))
        task_id = cursor.lastrowid

        if payload.assigned_member_id:
            cursor.execute("""
                INSERT INTO task_notifications (member_id, task_id, is_read)
                VALUES (?, ?, 0);
            """, (payload.assigned_member_id, task_id))

        creator = (payload.creator_name or "Team").strip()
        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (creator, "Created Task", f"Created '{title}' for {client_name} ({priority} priority).")
        )
        conn.commit()

        created = conn.execute("""
            SELECT t.*, c.name AS client_name, m.name AS member_name
            FROM tasks t
            LEFT JOIN clients c ON t.client_id = c.id
            LEFT JOIN members m ON t.assigned_member_id = m.id
            WHERE t.id = ?;
        """, (task_id,)).fetchone()
        return dict(created)
    finally:
        conn.close()


@app.patch("/api/tasks/{task_id}/status")
def update_task_status(task_id: int, payload: TaskStatusUpdate):
    status = payload.status.lower().strip()
    if status not in ("todo", "doing", "done"):
        raise HTTPException(status_code=400, detail="Invalid status value. Must be 'todo', 'doing', or 'done'.")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.*, c.name as client_name 
            FROM tasks t
            LEFT JOIN clients c ON t.client_id = c.id
            WHERE t.id = ?;
        """, (task_id,))
        task = cursor.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found.")

        old_status = task["status"]
        cursor.execute("""
            UPDATE tasks
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?;
        """, (status, task_id))

        updater = (payload.updater_name or "Team").strip()
        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (updater, "Changed Task Status", f"Moved '{task['title']}' from {old_status} to {status}.")
        )
        conn.commit()

        updated = conn.execute("""
            SELECT t.*, c.name AS client_name, m.name AS member_name
            FROM tasks t
            LEFT JOIN clients c ON t.client_id = c.id
            LEFT JOIN members m ON t.assigned_member_id = m.id
            WHERE t.id = ?;
        """, (task_id,)).fetchone()
        return dict(updated)
    finally:
        conn.close()


@app.patch("/api/tasks/{task_id}/assign")
def assign_task(task_id: int, payload: TaskAssignUpdate):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks WHERE id = ?;", (task_id,))
        task = cursor.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found.")

        member_name = "Unassigned"
        if payload.assigned_member_id:
            cursor.execute("SELECT name FROM members WHERE id = ?;", (payload.assigned_member_id,))
            member = cursor.fetchone()
            if member:
                member_name = member["name"]

        cursor.execute("""
            UPDATE tasks
            SET assigned_member_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?;
        """, (payload.assigned_member_id, task_id))

        if payload.assigned_member_id:
            cursor.execute("""
                INSERT INTO task_notifications (member_id, task_id, is_read)
                VALUES (?, ?, 0);
            """, (payload.assigned_member_id, task_id))

        updater = (payload.updater_name or "Team").strip()
        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (updater, "Assigned Task", f"Assigned '{task['title']}' to {member_name}.")
        )
        conn.commit()

        updated = conn.execute("""
            SELECT t.*, c.name AS client_name, m.name AS member_name
            FROM tasks t
            LEFT JOIN clients c ON t.client_id = c.id
            LEFT JOIN members m ON t.assigned_member_id = m.id
            WHERE t.id = ?;
        """, (task_id,)).fetchone()
        return dict(updated)
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Task Comments (Stage 4)
# ------------------------------------------------------------------------------

@app.get("/api/tasks/{task_id}/comments")
def get_task_comments(task_id: int):
    conn = get_db_connection()
    try:
        rows = conn.execute("""
            SELECT * FROM task_comments
            WHERE task_id = ?
            ORDER BY created_at ASC;
        """, (task_id,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/tasks/{task_id}/comments")
def add_task_comment(task_id: int, payload: CommentCreate):
    comment_text = payload.comment.strip()
    if not comment_text:
        raise HTTPException(status_code=400, detail="Comment text cannot be empty.")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT title FROM tasks WHERE id = ?;", (task_id,))
        task = cursor.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found.")

        author = (payload.member_name or "Team").strip()
        cursor.execute("""
            INSERT INTO task_comments (task_id, member_name, comment)
            VALUES (?, ?, ?);
        """, (task_id, author, comment_text))
        comment_id = cursor.lastrowid

        snippet = comment_text[:40] + ("..." if len(comment_text) > 40 else "")
        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (author, "Added Comment", f"Commented on '{task['title']}': \"{snippet}\"")
        )
        conn.commit()

        created = conn.execute("SELECT * FROM task_comments WHERE id = ?;", (comment_id,)).fetchone()
        return dict(created)
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Money: Income, Expenses, and Financial Summary (Stage 5)
# ------------------------------------------------------------------------------

@app.get("/api/finances")
def get_finances(month: Optional[str] = None):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()

        # Get list of all distinct months across income and expenses
        cursor.execute("""
            SELECT DISTINCT month FROM income
            UNION
            SELECT DISTINCT month FROM expenses
            ORDER BY month DESC;
        """)
        all_months = [r[0] for r in cursor.fetchall() if r[0]]
        if not all_months:
            all_months = ["2026-10"]

        selected_month = (month or "").strip()
        if not selected_month:
            selected_month = all_months[0]

        # Fetch income items
        if selected_month == "all":
            cursor.execute("""
                SELECT i.*, c.name as client_name, c.company as client_company
                FROM income i
                LEFT JOIN clients c ON i.client_id = c.id
                ORDER BY i.month DESC, i.created_at DESC;
            """)
            income_rows = cursor.fetchall()

            cursor.execute("""
                SELECT * FROM expenses
                ORDER BY month DESC, created_at DESC;
            """)
            expense_rows = cursor.fetchall()

            cursor.execute("""
                SELECT tool_name, SUM(amount) as total_amount
                FROM expenses
                GROUP BY tool_name
                ORDER BY total_amount DESC;
            """)
            tool_rows = cursor.fetchall()
        else:
            cursor.execute("""
                SELECT i.*, c.name as client_name, c.company as client_company
                FROM income i
                LEFT JOIN clients c ON i.client_id = c.id
                WHERE i.month = ?
                ORDER BY i.created_at DESC;
            """, (selected_month,))
            income_rows = cursor.fetchall()

            cursor.execute("""
                SELECT * FROM expenses
                WHERE month = ?
                ORDER BY created_at DESC;
            """, (selected_month,))
            expense_rows = cursor.fetchall()

            cursor.execute("""
                SELECT tool_name, SUM(amount) as total_amount
                FROM expenses
                WHERE month = ?
                GROUP BY tool_name
                ORDER BY total_amount DESC;
            """, (selected_month,))
            tool_rows = cursor.fetchall()

        income_items = [dict(r) for r in income_rows]
        expense_items = [dict(r) for r in expense_rows]

        total_income = sum(item["amount"] for item in income_items)
        total_expenses = sum(item["amount"] for item in expense_items)
        net_margin = total_income - total_expenses

        expenses_by_tool = []
        for r in tool_rows:
            amt = float(r["total_amount"])
            pct = round((amt / total_expenses * 100), 1) if total_expenses > 0 else 0.0
            expenses_by_tool.append({
                "tool_name": r["tool_name"],
                "total_amount": amt,
                "percentage": pct
            })

        # Compute Money page summary strip (Stage 7)
        today = datetime.date.today()
        summary_month = selected_month if selected_month != "all" else today.strftime("%Y-%m")
        cursor.execute("SELECT id, name, monthly_fee FROM clients;")
        all_clients = cursor.fetchall()
        cursor.execute("SELECT client_id, SUM(amount) as paid FROM income WHERE month = ? GROUP BY client_id;", (summary_month,))
        paid_map = {r["client_id"]: float(r["paid"]) for r in cursor.fetchall()}

        pending_dues_total = 0.0
        pending_dues_count = 0
        for c in all_clients:
            fee = float(c["monthly_fee"] or 0.0)
            if fee > 0 and paid_map.get(c["id"], 0.0) < fee:
                pending_dues_total += (fee - paid_map.get(c["id"], 0.0))
                pending_dues_count += 1

        cursor.execute("SELECT name, monthly_cost, renewal_date, owner_name FROM tools ORDER BY renewal_date ASC;")
        all_tools = cursor.fetchall()
        renewing_soon_tools = []
        for t in all_tools:
            try:
                ren_date = datetime.date.fromisoformat(t["renewal_date"])
                delta = (ren_date - today).days
                if 0 <= delta <= 7:
                    renewing_soon_tools.append({
                        "name": t["name"],
                        "monthly_cost": float(t["monthly_cost"]),
                        "renewal_date": t["renewal_date"],
                        "days_left": delta,
                        "owner_name": t["owner_name"] or "Team"
                    })
            except Exception:
                pass

        summary_strip = {
            "month": summary_month,
            "pending_dues_total": pending_dues_total,
            "pending_dues_count": pending_dues_count,
            "renewing_tools_count": len(renewing_soon_tools),
            "renewing_tools": renewing_soon_tools
        }

        return {
            "months": all_months,
            "selected_month": selected_month,
            "total_income": total_income,
            "total_expenses": total_expenses,
            "net_margin": net_margin,
            "income_items": income_items,
            "expense_items": expense_items,
            "expenses_by_tool": expenses_by_tool,
            "summary_strip": summary_strip
        }
    finally:
        conn.close()


@app.post("/api/income")
def add_income(payload: IncomeCreate):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM clients WHERE id = ?;", (payload.client_id,))
        client_row = cursor.fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found.")
        client_name = client_row["name"]

        cursor.execute("""
            INSERT INTO income (client_id, amount, month, notes)
            VALUES (?, ?, ?, ?);
        """, (payload.client_id, float(payload.amount), payload.month.strip(), (payload.notes or "").strip()))
        income_id = cursor.lastrowid

        creator = (payload.creator_name or "Team").strip()
        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (creator, "Recorded Income", f"Logged ${payload.amount:.2f} income from {client_name} for {payload.month}.")
        )
        conn.commit()

        created = conn.execute("""
            SELECT i.*, c.name as client_name
            FROM income i
            JOIN clients c ON i.client_id = c.id
            WHERE i.id = ?;
        """, (income_id,)).fetchone()
        return dict(created)
    finally:
        conn.close()


@app.delete("/api/income/{income_id}")
def delete_income(income_id: int):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM income WHERE id = ?;", (income_id,))
        conn.commit()
        return {"deleted": True}
    finally:
        conn.close()


@app.post("/api/expenses")
def add_expense(payload: ExpenseCreate):
    tool = payload.tool_name.strip()
    if not tool:
        raise HTTPException(status_code=400, detail="Tool name cannot be empty.")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO expenses (tool_name, amount, month, notes)
            VALUES (?, ?, ?, ?);
        """, (tool, float(payload.amount), payload.month.strip(), (payload.notes or "").strip()))
        expense_id = cursor.lastrowid

        creator = (payload.creator_name or "Team").strip()
        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (creator, "Recorded Expense", f"Logged ${payload.amount:.2f} tool expense for {tool} ({payload.month}).")
        )
        conn.commit()

        created = conn.execute("SELECT * FROM expenses WHERE id = ?;", (expense_id,)).fetchone()
        return dict(created)
    finally:
        conn.close()


@app.delete("/api/expenses/{expense_id}")
def delete_expense(expense_id: int):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM expenses WHERE id = ?;", (expense_id,))
        conn.commit()
        return {"deleted": True}
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Stage 6: AI Weekly Client Update Generator
# ------------------------------------------------------------------------------

@app.post("/api/ai/weekly-update", dependencies=[Depends(verify_access_code)])
async def generate_weekly_update(payload: WeeklyUpdateRequest):
    conn = get_db_connection()
    try:
        client_row = conn.execute("SELECT * FROM clients WHERE id = ?;", (payload.client_id,)).fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found.")
        client_name = client_row["name"]

        # Fetch completed tasks
        done_tasks = conn.execute("""
            SELECT title, description, request_type FROM tasks
            WHERE client_id = ? AND status = 'done'
            ORDER BY updated_at DESC LIMIT 10;
        """, (payload.client_id,)).fetchall()

        tasks_list = [dict(t) for t in done_tasks]
    finally:
        conn.close()

    tasks_summary_lines = []
    for t in tasks_list:
        tasks_summary_lines.append(f"- [{t['request_type']}] {t['title']}: {t.get('description', '')}")

    if not tasks_summary_lines:
        tasks_text = "General website upkeep, security monitoring, and regular maintenance."
    else:
        tasks_text = "\n".join(tasks_summary_lines)

    system_prompt = (
        "You are an assistant for Newvora, a small student-run agency building client websites.\n"
        "Draft a short, warm, and professional weekly WhatsApp update message for our client.\n"
        "Rules:\n"
        "1. Write in a friendly, courteous tone.\n"
        "2. Concisely summarize what was completed this week.\n"
        "3. Keep it under 80 words so it is easy to read on a mobile phone.\n"
        "4. Do not include markdown code blocks or placeholders. Output ready-to-send text only."
    )
    prompt = f"Client Name: {client_name}\nCompleted Deliverables This Week:\n{tasks_text}"

    try:
        draft = await call_ai(prompt=prompt, system_prompt=system_prompt)
        return {
            "client_id": payload.client_id,
            "client_name": client_name,
            "completed_tasks_count": len(tasks_list),
            "message": draft.strip()
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------------------------
# AI Message Intake (Stage 2)
# ------------------------------------------------------------------------------

@app.post("/api/ai/parse-message", dependencies=[Depends(verify_access_code)])
async def parse_message(payload: ParseMessageRequest):
    message = (payload.message or "").strip()
    image_base64 = (payload.image_base64 or "").strip()
    image_mime_type = (payload.image_mime_type or "image/png").strip()

    if not message and not image_base64:
        raise HTTPException(
            status_code=400,
            detail="Please enter a WhatsApp message or paste/attach a chat screenshot."
        )

    conn = get_db_connection()
    client_name = ""
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name FROM clients WHERE id = ?;", (payload.client_id,))
        client_row = cursor.fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Selected client does not exist.")
        client_name = client_row["name"]
    finally:
        conn.close()

    try:
        tasks = await parse_whatsapp_message(
            message=message,
            client_name=client_name,
            image_base64=image_base64,
            image_mime_type=image_mime_type
        )
        return {
            "client_id": payload.client_id,
            "client_name": client_name,
            "tasks": tasks
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------------------------
# Activity Log (Stage 4)
# ------------------------------------------------------------------------------

@app.get("/api/activity")
def get_activity():
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 60;").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Stage 7: Dues, Tools, & Notifications
# ------------------------------------------------------------------------------

@app.get("/api/dues")
def get_dues(month: Optional[str] = None):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        today = datetime.date.today()
        current_month_str = today.strftime("%Y-%m")
        target_month = (month or "").strip() or current_month_str

        try:
            parts = target_month.split("-")
            year = int(parts[0])
            month_num = int(parts[1])
        except Exception:
            year = today.year
            month_num = today.month
            target_month = f"{year:04d}-{month_num:02d}"

        # Fetch clients
        cursor.execute("SELECT * FROM clients ORDER BY name ASC;")
        clients = [dict(c) for c in cursor.fetchall()]

        # Fetch income for target_month
        cursor.execute("SELECT * FROM income WHERE month = ?;", (target_month,))
        income_rows = [dict(r) for r in cursor.fetchall()]

        client_paid_map = {}
        for inc in income_rows:
            cid = inc["client_id"]
            client_paid_map[cid] = client_paid_map.get(cid, 0.0) + float(inc["amount"])

        total_pending = 0.0
        items = []

        max_days = 28 if month_num == 2 else (30 if month_num in (4, 6, 9, 11) else 31)

        for client in clients:
            cid = client["id"]
            monthly_fee = float(client["monthly_fee"] or 0.0)
            est_total = float(client["establishment_fee_total"] or 0.0)
            est_paid = float(client["establishment_fee_paid"] or 0.0)
            est_remaining = max(0.0, est_total - est_paid)
            b_day = int(client["billing_day"] or 1)

            safe_day = min(b_day, max_days)
            due_date = datetime.date(year, month_num, safe_day)

            paid_amt = client_paid_map.get(cid, 0.0)
            is_paid = paid_amt >= monthly_fee if monthly_fee > 0 else True

            if is_paid:
                status = "paid"
            elif today > due_date:
                status = "overdue"
                total_pending += monthly_fee
            else:
                status = "pending"
                total_pending += monthly_fee

            items.append({
                "client_id": cid,
                "name": client["name"],
                "company": client["company"],
                "plan_name": client["plan_name"],
                "monthly_fee": monthly_fee,
                "billing_day": b_day,
                "due_date": due_date.isoformat(),
                "status": status,
                "paid_amount": paid_amt,
                "establishment_fee_total": est_total,
                "establishment_fee_paid": est_paid,
                "establishment_fee_remaining": est_remaining
            })

        return {
            "month": target_month,
            "total_pending": total_pending,
            "clients": items
        }
    finally:
        conn.close()


@app.post("/api/dues/mark-paid")
def mark_due_paid(payload: MarkPaidRequest):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM clients WHERE id = ?;", (payload.client_id,))
        client = cursor.fetchone()
        if not client:
            raise HTTPException(status_code=404, detail="Client not found.")

        creator = (payload.creator_name or "Team").strip()
        fee_type = payload.fee_type.lower().strip()

        if fee_type == "establishment":
            est_total = float(client["establishment_fee_total"] or 0.0)
            est_paid = float(client["establishment_fee_paid"] or 0.0)
            est_remaining = max(0.0, est_total - est_paid)
            amount = float(payload.amount if payload.amount is not None else est_remaining)
            if amount <= 0:
                raise HTTPException(status_code=400, detail="Establishment fee balance is already settled.")

            new_paid = min(est_total, est_paid + amount)
            cursor.execute("UPDATE clients SET establishment_fee_paid = ? WHERE id = ?;", (new_paid, payload.client_id))
            cursor.execute("""
                INSERT INTO income (client_id, amount, month, notes)
                VALUES (?, ?, ?, ?);
            """, (payload.client_id, amount, payload.month, f"Establishment fee installment for {client['name']}"))
            cursor.execute(
                "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
                (creator, "Recorded Establishment Payment", f"Recorded establishment fee payment of ${amount:.0f} for '{client['name']}'.")
            )
        else:
            amount = float(payload.amount if payload.amount is not None else client["monthly_fee"])
            cursor.execute("""
                INSERT INTO income (client_id, amount, month, notes)
                VALUES (?, ?, ?, ?);
            """, (payload.client_id, amount, payload.month, f"Monthly retainer fee for {client['name']} ({payload.month})"))
            cursor.execute(
                "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
                (creator, "Marked Dues Paid", f"Marked monthly retainer of ${amount:.0f} for '{client['name']}' as paid for {payload.month}.")
            )

        conn.commit()
        return {"success": True, "client_id": payload.client_id, "amount": amount, "month": payload.month}
    finally:
        conn.close()


@app.get("/api/tools")
def get_tools():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tools ORDER BY renewal_date ASC;")
        rows = cursor.fetchall()
        today = datetime.date.today()
        tools = []
        for r in rows:
            item = dict(r)
            try:
                renewal = datetime.date.fromisoformat(item["renewal_date"])
                delta = (renewal - today).days
            except Exception:
                delta = 999

            if delta < 0:
                status_str = f"Overdue by {abs(delta)} days"
            elif delta == 0:
                status_str = "Renews today"
            elif delta == 1:
                status_str = "Renews tomorrow"
            else:
                status_str = f"Renews in {delta} days"

            item["days_until_renewal"] = delta
            item["is_warning"] = (0 <= delta <= 7) or (delta < 0)
            item["renewal_status"] = status_str
            tools.append(item)
        return tools
    finally:
        conn.close()


@app.post("/api/tools")
def create_tool(payload: ToolCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tool name cannot be empty.")
    cost = float(payload.monthly_cost)
    if cost <= 0:
        raise HTTPException(status_code=400, detail="Monthly cost must be greater than 0.")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO tools (name, monthly_cost, renewal_date, owner_name, notes)
            VALUES (?, ?, ?, ?, ?);
        """, (name, cost, payload.renewal_date.strip(), (payload.owner_name or "Team").strip(), (payload.notes or "").strip()))
        tool_id = cursor.lastrowid
        creator = (payload.creator_name or "Team").strip()
        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (creator, "Added Tool", f"Added software tool '{name}' (${cost:.0f}/mo).")
        )
        conn.commit()
        created = conn.execute("SELECT * FROM tools WHERE id = ?;", (tool_id,)).fetchone()
        return dict(created)
    finally:
        conn.close()


@app.post("/api/tools/{tool_id}/record-payment")
def record_tool_payment(tool_id: int, payload: dict = None):
    payload = payload or {}
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tools WHERE id = ?;", (tool_id,))
        tool = cursor.fetchone()
        if not tool:
            raise HTTPException(status_code=404, detail="Tool not found.")

        today = datetime.date.today()
        current_month = today.strftime("%Y-%m")
        creator = (payload.get("creator_name") or "Team").strip()
        cost = float(tool["monthly_cost"])

        cursor.execute("""
            INSERT INTO expenses (tool_name, amount, month, notes)
            VALUES (?, ?, ?, ?);
        """, (tool["name"], cost, current_month, f"Monthly subscription for {tool['name']}"))

        try:
            curr_ren = datetime.date.fromisoformat(tool["renewal_date"])
            month = curr_ren.month + 1
            year = curr_ren.year
            if month > 12:
                month = 1
                year += 1
            day = min(curr_ren.day, 28)
            next_ren = datetime.date(year, month, day).isoformat()
            cursor.execute("UPDATE tools SET renewal_date = ? WHERE id = ?;", (next_ren, tool_id))
        except Exception:
            pass

        cursor.execute(
            "INSERT INTO activity_log (member_name, action, details) VALUES (?, ?, ?);",
            (creator, "Tool Payment", f"Recorded payment of ${cost:.0f} for tool '{tool['name']}'.")
        )
        conn.commit()
        return {"success": True, "tool_name": tool["name"], "amount": cost, "month": current_month}
    finally:
        conn.close()


@app.get("/api/notifications")
def get_notifications(member_id: int):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM task_notifications WHERE member_id = ? AND is_read = 0;",
            (member_id,)
        )
        unread_count = cursor.fetchone()[0]

        cursor.execute("""
            SELECT tn.id as notification_id, tn.is_read, tn.created_at as notified_at,
                   t.*, c.name as client_name, c.company as client_company
            FROM task_notifications tn
            JOIN tasks t ON tn.task_id = t.id
            JOIN clients c ON t.client_id = c.id
            WHERE tn.member_id = ?
            ORDER BY tn.is_read ASC, tn.created_at DESC;
        """, (member_id,))
        rows = cursor.fetchall()
        return {
            "member_id": member_id,
            "unread_count": unread_count,
            "notifications": [dict(r) for r in rows]
        }
    finally:
        conn.close()


@app.patch("/api/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE task_notifications SET is_read = 1 WHERE id = ?;", (notification_id,))
        conn.commit()
        return {"success": True, "notification_id": notification_id}
    finally:
        conn.close()


# Mount frontend static files last
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


if __name__ == "__main__":
    reload_flag = os.getenv("RELOAD", "true").lower() in ("true", "1", "yes")
    uvicorn.run("backend.main:app", host="0.0.0.0", port=PORT, reload=reload_flag)
