#!/usr/bin/env python3
"""
Script to generate requirement.txt format output for specified modules
"""

import importlib
import importlib.metadata
from pathlib import Path
from datetime import datetime

# Mapping of import names to package names
PACKAGE_NAME_MAPPING = {
    "dotenv": "python-dotenv",
    "yaml": "PyYAML",
    "cv2": "opencv-python",
    "PIL": "Pillow",
    "sklearn": "scikit-learn",
    "skimage": "scikit-image",
    "bs4": "beautifulsoup4",
    "dateutil": "python-dateutil",
    "magic": "python-magic",
    "serial": "pyserial",
    "MySQLdb": "mysqlclient",
    "psycopg2": "psycopg2-binary",
    "Image": "Pillow",
    "ImageDraw": "Pillow",
    "ImageFont": "Pillow",
    "lxml": "lxml",
    "numpy": "numpy",
    "scipy": "scipy",
    "matplotlib": "matplotlib",
    "pandas": "pandas",
    "requests": "requests",
    "flask": "Flask",
    "django": "Django",
    "tornado": "tornado",
    "cherrypy": "CherryPy",
    "bottle": "bottle",
    "jwt": "PyJWT",
    "crypto": "pycryptodome",
    "Crypto": "pycryptodome",
    "OpenSSL": "pyOpenSSL",
    "nacl": "PyNaCl",
    "google": "google",
    "googleapiclient": "google-api-python-client",
    "oauth2client": "oauth2client",
    "gspread": "gspread",
    "tweepy": "tweepy",
    "facebook": "facebook-sdk",
    "instagram": "python-instagram",
    "linkedin": "python-linkedin",
    "twitter": "python-twitter",
    "redis": "redis",
    "pymongo": "pymongo",
    "psutil": "psutil",
    "win32api": "pywin32",
    "win32con": "pywin32",
    "win32gui": "pywin32",
    "pythoncom": "pywin32",
    "pywintypes": "pywin32",
}


def get_package_name(module_name):
    """
    Get the correct package name for installation.
    Returns the mapped package name or the original module name.
    """
    return PACKAGE_NAME_MAPPING.get(module_name, module_name)


def get_module_version(module_name):
    """
    Get version of a module if available.
    Returns None for standard library modules or if version cannot be determined.
    """
    package_name = get_package_name(module_name)

    # First try with the mapped package name
    try:
        version = importlib.metadata.version(package_name)
        return version, package_name
    except importlib.metadata.PackageNotFoundError:
        pass

    # If mapped name fails, try original name
    if package_name != module_name:
        try:
            version = importlib.metadata.version(module_name)
            return version, module_name
        except importlib.metadata.PackageNotFoundError:
            pass

    # Try to import the module and check for __version__ attribute
    try:
        module = importlib.import_module(module_name)
        if hasattr(module, "__version__"):
            return module.__version__, package_name
    except ImportError:
        pass
    except Exception:
        pass

    return None, package_name


def is_standard_library(module_name):
    """
    Check if a module is part of the standard library.
    This is a best-effort check for common standard library modules.
    """
    standard_lib_modules = {
        "argparse",
        "collections",
        "contextlib",
        "datetime",
        "difflib",
        "functools",
        "hashlib",
        "json",
        "logging",
        "mimetypes",
        "os",
        "pathlib",
        "queue",
        "re",
        "shutil",
        "sqlite3",
        "subprocess",
        "sys",
        "threading",
        "time",
        "traceback",
        "typing",
        "uuid",
    }
    return module_name in standard_lib_modules


def find_module_file():
    """
    Find the list_of_imported_modules.txt file.
    Look in script directory first, then current directory.
    """
    script_dir = Path(__file__).parent
    module_file_name = "list_of_imported_modules.txt"

    # First, try in the same directory as the script
    module_file = script_dir / module_file_name
    if module_file.exists():
        return module_file

    # Then try in the current working directory
    module_file = Path(module_file_name)
    if module_file.exists():
        return module_file

    return None


def generate_requirements():
    """
    Generate requirements.txt format output for modules in list_of_imported_modules.txt
    """
    module_file = find_module_file()

    if module_file is None:
        print("Error: list_of_imported_modules.txt not found")
        print("Searched in:")
        print(f"  - Script directory: {Path(__file__).parent}")
        print(f"  - Current directory: {Path.cwd()}")
        return

    print(f"Reading modules from: {module_file}")

    # Read module list
    with open(module_file, "r") as f:
        modules = [line.strip() for line in f if line.strip()]

    requirements = []
    not_found = []
    standard_lib = []
    name_mappings = []

    for module_name in modules:
        if is_standard_library(module_name):
            standard_lib.append(module_name)
            continue

        version_info = get_module_version(module_name)
        version, package_name = version_info if version_info[0] else (None, get_package_name(module_name))

        # Track name mappings for reporting
        if package_name != module_name:
            name_mappings.append((module_name, package_name))

        if version:
            requirements.append(f"{package_name}=={version}")
        else:
            # Check if module can be imported (might be installed but version unknown)
            try:
                importlib.import_module(module_name)
                requirements.append(f"{package_name}")  # No version available
            except ImportError:
                not_found.append((module_name, package_name))

    # Create filename with current date in the current working directory
    current_date = datetime.now().strftime("%Y-%m-%d")
    output_file = Path(f"requirements_{current_date}.txt")

    # Write results to file
    with open(output_file, "w") as f:
        f.write("# Generated requirements.txt format\n")
        f.write(f"# Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"# Source file: {module_file}\n")

        if name_mappings:
            f.write("\n# Note: Import name -> Package name mappings:\n")
            for import_name, package_name in sorted(name_mappings):
                f.write(f"# {import_name} -> {package_name}\n")

        f.write("\n# Third-party packages:\n")
        for req in sorted(requirements):
            f.write(f"{req}\n")

        if standard_lib:
            f.write("\n# Note: Standard library modules (no version needed):\n")
            for module in sorted(standard_lib):
                f.write(f"# {module}\n")

        if not_found:
            f.write("\n# Note: Modules not found in current environment:\n")
            for module_name, package_name in sorted(not_found):
                if module_name == package_name:
                    f.write(f"# {module_name} - NOT FOUND\n")
                else:
                    f.write(f"# {module_name} (package: {package_name}) - NOT FOUND\n")

    # Print summary to stdout
    print(f"Requirements file created: {output_file.absolute()}")
    print(f"Found {len(requirements)} third-party packages")
    print(f"Skipped {len(standard_lib)} standard library modules")

    if name_mappings:
        print(f"Applied {len(name_mappings)} name mappings:")
        for import_name, package_name in sorted(name_mappings):
            print(f"  {import_name} -> {package_name}")

    if not_found:
        print(f"Warning: {len(not_found)} modules not found in current environment")


if __name__ == "__main__":
    generate_requirements()
