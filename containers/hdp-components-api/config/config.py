import os
from pathlib import Path


class Config:
    # API Configuration
    PORT = int(os.getenv("PORT", 8599))
    HOST = os.getenv("HOST", "0.0.0.0")
    DEBUG = os.getenv("DEBUG", "False").lower() == "true"

    # Authentication
    API_KEY = os.getenv("API_KEY", "your-secret-api-key-here")

    # Data paths
    BASE_DIR = Path(__file__).parent.parent
    DATA_DIR = BASE_DIR / "data"
    COMPONENTS_FILE = DATA_DIR / "available_components.json"

    # Zenodo Configuration
    ZENODO_COMMUNITY_ID = os.getenv("ZENODO_COMMUNITY_ID", "hdp-components")
    ZENODO_USER_AGENT = "HDPComponentsAPI/1.0"

    # Scheduling Configuration
    ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "True").lower() == "true"
    UPDATE_INTERVAL_HOURS = int(os.getenv("UPDATE_INTERVAL_HOURS", 24))
    INITIAL_UPDATE_ON_STARTUP = os.getenv("INITIAL_UPDATE_ON_STARTUP", "True").lower() == "true"

    # Request timeouts
    REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", 30))

    @classmethod
    def init_app(cls, app):
        # Ensure data directory exists
        cls.DATA_DIR.mkdir(parents=True, exist_ok=True)

        # Initialize components file if it doesn't exist
        if not cls.COMPONENTS_FILE.exists():
            import json

            with open(cls.COMPONENTS_FILE, "w", encoding="utf-8") as f:
                json.dump({}, f, indent=2)
