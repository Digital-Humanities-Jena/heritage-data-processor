# run.py
import argparse
import os
from pathlib import Path
from server_app import create_app
import sys


def get_default_config_path():
    """Get the default config path, handling both development and packaged modes."""

    if hasattr(sys, "_MEIPASS"):
        # = PyInstaller Bundle Mode
        # In packaged mode, config should be in the external resources
        if os.environ.get("ELECTRON_RESOURCES_PATH"):
            # Electron sets this environment variable pointing to resources
            return os.path.join(os.environ["ELECTRON_RESOURCES_PATH"], "data", "config.yaml")
        else:
            bundle_dir = Path(sys.executable).parent
            return str(bundle_dir.parent / "data" / "config.yaml")
    else:
        # = Development mode
        return str(Path(__file__).resolve().parent / "server_app" / "data" / "config.yaml")


if __name__ == "__main__":
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
