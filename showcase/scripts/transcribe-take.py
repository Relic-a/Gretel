"""Run on the render server: python scripts/transcribe-take.py audio.wav."""
import sys
import json
from faster_whisper import WhisperModel

model = WhisperModel("base.en", device="cpu", compute_type="int8", cpu_threads=8)
segments, _ = model.transcribe(sys.argv[1], language="en", beam_size=3, word_timestamps=True)
for segment in segments:
    print(json.dumps({"start": segment.start, "end": segment.end, "text": segment.text,
                      "words": [{"word": w.word, "start": w.start, "end": w.end} for w in segment.words]}), flush=True)
