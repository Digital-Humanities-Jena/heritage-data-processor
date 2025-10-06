# server_app/utils/file_validator.py
import json
import logging
import re
import struct
import zipfile
from pathlib import Path
from typing import Any, Dict

import magic
import PyPDF2
from PIL import Image

logger = logging.getLogger(__name__)


class FileValidator:
    """
    A utility class to validate files based on the logic from the
    FileIntegrityProcessor HDP component, with enhanced 3D model validation
    for OBJ, MTL, GLB, GLTF, FBX, and other formats.
    """

    def __init__(self):
        try:
            self.mime_detector = magic.Magic(mime=True)
        except magic.MagicException as e:
            logger.warning(f"Could not initialize python-magic. MIME detection will be limited. Error: {e}")
            self.mime_detector = None

    def validate(self, filepath: Path) -> Dict[str, Any]:
        """
        Validates a single file and returns a report.

        Args:
            filepath: Path to the file to validate

        Returns:
            Dictionary containing validation results with keys:
                - file_path: str
                - is_valid: bool
                - errors: list of str
                - details: dict with format-specific information
        """
        report = {"file_path": str(filepath), "is_valid": True, "errors": [], "details": {}}

        if not filepath.exists():
            report["is_valid"] = False
            report["errors"].append("File does not exist at the specified path.")
            return report

        try:
            # Determine file type, giving priority to specific 3D model extensions
            file_ext = filepath.suffix.lower()
            mime_type = (
                self.mime_detector.from_file(str(filepath)) if self.mime_detector else "application/octet-stream"
            )

            # Override mime type for known formats based on file extension
            # This ensures correct routing regardless of MIME detection
            if file_ext == ".obj":
                mime_type = "model/obj"
            elif file_ext == ".mtl":
                mime_type = "model/mtl"
            elif file_ext == ".glb":
                mime_type = "model/gltf-binary"
            elif file_ext == ".gltf":
                mime_type = "model/gltf+json"
            elif file_ext == ".fbx":
                mime_type = "model/fbx"
            elif file_ext == ".zip":
                mime_type = "application/zip"
            elif file_ext == ".bin":
                mime_type = "application/octet-stream+bin"  # Special marker for BIN files
            elif file_ext in [".stl", ".ply", ".dae", ".usdz", ".usd"]:
                mime_type = "model/3d-generic"
            elif file_ext in [".tga", ".dds", ".ktx", ".ktx2"]:
                mime_type = "image/texture"

            report["details"]["mime_type"] = mime_type
            report["details"]["file_extension"] = file_ext

            # Route to the correct validation method
            if mime_type == "model/obj":
                self._validate_obj(filepath, report)
            elif mime_type == "model/mtl":
                self._validate_mtl(filepath, report)
            elif mime_type == "model/gltf-binary":
                self._validate_glb(filepath, report)
            elif mime_type == "model/gltf+json":
                self._validate_gltf(filepath, report)
            elif mime_type == "model/fbx":
                self._validate_fbx(filepath, report)
            elif mime_type == "application/zip":
                self._validate_zip(filepath, report)
            elif mime_type == "application/octet-stream+bin":
                self._validate_bin(filepath, report)
            elif mime_type == "model/3d-generic":
                self._validate_3d_generic(filepath, report)
            elif mime_type == "image/texture":
                self._validate_image(filepath, report)  # Enhanced to handle special textures
            elif mime_type.startswith("image"):
                self._validate_image(filepath, report)
            elif mime_type == "application/pdf":
                self._validate_pdf(filepath, report)
            elif mime_type == "application/json":
                self._validate_json(filepath, report)
            else:
                self._validate_generic(filepath, report)

        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"An unexpected validation error occurred: {str(e)}")
            logger.error(f"Validation error for {filepath}: {e}", exc_info=True)

        return report

    def validate_by_format(self, file_path: Path) -> Dict[str, Any]:
        """
        Perform format-specific validation with enhanced details.
        This is an alias for validate() for backward compatibility.

        Args:
            file_path: Path to the file to validate

        Returns:
            Dictionary with validation results
        """
        return self.validate(file_path)

    # ========================================================================
    # 3D MODEL VALIDATION METHODS
    # ========================================================================

    def _validate_obj(self, filepath: Path, report: Dict[str, Any]):
        """Performs a lightweight integrity check on an .obj file."""
        details = {
            "format": "Wavefront OBJ",
            "geometric_vertices_(v)": 0,
            "texture_vertices_(vt)": 0,
            "vertex_normals_(vn)": 0,
            "faces_(f)": 0,
            "material_libraries_(mtllib)": 0,
            "material_usage_(usemtl)": 0,
        }

        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    parts = line.strip().split()
                    if not parts:
                        continue

                    command = parts[0]
                    if command == "v":
                        details["geometric_vertices_(v)"] += 1
                    elif command == "vt":
                        details["texture_vertices_(vt)"] += 1
                    elif command == "vn":
                        details["vertex_normals_(vn)"] += 1
                    elif command == "f":
                        details["faces_(f)"] += 1
                    elif command == "mtllib":
                        details["material_libraries_(mtllib)"] += 1
                    elif command == "usemtl":
                        details["material_usage_(usemtl)"] += 1

            # Validation checks
            if details["geometric_vertices_(v)"] == 0 and details["faces_(f)"] == 0:
                report["is_valid"] = False
                report["errors"].append(
                    "File does not contain any vertex or face data, which is highly unusual for an OBJ file."
                )

            report["details"].update(details)

        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Could not read OBJ file: {str(e)}")

    def _validate_mtl(self, filepath: Path, report: Dict[str, Any]):
        """Performs a lightweight integrity check on a .mtl file."""
        details = {
            "format": "Wavefront Material",
            "defined_materials_(newmtl)": 0,
            "texture_maps_(map_*)": 0,
        }

        texture_map_pattern = re.compile(r"^\s*(map_|bump|refl)")

        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    clean_line = line.strip()
                    if clean_line.startswith("newmtl"):
                        details["defined_materials_(newmtl)"] += 1
                    elif texture_map_pattern.match(clean_line):
                        details["texture_maps_(map_*)"] += 1

            # Validation checks
            if details["defined_materials_(newmtl)"] == 0:
                report["is_valid"] = False
                report["errors"].append("File does not define any materials using the 'newmtl' keyword.")

            report["details"].update(details)

        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Could not read MTL file: {str(e)}")

    def _validate_glb(self, filepath: Path, report: Dict[str, Any]):
        """Validates GLB (Binary glTF) file structure."""
        details = {
            "format": "GLB (Binary glTF)",
            "self_contained": True,
        }

        try:
            with open(filepath, "rb") as f:
                # Read GLB header (12 bytes)
                magic = f.read(4)

                if magic != b"glTF":
                    report["is_valid"] = False
                    report["errors"].append("Invalid GLB magic header (expected 'glTF')")
                    return

                version = struct.unpack("<I", f.read(4))[0]
                length = struct.unpack("<I", f.read(4))[0]

                details["version"] = version
                details["file_length"] = length
                details["actual_size"] = filepath.stat().st_size

                # Validate version
                if version not in [1, 2]:
                    report["errors"].append(f"Unsupported glTF version: {version}")

                # Validate file size consistency
                if length != filepath.stat().st_size:
                    report["errors"].append(
                        f"File size mismatch: header says {length} bytes, actual size is {filepath.stat().st_size}"
                    )

                report["details"].update(details)

        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Could not validate GLB file: {str(e)}")

    def _validate_gltf(self, filepath: Path, report: Dict[str, Any]):
        """Validates GLTF (Text glTF) JSON structure."""
        details = {
            "format": "GLTF (Text glTF)",
            "self_contained": False,
        }

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                gltf_data = json.load(f)

            # Check required fields per glTF spec
            if "asset" not in gltf_data:
                report["is_valid"] = False
                report["errors"].append("Missing required 'asset' field in glTF JSON")
                return

            asset = gltf_data.get("asset", {})
            details["version"] = asset.get("version", "unknown")
            details["generator"] = asset.get("generator", "unknown")

            # Check for external references
            has_external_images = False
            has_external_buffers = False

            if "images" in gltf_data:
                for image in gltf_data["images"]:
                    if "uri" in image and not image["uri"].startswith("data:"):
                        has_external_images = True
                        break

            if "buffers" in gltf_data:
                for buffer in gltf_data["buffers"]:
                    if "uri" in buffer and not buffer["uri"].startswith("data:"):
                        has_external_buffers = True
                        break

            details["has_external_images"] = has_external_images
            details["has_external_buffers"] = has_external_buffers
            details["mesh_count"] = len(gltf_data.get("meshes", []))
            details["node_count"] = len(gltf_data.get("nodes", []))
            details["material_count"] = len(gltf_data.get("materials", []))

            # Validate version
            version = details["version"]
            if version not in ["2.0", "1.0"]:
                report["errors"].append(f"Unsupported or unknown glTF version: {version}")

            report["details"].update(details)

        except json.JSONDecodeError as e:
            report["is_valid"] = False
            report["errors"].append(f"Invalid JSON syntax in GLTF file: {str(e)}")
        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Could not validate GLTF file: {str(e)}")

    def _validate_fbx(self, filepath: Path, report: Dict[str, Any]):
        """Basic FBX file validation."""
        details = {
            "format": "Autodesk FBX",
        }

        try:
            with open(filepath, "rb") as f:
                header = f.read(27)

                # Check for binary FBX signature
                if b"Kaydara FBX Binary" in header:
                    details["format_type"] = "binary"

                    # Read version (bytes 23-26, little-endian int)
                    if len(header) >= 27:
                        version = struct.unpack("<I", header[23:27])[0]
                        details["version"] = version
                        details["version_string"] = f"{version // 1000}.{(version % 1000) // 100}.{version % 100}"

                # Check for ASCII FBX
                elif b"FBX" in header[:20] or header[:3] == b"; F":
                    details["format_type"] = "ascii"
                    report["errors"].append("ASCII FBX format detected - binary format is recommended for reliability")

                else:
                    report["is_valid"] = False
                    report["errors"].append("Unrecognized FBX format or corrupted file")
                    return

            report["details"].update(details)

        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Could not validate FBX file: {str(e)}")

    def _validate_3d_generic(self, filepath: Path, report: Dict[str, Any]):
        """Generic 3D model validation for STL, PLY, DAE, etc."""
        file_ext = filepath.suffix.lower()
        details = {"format": file_ext.upper().lstrip(".")}

        format_signatures = {
            ".stl": b"solid",  # ASCII STL
            ".ply": b"ply",
            ".dae": b"<?xml",  # COLLADA is XML
        }

        try:
            with open(filepath, "rb") as f:
                header = f.read(256)

            if file_ext in format_signatures:
                if not header.startswith(format_signatures[file_ext]):
                    # STL could be binary
                    if file_ext == ".stl" and len(header) >= 84:
                        details["format_type"] = "binary"
                    else:
                        report["errors"].append(f"File does not match expected {file_ext.upper()} format")

            report["details"].update(details)
        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Cannot validate 3D model: {str(e)}")

    # ========================================================================
    # GENERIC FILE VALIDATION METHODS
    # ========================================================================

    def _validate_image(self, filepath: Path, report: Dict[str, Any]):
        """Validates image files using PIL."""
        file_ext = filepath.suffix.lower()

        # Special handling for formats PIL may not fully support
        if file_ext in [".tga", ".dds", ".ktx", ".ktx2"]:
            report["details"]["format"] = file_ext.upper().lstrip(".")
            report["details"]["note"] = "Specialized texture format - basic validation only"

            # Basic file integrity check
            try:
                with open(filepath, "rb") as f:
                    header = f.read(128)
                    if len(header) < 12:
                        report["is_valid"] = False
                        report["errors"].append("File too small to be a valid texture")
            except Exception as e:
                report["is_valid"] = False
                report["errors"].append(f"Cannot read texture file: {str(e)}")
            return

        try:
            # First verify
            with Image.open(filepath) as img:
                img.verify()

            # Open again to get details (verify() invalidates the image)
            with Image.open(filepath) as img:
                report["details"]["format"] = img.format
                report["details"]["size"] = f"{img.width}x{img.height}"
                report["details"]["mode"] = img.mode

                # Check for common issues
                if img.width == 0 or img.height == 0:
                    report["is_valid"] = False
                    report["errors"].append("Image has zero dimensions")
                elif img.width > 50000 or img.height > 50000:
                    report["errors"].append("Image dimensions unusually large - may cause memory issues")

        except Image.UnidentifiedImageError:
            report["is_valid"] = False
            report["errors"].append("Cannot identify image format")
        except OSError as e:
            report["is_valid"] = False
            report["errors"].append(f"Cannot open image file: {str(e)}")
        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Invalid image file: {str(e)}")
            logger.error(f"Image validation error for {filepath}: {e}", exc_info=True)

    def _validate_pdf(self, filepath: Path, report: Dict[str, Any]):
        """Validates PDF files."""
        try:
            with open(filepath, "rb") as f:
                reader = PyPDF2.PdfReader(f, strict=False)
                report["details"]["pages"] = len(reader.pages)

                if reader.is_encrypted:
                    report["details"]["encrypted"] = True
                    report["errors"].append("PDF is encrypted")

        except PyPDF2.errors.PdfReadError as e:
            report["is_valid"] = False
            report["errors"].append(f"Invalid or corrupt PDF file: {str(e)}")
            logger.error(f"PDF validation failed for {filepath}: {e}", exc_info=False)
        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Unexpected error validating PDF: {str(e)}")
            logger.error(f"PDF validation error for {filepath}: {e}", exc_info=True)

    def _validate_json(self, filepath: Path, report: Dict[str, Any]):
        """Validates JSON files."""
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                json.load(f)
            report["details"]["format"] = "JSON syntax is valid."

        except json.JSONDecodeError as e:
            report["is_valid"] = False
            report["errors"].append(f"Invalid JSON syntax: {str(e)}")
        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Could not read JSON file: {str(e)}")

    def _validate_zip(self, filepath: Path, report: Dict[str, Any]):
        """Validates ZIP archive integrity."""
        details = {"format": "ZIP Archive"}

        try:
            with zipfile.ZipFile(filepath, "r") as zf:
                # Test the ZIP file integrity
                bad_file = zf.testzip()

                if bad_file is not None:
                    report["is_valid"] = False
                    report["errors"].append(f"Corrupted file in archive: {bad_file}")

                # Get archive statistics
                file_list = zf.namelist()
                details["file_count"] = len(file_list)
                details["compressed_size"] = sum(info.compress_size for info in zf.filelist)
                details["uncompressed_size"] = sum(info.file_size for info in zf.filelist)
                details["compression_ratio"] = (
                    f"{(1 - details['compressed_size'] / details['uncompressed_size']) * 100:.1f}%"
                    if details["uncompressed_size"] > 0
                    else "0%"
                )

            report["details"].update(details)

        except zipfile.BadZipFile:
            report["is_valid"] = False
            report["errors"].append("File is not a valid ZIP archive or is corrupted")
        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Could not validate ZIP archive: {str(e)}")

    def _validate_bin(self, filepath: Path, report: Dict[str, Any]):
        """Validates binary buffer files (typically used with GLTF)."""
        details = {"format": "Binary Buffer", "file_size": filepath.stat().st_size}

        # Basic checks for corrupted/empty buffers
        if details["file_size"] == 0:
            report["is_valid"] = False
            report["errors"].append("Binary buffer file is empty")
        elif details["file_size"] < 4:
            report["errors"].append("Binary buffer suspiciously small (< 4 bytes)")

        report["details"].update(details)

    def _validate_generic(self, filepath: Path, report: Dict[str, Any]):
        """Generic validation for unknown file types."""
        try:
            # Check if file is readable
            with open(filepath, "rb") as f:
                first_chunk = f.read(1024)

            report["details"]["readable"] = True
            report["details"]["file_size"] = filepath.stat().st_size

            # Try to detect if it's a text file
            try:
                first_chunk.decode("utf-8")
                report["details"]["probable_type"] = "text"
            except UnicodeDecodeError:
                report["details"]["probable_type"] = "binary"

        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"File is not readable: {str(e)}")
