from __future__ import annotations

import argparse
import importlib.util
import json
import logging
from pathlib import Path

import onnx
from onnx import version_converter


def load_quantizer(path: Path):
    spec = importlib.util.spec_from_file_location("compact_quantizer", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    logging.getLogger().setLevel(logging.WARNING)
    logging.getLogger("onnxruntime.quantization.matmul_nbits_quantizer").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser()
    parser.add_argument("--fp32", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--rtn-safe-model", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    module = load_quantizer(Path(__file__).with_name("quantize-paraformer-compact.py"))
    fp32 = onnx.load(Path(args.fp32).resolve(), load_external_data=False)
    baseline = onnx.load(Path(args.baseline).resolve(), load_external_data=False)
    module.copy_runtime_metadata(fp32, baseline)
    converted = version_converter.convert_version(fp32, 21)
    converted_baseline = version_converter.convert_version(baseline, 21)
    module.copy_runtime_metadata(converted, baseline)
    module.copy_runtime_metadata(converted_baseline, baseline)

    safe = onnx.load(Path(args.rtn_safe_model).resolve(), load_external_data=False)
    included_nodes = sorted(
        node.name.removesuffix("_Q4")
        for node in safe.graph.node
        if node.op_type == "MatMulNBits" and node.name.endswith("_Q4")
    )
    if len(included_nodes) != 80:
        raise RuntimeError(f"expected 80 accuracy-screened nodes, got {len(included_nodes)}")

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "model.hqq-int4.onnx"
    result = module.quantize_candidate(
        converted,
        converted_baseline,
        output,
        included_nodes,
        algorithm="hqq",
    )
    report = {
        "schemaVersion": 1,
        "status": "GENERATED_NOT_ACCURACY_QUALIFIED",
        "candidate": {**result, "path": str(output)},
        "sourceRtnSafeModel": str(Path(args.rtn_safe_model).resolve()),
        "includedNodes": included_nodes,
    }
    report_path = output_dir / "hqq-candidate.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(report_path), **result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
