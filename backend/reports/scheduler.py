from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ScheduledReportsService:
    """DB-backed scheduled-report registry.

    Configs are persisted per-user in the ``scheduled_reports`` table so they
    survive restarts; APScheduler holds the live cron jobs and is rehydrated from
    the DB on boot. Delivery generates the report and emails it, degrading
    gracefully (logged, not raised) when SMTP isn't configured.
    """

    def __init__(self) -> None:
        self._scheduler = BackgroundScheduler(timezone="UTC")
        self._started = False

    def start(self) -> None:
        if not self._started:
            self._scheduler.start()
            self._started = True

    def stop(self) -> None:
        if self._started:
            self._scheduler.shutdown(wait=False)
            self._started = False

    # --- DB-backed CRUD ---------------------------------------------------

    def list(self, db: Session, user_id: str) -> list:
        from backend.models import ScheduledReportORM

        return (
            db.query(ScheduledReportORM)
            .filter(ScheduledReportORM.user_id == user_id)
            .order_by(ScheduledReportORM.created_at)
            .all()
        )

    def create(
        self,
        db: Session,
        user_id: str,
        report_type: str,
        frequency: str,
        email: str,
        data_type: str = "positions",
    ):
        from backend.models import ScheduledReportORM

        row = ScheduledReportORM(
            user_id=user_id,
            report_type=report_type,
            frequency=frequency,
            email=email,
            data_type=data_type,
            enabled=True,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        self._schedule_job(row.id, frequency)
        return row

    def delete(self, db: Session, user_id: str, config_id: str) -> bool:
        from backend.models import ScheduledReportORM

        row = (
            db.query(ScheduledReportORM)
            .filter(ScheduledReportORM.id == config_id, ScheduledReportORM.user_id == user_id)
            .first()
        )
        if row is None:
            return False
        db.delete(row)
        db.commit()
        self._remove_job(config_id)
        return True

    def rehydrate(self, db: Session) -> None:
        """Re-register cron jobs for every enabled config (called on startup)."""
        from backend.models import ScheduledReportORM

        self.start()
        for row in db.query(ScheduledReportORM).filter(ScheduledReportORM.enabled.is_(True)).all():
            self._schedule_job(row.id, row.frequency)

    # --- scheduling -------------------------------------------------------

    def _schedule_job(self, config_id: str, frequency: str) -> None:
        self.start()
        self._scheduler.add_job(
            self._deliver,
            trigger=self._trigger_for_frequency(frequency),
            id=config_id,
            replace_existing=True,
            kwargs={"config_id": config_id},
        )

    def _remove_job(self, config_id: str) -> None:
        try:
            self._scheduler.remove_job(config_id)
        except Exception:
            pass

    def _trigger_for_frequency(self, frequency: str) -> CronTrigger:
        low = frequency.strip().lower()
        if low == "daily":
            return CronTrigger(hour=18, minute=0)
        if low == "weekly":
            return CronTrigger(day_of_week="fri", hour=18, minute=0)
        return CronTrigger(hour="*/12")

    def _deliver(self, config_id: str) -> None:
        """Generate and email a scheduled report. Runs in the scheduler thread."""
        from backend.reports.generator import generate_pdf_report, rows_for_data_type
        from backend.models import ScheduledReportORM
        from backend.shared.db import SessionLocal

        db = SessionLocal()
        try:
            row = (
                db.query(ScheduledReportORM)
                .filter(ScheduledReportORM.id == config_id, ScheduledReportORM.enabled.is_(True))
                .first()
            )
            if row is None:
                return
            rows = rows_for_data_type(db, row.data_type, row.user_id)
            pdf = generate_pdf_report(rows, title=f"{row.report_type} report")
            self.send_email(
                row.email,
                f"OpenTerminalUI scheduled report: {row.report_type}",
                "Your scheduled report is attached.",
                f"{row.report_type}.pdf",
                pdf,
            )
        except RuntimeError as exc:
            # SMTP not configured -- expected in self-hosted setups without mail.
            logger.warning("Scheduled report %s not delivered: %s", config_id, exc)
        except Exception:
            logger.exception("Scheduled report %s delivery failed", config_id)
        finally:
            db.close()

    def send_email(self, to_email: str, subject: str, body: str, attachment_name: str, attachment_bytes: bytes) -> None:
        host = os.getenv("SMTP_HOST")
        port = int(os.getenv("SMTP_PORT", "587"))
        user = os.getenv("SMTP_USER")
        password = os.getenv("SMTP_PASSWORD")
        if not host or not user or not password:
            raise RuntimeError("SMTP configuration missing")

        msg = EmailMessage()
        msg["From"] = user
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.set_content(body)
        msg.add_attachment(attachment_bytes, maintype="application", subtype="octet-stream", filename=attachment_name)

        with smtplib.SMTP(host, port) as smtp:
            smtp.starttls()
            smtp.login(user, password)
            smtp.send_message(msg)


scheduled_reports_service = ScheduledReportsService()
