"""Persistent stem separator subprocess with a line-delimited JSON protocol."""

from __future__ import annotations

import json
import logging
import os
import platform
import sys
import traceback
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any


def _emit(stream, event: dict[str, Any]) -> None:
    stream.write(json.dumps(event, separators=(",", ":")) + "\n")
    stream.flush()


def _progress_iterator(
    emit: Callable[[dict[str, Any]], None],
) -> Callable[..., Any]:
    pass_number = 0

    def reporting_tqdm(iterable=None, *args, **kwargs):
        nonlocal pass_number
        if iterable is None:
            return iter(())
        pass_number += 1
        current_pass = pass_number
        total = int(kwargs.get("total") or len(iterable))

        def iterate():
            for completed, item in enumerate(iterable, start=1):
                yield item
                emit(
                    {
                        "type": "progress",
                        "pass": current_pass,
                        "completed": completed,
                        "total": total,
                    }
                )

        return iterate()

    return reporting_tqdm


def _install_audio_separator_progress(reporting_tqdm: Callable[..., Any]) -> None:
    from audio_separator.separator.architectures import (
        mdx_separator,
        mdxc_separator,
        vr_separator,
    )

    mdx_separator.tqdm = reporting_tqdm
    mdxc_separator.tqdm = reporting_tqdm
    vr_separator.tqdm = reporting_tqdm


def _skip_unused_audio_separator_match_pass() -> None:
    """Avoid audio-separator's discarded match-mix transform when inversion is off."""
    from audio_separator.separator.architectures.mdx_separator import MDXSeparator

    original_demix = MDXSeparator.demix

    def demix(self, mix, is_match_mix=False):
        if is_match_mix and not self.invert_using_spec:
            return mix
        return original_demix(self, mix, is_match_mix=is_match_mix)

    MDXSeparator.demix = demix


def _enable_concurrent_audio_writes(separator, workers: int) -> None:
    """Queue audio-separator stem encodes and join them before it clears state."""
    if workers <= 1:
        return
    instance = separator.model_instance
    executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="stem-writer")
    original_final_process = instance.final_process
    original_separate = instance.separate
    pending = []

    def final_process(stem_path, source, stem_name):
        pending.append(
            executor.submit(original_final_process, stem_path, source, stem_name)
        )
        return {stem_name: source}

    def separate(*args, **kwargs):
        pending.clear()
        try:
            outputs = original_separate(*args, **kwargs)
            for future in pending:
                future.result()
            return outputs
        finally:
            pending.clear()

    instance.final_process = final_process
    instance.separate = separate


def _install_mlx_progress(reporting_tqdm: Callable[..., Any]) -> None:
    from mlx_audio_separator.separator.architectures import (
        mdx_separator,
        mdxc_separator,
        vr_separator,
    )

    mdx_separator.tqdm = reporting_tqdm
    mdxc_separator.tqdm = reporting_tqdm
    vr_separator.tqdm = reporting_tqdm


def _separator_options(model_dir: Path, output_dir: Path) -> dict[str, Any]:
    overlap = float(os.getenv("STEM_MDX_OVERLAP", "0.1"))
    if not 0 <= overlap < 1:
        raise ValueError("STEM_MDX_OVERLAP must be at least 0 and less than 1")
    return {
        "log_level": logging.INFO,
        "model_file_dir": str(model_dir),
        "output_dir": str(output_dir),
        "output_format": "FLAC",
        "mdx_params": {
            "hop_length": 1024,
            "segment_size": 256,
            "overlap": overlap,
            "batch_size": int(os.getenv("STEM_MDX_BATCH_SIZE", "1")),
            "enable_denoise": False,
        },
    }


def _create_separator(backend: str, model: str, model_dir: Path, output_dir: Path):
    options = _separator_options(model_dir, output_dir)
    if backend == "mlx":
        import mlx.core as mx
        from mlx_audio_separator import Separator

        options["performance_params"] = {
            "speed_mode": os.getenv("STEM_MLX_SPEED_MODE", "default"),
            "cache_clear_policy": os.getenv("STEM_MLX_CACHE_CLEAR_POLICY", "deferred"),
            "write_workers": int(os.getenv("STEM_WRITE_WORKERS", "2")),
        }
        separator = Separator(**options)
        separator._set_strict_separation_errors(True)
        separator.load_model(model)
        return separator, {
            "backend": "mlx",
            "device": str(mx.default_device()),
            "modelType": separator.model_type,
        }

    from audio_separator.separator import Separator

    separator = Separator(**options)
    separator.load_model(model)
    write_workers = int(os.getenv("STEM_WRITE_WORKERS", "2"))
    _enable_concurrent_audio_writes(separator, write_workers)
    provider = getattr(separator.model_instance, "onnx_execution_provider", None)
    return separator, {
        "backend": backend,
        "device": str(getattr(separator.model_instance, "torch_device", "unknown")),
        "executionProvider": provider,
        "modelType": type(separator.model_instance).__name__,
        "writeWorkers": write_workers,
    }


def _set_output_dir(separator, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    separator.output_dir = str(output_dir)
    separator.model_instance.output_dir = str(output_dir)


def main() -> None:
    protocol_output = sys.stdout
    sys.stdout = sys.stderr
    backend = os.getenv("STEM_BACKEND", "audio-separator")
    model = os.getenv("STEM_MODEL", "Kim_Vocal_2.onnx")
    model_dir = Path(os.getenv("MODEL_DIR", "/models"))
    work_dir = Path(os.getenv("WORK_DIR", "/work"))
    model_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    emit = lambda event: _emit(protocol_output, event)
    reporting_tqdm = _progress_iterator(emit)
    if backend == "mlx":
        _install_mlx_progress(reporting_tqdm)
    else:
        _install_audio_separator_progress(reporting_tqdm)
        _skip_unused_audio_separator_match_pass()

    try:
        separator, diagnostics = _create_separator(backend, model, model_dir, work_dir)
        emit(
            {
                "type": "ready",
                "model": model,
                "platform": f"{platform.system()} {platform.machine()}",
                **diagnostics,
            }
        )
    except Exception as error:
        emit(
            {
                "type": "startup_error",
                "message": str(error),
                "traceback": traceback.format_exc(),
            }
        )
        raise

    for line in sys.stdin:
        try:
            request = json.loads(line)
            if request.get("type") != "separate":
                raise ValueError("Unsupported separator request")
            output_dir = Path(request["outputDir"])
            _set_output_dir(separator, output_dir)
            outputs = separator.separate(
                str(request["inputPath"]),
                custom_output_names={
                    "Instrumental": "instrumental",
                    "Vocals": "vocals",
                },
            )
            emit({"type": "complete", "outputs": outputs})
        except Exception as error:  # noqa: BLE001 - errors cross the process boundary
            emit(
                {
                    "type": "error",
                    "message": str(error),
                    "traceback": traceback.format_exc(),
                }
            )


if __name__ == "__main__":
    main()
