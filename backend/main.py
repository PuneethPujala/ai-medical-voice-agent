import os
import sys
import logging
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# Specific safeguard for local ./coverage directory (PEP 420 directory namespace without __file__)
# created by JavaScript coverage tools in the monorepo root.
# Only neutralizes un-initialized namespace packages without __file__ and missing modules.
# Genuine PyPI packages with valid __file__ are preserved, and non-ModuleNotFoundError failures are NOT masked.
if "coverage" not in sys.modules:
    try:
        import coverage
        if getattr(coverage, "__file__", None) is None:
            sys.modules["coverage"] = None
    except ModuleNotFoundError:
        sys.modules["coverage"] = None

from backend.config import settings
from backend.services.audio_service import (
    transcribe_audio_bytes,
    is_whisper_model_loaded,
    is_whisper_weights_present,
    get_whisper_model
)

logger = logging.getLogger("backend.main")

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB max audio upload
MAX_INGRESS_PAYLOAD_BYTES = MAX_AUDIO_BYTES + (256 * 1024)  # 25 MB + 256 KB envelope margin
ALLOWED_AUDIO_EXTENSIONS = {".wav", ".webm", ".ogg", ".mp3", ".m4a", ".mp4", ".flac"}

class ContentSizeLimitMiddleware:
    """
    ASGI middleware enforcing strict bounded ingress payloads before buffer allocation.
    - Drops requests immediately if declared Content-Length > MAX_INGRESS_PAYLOAD_BYTES.
    - Intercepts incoming ASGI request chunks to enforce a hard ceiling on chunked / unannounced streams.
    """
    def __init__(self, app, max_bytes: int = MAX_INGRESS_PAYLOAD_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length_raw = headers.get(b"content-length")
        if content_length_raw:
            try:
                if int(content_length_raw) > self.max_bytes:
                    res = JSONResponse(
                        {"detail": f"Payload exceeds maximum allowed size of {self.max_bytes // (1024 * 1024)} MB."},
                        status_code=413
                    )
                    await res(scope, receive, send)
                    return
            except ValueError:
                pass

        total_bytes = 0
        stream_exceeded = False
        response_started = False

        async def limited_receive():
            nonlocal total_bytes, stream_exceeded
            message = await receive()
            if message["type"] == "http.request":
                body = message.get("body", b"")
                total_bytes += len(body)
                if total_bytes > self.max_bytes:
                    stream_exceeded = True
                    raise ValueError("STREAM_EXCEEDED")
            return message

        async def limited_send(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                if stream_exceeded:
                    message = {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [
                            (b"content-type", b"application/json"),
                        ]
                    }
            elif message["type"] == "http.response.body":
                if stream_exceeded:
                    detail_json = f'{{"detail": "Audio file exceeds maximum allowed size of {self.max_bytes // (1024 * 1024)} MB."}}'.encode("utf-8")
                    message = {
                        "type": "http.response.body",
                        "body": detail_json,
                        "more_body": False
                    }
            await send(message)

        try:
            await self.app(scope, limited_receive, limited_send)
        except Exception:
            if stream_exceeded:
                if not response_started:
                    res = JSONResponse(
                        {"detail": f"Audio file exceeds maximum allowed size of {self.max_bytes // (1024 * 1024)} MB."},
                        status_code=413
                    )
                    await res(scope, receive, send)
            else:
                raise

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Python Audio Processing & Heavy DSP Microservice for MedVoice",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Content Size Limiter Middleware (bound ingress payloads before memory allocation)
app.add_middleware(ContentSizeLimitMiddleware, max_bytes=MAX_INGRESS_PAYLOAD_BYTES)

# CORS Middleware Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
)

# Defensive Security Headers Middleware
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(self), geolocation=()"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response

@app.get("/")
async def root():
    return {
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "online",
        "docs": "/docs",
        "health": "/health"
    }

@app.get("/health")
async def health_check():
    return {
        "status": "online",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION
    }

# -----------------------------------------------------------------------------
# Canonical Whisper Speech-to-Text (STT) Endpoint
# -----------------------------------------------------------------------------

@app.get("/api/v1/stt/health")
async def stt_health():
    """
    Returns the operational status of the Speech-to-Text service.
    Distinguishes service connectivity readiness from actual in-memory Whisper model readiness
    and local pre-provisioned weights availability on disk.

    SCOPE OF external_network_egress:
    Declares strictly that the Python STT transcription engine operates on local CPU and
    initiates zero external network calls for patient audio. This technical property applies
    exclusively to the STT service; it does NOT imply that the host, OS, container, or
    upstream Next.js services (e.g. conversational LLM gateways) are blocked from network egress.
    """
    model_loaded = is_whisper_model_loaded()
    weights_available = is_whisper_weights_present("base.en")
    return {
        "status": "online",
        "service": "whisper_stt",
        "default_engine": "whisper_base_en",
        "model_loaded": model_loaded,
        "weights_available": weights_available,
        "inference_device": "cpu",
        "external_network_egress": False
    }

@app.post("/api/v1/stt/warmup")
async def stt_warmup():
    """
    Explicitly pre-loads the local Whisper base.en model into memory from pre-provisioned disk weights.
    Eliminates first-call disk I/O latency penalty during active patient consultation.
    FAILS CLOSED: If weights are missing, raises 503 without attempting any runtime internet download.
    """
    try:
        model = get_whisper_model("base.en")
        return {
            "status": "success",
            "message": "Whisper base.en loaded into memory successfully.",
            "model_ready": model is not None
        }
    except FileNotFoundError as fnf_err:
        logger.error(f"STT warmup failed closed (weights missing): {fnf_err}")
        raise HTTPException(
            status_code=503,
            detail=f"Speech recognition service unavailable (weights not provisioned): {str(fnf_err)}"
        )
    except Exception as e:
        logger.error(f"STT warmup failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to pre-load Whisper model: {str(e)}")

@app.post("/api/v1/stt")
async def speech_to_text(
    file: UploadFile = File(...),
    prompt: str = Form(None)
):
    """
    Receives raw audio files (e.g. .wav, .webm, .ogg) from client / Next.js bridge,
    runs local OpenAI Whisper ASR (base.en) on CPU, and returns transcribed text.

    ZERO-TRUST PRIVACY INVARIANT:
    Patient speech NEVER leaves this machine. No cloud API is ever contacted.

    CLINICAL SAFETY INVARIANT:
    Under NO circumstances will this endpoint fabricate transcript text or hallucinate
    symptoms upon transcription failure. Explicit error codes are returned so the client
    can prompt the patient to repeat their statement.
    """
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Audio file must be provided.")

    filename = file.filename
    ext = os.path.splitext(filename)[1].lower() if filename else ".wav"
    if ext and ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported audio format: '{ext}'. Allowed extensions: {', '.join(sorted(ALLOWED_AUDIO_EXTENSIONS))}"
        )

    chunks = []
    total_read = 0
    try:
        while True:
            chunk = await file.read(64 * 1024)
            if not chunk:
                break
            total_read += len(chunk)
            if total_read > MAX_AUDIO_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Audio file exceeds maximum allowed size of {MAX_AUDIO_BYTES // (1024 * 1024)} MB."
                )
            chunks.append(chunk)
        audio_bytes = b"".join(chunks)
    except HTTPException:
        raise
    except Exception as read_err:
        logger.error(f"Failed to read uploaded audio stream: {read_err}")
        raise HTTPException(status_code=400, detail=f"Failed to read audio stream: {str(read_err)}")
    finally:
        await file.close()

    if not audio_bytes or len(audio_bytes) == 0:
        raise HTTPException(
            status_code=400,
            detail="Uploaded audio file is empty. Please speak clearly into the microphone."
        )

    try:
        transcript = transcribe_audio_bytes(
            audio_bytes=audio_bytes,
            filename=filename,
            model_name="base.en",
            initial_prompt=prompt
        )
        return {
            "status": "success",
            "transcript": transcript,
            "engine": "whisper_base_en",
            "is_empty": len(transcript) == 0,
            "byte_size": len(audio_bytes)
        }
    except FileNotFoundError as fnf_err:
        logger.error(f"STT recognition failed closed (weights missing): {fnf_err}")
        raise HTTPException(
            status_code=503,
            detail=f"Speech recognition service unavailable (weights not provisioned): {str(fnf_err)}"
        )
    except ValueError as ve:
        logger.warning(f"STT input validation notice: {ve}")
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.error(f"STT transcription failure: {e}", exc_info=True)
        raise HTTPException(
            status_code=502,
            detail=f"Speech-to-text recognition failed: {str(e)}"
        )

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True
    )
