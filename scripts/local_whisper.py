"""Warm, local-only faster-whisper worker. JSON lines in/out; audio is 16 kHz PCM16."""
import base64
import json
import os
from pathlib import Path
import re
import sys

os.environ["HF_HUB_OFFLINE"] = "1"


def model_path():
    configured = os.environ.get("LH_WHISPER_MODEL")
    if configured:
        path = Path(configured).expanduser()
        return path.parent if path.is_file() else path
    registry = Path.home() / "Desktop" / "model_paths.md"
    lines = registry.read_text(encoding="utf-8").splitlines() if registry.exists() else []
    for name in ("faster-distil-whisper-large-v3", "faster-whisper-medium.en"):
        for line in lines:
            if name in line:
                for value in re.findall(r"`([^`]+)`", line):
                    path = Path(value)
                    if path.name == "model.bin" and path.is_file():
                        return path.parent
    raise RuntimeError("Set LH_WHISPER_MODEL to your existing faster-whisper model folder, or list it in Desktop/model_paths.md.")


def main():
    import ctranslate2
    import numpy as np
    from faster_whisper import WhisperModel

    # Optional CUDA DLL locations are machine configuration, never downloaded weights.
    dll_handles = []
    folders = os.environ.get("LH_WHISPER_DLL_DIR", "").split(os.pathsep)
    folders += [str(p) for p in (Path(sys.prefix) / "Lib/site-packages/nvidia").glob("*/bin")]
    for folder in folders:
        if folder and hasattr(os, "add_dll_directory"):
            dll_handles.append(os.add_dll_directory(folder))
            os.environ["PATH"] = folder + os.pathsep + os.environ.get("PATH", "")
    model_dir = model_path()
    device = os.environ.get("LH_WHISPER_DEVICE", "cuda" if ctranslate2.get_cuda_device_count() else "cpu")

    def load(target):
        return WhisperModel(str(model_dir), device=target, compute_type="int8_float16" if target == "cuda" else "int8", local_files_only=True)

    try:
        model = load(device)
        # Exercise the kernels before reporting ready so missing GPU libraries fail here.
        list(model.transcribe(np.zeros(16000, dtype=np.float32), language="en", beam_size=1)[0])
    except RuntimeError as error:
        print(f"GPU unavailable: {error}", file=sys.stderr, flush=True)
        if device != "cuda":
            raise
        device = "cpu"
        model = load(device)
    print(json.dumps({"ready": True, "device": device}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            raw = base64.b64decode(request["audio"], validate=True)
            if not raw or len(raw) % 2 or len(raw) > 640000:
                raise ValueError("Audio must be PCM16, 16 kHz mono, at most 20 seconds")
            audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
            segments, _ = model.transcribe(audio, language="en", beam_size=1, vad_filter=True, condition_on_previous_text=False)
            print(json.dumps({"id": request["id"], "text": " ".join(s.text.strip() for s in segments).strip()}), flush=True)
        except Exception as error:
            print(json.dumps({"id": request.get("id"), "error": str(error)}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}), flush=True)
        sys.exit(1)
