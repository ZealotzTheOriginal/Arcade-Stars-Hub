import logging
from fastapi import Header, HTTPException, status
from app.core.firebase_client import verify_token

logger = logging.getLogger(__name__)


async def get_current_user(authorization: str = Header(...)) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ")
    try:
        return await verify_token(token)
    except Exception as e:
        logger.error("Token verification failed: %s", e)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
