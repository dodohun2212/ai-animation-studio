# AI Animation Studio v1.1 — Long Story Studio

Long projects are stored separately from the existing short-project JSON:

```text
learning_data/projects/<project_id>/long_story/
├── project.json
├── story_bible.json
└── episodes/
    └── episode_001/
        ├── episode.json
        ├── continuity.json
        └── images/scene1.png ... scene6.png
```

All JSON writes use a same-directory temporary file followed by atomic replace.
Existing `ProjectContext` files without `project_type` load as
`short_project`.

## Final Polish UI

The long-project workspace now exposes the existing Story Bible collections as
dedicated table managers. Reference Assets can be scoped to all, one, a range,
or a list of episodes independently from their scene scope. The Reference
Preview uses `select_for_episode_scene()` so it shows the same ordered inputs
the image engine will receive.

Single-scene regeneration is always preceded by an exact prompt, Reference,
cache, and estimated-call preview. After confirmation, only the selected
`sceneN.png` is replaced; its approval is cleared and the event is appended to
the episode regeneration history. CapCut remains a manual external editing
stage.

Without `OPENAI_API_KEY`, project creation, Story Bible editing, manual episode
planning, Timeline, Continuity storage, and Reference management remain
available. AI buttons show a setup explanation and never create fake results.

With an API key after restart:

- episode planning uses the official Responses API planning adapter;
- one selected episode script uses the existing OpenAI story adapter;
- only an approved script can enter image generation;
- image generation uses the existing OpenAI image adapter and ImageEngine;
- every generated image requires user approval before CapCut waiting state;
- preparing the next episode saves Continuity but never calls the next script
  automatically.

The Story Context Builder includes current-plan data, relevant Bible entities,
recent detailed Continuity, older compressed summaries, unresolved
foreshadowing, revealable information, and explicitly forbidden future secrets.
It removes lower-priority historical material when the configured context
character limit is reached.
