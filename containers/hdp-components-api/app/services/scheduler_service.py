import logging
from typing import Optional
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.executors.pool import ThreadPoolExecutor

logger = logging.getLogger(__name__)


class SchedulerService:
    def __init__(self):
        self.scheduler: Optional[BackgroundScheduler] = None
        self.app = None  # Store Flask app reference
        self._setup_scheduler()

    def _setup_scheduler(self):
        """Initialize the background scheduler."""
        executors = {"default": ThreadPoolExecutor(max_workers=2)}

        job_defaults = {"coalesce": True, "max_instances": 1, "misfire_grace_time": 300}  # 5 minutes

        self.scheduler = BackgroundScheduler(executors=executors, job_defaults=job_defaults, timezone="UTC")

    def initialize_with_app(self, app):
        """Initialize the scheduler with Flask app reference."""
        self.app = app
        logger.info("Scheduler initialized with Flask app")

    def start(self):
        """Start the scheduler and add jobs."""
        if not self.app:
            logger.error("Scheduler not initialized with Flask app")
            return

        if not self.app.config.get("ENABLE_SCHEDULER", True):
            logger.info("Scheduler disabled by configuration")
            return

        try:
            # Add the periodic update job
            interval_hours = self.app.config.get("UPDATE_INTERVAL_HOURS", 24)

            self.scheduler.add_job(
                func=self._scheduled_zenodo_update,
                trigger=IntervalTrigger(hours=interval_hours),
                id="zenodo_update",
                name="Periodic Zenodo Component Update",
                replace_existing=True,
            )

            self.scheduler.start()
            logger.info(f"Scheduler started with {interval_hours}h update interval")

            # Perform initial update if configured
            if self.app.config.get("INITIAL_UPDATE_ON_STARTUP", True):
                logger.info("Scheduling initial Zenodo update")
                self.scheduler.add_job(
                    func=self._scheduled_zenodo_update,
                    trigger="date",  # Run once, immediately
                    id="initial_update",
                    name="Initial Zenodo Update",
                    replace_existing=True,
                )

        except Exception as e:
            logger.error(f"Failed to start scheduler: {e}")

    def stop(self):
        """Stop the scheduler."""
        if self.scheduler and self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("Scheduler stopped")

    def trigger_update(self):
        """Manually trigger an immediate update."""
        if not self.scheduler:
            logger.error("Scheduler not initialized")
            return False

        if not self.app:
            logger.error("No Flask app available for manual update")
            return False

        try:
            self.scheduler.add_job(
                func=self._scheduled_zenodo_update,
                trigger="date",  # Run once, immediately
                id="manual_update",
                name="Manual Zenodo Update",
                replace_existing=True,
            )
            logger.info("Manual update triggered")
            return True
        except Exception as e:
            logger.error(f"Failed to trigger manual update: {e}")
            return False

    def get_job_status(self):
        """Get status of scheduled jobs."""
        if not self.scheduler:
            return {"status": "scheduler_not_initialized"}

        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append(
                {
                    "id": job.id,
                    "name": job.name,
                    "next_run_time": str(job.next_run_time) if job.next_run_time else None,
                    "trigger": str(job.trigger),
                }
            )

        return {"scheduler_running": self.scheduler.running, "job_count": len(jobs), "jobs": jobs}

    def _scheduled_zenodo_update(self):
        """Background task to update components from Zenodo."""
        if not self.app:
            logger.error("No Flask app available for scheduled update")
            return

        try:
            logger.info("Starting scheduled Zenodo update")

            with self.app.app_context():
                # Import services inside the function to avoid circular imports
                from app.services.zenodo_service import ZenodoService
                from app.services.component_service import ComponentService

                # Initialize Zenodo service
                zenodo_service = ZenodoService(
                    community_id=self.app.config["ZENODO_COMMUNITY_ID"],
                    user_agent=self.app.config["ZENODO_USER_AGENT"],
                    timeout=self.app.config["REQUEST_TIMEOUT"],
                )

                # Fetch components from Zenodo
                zenodo_components = zenodo_service.fetch_community_components()

                if zenodo_components:
                    # Update local components
                    ComponentService.update_components(zenodo_components)
                    logger.info(f"Scheduled update completed: {len(zenodo_components)} components updated")
                else:
                    logger.warning("Scheduled update completed: No components found in Zenodo")

        except Exception as e:
            logger.error(f"Scheduled Zenodo update failed: {e}")
            # Don't re-raise the exception as it would stop the scheduler


scheduler_service = SchedulerService()
