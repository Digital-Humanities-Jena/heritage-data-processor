# server_app/legacy/component_discovery.py
import yaml
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional


class ComponentDiscovery:
    """Discovers available components automatically"""

    def __init__(self, components_dir: Path, component_manager: "ComponentEnvironmentManager"):
        self.components_dir = Path(components_dir)
        self.component_manager = component_manager

    def discover_all_components(self) -> Dict[str, List[Dict[str, Any]]]:
        """Discover all components and categorize them"""
        local_components = self.discover_local_components()

        categorized = {"installed": [], "available": [], "invalid": []}

        for component in local_components:
            if component["is_valid"]:
                if component["is_installed"]:
                    categorized["installed"].append(component)
                else:
                    categorized["available"].append(component)
            else:
                categorized["invalid"].append(component)

        return categorized

    def discover_local_components(self) -> List[Dict[str, Any]]:
        """Find all available components in the components directory"""
        discovered = []

        if not self.components_dir.exists():
            return discovered

        for component_dir in self.components_dir.iterdir():
            # exclude _shared
            if component_dir.is_dir() and not component_dir.name.startswith(".") and component_dir.name != "_shared":
                component_info = self._extract_component_info(component_dir)
                if component_info:
                    discovered.append(component_info)

        return discovered

    def _extract_component_info(self, component_dir: Path) -> Optional[Dict[str, Any]]:
        """Extract component information from directory using the new component.yaml structure."""
        try:
            yaml_file = component_dir / "component.yaml"
            if not yaml_file.exists():
                return {
                    "name": component_dir.name,
                    "label": component_dir.name,
                    "description": "No component.yaml found",
                    "category": "Unknown",
                    "version": "0.0.0",
                    "path": str(component_dir),
                    "is_valid": False,
                    "is_installed": False,
                    "validation_errors": ["Missing component.yaml"],
                }

            with open(yaml_file, "r") as f:
                config = yaml.safe_load(f)

            # Main metadata block
            metadata = config.get("metadata", {})
            component_name_in_yaml = metadata.get("name", component_dir.name)

            # Validate component structure and name congruence
            validation_errors = self._validate_component_config(component_dir, config)
            if component_name_in_yaml != component_dir.name:
                validation_errors.append(
                    f"Directory name '{component_dir.name}' must match the 'name' in component.yaml ('{component_name_in_yaml}')"
                )

            is_valid = len(validation_errors) == 0
            component_name = component_dir.name  # The directory name is the source of truth for the API
            is_installed = self.component_manager.is_component_installed(component_name)

            # Construct the full component info object from the new structure
            return {
                "name": component_name,
                "label": metadata.get("label", component_name),
                "description": metadata.get("description", ""),
                "category": metadata.get("category", "General"),
                "version": metadata.get("version", "1.0.0"),
                "authors": metadata.get("authors", []),
                "license": metadata.get("license", {}),
                "status": metadata.get("status", "stable"),
                "created": metadata.get("created"),
                "updated": metadata.get("updated"),
                "tags": metadata.get("tags", []),
                "keywords": metadata.get("keywords", []),
                "sources": config.get("sources", {}),
                "path": str(component_dir),
                "is_valid": is_valid,
                "is_installed": is_installed,
                "validation_errors": validation_errors,
                "inputs": config.get("inputs", []),
                "outputs": config.get("outputs", []),
                "parameter_groups": config.get("parameter_groups", []),
                "requirements": config.get("requirements", {}),
                "execution": config.get("execution", {}),
                "params": [
                    param for group in config.get("parameter_groups", []) for param in group.get("parameters", [])
                ],
            }

        except Exception as e:
            logging.warning(f"Failed to parse component {component_dir.name}: {e}")
            return {
                "name": component_dir.name,
                "label": component_dir.name,
                "description": f"Parse error: {str(e)}",
                "category": "Error",
                "version": "0.0.0",
                "path": str(component_dir),
                "is_valid": False,
                "is_installed": False,
                "validation_errors": [f"Parse error: {str(e)}"],
            }

    def _validate_component_config(self, component_dir: Path, config: Dict[str, Any]) -> List[str]:
        """Validate component configuration and structure against the new schema."""
        errors = []

        # Check for top-level keys
        if "metadata" not in config:
            errors.append("Missing required top-level key: metadata")
            return errors  # Stop validation if metadata is missing

        metadata = config.get("metadata", {})
        # Check required fields within metadata
        required_fields = ["name", "label", "description", "category", "version"]
        for field in required_fields:
            if field not in metadata:
                errors.append(f"Missing required metadata field: {field}")

        # Check for existence of other primary keys
        for key in ["inputs", "outputs", "parameter_groups", "requirements", "execution"]:
            if key not in config:
                errors.append(f"Missing required top-level key: {key}")

        # Check required files from the 'structure' block, resolving paths correctly
        structure = config.get("structure", {})
        required_files = structure.get("required_files", ["main.py", "processor.py"])
        for file_name in required_files:
            # Skip wildcard entries, as they don't represent a single file to check for existence.
            if "*" in file_name:
                continue

            # Construct the full path relative to the component's directory.
            full_path = component_dir / file_name

            if not full_path.exists():
                errors.append(f"Missing required file: {file_name}")

        # Simplified structure validation for inputs and outputs
        if not isinstance(config.get("inputs", []), list):
            errors.append("'inputs' must be a list")
        if not isinstance(config.get("outputs", []), list):
            errors.append("'outputs' must be a list")

        return errors

    def get_components_by_category(self) -> Dict[str, List[Dict[str, Any]]]:
        """Get components organized by category, including invalid ones."""
        components = self.discover_local_components()
        by_category = {}

        # All components are included, even those with validation errors (to resolve them)
        for component in components:
            category = component["category"]
            if category not in by_category:
                by_category[category] = []
            by_category[category].append(component)

        return by_category

    def search_components(self, query: str, category: str = None) -> List[Dict[str, Any]]:
        """Search components by name, label, or description"""
        components = self.discover_local_components()
        results = []

        query_lower = query.lower()

        for component in components:
            if not component["is_valid"]:
                continue

            # Category filter
            if category and component["category"] != category:
                continue

            # Text search in name, label, and description
            searchable_text = (component["name"] + " " + component["label"] + " " + component["description"]).lower()

            if query_lower in searchable_text:
                results.append(component)

        return results
