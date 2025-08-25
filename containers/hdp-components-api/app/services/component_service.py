import json
import logging
from pathlib import Path
from typing import Dict, Any
from flask import current_app

logger = logging.getLogger(__name__)


class ComponentService:
    @staticmethod
    def get_components() -> Dict[str, Any]:
        """Retrieve all available components."""
        try:
            components_file = current_app.config["COMPONENTS_FILE"]

            if not components_file.exists():
                logger.warning("Components file does not exist, returning empty dict")
                return {}

            with open(components_file, "r", encoding="utf-8") as f:
                components = json.load(f)

            logger.info(f"Retrieved {len(components)} components")
            return components

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in components file: {e}")
            raise ValueError("Invalid JSON format in components file")
        except Exception as e:
            logger.error(f"Error reading components file: {e}")
            raise

    @staticmethod
    def update_components(components_data: Dict[str, Any]) -> bool:
        """Update the available components data."""
        try:
            components_file = current_app.config["COMPONENTS_FILE"]

            # Validate the data structure
            ComponentService._validate_components_data(components_data)

            # Create backup
            ComponentService._create_backup(components_file)

            # Write new data
            with open(components_file, "w", encoding="utf-8") as f:
                json.dump(components_data, f, indent=2, ensure_ascii=False)

            logger.info(f"Updated components file with {len(components_data)} components")
            return True

        except Exception as e:
            logger.error(f"Error updating components file: {e}")
            raise

    @staticmethod
    def _validate_components_data(data: Dict[str, Any]) -> None:
        """Validate the structure of enhanced components data."""
        if not isinstance(data, dict):
            raise ValueError("Components data must be a dictionary")

        # Check for metadata section
        if "metadata" not in data:
            raise ValueError("Components data must contain 'metadata' section")

        metadata = data["metadata"]
        if not isinstance(metadata, dict):
            raise ValueError("Metadata section must be a dictionary")

        required_metadata_fields = ["retrieved", "categories"]
        for field in required_metadata_fields:
            if field not in metadata:
                raise ValueError(f"Metadata section missing required field: {field}")

        # Validate categories structure
        categories = metadata["categories"]
        if not isinstance(categories, dict):
            raise ValueError("Categories must be a dictionary")

        for category_name, category_info in categories.items():
            if not isinstance(category_info, dict):
                raise ValueError(f"Category '{category_name}' must be a dictionary")

            required_category_fields = ["count", "identifiers"]
            for field in required_category_fields:
                if field not in category_info:
                    raise ValueError(f"Category '{category_name}' missing required field: {field}")

        # Validate component structures (skip metadata key)
        for component_name, component_versions in data.items():
            if component_name == "metadata":
                continue

            if not isinstance(component_versions, list):
                raise ValueError(f"Component '{component_name}' must be a list of versions")

            for i, version_info in enumerate(component_versions):
                if not isinstance(version_info, dict):
                    raise ValueError(f"Component '{component_name}' version {i} must be a dictionary")

                # Check for essential fields in each version
                required_fields = ["updated", "version"]
                for field in required_fields:
                    if field not in version_info:
                        raise ValueError(f"Component '{component_name}' version {i} missing required field: {field}")

    @staticmethod
    def _create_backup(components_file: Path) -> None:
        """Create a backup of the current components file."""
        if components_file.exists():
            backup_file = components_file.with_suffix(".json.backup")
            try:
                import shutil

                shutil.copy2(components_file, backup_file)
                logger.debug(f"Created backup: {backup_file}")
            except Exception as e:
                logger.warning(f"Could not create backup: {e}")
