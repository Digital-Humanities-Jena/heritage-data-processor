# server_app/legacy/tests.py
import os
import time
import yaml
import requests
from pathlib import Path
from dotenv import load_dotenv
import sqlite3
import sys
import pandas as pd

# --- Robust Configuration and Path Loading ---

# Get the directory where this tests.py script is located.
SCRIPT_DIR = Path(__file__).resolve().parent

# # Define the path to the config file relative to this script's location.
# CONFIG_PATH = SCRIPT_DIR / "zenodo_toolbox_cli" / "config.yaml"
# CONFIG_DIR = CONFIG_PATH.parent  # The absolute path to the 'zenodo_toolbox_cli' directory


# Global CONFIG dictionary, to be populated by initialize_config
# --- Helper function to get base path ---
def get_base_path():
    """Get the base path for the application, whether running from source or frozen."""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    else:
        # Assumes tests.py is in the 'zenodo_toolbox_cli' directory
        return os.path.dirname(os.path.abspath(__file__))


# This global CONFIG dict will be populated by the main server script
CONFIG = {}
CONFIG_FILE_PATH = ""

# --- Correctly load the pickle file using an absolute path ---
base_path = get_base_path()
pickle_file_path = os.path.join(base_path, "main_df_coords.pkl")

try:
    # Load the pickle file only if it exists
    if os.path.exists(pickle_file_path):
        main_df = pd.read_pickle(pickle_file_path)
    else:
        # If the file doesn't exist, create an empty DataFrame to avoid crashing.
        # This is safer for an operability test module.
        main_df = pd.DataFrame()
        print(
            f"[Tests Module] WARNING: Test data file not found at {pickle_file_path}. Proceeding with empty DataFrame."
        )
except Exception as e:
    print(f"[Tests Module] ERROR: Failed to load 'main_df_coords.pkl': {e}")
    main_df = pd.DataFrame()

# CONFIG = {}
# try:
#     with open(CONFIG_PATH, "r", encoding="utf-8") as f:
#         CONFIG = yaml.safe_load(f)
#         print(f"✅ Operability tests config loaded from {CONFIG_PATH}")
# except Exception as e:
#     print(f"⚠️ Could not load configuration from {CONFIG_PATH}. Tests will likely fail. Error: {e}")


def initialize_config(app_config_path_str: str):
    """
    Initializes the CONFIG for the tests module using the provided absolute path.
    This function should be called by the main application (python_server.py).
    """
    global CONFIG, CONFIG_DIR
    config_file_path = Path(app_config_path_str).resolve()
    CONFIG_DIR = config_file_path.parent

    try:
        with open(config_file_path, "r", encoding="utf-8") as f:
            CONFIG = yaml.safe_load(f)
            if CONFIG is None:
                CONFIG = {}  # Ensure CONFIG is a dict even if file is empty
            print(f"✅ Operability tests module initialized with config from: {config_file_path}")
    except Exception as e:
        CONFIG = {}  # Reset to empty on error
        CONFIG_DIR = Path.cwd()  # Fallback config_dir
        print(
            f"⚠️ Could not load configuration for tests module from {config_file_path}. Tests relying on config will likely fail. Error: {e}"
        )


def _get_config_value(key_path, default=None):
    """Safely gets a nested value from the loaded CONFIG dictionary."""
    value = CONFIG
    try:
        for key in key_path.split("."):
            value = value[key]
        return value
    except (KeyError, TypeError):
        return default


def _resolve_config_path(relative_path_str: str):
    """Resolves a path from config.yaml relative to its own location."""
    if not CONFIG_DIR or not isinstance(relative_path_str, str):
        return None
    return (CONFIG_DIR / relative_path_str).resolve()


# --- Adapted Test Implementations ---


def load_api_keys_from_config(config: dict):
    """
    Loads Zenodo API keys from a .env file specified in the config.
    The path to the .env file is now correctly resolved.
    """
    api_keys = {"ZENODO_API_KEY": None, "ZENODO_SANDBOX_API_KEY": None}
    log = []

    use_env_file = _get_config_value("core.use_env_file", False)
    env_file_from_config = _get_config_value("paths.env_file")

    if use_env_file and env_file_from_config:
        env_file_path = _resolve_config_path(env_file_from_config)
        log.append(f"Attempting to load API keys from: {env_file_path}")
        if env_file_path and env_file_path.exists():
            load_dotenv(dotenv_path=env_file_path, override=True)
        else:
            log.append(f"Warning: .env file not found at '{env_file_path}'.")
    else:
        log.append("use_env_file is false or paths.env_file is not set in config.")

    log.append("Reading keys from environment.")
    for key in api_keys:
        value = os.environ.get(key)
        if value and value.strip():
            api_keys[key] = value.strip()

    return api_keys, log


def _test_zenodo_environment(mode="production"):
    """Performs a full create/discard test, now with corrected path logic."""
    api_keys, log = load_api_keys_from_config(CONFIG)
    key_name = "ZENODO_API_KEY" if mode == "production" else "ZENODO_SANDBOX_API_KEY"
    token = api_keys.get(key_name)

    if not token:
        log.append(f"Error: '{key_name}' could not be loaded from environment or .env file.")
        return {"status": "failure", "message": " ".join(log)}

    # TODO: Temporary Workaround
    if mode == "production":
        mode = "base"
    base_url = _get_config_value(f"urls.{mode}_url", _get_config_value(f"zenodo_keys.{mode}_url"))
    if not base_url:
        return {"status": "failure", "message": f"URL for '{mode}' environment not found in config.yaml."}

    headers = {"Authorization": f"Bearer {token}"}
    api_endpoint = f"{base_url}/api/deposit/depositions"

    try:
        log.append(f"Step 1: Creating draft on {mode} Zenodo...")
        response = requests.post(api_endpoint, headers=headers, json={}, timeout=15)
        response.raise_for_status()
        draft_id = response.json().get("id")
        log.append(f"Success. Created draft ID: {draft_id}.")

        log.append("Step 2: Discarding draft...")
        discard_response = requests.delete(f"{api_endpoint}/{draft_id}", headers=headers, timeout=15)
        discard_response.raise_for_status()
        log.append("Success. Draft discarded.")

        return {"status": "success", "message": f"Zenodo {mode.capitalize()} API key is valid. " + " ".join(log)}

    except requests.RequestException as e:
        log.append(f"Error: API request failed: {e}")
        return {"status": "failure", "message": " ".join(log)}


def run_test_zenodo_live_api():
    return _test_zenodo_environment(mode="production")


def run_test_zenodo_sandbox_api():
    return _test_zenodo_environment(mode="sandbox")


def run_test_object_detection_model():
    """Checks for the object detection model, now with corrected path logic."""
    model_path_str = _get_config_value("image_operations.person_masker.bbox_model")
    model_path = _resolve_config_path(model_path_str)
    if model_path and model_path.exists():
        return {"status": "success", "message": f"Object detection model found at {model_path}."}
    return {"status": "failure", "message": f"Object detection model not found at expected path: {model_path}."}


def run_test_segmentation_model():
    """Checks for the segmentation model, now with corrected path logic."""
    model_path_str = _get_config_value("image_operations.person_masker.segmentation_model")
    model_path = _resolve_config_path(model_path_str)
    if model_path and model_path.exists():
        return {"status": "success", "message": f"Segmentation model found at {model_path}."}
    return {"status": "failure", "message": f"Segmentation model not found at expected path: {model_path}."}


# (The other test functions like run_test_geonames_access, etc., remain the same as the previous version)
def run_test_database_access():
    """Tests database connection based on settings in config.yaml."""
    time.sleep(0.5)
    db_path_str = _get_config_value("paths.db_sqlite")
    db_path = _resolve_config_path(db_path_str)
    if not db_path:
        return {"status": "failure", "message": "Database path not configured in config.yaml."}
    if not db_path.exists():
        return {"status": "failure", "message": f"Database file not found at path: {db_path}"}
    try:
        conn = sqlite3.connect(db_path)
        conn.close()
        return {"status": "success", "message": f"Successfully connected to database at {db_path}."}
    except Exception as e:
        return {"status": "failure", "message": f"Failed to connect to DB: {e}"}


def _test_api_endpoint(service_name, url, headers=None):
    """Generic helper to test if an API endpoint is reachable."""
    time.sleep(1)
    try:
        response = requests.head(url, timeout=5, headers=headers)
        if response.status_code < 400:
            return {"status": "success", "message": f"{service_name} API is reachable."}
        else:
            return {"status": "failure", "message": f"{service_name} API returned status {response.status_code}."}
    except requests.RequestException as e:
        return {"status": "failure", "message": f"Could not connect to {service_name} API: {e}"}


def run_test_geonames_access():
    username = _get_config_value("geonames.username")
    url = _get_config_value("urls.geonames_url")
    if not username or not url:
        return {"status": "failure", "message": "GeoNames username or URL not set in config.yaml."}
    return _test_api_endpoint("GeoNames", f"{url}?q=paris&maxRows=1&username={username}")


def run_test_nominatim_access():
    """
    Tests Nominatim APIs (Search & Reverse) using settings from config.yaml.
    Adapted from cli2.py to use GET requests and return a detailed log for the GUI.
    """
    log = []

    # --- Step 1: Read Configuration ---
    log.append("--- Reading Configuration ---")
    nominatim_url = _get_config_value("urls.nominatim_url")
    reverse_url = _get_config_value("urls.nominatim_reverse_url")
    user_agent = _get_config_value("nominatim.user_agent")

    config_errors = []
    if not nominatim_url:
        config_errors.append("'urls.nominatim_url'")
    if not reverse_url:
        config_errors.append("'urls.nominatim_reverse_url'")
    if not user_agent:
        config_errors.append("'nominatim.user_agent'")

    if config_errors:
        message = f"Config Error: Missing required setting(s): {', '.join(config_errors)}."
        log.append(message)
        return {"status": "failure", "message": "\n".join(log)}

    log.append(f"Using User-Agent: {user_agent}")
    headers = {"User-Agent": user_agent}

    # --- Step 2: Test Forward Search API (using GET) ---
    search_success = False
    log.append("\n--- Testing Forward Search (Query: 'Jena') ---")
    try:
        params = {"q": "Jena", "format": "json", "limit": 1}
        response = requests.get(nominatim_url, params=params, headers=headers, timeout=10)
        log.append(f"Request URL: {response.url}")
        log.append(f"Status Code: {response.status_code}")
        response.raise_for_status()  # Check for HTTP errors (4xx or 5xx)

        data = response.json()
        if isinstance(data, list) and data:
            log.append("✅ Search Response OK: Received a non-empty list.")
            search_success = True
        else:
            log.append("❌ Search Response Error: Expected a non-empty list, but received something else.")

    except requests.RequestException as e:
        log.append(f"❌ Network or HTTP Error during Search: {e}")
    except Exception as e:
        log.append(f"❌ Unexpected Error during Search: {e}")

    # --- Step 3: Test Reverse Lookup API (using GET) ---
    reverse_success = False
    log.append("\n--- Testing Reverse Lookup (Lat: 50.92, Lon: 11.58) ---")
    try:
        params = {"lat": 50.92, "lon": 11.58, "format": "json"}
        response = requests.get(reverse_url, params=params, headers=headers, timeout=10)
        log.append(f"Request URL: {response.url}")
        log.append(f"Status Code: {response.status_code}")
        response.raise_for_status()

        data = response.json()
        if isinstance(data, dict) and "display_name" in data:
            log.append("✅ Reverse Response OK: Received a dictionary with 'display_name'.")
            reverse_success = True
        else:
            log.append("❌ Reverse Response Error: Expected a dictionary with a 'display_name' key.")

    except requests.RequestException as e:
        log.append(f"❌ Network or HTTP Error during Reverse Lookup: {e}")
    except Exception as e:
        log.append(f"❌ Unexpected Error during Reverse Lookup: {e}")

    # --- Final Summary ---
    overall_success = search_success and reverse_success
    status = "success" if overall_success else "failure"
    summary_message = (
        f"Nominatim API Test: {'PASSED' if overall_success else 'FAILED'}. "
        f"Forward Search: {'OK' if search_success else 'FAIL'}, "
        f"Reverse Lookup: {'OK' if reverse_success else 'FAIL'}."
    )
    log.append("\n" + "=" * 40)
    log.append(summary_message)
    log.append("=" * 40)

    # Return the final result dictionary
    return {"status": status, "message": "\n".join(log)}


def run_test_overpass_api():
    url = _get_config_value("urls.overpass_url")
    return _test_api_endpoint("OSM Overpass", url)


def run_test_ollama_llm():
    port = _get_config_value("ollama.port", "11434")
    host = f"http://localhost:{port}"
    return _test_api_endpoint("Ollama", host)


def run_test_prompts_file():
    """Checks if the prompts file exists and is valid YAML."""
    prompts_path_str = _get_config_value("paths.prompts_file")
    prompts_path = _resolve_config_path(prompts_path_str)
    if not prompts_path:
        return {"status": "failure", "message": "Prompts file path not defined in config.yaml"}
    if not prompts_path.exists():
        return {"status": "failure", "message": f"Prompts file not found at: {prompts_path}"}
    try:
        with open(prompts_path, "r", encoding="utf-8") as f:
            yaml.safe_load(f)
        return {"status": "success", "message": "Prompts file found and is valid YAML."}
    except Exception as e:
        return {"status": "failure", "message": f"Prompts file is not valid YAML: {e}"}


def check_hdpc_db_integrity(db_path):
    """Checks if the loaded .hdpc file has the required tables."""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        tables = ["project_info", "source_files", "zenodo_records", "project_pipelines"]
        for table in tables:
            cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}';")
            if not cursor.fetchone():
                return {"status": "failure", "message": f"HDPC is missing critical table: '{table}'."}
        return {"status": "success", "message": "HDPC database integrity looks OK."}
    except Exception as e:
        return {"status": "failure", "message": f"Database integrity check failed: {e}"}
