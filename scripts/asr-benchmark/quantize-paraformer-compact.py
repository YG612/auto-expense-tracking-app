import argparse
import copy
import hashlib
import json
import logging
import os
import time
from pathlib import Path

import onnx
import onnxruntime as ort
from onnx import numpy_helper, version_converter
from onnxruntime.quantization.matmul_nbits_quantizer import (
    DefaultWeightOnlyQuantConfig,
    HQQWeightOnlyQuantConfig,
    MatMulNBitsQuantizer,
)


SENSITIVE_FRAGMENTS = (
    "/predictor/",
    "/output_layer/",
    "/after_norm/",
    "/normalize/",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fp32", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--algorithm", choices=("rtn", "rtn-asymmetric", "hqq"), default="rtn")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def constant_matmuls(model: onnx.ModelProto):
    initializers = {value.name: value for value in model.graph.initializer}
    rows = []
    for node in model.graph.node:
        if node.op_type != "MatMul" or len(node.input) < 2:
            continue
        weight = initializers.get(node.input[1])
        if weight is None:
            continue
        rows.append((node, weight))
    return rows


def group_for(name: str) -> str:
    if any(fragment in name for fragment in SENSITIVE_FRAGMENTS):
        return "sensitive"
    if "/feed_forward/" in name:
        return "ffn"
    if name.startswith("/decoder/"):
        return "decoder_projection"
    if "/self_attn/" in name or "/src_attn/" in name:
        return "attention"
    return "other"


def copy_runtime_metadata(target: onnx.ModelProto, baseline: onnx.ModelProto) -> None:
    del target.metadata_props[:]
    for prop in baseline.metadata_props:
        item = target.metadata_props.add()
        item.key = prop.key
        item.value = prop.value
    metadata = {item.key: item.value for item in target.metadata_props}
    required = {
        "lfr_window_size": "7",
        "lfr_window_shift": "6",
        "model_type": "paraformer",
        "vocab_size": "8359",
    }
    for key, expected in required.items():
        if metadata.get(key) != expected:
            raise RuntimeError(f"baseline metadata mismatch for {key}")


def save(model: onnx.ModelProto, path: Path) -> None:
    onnx.save_model(model, path, save_as_external_data=False)


def quantize_candidate(
    fp32_model: onnx.ModelProto,
    baseline_model: onnx.ModelProto,
    output: Path,
    included_nodes: list[str],
    algorithm: str = "rtn",
) -> dict:
    temporary = output.with_suffix(".weight4.tmp.onnx")
    started = time.perf_counter()
    source_nodes = {node.name: node for node in fp32_model.graph.node}
    source_initializers = {value.name: value for value in fp32_model.graph.initializer}
    baseline_nodes = {node.name: node for node in baseline_model.graph.node}
    produced_by = {
        value: node for node in baseline_model.graph.node for value in node.output
    }
    replacements = {}
    remove_names = set()
    added_initializers = []
    for original_name in included_nodes:
        source_node = source_nodes.get(original_name)
        quantized_name = f"{original_name}_quant"
        quantized_node = baseline_nodes.get(quantized_name)
        if source_node is None or quantized_node is None:
            raise RuntimeError(f"unable to match baseline INT8 node for {original_name}")
        if source_node.op_type != "MatMul" or quantized_node.op_type != "MatMulInteger":
            raise RuntimeError(f"unexpected mixed-quantization node type for {original_name}")
        activation_quantizer = produced_by.get(quantized_node.input[0])
        if activation_quantizer is None or activation_quantizer.op_type != "DynamicQuantizeLinear":
            raise RuntimeError(f"missing baseline activation quantizer for {original_name}")
        weight = source_initializers.get(source_node.input[1])
        if weight is None:
            raise RuntimeError(f"missing FP32 weight for {original_name}")
        output_scale_name = f"{original_name}_quant_output_scale_mul"
        output_scale = baseline_nodes.get(output_scale_name)
        if output_scale is None or len(output_scale.output) != 1:
            raise RuntimeError(f"missing baseline output scale for {original_name}")
        replacement = onnx.helper.make_node(
            "MatMul",
            [activation_quantizer.input[0], weight.name],
            [output_scale.output[0]],
            name=original_name,
        )
        replacements[quantized_name] = replacement
        added_initializers.append(copy.deepcopy(weight))
        remove_names.update(
            {
                f"{original_name}_quant_scales_mul",
                quantized_name,
                f"{original_name}_output_0_output_quantized_cast",
                output_scale_name,
            }
        )

    mixed = copy.deepcopy(baseline_model)
    del mixed.graph.node[:]
    for node in baseline_model.graph.node:
        if node.name in replacements:
            mixed.graph.node.append(replacements[node.name])
        elif node.name not in remove_names:
            mixed.graph.node.append(copy.deepcopy(node))
    mixed.graph.initializer.extend(added_initializers)
    save(mixed, temporary)

    # ORT 1.24.4 exposes HQQ only as asymmetric quantization. The product
    # requirement is symmetric INT4, so the documented fallback is symmetric
    # RTN (DEFAULT) instead of silently violating the lock.
    if algorithm == "hqq":
        config = HQQWeightOnlyQuantConfig(
            block_size=128,
            bits=4,
            axis=1,
            op_types_to_quantize=(),
        )
    elif algorithm in {"rtn", "rtn-asymmetric"}:
        config = DefaultWeightOnlyQuantConfig(
            block_size=128,
            is_symmetric=algorithm == "rtn",
            bits=4,
            op_types_to_quantize=(),
        )
    else:
        raise ValueError(f"unsupported weight-only algorithm: {algorithm}")
    # ORT interprets an empty constructor value as the default {MatMul}. Clear
    # it explicitly so nodes_to_include is an allow-list, not a suggestion.
    config.op_types_to_quantize = set()
    quantizer = MatMulNBitsQuantizer(
        str(temporary),
        nodes_to_include=included_nodes,
        algo_config=config,
    )
    quantizer.process()
    quantizer.model.save_model_to_file(str(output), use_external_data_format=False)
    temporary.unlink(missing_ok=True)
    candidate = onnx.load(output, load_external_data=False)
    # The source model uses valid outer-scope captures inside Loop bodies that
    # ONNX's standalone checker rejects after version conversion. ORT is the
    # actual load boundary and validates the full graph including contrib ops.
    session = ort.InferenceSession(str(output), providers=["CPUExecutionProvider"])
    if [value.name for value in session.get_inputs()] != ["speech", "speech_lengths"]:
        raise RuntimeError("quantized candidate changed the recognizer input contract")
    op_counts: dict[str, int] = {}
    for node in candidate.graph.node:
        op_counts[node.op_type] = op_counts.get(node.op_type, 0) + 1
    return {
        "fileName": output.name,
        "sizeBytes": output.stat().st_size,
        "sha256": sha256(output),
        "includedInt4NodeCount": len(included_nodes),
        "matMulNBitsNodeCount": op_counts.get("MatMulNBits", 0),
        "matMulIntegerNodeCount": op_counts.get("MatMulInteger", 0),
        "remainingMatMulNodeCount": op_counts.get("MatMul", 0),
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "algorithm": algorithm.upper(),
    }


def main() -> None:
    logging.getLogger().setLevel(logging.WARNING)
    logging.getLogger("onnxruntime.quantization.matmul_nbits_quantizer").setLevel(
        logging.WARNING
    )
    args = parse_args()
    fp32_path = Path(args.fp32).resolve()
    baseline_path = Path(args.baseline).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    fp32 = onnx.load(fp32_path, load_external_data=False)
    baseline = onnx.load(baseline_path, load_external_data=False)
    if [value.name for value in fp32.graph.input] != [value.name for value in baseline.graph.input]:
        raise RuntimeError("FP32 input contract differs from the locked INT8 baseline")
    if [value.name for value in fp32.graph.output] != [value.name for value in baseline.graph.output]:
        raise RuntimeError("FP32 output contract differs from the locked INT8 baseline")
    copy_runtime_metadata(fp32, baseline)
    converted = version_converter.convert_version(fp32, 21)
    # The converter produces a graph accepted by ORT and sherpa-onnx. Its
    # standalone checker loses lexical-scope context for existing Loop bodies,
    # so load/transcript equivalence is the authoritative gate below.
    converted_baseline = version_converter.convert_version(baseline, 21)
    copy_runtime_metadata(converted, baseline)
    copy_runtime_metadata(converted_baseline, baseline)
    converted_path = output_dir / "model.fp32.opset21.onnx"
    save(converted, converted_path)
    onnx.checker.check_model(converted)
    converted_baseline_path = output_dir / "model.baseline-int8.opset21.onnx"
    save(converted_baseline, converted_baseline_path)
    baseline_session = ort.InferenceSession(
        str(converted_baseline_path), providers=["CPUExecutionProvider"]
    )
    if [value.name for value in baseline_session.get_inputs()] != [
        "speech",
        "speech_lengths",
    ]:
        raise RuntimeError("opset conversion changed the baseline input contract")

    groups: dict[str, list[str]] = {
        "ffn": [],
        "decoder_projection": [],
        "attention": [],
        "sensitive": [],
        "other": [],
    }
    weight_bytes = {name: 0 for name in groups}
    node_rows = []
    for node, weight in constant_matmuls(converted):
        group = group_for(node.name)
        groups[group].append(node.name)
        array = numpy_helper.to_array(weight)
        weight_bytes[group] += int(array.nbytes)
        node_rows.append(
            {
                "name": node.name,
                "weight": weight.name,
                "shape": list(weight.dims),
                "weightBytes": int(array.nbytes),
                "group": group,
            }
        )

    definitions = {
        "candidate1_ffn": groups["ffn"],
        "candidate2_ffn_decoder": groups["ffn"] + groups["decoder_projection"],
        "candidate3_ffn_decoder_attention": (
            groups["ffn"] + groups["decoder_projection"] + groups["attention"]
        ),
    }
    results = {}
    for candidate_name, included_nodes in definitions.items():
        output = output_dir / f"model.{candidate_name}.int4.onnx"
        results[candidate_name] = quantize_candidate(
            converted,
            converted_baseline,
            output,
            included_nodes,
            algorithm=args.algorithm,
        )

    report = {
        "schemaVersion": 1,
        "source": {
            "path": str(fp32_path),
            "sizeBytes": fp32_path.stat().st_size,
            "sha256": sha256(fp32_path),
            "sourceOpset": 14,
            "candidateOpset": 21,
        },
        "baseline": {
            "path": str(baseline_path),
            "sizeBytes": baseline_path.stat().st_size,
            "sha256": sha256(baseline_path),
        },
        "quantization": {
            "algorithm": args.algorithm.upper(),
            "hqqFallbackReason": None if args.algorithm != "rtn" else (
                "The original experiment required symmetric weights; later experiments "
                "may explicitly select asymmetric RTN or HQQ."
            ),
            "bits": 4,
            "signed": args.algorithm == "rtn",
            "blockSize": 128,
            "remainingWeightQuantization": "per-channel-signed-int8-from-fp32",
        },
        "groups": {
            name: {"nodeCount": len(nodes), "fp32WeightBytes": weight_bytes[name]}
            for name, nodes in groups.items()
        },
        "candidates": results,
        "nodes": node_rows,
    }
    report_path = output_dir / "quantization-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(report_path), "candidates": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
