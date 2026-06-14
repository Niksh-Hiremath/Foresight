from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore", populate_by_name=True)

    llm_api_key: str
    llm_base_url: str
    llm_model: str = Field(alias="LLM_MODEL_NAME", validation_alias="LLM_MODEL_NAME")
    firecrawl_api_key: str
    mongodb_uri: str


settings = Settings()
