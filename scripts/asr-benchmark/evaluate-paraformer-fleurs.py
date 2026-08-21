from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np


NUMBER_TOKEN = re.compile(r"[0-9零〇一二三四五六七八九十百千万亿两点年月日时分秒块元角毛]+")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parquet-runtime", required=True)
    parser.add_argument("--python-runtime", required=True)
    parser.add_argument("--parquet", required=True)
    parser.add_argument("--model", action="append", required=True, help="name=model-root")
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def read_wave(payload: bytes) -> tuple[int, np.ndarray]:
    if payload[:4] != b"RIFF" or payload[8:12] != b"WAVE":
        raise ValueError("embedded audio is not RIFF/WAVE")
    offset = 12
    format_tag = channels = sample_rate = bits = None
    audio = None
    while offset + 8 <= len(payload):
        chunk_name = payload[offset : offset + 4]
        chunk_size = struct.unpack_from("<I", payload, offset + 4)[0]
        chunk = payload[offset + 8 : offset + 8 + chunk_size]
        if chunk_name == b"fmt ":
            format_tag, channels, sample_rate, _, _, bits = struct.unpack_from(
                "<HHIIHH", chunk
            )
        elif chunk_name == b"data":
            audio = chunk
        offset += 8 + chunk_size + (chunk_size & 1)
    if channels != 1 or sample_rate is None or audio is None:
        raise ValueError("only mono WAV is supported")
    if format_tag == 3 and bits == 32:
        samples = np.frombuffer(audio, dtype="<f4").astype(np.float32, copy=True)
    elif format_tag == 1 and bits == 16:
        samples = np.frombuffer(audio, dtype="<i2").astype(np.float32) / 32768.0
    else:
        raise ValueError(f"unsupported WAV format tag={format_tag}, bits={bits}")
    return sample_rate, samples


def normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return "".join(
        char
        for char in normalized
        if not unicodedata.category(char).startswith(("P", "Z", "C"))
    )


def edit_distance(reference: str, hypothesis: str) -> int:
    if len(reference) < len(hypothesis):
        reference, hypothesis = hypothesis, reference
    previous = list(range(len(hypothesis) + 1))
    for row, source in enumerate(reference, start=1):
        current = [row]
        for column, target in enumerate(hypothesis, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + (source != target),
                )
            )
        previous = current
    return previous[-1]


def numeric_tokens(text: str) -> list[str]:
    return NUMBER_TOKEN.findall(normalize(text))


def bucket(duration: float) -> str:
    if duration < 6:
        return "3-6s"
    if duration <= 12:
        return "6-12s"
    return "12s+"


def main() -> None:
    args = parse_args()
    try:
        import pyarrow.parquet as parquet
    except ImportError:
        sys.path.insert(0, str(Path(args.parquet_runtime).resolve()))
        import pyarrow.parquet as parquet
    try:
        import sherpa_onnx
    except ImportError:
        sys.path.insert(0, str(Path(args.python_runtime).resolve()))
        import sherpa_onnx

    recognizers = {}
    for specification in args.model:
        name, root_value = specification.split("=", 1)
        root = Path(root_value).resolve()
        recognizers[name] = sherpa_onnx.OfflineRecognizer.from_paraformer(
            tokens=str(root / "tokens.txt"),
            paraformer=str(root / "model.int8.onnx"),
            num_threads=2,
            sample_rate=16000,
            feature_dim=80,
            decoding_method="greedy_search",
            provider="cpu",
        )

    metrics = {
        name: {
            "edits": 0,
            "referenceCharacters": 0,
            "numericRows": 0,
            "numericExactRows": 0,
            "numericEdits": 0,
            "numericReferenceCharacters": 0,
            "decodeSeconds": 0.0,
            "buckets": {
                key: {"edits": 0, "referenceCharacters": 0, "rows": 0}
                for key in ("3-6s", "6-12s", "12s+")
            },
        }
        for name in recognizers
    }
    rows = []
    source = parquet.ParquetFile(args.parquet)
    processed = 0
    for batch in source.iter_batches(
        batch_size=8,
        columns=["id", "audio", "raw_transcription"],
    ):
        for row in batch.to_pylist():
            sample_rate, samples = read_wave(row["audio"]["bytes"])
            duration = len(samples) / sample_rate
            reference = normalize(row["raw_transcription"])
            reference_numbers = numeric_tokens(reference)
            result = {
                "id": row["id"],
                "durationSeconds": round(duration, 3),
                "reference": row["raw_transcription"],
                "models": {},
            }
            for name, recognizer in recognizers.items():
                stream = recognizer.create_stream()
                stream.accept_waveform(sample_rate, samples)
                started = time.perf_counter()
                recognizer.decode_stream(stream)
                elapsed = time.perf_counter() - started
                hypothesis = normalize(stream.result.text)
                edits = edit_distance(reference, hypothesis)
                model_metrics = metrics[name]
                model_metrics["edits"] += edits
                model_metrics["referenceCharacters"] += len(reference)
                model_metrics["decodeSeconds"] += elapsed
                bucket_metrics = model_metrics["buckets"][bucket(duration)]
                bucket_metrics["edits"] += edits
                bucket_metrics["referenceCharacters"] += len(reference)
                bucket_metrics["rows"] += 1
                if reference_numbers:
                    model_metrics["numericRows"] += 1
                    model_metrics["numericExactRows"] += int(
                        numeric_tokens(hypothesis) == reference_numbers
                    )
                    model_metrics["numericEdits"] += edits
                    model_metrics["numericReferenceCharacters"] += len(reference)
                result["models"][name] = {
                    "text": stream.result.text,
                    "edits": edits,
                    "numberTokens": numeric_tokens(hypothesis),
                    "decodeSeconds": round(elapsed, 4),
                }
            rows.append(result)
            samples.fill(0)
            processed += 1
            if processed % 25 == 0:
                print(f"FLEURS_PROGRESS={processed}/{source.metadata.num_rows}", flush=True)

    silence_noise = {}
    rng = np.random.default_rng(612)
    probes = {
        "silence": np.zeros(48_000, dtype=np.float32),
        "low-noise": rng.normal(0, 0.002, 48_000).astype(np.float32),
    }
    for name, recognizer in recognizers.items():
        silence_noise[name] = {}
        for probe_name, samples in probes.items():
            stream = recognizer.create_stream()
            stream.accept_waveform(16_000, samples)
            recognizer.decode_stream(stream)
            silence_noise[name][probe_name] = stream.result.text

    summary = {}
    for name, values in metrics.items():
        summary[name] = {
            "rows": processed,
            "cer": values["edits"] / max(1, values["referenceCharacters"]),
            "edits": values["edits"],
            "referenceCharacters": values["referenceCharacters"],
            "numericRows": values["numericRows"],
            "numericExactRows": values["numericExactRows"],
            "numericExactRate": values["numericExactRows"] / max(1, values["numericRows"]),
            "numericEdits": values["numericEdits"],
            "numericReferenceCharacters": values["numericReferenceCharacters"],
            "numericCer": values["numericEdits"]
            / max(1, values["numericReferenceCharacters"]),
            "decodeSeconds": round(values["decodeSeconds"], 3),
            "buckets": {
                key: {
                    **bucket_values,
                    "cer": bucket_values["edits"]
                    / max(1, bucket_values["referenceCharacters"]),
                }
                for key, bucket_values in values["buckets"].items()
            },
        }
    report = {
        "schemaVersion": 1,
        "dataset": str(Path(args.parquet).resolve()),
        "runtimeVersion": sherpa_onnx.__version__,
        "normalizer": "NFKC-casefold-remove-P/Z/C",
        "summary": summary,
        "silenceNoise": silence_noise,
        "rows": rows,
    }
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "summary": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
