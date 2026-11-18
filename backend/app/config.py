from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")
    openai_api_key: str = ""
    listener_model: str = "gpt-6.2-astra"
    transcription_model: str = "gpt-transcribe"
    presentation_transcription_model: str = "whisper-1"
    data_dir: Path = BACKEND_DIR / ".data"
    public_origin: str = ""
    worker_enabled: bool = True


def get_settings() -> Settings:
    # Re-read local configuration so adding a key does not require a restart.
    return Settings()
