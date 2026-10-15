import io
import os
import sys
import tempfile
import logging
from typing import Optional

# Safeguard against local ./coverage directory (from JS test runners) shadowing Python coverage module.
# A real PyPI coverage package defines __file__ and types; a directory namespace package does not.
if "coverage" not in sys.modules:
    try:
        import coverage
        if getattr(coverage, "__file__", None) is None or not hasattr(coverage, "types"):
            sys.modules["coverage"] = None
    except Exception:
        sys.modules["coverage"] = None

logger = logging.getLogger("audio_service")

# Global singleton cache for local Whisper ASR model
_WHISPER_MODEL = None

def get_whisper_model(model_name: str = "base.en"):
    """
    Loads and caches the local OpenAI Whisper model in memory.
    Defaults to 'base.en' (74M parameters, optimized for English clinical dialogue).
    """
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        try:
            import whisper
            logger.info(f"Initializing local Whisper ASR model '{model_name}' on CPU...")
            _WHISPER_MODEL = whisper.load_model(model_name)
            logger.info(f"Local Whisper model '{model_name}' loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load local Whisper model '{model_name}': {e}")
            raise RuntimeError(f"Local Whisper ASR initialization failed: {e}")
    return _WHISPER_MODEL

def is_whisper_model_loaded() -> bool:
    """Returns True if the local Whisper model is already loaded in memory."""
    return _WHISPER_MODEL is not None

def synthesize_speech_text(text: str, lang: str = "en") -> bytes:
    """
    Synthesizes speech audio (MP3) from text using gTTS (Google Text-To-Speech) or fallback bytes.
    Note: The primary consultation experience uses local Kokoro TTS.
    """
    try:
        from gtts import gTTS
        tts = gTTS(text=text, lang=lang, slow=False)
        mp3_fp = io.BytesIO()
        tts.write_to_fp(mp3_fp)
        mp3_fp.seek(0)
        return mp3_fp.read()
    except Exception as e:
        logger.warning(f"gTTS speech synthesis error: {e}")
        return b"ID3\x04\x00\x00\x00\x00\x00\x00"

def transcribe_audio_bytes(
    audio_bytes: bytes,
    filename: str = "audio.wav",
    model_name: str = "base.en"
) -> str:
    """
    Transcribes patient audio bytes to text strictly using local OpenAI Whisper on CPU.
    
    ZERO-TRUST PRIVACY INVARIANT:
    Patient audio bytes NEVER leave the local host. No third-party or cloud transcription
    API is ever contacted.
    
    CLINICAL SAFETY INVARIANT:
    Under NO circumstances will this function fabricate symptoms or return
    a canned synthetic transcript upon failure. If ASR fails, an explicit error
    is raised so the system can prompt the patient to repeat.
    """
    if not audio_bytes or len(audio_bytes) == 0:
        raise ValueError("Audio buffer is empty. No patient speech recorded.")

    # Determine file extension from filename if provided, else default to .wav
    ext = os.path.splitext(filename)[1].lower() if filename else ".wav"
    if not ext or ext not in [".wav", ".webm", ".ogg", ".mp3", ".m4a", ".mp4", ".flac"]:
        ext = ".wav"

    temp_path = None
    try:
        # Write bytes to temp file so ffmpeg / whisper can decode any container format
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(audio_bytes)
            temp_path = tmp.name

        # Local Whisper execution on CPU (Zero cloud egress)
        try:
            model = get_whisper_model(model_name)
            result = model.transcribe(temp_path, fp16=False, language="en")
            transcript_text = result.get("text", "").strip()
            
            logger.info(f"Local Whisper ASR successfully transcribed {len(audio_bytes)} bytes ({len(transcript_text)} characters) [PHI masked]")
            return transcript_text
        except Exception as local_err:
            logger.error(f"Local Whisper transcription failed: {local_err}")
            raise RuntimeError(f"Local Whisper ASR recognition failed: {local_err}")

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as cleanup_err:
                logger.debug(f"Failed to remove temp audio file {temp_path}: {cleanup_err}")
