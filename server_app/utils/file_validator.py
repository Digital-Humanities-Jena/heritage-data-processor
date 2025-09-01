# server_app/utils/file_validator.py
import json
import re
from pathlib import Path
from typing import Any, Dict
import magic
from PIL import Image
import PyPDF2


class FileValidator:
    """
    A utility class to validate files based on the logic from the
    FileIntegrityProcessor HDP component, with enhanced 3D model validation.
    """

    def __init__(self):
        try:
            self.mime_detector = magic.Magic(mime=True)
        except magic.MagicException as e:
            print(f"Warning: Could not initialize python-magic. MIME detection will be limited. Error: {e}")
            self.mime_detector = None

    def validate(self, filepath: Path) -> Dict[str, Any]:
        """
        Validates a single file and returns a report.
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

            # Override mime type for known 3D model text formats
            if file_ext == ".obj":
                mime_type = "model/obj"
            elif file_ext == ".mtl":
                mime_type = "model/mtl"

            report["details"]["mime_type"] = mime_type

            # Route to the correct validation method
            if mime_type == "model/obj":
                self._validate_obj(filepath, report)
            elif mime_type == "model/mtl":
                self._validate_mtl(filepath, report)
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

        return report

    def _validate_obj(self, filepath: Path, report: Dict[str, Any]):
        """Performs a lightweight integrity check on an .obj file."""
        details = {
            "geometric_vertices_(v)": 0,
            "faces_(f)": 0,
            "material_libraries_(mtllib)": 0,
        }
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    parts = line.strip().split()
                    if not parts:
                        continue
                    if parts[0] == "v":
                        details["geometric_vertices_(v)"] += 1
                    elif parts[0] == "f":
                        details["faces_(f)"] += 1
                    elif parts[0] == "mtllib":
                        details["material_libraries_(mtllib)"] += 1

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

            if details["defined_materials_(newmtl)"] == 0:
                report["is_valid"] = False
                report["errors"].append("File does not define any materials using the 'newmtl' keyword.")

            report["details"].update(details)
        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Could not read MTL file: {str(e)}")

    def _validate_image(self, filepath: Path, report: Dict[str, Any]):
        try:
            with Image.open(filepath) as img:
                img.verify()
            with Image.open(filepath) as img:
                report["details"]["format"] = img.format
                report["details"]["size"] = f"{img.width}x{img.height}"
                report["details"]["mode"] = img.mode
        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Invalid image file: {str(e)}")

    def _validate_pdf(self, filepath: Path, report: Dict[str, Any]):
        try:
            with open(filepath, "rb") as f:
                reader = PyPDF2.PdfReader(f, strict=False)
                report["details"]["pages"] = len(reader.pages)
                if reader.is_encrypted:
                    report["details"]["encrypted"] = True
        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"Invalid or corrupt PDF file: {str(e)}")

    def _validate_json(self, filepath: Path, report: Dict[str, Any]):
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

    def _validate_generic(self, filepath: Path, report: Dict[str, Any]):
        try:
            with open(filepath, "rb") as f:
                f.read(1024)
            report["details"]["readable"] = True
        except Exception as e:
            report["is_valid"] = False
            report["errors"].append(f"File is not readable: {str(e)}")
