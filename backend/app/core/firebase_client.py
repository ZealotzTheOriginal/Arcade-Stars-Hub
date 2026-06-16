import asyncio
import json
import logging
import os
import firebase_admin
from firebase_admin import credentials, auth, firestore

from app.core.config import settings

logger = logging.getLogger(__name__)
_app: firebase_admin.App | None = None


def get_firebase_app() -> firebase_admin.App:
    global _app
    if _app is None:
        json_str = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
        if json_str:
            logger.info("Initializing Firebase Admin from FIREBASE_SERVICE_ACCOUNT_JSON env var")
            cred = credentials.Certificate(json.loads(json_str))
        else:
            logger.info("Initializing Firebase Admin from file: %s", settings.firebase_service_account_path)
            cred = credentials.Certificate(settings.firebase_service_account_path)
        _app = firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin initialized OK")
    return _app


def get_db():
    get_firebase_app()
    return firestore.client()


async def verify_token(id_token: str) -> dict:
    get_firebase_app()
    decoded = await asyncio.to_thread(auth.verify_id_token, id_token)
    return decoded
