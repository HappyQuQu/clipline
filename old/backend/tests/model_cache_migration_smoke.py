"""Verify old snapshot caches are reused without downloading or copying weights."""
import os
import tempfile
import types
from pathlib import Path
from unittest.mock import patch


def main():
    with tempfile.TemporaryDirectory(prefix="clipline-model-migration-") as directory:
        os.environ.update(CLIPLINE_DATA=directory, CLIPLINE_DB=str(Path(directory) / "test.db"), CLIPLINE_MODEL_CACHE_DIR=str(Path(directory) / "models"))
        from app.services.model_cache import cached_modelscope_dir, modelscope_cache_root
        from app.services.model_manager import MODEL_REGISTRY, _is_funasr_downloaded, delete_model
        from app.services.asr import ASRService

        model_id = MODEL_REGISTRY[("funasr", "base")]["cache_pattern"]
        ids = [model_id, "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch", "iic/punc_ct-transformer_cn-en-common-vocab471067-large"]
        for value in ids:
            root = modelscope_cache_root() / "models" / value.replace("/", "--") / "snapshots/master"
            root.mkdir(parents=True)
            (root / "model.pt").write_bytes(b"isolated-test-weights")
        assert cached_modelscope_dir(model_id).name == "master"
        exists, size, _ = _is_funasr_downloaded(model_id)
        assert exists and size == len(b"isolated-test-weights")
        calls = []
        funasr = types.ModuleType("funasr")
        funasr.AutoModel = lambda **kwargs: calls.append(kwargs) or object()
        torch = types.ModuleType("torch")
        with patch.dict("sys.modules", {"funasr": funasr, "torch": torch}):
            ASRService()._load_funasr("base", "cpu")
        assert calls[0]["model"] == str(cached_modelscope_dir(model_id))
        assert calls[0]["vad_model"] == str(cached_modelscope_dir(ids[1]))
        assert calls[0]["punc_model"] == str(cached_modelscope_dir(ids[2]))
        assert delete_model("funasr:medium") is True
        assert cached_modelscope_dir(model_id) is None
        assert cached_modelscope_dir(ids[1]) is not None
        print("PASS: legacy cache detection, local ASR paths, deletion and shared-model preservation")


if __name__ == "__main__":
    main()
