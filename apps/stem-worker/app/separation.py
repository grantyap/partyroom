import sys
import json
from pathlib import Path

from partyroom_activity_worker import ActivityContext, ApplicationError, ManagedProcessResult


SEPARATION_START = 0.02
SEPARATION_END = 0.98
SEPARATION_PASSES = 2


def separator_arguments(
    input_path: Path, model: str, model_dir: Path, output_dir: Path
) -> tuple[str, ...]:
    return (
        str(input_path),
        "--model_filename",
        model,
        "--model_file_dir",
        str(model_dir),
        "--output_dir",
        str(output_dir),
        "--output_format",
        "FLAC",
        "--custom_output_names",
        '{"Instrumental": "instrumental", "Vocals": "vocals"}',
    )


def is_coreml_inference_failure(error: ApplicationError) -> bool:
    message = str(error)
    return "CoreMLExecutionProvider" in message and "Error executing model" in message


async def run_separator(
    context: ActivityContext,
    input_path: Path,
    model: str,
    model_dir: Path,
    output_dir: Path,
) -> ManagedProcessResult:
    arguments = separator_arguments(input_path, model, model_dir, output_dir)
    reporters = {}

    async def process_output(line: str) -> None:
        prefix = "partyroom-progress:"
        if not line.startswith(prefix):
            return
        event = json.loads(line[len(prefix) :])
        completed = int(event["completed"])
        total = int(event["total"])
        pass_number = max(1, int(event.get("pass", 1)))
        pass_span = (SEPARATION_END - SEPARATION_START) / SEPARATION_PASSES
        pass_index = min(pass_number - 1, SEPARATION_PASSES - 1)
        pass_start = SEPARATION_START + pass_index * pass_span
        reporter = reporters.setdefault(
            pass_number,
            context.progress_reporter(
                pass_start,
                pass_start + pass_span,
                lambda done, count, current_pass=pass_number: (
                    f"Separating stems: pass {current_pass}, "
                    f"chunk {done} of {count}"
                ),
            ),
        )
        await reporter(completed, total)

    try:
        return await context.run_process(
            sys.executable,
            "-m",
            "app.progress_separator",
            *arguments,
            on_stdout_line=process_output,
        )
    except ApplicationError as error:
        if not is_coreml_inference_failure(error):
            raise

        for partial_output in output_dir.glob("*.flac"):
            partial_output.unlink(missing_ok=True)
        await context.report_progress(
            SEPARATION_START,
            f"CoreML could not run {model}; retrying separation on CPU",
        )
        return await context.run_process(
            sys.executable,
            "-m",
            "app.cpu_separator",
            *arguments,
            on_stdout_line=process_output,
        )
