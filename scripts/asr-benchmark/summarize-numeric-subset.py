from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path


def load_evaluator(path: Path):
    specification = importlib.util.spec_from_file_location("asr_evaluator", path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"unable to load {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evaluation", required=True)
    parser.add_argument("--count", type=int, default=618)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    evaluator = load_evaluator(Path(__file__).resolve().parent / "evaluate-paraformer-fleurs.py")
    source = json.loads(Path(args.evaluation).read_text(encoding="utf-8"))
    numeric_rows = [
        row
        for row in source["rows"]
        if evaluator.numeric_tokens(evaluator.normalize(row["reference"]))
    ]
    if len(numeric_rows) < args.count:
        raise RuntimeError(
            f"dataset contains {len(numeric_rows)} numeric rows, fewer than {args.count}"
        )
    selected = numeric_rows[: args.count]
    model_names = list(selected[0]["models"])
    summary = {}
    for model_name in model_names:
        edits = sum(int(row["models"][model_name]["edits"]) for row in selected)
        reference_characters = sum(
            len(evaluator.normalize(row["reference"])) for row in selected
        )
        exact = sum(
            row["models"][model_name]["numberTokens"]
            == evaluator.numeric_tokens(evaluator.normalize(row["reference"]))
            for row in selected
        )
        summary[model_name] = {
            "rows": len(selected),
            "edits": edits,
            "referenceCharacters": reference_characters,
            "cer": edits / reference_characters,
            "numericExactRows": exact,
            "numericExactRate": exact / len(selected),
        }
    report = {
        "schemaVersion": 1,
        "selection": "first 618 numeric-reference rows in locked FLEURS test order",
        "sourceEvaluation": str(Path(args.evaluation).resolve()),
        "rowIds": [row["id"] for row in selected],
        "summary": summary,
    }
    output = Path(args.output).resolve()
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "summary": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
