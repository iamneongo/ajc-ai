from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException

from services.content_filter import request_text
from services.protocol import openai_v1_image_edit, openai_v1_image_generations
from services.protocol.conversation import save_image_bytes
from services.protocol.conversation import ConversationRequest, collect_text, normalize_messages, text_backend
from utils.helper import extract_image_from_message_content

VALID_WORKSPACE_MODES = {"auto", "text", "image_generate", "image_edit"}

INTENT_CLASSIFIER_SYSTEM_PROMPT = """You are an intent classifier for a ChatGPT-style workspace.
Decide whether the user's latest turn should:
- reply with normal text: text
- generate a brand-new image: image_generate
- edit or transform an existing image: image_edit

Return JSON only with this exact schema:
{"mode":"text|image_generate|image_edit","reason":"short reason"}

Rules:
- Choose text for normal conversation, explanation, coding, summarization, or describing/analyzing an attached image.
- Choose image_generate only when the user is explicitly asking you to create/draw/render/design an image.
- Choose image_edit when the user wants to modify, transform, extend, restyle, remove background from, or otherwise edit an existing image.
- If there are attached or prior conversation images but the user is just asking about their content, still choose text.
- Be conservative. When unclear, choose text."""

IMAGE_GENERATE_PATTERNS = [
    r"\btạo ảnh\b",
    r"\btao anh\b",
    r"\bvẽ\b",
    r"\bve\b",
    r"\bdraw\b",
    r"\bgenerate (an |a )?image\b",
    r"\bcreate (an |a )?image\b",
    r"\brender\b",
    r"\bminh họa\b",
    r"\bminh hoa\b",
    r"\billustration\b",
    r"\bposter\b",
    r"\blogo\b",
    r"\bwallpaper\b",
    r"\bcover art\b",
    r"\bảnh\b",
    r"\bimage of\b",
    r"\bpicture of\b",
]

IMAGE_EDIT_PATTERNS = [
    r"\bchỉnh\b",
    r"\bchinh\b",
    r"\bsửa\b",
    r"\bsua\b",
    r"\bedit\b",
    r"\bmodify\b",
    r"\btransform\b",
    r"\brestyle\b",
    r"\bretouch\b",
    r"\bremove background\b",
    r"\bxóa nền\b",
    r"\bxoa nen\b",
    r"\bthay nền\b",
    r"\bthay nen\b",
    r"\bbiến\b",
    r"\bbien\b",
    r"\blàm cho\b",
    r"\blam cho\b",
    r"\bmake it\b",
    r"\bchange this\b",
    r"\bturn this\b",
    r"\buse this image\b",
]

FOLLOW_UP_EDIT_PATTERNS = [
    r"\bchỉnh lại\b",
    r"\bchinh lai\b",
    r"\bsửa lại\b",
    r"\bsua lai\b",
    r"\bthử bản khác\b",
    r"\bthu ban khac\b",
    r"\blàm lại\b",
    r"\blam lai\b",
    r"\bđổi\b",
    r"\bdoi\b",
    r"\bmake it\b",
    r"\btry a\b",
    r"\bmore\b",
    r"\bless\b",
]


def _message_role(message: dict[str, Any]) -> str:
    return str(message.get("role") or "user").strip().lower()


def _message_content(message: dict[str, Any]) -> object:
    return message.get("content") or ""


def _message_text(message: dict[str, Any]) -> str:
    return request_text(_message_content(message))


def _latest_user_message(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    for message in reversed(messages):
        if _message_role(message) == "user":
            return message
    return None


def _latest_user_prompt(messages: list[dict[str, Any]]) -> str:
    message = _latest_user_message(messages)
    return _message_text(message) if message else ""


def _latest_user_images(messages: list[dict[str, Any]]) -> list[tuple[bytes, str]]:
    message = _latest_user_message(messages)
    if not message:
        return []
    return extract_image_from_message_content(_message_content(message))


def _uploads_to_message_parts(image_urls: list[str]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    for image_url in image_urls[:4]:
        normalized = str(image_url or "").strip()
        if not normalized:
            continue
        parts.append({
            "type": "image_url",
            "image_url": {"url": normalized},
        })
    return parts


def _merge_latest_user_uploads(
    messages: list[dict[str, Any]],
    uploaded_image_urls: list[str],
) -> list[dict[str, Any]]:
    if not uploaded_image_urls:
        return messages
    next_messages = [dict(message) for message in messages]
    for index in range(len(next_messages) - 1, -1, -1):
        message = next_messages[index]
        if _message_role(message) != "user":
            continue
        content = _message_content(message)
        if isinstance(content, str):
            parts: list[dict[str, Any]] = []
            text = content.strip()
            if text:
                parts.append({"type": "input_text", "text": text})
            parts.extend(_uploads_to_message_parts(uploaded_image_urls))
            message["content"] = parts
        elif isinstance(content, list):
            parts = [part for part in content if isinstance(part, dict)]
            parts.extend(_uploads_to_message_parts(uploaded_image_urls))
            message["content"] = parts
        else:
            message["content"] = _uploads_to_message_parts(uploaded_image_urls)
        next_messages[index] = message
        break
    return next_messages


def _recent_context_images(messages: list[dict[str, Any]]) -> list[tuple[bytes, str]]:
    for message in reversed(messages):
        images = extract_image_from_message_content(_message_content(message))
        if images:
            return images
    return []


def _text_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for raw in messages:
        if not isinstance(raw, dict):
            continue
        role = _message_role(raw)
        content = _message_content(raw)
        if isinstance(content, str):
            text = content.strip()
            if text:
                items.append({"role": role, "content": text})
            continue
        if not isinstance(content, list):
            continue
        parts: list[dict[str, Any]] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            part_type = str(part.get("type") or "").strip()
            if part_type in {"text", "input_text", "image_url", "input_image"}:
                parts.append(part)
        if parts:
            items.append({"role": role, "content": parts})
    return items


def _workspace_images_to_uploads(images: list[tuple[bytes, str]]) -> list[tuple[bytes, str, str]]:
    uploads: list[tuple[bytes, str, str]] = []
    for index, (data, mime) in enumerate(images[:4], start=1):
        extension = "png"
        if "/" in mime:
            extension = mime.split("/", 1)[1].split("+")[0] or "png"
        if extension == "jpeg":
            extension = "jpg"
        uploads.append((data, f"workspace_{index}.{extension}", mime or "image/png"))
    return uploads


def _pattern_match(prompt: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, prompt, flags=re.IGNORECASE) for pattern in patterns)


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    text = str(raw_text or "").strip()
    if not text:
        return {}
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _heuristic_mode(messages: list[dict[str, Any]]) -> str:
    prompt = _latest_user_prompt(messages).strip()
    lower_prompt = prompt.lower()
    latest_images = _latest_user_images(messages)
    context_images = _recent_context_images(messages)

    if latest_images and _pattern_match(
        lower_prompt,
        IMAGE_EDIT_PATTERNS + IMAGE_GENERATE_PATTERNS + FOLLOW_UP_EDIT_PATTERNS,
    ):
        return "image_edit"
    if latest_images and _pattern_match(lower_prompt, IMAGE_EDIT_PATTERNS):
        return "image_edit"
    if latest_images:
        return "text"
    if context_images and _pattern_match(lower_prompt, FOLLOW_UP_EDIT_PATTERNS):
        return "image_edit"
    if _pattern_match(lower_prompt, IMAGE_GENERATE_PATTERNS):
        return "image_generate"
    return "text"


def decide_workspace_mode(messages: list[dict[str, Any]], mode: str = "auto") -> str:
    normalized_mode = str(mode or "auto").strip().lower() or "auto"
    if normalized_mode not in VALID_WORKSPACE_MODES:
        raise HTTPException(status_code=400, detail={"error": "invalid workspace mode"})
    if normalized_mode != "auto":
        return normalized_mode

    latest_prompt = _latest_user_prompt(messages)
    latest_prompt_lower = latest_prompt.lower()
    latest_image_count = len(_latest_user_images(messages))
    context_image_count = len(_recent_context_images(messages))
    if latest_image_count and _pattern_match(
        latest_prompt_lower,
        IMAGE_EDIT_PATTERNS + IMAGE_GENERATE_PATTERNS + FOLLOW_UP_EDIT_PATTERNS,
    ):
        return "image_edit"
    classifier_messages = normalize_messages([
        {"role": "system", "content": INTENT_CLASSIFIER_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Latest user prompt:\n"
                f"{latest_prompt or '(empty)'}\n\n"
                f"Latest user image attachments: {latest_image_count}\n"
                f"Recent conversation images available: {context_image_count}\n"
                "Return JSON only."
            ),
        },
    ])
    try:
        result = collect_text(
            text_backend(),
            ConversationRequest(model="auto", messages=classifier_messages),
        )
        data = _extract_json_object(result)
        candidate = str(data.get("mode") or "").strip().lower()
        if candidate in {"text", "image_generate", "image_edit"}:
            return candidate
    except Exception:
        pass
    return _heuristic_mode(messages)


def _text_response(messages: list[dict[str, Any]], model: str) -> dict[str, Any]:
    request = ConversationRequest(
        model=model,
        messages=normalize_messages(_text_messages(messages)),
    )
    content = collect_text(text_backend(), request)
    return {
        "mode": "text",
        "model": model,
        "message": {
            "role": "assistant",
            "content": content,
        },
        "images": [],
    }


def _image_generate_response(prompt: str, model: str, n: int, size: str | None, base_url: str) -> dict[str, Any]:
    result = openai_v1_image_generations.handle({
        "prompt": prompt,
        "model": model,
        "n": n,
        "size": size,
        "response_format": "b64_json",
        "base_url": base_url,
        "stream": False,
    })
    if not isinstance(result, dict):
        raise RuntimeError("unexpected image generation result")
    return {
        "mode": "image_generate",
        "model": model,
        "message": {
            "role": "assistant",
            "content": str(result.get("message") or "").strip(),
        },
        "images": result.get("data") if isinstance(result.get("data"), list) else [],
        "created": int(result.get("created") or 0),
    }


def _image_edit_response(
    prompt: str,
    model: str,
    n: int,
    size: str | None,
    base_url: str,
    images: list[tuple[bytes, str]],
) -> dict[str, Any]:
    uploads = _workspace_images_to_uploads(images)
    if not uploads:
        raise HTTPException(status_code=400, detail={"error": "image file is required for image edit"})
    result = openai_v1_image_edit.handle({
        "prompt": prompt,
        "images": uploads,
        "model": model,
        "n": n,
        "size": size,
        "response_format": "b64_json",
        "base_url": base_url,
        "stream": False,
    })
    if not isinstance(result, dict):
        raise RuntimeError("unexpected image edit result")
    return {
        "mode": "image_edit",
        "model": model,
        "message": {
            "role": "assistant",
            "content": str(result.get("message") or "").strip(),
        },
        "images": result.get("data") if isinstance(result.get("data"), list) else [],
        "created": int(result.get("created") or 0),
    }


def handle_workspace_request(
    messages: list[dict[str, Any]] | None,
    mode: str = "auto",
    model: str = "auto",
    image_model: str = "gpt-image-2",
    n: int = 1,
    size: str | None = None,
    base_url: str = "",
    uploaded_images: list[tuple[bytes, str]] | None = None,
) -> dict[str, Any]:
    items = [message for message in (messages or []) if isinstance(message, dict)]
    if not items:
        raise HTTPException(status_code=400, detail={"error": "messages is required"})
    latest_uploaded_images = [
        (data, mime or "image/png")
        for data, mime in (uploaded_images or [])
        if isinstance(data, (bytes, bytearray)) and data
    ]
    uploaded_image_urls = [
        save_image_bytes(data, base_url)
        for data, _mime in latest_uploaded_images[:4]
    ]
    if latest_uploaded_images:
        items = _merge_latest_user_uploads(items, uploaded_image_urls)
    uploaded_image_url_items = [{"url": url} for url in uploaded_image_urls]

    prompt = _latest_user_prompt(items)
    if not prompt and not _recent_context_images(items):
        raise HTTPException(status_code=400, detail={"error": "latest user message is empty"})

    decided_mode = decide_workspace_mode(items, mode)
    if decided_mode == "text":
        result = _text_response(items, str(model or "auto").strip() or "auto")
        if uploaded_image_url_items:
            result["uploaded_images"] = uploaded_image_url_items
        return result
    if decided_mode == "image_generate":
        if not prompt:
            raise HTTPException(status_code=400, detail={"error": "prompt is required for image generation"})
        result = _image_generate_response(
            prompt=prompt,
            model=str(image_model or "gpt-image-2").strip() or "gpt-image-2",
            n=max(1, min(4, int(n or 1))),
            size=size,
            base_url=base_url,
        )
        if uploaded_image_url_items:
            result["uploaded_images"] = uploaded_image_url_items
        return result

    images = _latest_user_images(items) or _recent_context_images(items)
    result = _image_edit_response(
        prompt=prompt,
        model=str(image_model or "gpt-image-2").strip() or "gpt-image-2",
        n=max(1, min(4, int(n or 1))),
        size=size,
        base_url=base_url,
        images=images,
    )
    if uploaded_image_url_items:
        result["uploaded_images"] = uploaded_image_url_items
    return result
