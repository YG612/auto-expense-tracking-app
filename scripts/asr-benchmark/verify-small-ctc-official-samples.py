import argparse
import json
import os
import sys
import wave

import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-runtime", required=True)
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--sample-root", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    sys.path.insert(0, os.path.abspath(args.python_runtime))
    import sherpa_onnx

    recognizer = sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc(
        tokens=os.path.join(args.model_root, "tokens.txt"),
        model=os.path.join(args.model_root, "model.int8.onnx"),
        num_threads=2,
        sample_rate=16000,
        feature_dim=80,
        enable_endpoint_detection=False,
        decoding_method="greedy_search",
        provider="cpu",
    )
    results = {}
    for name in ("0.wav", "1.wav", "8k.wav"):
        with wave.open(os.path.join(args.sample_root, name), "rb") as source:
            if source.getnchannels() != 1 or source.getsampwidth() != 2:
                raise RuntimeError(f"Unsupported official WAV format: {name}")
            sample_rate = source.getframerate()
            samples = np.frombuffer(
                source.readframes(source.getnframes()), dtype=np.int16
            ).astype(np.float32) / 32768.0
        stream = recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        stream.accept_waveform(
            sample_rate, np.zeros(sample_rate, dtype=np.float32)
        )
        stream.input_finished()
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        results[name] = {
            "sampleRateHz": sample_rate,
            "transcript": recognizer.get_result(stream),
        }
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(results, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
