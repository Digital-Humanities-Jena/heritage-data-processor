# server_app/utils/file_helpers.py
import hashlib
import logging
import mimetypes
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

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


def _extract_bundling_key(filename: str, bundling_config: Dict[str, Any]) -> Optional[str]:
    """
    Extract a bundling key from a filename based on the bundling strategy.
    Supports stem extraction as a variable for dynamic grouping.

    Args:
        filename: The filename to process
        bundling_config: Dictionary containing bundling strategy and parameters

    Returns:
        A bundling key (str) if matched, None otherwise
    """
    strategy = bundling_config.get("strategy", "stem")
    stem = Path(filename).stem

    if strategy == "stem":
        # Original behavior: use file stem as key
        return stem

    elif strategy == "pattern":
        pattern_str = bundling_config.get("pattern", "")
        if not pattern_str:
            return None

        # Try regex matching with capture groups
        try:
            pattern = re.compile(pattern_str)
            match = pattern.search(stem)
            if match:
                # If there are capture groups, use the first one as the key
                if match.groups():
                    return match.group(1)
                # Otherwise use the entire match
                return match.group(0)
        except re.error:
            # If regex fails, treat as substring
            if pattern_str in stem:
                return pattern_str

        return None

    elif strategy == "prefix_suffix":
        prefix = bundling_config.get("prefix", "")
        suffix = bundling_config.get("suffix", "")
        use_stem_variable = bundling_config.get("use_stem_variable", False)

        if use_stem_variable:
            # Enhanced mode: Extract the core identifier between prefix and suffix
            return _extract_core_identifier(stem, prefix, suffix)
        else:
            # Original mode: Use the combination as key
            key_parts = []

            if prefix and stem.startswith(prefix):
                key_parts.append(prefix)

            if suffix and stem.endswith(suffix):
                start_idx = len(prefix) if prefix and stem.startswith(prefix) else 0
                end_idx = len(stem) - len(suffix) if suffix and stem.endswith(suffix) else len(stem)
                middle_part = stem[start_idx:end_idx]

                if middle_part:
                    key_parts.append(middle_part)
                key_parts.append(suffix)
            elif prefix and stem.startswith(prefix):
                key_parts.append(stem[len(prefix) :])
            elif suffix and stem.endswith(suffix):
                key_parts.append(stem[: -len(suffix)])

            if key_parts:
                return "_".join(key_parts) if len(key_parts) > 1 else key_parts[0]

        return None

    elif strategy == "core_identifier":
        # New strategy: Extract a core identifier that may have variable prefixes/suffixes
        core_pattern = bundling_config.get("core_pattern", "")
        if not core_pattern:
            return None

        # Try to find the core pattern in the stem
        try:
            pattern = re.compile(core_pattern)
            match = pattern.search(stem)
            if match:
                # Use the matched core as the bundle key
                if match.groups():
                    return match.group(1)
                return match.group(0)
        except re.error:
            # Fallback to substring
            if core_pattern in stem:
                return core_pattern

        return None

    # Default fallback
    return stem


def _extract_core_identifier(stem: str, prefix: str, suffix: str) -> Optional[str]:
    """
    Extract the core identifier from a stem by removing variable prefixes and suffixes.

    Examples:
        stem="n38_model_one", prefix="n\\d+_", suffix="" → "model_one"
        stem="model_one_hiTex", prefix="", suffix="_\\w+" → "model_one"
        stem="model_one", prefix="", suffix="" → "model_one"

    Args:
        stem: The file stem to process
        prefix: Regex pattern for prefix to remove (empty string means no prefix)
        suffix: Regex pattern for suffix to remove (empty string means no suffix)

    Returns:
        The core identifier, or None if extraction fails
    """
    working_stem = stem

    # Remove prefix if specified
    if prefix:
        try:
            # Ensure the pattern matches from the start
            prefix_pattern = f"^{prefix}"
            match = re.match(prefix_pattern, working_stem)
            if match:
                working_stem = working_stem[len(match.group(0)) :]
        except re.error:
            # If regex fails, try literal prefix removal
            if working_stem.startswith(prefix):
                working_stem = working_stem[len(prefix) :]

    # Remove suffix if specified
    if suffix:
        try:
            # Ensure the pattern matches at the end
            suffix_pattern = f"{suffix}$"
            match = re.search(suffix_pattern, working_stem)
            if match:
                working_stem = working_stem[: match.start()]
        except re.error:
            # If regex fails, try literal suffix removal
            if working_stem.endswith(suffix):
                working_stem = working_stem[: -len(suffix)]

    return working_stem if working_stem else None


def _group_files_with_bundling(file_paths: List[Path], bundling_config: Dict[str, Any]) -> Dict[str, List[Path]]:
    """
    Group files based on bundling configuration.

    Args:
        file_paths: List of file paths to group
        bundling_config: Bundling configuration dictionary

    Returns:
        Dictionary mapping bundle keys to lists of file paths
    """
    file_groups = {}

    for file_p in file_paths:
        group_key = _extract_bundling_key(file_p.name, bundling_config)
        if group_key:
            file_groups.setdefault(group_key, []).append(file_p)
        else:
            # If no key extracted, treat as individual file
            file_groups[str(file_p)] = [file_p]

    return file_groups


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
