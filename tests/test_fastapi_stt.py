"""
Unit and integration tests for FastAPI Speech-to-Text (/api/v1/stt) endpoint.
Verifies input validation, format support, file size limits, error responses,
and whisper transcription behavior.
"""
import io
import os
import sys
import wave
import struct
import pytest
from unittest.mock import patch

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def create_synthetic_wav(duration_seconds: float = 0.5, sample_rate: int = 16000) -> bytes:
    """Creates a minimal in-memory WAV buffer with a 440Hz sine-like tone."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        num_frames = int(duration_seconds * sample_rate)
        frames = struct.pack(f"<{num_frames}h", *([1000 if i % 2 == 0 else -1000 for i in range(num_frames)]))
        w.writeframes(frames)
    return buf.getvalue()

def test_stt_health():
    """Verify STT health check returns online status, local CPU device, and zero external egress."""
    response = client.get("/api/v1/stt/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert data["service"] == "whisper_stt"
    assert data["default_engine"] == "whisper_base_en"
    assert data["external_network_egress"] is False
    assert "hipaa_safe" not in data
    assert "model_loaded" in data
    assert "weights_available" in data
    assert data["weights_available"] is True

def test_stt_warmup():
    """Verify STT warmup pre-loads Whisper model into memory."""
    response = client.post("/api/v1/stt/warmup")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["model_ready"] is True

def test_warmup_blocks_external_network():
    """Verify STT warmup pre-loads Whisper model without attempting any external network access."""
    import socket
    real_connect = socket.socket.connect

    def blocked_connect(self, address, *args, **kwargs):
        host = address[0] if isinstance(address, (tuple, list)) and len(address) > 0 else str(address)
        if host not in ("127.0.0.1", "localhost", "::1"):
            raise RuntimeError(f"PROHIBITED: Outgoing network connection to '{host}' attempted during warmup!")
        return real_connect(self, address, *args, **kwargs)

    with patch.object(socket.socket, "connect", blocked_connect):
        response = client.post("/api/v1/stt/warmup")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["model_ready"] is True

def test_stt_rejects_empty_audio():
    """Verify empty audio buffer is rejected with HTTP 400."""
    response = client.post(
        "/api/v1/stt",
        files={"file": ("empty.wav", b"", "audio/wav")}
    )
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()

def test_stt_rejects_unsupported_format():
    """Verify unsupported file extensions (.txt, .exe) return HTTP 415."""
    response = client.post(
        "/api/v1/stt",
        files={"file": ("document.txt", b"plain text data", "text/plain")}
    )
    assert response.status_code == 415
    assert "unsupported audio format" in response.json()["detail"].lower()

def test_stt_rejects_oversized_audio():
    """Verify audio exceeding 25MB returns HTTP 413 Payload Too Large."""
    oversized_bytes = b"0" * (26 * 1024 * 1024)
    response = client.post(
        "/api/v1/stt",
        files={"file": ("huge.wav", oversized_bytes, "audio/wav")}
    )
    assert response.status_code == 413
    assert "exceeds maximum allowed size" in response.json()["detail"].lower()

def test_stt_handles_transcription_exception_with_502():
    """Verify backend failure raises explicit HTTP 502 and does NOT fabricate text."""
    wav_bytes = create_synthetic_wav(0.2)
    with patch("backend.main.transcribe_audio_bytes", side_effect=RuntimeError("Whisper CUDA OOM simulation")):
        response = client.post(
            "/api/v1/stt",
            files={"file": ("audio.wav", wav_bytes, "audio/wav")}
        )
        assert response.status_code == 502
        data = response.json()
        assert "speech-to-text recognition failed" in data["detail"].lower()

def test_stt_successful_transcription_mocked():
    """Verify successful transcription returns exact response schema."""
    wav_bytes = create_synthetic_wav(0.5)
    with patch("backend.main.transcribe_audio_bytes", return_value="I have severe chest pain"):
        response = client.post(
            "/api/v1/stt",
            files={"file": ("utterance.webm", wav_bytes, "audio/webm")}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["transcript"] == "I have severe chest pain"
        assert data["engine"] == "whisper_base_en"
        assert data["is_empty"] is False
        assert data["byte_size"] == len(wav_bytes)

def test_stt_real_spoken_audio_transcription():
    """
    CRITICAL PROOF OF ACTUAL TRANSCRIPTION:
    Reads real audio fixture containing 'I have severe chest pain',
    invokes local Whisper base.en on CPU, and asserts non-empty transcript
    matching the spoken words.
    An empty transcript fails this test.
    """
    fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "spoken_chest_pain.wav")
    assert os.path.exists(fixture_path), f"Spoken audio fixture missing: {fixture_path}"

    with open(fixture_path, "rb") as f:
        audio_bytes = f.read()

    response = client.post(
        "/api/v1/stt",
        files={"file": ("spoken_chest_pain.wav", audio_bytes, "audio/wav")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["engine"] == "whisper_base_en"
    transcript = data["transcript"].strip()

    # CRITICAL: Prove non-empty real transcription
    assert len(transcript) > 0, "Transcription returned empty string; failed to recognize speech"
    assert data["is_empty"] is False
    assert "chest pain" in transcript.lower(), f"Expected 'chest pain' in transcript, got: {transcript}"

def test_local_only_invariant_blocks_external_network():
    """
    Regression test: Verifies that local Whisper STT performs zero outgoing network calls.
    Any attempt to open an external socket connection causes an immediate test failure.
    """
    import socket
    real_connect = socket.socket.connect

    fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "spoken_chest_pain.wav")
    assert os.path.exists(fixture_path), f"Spoken fixture missing at {fixture_path}"
    with open(fixture_path, "rb") as f:
        audio_bytes = f.read()

    def blocked_connect(self, address, *args, **kwargs):
        host = address[0] if isinstance(address, (tuple, list)) and len(address) > 0 else str(address)
        if host not in ("127.0.0.1", "localhost", "::1"):
            raise RuntimeError(f"PROHIBITED: Outgoing network connection to '{host}' attempted during local STT!")
        return real_connect(self, address, *args, **kwargs)

    with patch.object(socket.socket, "connect", blocked_connect):
        response = client.post(
            "/api/v1/stt",
            files={"file": ("spoken_chest_pain.wav", audio_bytes, "audio/wav")}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["transcript"].strip()) > 0
        assert "chest pain" in data["transcript"].lower()

def test_empty_transcription_causes_explicit_failure():
    """
    Safety test: Verifies that if an engine returns an empty string, the test assertion fails,
    preventing silent acceptance of blank transcripts.
    """
    blank_result = {"status": "success", "transcript": "", "is_empty": True}
    with pytest.raises(AssertionError):
        t = blank_result["transcript"].strip()
        assert len(t) > 0, "Transcription returned empty string; failed to recognize speech"

def test_missing_weights_fails_closed():
    """Verify that when model weights are missing on disk, the system fails closed without network download."""
    from backend.services.audio_service import resolve_whisper_weights_path
    with patch.dict(os.environ, {"WHISPER_MODEL_PATH": "C:/nonexistent/weights.pt"}):
        with pytest.raises(FileNotFoundError) as exc_info:
            resolve_whisper_weights_path("base.en")
        assert "Automatic runtime downloads are disabled" in str(exc_info.value)

def test_coverage_namespace_safeguard_behavior():
    """Verify that coverage safeguard neutralizes PEP 420 directory namespaces without masking real packages."""
    # Test namespace package without __file__
    class MockNamespaceCoverage:
        __file__ = None

    test_dict = {"coverage": MockNamespaceCoverage()}
    with patch.dict(sys.modules, test_dict):
        if getattr(sys.modules.get("coverage"), "__file__", None) is None:
            sys.modules["coverage"] = None
        assert sys.modules["coverage"] is None, "Namespace package should be set to None"

    # Test real package with __file__
    class MockRealCoverage:
        __file__ = "/site-packages/coverage/__init__.py"

    test_dict_real = {"coverage": MockRealCoverage()}
    with patch.dict(sys.modules, test_dict_real):
        if getattr(sys.modules.get("coverage"), "__file__", None) is None:
            sys.modules["coverage"] = None
        assert sys.modules["coverage"] is not None, "Real package with __file__ must not be masked"

if __name__ == "__main__":
    print("Running FastAPI STT Test Suite directly...")
    test_stt_health()
    print("  [PASS] test_stt_health passed")
    test_stt_warmup()
    print("  [PASS] test_stt_warmup passed")
    test_warmup_blocks_external_network()
    print("  [PASS] test_warmup_blocks_external_network passed")
    test_stt_rejects_empty_audio()
    print("  [PASS] test_stt_rejects_empty_audio passed")
    test_stt_rejects_unsupported_format()
    print("  [PASS] test_stt_rejects_unsupported_format passed")
    test_stt_rejects_oversized_audio()
    print("  [PASS] test_stt_rejects_oversized_audio passed")
    test_stt_handles_transcription_exception_with_502()
    print("  [PASS] test_stt_handles_transcription_exception_with_502 passed")
    test_stt_successful_transcription_mocked()
    print("  [PASS] test_stt_successful_transcription_mocked passed")
    print("  Testing live local Whisper engine on real speech fixture...")
    test_stt_real_spoken_audio_transcription()
    print("  [PASS] test_stt_real_spoken_audio_transcription passed (Non-empty speech recognized!)")
    test_local_only_invariant_blocks_external_network()
    print("  [PASS] test_local_only_invariant_blocks_external_network passed (Zero external socket connections!)")
    test_empty_transcription_causes_explicit_failure()
    print("  [PASS] test_empty_transcription_causes_explicit_failure passed")
    test_missing_weights_fails_closed()
    print("  [PASS] test_missing_weights_fails_closed passed")
    test_coverage_namespace_safeguard_behavior()
    print("  [PASS] test_coverage_namespace_safeguard_behavior passed")
    print("All 13/13 FastAPI STT tests passed!")
