"""Official Responses API adapter for long-story episode planning previews."""

from __future__ import annotations

import json
from typing import Any

from app.adapters.openai_common import OpenAIAdapterError, call_with_retry


class OpenAIEpisodePlannerAdapter:
    def __init__(
        self, api_key: str, model: str, timeout: float,
        max_retries: int, client: Any | None = None,
    ) -> None:
        if client is None:
            from openai import OpenAI
            client = OpenAI(api_key=api_key, timeout=timeout, max_retries=0)
        self.client = client
        self.model = model
        self.max_retries = max_retries
        self.last_retries = 0
        self.last_request_id = ""

    def generate(self, prompt: str, episode_count: int) -> list[dict[str, Any]]:
        if not 1 <= episode_count <= 30:
            raise ValueError("AI planning supports 1 to 30 episodes per request")
        schema = {
            "type": "object", "additionalProperties": False,
            "required": ["episodes"],
            "properties": {
                "episodes": {
                    "type": "array", "minItems": episode_count,
                    "maxItems": episode_count,
                    "items": {
                        "type": "object", "additionalProperties": False,
                        "required": [
                            "number", "title", "summary", "core_event",
                            "conflict", "cliffhanger",
                        ],
                        "properties": {
                            "number": {"type": "integer"},
                            "title": {"type": "string"},
                            "summary": {"type": "string"},
                            "core_event": {"type": "string"},
                            "conflict": {"type": "string"},
                            "cliffhanger": {"type": "string"},
                        },
                    },
                }
            },
        }
        response, self.last_retries = call_with_retry(
            lambda: self.client.responses.create(
                model=self.model, input=prompt,
                text={"format": {
                    "type": "json_schema", "name": "episode_plan",
                    "strict": True, "schema": schema,
                }},
            ),
            self.max_retries,
        )
        self.last_request_id = str(
            getattr(response, "_request_id", "")
            or getattr(response, "id", "")
        )
        try:
            episodes = json.loads(response.output_text)["episodes"]
        except (AttributeError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise OpenAIAdapterError(
                "invalid_response", "에피소드 계획 응답을 해석할 수 없습니다."
            ) from exc
        if len(episodes) != episode_count:
            raise OpenAIAdapterError("invalid_response", "목표 회차 수가 일치하지 않습니다.")
        return episodes

    def generate_outline(
        self, prompt: str, episode_count: int
    ) -> dict[str, Any]:
        """Generate one project overview and lightweight Episode outlines."""
        if not 1 <= episode_count <= 365:
            raise ValueError("Episode outline count must be between 1 and 365")
        string_list = {"type": "array", "items": {"type": "string"}}
        project_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "title", "logline", "overview", "genre", "tone", "theme",
                "starting_state", "midpoint", "ending_direction",
                "story_flow_summary",
            ],
            "properties": {
                key: {"type": "string"} for key in (
                    "title", "logline", "overview", "genre", "tone", "theme",
                    "starting_state", "midpoint", "ending_direction",
                    "story_flow_summary",
                )
            },
        }
        episode_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "episode_number", "title", "summary", "main_event",
                "conflict", "characters", "locations", "objects", "reveals",
                "hidden_secrets", "cliffhanger", "next_episode_hook",
            ],
            "properties": {
                "episode_number": {"type": "integer"},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "main_event": {"type": "string"},
                "conflict": {"type": "string"},
                "characters": string_list,
                "locations": string_list,
                "objects": string_list,
                "reveals": string_list,
                "hidden_secrets": string_list,
                "cliffhanger": {"type": "string"},
                "next_episode_hook": {"type": "string"},
            },
        }
        schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["project", "episodes"],
            "properties": {
                "project": project_schema,
                "episodes": {
                    "type": "array",
                    "minItems": episode_count,
                    "maxItems": episode_count,
                    "items": episode_schema,
                }
            },
        }
        response, self.last_retries = call_with_retry(
            lambda: self.client.responses.create(
                model=self.model,
                input=prompt,
                text={"format": {
                    "type": "json_schema",
                    "name": "long_project_outline",
                    "strict": True,
                    "schema": schema,
                }},
            ),
            self.max_retries,
        )
        self.last_request_id = str(
            getattr(response, "_request_id", "")
            or getattr(response, "id", "")
        )
        try:
            result = json.loads(response.output_text)
        except (AttributeError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise OpenAIAdapterError(
                "invalid_response", "장기 프로젝트 개요 응답을 해석할 수 없습니다."
            ) from exc
        if len(result.get("episodes", [])) != episode_count:
            raise OpenAIAdapterError(
                "invalid_response", "목표 Episode 수가 일치하지 않습니다."
            )
        return result
