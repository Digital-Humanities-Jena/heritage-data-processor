# server_app/routes/component_runner_utils.py
import logging
import os
import subprocess
import sys
import yaml
from pathlib import Path
from typing import Dict, Any, List, Tuple

from ..legacy.component_config_loader import ComponentConfigLoader

logger = logging.getLogger(__name__)


def get_executable_path(name: str) -> str:
    """
    Finds the path to a bundled executable (like 'uv').
    """
    if getattr(sys, "frozen", False):
        # In a bundled app, our binaries are in the same directory as the main executable.
        base_path = Path(sys.executable).parent
        # The build script places 'uv' in the '_internal' directory.
        executable_path = base_path / "_internal" / name
        if not executable_path.exists():
            raise FileNotFoundError(f"Executable '{name}' not found at expected path: {executable_path}")
        return str(executable_path)
    else:
        # In development, assume it's in the system's PATH.
        import shutil

        executable_path = shutil.which(name)
        if not executable_path:
            raise FileNotFoundError(f"Executable '{name}' not found in PATH.")
        return executable_path


def get_python_interpreter_path() -> str:
    """
    Determines the appropriate Python interpreter path. For bundled apps,
    it leverages the bypass mechanism in run.py to discover the real
    interpreter path that PyInstaller unpacks at runtime.
    """
    if getattr(sys, "frozen", False):
        env = os.environ.copy()
        env["UV_BYPASS_PYINSTALLER"] = "1"
        try:
            # sys.executable points to the main HDPBackend bootloader
            result = subprocess.run(
                [sys.executable],
                env=env,
                capture_output=True,
                text=True,
                check=True,
            )
            # The bypass in run.py prints the path to stdout.
            interpreter_path = result.stdout.strip()
            if not Path(interpreter_path).exists():
                raise FileNotFoundError(f"Bypass mechanism returned a non-existent path: {interpreter_path}")
            return interpreter_path
        except subprocess.CalledProcessError as e:
            error_message = (
                "Failed to discover the real Python interpreter path via bypass mechanism. " f"Error: {e.stderr}"
            )
            raise RuntimeError(error_message) from e
    else:
        # In development, sys.executable is the correct interpreter.
        return sys.executable


def find_component_python_executable(component_path: Path) -> str:
    """
    Finds the Python executable within a given component's virtual environment.

    Args:
        component_path: The root path of the component.

    Returns:
        The absolute path to the Python executable in the component's venv.

    Raises:
        FileNotFoundError: If the virtual environment or the Python executable
                           is not found.
    """
    env_path = component_path / "env"
    if not env_path.is_dir():
        raise FileNotFoundError(f"Virtual environment not found for component '{component_path.name}' at '{env_path}'")

    # On macOS and Linux, the executable is in the 'bin' directory.
    # On Windows, it would be in 'Scripts'.
    bin_dir = "bin" if sys.platform != "win32" else "Scripts"
    python_executable_path = env_path / bin_dir / "python"

    if not python_executable_path.is_file():
        raise FileNotFoundError(
            f"Python executable not found in venv for '{component_path.name}' at '{python_executable_path}'"
        )

    return str(python_executable_path)


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
    This is the corrected version that uses the component's own venv.
    """
    try:
        main_script = component_path / "main.py"
        if not main_script.exists():
            return {}

        # Find and use the Python executable from the component's virtual environment
        try:
            python_executable = find_component_python_executable(component_path)
        except FileNotFoundError:
            # If the venv doesn't exist yet (e.g., pre-installation), the introspection can't be executed.
            # This is a safe fallback.
            return {}

        result = subprocess.run(
            [python_executable, str(main_script), "--help"], capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
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

    try:
        python_executable = find_component_python_executable(component_path)
    except FileNotFoundError as e:
        logger.error(f"Cannot build command for '{component_name}': {e}")
        raise e

    component_spec = get_component_spec(component_name)
    main_script_path = component_path / "main.py"

    is_test_run = False
    for param_name, param_value in parameters.items():
        if param_name.startswith("test") and param_value:
            is_test_run = True
            break

    if is_test_run:
        cmd = [python_executable, str(main_script_path), "--test"]
        return cmd, component_spec, {"strategy": "test_mode"}, parameters, {}

    cmd = [python_executable, str(main_script_path)]

    from .component_manager import get_component_installation_config

    install_config = get_component_installation_config(component_name)
    install_file_paths = install_config.get("file_paths", {})
    merged_parameters = {**install_file_paths, **parameters}

    for name, path in inputs.items():
        if path:
            cmd.extend([f"--{name}", str(path)])

    cli_patterns = introspect_component_cli(component_path)
    output_strategy = determine_output_strategy(component_spec, inputs, output_directory, cli_patterns)
    cmd.extend(output_strategy["args"])

    add_parameters_to_command(cmd, merged_parameters, component_spec)

    if cli_patterns.get("supports_verbose", True):
        cmd.append("--verbose")

    return cmd, component_spec, output_strategy, merged_parameters, install_config
