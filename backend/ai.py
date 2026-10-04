import os
import re
import json
import logging
import httpx
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("newvora.ai")

# ==============================================================================
# AI CONFIGURATION
# Default provider: Google Gemini API using open-weight Gemma model
# To switch to local Ollama, set AI_PROVIDER="ollama" in .env
# ==============================================================================
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").lower()
AI_MODEL = os.getenv("AI_MODEL", "gemma-2-9b-it")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
OLLAMA_API_URL = os.getenv("OLLAMA_API_URL", "http://localhost:11434")

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

ALLOWED_REQUEST_TYPES = {"bug", "new_feature", "data_update", "content_change", "question"}
ALLOWED_PRIORITIES = {"low", "medium", "high"}


def normalize_request_type(val: str) -> str:
    """Normalize request type into one of the allowed categories."""
    v = (val or "").strip().lower().replace("-", "_").replace(" ", "_")
    if v in ALLOWED_REQUEST_TYPES:
        return v
    if "bug" in v or "issue" in v or "fix" in v or "error" in v or "crash" in v:
        return "bug"
    if "feature" in v or "add" in v or "new" in v:
        return "new_feature"
    if "data" in v or "price" in v or "time" in v or "timing" in v:
        return "data_update"
    if "content" in v or "text" in v or "photo" in v or "banner" in v or "copy" in v:
        return "content_change"
    if "question" in v or "query" in v or "ask" in v or "doubt" in v:
        return "question"
    return "content_change"


def normalize_priority(val: str) -> str:
    """Normalize priority into low, medium, or high."""
    v = (val or "").strip().lower()
    if v in ALLOWED_PRIORITIES:
        return v
    if "high" in v or "urg" in v or "asap" in v or "crit" in v:
        return "high"
    if "low" in v:
        return "low"
    return "medium"


def extract_json_from_text(text: str) -> Optional[Dict[str, Any]]:
    """
    Safely extract and parse JSON from model output, handling:
    - Markdown code fences (```json ... ```)
    - Preceding or trailing commentary/reasoning
    - Balanced curly brace blocks
    - Filters out prompt templates (e.g. "..." or "bug|new_feature")
    """
    if not text:
        return None

    cleaned = text.strip()

    def is_valid_task_dict(d: Any) -> bool:
        if not isinstance(d, dict):
            return False
        tasks = d.get("tasks")
        if not isinstance(tasks, list) or len(tasks) == 0:
            return False
        first = tasks[0]
        if not isinstance(first, dict):
            return False
        title = str(first.get("task_title", "")).strip()
        req_type = str(first.get("request_type", "")).strip()
        if not title or title in ("...", "task_title", ""):
            return False
        if "|" in req_type:
            return False
        return True

    # 1. Direct parse attempt
    try:
        data = json.loads(cleaned)
        if is_valid_task_dict(data):
            return data
    except Exception:
        pass

    # 2. Markdown code fences (```json ... ```)
    fences = re.findall(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned, re.IGNORECASE)
    for fence in fences:
        try:
            data = json.loads(fence.strip())
            if is_valid_task_dict(data):
                return data
        except Exception:
            pass

    # 3. Find every balanced { ... } block in the text
    start_indices = [m.start() for m in re.finditer(r'\{', cleaned)]
    for start in reversed(start_indices):
        brace_count = 0
        in_string = False
        escape = False
        for i in range(start, len(cleaned)):
            ch = cleaned[i]
            if escape:
                escape = False
                continue
            if ch == '\\':
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if not in_string:
                if ch == '{':
                    brace_count += 1
                elif ch == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        candidate = cleaned[start : i + 1]
                        if '"tasks"' in candidate:
                            try:
                                d = json.loads(candidate)
                                if is_valid_task_dict(d):
                                    return d
                            except Exception:
                                pass
                        break

    return None


def validate_and_clean_tasks(raw_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Validate and sanitize parsed task list against required schema.
    """
    tasks_raw = raw_dict.get("tasks")
    if not isinstance(tasks_raw, list) or len(tasks_raw) == 0:
        raise ValueError("Response does not contain a non-empty 'tasks' array.")

    cleaned_tasks = []
    for item in tasks_raw:
        if not isinstance(item, dict):
            continue

        raw_type = str(item.get("request_type", "content_change"))
        raw_prio = str(item.get("priority", "medium"))
        raw_title = str(item.get("task_title", "")).strip()
        raw_desc = str(item.get("task_description", "")).strip()
        raw_clarify = str(item.get("clarifying_question", "")).strip()

        if not raw_title:
            raw_title = (raw_desc[:60] + "...") if raw_desc else "Client Request"

        req_type = normalize_request_type(raw_type)
        priority = normalize_priority(raw_prio)

        cleaned_tasks.append({
            "request_type": req_type,
            "priority": priority,
            "task_title": raw_title,
            "task_description": raw_desc,
            "clarifying_question": raw_clarify
        })

    if not cleaned_tasks:
        raise ValueError("Could not extract any valid task items from the response.")

    return cleaned_tasks


def clean_base64_data(data_uri_or_b64: str) -> str:
    """Extract raw base64 string from data URI if prefix exists."""
    if not data_uri_or_b64:
        return ""
    if ";base64," in data_uri_or_b64:
        return data_uri_or_b64.split(";base64,")[1].strip()
    return data_uri_or_b64.strip()


async def call_ai(
    prompt: str,
    system_prompt: str = "",
    image_base64: str = "",
    image_mime_type: str = "image/png"
) -> str:
    """
    Unified AI completion function for all features across Newvora HQ.
    Routes to either Google Gemini API (Gemma model) or local Ollama.
    Supports multimodal chat screenshot analysis via image_base64.
    """
    clean_b64 = clean_base64_data(image_base64)

    if AI_PROVIDER == "ollama":
        combined_prompt = f"{system_prompt}\n\n{prompt}".strip() if system_prompt else prompt
        payload = {
            "model": AI_MODEL,
            "prompt": combined_prompt,
            "stream": False,
            "options": {
                "temperature": 0.0
            }
        }
        if clean_b64:
            payload["images"] = [clean_b64]

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{OLLAMA_API_URL}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("response", "")

    # Default: Google Gemini API (Gemma model)
    api_key = os.getenv("GOOGLE_API_KEY", GOOGLE_API_KEY)
    if not api_key:
        raise ValueError("GOOGLE_API_KEY is not set. Please add it to your .env file.")

    url = f"{GEMINI_BASE_URL}/{AI_MODEL}:generateContent?key={api_key}"
    
    user_text = f"{system_prompt}\n\n{prompt}".strip() if system_prompt else prompt
    parts = []

    # If image attached, add inline_data part first
    if clean_b64:
        mime = image_mime_type or "image/png"
        parts.append({
            "inline_data": {
                "mime_type": mime,
                "data": clean_b64
            }
        })

    parts.append({"text": user_text})

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": parts
            }
        ],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 4096,
        }
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload)
        if resp.status_code != 200:
            err_msg = resp.text
            try:
                err_json = resp.json()
                err_msg = err_json.get("error", {}).get("message", resp.text)
            except Exception:
                pass
            raise RuntimeError(f"Gemma API error ({resp.status_code}): {err_msg}")

        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise RuntimeError("Gemma returned an empty response.")
        
        parts_resp = candidates[0].get("content", {}).get("parts", [])
        if not parts_resp:
            raise RuntimeError("Gemma returned no content parts.")

        # Filter out parts marked as thought (chain-of-thought)
        text_parts = [p.get("text", "") for p in parts_resp if not p.get("thought")]
        if text_parts:
            return "\n".join(text_parts).strip()
            
        # Fallback to all parts if no non-thought part is flagged
        return "\n".join([p.get("text", "") for p in parts_resp]).strip()


async def parse_whatsapp_message(
    message: str = "",
    client_name: str = "",
    image_base64: str = "",
    image_mime_type: str = "image/png"
) -> List[Dict[str, Any]]:
    """
    Parses a client WhatsApp message and/or chat screenshot (including Hinglish)
    into structured tasks using Gemma with up to 2 retries on parsing failure.
    """
    has_image = bool(clean_base64_data(image_base64))

    system_prompt = (
        "You are an AI assistant for Newvora, a student-run agency building client websites.\n"
        f"Your task is to analyze client communications for client '{client_name}' and output ONLY valid JSON.\n\n"
        "MANDATORY INSTRUCTIONS:\n"
        "1. DO NOT write reasoning, thinking, analysis, notes, or explanations.\n"
        "2. Start your response IMMEDIATELY with the character '{'. No code fences, no backticks.\n"
        "3. JSON FORMAT:\n"
        '   {"tasks":[{"request_type":"bug|new_feature|data_update|content_change|question","priority":"low|medium|high","task_title":"Title in clear English","task_description":"Description in clear English","clarifying_question":""}]}\n'
        "4. One WhatsApp message or conversation screenshot can contain several requests. Return ONE task per distinct request.\n"
        "5. Messages may be in Hinglish (Hindi in English letters) or informal English. Always output task_title and task_description in clear, professional English.\n"
        "6. Priority: ONLY use 'high' if the client explicitly says urgent, asap, emergency, or gives a tight deadline. Otherwise use 'medium' or 'low'.\n"
        "7. Clarifying question: If a request is vague, set clarifying_question to a polite, specific question for the client. If clear, set it to empty string \"\".\n"
        "8. Never invent requests not mentioned or visible in the communication.\n"
        "9. Allowed request_type values: 'bug', 'new_feature', 'data_update', 'content_change', 'question'.\n"
        "10. Allowed priority values: 'low', 'medium', 'high'."
    )

    if has_image:
        system_prompt += (
            "\n\nIMAGE INSTRUCTIONS:\n"
            "An image of a WhatsApp chat screenshot is attached. Read and transcribe all messages sent by the client visible in the image. "
            "Extract all deliverables, bugs, data updates, content changes, and questions requested by the client in the conversation."
        )

    prompt_lines = [f"Client: {client_name}"]
    if message.strip():
        prompt_lines.append(f"Accompanying Message / Context:\n\"\"\"{message.strip()}\"\"\"")
    if has_image:
        prompt_lines.append("Attached: WhatsApp Chat Screenshot Image")

    current_prompt = "\n\n".join(prompt_lines)
    max_retries = 2
    last_error = ""

    for attempt in range(max_retries + 1):
        try:
            raw_response = await call_ai(
                prompt=current_prompt,
                system_prompt=system_prompt,
                image_base64=image_base64,
                image_mime_type=image_mime_type
            )
            parsed_json = extract_json_from_text(raw_response)
            if not parsed_json:
                raise ValueError("Output could not be parsed as valid JSON.")
            
            tasks = validate_and_clean_tasks(parsed_json)
            return tasks

        except Exception as e:
            last_error = str(e)
            logger.warning(f"Gemma parsing attempt {attempt + 1} failed: {last_error}")
            if attempt < max_retries:
                current_prompt = (
                    f"CRITICAL REMINDER: Your previous output failed JSON validation ({last_error}).\n"
                    "You must output ONLY raw valid JSON starting with '{'. No thinking, no markdown fences.\n"
                    'Format: {"tasks":[{"request_type":"bug|new_feature|data_update|content_change|question","priority":"low|medium|high","task_title":"...","task_description":"...","clarifying_question":"..."}]}\n\n'
                    + "\n\n".join(prompt_lines)
                )

    raise RuntimeError(
        f"Gemma was unable to format this conversation into structured tasks. Please check the text or image. (Details: {last_error})"
    )


# ==============================================================================
# Stage 8 Part 5: Receipt Reader AI Extraction
# ==============================================================================

def extract_receipt_json(text: str) -> Optional[Dict[str, Any]]:
    """
    Safely extract JSON for tool receipt parsing from model output.
    """
    if not text:
        return None
    cleaned = text.strip()

    def is_valid_receipt_dict(d: Any) -> bool:
        return isinstance(d, dict) and ("tool_name" in d or "amount" in d)

    # 1. Direct parse
    try:
        data = json.loads(cleaned)
        if is_valid_receipt_dict(data):
            return data
    except Exception:
        pass

    # 2. Markdown code fences
    fences = re.findall(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned, re.IGNORECASE)
    for fence in fences:
        try:
            data = json.loads(fence.strip())
            if is_valid_receipt_dict(data):
                return data
        except Exception:
            continue

    # 3. Curly brace block
    brace_match = re.search(r"(\{[\s\S]*\})", cleaned)
    if brace_match:
        try:
            data = json.loads(brace_match.group(1).strip())
            if is_valid_receipt_dict(data):
                return data
        except Exception:
            pass

    return None


def validate_and_clean_receipt(data: Dict[str, Any]) -> Dict[str, Any]:
    tool_name = str(data.get("tool_name") or "").strip()
    plan_name = str(data.get("plan_name") or "").strip()

    raw_amt = data.get("amount")
    try:
        amount = float(raw_amt) if raw_amt is not None else 0.0
    except (ValueError, TypeError):
        num_match = re.search(r"[\d]+(?:\.[\d]+)?", str(raw_amt or ""))
        amount = float(num_match.group(0)) if num_match else 0.0

    currency = str(data.get("currency") or "").strip()
    billing_period = str(data.get("billing_period") or "unknown").strip().lower()
    if billing_period not in ("monthly", "yearly", "unknown"):
        billing_period = "unknown"

    renewal_date = str(data.get("renewal_date") or "").strip()
    if renewal_date and not re.match(r"^\d{4}-\d{2}-\d{2}$", renewal_date):
        renewal_date = ""

    notes = str(data.get("notes") or "").strip()

    return {
        "tool_name": tool_name,
        "plan_name": plan_name,
        "amount": amount,
        "currency": currency,
        "billing_period": billing_period,
        "renewal_date": renewal_date,
        "notes": notes
    }


async def parse_tool_receipt(receipt_text: str) -> Dict[str, Any]:
    """
    Parses a subscription email, invoice, or receipt text into tool details using Gemma.
    Retries up to 2 times on parsing failure.
    """
    clean_text = receipt_text.strip()
    if not clean_text:
        raise ValueError("Receipt text cannot be empty.")

    system_prompt = (
        "You are an AI assistant for Newvora HQ.\n"
        "Your task is to extract software subscription details from an email receipt, invoice, or billing text.\n"
        "Output ONLY valid JSON.\n\n"
        "MANDATORY INSTRUCTIONS:\n"
        "1. DO NOT write reasoning, thinking, analysis, notes, or explanations.\n"
        "2. Start your response IMMEDIATELY with the character '{'. No code fences, no markdown backticks.\n"
        "3. JSON FORMAT:\n"
        '   {"tool_name":"","plan_name":"","amount":0,"currency":"","billing_period":"monthly|yearly|unknown","renewal_date":"YYYY-MM-DD or empty","notes":""}\n'
        "4. Never invent values that are not in the text; leave fields empty (or 0 for amount) instead.\n"
        "5. renewal_date must be in YYYY-MM-DD format if mentioned, or empty string \"\" if not mentioned.\n"
        "6. billing_period must be one of: 'monthly', 'yearly', or 'unknown'."
    )

    prompt = f"Extract tool subscription details from this invoice/receipt text:\n\"\"\"\n{clean_text}\n\"\"\""
    current_prompt = prompt
    max_retries = 2
    last_error = ""

    for attempt in range(max_retries + 1):
        try:
            raw_response = await call_ai(prompt=current_prompt, system_prompt=system_prompt)
            parsed_json = extract_receipt_json(raw_response)
            if not parsed_json:
                raise ValueError("Output could not be parsed as valid JSON.")
            cleaned = validate_and_clean_receipt(parsed_json)
            return cleaned
        except Exception as e:
            last_error = str(e)
            logger.warning(f"Gemma receipt parsing attempt {attempt + 1} failed: {last_error}")
            if attempt < max_retries:
                current_prompt = (
                    f"CRITICAL REMINDER: Your previous output failed JSON validation ({last_error}).\n"
                    "Output ONLY raw valid JSON starting with '{'.\n"
                    'Format: {"tool_name":"","plan_name":"","amount":0,"currency":"","billing_period":"monthly|yearly|unknown","renewal_date":"YYYY-MM-DD or empty","notes":""}\n\n'
                    + prompt
                )

    raise RuntimeError(
        f"Gemma was unable to parse the receipt into tool details. Please verify the receipt text. (Details: {last_error})"
    )


# ==============================================================================
# Stage 8 Part 6: Monthly Report AI Summary
# ==============================================================================

async def generate_monthly_report_summary(metrics: Dict[str, Any]) -> str:
    """
    Generates a concise (<150 words) plain-language executive summary of monthly metrics using Gemma.
    """
    system_prompt = (
        "You are an executive assistant for Newvora, a student-run agency building client websites.\n"
        "You are provided ONLY with aggregated monthly performance numbers.\n"
        "Write a concise, plain-language executive summary for the team under 150 words.\n"
        "Highlight tasks completed, client payment collection status, and tool spending/budget health.\n"
        "Do NOT use markdown headers or bullet points; write 2 short, readable paragraphs."
    )
    prompt = f"Monthly Aggregated Numbers:\n{json.dumps(metrics, indent=2)}"
    try:
        summary = await call_ai(prompt=prompt, system_prompt=system_prompt)
        clean_summary = re.sub(r"<thought>[\s\S]*?</thought>", "", summary, flags=re.IGNORECASE).strip()
        clean_summary = clean_summary.replace("```json", "").replace("```", "").strip()
        return clean_summary
    except Exception as e:
        logger.warning(f"Gemma report summary generation failed: {e}")
        raise RuntimeError(f"Could not generate AI summary: {str(e)}")

