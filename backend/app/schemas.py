"""Pydantic-схемы для API."""
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


# ---------- Auth ----------
class RegisterIn(BaseModel):
    full_name: str
    email: str
    password: str
    role: str = "annotator"


class LoginIn(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


# ---------- User / Role ----------
class RoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    label: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    email: str
    role_id: int
    status: str
    role: Optional[RoleOut] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role_id: Optional[int] = None
    status: Optional[str] = None
    password: Optional[str] = None


# ---------- Project ----------
class ProjectIn(BaseModel):
    name: str
    description: str = ""
    customer: str = ""
    deadline: str = ""


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    description: str
    customer: str
    status: str
    deadline: str
    task_count: int = 0
    accepted_count: int = 0


# ---------- Media ----------
class MediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: Optional[int] = None
    audio_path: str
    video_path: str
    original_name: str
    duration: float
    format: str


# ---------- Task ----------
class TaskIn(BaseModel):
    project_id: int
    media_file_id: Optional[int] = None
    assignee_id: Optional[int] = None
    verifier_id: Optional[int] = None
    priority: str = "normal"
    deadline: str = ""


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    media_file_id: Optional[int] = None
    assignee_id: Optional[int] = None
    verifier_id: Optional[int] = None
    status: str
    priority: str
    deadline: str
    project_name: str = ""
    assignee_name: str = ""
    verifier_name: str = ""
    media_name: str = ""
    duration: float = 0.0
    segment_count: int = 0
    updated_at: Any = None


class TaskStatusIn(BaseModel):
    status: str


class AssignIn(BaseModel):
    assignee_id: Optional[int] = None
    verifier_id: Optional[int] = None


# ---------- Segment ----------
class SegmentIn(BaseModel):
    task_id: int
    start_time: float
    end_time: float
    text: str = ""
    speaker_name: str = ""
    confidence: float = 1.0
    is_crosstalk: bool = False
    status: str = "pending"


class SegmentUpdate(BaseModel):
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    text: Optional[str] = None
    speaker_name: Optional[str] = None
    status: Optional[str] = None
    is_crosstalk: Optional[bool] = None
    comment: Optional[str] = None


class SegmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int
    start_time: float
    end_time: float
    text: str
    speaker_name: str
    status: str
    confidence: float
    is_crosstalk: bool
    comment: str
    order_index: int


class SplitIn(BaseModel):
    at_time: float


class MergeIn(BaseModel):
    segment_ids: list[int]


# ---------- Term ----------
class TermIn(BaseModel):
    project_id: int
    value: str
    type: str = "term"
    comment: str = ""
    suggested_variant: str = ""


class TermUpdate(BaseModel):
    value: Optional[str] = None
    type: Optional[str] = None
    status: Optional[str] = None
    comment: Optional[str] = None
    suggested_variant: Optional[str] = None


class TermOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    value: str
    normalized_value: str
    type: str
    status: str
    comment: str
    suggested_variant: str
    created_at: Any = None


# ---------- Comment ----------
class CommentIn(BaseModel):
    task_id: int
    segment_id: Optional[int] = None
    text: str
    category: str = "general"


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int
    segment_id: Optional[int] = None
    author_id: Optional[int] = None
    author_name: str
    text: str
    category: str
    status: str
    created_at: Any = None


# ---------- Verification ----------
class VerifyIn(BaseModel):
    decision: str  # accepted / returned
    comment: str = ""
    score: float = 0.0


# ---------- Checklist ----------
class ChecklistIn(BaseModel):
    key: str
    label: str
    checked: bool


# ---------- Export ----------
class ExportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int
    format: str
    path: str
    created_at: Any = None


# ---------- AI ----------
class AIHint(BaseModel):
    segment_id: Optional[int] = None
    type: str
    message: str
    severity: str = "info"
    suggestion: str = ""


# ---------- Analytics ----------
class AnalyticsOut(BaseModel):
    project_id: int
    total_tasks: int = 0
    processed_tasks: int = 0
    accepted_tasks: int = 0
    rework_tasks: int = 0
    total_duration: float = 0.0
    total_segments: int = 0
    total_edits: int = 0
    total_comments: int = 0
    return_rate: float = 0.0
    terms: dict = {}
    by_status: dict = {}
    by_user: list = []
    progress: float = 0.0


class UserAnalyticsOut(BaseModel):
    user_id: int
    full_name: str
    role: str
    tasks_total: int = 0
    tasks_accepted: int = 0
    tasks_returned: int = 0
    edits: int = 0
    duration_seconds: float = 0.0
    quality_score: float = 0.0


# ---------- QualityCheck ----------
class QualityCheckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int
    check_type: str
    result: str
    message: str
    severity: str
    segment_id: Optional[int] = None


# ---------- Audit ----------
class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: Optional[int] = None
    user_name: str
    entity_type: str
    entity_id: Optional[int] = None
    action: str
    old_value: str
    new_value: str
    created_at: Any = None


TokenOut.model_rebuild()
