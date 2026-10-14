"""ZaYoTm™ — FastAPI bootstrap. All routes live on api_router (prefix /api); the include
call below is the LAST route-registration statement, as the platform requires."""

import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from lib.db import client, db, ensure_indexes  # noqa: E402
from lib.errors import register_error_handlers  # noqa: E402
from lib.ratelimit import RateLimitMiddleware  # noqa: E402
from routers import audit as audit_router  # noqa: E402
from routers import cases as cases_router  # noqa: E402
from routers import datasets as datasets_router  # noqa: E402
from routers import identity as identity_router  # noqa: E402
from routers import system as system_router  # noqa: E402
from routers import trust as trust_router  # noqa: E402
from routers import workflows as workflows_router  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
    yield
    client.close()


app = FastAPI(
    lifespan=lifespan,
    title="ZaYoTm™ Universal Enterprise Intelligence & Trust Platform",
    version="0.9.0-prototype",
    description="Prototype for investor demonstration — implemented, simulated, and planned capabilities are explicitly labeled throughout.",
)
app.add_middleware(RateLimitMiddleware)
register_error_handlers(app)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Template status probe — kept as the minimal worked example of the route pattern.
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class StatusCheckCreate(BaseModel):
    client_name: str


@api_router.get("/")
async def root():
    return {"message": "ZaYoTm™ API — see /api/docs for the OpenAPI schema"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(**input.model_dump())
    _ = await db.status_checks.insert_one(status_obj.model_dump())
    return status_obj


@api_router.get("/status", response_model=list[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]


# Feature routers (each module exports its own APIRouter)
api_router.include_router(system_router.router)
api_router.include_router(identity_router.router)
api_router.include_router(datasets_router.router)
api_router.include_router(workflows_router.router)
api_router.include_router(cases_router.router)
api_router.include_router(trust_router.router)
api_router.include_router(audit_router.router)

# Include the router in the main app — keep this the last route-registration statement
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)
