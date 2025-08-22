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
    """Normalize a string into a command-line-friendly argument."""
    # This function is simplified to just convert to lowercase,
    # preserving underscores as defined in component.yaml and main.py.
    return name.lower()


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
        # Correctly access the component name from the metadata block
        component_name = component_spec.get("metadata", {}).get("name", "unknown_component")
        name_pattern = output_spec_list[0].get("pattern", "{original_stem}_output.txt")
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
    component_name = component_spec.get("metadata", {}).get("name", "unknown_component")
    logger.warning(f"No specific output strategy found for {component_name}. Defaulting to --output.")
    return {
        "strategy": "single_file_fallback",
        "args": ["--output", str(output_path)],
        "output_paths": [str(output_path)],
    }


def add_parameters_to_command(cmd: List[str], parameters: Dict, component_spec: Dict):
    """Adds parameters to the command list based on their type."""
    component_name = component_spec.get("metadata", {}).get("name")
    if not component_name:
        logger.error("Could not determine component name from specification for parameter loading.")
        return

    loader = ComponentConfigLoader(Path("pipeline_components") / component_name)
    param_specs = loader.get_parameter_mapping()
    for name, value in parameters.items():
        if value is None or value == "" or value == []:
            continue

        # Use the name directly from the YAML, without normalization
        cli_arg = f"--{name}"
        param_type = param_specs.get(name, {}).get("type", "str")

        if param_type == "boolean":
            # For boolean flags, the argument should only be added if the value is true.
            if value:
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
    main_script_path = component_path / "main.py"

    # --- SPECIAL HANDLING FOR TEST MODE ---
    # If a parameter like 'test' or 'test_n' is True, ignore all other inputs
    # and construct a simple test command.
    is_test_run = False
    for param_name, param_value in parameters.items():
        if param_name.startswith("test") and param_value:
            is_test_run = True
            break

    if is_test_run:
        cmd = [sys.executable, str(main_script_path), "--test"]
        # Return a simplified tuple for test mode
        return cmd, component_spec, {"strategy": "test_mode"}, parameters, {}

    # --- REGULAR EXECUTION LOGIC ---
    cmd = [sys.executable, str(main_script_path)]

    from .component_manager import get_component_installation_config

    install_config = get_component_installation_config(component_name)
    install_file_paths = install_config.get("file_paths", {})
    merged_parameters = {**install_file_paths, **parameters}

    for name, path in inputs.items():
        if path:
            # Use the name directly as the CLI argument
            cmd.extend([f"--{name}", str(path)])

    cli_patterns = introspect_component_cli(component_path)
    output_strategy = determine_output_strategy(component_spec, inputs, output_directory, cli_patterns)
    cmd.extend(output_strategy["args"])

    add_parameters_to_command(cmd, merged_parameters, component_spec)

    if cli_patterns.get("supports_verbose", True):
        cmd.append("--verbose")

    return cmd, component_spec, output_strategy, merged_parameters, install_config
