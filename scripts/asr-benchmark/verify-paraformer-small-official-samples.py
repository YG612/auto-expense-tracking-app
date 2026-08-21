import argparse
import json
import os
import sys
import time
import wave

import numpy as np


EXPECTED_TRANSCRIPTS = {
    "0.wav": "对我做了介绍那么我想说的是呢大家如果对我的研究感兴趣呢",
    "1.wav": "重点呢想谈三个问题首先呢就是这一轮全球金融动荡的表现",
    "8k.wav": "深入的分析这一次全球金融动荡背后的根源",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-runtime", required=True)
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--sample-root", required=True)
    return parser.parse_args()


def read_wave(path: str) -> tuple[int, np.ndarray, float]:
    with wave.open(path, "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise RuntimeError(f"Unsupported official WAV format: {path}")
        sample_rate = source.getframerate()
        sample_count = source.getnframes()
        samples = np.frombuffer(
            source.readframes(sample_count), dtype=np.int16
        ).astype(np.float32) / 32768.0
    return sample_rate, samples, sample_count / sample_rate


def main() -> None:
    args = parse_args()
    sys.path.insert(0, os.path.abspath(args.python_runtime))
    import sherpa_onnx

    load_started = time.perf_counter()
    recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
        tokens=os.path.join(args.model_root, "tokens.txt"),
        paraformer=os.path.join(args.model_root, "model.int8.onnx"),
        num_threads=2,
        sample_rate=16000,
        feature_dim=80,
        decoding_method="greedy_search",
        provider="cpu",
    )
    load_seconds = time.perf_counter() - load_started

    results = {}
    for name in sorted(os.listdir(args.sample_root)):
        if not name.lower().endswith(".wav"):
            continue
        sample_rate, samples, duration_seconds = read_wave(
            os.path.join(args.sample_root, name)
        )
        stream = recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        decode_started = time.perf_counter()
        recognizer.decode_stream(stream)
        decode_seconds = time.perf_counter() - decode_started
        transcript = stream.result.text
        expected = EXPECTED_TRANSCRIPTS.get(name)
        results[name] = {
            "sampleRateHz": sample_rate,
            "durationSeconds": round(duration_seconds, 3),
            "decodeSeconds": round(decode_seconds, 3),
            "realTimeFactor": round(decode_seconds / duration_seconds, 4),
            "transcript": transcript,
            "expectedTranscript": expected,
            "exactMatch": transcript == expected if expected is not None else None,
        }

    sys.stdout.reconfigure(encoding="utf-8")
    print(
        json.dumps(
            {
                "runtimeVersion": sherpa_onnx.__version__,
                "loadSeconds": round(load_seconds, 3),
                "results": results,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
