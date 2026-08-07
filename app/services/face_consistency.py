"""Optional local face-similarity checks with cached embeddings."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
from pathlib import Path
from typing import Protocol, Sequence


class FaceBackend(Protocol):
    """Minimal adapter implemented by local embedding backends."""

    def embeddings(self, image_path: Path) -> Sequence[Sequence[float]]:
        """Return one normalized or raw embedding per detected face."""


class InsightFaceBackend:
    """Lazy CPU/GPU InsightFace adapter; no model is bundled or auto-downloaded."""

    def __init__(
        self,
        *,
        model_name: str = "buffalo_l",
        model_root: Path | None = None,
        use_gpu: bool = False,
    ) -> None:
        try:
            import cv2  # type: ignore[import-not-found]
            from insightface.app import FaceAnalysis  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError(
                "InsightFace, ONNX Runtime, and OpenCV are required"
            ) from exc
        providers = (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if use_gpu else ["CPUExecutionProvider"]
        )
        kwargs: dict[str, object] = {
            "name": model_name,
            "providers": providers,
        }
        if model_root is not None:
            kwargs["root"] = str(model_root)
        self._cv2 = cv2
        self._analysis = FaceAnalysis(**kwargs)
        self._analysis.prepare(ctx_id=0 if use_gpu else -1, det_size=(640, 640))

    def embeddings(self, image_path: Path) -> Sequence[Sequence[float]]:
        image = self._cv2.imread(str(image_path))
        if image is None:
            raise ValueError("Image decoding failed")
        faces = self._analysis.get(image)
        return [
            face.normed_embedding.astype(float).tolist()
            for face in faces
            if getattr(face, "normed_embedding", None) is not None
        ]


@dataclass(frozen=True, slots=True)
class FaceConsistencyResult:
    """Advisory character-face similarity result, never identity proof."""

    status: str
    similarity: float | None
    reference_faces: int
    generated_faces: int
    message: str
    model: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class FaceConsistencyService:
    """Compare local embeddings without blocking image persistence."""

    def __init__(
        self,
        backend: FaceBackend | None,
        *,
        pass_threshold: float = 0.60,
        warning_threshold: float = 0.40,
        model_name: str = "optional-local-backend",
    ) -> None:
        if not -1 <= warning_threshold <= pass_threshold <= 1:
            raise ValueError("Invalid cosine thresholds")
        self.backend = backend
        self.pass_threshold = pass_threshold
        self.warning_threshold = warning_threshold
        self.model_name = model_name
        self._cache: dict[str, Sequence[Sequence[float]]] = {}

    def check(
        self, reference_path: Path | None, generated_path: Path
    ) -> FaceConsistencyResult:
        if reference_path is None:
            return self._result("not_applicable", None, 0, 0, "얼굴 기준 이미지가 없습니다.")
        if self.backend is None:
            return self._result(
                "error", None, 0, 0,
                "로컬 얼굴 모델이 설치되지 않아 검사를 사용할 수 없습니다.",
            )
        try:
            references = self._embeddings(reference_path)
            generated = self._embeddings(generated_path)
            if not references or not generated:
                return self._result(
                    "no_face_detected", None, len(references), len(generated),
                    "얼굴을 찾지 못했거나 얼굴이 너무 작습니다.",
                )
            if len(references) != 1 or len(generated) != 1:
                return self._result(
                    "multiple_faces", None, len(references), len(generated),
                    "여러 얼굴이 감지되어 사용자의 확인이 필요합니다.",
                )
            similarity = _cosine(references[0], generated[0])
            status = (
                "pass" if similarity >= self.pass_threshold
                else "warning" if similarity >= self.warning_threshold
                else "fail"
            )
            return self._result(
                status, similarity, 1, 1,
                "캐릭터 얼굴 유사도 참고 점수이며 동일 인물 판정이 아닙니다.",
            )
        except Exception as exc:
            return self._result(
                "error", None, 0, 0, f"로컬 얼굴 검사 오류: {type(exc).__name__}"
            )

    def _embeddings(self, path: Path) -> Sequence[Sequence[float]]:
        stat = path.stat()
        key = hashlib.sha256(
            f"{path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}".encode()
        ).hexdigest()
        if key not in self._cache:
            assert self.backend is not None
            self._cache[key] = self.backend.embeddings(path)
        return self._cache[key]

    def _result(
        self, status: str, similarity: float | None,
        reference_faces: int, generated_faces: int, message: str,
    ) -> FaceConsistencyResult:
        return FaceConsistencyResult(
            status, similarity, reference_faces, generated_faces,
            message, self.model_name,
        )


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or not left:
        raise ValueError("Embedding dimensions do not match")
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = sum(value * value for value in left) ** 0.5
    right_norm = sum(value * value for value in right) ** 0.5
    if left_norm == 0 or right_norm == 0:
        raise ValueError("Zero-length embedding")
    return max(-1.0, min(1.0, dot / (left_norm * right_norm)))
