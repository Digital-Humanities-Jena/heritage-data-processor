# run.py
import argparse
import os
from pathlib import Path
from server_app import create_app
import sys


def get_default_config_path():
    """Get the default config path, handling Electron + PyInstaller structure."""
    if hasattr(sys, "_MEIPASS"):
        # PyInstaller bundle mode
        if os.environ.get("ELECTRON_RESOURCES_PATH"):
            return os.path.join(os.environ["ELECTRON_RESOURCES_PATH"], "data", "config.yaml")
        else:
            # sys.executable = .../python_backend/HDPBackend
            backend_dir = Path(sys.executable).parent
            resources_dir = backend_dir.parent  # Should be Resources/
            return str(resources_dir / "data" / "config.yaml")
    else:
        # Development mode
        return str(Path(__file__).resolve().parent / "server_app" / "data" / "config.yaml")


if __name__ == "__main__":
    # This is a simple bypass. It handles the special case where the app is
    # launched by another process to find the real internal Python interpreter path.
    if os.environ.get("HDP_INTERPRETER_PATH_REQUEST") == "1":
        if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
            # sys._MEIPASS is the path to the '_internal' directory
            internal_path = Path(sys._MEIPASS)
            py_executable = internal_path / "python"
            if py_executable.exists():
                print(py_executable.resolve())
                sys.exit(0)
        # Fallback for development or if the path isn't found
        print(sys.executable)
        sys.exit(0)

    DEFAULT_CONFIG_PATH = get_default_config_path()
    print(DEFAULT_CONFIG_PATH)

    parser = argparse.ArgumentParser(description="Heritage Data Processor Backend Server")
    parser.add_argument("--port", type=int, default=5001, help="Port to run the server on")
    parser.add_argument("--config", type=str, default=DEFAULT_CONFIG_PATH, help="Path to the main config.yaml file")
    parser.add_argument("--data-dir", type=str, help="Path to the data directory containing YAML files")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode (server only, no GUI).")
    parser.add_argument(
        "--enable-alpha-features", action="store_true", help="Enable all alpha-level features in the GUI."
    )

    args = parser.parse_args()

    if args.data_dir:
        os.environ["ZENTX_DATA_DIR"] = args.data_dir
        print(f"✅ Data directory set to: {args.data_dir}")
    else:
        print("⚠️  No --data-dir argument provided")

    app = create_app(config_path=args.config, enable_alpha_features=args.enable_alpha_features)

    if args.headless:
        print("✅ Running in headless mode. The GUI will not be launched by this script.")
        print(f"   API server is available at http://localhost:{args.port}")
    else:
        print("✅ Starting server for GUI mode.")
        print(f"   API server will be available at http://localhost:{args.port} for the Electron app.")

    app.run(debug=True, port=args.port, host="0.0.0.0", use_reloader=False)
