# server_app/services/project_manager.py
import os
import sqlite3
from typing import Optional


class ProjectManager:
    """Manages the state of the currently loaded HDPC project."""

    def __init__(self):
        self._current_db_path: Optional[str] = None
        self.app = None

    def init_app(self, app):
        """Binds the manager to the Flask app instance."""
        self.app = app
        app.project_manager = self

    def load_project(self, db_path: str) -> bool:
        """Loads a new project database after validation."""
        if not os.path.exists(db_path):
            self.app.logger.error(f"Attempted to load non-existent DB path: {db_path}")
            return False
        try:
            self._current_db_path = db_path
            self.app.logger.info(f"Project loaded successfully: {db_path}")
            # Potentially initialize project-specific tables here
            from .database import execute_db_transaction

            # Connect once to check schema
            conn_for_check = sqlite3.connect(db_path)
            cursor = conn_for_check.cursor()
            cursor.execute("PRAGMA table_info(source_files);")
            columns = [row[1] for row in cursor.fetchall()]
            cursor.execute("PRAGMA table_info(zenodo_records);")
            zenodo_columns = [row[1] for row in cursor.fetchall()]
            conn_for_check.close()

            commands_to_run = []

            # Add new columns if they don't exist
            if "pipeline_source" not in columns:
                commands_to_run.append(("ALTER TABLE source_files ADD COLUMN pipeline_source TEXT;", ()))
            if "step_source" not in columns:
                commands_to_run.append(("ALTER TABLE source_files ADD COLUMN step_source TEXT;", ()))

            if "concept_rec_id" not in zenodo_columns:
                self.app.logger.info("Updating zenodo_records table to add 'concept_rec_id' column for versioning.")
                commands_to_run.append(("ALTER TABLE zenodo_records ADD COLUMN concept_rec_id TEXT;", ()))

            # Add existing table creation commands
            commands_to_run.extend(
                [
                    (
                        """
                    CREATE TABLE IF NOT EXISTS component_configurations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        component_name TEXT UNIQUE NOT NULL,
                        parameters TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                    """,
                        (),
                    ),
                    (
                        """
                    CREATE TABLE IF NOT EXISTS metadata_backups (
                        backup_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        record_id INTEGER NOT NULL,
                        backup_timestamp TEXT NOT NULL,
                        record_metadata_json TEXT NOT NULL,
                        mapping_config TEXT NOT NULL,
                        FOREIGN KEY (record_id) REFERENCES zenodo_records (record_id) ON DELETE CASCADE
                    )
                    """,
                        (),
                    ),
                ]
            )

            if commands_to_run:
                execute_db_transaction(db_path, commands_to_run)

            return True
        except sqlite3.Error as e:
            self.app.logger.error(f"Failed to load project DB {db_path}: {e}")
            self._current_db_path = None
            return False

    def unload_project(self):
        """Unloads the current project."""
        self.app.logger.info(f"Unloading project: {self._current_db_path}")
        self._current_db_path = None

    @property
    def db_path(self) -> Optional[str]:
        """Returns the current database path."""
        return self._current_db_path

    @property
    def is_loaded(self) -> bool:
        """Checks if a project is currently loaded."""
        return self._current_db_path is not None


# Create a singleton instance of the manager
project_manager = ProjectManager()
