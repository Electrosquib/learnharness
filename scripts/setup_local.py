"""Install the local speech runtime in this project; existing model weights are reused."""
from pathlib import Path
import os
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
environment = root / ".venv"
python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if not python.exists():
    subprocess.run([sys.executable, "-m", "venv", str(environment)], check=True)
subprocess.run([str(python), "-m", "pip", "install", "-r", str(root / "scripts/requirements-stt.txt")], check=True)
print("Local speech is ready. Existing weights are read from Desktop/model_paths.md or LH_WHISPER_MODEL.")
print("Start LearnHarness with npm run dev. No transcription weights were downloaded; faster-whisper includes its small VAD model.")
