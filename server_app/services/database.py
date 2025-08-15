# server_app/services/database.py
import sqlite3
import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


def query_db(db_path: str, query_str: str, params=()) -> Optional[List[Dict[str, Any]]]:
    """Utility to query a database and return results as a list of dicts."""
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(query_str, params)
        results = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return results
    except Exception as e:
        logger.error(f"DB query error on '{db_path}': {e} on query: {query_str} with params {params}")
        return None


def execute_db(db_path: str, query_str: str, params=()) -> bool:
    """Execute a database operation that doesn't return data (INSERT, UPDATE, etc.)."""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys = ON;")
        cursor.execute(query_str, params)
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logger.error(f"DB execute error on '{db_path}': {e} on query: {query_str} with params {params}")
        return False


def execute_db_transaction(db_path: str, commands: list) -> bool:
    """
    Execute a list of SQL commands with their parameters in a single transaction.
    Rolls back all changes if any command fails.
    """
    conn = None  # Ensure conn is defined in the outer scope
    try:
        conn = sqlite3.connect(db_path, timeout=10)  # Added timeout to help with locking
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys = ON;")

        # Begin a transaction
        cursor.execute("BEGIN TRANSACTION;")

        for query_str, params in commands:
            cursor.execute(query_str, params)

        # Commit all changes at once if all commands succeed
        conn.commit()
        return True
    except sqlite3.Error as e:
        logger.error(f"DB transaction error on '{db_path}': {e}")
        if conn:
            # Roll back all changes if any error occurred
            conn.rollback()
        return False
    finally:
        if conn:
            conn.close()


def load_project_config_value(db_path: str, project_id: int, key: str) -> Optional[Any]:
    """Loads a specific configuration value from the project_configuration table."""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT config_value FROM project_configuration WHERE project_id = ? AND config_key = ?;",
            (project_id, key),
        )
        row = cursor.fetchone()
        conn.close()

        if row:
            value_str = row[0]
            if value_str is None:
                return None
            try:
                # Attempt to deserialize JSON strings
                if isinstance(value_str, str) and value_str.startswith(("{", "[")):
                    return json.loads(value_str)
                # Handle booleans
                if value_str.lower() == "true":
                    return True
                if value_str.lower() == "false":
                    return False
                # Handle numbers
                return int(value_str)
            except (ValueError, TypeError, json.JSONDecodeError):
                try:
                    return float(value_str)
                except (ValueError, TypeError):
                    return value_str  # Return as string if all else fails
        return None
    except sqlite3.Error as e:
        logger.error(f"Database Error loading project config for key '{key}': {e}")
        return None


def get_db_connection(db_path_str: str) -> sqlite3.Connection:
    """Establishes a connection to the HDPC SQLite database."""
    if not db_path_str:
        raise ValueError("Database path is not set.")
    db_path = Path(db_path_str)
    if not db_path.exists():
        raise FileNotFoundError(f"Database file not found: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn
