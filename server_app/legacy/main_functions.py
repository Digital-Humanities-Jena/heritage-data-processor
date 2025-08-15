# server_app/legacy/main_functions.py
import logging
from pathlib import Path
import os
import re
import requests
import sys
from typing import Any, Dict, List, Optional, Tuple, Union
import yaml

from .rate_limiter import RateLimiterParallel

# === CONSTANTS & HELPERS ===
logger = logging.getLogger(__name__)


def get_base_path():
    """Get the base path for the application, whether running from source or frozen."""
    if getattr(sys, "frozen", False):
        # The application is running in a PyInstaller bundle.
        return sys._MEIPASS
    else:
        # The application is running in a normal Python environment.
        return os.path.dirname(os.path.abspath(__file__))


def get_resource_path(relative_path: str) -> Path:
    """Get absolute path to resource, works for dev and for PyInstaller"""

    # Check if this is a data file and if external data directory is set
    if relative_path.startswith("data" + os.sep) or relative_path.startswith("data/"):
        external_data_dir = os.environ.get("ZENTX_DATA_DIR")
        if external_data_dir:
            # For data files, use the external data directory
            data_file = relative_path.replace("data" + os.sep, "").replace("data/", "")
            result_path = Path(external_data_dir) / data_file
            print(f"[main_functions] Data file path resolved: {relative_path} -> {result_path}")
            return result_path

    # For non-data files or when external data dir is not set, use original logic
    if getattr(sys, "frozen", False):
        # If the application is run as a bundle, the PyInstaller bootloader
        # extends the sys module by a flag frozen=True and sets the app
        # path into variable _MEIPASS'.
        base_path = Path(sys._MEIPASS)
    else:
        # In a normal environment, the directory of the main script is being used.
        base_path = Path(__file__).parent.parent

    result_path = base_path / relative_path
    print(f"[main_functions] Resource path resolved: {relative_path} -> {result_path}")
    return result_path


def debug_environment():
    """Debug function to show environment and path information"""
    print("=== main_functions.py DEBUG INFO ===")
    print(f"sys.frozen: {getattr(sys, 'frozen', False)}")
    print(f"sys._MEIPASS: {getattr(sys, '_MEIPASS', 'Not set')}")
    print(f"ZENTX_DATA_DIR: {os.environ.get('ZENTX_DATA_DIR', 'Not set')}")
    print(f"ELECTRON_RESOURCES_PATH: {os.environ.get('ELECTRON_RESOURCES_PATH', 'Not set')}")
    print(f"Current working directory: {os.getcwd()}")
    print(f"Script file location: {__file__}")
    print("=====================================")


def replace_asterisk_references(config: Dict[str, Any], anchors: Dict[str, str]) -> Dict[str, Any]:
    """
    Recursively replace asterisk-prefixed variable references in a nested configuration dictionary.

    Args:
        config: The configuration dictionary to process.
        anchors: A dictionary of anchor variables and their corresponding values.

    Returns:
        [0] (dict): A new configuration dictionary with all asterisk references replaced.
    """

    def replace_in_string(s: str) -> str:
        for key, value in anchors.items():
            s = s.replace(f"*{key}", value)
        return s

    def process_paths(paths: Dict[str, Any]) -> Dict[str, Any]:
        processed_paths = {}
        for key, value in paths.items():
            if isinstance(value, str):
                processed_paths[key] = replace_in_string(value)
            elif isinstance(value, dict):
                processed_paths[key] = process_paths(value)
            elif isinstance(value, list):
                processed_paths[key] = [replace_in_string(item) if isinstance(item, str) else item for item in value]
            else:
                processed_paths[key] = value
        return processed_paths

    processed_config = {}
    for section, data in config.items():
        if isinstance(data, dict):
            processed_config[section] = process_paths(data)
        else:
            processed_config[section] = data

    return processed_config


def load_config(config_path: str, replace_asterisk_vars: bool = True) -> Dict[str, Any]:
    """
    Load and process a YAML configuration file.

    Args:
        config_path: Path to the YAML configuration file.
        replace_asterisk_vars: Flag to replace *variable references in strings.

    Returns:
        [0] (dict): Processed configuration dictionary containing key-value pairs
        from the YAML file, with environment variables and asterisk references
        replaced if specified.
    """
    # Load the YAML file as a string
    with open(config_path, "r") as file:
        yaml_str = file.read()

    # Replace YAML anchors with their corresponding values and get anchor mappings
    yaml_str, anchors = replace_yaml_anchors(yaml_str)

    # Parse the modified YAML string
    config = yaml.safe_load(yaml_str)

    # Replace environment variables
    config = replace_env_vars(config)

    # Replace asterisk variables if enabled
    if replace_asterisk_vars:
        config = replace_asterisk_references(config, anchors)

    return config


def replace_yaml_anchors(yaml_str: str) -> Tuple[str, Dict[str, str]]:
    """
    Replace YAML anchors with their corresponding values in a YAML string.

    Args:
        yaml_str: The input YAML string containing anchors.

    Returns:
        [0] The YAML string with anchor declarations removed.
        [1] A dictionary mapping anchor names to their corresponding values.
    """
    anchor_pattern = re.compile(r"&(\w+)\s+(.*)")

    anchors = {}
    lines = yaml_str.split("\n")

    # First pass: collect anchors
    for i, line in enumerate(lines):
        match = anchor_pattern.search(line)
        if match:
            anchor_name, value = match.groups()
            anchors[anchor_name] = value.strip('"')
            lines[i] = line.replace(f"&{anchor_name} ", "")  # Remove anchor declaration

    return "\n".join(lines), anchors


def replace_env_vars(data: Union[Dict[str, Any], List[Any], str, Any]) -> Union[Dict[str, Any], List[Any], str, Any]:
    """
    Recursively replace environment variables in the input data.

    Args:
        data: The input data to process.

    Returns:
        The processed data with environment variables replaced:
        [0] If input is a dictionary, returns a new dictionary with replaced values.
        [1] If input is a list, returns a new list with replaced values.
        [2] If input is a string, returns the string with environment variables expanded.
        [3] For any other type, returns the input unchanged.
    """
    if isinstance(data, dict):
        return {k: replace_env_vars(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [replace_env_vars(i) for i in data]
    elif isinstance(data, str):
        return os.path.expandvars(data)
    return data


# === CONSTANTS ###
debug_environment()
base_path = get_base_path()
config_file_path = get_resource_path(os.path.join("data", "urban_history.yaml"))
zenodo_config = load_config(config_file_path)

rate_per_hour = zenodo_config["rates"]["per_hour"]
rate_per_min = zenodo_config["rates"]["per_minute"]
rate_limiter_zenodo = RateLimiterParallel(
    rate_per_min, rate_per_hour, db_path=os.path.join(os.environ.get("TMPDIR", "/tmp"), "rate_limiter.db")
)

USE_SANDBOX = zenodo_config["main"]["use_sandbox"]
# USE_SANDBOX = True  # remove and uncomment above line
ZENODO_BASE_URL = "https://sandbox.zenodo.org" if USE_SANDBOX else "https://zenodo.org"
if zenodo_config["main"]["use_env_api_key"]:
    ZENODO_API_KEY = os.environ.get("ZENODO_SANDBOX_API_KEY") if USE_SANDBOX else os.environ.get("ZENODO_API_KEY")
else:
    ZENODO_API_KEY = (
        zenodo_config["preferences"]["zenodo_sandbox_api_key"]
        if USE_SANDBOX
        else zenodo_config["preferences"]["zenodo_api_key"]
    )
HEADERS = {"Content-Type": "application/json"}
PARAMS = {"access_token": ZENODO_API_KEY}


# === MAIN FUNCTIONS ===
def create_record_cli(
    zenodo_metadata: Dict[str, Any], sandbox_mode: bool = True, conn_params: Dict[str, str] = None
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Creates a new record on Zenodo using the provided metadata.

    This function handles the API communication with Zenodo, including
    rate limiting, error handling, and response processing.

    Args:
        zenodo_metadata: A dictionary containing the metadata for the new record
        sandbox_mode: Whether to use Zenodo sandbox environment (default: True)
        conn_params: API connection parameters including access tokens

    Returns:
        A tuple containing:
        - return_msg: Dictionary with status information (success, response code, message, errors)
        - return_data: Dictionary with the created record data or error information
    """
    # Initialize return structures
    return_msg = {"success": False, "response": 0, "text": "", "errors": []}
    return_data = {}

    # Set base URL according to environment
    base_url = "https://sandbox.zenodo.org" if sandbox_mode else "https://zenodo.org"
    endpoint = f"{base_url}/api/deposit/depositions"

    # Set default connection parameters if not provided
    if conn_params is None:
        conn_params = {}

    try:
        # Handle rate limiting
        if "rate_limiter_zenodo" in globals():
            rate_limiter_zenodo.wait_for_rate_limit()

        # Make API request
        response = requests.post(endpoint, params=conn_params, json=zenodo_metadata)

        # Record request for rate limiting
        if "rate_limiter_zenodo" in globals():
            rate_limiter_zenodo.record_request()

        # Process successful response
        if response.status_code == 201:
            return_data = response.json()
            return_msg.update(
                {"success": True, "response": response.status_code, "text": "Zenodo Record created successfully."}
            )
        else:
            # Process error response
            try:
                error_data = response.json()
                errors = []

                # Extract error messages from various possible response structures
                if "errors" in error_data:
                    for error in error_data["errors"]:
                        if isinstance(error, dict) and "message" in error:
                            errors.append(error["message"])
                        else:
                            errors.append(str(error))
                elif "message" in error_data:
                    errors.append(error_data["message"])
                else:
                    errors.append(f"HTTP {response.status_code}: {response.reason}")

                return_msg.update(
                    {"response": response.status_code, "text": "Failed to create Zenodo Record.", "errors": errors}
                )
                return_data = error_data
            except ValueError:
                # Handle non-JSON responses
                return_msg.update(
                    {
                        "response": response.status_code,
                        "text": "Failed to create Zenodo Record.",
                        "errors": [f"HTTP {response.status_code}: {response.text[:100]}..."],
                    }
                )
                return_data = {"error": response.text}

    except requests.exceptions.RequestException as e:
        # Handle network and connection errors
        return_msg["text"] = f"Error creating Zenodo record: {str(e)}"

        if hasattr(e, "response") and e.response is not None:
            return_msg["response"] = e.response.status_code
            try:
                return_data = e.response.json()
            except ValueError:
                return_data = {"error": e.response.text}
        else:
            return_data = {"error": str(e)}

    # Add logging if needed
    if return_msg["success"]:
        logger.info(f"Successfully created Zenodo record {return_data.get('id', 'unknown')}")
    else:
        logger.error(f"Failed to create Zenodo record: {return_msg['text']}")

    return return_msg, return_data


def identify_draft(record_data_ls: List[Dict[str, Any]]) -> Tuple[Dict[str, Union[bool, int, str]], Dict[str, Any]]:
    """
    Identifies a draft record from a list of record data.

    Args:
        record_data_ls: List of dictionaries containing record data.

    Returns:
        [0] return_msg: status message dictionary
        [1] return_data: identified draft data dictionary.
    """
    return_msg = {"success": False, "response": 0, "text": ""}
    return_data = {}
    draft_identified = False
    for data in record_data_ls:
        if not data["submitted"]:
            draft_identified = True
            return_msg["success"] = True
            return_data = data
            break
    if not draft_identified:
        return_msg["response"] = 404
        return_msg["text"] = "No Draft identified in Records."

    return (return_msg, return_data) if draft_identified else (return_msg, {})


def identify_latest_record(
    record_data_ls: List[Dict[str, Any]], ignore_drafts: bool = True
) -> Tuple[Dict[str, Union[bool, int, str]], Dict[str, Any]]:
    """
    Identifies the latest record from a list of record data.

    Args:
        record_data_ls: List of dictionaries containing record data.
        ignore_drafts: Boolean flag to ignore draft records.

    Returns:
        [0] return_msg: status message dictionary
        [1] return_data: latest record data dictionary.
    """
    return_msg = {"success": False, "response": 0, "text": ""}
    return_data = {}
    latest_record = None

    for data in record_data_ls:
        if ignore_drafts and not data["submitted"]:
            continue
        if latest_record is None or data["created"] > latest_record["created"]:
            latest_record = data

    if latest_record:
        return_msg = {"success": True, "response": 200, "text": latest_record["conceptrecid"]}
        return_data = latest_record
    else:
        return_msg["text"] = "No suitable Records provided. Draft pending?"

    return return_msg, return_data


def discard_draft_cli(
    discard_link: str = "",
    concept_recid: str = "",
    conn_params: Optional[Dict[str, Any]] = None,
    # db_connection and record_data are removed as they were only for upsert_operation
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Discards a draft record on Zenodo using either a discard link or concept record ID.
    This version is intended for CLI use and omits direct database upsert operations.

    Args:
        discard_link: URL to discard the draft.
        concept_recid: Concept record ID to identify and discard the draft.
        conn_params: Dictionary containing API connection parameters (e.g., access_token).
                     If None, it might default to a global PARAMS if that's how your system is set up,
                     but explicitly passing it is safer.

    Returns:
        Tuple[Dict[str, Union[bool, int, str]], Dict[str, Any]]:
            - return_msg (dict): Status information about the API operation.
                                 {'success': bool, 'response': int (status_code), 'text': str (response_text)}
            - return_data (dict): Data retrieved from Zenodo, typically latest record data if
                                  discarding via concept_recid, or empty if discarding via link.
    """
    return_msg = {"success": False, "response": 0, "text": ""}
    return_data: Dict[str, Any] = {}

    active_conn_params = conn_params  # Removed default to PARAMS to make it explicit via caller

    if not active_conn_params:
        return_msg["text"] = "Connection parameters not provided."
        return return_msg, return_data

    if discard_link:
        try:
            rate_limiter_zenodo.wait_for_rate_limit()
            r_discard = requests.post(discard_link, params=active_conn_params)
            rate_limiter_zenodo.record_request()

            return_msg["response"] = r_discard.status_code
            return_msg["text"] = r_discard.text
            if r_discard.status_code == 204:  # No content, successful discard
                return_msg["success"] = True
            else:
                return_msg["success"] = False
                try:  # Try to get more detailed error from JSON response
                    error_json = r_discard.json()
                    return_msg["errors"] = error_json.get("errors", [])
                    if "message" in error_json:
                        return_msg["text"] = (
                            f"{error_json.get('status', r_discard.status_code)}: {error_json.get('message', r_discard.text)}"
                        )
                except requests.exceptions.JSONDecodeError:
                    pass  # Keep original text if not JSON
        except requests.exceptions.RequestException as e:
            return_msg["success"] = False
            return_msg["text"] = f"Request failed: {str(e)}"
        except Exception as e:  # Catch other potential errors like rate_limiter issues
            return_msg["success"] = False
            return_msg["text"] = f"An unexpected error occurred: {str(e)}"

    elif concept_recid:
        try:
            # Assuming retrieve_by_concept_recid, identify_draft, identify_latest_record
            # are defined and imported correctly.
            retrieval_msg, retrieval_data = retrieve_by_concept_recid(
                concept_recid=concept_recid, all_versions=True, conn_params=active_conn_params
            )

            if retrieval_msg.get("success") and isinstance(retrieval_data, list):
                print("Retrieval of concept record completed.")
                draft_msg, draft_data = identify_draft(retrieval_data)

                if draft_msg.get("success") and draft_data:
                    print("Draft version identified.")
                    draft_discard_link = draft_data.get("links", {}).get("discard")
                    if draft_discard_link:
                        rate_limiter_zenodo.wait_for_rate_limit()
                        r_discard = requests.post(draft_discard_link, params=active_conn_params)
                        rate_limiter_zenodo.record_request()

                        return_msg["response"] = r_discard.status_code
                        return_msg["text"] = r_discard.text
                        if r_discard.status_code == 204:
                            print("Discard via concept_recid successful.")
                            return_msg["success"] = True
                            # After discarding, the "latest" might be the previous version
                            _, latest_data = identify_latest_record(record_data_ls=retrieval_data, ignore_drafts=True)
                            return_data = latest_data if latest_data else {}
                        else:
                            return_msg["success"] = False
                            try:
                                error_json = r_discard.json()
                                return_msg["errors"] = error_json.get("errors", [])
                                if "message" in error_json:
                                    return_msg["text"] = (
                                        f"{error_json.get('status', r_discard.status_code)}: {error_json.get('message', r_discard.text)}"
                                    )
                            except requests.exceptions.JSONDecodeError:
                                pass
                    else:
                        return_msg["text"] = "Could not find discard link in identified draft."
                else:
                    return_msg["text"] = draft_msg.get(
                        "text", "No draft found for the given concept record ID or draft identification failed."
                    )
            else:
                return_msg["text"] = retrieval_msg.get(
                    "text", "Failed to retrieve record by concept_recid or data format incorrect."
                )
                if "errors" in retrieval_msg:  # Propagate errors if any
                    return_msg["errors"] = retrieval_msg["errors"]

        except requests.exceptions.RequestException as e:
            return_msg["success"] = False
            return_msg["text"] = f"Request failed during concept_recid processing: {str(e)}"
        except Exception as e:  # Catch other potential errors
            return_msg["success"] = False
            return_msg["text"] = f"An unexpected error occurred during concept_recid processing: {str(e)}"
    else:
        return_msg["text"] = "Neither discard_link nor concept_recid was provided."

    return return_msg, return_data


def retrieve_by_concept_recid(
    concept_recid: str, all_versions: bool
) -> Tuple[Dict[str, Union[bool, int, str]], Union[Dict, List[Dict]]]:
    """
    Retrieves Zenodo record(s) based on a concept record ID.

    Args:
        concept_recid: The concept record ID to search for.
        all_versions: If True, retrieves all versions of the record; if False, retrieves only the latest version.

    Returns:
        [0] Dictionary with status information (success, response code, and text).
        [1] The retrieved data as either a single dictionary (latest version) or a list of dictionaries (all versions).

    Note:
        Uses rate limiting when making requests to the Zenodo API.
    """
    return_msg = {"success": False, "response": 0, "text": ""}
    return_data = {}

    query_string = f"conceptrecid:{concept_recid}"
    rate_limiter_zenodo.wait_for_rate_limit()
    r = requests.get(
        f"{ZENODO_BASE_URL}/api/deposit/depositions",
        params={
            **PARAMS,
            "q": query_string,
            "all_versions": all_versions,
        },
        timeout=120,
    )
    rate_limiter_zenodo.record_request()
    return_msg.update({"response": r.status_code, "text": r.text})
    if r.status_code in [200, 201, 202] and r.json():
        return_msg["success"] = True
        return_data = r.json()  # be aware that this is an array of objects if all_versions = True
    else:
        return_msg["success"] = False

    return return_msg, return_data
