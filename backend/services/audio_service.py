import io
import os
import sys
import tempfile
import logging
from typing import Optional

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

logger = logging.getLogger("audio_service")

# Global singleton cache for local Whisper ASR model
_WHISPER_MODEL = None

def resolve_whisper_weights_path(model_name: str = "base.en") -> str:
    """
    Resolves the local filepath for Whisper model weights on disk.

    FAIL-CLOSED LOCAL-ONLY INVARIANT:
    If the requested model weights are not pre-provisioned on local disk, this function
    raises FileNotFoundError immediately. It NEVER triggers an automatic runtime download
    over the internet or contacts any external CDN.
    """
    # 1. Direct file path check
    if os.path.isfile(model_name):
        return os.path.abspath(model_name)

    # 2. Explicit environment variable override (for air-gapped / container deployments)
    explicit_path = os.getenv("WHISPER_MODEL_PATH")
    if explicit_path:
        if not os.path.isfile(explicit_path):
            raise FileNotFoundError(
                f"Configured WHISPER_MODEL_PATH '{explicit_path}' does not exist on local disk. "
                "Automatic runtime downloads are disabled in local-only mode."
            )
        return os.path.abspath(explicit_path)

    # 3. Standard Whisper cache root resolution
    import whisper
    if model_name not in whisper._MODELS:
        raise ValueError(
            f"Unknown Whisper model '{model_name}'. Available names: {', '.join(sorted(whisper._MODELS.keys()))}"
        )

    download_root = os.getenv(
        "WHISPER_WEIGHTS_DIR",
        os.path.join(os.getenv("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "whisper")
    )
    model_url = whisper._MODELS[model_name]
    expected_filename = os.path.basename(model_url)
    weights_path = os.path.join(download_root, expected_filename)

    if not os.path.isfile(weights_path):
        raise FileNotFoundError(
            f"Pre-provisioned Whisper weights for '{model_name}' not found at '{weights_path}'. "
            "FAIL-CLOSED INVARIANT: Automatic runtime model downloads from external CDNs "
            "are strictly disabled to prevent unexpected network egress. "
            "Please pre-provision model weights in deployment image or specify WHISPER_MODEL_PATH."
        )

    return os.path.abspath(weights_path)

def is_whisper_weights_present(model_name: str = "base.en") -> bool:
    """Returns True if the model weights file is physically present on local disk."""
    try:
        resolve_whisper_weights_path(model_name)
        return True
    except (FileNotFoundError, ValueError):
        return False

def get_whisper_model(model_name: str = "base.en"):
    """
    Loads and caches the local OpenAI Whisper model in memory from pre-provisioned disk weights.
    Defaults to 'base.en' (74M parameters, optimized for English clinical dialogue).
    Fails closed with FileNotFoundError if weights are missing on disk.
    """
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        try:
            import whisper
            weights_path = resolve_whisper_weights_path(model_name)
            logger.info(f"Loading local Whisper ASR weights from '{weights_path}' on CPU...")
            # Passing the exact resolved file path ensures whisper.load_model loads via torch.load
            # without ever attempting urllib downloads or network access.
            _WHISPER_MODEL = whisper.load_model(weights_path, device="cpu")
            logger.info(f"Local Whisper model '{model_name}' loaded successfully from local disk.")
        except Exception as e:
            logger.error(f"Failed to load local Whisper model '{model_name}': {e}")
            raise
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
    model_name: str = "base.en",
    initial_prompt: str = None
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
            clinical_prompt = "Medical consultation. Symptoms, onset sudden or gradual, duration, headache, pain, severity."
            if initial_prompt:
                clinical_prompt = f"{clinical_prompt} Context: {initial_prompt}"
            result = model.transcribe(temp_path, fp16=False, language="en", initial_prompt=clinical_prompt)
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
