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
            if component_dir.is_dir() and not component_dir.name.startswith("."):
                component_info = self._extract_component_info(component_dir)
                if component_info:
                    discovered.append(component_info)

        return discovered

    def _extract_component_info(self, component_dir: Path) -> Optional[Dict[str, Any]]:
        """Extract component information from directory"""
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

            # Validate component structure
            validation_errors = self._validate_component_config(component_dir, config)
            component_name_in_yaml = config.get("name", component_dir.name)
            if component_name_in_yaml != component_dir.name:
                validation_errors.append(
                    f"Directory name '{component_dir.name}' must match the 'name' in component.yaml ('{component_name_in_yaml}')"
                )

            # The component name for the API should be what's in the directory
            component_name = component_dir.name

            is_valid = len(validation_errors) == 0

            component_name = config.get("name", component_dir.name)
            is_installed = self.component_manager.is_component_installed(component_name)

            return {
                "name": component_name,
                "label": config.get("label", component_name),
                "description": config.get("description", ""),
                "category": config.get("category", "General"),
                "version": config.get("version", "1.0.0"),
                "path": str(component_dir),
                "is_valid": is_valid,
                "is_installed": is_installed,
                "validation_errors": validation_errors,
                "inputs": config.get("inputs", []),
                "outputs": config.get("outputs", []),
                "parameters": config.get("params", []),
                "requirements": config.get("requirements", {}),
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
        """Validate component configuration and structure"""
        errors = []

        # Check required YAML fields
        required_fields = ["name", "label", "description", "inputs", "outputs"]
        for field in required_fields:
            if field not in config:
                errors.append(f"Missing required field: {field}")

        # Check required files
        required_files = ["main.py", "processor.py"]
        for file_name in required_files:
            if not (component_dir / file_name).exists():
                errors.append(f"Missing required file: {file_name}")

        # Validate inputs structure
        inputs = config.get("inputs", [])
        if not isinstance(inputs, list):
            errors.append("inputs must be a list")
        else:
            for i, inp in enumerate(inputs):
                if not isinstance(inp, dict):
                    errors.append(f"Input {i} must be a dictionary")
                elif "name" not in inp:
                    errors.append(f"Input {i} missing required field: name")

        # Validate outputs structure
        outputs = config.get("outputs", [])
        if not isinstance(outputs, list):
            errors.append("outputs must be a list")
        else:
            for i, out in enumerate(outputs):
                if not isinstance(out, dict):
                    errors.append(f"Output {i} must be a dictionary")
                # Checks for either 'name' OR 'name_pattern'
                elif "name" not in out and "name_pattern" not in out:
                    errors.append(f"Output {i} missing required field: 'name' or 'name_pattern'")

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
