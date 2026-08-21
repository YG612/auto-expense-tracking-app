from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def no_regression(candidate: dict, baseline: dict) -> bool:
    return (
        candidate["edits"] <= baseline["edits"]
        and candidate["numericEdits"] <= baseline["numericEdits"]
        and candidate["numericExactRows"] >= baseline["numericExactRows"]
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--combined", required=True)
    parser.add_argument("--test", required=True)
    parser.add_argument("--numeric-618", required=True)
    parser.add_argument("--official", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--runtime-aar")
    parser.add_argument("--distribution-model")
    parser.add_argument("--ordinary-apk-bytes", type=int, default=34_867_671)
    args = parser.parse_args()
    combined = json.loads(Path(args.combined).read_text(encoding="utf-8"))
    test = json.loads(Path(args.test).read_text(encoding="utf-8"))
    numeric = json.loads(Path(args.numeric_618).read_text(encoding="utf-8"))
    official = json.loads(Path(args.official).read_text(encoding="utf-8-sig"))
    validation_zero = bool(combined["zeroRegression"])
    test_zero = no_regression(test["summary"]["compact"], test["summary"]["baseline"])
    numeric_zero = (
        numeric["summary"]["compact"]["edits"]
        <= numeric["summary"]["baseline"]["edits"]
        and numeric["summary"]["compact"]["numericExactRows"]
        >= numeric["summary"]["baseline"]["numericExactRows"]
    )
    accuracy_zero = validation_zero and test_zero and numeric_zero and official["exactMatch"]
    model_within_budget = bool(combined["modelWithin56MiB"])
    runtime_path = Path(args.runtime_aar).resolve() if args.runtime_aar else None
    runtime_ready = runtime_path is not None and runtime_path.is_file() and runtime_path.stat().st_size <= 9 * 1024 * 1024
    distribution_path = (
        Path(args.distribution_model).resolve() if args.distribution_model else None
    )
    distribution_ready = distribution_path is not None and distribution_path.is_file()
    distribution_bytes = distribution_path.stat().st_size if distribution_ready else None
    estimated_apk_bytes = (
        args.ordinary_apk_bytes + runtime_path.stat().st_size + distribution_bytes
        if runtime_ready and distribution_ready
        else None
    )
    distribution_within_budget = bool(
        estimated_apk_bytes is not None and estimated_apk_bytes <= 100 * 1024 * 1024
    )
    device_ab = {"status": "WAITING_FOR_DEVICE_AB", "promptCount": 60}
    if not accuracy_zero:
        status = "REJECTED_ACCURACY_REGRESSION"
    elif not model_within_budget and not distribution_within_budget:
        status = "REJECTED_SIZE_TARGET"
    elif not runtime_ready:
        status = "BLOCKED_RUNTIME_COMPATIBILITY"
    else:
        # Host evidence never promotes without the same-PCM device A/B,
        # device latency and RSS report.
        status = "QUANTIZED_CANDIDATE"
    report = {
        "schemaVersion": 1,
        "status": status,
        "candidate": combined["candidate"],
        "quantization": {
            "algorithm": "RTN",
            "hqqFallbackReason": "ORT 1.24.4 HQQWeightOnlyQuantConfig has no symmetric mode; symmetric INT4 is mandatory",
            "bits": 4,
            "signed": True,
            "blockSize": 128,
            "opset": 21,
            "nodes": combined["candidate"]["safeLayerGroups"],
        },
        "accuracy": {
            "zeroRegression": accuracy_zero,
            "validation": {**combined["validation"], "zeroRegression": validation_zero},
            "test": {**test["summary"]["compact"], "baseline": test["summary"]["baseline"], "zeroRegression": test_zero},
            "numeric618": {**numeric["summary"]["compact"], "baseline": numeric["summary"]["baseline"], "zeroRegression": numeric_zero},
            "officialSamples": {"exactMatch": official["exactMatch"], "samples": official["samples"]},
        },
        "size": {
            "modelBytes": combined["candidate"]["sizeBytes"],
            "maximumModelBytes": 56 * 1024 * 1024,
            "modelWithinBudget": model_within_budget,
            "distribution": {
                "compression": "gzip" if distribution_ready else None,
                "path": str(distribution_path) if distribution_ready else None,
                "sizeBytes": distribution_bytes,
                "sha256": sha256(distribution_path) if distribution_ready else None,
            },
            "estimatedApkBytes": estimated_apk_bytes,
            "distributionWithin100MiB": distribution_within_budget,
            "runtimeReady": runtime_ready,
            "runtimeBytes": runtime_path.stat().st_size if runtime_ready else None,
        },
        "performance": {
            "hostBaselineDecodeSeconds": test["summary"]["baseline"]["decodeSeconds"],
            "hostCompactDecodeSeconds": test["summary"]["compact"]["decodeSeconds"],
            "deviceLatencyRssStatus": "WAITING_FOR_DEVICE_MEASUREMENT",
        },
        "deviceAb": device_ab,
        "promotionAllowed": False,
    }
    output = Path(args.output).resolve()
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "status": status}, ensure_ascii=False))


if __name__ == "__main__":
    main()
