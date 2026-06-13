from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    llm_api_key: str
    llm_base_url: str
    llm_model: str
    firecrawl_api_key: str
    mongodb_uri: str


settings = Settings()
