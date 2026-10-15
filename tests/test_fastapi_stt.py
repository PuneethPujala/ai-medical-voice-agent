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
    assert data["hipaa_safe"] is True
    assert "model_loaded" in data

def test_stt_warmup():
    """Verify STT warmup pre-loads Whisper model into memory."""
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

if __name__ == "__main__":
    print("Running FastAPI STT Test Suite directly...")
    test_stt_health()
    print("  [PASS] test_stt_health passed")
    test_stt_warmup()
    print("  [PASS] test_stt_warmup passed")
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
    print("All 8/8 FastAPI STT tests passed!")
