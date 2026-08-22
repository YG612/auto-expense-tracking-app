from __future__ import annotations

import argparse
import gc
import importlib.util
import json
import logging
import re
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import onnx
from onnx import numpy_helper, version_converter


def load_script(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"unable to load {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fp32", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--baseline-report", required=True)
    parser.add_argument("--tokens", required=True)
    parser.add_argument("--parquet-runtime", required=True)
    parser.add_argument("--python-runtime", required=True)
    parser.add_argument("--parquet", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--max-groups", type=int)
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument("--shard-count", type=int, default=1)
    return parser.parse_args()


def layer_group(name: str) -> str | None:
    patterns = (
        (r"^/encoder/encoders0/encoders0\.0/", "encoder.input"),
        (r"^/encoder/encoders/encoders\.(\d+)/", "encoder.{}"),
        (r"^/decoder/decoders/decoders\.(\d+)/", "decoder.{}"),
        (r"^/decoder/decoders3/decoders3\.0/", "decoder.tail"),
    )
    for pattern, label in patterns:
        match = re.match(pattern, name)
        if match:
            return label.format(*match.groups())
    return None


def summarize_rows(rows: list[dict], evaluator) -> dict:
    edits = 0
    reference_characters = 0
    numeric_rows = 0
    numeric_exact_rows = 0
    numeric_edits = 0
    numeric_reference_characters = 0
    for row in rows:
        reference = evaluator.normalize(row["reference"])
        hypothesis = evaluator.normalize(row["text"])
        row_edits = evaluator.edit_distance(reference, hypothesis)
        edits += row_edits
        reference_characters += len(reference)
        reference_numbers = evaluator.numeric_tokens(reference)
        if reference_numbers:
            numeric_rows += 1
            numeric_exact_rows += int(
                evaluator.numeric_tokens(hypothesis) == reference_numbers
            )
            numeric_edits += row_edits
            numeric_reference_characters += len(reference)
    return {
        "rows": len(rows),
        "edits": edits,
        "referenceCharacters": reference_characters,
        "cer": edits / max(1, reference_characters),
        "numericRows": numeric_rows,
        "numericExactRows": numeric_exact_rows,
        "numericExactRate": numeric_exact_rows / max(1, numeric_rows),
        "numericEdits": numeric_edits,
        "numericReferenceCharacters": numeric_reference_characters,
        "numericCer": numeric_edits / max(1, numeric_reference_characters),
    }


def accepted(candidate: dict, baseline: dict) -> bool:
    return (
        candidate["edits"] <= baseline["edits"]
        and candidate["numericEdits"] <= baseline["numericEdits"]
        and candidate["numericExactRows"] >= baseline["numericExactRows"]
    )


def evaluate_model(model_dir: Path, parquet_path: Path, evaluator, parquet, sherpa_onnx):
    recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
        tokens=str(model_dir / "tokens.txt"),
        paraformer=str(model_dir / "model.int8.onnx"),
        num_threads=2,
        sample_rate=16000,
        feature_dim=80,
        decoding_method="greedy_search",
        provider="cpu",
    )
    rows = []
    started = time.perf_counter()
    source = parquet.ParquetFile(parquet_path)
    for batch in source.iter_batches(
        batch_size=8, columns=["id", "audio", "raw_transcription"]
    ):
        for row in batch.to_pylist():
            sample_rate, samples = evaluator.read_wave(row["audio"]["bytes"])
            stream = recognizer.create_stream()
            stream.accept_waveform(sample_rate, samples)
            recognizer.decode_stream(stream)
            rows.append(
                {
                    "id": row["id"],
                    "reference": row["raw_transcription"],
                    "text": stream.result.text,
                }
            )
            samples.fill(0)
    rng = np.random.default_rng(612)
    probes = {
        "silence": np.zeros(48_000, dtype=np.float32),
        "low-noise": rng.normal(0, 0.002, 48_000).astype(np.float32),
    }
    silence_noise = {}
    for probe_name, samples in probes.items():
        stream = recognizer.create_stream()
        stream.accept_waveform(16_000, samples)
        recognizer.decode_stream(stream)
        silence_noise[probe_name] = stream.result.text
    del recognizer
    gc.collect()
    return rows, silence_noise, round(time.perf_counter() - started, 3)


def main() -> None:
    args = parse_args()
    logging.getLogger().setLevel(logging.WARNING)
    logging.getLogger("onnxruntime.quantization.matmul_nbits_quantizer").setLevel(
        logging.WARNING
    )
    script_dir = Path(__file__).resolve().parent
    quantizer = load_script(
        "compact_quantizer", script_dir / "quantize-paraformer-compact.py"
    )
    evaluator = load_script(
        "compact_evaluator", script_dir / "evaluate-paraformer-fleurs.py"
    )
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

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    staging_dir = output_dir / "staging"
    staging_dir.mkdir(exist_ok=True)
    shutil.copyfile(Path(args.tokens).resolve(), staging_dir / "tokens.txt")
    baseline_report = json.loads(
        Path(args.baseline_report).read_text(encoding="utf-8")
    )
    baseline_rows = [
        {
            "id": row["id"],
            "reference": row["reference"],
            "text": row["models"]["baseline"]["text"],
        }
        for row in baseline_report["rows"]
    ]
    baseline_metrics = summarize_rows(baseline_rows, evaluator)

    fp32 = onnx.load(Path(args.fp32).resolve(), load_external_data=False)
    baseline = onnx.load(Path(args.baseline).resolve(), load_external_data=False)
    quantizer.copy_runtime_metadata(fp32, baseline)
    converted = version_converter.convert_version(fp32, 21)
    converted_baseline = version_converter.convert_version(baseline, 21)
    quantizer.copy_runtime_metadata(converted, baseline)
    quantizer.copy_runtime_metadata(converted_baseline, baseline)

    groups: dict[str, list[str]] = {}
    group_weight_bytes: dict[str, int] = {}
    for node, weight in quantizer.constant_matmuls(converted):
        if quantizer.group_for(node.name) == "sensitive":
            continue
        group = layer_group(node.name)
        if group is None:
            continue
        groups.setdefault(group, []).append(node.name)
        group_weight_bytes[group] = group_weight_bytes.get(group, 0) + int(
            numpy_helper.to_array(weight).nbytes
        )
    ordered_groups = sorted(groups, key=lambda key: (-group_weight_bytes[key], key))
    if args.shard_count < 1 or not 0 <= args.shard_index < args.shard_count:
        raise ValueError("shard index must be within [0, shard count)")
    ordered_groups = [
        group
        for index, group in enumerate(ordered_groups)
        if index % args.shard_count == args.shard_index
    ]
    if args.max_groups is not None:
        ordered_groups = ordered_groups[: args.max_groups]

    checkpoint_path = output_dir / "layer-sensitivity-report.json"
    results = {}
    if checkpoint_path.exists():
        checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        results.update(checkpoint.get("groups", {}))
        for result in results.values():
            result["accepted"] = accepted(result["metrics"], baseline_metrics)
    candidate_path = staging_dir / "model.int8.onnx"
    for index, group in enumerate(ordered_groups, start=1):
        if group in results:
            continue
        artifact = quantizer.quantize_candidate(
            converted,
            converted_baseline,
            candidate_path,
            groups[group],
        )
        rows, silence_noise, evaluation_seconds = evaluate_model(
            staging_dir,
            Path(args.parquet).resolve(),
            evaluator,
            parquet,
            sherpa_onnx,
        )
        metrics = summarize_rows(rows, evaluator)
        result = {
            "nodes": groups[group],
            "fp32WeightBytes": group_weight_bytes[group],
            "candidate": artifact,
            "metrics": metrics,
            "silenceNoise": silence_noise,
            "evaluationSeconds": evaluation_seconds,
        }
        # The raw Paraformer baseline itself hallucinates on all-zero and
        # low-noise probes. Silence rejection is therefore enforced by the
        # end-to-end VAD/no-voice gate, while model sensitivity is a strict
        # relative accuracy comparison against the locked baseline.
        result["accepted"] = accepted(metrics, baseline_metrics)
        results[group] = result
        checkpoint = {
            "schemaVersion": 1,
            "status": "IN_PROGRESS",
            "baseline": baseline_metrics,
            "dataset": str(Path(args.parquet).resolve()),
            "groupCount": len(ordered_groups),
            "groups": results,
        }
        checkpoint_path.write_text(
            json.dumps(checkpoint, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(
            "LAYER_SENSITIVITY="
            + json.dumps(
                {
                    "index": index,
                    "total": len(ordered_groups),
                    "group": group,
                    "accepted": result["accepted"],
                    "edits": metrics["edits"],
                    "numericEdits": metrics["numericEdits"],
                    "numericExactRows": metrics["numericExactRows"],
                    "sizeBytes": artifact["sizeBytes"],
                },
                ensure_ascii=False,
            ),
            flush=True,
        )

    safe_groups = [name for name in ordered_groups if results[name]["accepted"]]
    final_report = {
        "schemaVersion": 1,
        "status": "COMPLETE",
        "baseline": baseline_metrics,
        "dataset": str(Path(args.parquet).resolve()),
        "groupCount": len(ordered_groups),
        "safeGroups": safe_groups,
        "groups": results,
    }
    checkpoint_path.write_text(
        json.dumps(final_report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    candidate_path.unlink(missing_ok=True)
    print(
        json.dumps(
            {"report": str(checkpoint_path), "safeGroups": safe_groups},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
