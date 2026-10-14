"""Structured error handling for the API gateway (Layer 2)."""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("zayotm.errors")


class ApiError(HTTPException):
    """Domain error carrying a stable machine code for the frontend."""

    def __init__(self, status_code: int, code: str, message: str, details: dict | None = None):
        super().__init__(status_code=status_code, detail={"code": code, "message": message, "details": details or {}})
        self.code = code


def error_body(status: int, code: str, message: str, details: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "status": status, "details": details or {}}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exc_handler(request: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "http_error", "message": str(exc.detail)}
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.status_code, detail.get("code", "http_error"), detail.get("message", ""), detail.get("details")),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=error_body(422, "validation_error", "Request body failed schema validation.", {"errors": exc.errors()[:10]}),
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception):
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content=error_body(500, "internal_error", "Unexpected server error."))
