"""Official OpenAI Images API adapter with supported Reference edits."""

from __future__ import annotations

import base64
import binascii
from contextlib import ExitStack
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from app.adapters.openai_common import OpenAIAdapterError, call_with_retry


class OpenAIImageAdapter:
    """Return PNG bytes for ImageEngine using one reusable SDK client."""

    MAX_REFERENCE_IMAGES = 16

    def __init__(
        self, api_key: str, model: str, size: str, quality: str,
        output_format: str, timeout: float, max_retries: int,
        client: Any | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required")
        if client is None:
            from openai import OpenAI
            client = OpenAI(api_key=api_key, timeout=timeout, max_retries=0)
        self.client = client
        self.model = model
        self.size = size
        self.quality = quality
        self.output_format = output_format
        self.timeout = timeout
        self.max_retries = max_retries
        self.last_retries = 0
        self.last_request_id = ""

    def generate(self, prompt: str, reference_images: list[Path]) -> bytes:
        """Generate with the configured fallback size."""
        return self.generate_for_size(prompt, reference_images, self.size)

    def generate_for_size(
        self,
        prompt: str,
        reference_images: list[Path],
        size: str,
    ) -> bytes:
        """Generate with one project-selected supported output size."""
        if size not in {"1024x1024", "1024x1536", "1536x1024", "auto"}:
            raise ValueError(f"Unsupported OpenAI image size: {size}")
        if len(reference_images) > self.MAX_REFERENCE_IMAGES:
            raise OpenAIAdapterError(
                "reference_limit",
                f"Reference 이미지는 최대 {self.MAX_REFERENCE_IMAGES}개까지 전송할 수 있습니다.",
            )
        if reference_images:
            for path in reference_images:
                if not path.is_file():
                    raise OpenAIAdapterError(
                        "reference_file", f"Reference 파일이 없습니다: {path.name}"
                    )
            with ExitStack() as stack:
                files = [stack.enter_context(path.open("rb")) for path in reference_images]
                response, self.last_retries = call_with_retry(
                    lambda: self.client.images.edit(
                        model=self.model, image=files, prompt=prompt,
                        size=size, quality=self.quality,
                        output_format=self.output_format,
                    ),
                    self.max_retries,
                )
        else:
            response, self.last_retries = call_with_retry(
                lambda: self.client.images.generate(
                    model=self.model, prompt=prompt, size=size,
                    quality=self.quality, output_format=self.output_format,
                ),
                self.max_retries,
            )
        self.last_request_id = str(
            getattr(response, "_request_id", "")
            or getattr(response, "id", "")
        )
        return self._extract(response)

    def _extract(self, response: Any) -> bytes:
        data = getattr(response, "data", None)
        if not data:
            raise OpenAIAdapterError("empty_response", "이미지 응답이 비어 있습니다.")
        item = data[0]
        encoded = getattr(item, "b64_json", None)
        if encoded:
            try:
                return base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise OpenAIAdapterError(
                    "invalid_base64", "이미지 Base64 응답이 손상되었습니다."
                ) from exc
        url = getattr(item, "url", None)
        if url:
            try:
                with urlopen(url, timeout=self.timeout) as response_stream:
                    return response_stream.read()
            except OSError as exc:
                raise OpenAIAdapterError(
                    "url_download", "이미지 URL 다운로드에 실패했습니다."
                ) from exc
        raise OpenAIAdapterError("empty_response", "사용 가능한 이미지 데이터가 없습니다.")
