# server_app/services/zenodo_api_service.py
import os
from typing import Dict, Any, Tuple
from flask import current_app
from dotenv import load_dotenv
import json
import requests

from ..config import get_resolved_config_path


def get_api_params(is_sandbox: bool) -> Dict[str, str]:
    """
    Retrieves Zenodo API parameters (access token).
    """
    config_data = current_app.config.get("LOADED_CONFIG", {})
    log_messages = []

    # Step 1: Attempt to load .env file if configured
    use_env_file = config_data.get("core", {}).get("use_env_file", False)
    env_file_relative_path = config_data.get("paths", {}).get("env_file")

    if use_env_file and env_file_relative_path:
        env_file_abs_path = get_resolved_config_path(current_app, env_file_relative_path)
        if env_file_abs_path and env_file_abs_path.is_file():
            load_dotenv(dotenv_path=env_file_abs_path, override=True)
            log_messages.append(f"Loaded variables from .env file: {env_file_abs_path}")
        else:
            log_messages.append(f"Warning: .env file configured but not found at '{env_file_abs_path}'.")

    # Step 2: Get key from environment variables
    key_name_in_env = "ZENODO_SANDBOX_API_KEY" if is_sandbox else "ZENODO_API_KEY"
    api_key = os.environ.get(key_name_in_env)

    if api_key and api_key.strip():
        log_messages.append(f"Found API key for '{key_name_in_env}' in environment variables.")
    else:
        # Step 3: Fallback to checking 'api_keys' directly in config.yaml
        log_messages.append(f"API key for '{key_name_in_env}' not in environment. Checking config.yaml.")
        config_api_keys = config_data.get("api_keys", {})
        if isinstance(config_api_keys, dict):
            key_name_in_config_dict = "zenodo_sandbox" if is_sandbox else "zenodo"
            api_key = config_api_keys.get(key_name_in_config_dict)
            if api_key and api_key.strip():
                log_messages.append(f"Found API key for '{key_name_in_config_dict}' in config.yaml.")

    # Log the process for debugging
    current_app.logger.debug(" --- get_api_params ---")
    for msg in log_messages:
        current_app.logger.debug(msg)
    current_app.logger.debug(" ----------------------")

    if not api_key or not api_key.strip():
        error_msg = f"Zenodo API key ('{key_name_in_env}') not found or is empty."
        current_app.logger.error(error_msg)
        raise ValueError(error_msg)

    return {"access_token": api_key.strip()}


def get_base_url(is_sandbox: bool) -> str:
    """Retrieves the Zenodo base URL from the configuration."""
    config_data = current_app.config.get("LOADED_CONFIG", {})
    if not isinstance(config_data.get("urls"), dict):
        current_app.logger.error("URLs not found or config is not properly loaded.")
        raise ValueError("URLs configuration is missing or invalid.")

    if is_sandbox:
        return config_data["urls"].get("sandbox_url", "https://sandbox.zenodo.org")
    else:
        return config_data["urls"].get("base_url", "https://zenodo.org")


def create_new_deposition(is_sandbox: bool, metadata: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    """
    Creates a new, empty deposition record in Zenodo.

    This function correctly formats the payload by wrapping the metadata
    in the required {"metadata": ...} structure.

    Args:
        is_sandbox: Flag to use the Zenodo sandbox environment.
        metadata: The dictionary containing the record's metadata (title, creators, etc.).

    Returns:
        A tuple containing a success boolean and the JSON response from Zenodo.
    """
    try:
        # Get the correct URL and API key using your existing helper functions
        base_url = get_base_url(is_sandbox)
        api_params = get_api_params(is_sandbox)

        url = f"{base_url}/api/deposit/depositions"
        headers = {"Content-Type": "application/json"}

        # This is the critical step: creating the correct payload structure for Zenodo
        payload_to_send = {"metadata": metadata}

        current_app.logger.info(f"Creating new Zenodo deposition (Sandbox: {is_sandbox}) at {url}")
        current_app.logger.debug(f"Payload for new deposition: {json.dumps(payload_to_send, indent=2)}")

        response = requests.post(
            url,
            params=api_params,
            json=payload_to_send,  # Use the correctly wrapped payload
            headers=headers,
            timeout=30,  # Add a reasonable timeout
        )

        # Raise an exception for bad status codes (4xx or 5xx)
        response.raise_for_status()

        response_json = response.json()
        current_app.logger.info(f"Successfully created Zenodo deposition with ID: {response_json.get('id')}")
        return True, response_json

    except requests.exceptions.RequestException as e:
        error_message = (
            f"Failed to create Zenodo deposition. Status: {e.response.status_code if e.response else 'N/A'}"
        )
        current_app.logger.error(error_message)
        if e.response is not None:
            # Return the actual error response from Zenodo for better debugging
            return False, e.response.json()
        return False, {"error": "RequestException", "message": str(e)}

    except Exception as e:
        current_app.logger.error(f"An unexpected error occurred in create_new_deposition: {e}", exc_info=True)
        return False, {"error": "UnexpectedError", "message": str(e)}
