"""
MedVoice Clinical Response Evaluation Framework
Automated Multi-Model Clinical Text Embedder

Primary Endpoint:
- sentence-transformers/all-mpnet-base-v2 (768-dim dense representation)

Secondary Models (Exploratory / Sensitivity):
- sentence-transformers/all-MiniLM-L6-v2 (384-dim compact baseline)
- emilyalsentzer/Bio_ClinicalBERT (clinical domain pretrained LM)
- microsoft/BiomedNLP-PubMedBERT-base-uncased-abstract (biomedical domain pretrained LM)
"""

import hashlib
from typing import List, Optional, Dict
import numpy as np

PRIMARY_EMBEDDING_MODEL = "sentence-transformers/all-mpnet-base-v2"
SECONDARY_EMBEDDING_MODELS = [
    "sentence-transformers/all-MiniLM-L6-v2",
    "emilyalsentzer/Bio_ClinicalBERT",
    "microsoft/BiomedNLP-PubMedBERT-base-uncased-abstract",
]


class ClinicalEmbedder:
    """
    Manages embedding model lifecycles, caching, and batch inference.
    """

    _model_cache: Dict[str, any] = {}

    def __init__(
        self,
        default_model: str = PRIMARY_EMBEDDING_MODEL,
        device: Optional[str] = None,
        mock_mode: bool = False,
        embedding_dim: int = 768,
    ):
        self.default_model = default_model
        self.device = device
        self.mock_mode = mock_mode
        self.embedding_dim = embedding_dim

    def _get_model(self, model_name: str):
        """Loads and caches SentenceTransformer models in memory."""
        if model_name not in self._model_cache:
            from sentence_transformers import SentenceTransformer
            self._model_cache[model_name] = SentenceTransformer(
                model_name,
                device=self.device
            )
        return self._model_cache[model_name]

    def _mock_encode(self, texts: List[str], dim: int) -> np.ndarray:
        """
        Generates deterministic pseudo-embeddings for offline testing and CI.
        Derives vectors deterministically from SHA-256 hash of text.
        """
        embeddings = []
        for text in texts:
            # Deterministic seed from hash
            h = hashlib.sha256(text.encode("utf-8")).digest()
            seed = int.from_bytes(h[:4], "little")
            rng = np.random.RandomState(seed)
            vec = rng.randn(dim).astype(np.float32)
            # L2 normalize
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec = vec / norm
            embeddings.append(vec)
        return np.vstack(embeddings)

    def encode(
        self,
        texts: List[str],
        model_name: Optional[str] = None,
        batch_size: int = 32,
        normalize: bool = True,
    ) -> np.ndarray:
        """
        Encodes a list of clinical texts into dense embedding vectors.

        Args:
            texts: List of strings to encode.
            model_name: Model identifier (defaults to PRIMARY_EMBEDDING_MODEL).
            batch_size: Batch size for model inference.
            normalize: Whether to apply L2 unit normalization.

        Returns:
            np.ndarray: Float32 array of shape (len(texts), embedding_dim).
        """
        if not texts:
            return np.empty((0, self.embedding_dim), dtype=np.float32)

        active_model = model_name or self.default_model

        if self.mock_mode:
            dim = 384 if "MiniLM" in active_model else self.embedding_dim
            return self._mock_encode(texts, dim)

        model = self._get_model(active_model)
        embeddings = model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=False,
            normalize_embeddings=normalize,
            convert_to_numpy=True,
        )
        return embeddings.astype(np.float32)
