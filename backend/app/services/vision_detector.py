from __future__ import annotations

import json
import math
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.settings_store import get_effective

COCO_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier",
    "toothbrush",
]

LABEL_ALIASES: dict[str, set[str]] = {
    "person": {"person"},
    "cat": {"cat"},
    "dog": {"dog"},
    "vehicle": {"bicycle", "car", "motorcycle", "bus", "train", "truck"},
    "phone": {"cell phone"},
}

LABEL_NAMES_ZH = {
    "person": "人",
    "cat": "猫",
    "dog": "狗",
    "vehicle": "车辆",
    "phone": "手机",
}


@dataclass
class RawDetection:
    label: str
    label_name: str
    confidence: float
    frame_time: float
    bbox: list[float]


@dataclass
class DetectionSpan:
    label: str
    label_name: str
    confidence: float
    start_time: float
    end_time: float
    frame_time: float
    bbox: list[float]


class VisionDetector:
    def __init__(self) -> None:
        self._session: Any | None = None
        self._session_path: Path | None = None

    @property
    def model_path(self) -> Path:
        model = str(get_effective("vision_model", "yolov8n"))
        if model.endswith(".onnx"):
            raw = Path(model)
            return raw if raw.is_absolute() else get_settings().vision_models_path / raw
        return get_settings().vision_models_path / f"{model}.onnx"

    def model_status(self) -> dict:
        path = self.model_path
        return {
            "model": str(get_effective("vision_model", "yolov8n")),
            "path": str(path),
            "available": path.exists(),
            "device": str(get_effective("vision_device", "cpu")),
        }

    def invalidate(self) -> None:
        self._session = None
        self._session_path = None

    def detect_video(
        self,
        video_path: Path,
        labels: list[str],
        confidence_threshold: float,
        sample_interval_seconds: float,
        image_size: int,
        timeout: int = 900,
    ) -> list[DetectionSpan]:
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")
        model_path = self.model_path
        if not model_path.exists():
            raise FileNotFoundError(f"视觉识别模型不存在: {model_path}")

        sample_interval_seconds = max(1.0, float(sample_interval_seconds or 5))
        image_size = int(image_size or 416)
        image_size = max(320, min(image_size, 960))

        with tempfile.TemporaryDirectory(prefix="clipline_vision_") as tmp:
            frame_dir = Path(tmp)
            self._extract_frames(video_path, frame_dir, sample_interval_seconds, timeout)
            frames = sorted(frame_dir.glob("frame_*.jpg"))
            if not frames:
                return []

            raw: list[RawDetection] = []
            for index, frame in enumerate(frames):
                frame_time = index * sample_interval_seconds
                raw.extend(
                    self._detect_frame(
                        frame,
                        frame_time,
                        labels,
                        confidence_threshold,
                        image_size,
                    )
                )
            return merge_detections(raw, sample_interval_seconds)

    def _extract_frames(
        self,
        video_path: Path,
        frame_dir: Path,
        sample_interval_seconds: float,
        timeout: int,
    ) -> None:
        fps = 1 / sample_interval_seconds
        output = frame_dir / "frame_%06d.jpg"
        command = [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(video_path),
            "-vf",
            f"fps={fps},scale='min(960,iw)':-2",
            "-q:v",
            "3",
            str(output),
        ]
        subprocess.run(command, check=True, timeout=timeout)

    def _get_session(self):
        model_path = self.model_path
        if self._session is not None and self._session_path == model_path:
            return self._session
        try:
            import onnxruntime as ort
        except ImportError as exc:
            raise RuntimeError("缺少 onnxruntime，请安装 backend[vision] 后再运行视觉识别") from exc

        providers = ["CPUExecutionProvider"]
        self._session = ort.InferenceSession(str(model_path), providers=providers)
        self._session_path = model_path
        return self._session

    def _detect_frame(
        self,
        frame_path: Path,
        frame_time: float,
        requested_labels: list[str],
        confidence_threshold: float,
        image_size: int,
    ) -> list[RawDetection]:
        try:
            import numpy as np
            from PIL import Image
        except ImportError as exc:
            raise RuntimeError("缺少 pillow/numpy，请安装 backend[vision] 后再运行视觉识别") from exc

        image = Image.open(frame_path).convert("RGB")
        original_width, original_height = image.size
        padded, scale, pad_x, pad_y = letterbox(image, image_size)
        array = np.asarray(padded).astype("float32") / 255.0
        array = np.transpose(array, (2, 0, 1))[None, :, :, :]

        session = self._get_session()
        input_name = session.get_inputs()[0].name
        output = session.run(None, {input_name: array})[0]
        predictions = normalize_yolo_output(output)

        allowed_classes = labels_to_classes(requested_labels)
        boxes: list[list[float]] = []
        scores: list[float] = []
        labels: list[str] = []
        for prediction in predictions:
            if len(prediction) < 6:
                continue
            box = prediction[:4]
            class_scores = prediction[4:]
            class_id = int(np.argmax(class_scores))
            score = float(class_scores[class_id])
            if score < confidence_threshold or class_id not in allowed_classes:
                continue
            label = class_to_label(class_id)
            if not label:
                continue
            x_center, y_center, width, height = [float(value) for value in box]
            x1 = (x_center - width / 2 - pad_x) / scale
            y1 = (y_center - height / 2 - pad_y) / scale
            x2 = (x_center + width / 2 - pad_x) / scale
            y2 = (y_center + height / 2 - pad_y) / scale
            boxes.append([
                clamp(x1, 0, original_width),
                clamp(y1, 0, original_height),
                clamp(x2, 0, original_width),
                clamp(y2, 0, original_height),
            ])
            scores.append(score)
            labels.append(label)

        keep = nms(boxes, scores, 0.45)
        return [
            RawDetection(
                label=labels[index],
                label_name=LABEL_NAMES_ZH.get(labels[index], labels[index]),
                confidence=scores[index],
                frame_time=frame_time,
                bbox=boxes[index],
            )
            for index in keep
        ]


def letterbox(image, image_size: int):
    from PIL import Image

    width, height = image.size
    scale = min(image_size / width, image_size / height)
    resized_width = int(round(width * scale))
    resized_height = int(round(height * scale))
    resized = image.resize((resized_width, resized_height), Image.Resampling.BILINEAR)
    canvas = Image.new("RGB", (image_size, image_size), (114, 114, 114))
    pad_x = (image_size - resized_width) // 2
    pad_y = (image_size - resized_height) // 2
    canvas.paste(resized, (pad_x, pad_y))
    return canvas, scale, pad_x, pad_y


def normalize_yolo_output(output):
    import numpy as np

    array = np.asarray(output)
    if array.ndim == 3:
        array = array[0]
    if array.shape[0] < array.shape[-1]:
        array = array.T
    return array


def labels_to_classes(labels: list[str]) -> set[int]:
    normalized = {label.strip() for label in labels if label.strip()}
    if not normalized:
        normalized = set(LABEL_ALIASES)
    allowed_names: set[str] = set()
    for label in normalized:
        allowed_names.update(LABEL_ALIASES.get(label, {label}))
    return {index for index, name in enumerate(COCO_NAMES) if name in allowed_names}


def class_to_label(class_id: int) -> str | None:
    if class_id < 0 or class_id >= len(COCO_NAMES):
        return None
    name = COCO_NAMES[class_id]
    for label, aliases in LABEL_ALIASES.items():
        if name in aliases:
            return label
    return name


def merge_detections(raw: list[RawDetection], sample_interval_seconds: float) -> list[DetectionSpan]:
    grouped: dict[str, list[RawDetection]] = {}
    for detection in sorted(raw, key=lambda item: (item.label, item.frame_time)):
        grouped.setdefault(detection.label, []).append(detection)

    spans: list[DetectionSpan] = []
    max_gap = max(sample_interval_seconds * 1.6, sample_interval_seconds + 1)
    for label, detections in grouped.items():
        current: list[RawDetection] = []
        for detection in detections:
            if current and detection.frame_time - current[-1].frame_time > max_gap:
                spans.append(span_from_group(current, sample_interval_seconds))
                current = []
            current.append(detection)
        if current:
            spans.append(span_from_group(current, sample_interval_seconds))
    return sorted(spans, key=lambda item: (item.start_time, item.label))


def span_from_group(group: list[RawDetection], sample_interval_seconds: float) -> DetectionSpan:
    best = max(group, key=lambda item: item.confidence)
    return DetectionSpan(
        label=best.label,
        label_name=best.label_name,
        confidence=best.confidence,
        start_time=max(0.0, group[0].frame_time),
        end_time=max(group[-1].frame_time + sample_interval_seconds, group[0].frame_time + 1),
        frame_time=best.frame_time,
        bbox=best.bbox,
    )


def nms(boxes: list[list[float]], scores: list[float], iou_threshold: float) -> list[int]:
    if not boxes:
        return []
    order = sorted(range(len(boxes)), key=lambda index: scores[index], reverse=True)
    keep: list[int] = []
    while order:
        current = order.pop(0)
        keep.append(current)
        order = [index for index in order if iou(boxes[current], boxes[index]) < iou_threshold]
    return keep


def iou(left: list[float], right: list[float]) -> float:
    x1 = max(left[0], right[0])
    y1 = max(left[1], right[1])
    x2 = min(left[2], right[2])
    y2 = min(left[3], right[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    union = left_area + right_area - inter
    return inter / union if union > 0 else 0.0


def clamp(value: float, minimum: float, maximum: float) -> float:
    if math.isnan(value):
        return minimum
    return min(maximum, max(minimum, value))


def bbox_to_json(bbox: list[float]) -> str:
    return json.dumps([round(value, 2) for value in bbox], separators=(",", ":"))


_detector: VisionDetector | None = None


def get_vision_detector() -> VisionDetector:
    global _detector
    if _detector is None:
        _detector = VisionDetector()
    return _detector
