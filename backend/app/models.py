"""Модели данных (SQLAlchemy)."""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .database import Base


def utcnow():
    return datetime.now(timezone.utc)


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), unique=True, nullable=False)
    label = Column(String(100), nullable=False)
    permissions = Column(Text, default="[]")  # JSON-список прав

    users = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(200), nullable=False)
    email = Column(String(200), unique=True, index=True, nullable=False)
    password_hash = Column(String(300), nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    status = Column(String(20), default="active")  # active / blocked
    created_at = Column(DateTime, default=utcnow)

    role = relationship("Role", back_populates="users")
    assigned_tasks = relationship("Task", foreign_keys="Task.assignee_id", back_populates="assignee")
    verified_tasks = relationship("Task", foreign_keys="Task.verifier_id", back_populates="verifier")


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, default="")
    customer = Column(String(200), default="")
    instruction_file_id = Column(Integer, nullable=True)
    status = Column(String(20), default="active")  # active / archived
    deadline = Column(String(50), default="")
    created_at = Column(DateTime, default=utcnow)

    tasks = relationship("Task", back_populates="project", cascade="all, delete-orphan")
    terms = relationship("Term", back_populates="project", cascade="all, delete-orphan")


class MediaFile(Base):
    __tablename__ = "media_files"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    audio_path = Column(String(500), default="")
    video_path = Column(String(500), default="")
    original_name = Column(String(300), default="")
    duration = Column(Float, default=0.0)
    format = Column(String(20), default="wav")
    uploaded_at = Column(DateTime, default=utcnow)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    media_file_id = Column(Integer, ForeignKey("media_files.id"), nullable=True)
    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    verifier_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(30), default="new")
    priority = Column(String(20), default="normal")  # low / normal / high
    deadline = Column(String(50), default="")
    source_json = Column(Text, default="")  # исходная предразметка
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    project = relationship("Project", back_populates="tasks")
    media_file = relationship("MediaFile")
    assignee = relationship("User", foreign_keys=[assignee_id], back_populates="assigned_tasks")
    verifier = relationship("User", foreign_keys=[verifier_id], back_populates="verified_tasks")
    segments = relationship("Segment", back_populates="task", cascade="all, delete-orphan")
    speakers = relationship("Speaker", back_populates="task", cascade="all, delete-orphan")
    comments = relationship("Comment", back_populates="task", cascade="all, delete-orphan")
    transcripts = relationship("Transcript", back_populates="task", cascade="all, delete-orphan")
    quality_checks = relationship("QualityCheck", back_populates="task", cascade="all, delete-orphan")
    verification_results = relationship("VerificationResult", back_populates="task", cascade="all, delete-orphan")
    checklist_items = relationship("ChecklistItem", back_populates="task", cascade="all, delete-orphan")
    exports = relationship("ExportFile", back_populates="task", cascade="all, delete-orphan")


class Speaker(Base):
    __tablename__ = "speakers"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    original_name = Column(String(200), default="")
    display_name = Column(String(200), default="")
    editable = Column(Boolean, default=True)

    task = relationship("Task", back_populates="speakers")


class Segment(Base):
    __tablename__ = "segments"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    start_time = Column(Float, nullable=False, default=0.0)
    end_time = Column(Float, nullable=False, default=0.0)
    text = Column(Text, default="")
    speaker_id = Column(Integer, nullable=True)
    speaker_name = Column(String(200), default="")
    status = Column(String(20), default="pending")  # pending/checked/disputed/crosstalk
    confidence = Column(Float, default=1.0)
    is_crosstalk = Column(Boolean, default=False)
    comment = Column(Text, default="")
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    task = relationship("Task", back_populates="segments")
    edits = relationship("SegmentEdit", back_populates="segment", cascade="all, delete-orphan")


class SegmentEdit(Base):
    """История правок сегмента (текст/границы)."""
    __tablename__ = "segment_edits"

    id = Column(Integer, primary_key=True)
    segment_id = Column(Integer, ForeignKey("segments.id"), nullable=False)
    user_id = Column(Integer, nullable=True)
    field = Column(String(50), default="text")  # text / start / end
    old_value = Column(Text, default="")
    new_value = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)

    segment = relationship("Segment", back_populates="edits")


class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    source_json = Column(Text, default="")
    current_json = Column(Text, default="")
    version = Column(Integer, default=1)
    created_at = Column(DateTime, default=utcnow)

    task = relationship("Task", back_populates="transcripts")


class Term(Base):
    __tablename__ = "terms"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    value = Column(String(300), nullable=False)
    normalized_value = Column(String(300), default="")
    type = Column(String(50), default="term")  # term / abbreviation / disputed / unknown
    status = Column(String(20), default="new")
    comment = Column(Text, default="")
    suggested_variant = Column(String(300), default="")
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    project = relationship("Project", back_populates="terms")


class Comment(Base):
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    segment_id = Column(Integer, nullable=True)
    author_id = Column(Integer, nullable=True)
    author_name = Column(String(200), default="")
    text = Column(Text, default="")
    category = Column(String(50), default="general")  # text/boundary/term/crosstalk/general
    status = Column(String(20), default="open")  # open / resolved
    created_at = Column(DateTime, default=utcnow)

    task = relationship("Task", back_populates="comments")


class VerificationResult(Base):
    __tablename__ = "verification_results"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    verifier_id = Column(Integer, nullable=True)
    decision = Column(String(20), default="accepted")  # accepted / returned
    score = Column(Float, default=0.0)
    comment = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)

    task = relationship("Task", back_populates="verification_results")


class QualityCheck(Base):
    __tablename__ = "quality_checks"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    check_type = Column(String(100), nullable=False)
    result = Column(String(20), default="ok")  # ok / warning / error
    message = Column(Text, default="")
    severity = Column(String(20), default="info")
    segment_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    task = relationship("Task", back_populates="quality_checks")


class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    key = Column(String(100), nullable=False)
    label = Column(String(300), nullable=False)
    checked = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    task = relationship("Task", back_populates="checklist_items")


class ExportFile(Base):
    __tablename__ = "export_files"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    format = Column(String(50), default="gecko_json")
    path = Column(String(500), default="")
    created_at = Column(DateTime, default=utcnow)

    task = relationship("Task", back_populates="exports")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=True)
    user_name = Column(String(200), default="")
    entity_type = Column(String(50), default="")
    entity_id = Column(Integer, nullable=True)
    action = Column(String(100), default="")
    old_value = Column(Text, default="")
    new_value = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)


class TaskAssignmentHistory(Base):
    __tablename__ = "task_assignment_history"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    assignee_id = Column(Integer, nullable=True)
    verifier_id = Column(Integer, nullable=True)
    action = Column(String(100), default="")
    created_at = Column(DateTime, default=utcnow)
