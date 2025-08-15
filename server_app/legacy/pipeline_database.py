# server_app/legacy/pipeline_database.py
import sqlite3
import json
import yaml
import uuid
from pathlib import Path
from typing import Dict, List, Any, Optional, Union
import logging
from contextlib import contextmanager

# Set up basic logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


class PipelineDatabaseManager:
    """
    Manages the pipeline database operations and schema in a thread-safe manner.
    Connections are created and closed on a per-operation basis.
    """

    def __init__(self, db_path: Union[str, Path]):
        """Initializes the manager with the path to the database file."""
        self.db_path = Path(db_path)
        self.initialize_database()

    @contextmanager
    def _get_connection(self):
        """Provides a thread-safe database connection as a context manager."""
        conn = None
        try:
            conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON;")
            yield conn
        except sqlite3.Error as e:
            logging.error(f"Database connection error to {self.db_path}: {e}")
            raise
        finally:
            if conn:
                conn.close()

    def initialize_database(self):
        """Ensures the database schema (tables, indexes, etc.) is created."""
        try:
            with self._get_connection() as conn:
                self._create_tables(conn)
                self._create_indexes(conn)
                self._create_triggers(conn)
                self._create_views(conn)
                self._update_schema(conn)
            logging.info(f"Pipeline database schema verified/initialized at {self.db_path}")
        except Exception as e:
            logging.error(f"Failed to initialize pipeline database: {e}", exc_info=True)
            raise

    def _execute_many(self, conn: sqlite3.Connection, statements: List[str]):
        """Helper to execute multiple SQL statements within a transaction."""
        cursor = conn.cursor()
        for sql in statements:
            try:
                cursor.execute(sql)
            except sqlite3.Error as e:
                logging.warning(f"Failed to execute statement: {sql[:60]}... - Error: {e}")
        conn.commit()

    def _create_tables(self, conn: sqlite3.Connection):
        """Create all database tables using the provided connection."""
        tables_sql = [
            """
            CREATE TABLE IF NOT EXISTS pipelines (
                pipeline_id INTEGER PRIMARY KEY AUTOINCREMENT,
                identifier TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT,
                primary_modality TEXT NOT NULL,
                processing_mode TEXT NOT NULL CHECK (processing_mode IN ('root', 'subdirectory')),
                version TEXT NOT NULL DEFAULT '1.0.0',
                status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived', 'deprecated')),
                tags TEXT,
                notes TEXT,
                created_by TEXT,
                created_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_modified_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                yaml_source TEXT,
                execution_count INTEGER NOT NULL DEFAULT 0,
                last_executed_timestamp DATETIME,
                metadata_mapping TEXT,
                zenodoDraftStepEnabled BOOLEAN NOT NULL DEFAULT 1,
                zenodoUploadStepEnabled BOOLEAN NOT NULL DEFAULT 1,
                zenodoPublishStepEnabled BOOLEAN NOT NULL DEFAULT 0,
                description_constructor_enabled BOOLEAN NOT NULL DEFAULT 0,
                description_template TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS pipeline_steps (
                step_id INTEGER PRIMARY KEY AUTOINCREMENT,
                pipeline_id INTEGER NOT NULL,
                step_number INTEGER NOT NULL,
                step_name TEXT,
                component_name TEXT NOT NULL,
                component_category TEXT NOT NULL,
                component_version TEXT,
                is_optional BOOLEAN NOT NULL DEFAULT FALSE,
                on_error_action TEXT NOT NULL DEFAULT 'fail' CHECK (on_error_action IN ('fail', 'skip', 'retry', 'warn')),
                timeout_seconds INTEGER DEFAULT 300,
                memory_limit_mb INTEGER DEFAULT 512,
                cpu_limit INTEGER DEFAULT 1,
                parallel_execution BOOLEAN NOT NULL DEFAULT FALSE,
                depends_on_steps TEXT,
                condition_expression TEXT,
                input_mapping TEXT,
                created_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (pipeline_id) REFERENCES pipelines(pipeline_id) ON DELETE CASCADE,
                UNIQUE (pipeline_id, step_number)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS step_files (
                file_id INTEGER PRIMARY KEY AUTOINCREMENT,
                step_id INTEGER NOT NULL,
                conceptual_id TEXT,
                file_role TEXT NOT NULL CHECK (file_role IN ('input', 'output', 'parameter')),
                file_name TEXT NOT NULL,
                file_type TEXT NOT NULL,
                filename_pattern TEXT NOT NULL,
                mime_type TEXT,
                is_required BOOLEAN NOT NULL DEFAULT TRUE,
                is_source_file BOOLEAN NOT NULL DEFAULT FALSE,
                replace_source_file BOOLEAN NOT NULL DEFAULT FALSE,
                add_to_record BOOLEAN NOT NULL DEFAULT TRUE,
                source_step_id INTEGER,
                file_order INTEGER NOT NULL DEFAULT 0,
                validation_rules TEXT,
                metadata TEXT,
                output_mapping TEXT,
                FOREIGN KEY (step_id) REFERENCES pipeline_steps(step_id) ON DELETE CASCADE,
                FOREIGN KEY (source_step_id) REFERENCES pipeline_steps(step_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS component_parameters (
                parameter_id INTEGER PRIMARY KEY AUTOINCREMENT,
                step_id INTEGER NOT NULL,
                parameter_name TEXT NOT NULL,
                parameter_type TEXT NOT NULL CHECK (parameter_type IN ('str', 'int', 'float', 'bool', 'list', 'dict')),
                parameter_value TEXT NOT NULL,
                default_value TEXT,
                is_required BOOLEAN NOT NULL DEFAULT FALSE,
                validation_rules TEXT,
                description TEXT,
                FOREIGN KEY (step_id) REFERENCES pipeline_steps(step_id) ON DELETE CASCADE,
                UNIQUE (step_id, parameter_name)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS pipeline_executions (
                execution_id INTEGER PRIMARY KEY AUTOINCREMENT,
                pipeline_id INTEGER NOT NULL,
                execution_uuid TEXT NOT NULL UNIQUE,
                project_id INTEGER,
                status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'paused')),
                progress_percentage REAL DEFAULT 0.0 CHECK (progress_percentage >= 0.0 AND progress_percentage <= 100.0),
                current_step_id INTEGER,
                total_steps INTEGER NOT NULL DEFAULT 0,
                completed_steps INTEGER NOT NULL DEFAULT 0,
                failed_steps INTEGER NOT NULL DEFAULT 0,
                skipped_steps INTEGER NOT NULL DEFAULT 0,
                start_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                end_timestamp DATETIME,
                duration_seconds REAL,
                input_data_path TEXT,
                output_data_path TEXT,
                execution_config TEXT,
                error_message TEXT,
                warnings_count INTEGER NOT NULL DEFAULT 0,
                executed_by TEXT,
                execution_environment TEXT,
                FOREIGN KEY (pipeline_id) REFERENCES pipelines(pipeline_id),
                FOREIGN KEY (current_step_id) REFERENCES pipeline_steps(step_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS step_executions (
                step_execution_id INTEGER PRIMARY KEY AUTOINCREMENT,
                execution_id INTEGER NOT NULL,
                step_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
                start_timestamp DATETIME,
                end_timestamp DATETIME,
                duration_seconds REAL,
                exit_code INTEGER,
                stdout_log TEXT,
                stderr_log TEXT,
                input_files TEXT,
                output_files TEXT,
                processed_file_count INTEGER DEFAULT 0,
                error_message TEXT,
                warnings TEXT,
                performance_metrics TEXT,
                memory_usage_mb REAL,
                cpu_usage_percent REAL,
                FOREIGN KEY (execution_id) REFERENCES pipeline_executions(execution_id) ON DELETE CASCADE,
                FOREIGN KEY (step_id) REFERENCES pipeline_steps(step_id),
                UNIQUE (execution_id, step_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS pipeline_templates (
                template_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                category TEXT NOT NULL,
                target_modality TEXT NOT NULL,
                template_data TEXT NOT NULL,
                parameters_schema TEXT,
                example_config TEXT,
                version TEXT NOT NULL DEFAULT '1.0.0',
                author TEXT,
                usage_count INTEGER NOT NULL DEFAULT 0,
                created_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_used_timestamp DATETIME
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS file_dependencies (
                dependency_id INTEGER PRIMARY KEY AUTOINCREMENT,
                execution_id INTEGER NOT NULL,
                source_file_path TEXT NOT NULL,
                dependent_file_path TEXT NOT NULL,
                dependency_type TEXT NOT NULL CHECK (dependency_type IN ('input', 'reference', 'derived', 'temporary')),
                step_id INTEGER NOT NULL,
                created_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (execution_id) REFERENCES pipeline_executions(execution_id) ON DELETE CASCADE,
                FOREIGN KEY (step_id) REFERENCES pipeline_steps(step_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS metadata_backups (
                backup_id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id INTEGER NOT NULL,
                backup_timestamp TEXT NOT NULL,
                prepared_metadata TEXT NOT NULL,
                mapping_config TEXT NOT NULL,
                FOREIGN KEY (record_id) REFERENCES zenodo_records (record_id) ON DELETE CASCADE
            );
            """,
        ]
        self._execute_many(conn, tables_sql)

    def _create_indexes(self, conn: sqlite3.Connection):
        """Create database indexes for performance."""
        indexes_sql = [
            "CREATE INDEX IF NOT EXISTS idx_pipelines_identifier ON pipelines(identifier);",
            "CREATE INDEX IF NOT EXISTS idx_pipelines_modality ON pipelines(primary_modality);",
            "CREATE INDEX IF NOT EXISTS idx_pipelines_status ON pipelines(status);",
            "CREATE INDEX IF NOT EXISTS idx_pipelines_created ON pipelines(created_timestamp);",
            "CREATE INDEX IF NOT EXISTS idx_steps_pipeline ON pipeline_steps(pipeline_id);",
            "CREATE INDEX IF NOT EXISTS idx_steps_component ON pipeline_steps(component_name);",
            "CREATE INDEX IF NOT EXISTS idx_steps_number ON pipeline_steps(pipeline_id, step_number);",
            "CREATE INDEX IF NOT EXISTS idx_step_files_step ON step_files(step_id);",
            "CREATE INDEX IF NOT EXISTS idx_step_files_role ON step_files(file_role);",
            "CREATE INDEX IF NOT EXISTS idx_step_files_type ON step_files(file_type);",
            "CREATE INDEX IF NOT EXISTS idx_step_files_source ON step_files(source_step_id);",
            "CREATE INDEX IF NOT EXISTS idx_parameters_step ON component_parameters(step_id);",
            "CREATE INDEX IF NOT EXISTS idx_parameters_name ON component_parameters(parameter_name);",
            "CREATE INDEX IF NOT EXISTS idx_executions_pipeline ON pipeline_executions(pipeline_id);",
            "CREATE INDEX IF NOT EXISTS idx_executions_status ON pipeline_executions(status);",
            "CREATE INDEX IF NOT EXISTS idx_executions_uuid ON pipeline_executions(execution_uuid);",
            "CREATE INDEX IF NOT EXISTS idx_executions_start ON pipeline_executions(start_timestamp);",
            "CREATE INDEX IF NOT EXISTS idx_executions_project ON pipeline_executions(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_step_executions_execution ON step_executions(execution_id);",
            "CREATE INDEX IF NOT EXISTS idx_step_executions_step ON step_executions(step_id);",
            "CREATE INDEX IF NOT EXISTS idx_step_executions_status ON step_executions(status);",
            "CREATE INDEX IF NOT EXISTS idx_step_executions_start ON step_executions(start_timestamp);",
            "CREATE INDEX IF NOT EXISTS idx_templates_category ON pipeline_templates(category);",
            "CREATE INDEX IF NOT EXISTS idx_templates_modality ON pipeline_templates(target_modality);",
            "CREATE INDEX IF NOT EXISTS idx_templates_usage ON pipeline_templates(usage_count);",
            "CREATE INDEX IF NOT EXISTS idx_dependencies_execution ON file_dependencies(execution_id);",
            "CREATE INDEX IF NOT EXISTS idx_dependencies_source ON file_dependencies(source_file_path);",
            "CREATE INDEX IF NOT EXISTS idx_dependencies_dependent ON file_dependencies(dependent_file_path);",
            "CREATE INDEX IF NOT EXISTS idx_dependencies_step ON file_dependencies(step_id);",
        ]
        self._execute_many(conn, indexes_sql)

    def _create_triggers(self, conn: sqlite3.Connection):
        """Create database triggers."""
        triggers_sql = [
            """
            CREATE TRIGGER IF NOT EXISTS update_pipeline_last_modified
            AFTER UPDATE ON pipelines
            FOR EACH ROW
            BEGIN
                UPDATE pipelines 
                SET last_modified_timestamp = CURRENT_TIMESTAMP 
                WHERE pipeline_id = OLD.pipeline_id;
            END;
            """,
            """
            CREATE TRIGGER IF NOT EXISTS increment_execution_count
            AFTER INSERT ON pipeline_executions
            BEGIN
                UPDATE pipelines 
                SET execution_count = execution_count + 1,
                    last_executed_timestamp = NEW.start_timestamp
                WHERE pipeline_id = NEW.pipeline_id;
            END;
            """,
            """
            CREATE TRIGGER IF NOT EXISTS update_execution_duration
            AFTER UPDATE OF end_timestamp ON pipeline_executions
            WHEN NEW.end_timestamp IS NOT NULL
            BEGIN
                UPDATE pipeline_executions 
                SET duration_seconds = (strftime('%s', NEW.end_timestamp) - strftime('%s', NEW.start_timestamp))
                WHERE execution_id = NEW.execution_id;
            END;
            """,
            """
            CREATE TRIGGER IF NOT EXISTS update_step_execution_duration
            AFTER UPDATE OF end_timestamp ON step_executions
            WHEN NEW.end_timestamp IS NOT NULL
            BEGIN
                UPDATE step_executions 
                SET duration_seconds = (strftime('%s', NEW.end_timestamp) - strftime('%s', NEW.start_timestamp))
                WHERE step_execution_id = NEW.step_execution_id;
            END;
            """,
        ]
        self._execute_many(conn, triggers_sql)

    def _create_views(self, conn: sqlite3.Connection):
        """Create database views for simplified querying."""
        views_sql = [
            """
            CREATE VIEW IF NOT EXISTS pipeline_summary AS
            SELECT 
                p.pipeline_id,
                p.identifier,
                p.name,
                p.primary_modality,
                p.status,
                p.execution_count,
                p.last_executed_timestamp,
                p.created_timestamp,
                p.last_modified_timestamp,
                COUNT(ps.step_id) as total_steps
            FROM pipelines p
            LEFT JOIN pipeline_steps ps ON p.pipeline_id = ps.pipeline_id
            GROUP BY p.pipeline_id;
            """,
            """
            CREATE VIEW IF NOT EXISTS execution_status AS
            SELECT 
                pe.execution_id,
                pe.execution_uuid,
                p.name as pipeline_name,
                pe.status,
                pe.progress_percentage,
                pe.current_step_id,
                ps.step_name as current_step_name,
                pe.start_timestamp,
                pe.completed_steps,
                pe.total_steps,
                pe.failed_steps
            FROM pipeline_executions pe
            JOIN pipelines p ON pe.pipeline_id = p.pipeline_id
            LEFT JOIN pipeline_steps ps ON pe.current_step_id = ps.step_id
            WHERE pe.status IN ('pending', 'running', 'paused');
            """,
        ]
        self._execute_many(conn, views_sql)

    def _update_schema(self, conn: sqlite3.Connection):
        """Checks for and applies necessary schema updates to an existing database."""
        cursor = conn.cursor()
        try:
            # Check pipelines table
            cursor.execute("PRAGMA table_info(pipelines);")
            columns = [row["name"] for row in cursor.fetchall()]
            if "zenodoDraftStepEnabled" not in columns:
                cursor.execute("ALTER TABLE pipelines ADD COLUMN zenodoDraftStepEnabled BOOLEAN NOT NULL DEFAULT 1;")
            if "zenodoUploadStepEnabled" not in columns:
                cursor.execute("ALTER TABLE pipelines ADD COLUMN zenodoUploadStepEnabled BOOLEAN NOT NULL DEFAULT 1;")
            if "zenodoPublishStepEnabled" not in columns:
                cursor.execute("ALTER TABLE pipelines ADD COLUMN zenodoPublishStepEnabled BOOLEAN NOT NULL DEFAULT 0;")
            if "description_constructor_enabled" not in columns:
                cursor.execute(
                    "ALTER TABLE pipelines ADD COLUMN description_constructor_enabled BOOLEAN NOT NULL DEFAULT 0;"
                )
            if "description_template" not in columns:
                cursor.execute("ALTER TABLE pipelines ADD COLUMN description_template TEXT;")

            # Check step_files table for the new column
            cursor.execute("PRAGMA table_info(step_files);")
            columns = [row["name"] for row in cursor.fetchall()]
            if "conceptual_id" not in columns:
                logging.info("Updating step_files table to add 'conceptual_id' column...")
                cursor.execute("ALTER TABLE step_files ADD COLUMN conceptual_id TEXT;")

            conn.commit()
            logging.info("Schema update check complete.")
        except sqlite3.Error as e:
            logging.error(f"Failed to update database schema: {e}")
            conn.rollback()

    # --- Pipeline CRUD Operations ---

    def create_pipeline(self, pipeline_data: Dict[str, Any]) -> int:
        """Create a new pipeline and return its ID."""
        try:
            # Validate and transform input data
            validated_data = self._validate_and_transform_pipeline_data(pipeline_data)

            with self._get_connection() as conn:
                cursor = conn.cursor()
                pipeline_sql = """
                    INSERT INTO pipelines (identifier, name, description, primary_modality, processing_mode, version, status, tags, notes, created_by, yaml_source, metadata_mapping, zenodoDraftStepEnabled, zenodoUploadStepEnabled, zenodoPublishStepEnabled, description_constructor_enabled, description_template)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """
                pipeline_values = (
                    validated_data["identifier"],
                    validated_data["name"],
                    validated_data.get("description", ""),
                    validated_data["modality"],
                    validated_data["processingMode"],
                    validated_data.get("version", "1.0.0"),
                    validated_data.get("status", "draft"),
                    json.dumps(validated_data.get("tags", [])),
                    validated_data.get("notes", ""),
                    validated_data.get("created_by", "system"),
                    validated_data.get("yaml_source", ""),
                    json.dumps({}),
                    validated_data.get("zenodoDraftStepEnabled", True),
                    validated_data.get("zenodoUploadStepEnabled", True),
                    validated_data.get("zenodoPublishStepEnabled", False),
                    validated_data.get("description_constructor_enabled", False),
                    validated_data.get("description_template", ""),
                )
                cursor.execute(pipeline_sql, pipeline_values)
                pipeline_id = cursor.lastrowid

                for step in pipeline_data.get("steps", []):
                    step_id = self._create_pipeline_step(conn, pipeline_id, step)

                    # Handle inputs
                    for input_file in step.get("inputs", []):
                        self._create_step_file(conn, step_id, "input", input_file)

                    # Handle outputs
                    for output_file in step.get("outputs", []):
                        self._create_step_file(conn, step_id, "output", output_file)

                    # Handle parameters with type checking
                    component = step.get("component", {})
                    parameters = component.get("parameters")

                    if parameters:
                        # Handle both list and dict formats
                        if isinstance(parameters, list):
                            # Parameters come as list of parameter definitions
                            for param_def in parameters:
                                if isinstance(param_def, dict) and "name" in param_def:
                                    param_name = param_def["name"]
                                    param_value = param_def.get("default", param_def.get("value", ""))
                                    self._create_component_parameter(conn, step_id, param_name, param_value)

                        elif isinstance(parameters, dict):
                            # Parameters come as name-value pairs
                            for param_name, param_value in parameters.items():
                                self._create_component_parameter(conn, step_id, param_name, param_value)

                        else:
                            logging.warning(
                                f"Unexpected parameters format for step {step.get('stepNumber', 'unknown')}: {type(parameters)}"
                            )

                conn.commit()
                logging.info(f"Created pipeline: {pipeline_data['name']} (ID: {pipeline_id})")
                return pipeline_id

        except Exception as e:
            logging.error(f"Failed to create pipeline: {e}", exc_info=True)
            raise

    def _create_pipeline_step(self, conn: sqlite3.Connection, pipeline_id: int, step_data: Dict[str, Any]) -> int:
        """Helper to create a pipeline step. Uses the provided connection."""
        cursor = conn.cursor()
        step_sql = """
            INSERT INTO pipeline_steps (pipeline_id, step_number, step_name, component_name, component_category, component_version, is_optional, on_error_action, timeout_seconds, memory_limit_mb, cpu_limit, parallel_execution, depends_on_steps, input_mapping)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        component = step_data.get("component", {})

        # Ensure input_mapping is a JSON string, defaulting to an empty object
        input_mapping_json = json.dumps(step_data.get("inputMapping", {}))

        step_values = (
            pipeline_id,
            step_data["stepNumber"],
            step_data.get("stepName", f"Step {step_data['stepNumber']}"),
            component.get("name", ""),
            component.get("category", ""),
            component.get("version", ""),
            step_data.get("isOptional", False),
            step_data.get("onErrorAction", "fail"),
            step_data.get("timeoutSeconds", 300),
            step_data.get("memoryLimitMb", 512),
            step_data.get("cpuLimit", 1),
            step_data.get("parallelExecution", False),
            json.dumps(step_data.get("dependsOnSteps", [])),
            input_mapping_json,
        )
        cursor.execute(step_sql, step_values)
        return cursor.lastrowid

    def _create_step_file(self, conn: sqlite3.Connection, step_id: int, file_role: str, file_data: Dict[str, Any]):
        """Helper to create a step file record. Uses the provided connection."""
        cursor = conn.cursor()
        file_sql = """
            INSERT INTO step_files (step_id, conceptual_id, file_role, file_name, file_type, filename_pattern, mime_type, is_required, is_source_file, replace_source_file, add_to_record, source_step_id, file_order, validation_rules, metadata, output_mapping)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        file_values = (
            step_id,
            file_data.get("id"),  # This saves the conceptual ID from the frontend
            file_role,
            file_data["name"],
            file_data["type"],
            file_data["filename"],
            file_data.get("mimeType", ""),
            file_data.get("isRequired", True),
            file_data.get("isSource", False),
            file_data.get("replaceSource", False),
            file_data.get("addToRecord", True),
            file_data.get("sourceStepId"),
            file_data.get("order", 0),
            json.dumps(file_data.get("validationRules", {})),
            json.dumps(file_data.get("metadata", {})),
            json.dumps(file_data.get("outputMapping", {})),
        )
        cursor.execute(file_sql, file_values)

    def _create_component_parameter(self, conn: sqlite3.Connection, step_id: int, param_name: str, param_data: Any):
        """Create a component parameter record with improved type handling."""
        cursor = conn.cursor()

        # Determine parameter type and value with better handling
        if param_data is None:
            param_type = "str"
            param_value = ""
        elif isinstance(param_data, bool):
            param_type = "bool"
            param_value = json.dumps(param_data)
        elif isinstance(param_data, int):
            param_type = "int"
            param_value = json.dumps(param_data)
        elif isinstance(param_data, float):
            param_type = "float"
            param_value = json.dumps(param_data)
        elif isinstance(param_data, (list, dict)):
            param_type = "list" if isinstance(param_data, list) else "dict"
            param_value = json.dumps(param_data)
        else:
            param_type = "str"
            param_value = json.dumps(str(param_data))

        param_sql = """
            INSERT INTO component_parameters (step_id, parameter_name, parameter_type, parameter_value, is_required)
            VALUES (?, ?, ?, ?, ?)
        """

        try:
            cursor.execute(param_sql, (step_id, param_name, param_type, param_value, False))
        except Exception as e:
            logging.error(f"Failed to create parameter {param_name}: {e}")
            raise

    def _validate_and_transform_pipeline_data(self, pipeline_data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and transform pipeline data to ensure consistency."""

        # Ensure required fields exist
        required_fields = ["identifier", "name", "modality", "processingMode"]
        for field in required_fields:
            if field not in pipeline_data:
                raise ValueError(f"Missing required field: {field}")

        # Transform and validate steps
        if "steps" in pipeline_data:
            for i, step in enumerate(pipeline_data["steps"]):
                # Ensure step has required fields
                if "stepNumber" not in step:
                    step["stepNumber"] = i + 1

                # Ensure component exists
                if "component" not in step:
                    step["component"] = {}

                # Normalize component data
                component = step["component"]
                if not isinstance(component, dict):
                    step["component"] = {"name": str(component), "parameters": {}}
                elif "parameters" not in component:
                    component["parameters"] = {}

                # Ensure inputs and outputs are lists
                if "inputs" not in step:
                    step["inputs"] = []
                if "outputs" not in step:
                    step["outputs"] = []

                # Validate file data
                for file_list in [step["inputs"], step["outputs"]]:
                    for file_data in file_list:
                        if not isinstance(file_data, dict):
                            continue

                        # Ensure required file fields
                        if "name" not in file_data:
                            file_data["name"] = "Unnamed File"
                        if "type" not in file_data:
                            file_data["type"] = "unknown"
                        if "filename" not in file_data:
                            file_data["filename"] = f"{file_data['name'].lower().replace(' ', '_')}.file"

        return pipeline_data

    def get_pipeline(self, identifier: str) -> Optional[Dict[str, Any]]:
        """Get a full pipeline by identifier."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                pipeline_row = cursor.execute("SELECT * FROM pipelines WHERE identifier = ?", (identifier,)).fetchone()
                if not pipeline_row:
                    return None

                pipeline = dict(pipeline_row)

                if pipeline.get("metadata_mapping"):
                    try:
                        pipeline["metadata_mapping"] = json.loads(pipeline["metadata_mapping"])
                    except (json.JSONDecodeError, TypeError):
                        pipeline["metadata_mapping"] = {}  # Default to empty if parsing fails
                else:
                    pipeline["metadata_mapping"] = {}

                steps_rows = cursor.execute(
                    "SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY step_number",
                    (pipeline["pipeline_id"],),
                ).fetchall()

                pipeline["steps"] = []
                for step_row in steps_rows:
                    step = dict(step_row)

                    if "input_mapping" in step and step["input_mapping"]:
                        try:
                            step["inputMapping"] = json.loads(step["input_mapping"])
                        except json.JSONDecodeError:
                            step["inputMapping"] = {}  # Default to empty if parsing fails
                    else:
                        step["inputMapping"] = {}

                    files_rows = cursor.execute(
                        "SELECT * FROM step_files WHERE step_id = ? ORDER BY file_order", (step["step_id"],)
                    ).fetchall()
                    step_inputs = []
                    step_outputs = []
                    for r in files_rows:
                        file_dict = dict(r)
                        is_source = file_dict.get("is_source_file", False)

                        # Create the consistent 'id' key that the application expects.
                        file_dict["id"] = "source_file" if is_source else file_dict.get("conceptual_id")

                        if file_dict.get("output_mapping"):
                            try:
                                file_dict["outputMapping"] = json.loads(file_dict["output_mapping"])
                            except (json.JSONDecodeError, TypeError):
                                file_dict["outputMapping"] = {}

                        if file_dict["file_role"] == "input":
                            step_inputs.append(file_dict)
                        elif file_dict["file_role"] == "output":
                            step_outputs.append(file_dict)

                    step["inputs"] = step_inputs
                    step["outputs"] = step_outputs

                    params_rows = cursor.execute(
                        "SELECT * FROM component_parameters WHERE step_id = ?", (step["step_id"],)
                    ).fetchall()
                    step["parameters"] = {
                        p["parameter_name"]: (
                            json.loads(p["parameter_value"])
                            if p["parameter_type"] in ["dict", "list"]
                            else p["parameter_value"]
                        )
                        for p in params_rows
                    }
                    pipeline["steps"].append(step)
                return pipeline
        except Exception as e:
            logging.error(f"Failed to get pipeline {identifier}: {e}", exc_info=True)
            return None

    def list_pipelines(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all pipelines from the summary view."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                query = "SELECT * FROM pipeline_summary"
                params = []
                if status:
                    query += " WHERE status = ?"
                    params.append(status)
                query += " ORDER BY name"
                cursor.execute(query, tuple(params))
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            logging.error(f"Failed to list pipelines: {e}", exc_info=True)
            return []

    def update_pipeline(self, identifier: str, updates: Dict[str, Any]) -> bool:
        """Update a pipeline."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                set_clauses = []
                values = []
                allowed_fields = ["name", "description", "status", "notes", "version"]
                for field in allowed_fields:
                    if field in updates:
                        set_clauses.append(f"{field} = ?")
                        values.append(updates[field])
                if not set_clauses:
                    return True

                sql = f"UPDATE pipelines SET {', '.join(set_clauses)} WHERE identifier = ?"
                values.append(identifier)
                cursor.execute(sql, values)
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            logging.error(f"Failed to update pipeline {identifier}: {e}", exc_info=True)
            return False

    def update_pipeline_metadata_mapping(self, identifier: str, mapping_data: Dict[str, Any]) -> bool:
        """Saves or updates the Zenodo metadata mapping for a specific pipeline."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                sql = "UPDATE pipelines SET metadata_mapping = ? WHERE identifier = ?"
                cursor.execute(sql, (json.dumps(mapping_data), identifier))
                conn.commit()
                logging.info(f"Updated metadata mapping for pipeline '{identifier}'.")
                return cursor.rowcount > 0
        except Exception as e:
            logging.error(f"Failed to update metadata mapping for {identifier}: {e}", exc_info=True)
            return False

    def update_pipeline_complete(self, identifier: str, pipeline_data: Dict[str, Any]) -> bool:
        """Update a complete pipeline including steps, files, and parameters"""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()

                # Get existing pipeline ID
                cursor.execute("SELECT pipeline_id FROM pipelines WHERE identifier = ?", (identifier,))
                result = cursor.fetchone()
                if not result:
                    return False

                pipeline_id = result["pipeline_id"]

                # Update pipeline metadata
                pipeline_sql = """
                    UPDATE pipelines 
                    SET name = ?, description = ?, primary_modality = ?, processing_mode = ?, 
                        version = ?, status = ?, notes = ?, last_modified_timestamp = CURRENT_TIMESTAMP, 
                        zenodoDraftStepEnabled = ?, zenodoUploadStepEnabled = ?, zenodoPublishStepEnabled = ?,
                        description_constructor_enabled = ?, description_template = ?
                    WHERE pipeline_id = ?
                """

                pipeline_values = (
                    pipeline_data["name"],
                    pipeline_data.get("description", ""),
                    pipeline_data["modality"],
                    pipeline_data["processingMode"],
                    pipeline_data.get("version", "1.0.0"),
                    pipeline_data.get("status", "draft"),
                    pipeline_data.get("notes", ""),
                    pipeline_data.get("zenodoDraftStepEnabled", True),
                    pipeline_data.get("zenodoUploadStepEnabled", True),
                    pipeline_data.get("zenodoPublishStepEnabled", False),
                    pipeline_data.get("description_constructor_enabled", False),
                    pipeline_data.get("description_template", ""),
                    pipeline_id,
                )

                cursor.execute(pipeline_sql, pipeline_values)

                # Delete existing steps, files, and parameters (CASCADE will handle related records)
                cursor.execute("DELETE FROM pipeline_steps WHERE pipeline_id = ?", (pipeline_id,))

                # Recreate steps with updated data
                for step in pipeline_data.get("steps", []):
                    step_id = self._create_pipeline_step(conn, pipeline_id, step)

                    # Handle inputs
                    for input_file in step.get("inputs", []):
                        self._create_step_file(conn, step_id, "input", input_file)

                    # Handle outputs
                    for output_file in step.get("outputs", []):
                        self._create_step_file(conn, step_id, "output", output_file)

                    # Handle parameters
                    component = step.get("component", {})
                    parameters = component.get("parameters")

                    if parameters:
                        if isinstance(parameters, list):
                            for param_def in parameters:
                                if isinstance(param_def, dict) and "name" in param_def:
                                    param_name = param_def["name"]
                                    param_value = param_def.get("default", param_def.get("value", ""))
                                    self._create_component_parameter(conn, step_id, param_name, param_value)
                        elif isinstance(parameters, dict):
                            for param_name, param_value in parameters.items():
                                self._create_component_parameter(conn, step_id, param_name, param_value)

                conn.commit()
                logging.info(f"Updated pipeline: {pipeline_data['name']} (ID: {pipeline_id})")
                return True

        except Exception as e:
            logging.error(f"Failed to update pipeline: {e}", exc_info=True)
            return False

    def delete_pipeline(self, identifier: str) -> bool:
        """Delete a pipeline."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM pipelines WHERE identifier = ?", (identifier,))
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            logging.error(f"Failed to delete pipeline {identifier}: {e}", exc_info=True)
            return False

    # --- Execution Management ---

    def start_execution(self, pipeline_id: int, config: Dict[str, Any]) -> str:
        """Start a new pipeline execution and return execution UUID."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                total_steps = cursor.execute(
                    "SELECT COUNT(*) FROM pipeline_steps WHERE pipeline_id = ?", (pipeline_id,)
                ).fetchone()[0]
                execution_uuid = str(uuid.uuid4())
                execution_sql = (
                    "INSERT INTO pipeline_executions (pipeline_id, execution_uuid, total_steps) VALUES (?, ?, ?)"
                )
                cursor.execute(execution_sql, (pipeline_id, execution_uuid, total_steps))
                conn.commit()
                logging.info(f"Started execution {execution_uuid} for pipeline {pipeline_id}")
                return execution_uuid
        except Exception as e:
            logging.error(f"Failed to start execution: {e}", exc_info=True)
            raise

    # --- YAML Import/Export ---

    def import_from_yaml(self, yaml_content: str) -> int:
        """Import pipeline from YAML content, parsing the full data structure."""
        try:
            data = yaml.safe_load(yaml_content)

            pipeline_data = {
                "identifier": data["identifier"],
                "name": data["name"],
                "modality": data["modality"],
                "processingMode": data.get("processing_mode", data.get("processingMode")),
                "description": data.get("description", ""),
                "notes": data.get("notes", ""),
                "version": data.get("version", "1.0.0"),
                "steps": [],
            }

            for step_yaml in data.get("steps", []):
                step_data = {
                    "stepNumber": step_yaml.get("step"),
                    "stepName": step_yaml.get("step_name"),
                    "component": step_yaml.get("component"),
                    "inputs": [],  # inputs are defined in the mapping, so an empty list is passed
                    "inputMapping": step_yaml.get("input_mapping", {}),
                    "outputs": [],
                }

                # Transform outputs to match the expected format
                for output_yaml in step_yaml.get("outputs", []):
                    step_data["outputs"].append(
                        {
                            "name": output_yaml.get("name"),
                            "filename": output_yaml.get("filename_pattern"),
                            "type": output_yaml.get("file_type"),
                            "addToRecord": output_yaml.get("add_to_record", True),
                            "replaceSourceFile": output_yaml.get("replace_source_file", False),
                            "outputMapping": output_yaml.get("output_mapping", {}),
                        }
                    )

                pipeline_data["steps"].append(step_data)

            return self.create_pipeline(pipeline_data)

        except (yaml.YAMLError, KeyError) as e:
            logging.error(f"Failed to parse or process YAML: {e}", exc_info=True)
            raise ValueError(f"Invalid or incomplete YAML format: {e}")
        except Exception as e:
            logging.error(f"An unexpected error occurred during YAML import: {e}", exc_info=True)
            raise

    def export_to_yaml(self, identifier: str) -> Optional[str]:
        """Export pipeline to YAML format. This method calls get_pipeline, which is now thread-safe."""
        try:
            pipeline = self.get_pipeline(identifier)
            if not pipeline:
                return None

            yaml_data = {
                "name": pipeline["name"],
                "identifier": pipeline["identifier"],
                "modality": pipeline["primary_modality"],
                "processing_mode": pipeline["processing_mode"],
                "notes": pipeline["notes"],
                "steps": [],
            }
            for step in pipeline.get("steps", []):
                step_data = {
                    "step": step["step_number"],
                    "component": step["component_name"],
                    "inputs": {f["file_name"]: f["filename_pattern"] for f in step.get("inputs", [])},
                    "outputs": {f["file_name"]: f["filename_pattern"] for f in step.get("outputs", [])},
                    "parameters": step.get("parameters", {}),
                }
                yaml_data["steps"].append(step_data)
            return yaml.dump(yaml_data, default_flow_style=False, sort_keys=False, indent=2)
        except Exception as e:
            logging.error(f"Failed to export to YAML: {e}", exc_info=True)
            return None
