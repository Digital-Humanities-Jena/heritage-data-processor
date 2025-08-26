# server_app/legacy/shared_dependency_manager.py
"""
Shared Dependency Manager
Manages common dependencies across pipeline components
"""

import subprocess
import sys
import json
import sqlite3
from pathlib import Path
from typing import Dict, List, Set, Any, Optional
import logging
import shutil
import os
import tempfile

from ..routes.component_runner_utils import get_executable_path, get_python_interpreter_path


class SharedDependencyManager:
    """Manages shared dependencies and base environments"""

    def __init__(self, components_dir: Path, db_path: Path):
        self.components_dir = Path(components_dir)
        self.db_path = Path(db_path)
        self.shared_dir = self.components_dir / "_shared"
        self.base_env_path = self.shared_dir / "base_env"
        self.analysis_file = self.shared_dir / "dependency_analysis.json"
        self.shared_requirements_file = self.shared_dir / "shared_requirements.txt"

        # Ensure shared directory exists
        self.shared_dir.mkdir(parents=True, exist_ok=True)

        # Initialize database tables
        self._init_shared_dependency_db()

    def _init_shared_dependency_db(self):
        """Initialize shared dependency tracking tables"""
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript(
                """
            CREATE TABLE IF NOT EXISTS shared_dependencies (
                package_name TEXT PRIMARY KEY,
                version TEXT,
                usage_count INTEGER DEFAULT 0,
                total_size_mb REAL,
                is_shared BOOLEAN DEFAULT 0,
                added_to_base TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS component_dependencies (
                component_name TEXT,
                package_name TEXT,
                version_constraint TEXT,
                is_shared BOOLEAN DEFAULT 0,
                PRIMARY KEY (component_name, package_name)
            );
            """
            )

    def analyze_dependencies(self) -> Dict[str, Any]:
        """Analyze all component dependencies including pip management"""
        logging.info("Analyzing component dependencies for sharing opportunities...")

        all_dependencies = {}
        component_deps = {}

        # Add pip as a universal dependency (it's in every environment)
        pip_info = {"versions": {"latest"}, "components": [], "usage_count": 0}

        # Scan all components
        for component_dir in self.components_dir.iterdir():
            if component_dir.is_dir() and not component_dir.name.startswith("_"):

                # Always add pip to every component's dependencies
                pip_info["components"].append(component_dir.name)
                pip_info["usage_count"] += 1

                # Parse actual requirements.txt if it exists
                if (component_dir / "requirements.txt").exists():
                    deps = self._parse_requirements_file(component_dir / "requirements.txt")
                    component_deps[component_dir.name] = deps

                    # Count dependency usage
                    for dep in deps:
                        package_name = dep["name"]
                        if package_name not in all_dependencies:
                            all_dependencies[package_name] = {"versions": set(), "components": [], "usage_count": 0}

                        all_dependencies[package_name]["versions"].add(dep.get("version", ""))
                        all_dependencies[package_name]["components"].append(component_dir.name)
                        all_dependencies[package_name]["usage_count"] += 1
                else:
                    # Component has no requirements.txt, but still gets pip
                    component_deps[component_dir.name] = []

        # Add pip to dependencies (it's always shared)
        all_dependencies["pip"] = pip_info

        # Determine which dependencies should be shared
        shared_candidates = {}
        component_specific = {}

        for package_name, info in all_dependencies.items():
            usage_count = info["usage_count"]
            version_conflicts = len(info["versions"]) > 1 and not self._are_versions_compatible(info["versions"])

            # Criteria for sharing:
            # 1. pip is ALWAYS shared
            # 2. Used by 2+ components
            # 3. No version conflicts (or compatible versions)
            # 4. Common packages (Pillow, numpy, requests, etc.)
            if (
                package_name == "pip"
                or (usage_count >= 2 and not version_conflicts)
                or package_name.lower() in self._get_common_packages()
            ):
                shared_candidates[package_name] = info
            else:
                component_specific[package_name] = info

        analysis = {
            "total_packages": len(all_dependencies),
            "shared_candidates": shared_candidates,
            "component_specific": component_specific,
            "component_dependencies": component_deps,
            "potential_savings": self._calculate_potential_savings(shared_candidates),
            "pip_included": "pip" in shared_candidates,
            "analysis_timestamp": self._get_timestamp(),
        }

        # Save analysis
        with open(self.analysis_file, "w") as f:
            json_analysis = json.loads(json.dumps(analysis, default=str))
            json.dump(json_analysis, f, indent=2)

        return analysis

    def _are_versions_compatible(self, versions: set) -> bool:
        """Check if version constraints are compatible"""
        # Remove empty versions
        valid_versions = {v.strip() for v in versions if v and v.strip()}

        if len(valid_versions) <= 1:
            return True

        # For now, consider versions compatible if they're all the same
        # In the future, could implement more sophisticated version compatibility checking
        return len(valid_versions) == 1

    def create_base_environment(self, force_recreate: bool = False) -> bool:
        """Create shared base environment with uv."""
        try:
            if self.base_env_path.exists() and force_recreate:
                logging.info("Removing existing base environment for recreation...")
                shutil.rmtree(self.base_env_path)

            if not self.base_env_path.exists():
                logging.info("Creating shared base environment using bundled python...")
                python_interpreter = get_python_interpreter_path()
                command = [python_interpreter, "-m", "venv", str(self.base_env_path)]
                subprocess.run(
                    command,
                    check=True,
                    capture_output=True,
                    text=True,
                )
                logging.info("Base virtual environment created successfully.")

            # Get shared dependencies from the analysis
            analysis = self._load_dependency_analysis()
            if not analysis:
                analysis = self.analyze_dependencies()
            shared_packages = list(analysis["shared_candidates"].keys())

            if shared_packages:
                python_exe = self.base_env_path / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

                # Create a temporary shared requirements file
                self._create_shared_requirements_file(analysis["shared_candidates"])

                uv_executable = get_executable_path("uv")
                # Install shared dependencies using uv pip
                logging.info(f"Installing {len(shared_packages)} shared dependencies with uv...")
                with tempfile.TemporaryDirectory() as temp_dir:
                    env = os.environ.copy()
                    env["UV_CACHE_DIR"] = temp_dir
                    subprocess.run(
                        [
                            uv_executable,
                            "pip",
                            "install",
                            "-r",
                            str(self.shared_requirements_file),
                            "--python",
                            str(python_exe),
                        ],
                        check=True,
                        capture_output=True,
                        text=True,
                        env=env,
                    )

                self._update_shared_dependency_db(analysis["shared_candidates"])
                self._verify_pip_installation(python_exe)  # You can keep this to verify pip's presence
                logging.info("Shared dependencies installed successfully in base environment using uv.")
                return True
            else:
                logging.info("No shared dependencies identified.")
                return False

        except subprocess.CalledProcessError as e:
            logging.error(f"Failed to create or provision base environment with uv: {e.stderr}")
            return False
        except Exception as e:
            logging.error(f"An unexpected error occurred in create_base_environment with uv: {e}")
            return False

    def _verify_pip_installation(self, python_exe: Path):
        """Verify that pip is properly installed and accessible"""
        try:
            # Check pip version
            result = subprocess.run(
                [str(python_exe), "-m", "pip", "--version"], capture_output=True, text=True, check=True
            )

            pip_version = result.stdout.strip()
            logging.info(f"Shared pip installation verified: {pip_version}")

            # Test pip functionality
            result = subprocess.run(
                [str(python_exe), "-m", "pip", "list", "--format=json"], capture_output=True, text=True, check=True
            )

            packages = json.loads(result.stdout)
            logging.info(f"Base environment has {len(packages)} packages installed")

            return True

        except Exception as e:
            logging.warning(f"Pip verification failed: {e}")
            return False

    def create_component_environment(self, component_name: str, component_path: Path) -> Path:
        """Create component-specific environment that inherits shared pip and dependencies"""
        env_path = component_path / "env"

        try:
            # Remove existing environment
            if env_path.exists():
                shutil.rmtree(env_path)

            if self.base_env_path.exists():
                logging.info(
                    f"Creating component environment for {component_name} with shared base (including pip)..."
                )

                # Create venv that can see base environment packages (including pip)
                subprocess.run([sys.executable, "-m", "venv", str(env_path), "--system-site-packages"], check=True)

                # Configure inheritance from base environment
                self._configure_environment_inheritance(env_path, self.base_env_path)

                # Verify pip accessibility in component environment
                python_exe = env_path / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

                # Test that pip works in component environment
                try:
                    result = subprocess.run(
                        [str(python_exe), "-m", "pip", "--version"], capture_output=True, text=True, timeout=10
                    )

                    if result.returncode == 0:
                        logging.info(f"Shared pip accessible in component environment: {result.stdout.strip()}")
                    else:
                        logging.warning("Shared pip not accessible, installing local pip...")
                        subprocess.run([str(python_exe), "-m", "ensurepip", "--upgrade"], check=True)

                except Exception as e:
                    logging.warning(f"Pip accessibility test failed: {e}")
                    # Fallback: ensure pip is available locally
                    subprocess.run([str(python_exe), "-m", "ensurepip", "--upgrade"], check=True)

            else:
                logging.warning("Base environment not found, creating standalone environment")
                subprocess.run([sys.executable, "-m", "venv", str(env_path)], check=True)

                # Upgrade pip in standalone environment
                python_exe = env_path / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
                subprocess.run([str(python_exe), "-m", "pip", "install", "--upgrade", "pip"], check=True)

            # Install only component-specific dependencies (pip is shared)
            component_requirements = self._get_component_specific_requirements(component_name, component_path)
            if component_requirements:
                # Filter out pip from component requirements (it's shared)
                non_pip_requirements = [req for req in component_requirements if not req.lower().startswith("pip")]

                if non_pip_requirements:
                    temp_req_file = component_path / "component_specific_requirements.txt"
                    with open(temp_req_file, "w") as f:
                        f.write("\n".join(non_pip_requirements))

                    subprocess.run([str(python_exe), "-m", "pip", "install", "-r", str(temp_req_file)], check=True)

                    # Clean up temp file
                    temp_req_file.unlink()

            return env_path

        except Exception as e:
            logging.error(f"Failed to create component environment for {component_name}: {e}")
            raise

    def _configure_environment_inheritance(self, component_env: Path, base_env: Path):
        """Configure component environment to inherit from base environment"""
        # Create pth file to add base environment to Python path
        site_packages = component_env / (
            "Lib/site-packages" if sys.platform == "win32" else "lib/python*/site-packages"
        )

        # Find the actual site-packages directory
        if sys.platform == "win32":
            sp_dir = component_env / "Lib/site-packages"
        else:
            # Find python version directory
            lib_dir = component_env / "lib"
            if lib_dir.exists():
                python_dirs = [d for d in lib_dir.iterdir() if d.name.startswith("python")]
                if python_dirs:
                    sp_dir = python_dirs[0] / "site-packages"
                else:
                    return  # Can't find site-packages
            else:
                return

        if sp_dir.exists():
            # Add base environment's site-packages to path
            if sys.platform == "win32":
                base_sp = base_env / "Lib/site-packages"
            else:
                base_lib = base_env / "lib"
                if base_lib.exists():
                    base_python_dirs = [d for d in base_lib.iterdir() if d.name.startswith("python")]
                    if base_python_dirs:
                        base_sp = base_python_dirs[0] / "site-packages"
                    else:
                        return
                else:
                    return

            pth_file = sp_dir / "shared_base.pth"
            with open(pth_file, "w") as f:
                f.write(str(base_sp))

    def _parse_requirements_file(self, req_file: Path) -> List[Dict[str, str]]:
        """Parse requirements.txt file into structured format"""
        dependencies = []

        try:
            with open(req_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        # Parse package name and version constraint
                        if ">=" in line:
                            name, version = line.split(">=", 1)
                            dependencies.append({"name": name.strip(), "version": version.strip(), "constraint": ">="})
                        elif "==" in line:
                            name, version = line.split("==", 1)
                            dependencies.append({"name": name.strip(), "version": version.strip(), "constraint": "=="})
                        else:
                            dependencies.append({"name": line.strip(), "version": "", "constraint": ""})
        except Exception as e:
            logging.warning(f"Failed to parse {req_file}: {e}")

        return dependencies

    def _get_common_packages(self) -> Set[str]:
        """Get set of commonly used packages that should be shared by default"""
        return {
            "pillow",
            "numpy",
            "requests",
            "urllib3",
            "certifi",
            "charset-normalizer",
            "idna",
            "pyyaml",
            "click",
            "jinja2",
            "markupsafe",
            "werkzeug",
            "flask",
            "pandas",
            "python-dateutil",
            "pytz",
            "six",
            "packaging",
            "setuptools",
            "wheel",
            "pip",
            "ftfy",
            "typing-extensions",
        }

    def _create_shared_requirements_file(self, shared_candidates: Dict[str, Any]):
        """Create requirements file for shared dependencies with robust version handling"""
        requirements = []

        for package_name, info in shared_candidates.items():
            try:
                # Get all versions and filter out empty/invalid ones
                versions = set(info.get("versions", []))
                valid_versions = {v.strip() for v in versions if v and v.strip() and v.strip() != "{}"}

                if valid_versions:
                    # Use the most restrictive version (highest version number)
                    best_version = self._select_best_version(valid_versions)
                    if best_version:
                        # Validate version format before using
                        if self._is_valid_version_string(best_version):
                            requirements.append(f"{package_name}>={best_version}")
                        else:
                            logging.warning(f"Invalid version format for {package_name}: {best_version}, using latest")
                            requirements.append(package_name)
                    else:
                        requirements.append(package_name)
                else:
                    # No valid version found, use latest
                    requirements.append(package_name)

            except Exception as e:
                logging.warning(f"Error processing version for {package_name}: {e}")
                # Fallback to package name only
                requirements.append(package_name)

        # Write requirements file with error handling
        try:
            with open(self.shared_requirements_file, "w") as f:
                f.write("\n".join(sorted(requirements)))

            logging.info(f"Created shared requirements file with {len(requirements)} packages")

            # Validate the created file
            self._validate_requirements_file(self.shared_requirements_file)

        except Exception as e:
            logging.error(f"Failed to create shared requirements file: {e}")
            raise

    def _select_best_version(self, versions: set) -> Optional[str]:
        """Select the best version from a set of version strings"""
        if not versions:
            return None

        try:
            # Filter out obviously invalid versions
            valid_versions = []
            for version in versions:
                version = version.strip()
                if (
                    version
                    and not version.startswith("{")
                    and not version.endswith("}")
                    and len(version) > 0
                    and not version.isspace()
                ):
                    valid_versions.append(version)

            if not valid_versions:
                return None

            # If only one valid version, use it
            if len(valid_versions) == 1:
                return valid_versions[0]

            # Try to parse and compare versions
            try:
                from packaging import version

                parsed_versions = []

                for v in valid_versions:
                    try:
                        parsed_versions.append((version.parse(v), v))
                    except Exception:
                        # If parsing fails, skip this version
                        continue

                if parsed_versions:
                    # Sort by version and return the highest (most recent)
                    parsed_versions.sort(key=lambda x: x[0])
                    return parsed_versions[-1][1]  # Return original string of highest version

            except ImportError:
                # packaging not available, use simple string comparison
                pass

            # Fallback: return first valid version alphabetically
            return sorted(valid_versions)[0]

        except Exception as e:
            logging.warning(f"Error selecting best version from {versions}: {e}")
            return None

    def _is_valid_version_string(self, version_str: str) -> bool:
        """Validate that a version string is properly formatted"""
        if not version_str or not version_str.strip():
            return False

        version_str = version_str.strip()

        # Check for obviously invalid patterns
        invalid_patterns = ["{", "}", "[", "]", "(", ")", "<", ">", "|", "&"]
        if any(pattern in version_str for pattern in invalid_patterns):
            return False

        # Check basic version format (numbers and dots, possibly with letters)
        import re

        # Allow versions like: 1.0.0, 1.2.3a1, 2.0.0b1, 1.0.0rc1, etc.
        version_pattern = r"^[0-9]+(\.[0-9]+)*([a-zA-Z][0-9]*)?$"

        return bool(re.match(version_pattern, version_str))

    def _validate_requirements_file(self, req_file: Path):
        """Validate that the requirements file is properly formatted"""
        try:
            with open(req_file, "r") as f:
                content = f.read().strip()

            if not content:
                logging.warning("Requirements file is empty")
                return

            # Try to parse each line
            invalid_lines = []
            for line_num, line in enumerate(content.split("\n"), 1):
                line = line.strip()
                if line and not line.startswith("#"):
                    # Basic validation
                    if any(invalid_char in line for invalid_char in ["{", "}", "|", "&"]):
                        invalid_lines.append((line_num, line))

            if invalid_lines:
                logging.error(f"Invalid lines found in requirements file:")
                for line_num, line in invalid_lines:
                    logging.error(f"  Line {line_num}: {line}")

                # Create a cleaned version
                self._create_cleaned_requirements_file(req_file)

        except Exception as e:
            logging.error(f"Failed to validate requirements file: {e}")

    def _create_cleaned_requirements_file(self, req_file: Path):
        """Create a cleaned version of the requirements file"""
        try:
            backup_file = req_file.with_suffix(".txt.backup")

            # Backup original file
            shutil.copy2(req_file, backup_file)
            logging.info(f"Backed up requirements file to {backup_file}")

            # Read and clean the file
            with open(req_file, "r") as f:
                lines = f.readlines()

            cleaned_lines = []
            for line in lines:
                line = line.strip()
                if line and not line.startswith("#"):
                    # Extract just the package name if line is malformed
                    package_name = line.split(">=")[0].split("==")[0].split("<")[0].strip()
                    if package_name and self._is_valid_package_name(package_name):
                        cleaned_lines.append(package_name)
                    else:
                        logging.warning(f"Skipping invalid package line: {line}")

            # Write cleaned file
            with open(req_file, "w") as f:
                f.write("\n".join(sorted(cleaned_lines)))

            logging.info(f"Created cleaned requirements file with {len(cleaned_lines)} packages")

        except Exception as e:
            logging.error(f"Failed to create cleaned requirements file: {e}")

    def _is_valid_package_name(self, package_name: str) -> bool:
        """Check if a package name is valid"""
        if not package_name or not package_name.strip():
            return False

        package_name = package_name.strip()

        # Package names should only contain letters, numbers, underscores, hyphens, and dots
        import re

        pattern = r"^[a-zA-Z0-9._-]+$"

        return bool(re.match(pattern, package_name)) and len(package_name) > 0

    def _get_component_specific_requirements(self, component_name: str, component_path: Path) -> List[str]:
        """Get requirements that are specific to this component (not shared)"""
        req_file = component_path / "requirements.txt"
        if not req_file.exists():
            return []

        analysis = self._load_dependency_analysis()
        if not analysis:
            return []

        shared_packages = set(analysis["shared_candidates"].keys())
        component_deps = self._parse_requirements_file(req_file)

        component_specific = []
        for dep in component_deps:
            if dep["name"].lower() not in shared_packages:
                if dep["constraint"] and dep["version"]:
                    component_specific.append(f"{dep['name']}{dep['constraint']}{dep['version']}")
                else:
                    component_specific.append(dep["name"])

        return component_specific

    def _calculate_potential_savings(self, shared_candidates: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate potential disk space savings including pip"""
        # Updated package sizes with pip
        package_sizes = {
            "pip": 25,  # pip is quite large with all its dependencies
            "setuptools": 15,
            "wheel": 5,
            "pillow": 15,
            "numpy": 50,
            "pandas": 80,
            "requests": 2,
            "urllib3": 1,
            "certifi": 1,
            "charset-normalizer": 1,
            "pyyaml": 5,
            "jinja2": 3,
            "flask": 5,
            "ftfy": 2,
            "pygltflib": 10,
            "python-magic": 1,
            "pypdf2": 5,
            "mutagen": 3,
        }

        total_savings_mb = 0
        savings_breakdown = {}

        for package_name, info in shared_candidates.items():
            usage_count = info["usage_count"]
            estimated_size = package_sizes.get(package_name.lower(), 5)

            if usage_count > 1:
                savings = estimated_size * (usage_count - 1)
                total_savings_mb += savings
                savings_breakdown[package_name] = {
                    "size_per_install_mb": estimated_size,
                    "usage_count": usage_count,
                    "savings_mb": savings,
                }

        return {
            "total_savings_mb": total_savings_mb,
            "breakdown": savings_breakdown,
            "percentage_saved": min(total_savings_mb / max(sum(package_sizes.values()) * 6, 1) * 100, 80),
            "pip_savings_mb": savings_breakdown.get("pip", {}).get("savings_mb", 0),
        }

    def _load_dependency_analysis(self) -> Optional[Dict[str, Any]]:
        """Load dependency analysis from file"""
        if self.analysis_file.exists():
            try:
                with open(self.analysis_file, "r") as f:
                    return json.load(f)
            except Exception as e:
                logging.warning(f"Failed to load dependency analysis: {e}")
        return None

    def _update_shared_dependency_db(self, shared_candidates: Dict[str, Any]):
        """Update database with shared dependency information"""
        with sqlite3.connect(self.db_path) as conn:
            for package_name, info in shared_candidates.items():
                conn.execute(
                    """
                INSERT OR REPLACE INTO shared_dependencies 
                (package_name, usage_count, is_shared, added_to_base)
                VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                """,
                    (package_name, info["usage_count"]),
                )

    def _get_timestamp(self) -> str:
        """Get current timestamp"""
        from datetime import datetime

        return datetime.now().isoformat()

    def get_storage_stats(self) -> Dict[str, Any]:
        """Get current storage statistics"""
        stats = {
            "base_environment_size_mb": 0,
            "component_environments": {},
            "total_size_mb": 0,
            "estimated_savings_mb": 0,
        }

        # Calculate base environment size
        if self.base_env_path.exists():
            stats["base_environment_size_mb"] = self._get_directory_size_mb(self.base_env_path)

        # Calculate component environment sizes
        for component_dir in self.components_dir.iterdir():
            if component_dir.is_dir() and not component_dir.name.startswith("_"):
                env_path = component_dir / "env"
                if env_path.exists():
                    size_mb = self._get_directory_size_mb(env_path)
                    stats["component_environments"][component_dir.name] = size_mb
                    stats["total_size_mb"] += size_mb

        stats["total_size_mb"] += stats["base_environment_size_mb"]

        # Load analysis for savings estimate
        analysis = self._load_dependency_analysis()
        if analysis and "potential_savings" in analysis:
            stats["estimated_savings_mb"] = analysis["potential_savings"]["total_savings_mb"]

        return stats

    def _get_directory_size_mb(self, path: Path) -> float:
        """Get directory size in MB"""
        total_size = 0
        try:
            for dirpath, dirnames, filenames in os.walk(path):
                for filename in filenames:
                    filepath = os.path.join(dirpath, filename)
                    try:
                        total_size += os.path.getsize(filepath)
                    except (OSError, FileNotFoundError):
                        pass
        except Exception:
            pass

        return total_size / (1024 * 1024)  # Convert to MB
