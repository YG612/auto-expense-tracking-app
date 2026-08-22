from __future__ import annotations

import argparse
import importlib.util
import json
import logging
import shutil
import sys
from pathlib import Path

import onnx
from onnx import version_converter


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
    parser.add_argument("--parquet", required=True)
    parser.add_argument("--report", action="append", required=True)
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args()


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
    screener = load_script(
        "compact_screener", script_dir / "screen-paraformer-compact-layers.py"
    )
    import pyarrow.parquet as parquet
    import sherpa_onnx

    reports = [json.loads(Path(path).read_text(encoding="utf-8")) for path in args.report]
    if any(report.get("status") != "COMPLETE" for report in reports):
        raise RuntimeError("all sensitivity shards must be complete")
    groups = {}
    baseline_metrics = None
    expected_count = 0
    for report in reports:
        expected_count += int(report["groupCount"])
        if baseline_metrics is None:
            baseline_metrics = report["baseline"]
        elif report["baseline"] != baseline_metrics:
            raise RuntimeError("sensitivity shards use different baselines")
        for name, result in report["groups"].items():
            if name in groups:
                raise RuntimeError(f"duplicate sensitivity group: {name}")
            groups[name] = result
    if len(groups) != expected_count or expected_count != 53:
        raise RuntimeError(
            f"incomplete layer sensitivity coverage: {len(groups)}/{expected_count}/53"
        )
    safe = {
        name: result
        for name, result in groups.items()
        if result.get("accepted") is True
    }
    if not safe:
        raise RuntimeError("no layer group met the no-regression gate")

    output_dir = Path(args.output_dir).resolve()
    staging = output_dir / "staging"
    staging.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(args.tokens).resolve(), staging / "tokens.txt")
    candidate_path = staging / "model.int8.onnx"

    fp32 = onnx.load(Path(args.fp32).resolve(), load_external_data=False)
    baseline = onnx.load(Path(args.baseline).resolve(), load_external_data=False)
    quantizer.copy_runtime_metadata(fp32, baseline)
    converted = version_converter.convert_version(fp32, 21)
    converted_baseline = version_converter.convert_version(baseline, 21)
    quantizer.copy_runtime_metadata(converted, baseline)
    quantizer.copy_runtime_metadata(converted_baseline, baseline)

    # The implementation plan excludes any individually regressing layer.
    # Quantize every remaining layer to establish the smallest candidate that
    # can be formed without violating that sensitivity rule.
    safe_names = sorted(
        safe,
        key=lambda name: (-int(safe[name]["fp32WeightBytes"]), name),
    )
    included_nodes = [node for name in safe_names for node in safe[name]["nodes"]]
    artifact = quantizer.quantize_candidate(
        converted, converted_baseline, candidate_path, included_nodes
    )
    rows, silence_noise, evaluation_seconds = screener.evaluate_model(
        staging,
        Path(args.parquet).resolve(),
        evaluator,
        parquet,
        sherpa_onnx,
    )
    metrics = screener.summarize_rows(rows, evaluator)
    zero_regression = screener.accepted(metrics, baseline_metrics)
    model_within_budget = artifact["sizeBytes"] <= 56 * 1024 * 1024

    retained_dir = output_dir / "smallest-sensitivity-safe"
    retained_dir.mkdir(exist_ok=True)
    retained_model = retained_dir / "model.int4.onnx"
    shutil.copyfile(candidate_path, retained_model)
    shutil.copyfile(Path(args.tokens).resolve(), retained_dir / "tokens.txt")
    status = (
        "QUANTIZED_CANDIDATE"
        if zero_regression and model_within_budget
        else "REJECTED_SIZE_TARGET"
        if zero_regression
        else "REJECTED_ACCURACY_REGRESSION"
    )
    report = {
        "schemaVersion": 1,
        "status": status,
        "candidate": {
            **artifact,
            "path": str(retained_model),
            "safeLayerGroups": safe_names,
            "excludedLayerGroups": sorted(set(groups) - set(safe)),
        },
        "baseline": baseline_metrics,
        "validation": metrics,
        "zeroRegression": zero_regression,
        "modelWithin56MiB": model_within_budget,
        "rawSilenceNoise": silence_noise,
        "endToEndSilencePolicy": "VAD rejects no-voice capture before Paraformer decode",
        "evaluationSeconds": evaluation_seconds,
        "sensitivity": {
            "totalGroups": len(groups),
            "acceptedGroups": len(safe),
            "rejectedGroups": len(groups) - len(safe),
            "reports": [str(Path(path).resolve()) for path in args.report],
        },
    }
    output = output_dir / "combined-safe-candidate.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    candidate_path.unlink(missing_ok=True)
    print(json.dumps({"report": str(output), **report}, ensure_ascii=False))


if __name__ == "__main__":
    main()
