"""Projects API."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require_admin, require_any, require_supervisor
from ..services.audit import log

router = APIRouter(prefix="/projects", tags=["projects"])


def _project_out(db: Session, p: models.Project) -> schemas.ProjectOut:
    tasks = db.query(models.Task).filter(models.Task.project_id == p.id).all()
    return schemas.ProjectOut(
        id=p.id,
        name=p.name,
        description=p.description,
        customer=p.customer,
        status=p.status,
        deadline=p.deadline,
        task_count=len(tasks),
        accepted_count=sum(1 for t in tasks if t.status in ("accepted", "exported")),
    )


@router.get("", response_model=list[schemas.ProjectOut])
def list_projects(db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    projects = db.query(models.Project).filter(models.Project.status == "active").all()
    return [_project_out(db, p) for p in projects]


@router.post("", response_model=schemas.ProjectOut)
def create_project(
    data: schemas.ProjectIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_supervisor),
):
    project = models.Project(
        name=data.name,
        description=data.description,
        customer=data.customer,
        deadline=data.deadline,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    log(db, user, "project", project.id, "create", new_value=project.name)
    return _project_out(db, project)


@router.get("/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_any)):
    project = db.get(models.Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Проект не найден")
    return _project_out(db, project)


@router.put("/{project_id}", response_model=schemas.ProjectOut)
def update_project(
    project_id: int,
    data: schemas.ProjectIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_supervisor),
):
    project = db.get(models.Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Проект не найден")
    old = project.name
    project.name = data.name
    project.description = data.description
    project.customer = data.customer
    project.deadline = data.deadline
    db.commit()
    log(db, user, "project", project.id, "update", old_value=old, new_value=project.name)
    return _project_out(db, project)


@router.delete("/{project_id}")
def archive_project(project_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    project = db.get(models.Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Проект не найден")
    project.status = "archived"
    db.commit()
    log(db, user, "project", project.id, "archive", new_value=project.name)
    return {"ok": True}
