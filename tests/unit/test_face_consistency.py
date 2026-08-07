"""Local face consistency behavior without a real model download."""

from pathlib import Path
import tempfile
import unittest

from app.services.face_consistency import FaceConsistencyService


class FakeFaceBackend:
    def __init__(self, results):
        self.results = results
        self.calls = 0

    def embeddings(self, image_path: Path):
        self.calls += 1
        return self.results[image_path.name]


class FaceConsistencyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.reference = self.root / "reference.png"
        self.generated = self.root / "generated.png"
        self.reference.write_bytes(b"reference")
        self.generated.write_bytes(b"generated")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_one_face_passes_and_cache_is_reused(self) -> None:
        backend = FakeFaceBackend(
            {"reference.png": [[1.0, 0.0]], "generated.png": [[0.9, 0.1]]}
        )
        service = FaceConsistencyService(backend)
        self.assertEqual(service.check(self.reference, self.generated).status, "pass")
        service.check(self.reference, self.generated)
        self.assertEqual(backend.calls, 2)

    def test_no_face_and_multiple_faces(self) -> None:
        no_face = FakeFaceBackend(
            {"reference.png": [[1.0, 0.0]], "generated.png": []}
        )
        self.assertEqual(
            FaceConsistencyService(no_face).check(
                self.reference, self.generated
            ).status,
            "no_face_detected",
        )
        multiple = FakeFaceBackend(
            {
                "reference.png": [[1.0, 0.0]],
                "generated.png": [[1.0, 0.0], [0.0, 1.0]],
            }
        )
        self.assertEqual(
            FaceConsistencyService(multiple).check(
                self.reference, self.generated
            ).status,
            "multiple_faces",
        )

    def test_missing_model_is_safe(self) -> None:
        result = FaceConsistencyService(None).check(
            self.reference, self.generated
        )
        self.assertEqual(result.status, "error")
        self.assertIn("설치", result.message)

    def test_backend_failure_does_not_raise(self) -> None:
        class Broken:
            def embeddings(self, image_path: Path):
                raise RuntimeError("model failed")

        result = FaceConsistencyService(Broken()).check(
            self.reference, self.generated
        )
        self.assertEqual(result.status, "error")


if __name__ == "__main__":
    unittest.main()

