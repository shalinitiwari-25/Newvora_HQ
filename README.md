# Newvora HQ

Internal operations workspace for Newvora, a student-run agency building client websites and portals. Tracks client requests from WhatsApp, tasks, team activities, and agency finances.

Built with **FastAPI** (Python), **SQLite**, and **vanilla HTML/CSS/JavaScript** (no frontend build step, no frameworks, no CDNs). All AI features are powered by Google's open-weight **Gemma** model via the Gemini API (or local Ollama).

---

## Quickstart

### 1. Prerequisites
- Python 3.10+
- (Optional for Stage 2) Google Gemini API Key with access to Gemma models.

### 2. Setup
Create a virtual environment and install dependencies:

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Environment Variables
Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Configuration options in `.env`:
- `GOOGLE_API_KEY`: Google AI Studio API key for Gemma.
- `AI_PROVIDER`: `gemini`.
- `AI_MODEL`: `gemma-2-9b-it` (default).
- `PORT`: Server port (default `8000`).
- `DB_PATH`: SQLite database file path (default `newvora.db`).

### 4. Run the Server

```bash
python -m backend.main
```
Or with uvicorn:
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Open your browser at:
```
http://localhost:8000
```

---

## Project Structure

```
Newvora_HQ/
├── backend/
│   ├── __init__.py
│   ├── db.py          # SQLite schema, migrations, and seed data
│   ├── ai.py          # Unified AI completion function (Gemma / Ollama)
│   └── main.py        # FastAPI app, static file serving, REST endpoints
├── frontend/
│   ├── index.html     # HTML structure with sidebar and views
│   ├── style.css      # Calm, quiet styling (1px borders, warm off-white)
│   └── app.js         # Navigation, member switcher, and XSS sanitization
├── .env.example       # Example configuration
├── .gitignore         # Ignores .env, SQLite DB, and venv
├── requirements.txt   # Backend dependencies
└── README.md          # Project documentation
```

---

## Testing Stage 1

1. Start the server: `python -m backend.main`
2. Open `http://localhost:8000` in your web browser.
3. Test the **"Who are you?"** dropdown:
   - Notice the seeded members: *Riya*, *Rohan*, *Anya*.
   - Select a member; refresh the browser and notice your choice is remembered.
   - Click **"+ Add member"**, enter a new name (e.g., "Kavya") and role, click Save. Observe that the new member is immediately added to the database, selected, and persisted.
4. Click through the sidebar links: **Inbox**, **Board**, **Clients**, **Money**, **Activity**.
   - Notice the active tab indicator and corresponding view display.
5. On mobile or narrow browser widths, test the responsive **Menu** button.
