"""Official OpenAI Responses API adapter for six-scene stories."""

from __future__ import annotations

import json
from typing import Any

from app.adapters.openai_common import OpenAIAdapterError, call_with_retry


STORY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "synopsis", "scenes", "ending"],
    "properties": {
        "title": {"type": "string"},
        "synopsis": {"type": "string"},
        "ending": {"type": "string"},
        "scenes": {
            "type": "array", "minItems": 6, "maxItems": 6,
            "items": {
                "type": "object", "additionalProperties": False,
                "required": [
                    "number", "description", "visual_action",
                    "start_motion", "main_motion", "end_motion",
                    "shot_size", "camera_angle", "composition",
                    "lens_feel", "focus_subject",
                    "camera_motion", "environment_motion",
                    "motion_speed", "motion_intensity", "expression_change",
                    "continuity_hint",
                ],
                "properties": {
                    "number": {"type": "integer", "minimum": 1, "maximum": 6},
                    "description": {"type": "string"},
                    "visual_action": {"type": "string"},
                    "start_motion": {"type": "string"},
                    "main_motion": {"type": "string"},
                    "end_motion": {"type": "string"},
                    "shot_size": {"type": "string"},
                    "camera_angle": {"type": "string"},
                    "composition": {"type": "string"},
                    "lens_feel": {"type": "string"},
                    "focus_subject": {"type": "string"},
                    "camera_motion": {"type": "string"},
                    "environment_motion": {"type": "string"},
                    "motion_speed": {"type": "string"},
                    "motion_intensity": {"type": "string"},
                    "expression_change": {"type": "string"},
                    "continuity_hint": {"type": "string"},
                },
            },
        },
    },
}


class OpenAIStoryAdapter:
    """Generate strict JSON using one reusable official SDK client."""

    def __init__(
        self, api_key: str, model: str, timeout: float,
        max_retries: int, client: Any | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required")
        if client is None:
            from openai import OpenAI
            client = OpenAI(api_key=api_key, timeout=timeout, max_retries=0)
        self.client = client
        self.model = model
        self.max_retries = max_retries
        self.last_retries = 0
        self.last_request_id = ""

    def generate(self, prompt: str) -> dict[str, Any]:
        response, self.last_retries = call_with_retry(
            lambda: self.client.responses.create(
                model=self.model,
                input=prompt,
                text={"format": {
                    "type": "json_schema", "name": "animation_story",
                    "strict": True, "schema": STORY_SCHEMA,
                }},
            ),
            self.max_retries,
        )
        self.last_request_id = str(
            getattr(response, "_request_id", "")
            or getattr(response, "id", "")
        )
        text = getattr(response, "output_text", "")
        if not text:
            raise OpenAIAdapterError("empty_response", "대본 응답이 비어 있습니다.")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise OpenAIAdapterError(
                "invalid_response", "대본 응답 JSON을 해석할 수 없습니다."
            ) from exc
