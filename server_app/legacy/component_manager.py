# server_app/legacy/component_manager.py
import os
import subprocess
import json
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import yaml
import logging

from .shared_dependency_manager import SharedDependencyManager


class ComponentInstallationError(Exception):
    """
    Custom exception raised for errors during the installation of a pipeline component.

    This exception is designed to capture rich contextual information about the failure,
    such as the component's name, the exit code of a failed subprocess, and
    detailed error logs (like stderr output).

    Attributes:
        message (str): The primary, human-readable error message.
        component_name (Optional[str]): The name of the component that failed to install.
        exit_code (Optional[int]): The exit code from a failed subprocess, if applicable.
        details (Optional[str]): Additional details, such as stderr from a command,
                                 to aid in debugging.
    """

    def __init__(
        self,
        message: str,
        *,
        component_name: Optional[str] = None,
        exit_code: Optional[int] = None,
        details: Optional[str] = None,
    ):
        """
        Initializes the ComponentInstallationError.

        Args:
            message (str): The primary error message.
            component_name (Optional[str]): Keyword-only. The name of the component.
            exit_code (Optional[int]): Keyword-only. The exit code of a failed process.
            details (Optional[str]): Keyword-only. Detailed error information or logs.
        """
        # Call the base class constructor with the primary message
        super().__init__(message)

        # Store the rich context as attributes
        self.message = message
        self.component_name = component_name
        self.exit_code = exit_code
        self.details = details

    def __str__(self) -> str:
        """
        Provides a clean, informative string representation for logging and display.
        """
        parts = []

        # Start with the component name for clear identification
        if self.component_name:
            parts.append(f"[{self.component_name}]")

        # Add the primary message
        parts.append(self.message)

        # Append the exit code if available
        if self.exit_code is not None:
            parts.append(f"(Exit Code: {self.exit_code})")

        # Create the main error line
        error_line = " ".join(parts)

        # Append multi-line details at the end for readability
        if self.details:
            # Indent details for better visual structure
            indented_details = "\n".join(f"  {line}" for line in self.details.strip().split("\n"))
            return f"{error_line}\n--- Details ---\n{indented_details}"

        return error_line

    def __repr__(self) -> str:
        """
        Provides an unambiguous, developer-focused representation of the object.
        """
        return (
            f"{self.__class__.__name__}("
            f"message='{self.message}', "
            f"component_name='{self.component_name}', "
            f"exit_code={self.exit_code})"
        )


class ComponentEnvironmentManager:
    """Generic manager for virtual environments and installation of pipeline components"""

    def __init__(self, components_dir: Path, db_path: Path, use_shared_deps: bool = True):
        self.components_dir = Path(components_dir)
        self.db_path = Path(db_path)
        self.use_shared_deps = use_shared_deps
        self.components_dir.mkdir(parents=True, exist_ok=True)

        # Initialize shared dependency manager
        if self.use_shared_deps:
            self.shared_manager = SharedDependencyManager(components_dir, db_path)

        self._init_database()

    def _init_database(self):
        """Initialize the enhanced component registry database with installation config support"""
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript(
                """
            CREATE TABLE IF NOT EXISTS installed_components (
                name TEXT PRIMARY KEY,
                version TEXT,
                status TEXT,
                install_path TEXT,
                env_path TEXT,
                installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_used TIMESTAMP,
                installation_config TEXT  -- JSON field for installation configuration
            );
            
            CREATE TABLE IF NOT EXISTS component_configurations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                component_name TEXT,
                config_type TEXT DEFAULT 'runtime',  -- 'installation' or 'runtime'
                parameters TEXT,  -- JSON configuration
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (component_name) REFERENCES installed_components (name)
            );
            
            CREATE TABLE IF NOT EXISTS component_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                component_name TEXT,
                execution_id TEXT,
                input_data TEXT,
                output_path TEXT,
                success BOOLEAN,
                error_message TEXT,
                execution_time REAL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (component_name) REFERENCES installed_components (name)
            );
            
            CREATE TABLE IF NOT EXISTS component_dependencies (
                component_name TEXT,
                dependency_name TEXT,
                version_constraint TEXT,
                dependency_type TEXT DEFAULT 'required',
                PRIMARY KEY (component_name, dependency_name)
            );
            """
            )

            # Migrate existing data to add installation_config column if it doesn't exist
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(installed_components)")
            columns = [column[1] for column in cursor.fetchall()]

            if "installation_config" not in columns:
                cursor.execute("ALTER TABLE installed_components ADD COLUMN installation_config TEXT")
                logging.info("Added installation_config column to installed_components table")

    def install_component(
        self, component_name: str, skip_install_script: bool = False
    ) -> Tuple[bool, List[Dict[str, str]]]:
        """
        Enhanced installation that creates a dedicated 'uv' environment for each component.
        Returns a tuple of (success_status, logs).
        """
        try:
            component_path = self.components_dir / component_name

            if not self._validate_component_structure(component_path):
                msg = f"Invalid component structure for '{component_name}'. Check for missing files or malformed YAML."
                return False, [{"level": "error", "message": msg}]

            env_path = component_path / "env"
            self._create_virtual_environment(env_path)
            self._install_python_dependencies(component_path, env_path)

            script_success, script_logs = True, []
            if not skip_install_script:
                script_success, script_logs = self._run_component_installation_script(component_path, env_path)
                if not script_success:
                    return False, script_logs
            else:
                logging.info(f"Skipping install script execution for {component_name} (external file provision)")

            self._register_component_in_database(component_name, component_path, env_path)

            logging.info(f"Component {component_name} installed successfully using a dedicated 'uv' environment.")
            return True, script_logs

        except Exception as e:
            logging.error(f"Failed to install component {component_name}: {e}", exc_info=True)
            logs = [{"level": "error", "message": f"Installation failed for '{component_name}': {e}"}]
            return False, logs

    def _ensure_shared_environment(self):
        """Ensure shared base environment exists and is up to date"""
        if not self.use_shared_deps:
            return

        # Check if base environment exists
        if not self.shared_manager.base_env_path.exists():
            logging.info("Creating shared base environment...")
            self.shared_manager.create_base_environment()
        else:
            # Check if dependency analysis is outdated
            analysis = self.shared_manager._load_dependency_analysis()
            if not analysis:
                logging.info("Running dependency analysis...")
                self.shared_manager.analyze_dependencies()
                self.shared_manager.create_base_environment(force_recreate=True)

    def optimize_dependencies(self) -> Dict[str, Any]:
        """Analyze and optimize shared dependencies"""
        if not self.use_shared_deps:
            return {"status": "shared_dependencies_disabled"}

        logging.info("Optimizing component dependencies...")

        # Run analysis
        analysis = self.shared_manager.analyze_dependencies()

        # Recreate base environment with optimized dependencies
        success = self.shared_manager.create_base_environment(force_recreate=True)

        # Get storage statistics
        stats = self.shared_manager.get_storage_stats()

        return {"optimization_successful": success, "analysis": analysis, "storage_stats": stats}

    def get_dependency_report(self) -> Dict[str, Any]:
        """Get comprehensive dependency and storage report"""
        if not self.use_shared_deps:
            return {"status": "shared_dependencies_disabled"}

        analysis = self.shared_manager._load_dependency_analysis()
        if not analysis:
            analysis = self.shared_manager.analyze_dependencies()

        storage_stats = self.shared_manager.get_storage_stats()

        return {
            "dependency_analysis": analysis,
            "storage_statistics": storage_stats,
            "recommendations": self._get_optimization_recommendations(analysis, storage_stats),
        }

    def _get_optimization_recommendations(self, analysis: Dict[str, Any], storage_stats: Dict[str, Any]) -> List[str]:
        """Generate optimization recommendations"""
        recommendations = []

        if storage_stats["estimated_savings_mb"] > 50:
            recommendations.append(f"Potential storage savings: {storage_stats['estimated_savings_mb']:.1f}MB")

        if len(analysis["shared_candidates"]) < 3:
            recommendations.append("Consider installing more components to benefit from shared dependencies")

        if storage_stats["base_environment_size_mb"] > 200:
            recommendations.append("Base environment is large - consider splitting into multiple shared environments")

        return recommendations

    def _validate_component_structure(self, component_path: Path) -> bool:
        """Validate that component has required files and structure"""
        if not component_path.exists():
            logging.error(f"Component directory not found: {component_path}")
            return False

        required_files = ["component.yaml", "main.py", "processor.py"]

        for file_name in required_files:
            file_path = component_path / file_name
            if not file_path.exists():
                logging.error(f"Missing required file: {file_path}")
                return False

        # Validate YAML structure
        try:
            yaml_file = component_path / "component.yaml"
            with open(yaml_file, "r") as f:
                config = yaml.safe_load(f)

            required_yaml_fields = ["name", "label", "description", "inputs", "outputs"]
            for field in required_yaml_fields:
                if field not in config:
                    logging.error(f"Missing required YAML field: {field}")
                    return False

        except Exception as e:
            logging.error(f"Invalid YAML configuration: {e}")
            return False

        return True

    def _create_virtual_environment(self, env_path: Path):
        """Create virtual environment using uv."""
        try:
            if env_path.exists():
                import shutil

                shutil.rmtree(env_path)

            # Create the virtual environment using uv
            subprocess.run(
                ["uv", "venv", str(env_path), "--python", "3.11"],
                check=True,
                capture_output=True,
                text=True,
            )
            logging.info(f"uv virtual environment created successfully at: {env_path}")

            # Verify the environment and get the Python executable path
            python_exe = self._find_working_python_executable(env_path)
            if not python_exe:
                raise Exception("Failed to find Python executable in the new uv environment.")

        except subprocess.CalledProcessError as e:
            logging.error(f"Failed to create uv environment: {e.stderr}")
            raise
        except Exception as e:
            logging.error(f"An unexpected error occurred while creating the uv environment: {e}")
            # Clean up on failure
            if env_path.exists():
                import shutil

                shutil.rmtree(env_path, ignore_errors=True)
            raise

    def _configure_shared_environment_inheritance(self, env_path: Path):
        """Configure environment to inherit from shared base environment"""
        try:
            if not (hasattr(self, "shared_manager") and self.shared_manager.base_env_path.exists()):
                return

            # Find site-packages directory in component environment
            if os.name == "nt":  # Windows
                site_packages_dir = env_path / "Lib" / "site-packages"
            else:  # Unix/Linux/macOS
                # Find python version directory
                lib_dir = env_path / "lib"
                if lib_dir.exists():
                    python_dirs = [d for d in lib_dir.iterdir() if d.name.startswith("python")]
                    if python_dirs:
                        site_packages_dir = python_dirs[0] / "site-packages"
                    else:
                        logging.warning("Could not find python version directory")
                        return
                else:
                    logging.warning("Could not find lib directory")
                    return

            if not site_packages_dir.exists():
                logging.warning(f"Site-packages directory not found: {site_packages_dir}")
                return

            # Find base environment site-packages
            base_env = self.shared_manager.base_env_path
            if os.name == "nt":  # Windows
                base_site_packages = base_env / "Lib" / "site-packages"
            else:  # Unix/Linux/macOS
                base_lib = base_env / "lib"
                if base_lib.exists():
                    base_python_dirs = [d for d in base_lib.iterdir() if d.name.startswith("python")]
                    if base_python_dirs:
                        base_site_packages = base_python_dirs[0] / "site-packages"
                    else:
                        logging.warning("Could not find base python version directory")
                        return
                else:
                    logging.warning("Could not find base lib directory")
                    return

            if not base_site_packages.exists():
                logging.warning(f"Base site-packages directory not found: {base_site_packages}")
                return

            # Create .pth file to add base environment to Python path
            pth_file = site_packages_dir / "shared_base_environment.pth"
            try:
                with open(pth_file, "w") as f:
                    f.write(str(base_site_packages))
                logging.info(f"Created path file for shared dependencies: {pth_file}")
            except Exception as e:
                logging.warning(f"Failed to create shared environment path file: {e}")

        except Exception as e:
            logging.warning(f"Failed to configure shared environment inheritance: {e}")

    def _install_python_dependencies(self, component_path: Path, env_path: Path):
        """Install Python dependencies using uv pip."""
        requirements_file = component_path / "requirements.txt"
        if not requirements_file.exists():
            logging.info("No requirements.txt found, skipping dependency installation.")
            return

        try:
            # Use uv to install packages from the requirements file into the specified environment
            subprocess.run(
                [
                    "uv",
                    "pip",
                    "install",
                    "-r",
                    str(requirements_file),
                    "--python",
                    str(self._find_working_python_executable(env_path)),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            logging.info(f"Dependencies from {requirements_file} installed successfully using uv.")

        except subprocess.CalledProcessError as e:
            logging.error(f"Failed to install dependencies using uv: {e.stderr}")
            raise Exception(f"Failed to install dependencies for {component_path.name}")
        except Exception as e:
            logging.error(f"An unexpected error occurred during dependency installation with uv: {e}")
            raise

    def _run_component_installation_script(
        self, component_path: Path, env_path: Path
    ) -> Tuple[bool, List[Dict[str, str]]]:
        """
        Generic execution of component's install.py, capturing detailed logs.
        Returns a tuple of (success_status, logs).
        """
        logs = []
        install_script = component_path / "install.py"
        if not install_script.exists():
            logs.append({"level": "info", "message": "No install.py found, skipping custom installation script."})
            return True, logs

        python_exe = self._find_working_python_executable(env_path)
        if not python_exe:
            logs.append({"level": "error", "message": f"No working Python executable found in {env_path}"})
            return False, logs

        logs.append({"level": "info", "message": f"Running custom install script: {install_script}"})
        try:
            # Ensure all paths are absolute before changing the current working directory
            python_exe_abs = python_exe.resolve()
            install_script_abs = install_script.resolve()
            component_path_abs = component_path.resolve()

            result = subprocess.run(
                [str(python_exe_abs), str(install_script_abs)],
                check=False,
                cwd=str(component_path_abs),
                capture_output=True,
                text=True,
                timeout=300,
            )

            if result.stdout:
                logs.append({"level": "stdout", "message": result.stdout.strip()})

            if result.returncode == 0:
                if result.stderr:
                    logs.append({"level": "warning", "message": f"Script produced warnings:\n{result.stderr.strip()}"})
                logs.append({"level": "success", "message": "Component setup script completed successfully."})
                return True, logs
            else:
                if result.stderr:
                    logs.append({"level": "stderr", "message": result.stderr.strip()})
                logs.append(
                    {"level": "error", "message": f"Install script failed with exit code {result.returncode}."}
                )
                return False, logs

        except subprocess.TimeoutExpired:
            logs.append({"level": "error", "message": "Install script timed out after 300 seconds."})
            return False, logs
        except Exception as e:
            logs.append(
                {"level": "error", "message": f"An unexpected error occurred while running install script: {e}"}
            )
            return False, logs

    def _find_working_python_executable(self, env_path: Path) -> Optional[Path]:
        """Find a working Python executable using multiple strategies (generic)"""

        # Try standard virtual environment paths
        python_candidates = [
            env_path / ("Scripts/python.exe" if os.name == "nt" else "bin/python"),
            env_path / ("Scripts/python3.exe" if os.name == "nt" else "bin/python3"),
            env_path / ("Scripts/python3.11.exe" if os.name == "nt" else "bin/python3.11"),
            env_path / ("Scripts/python3.12.exe" if os.name == "nt" else "bin/python3.12"),
        ]

        for candidate in python_candidates:
            if self._test_python_executable(candidate):
                return candidate

        # Try resolving symlinks
        for candidate in python_candidates:
            try:
                if candidate.is_symlink():
                    resolved_path = candidate.resolve()
                    if self._test_python_executable(resolved_path):
                        logging.info(f"Using resolved symlink: {candidate} -> {resolved_path}")
                        return resolved_path
            except Exception:
                continue

        return None

    def _test_python_executable(self, python_path: Path) -> bool:
        """Test if a Python executable works (generic)"""
        try:
            if not python_path.exists() or not os.access(python_path, os.X_OK):
                return False

            result = subprocess.run(
                [str(python_path), "-c", "import sys; print('OK')"], capture_output=True, text=True, timeout=5
            )

            return result.returncode == 0

        except Exception:
            return False

    def _is_executable(self, path: Path) -> bool:
        """Check if a file exists and is executable"""
        try:
            return path.exists() and os.access(path, os.X_OK)
        except Exception:
            return False

    def _register_component_in_database(
        self, component_name: str, component_path: Path, env_path: Path, installation_config: dict = None
    ):
        """Enhanced registration that stores installation configuration"""
        try:
            # Prepare installation config
            config_json = json.dumps(installation_config) if installation_config else None

            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO installed_components 
                    (name, version, status, install_path, env_path, installation_config, installed_at)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                    """,
                    (component_name, "1.0.0", "installed", str(component_path), str(env_path), config_json),
                )

                # Also store installation configuration separately for easier querying
                if installation_config:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO component_configurations 
                        (component_name, config_type, parameters, updated_at)
                        VALUES (?, 'installation', ?, datetime('now'))
                        """,
                        (component_name, json.dumps(installation_config)),
                    )

                conn.commit()
                logging.info(f"Component {component_name} registered with installation config")

        except Exception as e:
            logging.error(f"Failed to register component {component_name}: {e}")
            raise

    def uninstall_component(self, component_name: str) -> bool:
        """Uninstall a component and clean up its environment"""
        try:
            # Get component info
            component_info = self.get_component_info(component_name)
            if not component_info:
                logging.warning(f"Component {component_name} not found in database")
                return False

            # Remove virtual environment
            env_path = Path(component_info["env_path"])
            if env_path.exists():
                import shutil

                shutil.rmtree(env_path, ignore_errors=True)
                logging.info(f"Removed virtual environment: {env_path}")

            # Update database status
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    "UPDATE installed_components SET status = 'uninstalled' WHERE name = ?", (component_name,)
                )

            logging.info(f"Component {component_name} uninstalled successfully")
            return True

        except Exception as e:
            logging.error(f"Failed to uninstall component {component_name}: {e}")
            return False

    def get_component_installation_config(self, component_name: str) -> dict:
        """Retrieve installation configuration for a component"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                # Try to get from installation_config column first
                cursor.execute(
                    "SELECT installation_config FROM installed_components WHERE name = ?", (component_name,)
                )
                result = cursor.fetchone()

                if result and result[0]:
                    return json.loads(result[0])

                # Fallback: try component_configurations table
                cursor.execute(
                    """
                    SELECT parameters FROM component_configurations 
                    WHERE component_name = ? AND config_type = 'installation'
                    ORDER BY updated_at DESC LIMIT 1
                    """,
                    (component_name,),
                )
                result = cursor.fetchone()

                if result and result[0]:
                    return json.loads(result[0])

                return {}

        except Exception as e:
            logging.error(f"Failed to retrieve installation config for {component_name}: {e}")
            return {}

    def get_component_info(self, component_name: str) -> Optional[Dict[str, Any]]:
        """Get detailed information about a specific component"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT * FROM installed_components WHERE name = ?", (component_name,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def is_component_installed(self, component_name: str) -> bool:
        """Check if a component is installed"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "SELECT COUNT(*) FROM installed_components WHERE name = ? AND status = 'installed'", (component_name,)
            )
            return cursor.fetchone()[0] > 0

    def get_installed_components(self) -> List[Dict[str, Any]]:
        """Get list of all installed components"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT * FROM installed_components WHERE status = 'installed'")
            return [dict(row) for row in cursor.fetchall()]

    def get_components_by_category(self, category: str) -> List[Dict[str, Any]]:
        """Get installed components filtered by category"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                "SELECT * FROM installed_components WHERE status = 'installed' AND category = ?", (category,)
            )
            return [dict(row) for row in cursor.fetchall()]

    def update_component_last_used(self, component_name: str):
        """Update the last used timestamp for a component"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE installed_components SET last_used = CURRENT_TIMESTAMP WHERE name = ?", (component_name,)
            )

    def get_component_statistics(self) -> Dict[str, Any]:
        """Get overall component statistics"""
        with sqlite3.connect(self.db_path) as conn:
            # Get component counts by category
            cursor = conn.execute(
                """
                SELECT category, COUNT(*) as count 
                FROM installed_components 
                WHERE status = 'installed' 
                GROUP BY category
            """
            )
            category_counts = dict(cursor.fetchall())

            # Get total counts
            cursor = conn.execute("SELECT COUNT(*) FROM installed_components WHERE status = 'installed'")
            total_installed = cursor.fetchone()[0]

            # Get execution statistics
            cursor = conn.execute(
                """
                SELECT 
                    COUNT(*) as total_executions,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_executions,
                    AVG(execution_time) as avg_execution_time
                FROM component_executions
            """
            )
            exec_stats = cursor.fetchone()

            return {
                "total_installed": total_installed,
                "by_category": category_counts,
                "total_executions": exec_stats[0] or 0,
                "successful_executions": exec_stats[1] or 0,
                "average_execution_time": exec_stats[2] or 0,
            }

    def _validate_virtual_environment(self, env_path: Path) -> bool:
        """Validate that the virtual environment is working correctly"""
        try:
            python_exe = env_path / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

            # Test that Python can be executed
            result = subprocess.run(
                [str(python_exe), "-c", "import sys; print(sys.executable)"],
                capture_output=True,
                text=True,
                timeout=10,
            )

            if result.returncode != 0:
                logging.error(f"Python executable test failed: {result.stderr}")
                return False

            logging.info(f"Virtual environment validation successful: {result.stdout.strip()}")
            return True

        except Exception as e:
            logging.error(f"Virtual environment validation failed: {e}")
            return False
