# server_app/legacy/component_config_loader.py
import yaml
from pathlib import Path
from typing import Any, Dict, List


class ComponentConfigLoader:
    """Loads and validates component configurations from YAML"""

    def __init__(self, component_path: Path):
        self.component_path = Path(component_path)
        self.config = self._load_config()

    def _load_config(self) -> Dict[str, Any]:
        """Load component configuration from YAML"""
        config_file = self.component_path / "component.yaml"
        if not config_file.exists():
            raise FileNotFoundError(f"Component config not found: {config_file}")

        with open(config_file, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)

    def get_input_mapping(self) -> Dict[str, str]:
        """Get mapping from YAML input names to CLI argument names"""
        mapping = {}
        for input_def in self.config.get("inputs", []):
            yaml_name = input_def["name"]
            cli_name = yaml_name.replace("_", "-")
            mapping[yaml_name] = cli_name
        return mapping

    def get_parameter_mapping(self) -> Dict[str, Dict[str, Any]]:
        """
        Get parameter definitions with types and defaults.
        Supports both `parameter_groups` and the old flat `params` list.
        """
        mapping = {}

        # Read from parameter_groups
        if "parameter_groups" in self.config:
            for group in self.config.get("parameter_groups", []):
                for param_def in group.get("parameters", []):
                    param_name = param_def["name"]
                    mapping[param_name] = {
                        "cli_name": param_name.replace("_", "-"),
                        "type": param_def.get("type", "str"),
                        "default": param_def.get("default"),
                        "required": param_def.get("required", False),
                    }
            return mapping

        # Fallback for legacy `params` structure
        for param_def in self.config.get("params", []):
            param_name = param_def["name"]
            mapping[param_name] = {
                "cli_name": param_name.replace("_", "-"),
                "type": param_def.get("type", "str"),
                "default": param_def.get("default"),
                "required": param_def.get("required", False),
            }
        return mapping

    def get_parameter_groups(self) -> List[Dict[str, Any]]:
        """Gets the structured parameter groups directly from the YAML."""
        return self.config.get("parameter_groups", [])

    def validate_inputs(self, provided_inputs: Dict[str, Any]) -> List[str]:
        """Validate that required inputs are provided"""
        errors = []
        for input_def in self.config.get("inputs", []):
            if input_def.get("required", True) and input_def["name"] not in provided_inputs:
                errors.append(f"Required input '{input_def['name']}' is missing")
        return errors
