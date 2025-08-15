# server_app/legacy/component_installer.py
import argparse
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
import subprocess
import os

from .component_discovery import ComponentDiscovery
from .component_manager import ComponentEnvironmentManager


_components_dir = Path("pipeline_components")
_db_path = Path("databases") / "component_registry.db"
_manager = None
_discovery = None


def _get_manager() -> ComponentEnvironmentManager:
    """Get or create component manager instance"""
    global _manager
    if _manager is None:
        _manager = ComponentEnvironmentManager(_components_dir, _db_path)
    return _manager


def _get_discovery() -> ComponentDiscovery:
    """Get or create component discovery instance"""
    global _discovery
    if _discovery is None:
        _discovery = ComponentDiscovery(_components_dir, _get_manager())
    return _discovery


def install_component(
    component_name: str, verbose: bool = True, skip_install_script: bool = False
) -> Tuple[bool, List[Dict[str, str]]]:
    """
    Install a pipeline component, returning detailed logs.

    Args:
        component_name: Name of the component to install
        verbose: Whether to print status messages to the console
        skip_install_script: Whether to skip running the component's install.py script

    Returns:
        A tuple (success: bool, logs: List[Dict])
    """
    manager = _get_manager()
    try:
        if manager.is_component_installed(component_name):
            if verbose:
                print(f"ℹ️  Component '{component_name}' is already installed.")
            return True, [{"level": "info", "message": "Component already installed."}]

        success, logs = manager.install_component(component_name, skip_install_script)

        if verbose:
            if success:
                print(f"✅ Component '{component_name}' installed successfully.")
            else:
                print(f"❌ Failed to install component '{component_name}'.")
                for log in logs:
                    if log["level"] in ["error", "stderr"]:
                        print(f"   - {log['message']}")

        return success, logs

    except Exception as e:
        if verbose:
            print(f"❌ Installation error: {str(e)}")
        return False, [{"level": "error", "message": str(e)}]


def _detect_conda_environment() -> Optional[str]:
    """Detect if running in a conda environment"""
    try:
        import os

        conda_env = os.environ.get("CONDA_DEFAULT_ENV")
        if conda_env:
            return conda_env

        # Alternative detection method
        if "conda" in sys.executable.lower():
            return os.path.basename(os.path.dirname(os.path.dirname(sys.executable)))

        return None
    except Exception:
        return None


def _pre_installation_checks(component_name: str, verbose: bool) -> bool:
    """Perform pre-installation checks"""
    try:
        component_path = _components_dir / component_name

        # Check required files exist
        required_files = ["component.yaml", "main.py", "processor.py"]
        missing_files = []

        for file_name in required_files:
            if not (component_path / file_name).exists():
                missing_files.append(file_name)

        if missing_files:
            if verbose:
                print(f"❌ Missing required files: {', '.join(missing_files)}")
            return False

        # Check disk space (basic check)
        try:
            import shutil

            free_space = shutil.disk_usage(component_path.parent).free
            if free_space < 100 * 1024 * 1024:  # Less than 100MB
                if verbose:
                    print("⚠️  Low disk space detected (< 100MB free)")
                    print("Installation may fail due to insufficient space")
        except Exception:
            pass  # Disk space check is optional

        return True

    except Exception as e:
        if verbose:
            print(f"❌ Pre-installation check failed: {e}")
        return False


def _verify_component_installation(component_name: str, verbose: bool) -> bool:
    """Verify that a component was installed correctly with generic diagnostics"""
    try:
        manager = _get_manager()

        if verbose:
            print(f"🔍 Verifying installation of '{component_name}'...")

        # Check 1: Database registration
        if not manager.is_component_installed(component_name):
            if verbose:
                print(f"❌ Database check failed: Component not registered as installed")
            return False

        if verbose:
            print(f"✅ Database check: Component is registered")

        # Check 2: Get component info
        component_info = manager.get_component_info(component_name)
        if not component_info:
            if verbose:
                print(f"❌ Component info check failed: Cannot retrieve information")
            return False

        if verbose:
            print(f"✅ Component info check: Retrieved information")

        # Check 3: Component directory exists
        install_path = Path(component_info["install_path"])
        if not install_path.exists():
            if verbose:
                print(f"❌ Component directory missing: {install_path}")
            return False

        if verbose:
            print(f"✅ Component directory exists: {install_path}")

        # Check 4: Virtual environment exists
        env_path = Path(component_info["env_path"])
        if not env_path.exists():
            if verbose:
                print(f"❌ Virtual environment missing: {env_path}")
            return False

        if verbose:
            print(f"✅ Virtual environment exists: {env_path}")

        # Check 5: Find working Python executable
        working_python = _find_working_python_in_env(env_path, verbose)
        if not working_python:
            if verbose:
                print(f"❌ No working Python executable found")
            return False

        if verbose:
            print(f"✅ Python executable works: {working_python}")

        # Check 6: Required component files exist
        required_files = ["component.yaml", "main.py", "processor.py"]
        missing_files = []

        for file_name in required_files:
            file_path = install_path / file_name
            if not file_path.exists():
                missing_files.append(file_name)
            elif verbose:
                print(f"✅ Required file exists: {file_name}")

        if missing_files:
            if verbose:
                print(f"❌ Missing required files: {missing_files}")
            return False

        # Check 7: Test component dependencies (generic)
        if not _verify_component_dependencies(install_path, working_python, verbose):
            if verbose:
                print(f"❌ Dependency verification failed")
            return False

        # Check 8: Test main script can be imported
        if not _verify_component_main_script(install_path, working_python, verbose):
            if verbose:
                print(f"⚠️  Main script verification failed (component may still work)")
            # Don't fail verification for this - it's optional

        if verbose:
            print(f"🎉 Component '{component_name}' verification completed successfully")

        return True

    except Exception as e:
        if verbose:
            print(f"❌ Verification error: {str(e)}")
        return False


def _find_working_python_in_env(env_path: Path, verbose: bool) -> Optional[Path]:
    """Find a working Python executable in the virtual environment"""
    python_candidates = [
        env_path / ("Scripts/python.exe" if os.name == "nt" else "bin/python"),
        env_path / ("Scripts/python3.exe" if os.name == "nt" else "bin/python3"),
        env_path / ("Scripts/python3.11.exe" if os.name == "nt" else "bin/python3.11"),
        env_path / ("Scripts/python3.12.exe" if os.name == "nt" else "bin/python3.12"),
    ]

    for python_exe in python_candidates:
        if python_exe.exists():
            try:
                # Test that Python works
                result = subprocess.run(
                    [
                        str(python_exe),
                        "-c",
                        "import sys; print(f'Python {sys.version_info.major}.{sys.version_info.minor} OK')",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )

                if result.returncode == 0:
                    if verbose:
                        print(f"✅ Python test passed: {result.stdout.strip()}")
                    return python_exe
                elif verbose:
                    print(f"⚠️  Python test failed for {python_exe}: {result.stderr}")

            except Exception as e:
                if verbose:
                    print(f"⚠️  Python test error for {python_exe}: {e}")

    return None


def _verify_component_dependencies(install_path: Path, python_exe: Path, verbose: bool) -> bool:
    """Verify component dependencies can be imported (generic for any component)"""
    requirements_file = install_path / "requirements.txt"

    if not requirements_file.exists():
        if verbose:
            print(f"ℹ️  No requirements.txt found - skipping dependency check")
        return True

    try:
        # Read requirements.txt and extract package names
        with open(requirements_file, "r") as f:
            requirements = f.read().strip().split("\n")

        # Filter out empty lines and comments
        packages = []
        for req in requirements:
            req = req.strip()
            if req and not req.startswith("#"):
                # Extract package name (before any version specifiers)
                package_name = (
                    req.split(">=")[0]
                    .split("==")[0]
                    .split("<=")[0]
                    .split(">")[0]
                    .split("<")[0]
                    .split("!=")[0]
                    .split("~=")[0]
                    .strip()
                )
                if package_name:
                    packages.append(package_name)

        if not packages:
            if verbose:
                print(f"ℹ️  No packages found in requirements.txt")
            return True

        if verbose:
            print(f"🔍 Testing {len(packages)} dependencies: {', '.join(packages)}")

        # Create a generic import test script
        import_tests = []
        for package in packages:
            # Handle special cases for import names vs package names
            import_name = _get_import_name_for_package(package)
            import_tests.append(
                f"""
try:
    import {import_name}
    print(f"✅ {package} imported successfully")
except ImportError as e:
    print(f"❌ Failed to import {package}: {{e}}")
    failed_imports.append("{package}")
except Exception as e:
    print(f"⚠️  Error testing {package}: {{e}}")
"""
            )

        test_script = f"""
failed_imports = []
{chr(10).join(import_tests)}

if failed_imports:
    print(f"Failed to import: {{', '.join(failed_imports)}}")
    exit(1)
else:
    print(f"All {len(packages)} dependencies imported successfully")
    exit(0)
"""

        # Run the import test
        result = subprocess.run([str(python_exe), "-c", test_script], capture_output=True, text=True, timeout=30)

        if verbose:
            if result.stdout:
                for line in result.stdout.strip().split("\n"):
                    if line.strip():
                        print(f"   {line}")

        return result.returncode == 0

    except Exception as e:
        if verbose:
            print(f"❌ Dependency test error: {e}")
        return False


def _get_import_name_for_package(package_name: str) -> str:
    """Convert package name to import name (handles common special cases)"""
    # Common package name to import name mappings
    name_mappings = {
        "pillow": "PIL",
        "python-magic": "magic",
        "python-magic-bin": "magic",
        "pyyaml": "yaml",
        "beautifulsoup4": "bs4",
        "scikit-learn": "sklearn",
        "scikit-image": "skimage",
        "opencv-python": "cv2",
        "opencv-contrib-python": "cv2",
        "pyqt5": "PyQt5",
        "pyqt6": "PyQt6",
        "pyside2": "PySide2",
        "pyside6": "PySide6",
    }

    package_lower = package_name.lower()

    # Check if we have a special mapping
    if package_lower in name_mappings:
        return name_mappings[package_lower]

    # Handle common patterns
    if package_lower.startswith("python-"):
        # python-package -> package
        return package_lower[7:]

    # Default: use package name as-is (works for most packages)
    return package_name


def _verify_component_main_script(install_path: Path, python_exe: Path, verbose: bool) -> bool:
    """Test that the component's main script can be executed"""
    main_script = install_path / "main.py"

    if not main_script.exists():
        return False

    try:
        # Convert paths to absolute to avoid working directory issues
        python_exe_abs = python_exe.resolve()
        main_script_abs = main_script.resolve()
        install_path_abs = install_path.resolve()

        # Verify the Python executable exists before using it
        if not python_exe_abs.exists():
            if verbose:
                print(f"⚠️  Python executable not found: {python_exe_abs}")
            return False

        # Test that main.py can show help
        result = subprocess.run(
            [str(python_exe_abs), str(main_script_abs), "--help"],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=str(install_path_abs),
        )

        # Success if help is shown (exit code 0) or if it fails with "unrecognized arguments"
        success = (
            result.returncode == 0 or "unrecognized arguments" in result.stderr or "invalid choice" in result.stderr
        )

        if verbose:
            if success:
                print(f"✅ Main script can be executed")
            else:
                print(f"⚠️  Main script test inconclusive (exit code: {result.returncode})")
                if result.stderr and len(result.stderr.strip()) > 0:
                    print(f"   STDERR: {result.stderr.strip()[:100]}...")

        return success

    except Exception as e:
        if verbose:
            print(f"⚠️  Main script test error: {e}")
        return False


def _provide_troubleshooting_help(component_name: str):
    """Provide troubleshooting help for installation failures"""
    print("\n🔧 Troubleshooting Tips:")
    print("1. Check that all required files exist in the component directory")
    print("2. Ensure you have sufficient disk space (>100MB recommended)")
    print("3. Try running outside of conda environment:")
    print(f"   conda deactivate && python component_installer.py {component_name}")
    print("4. Check component_system.log for detailed error messages")
    print("5. Verify internet connection for dependency downloads")
    print("6. On macOS/Linux, ensure you have permissions to create files")
    print(f"7. Try manual cleanup: rm -rf pipeline_components/{component_name}/env")


def uninstall_component(component_name: str, verbose: bool = True) -> bool:
    """
    Uninstall a pipeline component

    Args:
        component_name: Name of the component to uninstall
        verbose: Whether to print status messages

    Returns:
        bool: True if uninstallation succeeded, False otherwise
    """
    try:
        manager = _get_manager()

        if verbose:
            print(f"Uninstalling component: {component_name}")

        # Check if component is installed
        if not manager.is_component_installed(component_name):
            if verbose:
                print(f"ℹ️  Component '{component_name}' is not installed")
            return True

        # Uninstall the component
        success = manager.uninstall_component(component_name)

        if verbose:
            if success:
                print(f"✅ Component '{component_name}' uninstalled successfully")
            else:
                print(f"❌ Failed to uninstall component '{component_name}'")

        return success

    except Exception as e:
        if verbose:
            print(f"❌ Uninstallation error: {str(e)}")
        return False


def get_installed_components() -> List[Dict[str, Any]]:
    """
    Get list of all installed components

    Returns:
        List of dictionaries containing component information
    """
    try:
        manager = _get_manager()
        return manager.get_installed_components()
    except Exception as e:
        print(f"❌ Error getting installed components: {str(e)}")
        return []


def get_available_components() -> List[Dict[str, Any]]:
    """
    Get list of all available (not installed) components

    Returns:
        List of dictionaries containing component information
    """
    try:
        discovery = _get_discovery()
        all_components = discovery.discover_all_components()
        return all_components["available"]
    except Exception as e:
        print(f"❌ Error getting available components: {str(e)}")
        return []


def list_all_components(show_details: bool = False) -> Dict[str, List[Dict[str, Any]]]:
    """
    Get all components (available and installed)

    Args:
        show_details: Whether to print detailed information

    Returns:
        Dictionary with 'available', 'installed', and 'invalid' component lists
    """
    try:
        discovery = _get_discovery()
        components = discovery.discover_all_components()

        # Always show basic information
        print("\n📦 Available Components:")
        if components["available"]:
            for component in components["available"]:
                print(f"  • {component['name']} - {component['label']}")
                if show_details:
                    print(f"    📝 {component['description']}")
                    print(f"    📁 Category: {component['category']}")
                    print(f"    🏷️  Version: {component['version']}")
                    if not component["is_valid"]:
                        print(f"    ⚠️  Validation errors: {', '.join(component['validation_errors'])}")
                    print()
        else:
            print("  No available components found")

        print("\n✅ Installed Components:")
        if components["installed"]:
            for component in components["installed"]:
                print(f"  • {component['name']} - {component['label']}")
                if show_details:
                    print(f"    📝 {component['description']}")
                    print(f"    📁 Category: {component['category']}")
                    print(f"    🏷️  Version: {component['version']}")
                    print()
        else:
            print("  No components installed")

        # Only show invalid components if there are any and details are requested
        if show_details and components["invalid"]:
            print("\n❌ Invalid Components:")
            for component in components["invalid"]:
                print(f"  • {component['name']} - {', '.join(component['validation_errors'])}")

        return components

    except Exception as e:
        print(f"❌ Error listing components: {str(e)}")
        return {"available": [], "installed": [], "invalid": []}


def search_components(query: str, category: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Search for components by name, label, or description

    Args:
        query: Search query string
        category: Optional category filter

    Returns:
        List of matching components
    """
    try:
        discovery = _get_discovery()
        return discovery.search_components(query, category)
    except Exception as e:
        print(f"❌ Error searching components: {str(e)}")
        return []


def get_component_info(component_name: str) -> Optional[Dict[str, Any]]:
    """
    Get detailed information about a specific component

    Args:
        component_name: Name of the component

    Returns:
        Component information dictionary or None if not found
    """
    try:
        manager = _get_manager()
        discovery = _get_discovery()

        # Check if installed
        if manager.is_component_installed(component_name):
            return manager.get_component_info(component_name)

        # Check if available
        all_components = discovery.discover_all_components()
        for component in all_components["available"]:
            if component["name"] == component_name:
                return component

        return None

    except Exception as e:
        print(f"❌ Error getting component info: {str(e)}")
        return None


def bulk_install(component_names: List[str], verbose: bool = True) -> Dict[str, bool]:
    """
    Install multiple components

    Args:
        component_names: List of component names to install
        verbose: Whether to print status messages

    Returns:
        Dictionary mapping component names to success status
    """
    results = {}

    if verbose:
        print(f"Installing {len(component_names)} components...")

    for component_name in component_names:
        if verbose:
            print(f"\n--- Installing {component_name} ---")

        success = install_component(component_name, verbose)
        results[component_name] = success

    if verbose:
        print(f"\n📊 Installation Summary:")
        successful = sum(1 for success in results.values() if success)
        print(f"  ✅ Successful: {successful}/{len(component_names)}")
        print(f"  ❌ Failed: {len(component_names) - successful}/{len(component_names)}")

    return results


def optimize_dependencies(verbose: bool = True) -> bool:
    """Optimize shared dependencies across all components"""
    try:
        manager = _get_manager()

        if verbose:
            print("🔧 Analyzing and optimizing component dependencies...")

        if not hasattr(manager, "optimize_dependencies"):
            if verbose:
                print("⚠️  Shared dependencies not enabled")
            return False

        result = manager.optimize_dependencies()

        if verbose:
            if result["optimization_successful"]:
                print("✅ Dependency optimization completed successfully")

                stats = result.get("storage_stats", {})
                if "estimated_savings_mb" in stats:
                    print(f"💾 Estimated storage savings: {stats['estimated_savings_mb']:.1f}MB")

                analysis = result.get("analysis", {})
                if "shared_candidates" in analysis:
                    shared_count = len(analysis["shared_candidates"])
                    print(f"📦 Shared dependencies: {shared_count}")
            else:
                print("❌ Dependency optimization failed")

        return result["optimization_successful"]

    except Exception as e:
        if verbose:
            print(f"❌ Optimization error: {str(e)}")
        return False


def get_storage_report(show_details: bool = False) -> Dict[str, Any]:
    """Get detailed storage and dependency report"""
    try:
        manager = _get_manager()

        if not hasattr(manager, "get_dependency_report"):
            print("⚠️  Shared dependencies not enabled")
            return {}

        report = manager.get_dependency_report()

        print("\n📊 Component Storage Report")
        print("=" * 50)

        storage_stats = report.get("storage_statistics", {})

        if "base_environment_size_mb" in storage_stats:
            print(f"Base environment: {storage_stats['base_environment_size_mb']:.1f}MB")

        if "component_environments" in storage_stats:
            print(f"Component environments:")
            for comp_name, size_mb in storage_stats["component_environments"].items():
                print(f"  • {comp_name}: {size_mb:.1f}MB")

        if "total_size_mb" in storage_stats:
            print(f"Total storage: {storage_stats['total_size_mb']:.1f}MB")

        if "estimated_savings_mb" in storage_stats:
            savings = storage_stats["estimated_savings_mb"]
            print(f"Potential savings: {savings:.1f}MB ({savings/storage_stats.get('total_size_mb', 1)*100:.1f}%)")

        if show_details and "dependency_analysis" in report:
            analysis = report["dependency_analysis"]
            print(f"\n📦 Dependency Analysis:")
            print(f"Total packages analyzed: {analysis.get('total_packages', 0)}")
            print(f"Shared candidates: {len(analysis.get('shared_candidates', {}))}")
            print(f"Component-specific: {len(analysis.get('component_specific', {}))}")

        recommendations = report.get("recommendations", [])
        if recommendations:
            print(f"\n💡 Recommendations:")
            for rec in recommendations:
                print(f"  • {rec}")

        return report

    except Exception as e:
        print(f"❌ Failed to generate storage report: {str(e)}")
        return {}


def main():
    """Command-line interface"""
    parser = argparse.ArgumentParser(
        description="Install and manage pipeline components with shared dependency optimization",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python component_installer.py my_component           # Install component
  python component_installer.py --optimize            # Optimize shared dependencies
  python component_installer.py --storage-report      # Show storage usage
  python component_installer.py --storage-report --details  # Detailed storage report
  python component_installer.py --list --details      # List components with details
        """,
    )

    # Component operations
    parser.add_argument("component_name", nargs="?", help="Name of the component to install")
    parser.add_argument("--uninstall", metavar="COMPONENT", help="Uninstall specified component")
    parser.add_argument("--bulk-install", nargs="+", metavar="COMPONENT", help="Install multiple components")

    # Information commands
    parser.add_argument("--list", action="store_true", help="List all available and installed components")
    parser.add_argument("--installed", action="store_true", help="List only installed components")
    parser.add_argument("--available", action="store_true", help="List only available components")
    parser.add_argument("--search", metavar="QUERY", help="Search components by name/description")
    parser.add_argument("--info", metavar="COMPONENT", help="Get detailed info about a component")
    parser.add_argument("--category", metavar="CATEGORY", help="Filter by category (use with --search)")

    # Optimization commands
    parser.add_argument("--optimize", action="store_true", help="Analyze and optimize shared dependencies")
    parser.add_argument("--storage-report", action="store_true", help="Show storage usage and dependency report")

    # Shared options
    parser.add_argument(
        "--details", action="store_true", help="Show detailed information (use with --list or --storage-report)"
    )

    # Options
    parser.add_argument("--quiet", action="store_true", help="Suppress output messages")

    args = parser.parse_args()

    verbose = not args.quiet

    try:
        # Handle optimization
        if args.optimize:
            success = optimize_dependencies(verbose)
            sys.exit(0 if success else 1)

        # Handle storage report
        if args.storage_report:
            get_storage_report(show_details=args.details)
            return

        # Handle list commands
        if args.list:
            list_all_components(show_details=args.details)
            return

        if args.installed:
            components = get_installed_components()
            if verbose:
                print("✅ Installed Components:")
                for comp in components:
                    print(f"  • {comp['name']} - {comp.get('description', 'No description')}")
            return

        if args.available:
            components = get_available_components()
            if verbose:
                print("📦 Available Components:")
                for comp in components:
                    print(f"  • {comp['name']} - {comp['label']}")
            return

        # Handle search
        if args.search:
            results = search_components(args.search, args.category)
            if verbose:
                print(f"🔍 Search results for '{args.search}':")
                for comp in results:
                    status = "✅ Installed" if comp["is_installed"] else "📦 Available"
                    print(f"  • {comp['name']} - {comp['label']} ({status})")
                    print(f"    📝 {comp['description']}")
            return

        # Handle component info
        if args.info:
            info = get_component_info(args.info)
            if info:
                print(f"📋 Component Information: {args.info}")
                print(f"  Name: {info['name']}")
                print(f"  Label: {info.get('label', 'N/A')}")
                print(f"  Description: {info.get('description', 'N/A')}")
                print(f"  Category: {info.get('category', 'N/A')}")
                print(f"  Version: {info.get('version', 'N/A')}")
                if "is_installed" in info:
                    print(f"  Status: {'✅ Installed' if info['is_installed'] else '📦 Available'}")
            else:
                print(f"❌ Component '{args.info}' not found")
            return

        # Handle uninstall
        if args.uninstall:
            success = uninstall_component(args.uninstall, verbose)
            sys.exit(0 if success else 1)

        # Handle bulk install
        if args.bulk_install:
            results = bulk_install(args.bulk_install, verbose)
            failed = [name for name, success in results.items() if not success]
            sys.exit(0 if not failed else 1)

        # Handle single component install
        if args.component_name:
            success = install_component(args.component_name, verbose)
            sys.exit(0 if success else 1)

        # No action specified, show help
        parser.print_help()

    except KeyboardInterrupt:
        print("\n⚠️  Operation cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
