# server_app/routes/component_runner_utils.py
import logging
import subprocess
import sys
import yaml
from pathlib import Path
from typing import Dict, Any, List, Tuple

from ..legacy.component_config_loader import ComponentConfigLoader

logger = logging.getLogger(__name__)


def normalize_cli_arg(name: str) -> str:
    """Normalize a string into a command-line-friendly argument (e.g., 'param_name' -> 'param-name')."""
    return name.replace("_", "-").lower()


def get_component_spec(component_name: str) -> Dict[str, Any]:
    """Loads a component's specification from its YAML file."""
    component_path = Path("pipeline_components") / component_name
    spec_path = component_path / "component.yaml"
    if not spec_path.exists():
        raise FileNotFoundError(f"Component specification not found for {component_name} at {spec_path}")
    with open(spec_path, "r") as f:
        return yaml.safe_load(f)


def introspect_component_cli(component_path: Path) -> Dict[str, Any]:
    """
    Introspects a component's CLI to find supported arguments.
    This is the corrected version that checks for all output patterns.
    """
    try:
        main_script = component_path / "main.py"
        if not main_script.exists():
            return {}

        result = subprocess.run(
            [sys.executable, str(main_script), "--help"], capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            # TODO: If --help fails, it's a sign of an issue, but empty is returned for now
            return {}

        help_text = result.stdout.lower()

        uses_plain_output = "--output " in help_text and "--output-" not in help_text.replace(
            "--output-dir", ""
        ).replace("--output-file", "")

        return {
            "uses_output_dir": "--output-dir" in help_text,
            "uses_output_file": "--output-file" in help_text,
            "uses_output": uses_plain_output,
            "supports_verbose": "--verbose" in help_text,
        }
    except Exception as e:
        logger.warning(f"CLI introspection failed for {component_path.name}: {e}")
        return {}


def determine_output_strategy(
    component_spec: Dict, inputs: Dict, output_directory: str, cli_patterns: Dict
) -> Dict[str, Any]:
    """
    Determines the correct output arguments based on spec and CLI introspection.
    This version correctly prioritizes the output flag and generates a full file path.
    """
    # Generate a meaningful output filename from the component's spec
    output_spec_list = component_spec.get("outputs", [])
    output_filename = "output.txt"  # Default fallback
    if output_spec_list:
        name_pattern = output_spec_list[0].get("name_pattern", "{original_stem}_output.txt")
        input_stem = Path(next(iter(inputs.values()), "output")).stem
        output_filename = name_pattern.replace("{original_stem}", input_stem)

    output_path = Path(output_directory) / output_filename

    # Priority 1: Use the most specific flag the component supports.
    if cli_patterns.get("uses_output"):
        return {
            "strategy": "single_file_output",
            "args": ["--output", str(output_path)],
            "output_paths": [str(output_path)],
        }
    elif cli_patterns.get("uses_output_file"):
        return {
            "strategy": "single_file_output_file",
            "args": ["--output-file", str(output_path)],
            "output_paths": [str(output_path)],
        }
    elif cli_patterns.get("uses_output_dir"):
        return {
            "strategy": "directory",
            "args": ["--output-dir", output_directory],
            "output_paths": [str(output_path)],  # Still estimate the primary output path
        }

    # Fallback if introspection fails or finds no pattern
    logger.warning(f"No specific output strategy found for {component_spec['name']}. Defaulting to --output.")
    return {
        "strategy": "single_file_fallback",
        "args": ["--output", str(output_path)],
        "output_paths": [str(output_path)],
    }


def add_parameters_to_command(cmd: List[str], parameters: Dict, component_spec: Dict):
    """Adds parameters to the command list based on their type."""
    loader = ComponentConfigLoader(Path("pipeline_components") / component_spec["name"])
    param_specs = loader.get_parameter_mapping()
    for name, value in parameters.items():
        if value is None or value == "" or value == []:
            continue

        cli_arg = f"--{normalize_cli_arg(name)}"
        param_type = param_specs.get(name, {}).get("type", "str")

        if param_type == "bool":
            if value:  # Add flag only if True
                cmd.append(cli_arg)
        elif isinstance(value, list):
            cmd.append(cli_arg)
            cmd.extend(map(str, value))
        else:
            cmd.extend([cli_arg, str(value)])


def build_full_command(
    component_name: str, inputs: Dict, parameters: Dict, output_directory: str
) -> Tuple[List[str], Dict, Dict, Dict, Dict]:
    """Orchestrates building the full, final command for execution."""
    component_path = Path("pipeline_components") / component_name
    component_spec = get_component_spec(component_name)

    cmd = [sys.executable, str(component_path / "main.py")]

    from .component_manager import get_component_installation_config

    # STEP 1: Merge runtime parameters with stored installation configuration
    install_config = get_component_installation_config(component_name)
    install_file_paths = install_config.get("file_paths", {})
    merged_parameters = {**install_file_paths, **parameters}

    # STEP 2: Add inputs to command
    for name, path in inputs.items():
        if path:
            cmd.extend([f"--{normalize_cli_arg(name)}", str(path)])

    # STEP 3: Determine and add output arguments using the corrected logic
    cli_patterns = introspect_component_cli(component_path)
    output_strategy = determine_output_strategy(component_spec, inputs, output_directory, cli_patterns)
    cmd.extend(output_strategy["args"])

    # STEP 4: Add the merged parameters to command
    add_parameters_to_command(cmd, merged_parameters, component_spec)

    # STEP 5: Add verbose flag if supported
    if cli_patterns.get("supports_verbose", True):
        cmd.append("--verbose")

    return cmd, component_spec, output_strategy, merged_parameters, install_config
