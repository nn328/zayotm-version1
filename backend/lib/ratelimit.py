"""Lightweight in-memory rate limiter (Layer 2 gateway concern).

Token-bucket per client IP for mutating requests. Suitable for the single-pod
prototype; a production deployment would use a shared store (documented limitation).
"""

import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
MAX_TOKENS = 40
REFILL_PER_SEC = 0.5  # sustained 30 mutations/min per client


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.buckets: dict[str, list[float]] = defaultdict(lambda: [MAX_TOKENS, time.monotonic()])

    async def dispatch(self, request: Request, call_next):
        if request.method in MUTATING and request.url.path.startswith("/api"):
            ip = request.client.host if request.client else "unknown"
            bucket = self.buckets[ip]
            now = time.monotonic()
            bucket[0] = min(MAX_TOKENS, bucket[0] + (now - bucket[1]) * REFILL_PER_SEC)
            bucket[1] = now
            if bucket[0] < 1:
                return JSONResponse(
                    status_code=429,
                    content={"error": {"code": "rate_limited", "message": "Too many requests — slow down.", "status": 429, "details": {}}},
                )
            bucket[0] -= 1
        return await call_next(request)
