# server_app/utils/file_helpers.py
import hashlib
import logging
import mimetypes
import shutil
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


def calculate_file_hash(file_path: Path, hash_algo: str = "sha256") -> Optional[str]:
    """
    Calculates the hash of a file.

    Args:
        file_path: The path to the file.
        hash_algo: The hashing algorithm to use (e.g., 'sha256', 'md5').

    Returns:
        The hex digest of the file hash, or None if an error occurs.
    """
    try:
        hasher = hashlib.new(hash_algo)
        buffer_size = 65536  # 64KB chunks

        with open(file_path, "rb") as f:
            while True:
                data = f.read(buffer_size)
                if not data:
                    break
                hasher.update(data)
        return hasher.hexdigest()
    except FileNotFoundError:
        logger.error(f"File not found for hashing: {file_path}")
        return None
    except Exception as e:
        logger.error(f"Error calculating hash for {file_path}: {e}", exc_info=True)
        return None


def get_file_mime_type(file_path: Path) -> Optional[str]:
    """
    Guesses the MIME type of a file.

    Args:
        file_path: The path to the file.

    Returns:
        The guessed MIME type string, or None if it cannot be determined.
    """
    mime_type, _ = mimetypes.guess_type(file_path.as_uri())
    return mime_type


def _files_are_identical(path1: Path, path2: Path) -> bool:
    """
    Compares two files for identical content by checking their SHA256 hashes.
    Internal helper function for smart_copy_file.
    """
    # Quick check: if sizes are different, they can't be identical.
    if path1.stat().st_size != path2.stat().st_size:
        return False

    hash1 = calculate_file_hash(path1)
    hash2 = calculate_file_hash(path2)

    return hash1 is not None and hash1 == hash2


def smart_copy_file(source_path: Path, dest_path: Path) -> Dict[str, Any]:
    """
    Intelligently copies a file, checking for existence and content identity
    before performing the operation.
    """
    try:
        if not source_path.exists():
            return {"success": False, "action": "error", "message": f"Source file not found: {source_path}"}

        dest_path.parent.mkdir(parents=True, exist_ok=True)

        if dest_path.exists():
            if _files_are_identical(source_path, dest_path):
                return {
                    "success": True,
                    "action": "skipped",
                    "message": "Identical file already exists at destination.",
                }
            else:
                shutil.copy2(source_path, dest_path)
                return {
                    "success": True,
                    "action": "overwritten",
                    "message": f"Overwrote existing file at {dest_path}.",
                }
        else:
            shutil.copy2(source_path, dest_path)
            return {"success": True, "action": "copied", "message": f"File copied to {dest_path}."}

    except Exception as e:
        logger.error(f"Smart copy failed from {source_path} to {dest_path}: {e}", exc_info=True)
        return {"success": False, "action": "error", "message": f"An unexpected error occurred: {e}"}
