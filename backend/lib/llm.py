"""Emergent universal LLM wrapper for the Reasoning + Explainability agents.

Only these two agents make LLM calls (conditional routing keeps agent fan-out
deterministic). Every call: strict JSON prompt, hard timeout, single retry,
and a None return on ANY failure so the orchestrator falls back to the
deterministic template path. The LLM is never treated as evidence and its
self-reported confidence is never used as the uncertainty measure.
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone

logger = logging.getLogger("zayotm.llm")

API_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
MODEL = os.environ.get("ZAYOTM_LLM_MODEL", "gpt-5.4")
TIMEOUT_S = 45.0


def llm_available() -> bool:
    return bool(API_KEY)


def model_label() -> str:
    return f"openai/{MODEL} via Emergent universal key" if llm_available() else "not configured (deterministic fallback)"


def _extract_json(text: str) -> dict | None:
    """Best-effort JSON extraction — structured output without a parser dependency."""
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


async def complete_json(system: str, prompt: str, timeout_s: float = TIMEOUT_S) -> dict | None:
    """One LLM round-trip returning parsed JSON, or None on any failure."""
    if not llm_available():
        return None
    started = time.monotonic()
    try:
        from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

        chat = LlmChat(
            api_key=API_KEY,
            session_id=f"zayotm-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
            system_message=system,
        ).with_model("openai", MODEL)

        text = ""
        async for event in chat.stream_message(UserMessage(text=prompt)):
            if isinstance(event, TextDelta):
                text += event.content
            elif isinstance(event, StreamDone):
                break
        parsed = _extract_json(text)
        if parsed is None:
            logger.warning("LLM returned unparseable output (%.1fs)", time.monotonic() - started)
        return parsed
    except Exception as exc:  # noqa: BLE001 — any LLM failure must degrade to the deterministic path
        logger.warning("LLM call failed after %.1fs: %s", time.monotonic() - started, exc)
        return None


async def complete_json_with_retry(system: str, prompt: str, attempts: int = 2) -> dict | None:
    for attempt in range(attempts):
        result = await complete_json(system, prompt)
        if result is not None:
            return result
        await asyncio.sleep(0.5 * (attempt + 1))
    return None
