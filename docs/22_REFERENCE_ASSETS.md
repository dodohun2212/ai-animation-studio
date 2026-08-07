# Reference Assets and Local Face Consistency

## Storage

Each project creates these files only when the feature is first used:

```text
learning_data/projects/<project_id>/reference_assets/
├── references.json
└── RA-<random-id>.<png|jpg|jpeg|webp>

learning_data/projects/<project_id>/generated_image_reviews.json
```

`references.json` is written atomically. Existing project JSON files require no
migration; new `ProjectContext` fields default to empty lists.

## Image-provider boundary

`ImageEngine` already accepts `generator(prompt, reference_images)`. The image
pipeline now accepts an optional Reference selector and an optional
Reference-capable image generator. With neither configured it uses the original
text-only callback unchanged. The current repository has no live OpenAI image
adapter, so it does not claim that Reference images are transmitted. A future
official adapter must verify the selected OpenAI endpoint's current input-image
limits and record the asset IDs actually sent.

## Optional local face check

No face model or biometric data is bundled. To enable the optional local check:

```powershell
py -3.12 -m pip install insightface onnxruntime opencv-python
```

Obtain and use a model only after reviewing its license and permitted use.
Configure an offline model root when required:

```dotenv
FACE_CHECK_ENABLED=true
FACE_MODEL_NAME=buffalo_l
FACE_MODEL_DIRECTORY=C:\models\insightface
FACE_PASS_THRESHOLD=0.60
FACE_WARNING_THRESHOLD=0.40
```

Thresholds are cosine-similarity boundaries, not percentages or identity
probabilities. They are deliberately configurable because model, domain, crop,
pose, and stylization change score distributions. Animation and non-photoreal
faces can be substantially less reliable. Results are advisory only and must
never be used to establish a person's identity.

The model is loaded on first use and reused. Embeddings are cached by resolved
path, file size, and modification timestamp. Import/model/detection failures
disable only the check; generated images remain saved.

## Asset Library search presentation

Asset Library 검색 결과에서 일치한 메타데이터는 다음 순서로 표시한다.

1. 대표 이름 (`display_name`)
2. 대본 속 다른 이름 (`aliases`)
3. 검색 태그 (`tags`)
4. 설명 (`description`)

이 순서는 사용자가 결과를 이해하기 위한 표시 우선순위이며 검색 가중치가
아니다. 기존 부분 문자열·대소문자 무시 검색은 그대로 유지하고, 유형
(`asset_type`)도 기존 호환성을 위해 계속 검색한다.

## Character Asset Sets

`character` 유형만 `reference_images` 목록을 가질 수 있다. 각 항목은
`role`, 기존 이미지 `path`, 콘텐츠 해시와 원본 파일명을 기록하며 이미지
바이트를 Asset Library에 다시 복제하지 않는다. Project Mapping은 계속
Character의 단일 `asset_id`만 저장한다.

기존 Character Asset에 `reference_images`가 없으면 로딩 시 기존 대표
이미지를 `thumbnail`과 `front` 의미로 해석한다. 이 호환 처리는 메모리에서
이루어지며 기존 JSON, Asset ID, Project Mapping을 자동으로 다시 쓰지 않는다.

장면 생성 시 Resolver는 장면의 로컬 텍스트만 사용해 방향 및 표정 역할을
선택한다. 판단할 수 없으면 `thumbnail`, 그다음 `front`를 사용한다. 이
선택 과정에는 Story/Image API 호출이 없으며 선택된 여러 경로는 기존 단일
Image Adapter 요청의 `reference_images` 목록으로 전달된다.
