"""Skills endpoint — returns the skill catalog from Registry."""

import logging

from fastapi import APIRouter

from registry import get_registry_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["skills"])


@router.get("/skills")
async def list_skills():
    client = get_registry_client()
    if not client:
        return {"skills": []}

    skills = []
    for name, record in client.skills.items():
        skills.append({
            "name": name,
            "description": record.description,
            "source": record.source,
        })

    skills.sort(key=lambda s: s["name"])
    return {"skills": skills}
