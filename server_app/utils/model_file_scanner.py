# server_app/utils/model_file_scanner.py

import json
import logging
import re
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

from ..utils.file_helpers import calculate_file_hash

logger = logging.getLogger(__name__)

# ============================================================================
# PUBLIC API
# ============================================================================


def find_associated_files(source_file: Path, scan_options: Dict[str, Any]) -> Dict[str, Any]:
    """
    Finds and structures associated files for a given source file based on scan options.
    Now supports multiple 3D file formats: OBJ, GLB, GLTF, FBX, and generic files.

    Args:
        source_file: The Path object for the source file.
        scan_options: The user-defined options from the wizard.

    Returns:
        A dictionary representing the file and its hierarchical children.
    """
    file_ext = source_file.suffix.lower()

    # Route to format-specific handler
    if file_ext == ".obj":
        return _handle_obj_file(source_file, scan_options)
    elif file_ext == ".glb":
        return _handle_glb_file(source_file, scan_options)
    elif file_ext == ".gltf":
        return _handle_gltf_file(source_file, scan_options)
    elif file_ext == ".fbx":
        return _handle_fbx_file(source_file, scan_options)
    else:
        return _handle_generic_file(source_file, scan_options)


# ============================================================================
# FORMAT-SPECIFIC HANDLERS
# ============================================================================


def _handle_obj_file(obj_path: Path, scan_options: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handles OBJ files with MTL and texture dependencies.
    This is the original implementation with improved structure.
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

    # Find associated MTL file(s)
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


def _handle_glb_file(glb_path: Path, scan_options: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handles GLB (Binary glTF) files.
    GLB files are self-contained with embedded textures and materials.
    No external dependencies need to be scanned.
    """
    return {
        "name": glb_path.name,
        "path": str(glb_path.resolve()),
        "type": "source",
        "status": "Pending",
        "children": [],
        "format_info": {
            "format": "GLB",
            "self_contained": True,
            "description": "Binary glTF format with embedded assets",
        },
    }


def _handle_gltf_file(gltf_path: Path, scan_options: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handles GLTF (Text glTF) files.
    GLTF files may reference external textures, buffers, and bin files.
    """
    obj_options = scan_options.get("obj_options", {})

    gltf_file_data = {
        "name": gltf_path.name,
        "path": str(gltf_path.resolve()),
        "type": "source",
        "status": "Pending",
        "children": [],
        "format_info": {"format": "GLTF", "self_contained": False},
    }

    # Only scan for dependencies if add_textures is enabled
    if not obj_options.get("add_textures"):
        return gltf_file_data

    # Parse GLTF JSON to find external references
    external_files, missing_files = _find_gltf_external_files(gltf_path, obj_options.get("texture_search_paths", []))

    for ext_file in external_files:
        file_type = _categorize_gltf_file(ext_file)
        gltf_file_data["children"].append(
            {
                "name": ext_file.name,
                "path": str(ext_file.resolve()),
                "type": file_type,
                "status": "Pending",
                "children": [],
            }
        )

    if missing_files:
        gltf_file_data["missing_textures"] = missing_files

    return gltf_file_data


def _handle_fbx_file(fbx_path: Path, scan_options: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handles FBX files.
    FBX files may have embedded textures or reference external texture folders.
    We look for common patterns: textures/, Materials/, or same-name folders.
    """
    obj_options = scan_options.get("obj_options", {})

    fbx_file_data = {
        "name": fbx_path.name,
        "path": str(fbx_path.resolve()),
        "type": "source",
        "status": "Pending",
        "children": [],
        "format_info": {"format": "FBX", "note": "May contain embedded or external textures"},
    }

    if not obj_options.get("add_textures"):
        return fbx_file_data

    # Search for texture files in common locations
    texture_files = _find_fbx_texture_files(fbx_path, obj_options.get("texture_search_paths", []))

    for tex_file in texture_files:
        fbx_file_data["children"].append(
            {
                "name": tex_file.name,
                "path": str(tex_file.resolve()),
                "type": "secondary",
                "status": "Pending",
                "children": [],
            }
        )

    return fbx_file_data


def _handle_generic_file(file_path: Path, scan_options: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handles generic files (e.g., PLY, STL, DAE, etc.).
    No dependency scanning is performed for unknown formats.
    """
    return {
        "name": file_path.name,
        "path": str(file_path.resolve()),
        "type": "source",
        "status": "Pending",
        "children": [],
        "format_info": {
            "format": file_path.suffix.upper().lstrip("."),
            "note": "Generic 3D format - no dependency scanning",
        },
    }


# ============================================================================
# OBJ-SPECIFIC HELPERS
# ============================================================================


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
    except Exception as e:
        logger.warning(f"Error reading OBJ file {obj_path}: {e}")

    return found_mtl_paths


def _find_texture_files_for_mtl(mtl_path: Path, search_dirs: List[str]) -> Tuple[List[Path], List[str], List[Dict]]:
    """
    Reads an MTL file, finds all texture references, and locates them on disk.

    Returns:
        - A list of resolved, valid texture file paths.
        - A list of texture filenames that were referenced but not found.
        - A list of conflict dictionaries for unresolved duplicates.
    """
    referenced_textures = {}
    found_paths = {}
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
    except Exception as e:
        logger.warning(f"Error reading MTL file {mtl_path}: {e}")
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
        else:
            # Hashes are identical, resolve by size
            best_candidate = max(candidate_paths, key=lambda p: p.stat().st_size)
            found_paths[filename] = best_candidate

    found_filenames = set(found_paths.keys())
    missing_filenames = sorted(list(set(referenced_textures.keys()) - found_filenames))

    return sorted(list(found_paths.values())), missing_filenames, conflicts


# ============================================================================
# GLTF-SPECIFIC HELPERS
# ============================================================================


def _find_gltf_external_files(gltf_path: Path, search_dirs: List[str]) -> Tuple[List[Path], List[str]]:
    """
    Parses a GLTF JSON file to find external file references.

    Returns:
        - List of found external file paths
        - List of missing file names
    """
    found_files = []
    missing_files = []

    try:
        with open(gltf_path, "r", encoding="utf-8") as f:
            gltf_data = json.load(f)

        referenced_files = set()

        # Extract image references
        if "images" in gltf_data:
            for image in gltf_data["images"]:
                if "uri" in image:
                    referenced_files.add(image["uri"])

        # Extract buffer references
        if "buffers" in gltf_data:
            for buffer in gltf_data["buffers"]:
                if "uri" in buffer:
                    referenced_files.add(buffer["uri"])

        # Resolve each referenced file
        for ref_file in referenced_files:
            # Skip data URIs
            if ref_file.startswith("data:"):
                continue

            # Try relative path first
            potential_path = (gltf_path.parent / ref_file).resolve()
            if potential_path.is_file():
                found_files.append(potential_path)
                continue

            # Search in provided directories
            found = False
            for dir_str in search_dirs:
                search_dir = Path(dir_str)
                if search_dir.is_dir():
                    candidates = list(search_dir.rglob(Path(ref_file).name))
                    if candidates:
                        found_files.append(candidates[0])
                        found = True
                        break

            if not found:
                missing_files.append(ref_file)

    except Exception as e:
        logger.warning(f"Error parsing GLTF file {gltf_path}: {e}")

    return found_files, missing_files


def _categorize_gltf_file(file_path: Path) -> str:
    """Categorize GLTF external files by type."""
    ext = file_path.suffix.lower()

    # Image files are secondary
    if ext in [".png", ".jpg", ".jpeg", ".webp", ".ktx", ".ktx2"]:
        return "secondary"

    # Binary buffers are primary dependencies
    if ext == ".bin":
        return "primary"

    return "secondary"


# ============================================================================
# FBX-SPECIFIC HELPERS
# ============================================================================


def _find_fbx_texture_files(fbx_path: Path, search_dirs: List[str]) -> List[Path]:
    """
    Find texture files associated with an FBX file.
    Looks in common locations: textures/, Materials/, same-name folder.
    """
    texture_files = []
    texture_extensions = {".png", ".jpg", ".jpeg", ".tga", ".tif", ".tiff", ".bmp", ".dds"}

    # Common texture folder names
    common_folders = ["textures", "Textures", "Materials", "materials", fbx_path.stem]

    # 1. Check common folders relative to FBX location
    for folder_name in common_folders:
        texture_folder = fbx_path.parent / folder_name
        if texture_folder.is_dir():
            for tex_file in texture_folder.iterdir():
                if tex_file.is_file() and tex_file.suffix.lower() in texture_extensions:
                    texture_files.append(tex_file)

    # 2. Check search directories if provided
    for dir_str in search_dirs:
        search_dir = Path(dir_str)
        if search_dir.is_dir():
            for tex_file in search_dir.rglob("*"):
                if tex_file.is_file() and tex_file.suffix.lower() in texture_extensions:
                    # Avoid duplicates
                    if tex_file not in texture_files:
                        texture_files.append(tex_file)

    return texture_files
