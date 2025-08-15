# server_app/services/component_service.py
import time
import logging
import threading
import subprocess
from queue import Queue
from typing import Any, Dict

logger = logging.getLogger(__name__)


class ComponentExecutor:
    """Manages the state and execution of running components."""

    def __init__(self):
        self._running_executions: Dict[str, Dict[str, Any]] = {}
        self.app = None

    def init_app(self, app):
        self.app = app
        app.component_executor = self

    def get_execution(self, execution_id: str) -> Dict[str, Any] | None:
        return self._running_executions.get(execution_id)

    def get_log_queue(self, execution_id: str) -> Queue | None:
        execution = self.get_execution(execution_id)
        return execution.get("log_queue") if execution else None

    # New public method to start and register an execution.
    def start_execution(self, execution_id: str, cmd: list, **context):
        """
        Registers a new execution context and starts it in a background thread.
        """
        log_queue = Queue()

        execution_context = {
            "command": cmd,
            "log_queue": log_queue,
            "status": "starting",
            "start_time": time.time(),
            **context,  # This will include component_name, spec, strategy, etc.
        }

        self._running_executions[execution_id] = execution_context
        logger.info(f"Registered and starting new execution: {execution_id}")

        thread = threading.Thread(target=self._execute_thread, args=(execution_id, cmd, log_queue))
        thread.daemon = True
        thread.start()

    def cancel_execution(self, execution_id: str) -> bool:
        execution = self.get_execution(execution_id)
        if not execution:
            logger.warning(f"Attempted to cancel non-existent execution: {execution_id}")
            return False

        process = execution.get("process")
        if process and process.poll() is None:
            process.terminate()
            execution["status"] = "cancelled"
            execution["log_queue"].put(
                {
                    "level": "warning",
                    "message": "Execution cancelled by user",
                    "timestamp": time.strftime("%H:%M:%S"),
                    "status": "cancelled",
                }
            )
            logger.info(f"Cancelled execution {execution_id}")
            return True
        return False

    def _execute_thread(self, execution_id: str, cmd: list, log_queue: Queue):
        """The private method that runs in a thread to execute a component subprocess."""
        try:
            log_queue.put(
                {"level": "info", "message": f"Command: {' '.join(cmd)}", "timestamp": time.strftime("%H:%M:%S")}
            )

            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1,
                encoding="utf-8",
                errors="replace",
            )

            self._running_executions[execution_id]["process"] = process
            self._running_executions[execution_id]["status"] = "running"
            log_queue.put(
                {
                    "level": "info",
                    "message": f"Process started with PID: {process.pid}",
                    "timestamp": time.strftime("%H:%M:%S"),
                }
            )

            for line in iter(process.stdout.readline, ""):
                if line.strip():
                    level = self._parse_log_level(line)
                    log_queue.put({"level": level, "message": line.strip(), "timestamp": time.strftime("%H:%M:%S")})

            return_code = process.wait()
            duration = time.time() - self._running_executions[execution_id]["start_time"]

            if return_code == 0:
                final_status = "completed"
                log_level = "success"
                message = f"✅ Component execution completed successfully (exit code: {return_code})"
            else:
                final_status = "failed"
                log_level = "error"
                message = f"❌ Component execution failed with exit code {return_code}"

            self._running_executions[execution_id]["status"] = final_status
            log_queue.put(
                {
                    "level": log_level,
                    "message": message,
                    "timestamp": time.strftime("%H:%M:%S"),
                    "status": final_status,
                }
            )
            log_queue.put(
                {
                    "level": "info",
                    "message": f"Total execution time: {duration:.2f} seconds",
                    "timestamp": time.strftime("%H:%M:%S"),
                }
            )

        except Exception as e:
            logger.error(f"Execution thread error for {execution_id}: {e}", exc_info=True)
            if execution_id in self._running_executions:
                self._running_executions[execution_id]["status"] = "failed"
                log_queue.put(
                    {
                        "level": "error",
                        "message": f"💥 Execution framework error: {str(e)}",
                        "timestamp": time.strftime("%H:%M:%S"),
                        "status": "failed",
                    }
                )

    @staticmethod
    def _parse_log_level(line: str) -> str:
        """Determines log level from keywords in the log line."""
        line_lower = line.lower()
        if any(kw in line_lower for kw in ["error", "failed", "exception", "traceback"]):
            return "error"
        if any(kw in line_lower for kw in ["warning", "warn"]):
            return "warning"
        if any(kw in line_lower for kw in ["success", "completed", "finished", "processing_success"]):
            return "success"
        if "debug" in line_lower:
            return "debug"
        return "info"


# Singleton instance
component_executor = ComponentExecutor()
