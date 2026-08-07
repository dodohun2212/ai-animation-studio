"""Safe local OpenAI API-key persistence without logging secret values."""

from __future__ import annotations

from pathlib import Path


class APIKeySettingsError(ValueError):
    """Raised for an invalid key or an unwritable dotenv file."""


def validate_openai_api_key(value: str) -> str:
    key = value.strip()
    if len(key) < 20 or any(character.isspace() for character in key):
        raise APIKeySettingsError(
            "API 키 형식이 올바르지 않습니다. 공백 없이 전체 키를 입력하세요."
        )
    return key


def save_openai_api_key(project_root: Path, value: str) -> Path:
    """Atomically update only OPENAI_API_KEY while preserving other settings."""
    key = validate_openai_api_key(value)
    path = project_root / ".env"
    try:
        lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
        output: list[str] = []
        replaced = False
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                name = stripped.split("=", 1)[0].strip()
                if name == "OPENAI_API_KEY":
                    if not replaced:
                        output.append(f"OPENAI_API_KEY={key}")
                        replaced = True
                    continue
            output.append(line)
        if not replaced:
            output.insert(0, f"OPENAI_API_KEY={key}")
        temporary = path.with_suffix(".tmp")
        temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
        temporary.replace(path)
        return path
    except OSError as exc:
        raise APIKeySettingsError(".env 파일에 API 키를 저장할 수 없습니다.") from exc


def save_runway_api_secret(project_root: Path, value: str) -> Path:
    """Atomically save the official RUNWAYML_API_SECRET setting."""
    secret = value.strip()
    if len(secret) < 20 or any(character.isspace() for character in secret):
        raise APIKeySettingsError(
            "Runway API secret 형식이 올바르지 않습니다."
        )
    path = project_root / ".env"
    try:
        lines = (
            path.read_text(encoding="utf-8").splitlines()
            if path.is_file()
            else []
        )
        output: list[str] = []
        replaced = False
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                name = stripped.split("=", 1)[0].strip()
                if name in {"RUNWAYML_API_SECRET", "RUNWAY_API_SECRET"}:
                    if not replaced:
                        output.append(f"RUNWAYML_API_SECRET={secret}")
                        replaced = True
                    continue
            output.append(line)
        if not replaced:
            output.append(f"RUNWAYML_API_SECRET={secret}")
        temporary = path.with_suffix(".tmp")
        temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
        temporary.replace(path)
        return path
    except OSError as exc:
        raise APIKeySettingsError(
            ".env 파일에 Runway API secret을 저장할 수 없습니다."
        ) from exc


def masked_api_key(value: str | None) -> str:
    if not value:
        return "미연결"
    if len(value) <= 8:
        return "••••••••"
    return f"{value[:3]}••••••••{value[-4:]}"
