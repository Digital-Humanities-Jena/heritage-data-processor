# server_app/utils/model_file_scanner.py
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

from ..utils.file_helpers import calculate_file_hash


def find_associated_files(obj_path: Path, scan_options: Dict[str, Any]) -> Dict[str, Any]:
    """
    Finds and structures associated files for a given OBJ file based on scan options.

    Args:
        obj_path: The Path object for the source .obj file.
        scan_options: The user-defined options from the wizard.

    Returns:
        A dictionary representing the file and its hierarchical children.
    """
    obj_options = scan_options.get("obj_options", {})
    obj_file_data = {
        "name": obj_path.name,
        "path": str(obj_path.resolve()),
        "type": "source",
        "status": "Pending",
        "children": [],
    }

    if not obj_options.get("add_mtl"):
        return obj_file_data

    # 1. Find associated MTL file(s)
    mtl_paths = _find_mtl_files_for_obj(obj_path)
    if not mtl_paths:
        return obj_file_data

    for mtl_path in mtl_paths:
        found_textures, missing_textures, conflicts = ([], [], [])
        if obj_options.get("add_textures"):
            found_textures, missing_textures, conflicts = _find_texture_files_for_mtl(
                mtl_path, obj_options.get("texture_search_paths", [])
            )

        mtl_file_data = {
            "name": mtl_path.name,
            "path": str(mtl_path.resolve()),
            "type": "primary",
            "status": "Pending",
            "children": [],
            "missing_textures": missing_textures,
            "conflicts": conflicts,
        }

        for tex_path in found_textures:
            mtl_file_data["children"].append(
                {
                    "name": tex_path.name,
                    "path": str(tex_path.resolve()),
                    "type": "secondary",
                    "status": "Pending",
                    "children": [],
                }
            )

        obj_file_data["children"].append(mtl_file_data)

    return obj_file_data


def _find_mtl_files_for_obj(obj_path: Path) -> List[Path]:
    """Reads an OBJ file and returns full paths to existing MTL files it references."""
    found_mtl_paths = []
    try:
        with open(obj_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.strip().startswith("mtllib"):
                    mtl_filename = line.strip().split(None, 1)[1]
                    # Assume MTL file is in the same directory as the OBJ
                    potential_path = obj_path.parent / mtl_filename
                    if potential_path.is_file():
                        found_mtl_paths.append(potential_path)
    except Exception:
        pass
    return found_mtl_paths


def _find_texture_files_for_mtl(mtl_path: Path, search_dirs: List[str]) -> tuple[List[Path], List[str], List[Dict]]:
    """
    Reads an MTL file, finds all texture references, and locates them on disk with advanced logic.
    1. Prioritizes relative paths as described in the MTL.
    2. Falls back to recursive search in specified directories.
    3. Handles duplicates by comparing file hashes and sizes.
    Returns:
        - A list of resolved, valid texture file paths.
        - A list of texture filenames that were referenced but not found.
        - A list of conflict dictionaries for unresolved duplicates.
    """
    referenced_textures = {}  # Use a dict to store path info: { "texture.png": "textures/texture.png" }
    found_paths = {}  # { "texture.png": Path(...) }
    conflicts = []

    texture_map_pattern = re.compile(r"^\s*(map_[a-zA-Z_]+|bump|refl)\s+(.*)")

    try:
        with open(mtl_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                match = texture_map_pattern.match(line)
                if match:
                    full_reference = match.group(2).strip().split()[-1]
                    filename = Path(full_reference).name
                    referenced_textures[filename] = full_reference
    except Exception:
        return [], [], []

    for filename, full_reference in referenced_textures.items():
        # 1. Prioritized Search: Check relative path first
        prioritized_path = (mtl_path.parent / full_reference).resolve()
        if prioritized_path.is_file():
            found_paths[filename] = prioritized_path
            continue

        # 2. Fallback Search: Recursively scan search directories
        candidate_paths = []
        for dir_str in search_dirs:
            search_dir = Path(dir_str)
            if search_dir.is_dir():
                candidate_paths.extend(list(search_dir.rglob(filename)))

        if not candidate_paths:
            continue

        if len(candidate_paths) == 1:
            found_paths[filename] = candidate_paths[0]
            continue

        # 3. Handle Duplicates
        hashes = {p: calculate_file_hash(p) for p in candidate_paths}
        unique_hashes = set(hashes.values())

        if len(unique_hashes) > 1:
            conflicts.append(
                {
                    "filename": filename,
                    "message": "Multiple files found with different content (hashes do not match).",
                    "candidates": [str(p) for p in candidate_paths],
                }
            )
        else:  # Hashes are identical, resolve by size
            best_candidate = max(candidate_paths, key=lambda p: p.stat().st_size)
            found_paths[filename] = best_candidate

    found_filenames = set(found_paths.keys())
    missing_filenames = sorted(list(set(referenced_textures.keys()) - found_filenames))

    return sorted(list(found_paths.values())), missing_filenames, conflicts
