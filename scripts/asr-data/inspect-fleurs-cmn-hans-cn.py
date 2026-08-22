#!/usr/bin/env python3
"""Inspect a downloaded FLEURS Simplified Chinese Parquet split without extracting it."""

from __future__ import annotations

import argparse
import collections
import json
import statistics
import struct
from pathlib import Path

try:
    import pyarrow.parquet as parquet
except ImportError as exc:
    raise SystemExit(
        "pyarrow is required; install it in a tooling directory, not the app runtime"
    ) from exc


def parse_wave_format(payload: bytes) -> dict[str, int]:
    if payload[:4] != b"RIFF" or payload[8:12] != b"WAVE":
        raise ValueError("embedded audio is not a RIFF/WAVE file")

    offset = 12
    while offset + 8 <= len(payload):
        chunk_name = payload[offset : offset + 4]
        chunk_size = struct.unpack_from("<I", payload, offset + 4)[0]
        chunk_start = offset + 8
        if chunk_name == b"fmt ":
            format_tag, channels, sample_rate, byte_rate, block_align, bits = struct.unpack_from(
                "<HHIIHH", payload, chunk_start
            )
            return {
                "formatTag": format_tag,
                "channels": channels,
                "sampleRate": sample_rate,
                "byteRate": byte_rate,
                "blockAlign": block_align,
                "bitsPerSample": bits,
            }
        offset = chunk_start + chunk_size + (chunk_size & 1)

    raise ValueError("embedded audio has no fmt chunk")


def inspect(path: Path) -> dict[str, object]:
    source = parquet.ParquetFile(path)
    required = {"id", "num_samples", "audio", "transcription", "raw_transcription", "gender"}
    missing = sorted(required.difference(source.schema_arrow.names))
    if missing:
        raise ValueError(f"missing required columns: {', '.join(missing)}")

    row_count = 0
    prompt_ids: set[int] = set()
    durations: list[float] = []
    gender_counts: collections.Counter[int] = collections.Counter()
    empty_transcripts = 0
    replacement_character_rows = 0
    audio_bytes = 0
    audio_formats: collections.Counter[tuple[int, int, int, int]] = collections.Counter()

    for batch in source.iter_batches(
        batch_size=16,
        columns=["id", "num_samples", "audio", "raw_transcription", "gender"],
    ):
        for row in batch.to_pylist():
            audio = row["audio"]["bytes"]
            wave_format = parse_wave_format(audio)
            sample_rate = wave_format["sampleRate"]
            audio_formats[
                (
                    wave_format["formatTag"],
                    wave_format["channels"],
                    sample_rate,
                    wave_format["bitsPerSample"],
                )
            ] += 1
            row_count += 1
            prompt_ids.add(row["id"])
            durations.append(row["num_samples"] / sample_rate)
            gender_counts[row["gender"]] += 1
            empty_transcripts += int(not row["raw_transcription"].strip())
            replacement_character_rows += int("\ufffd" in row["raw_transcription"])
            audio_bytes += len(audio)

    return {
        "path": str(path.resolve()),
        "fileBytes": path.stat().st_size,
        "rows": row_count,
        "uniquePromptIds": len(prompt_ids),
        "embeddedAudioBytes": audio_bytes,
        "totalSeconds": round(sum(durations), 3),
        "totalHours": round(sum(durations) / 3600, 6),
        "durationSeconds": {
            "min": round(min(durations), 3),
            "median": round(statistics.median(durations), 3),
            "max": round(max(durations), 3),
        },
        "genderCounts": {str(key): value for key, value in sorted(gender_counts.items())},
        "audioFormats": [
            {
                "formatTag": key[0],
                "channels": key[1],
                "sampleRate": key[2],
                "bitsPerSample": key[3],
                "rows": value,
            }
            for key, value in sorted(audio_formats.items())
        ],
        "emptyTranscripts": empty_transcripts,
        "replacementCharacterRows": replacement_character_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("parquet", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect(args.parquet), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
