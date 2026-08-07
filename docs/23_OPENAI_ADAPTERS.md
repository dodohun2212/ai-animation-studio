# OpenAI adapters and paid-call boundaries

The runtime uses the official `openai==2.48.0` Python SDK.

- Story: Responses API with strict JSON Schema, model configured by
  `OPENAI_STORY_MODEL` (default `gpt-5.6-luna`).
- Text-only images: `client.images.generate`.
- Images with References: `client.images.edit` with a list of official input
  image file objects.
- Image model: `OPENAI_IMAGE_MODEL` (default `gpt-image-2`).

Official references:

- https://developers.openai.com/api/docs/models/gpt-image-2
- https://developers.openai.com/api/docs/guides/latest-model

The app never claims that an image Reference guarantees exact character or
style reproduction. At most 16 selected Reference files are sent by the
adapter; larger selections are rejected before a paid request. API keys,
Base64 payloads, and full provider responses are not logged.

Before a full run the UI reports a maximum of one story call and six image
calls and asks for confirmation by default. Local counters are soft safeguards,
not OpenAI billing controls. The OpenAI Usage Dashboard remains authoritative.

No live API integration test runs in the default suite. Set
`RUN_OPENAI_INTEGRATION_TESTS=true` only when intentionally running a separate,
cost-bearing integration test.
