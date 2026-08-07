"""Official OpenAI adapters tested with injected fake SDK clients."""

import base64
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from app.adapters.openai_common import OpenAIAdapterError
from app.adapters.openai_image_adapter import OpenAIImageAdapter
from app.adapters.openai_story_adapter import OpenAIStoryAdapter
from app.engines.image_engine import PNG_SIGNATURE


class Recorder:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.result

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return self.result

    def edit(self, **kwargs):
        self.calls.append(kwargs)
        return self.result


class OpenAIAdapterTest(unittest.TestCase):
    def test_story_request_and_json(self) -> None:
        text = (
            '{"title":"t","synopsis":"s","scenes":['
            + ",".join(
                f'{{"number":{number},"description":"d"}}'
                for number in range(1, 7)
            )
            + '],"ending":"e"}'
        )
        responses = Recorder(SimpleNamespace(output_text=text))
        client = SimpleNamespace(responses=responses)
        adapter = OpenAIStoryAdapter(
            "key", "story-model", 10, 0, client=client
        )
        self.assertEqual(len(adapter.generate("prompt")["scenes"]), 6)
        self.assertEqual(responses.calls[0]["model"], "story-model")
        self.assertEqual(
            responses.calls[0]["text"]["format"]["type"], "json_schema"
        )

    def test_text_and_reference_image_requests(self) -> None:
        payload = PNG_SIGNATURE + b"image"
        images = Recorder(
            SimpleNamespace(
                data=[SimpleNamespace(
                    b64_json=base64.b64encode(payload).decode(), url=None
                )]
            )
        )
        client = SimpleNamespace(images=images)
        adapter = OpenAIImageAdapter(
            "key", "gpt-image-2", "1024x1536", "medium", "png",
            10, 0, client=client,
        )
        self.assertEqual(adapter.generate("prompt", []), payload)
        self.assertIn("output_format", images.calls[0])
        with tempfile.TemporaryDirectory() as directory:
            references = []
            for number in range(3):
                reference = Path(directory) / f"ref-{number}.png"
                reference.write_bytes(payload)
                references.append(reference)
            self.assertEqual(adapter.generate("prompt", references), payload)
        self.assertIn("image", images.calls[1])
        self.assertEqual(len(images.calls[1]["image"]), 3)
        self.assertEqual(len(images.calls), 2)

    def test_project_size_overrides_configured_fallback(self) -> None:
        payload = PNG_SIGNATURE + b"image"
        images = Recorder(SimpleNamespace(data=[SimpleNamespace(
            b64_json=base64.b64encode(payload).decode(), url=None
        )]))
        adapter = OpenAIImageAdapter(
            "key", "gpt-image-2", "1024x1536", "medium", "png",
            10, 0, client=SimpleNamespace(images=images),
        )

        adapter.generate_for_size("wide", [], "1536x1024")

        self.assertEqual(images.calls[0]["size"], "1536x1024")
        self.assertEqual(adapter.size, "1024x1536")

    def test_empty_and_invalid_base64_are_rejected(self) -> None:
        empty = SimpleNamespace(images=Recorder(SimpleNamespace(data=[])))
        adapter = OpenAIImageAdapter(
            "key", "model", "1024x1024", "low", "png", 10, 0,
            client=empty,
        )
        with self.assertRaises(OpenAIAdapterError):
            adapter.generate("prompt", [])
        invalid = SimpleNamespace(images=Recorder(SimpleNamespace(
            data=[SimpleNamespace(b64_json="%%%", url=None)]
        )))
        adapter.client = invalid
        with self.assertRaises(OpenAIAdapterError):
            adapter.generate("prompt", [])


if __name__ == "__main__":
    unittest.main()

