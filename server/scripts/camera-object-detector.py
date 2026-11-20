#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import socket
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import BinaryIO, Iterable, TextIO


@dataclass(frozen=True)
class Detection:
    label: str
    score: float
    bbox: tuple[float, float, float, float]


@dataclass
class Track:
    track_id: int
    label: str
    bbox: tuple[float, float, float, float]
    stable_bbox: tuple[float, float, float, float]
    created_at_ms: int
    last_seen_at_ms: int
    baseline: bool
    warmup_anchor: bool = False
    observations: int = 1
    strong_observations: int = 0
    last_strong_at_ms: int | None = None
    movement_hits: int = 0
    movement_first_at_ms: int = 0
    last_movement_at_ms: int = 0
    active_until_ms: int = 0
    qualified: bool = False
    label_score: float = 0.0
    start_center: tuple[float, float] | None = None
    last_center: tuple[float, float] | None = None
    path_length: float = 0.0
    horizontal_travel: float = 0.0
    horizontal_reversals: int = 0
    last_horizontal_sign: int = 0
    area_total: float = 0.0
    area_samples: int = 0
    maximum_area: float = 0.0
    color_scores: dict[str, float] = field(default_factory=dict)
    color_samples: int = 0


class MovementTracker:
    def __init__(
        self,
        allowed_labels: set[str],
        minimum_score: float = 0.40,
        warmup_ms: int = 4_000,
        confirmation_ms: int = 3_500,
        anchor_ttl_ms: int = 600_000,
        movement_threshold: float = 0.035,
        size_change_threshold: float = 0.30,
        active_hold_ms: int = 6_000,
    ) -> None:
        self.allowed_labels = allowed_labels
        self.minimum_score = minimum_score
        self.minimum_tracking_score = max(0.35, minimum_score - 0.18)
        self.warmup_ms = warmup_ms
        self.confirmation_ms = confirmation_ms
        self.anchor_ttl_ms = anchor_ttl_ms
        self.movement_threshold = movement_threshold
        self.size_change_threshold = size_change_threshold
        self.active_hold_ms = active_hold_ms
        self.started_at_ms: int | None = None
        self.next_track_id = 1
        self.tracks: list[Track] = []

    def update(
        self,
        detections: Iterable[Detection],
        observed_at_ms: int,
        frame: bytes | None = None,
        frame_width: int = 320,
        frame_height: int = 320,
    ) -> list[dict[str, object]]:
        if self.started_at_ms is None:
            self.started_at_ms = observed_at_ms

        warmup = observed_at_ms - self.started_at_ms <= self.warmup_ms
        self.tracks = [
            track
            for track in self.tracks
            if observed_at_ms - track.last_seen_at_ms
            <= self.anchor_ttl_ms
        ]
        for track in self.tracks:
            if not track.baseline and observed_at_ms - track.created_at_ms > self.confirmation_ms:
                track.baseline = True

        accepted = deduplicate_detections([
            detection
            for detection in detections
            if detection.label in self.allowed_labels
            and detection.score >= self.minimum_tracking_score
            and bbox_area(detection.bbox) >= 0.001
        ])
        available_track_ids = {track.track_id for track in self.tracks}
        matched_track_ids: set[int] = set()
        active: list[dict[str, object]] = []

        for detection in sorted(accepted, key=lambda item: item.score, reverse=True):
            track = self._best_track(detection, available_track_ids)
            if track is None:
                track = Track(
                    track_id=self.next_track_id,
                    label=detection.label,
                    bbox=detection.bbox,
                    stable_bbox=detection.bbox,
                    created_at_ms=observed_at_ms,
                    last_seen_at_ms=observed_at_ms,
                    baseline=warmup,
                    warmup_anchor=warmup,
                    strong_observations=1 if detection.score >= self.minimum_score else 0,
                    last_strong_at_ms=(
                        observed_at_ms
                        if detection.score >= self.minimum_score
                        else None
                    ),
                    label_score=detection.score,
                    start_center=bbox_center(detection.bbox),
                    last_center=bbox_center(detection.bbox),
                    area_total=bbox_area(detection.bbox),
                    area_samples=1,
                    maximum_area=bbox_area(detection.bbox),
                )
                if self._safe_single_frame_candidate(detection, warmup):
                    track.baseline = True
                    track.qualified = True
                    track.movement_hits = 1
                    track.movement_first_at_ms = observed_at_ms
                    track.last_movement_at_ms = observed_at_ms
                    track.active_until_ms = observed_at_ms + self.active_hold_ms
                self.next_track_id += 1
                self.tracks.append(track)
            else:
                available_track_ids.discard(track.track_id)
                self._update_track(
                    track,
                    detection,
                    observed_at_ms,
                    warmup,
                    detection.score >= self.minimum_score,
                )

            self._observe_color(
                track,
                detection,
                frame,
                frame_width,
                frame_height,
            )
            matched_track_ids.add(track.track_id)
            if track.qualified and observed_at_ms <= track.active_until_ms:
                active.append(
                    {
                        'trackId': track.track_id,
                        'label': track.label,
                        'score': round(detection.score, 4),
                        'bbox': [round(value, 5) for value in detection.bbox],
                        'firstSeenAtMs': track.movement_first_at_ms or track.created_at_ms,
                        'displacement': round(center_distance(track.stable_bbox, detection.bbox), 5),
                        'trajectory': trajectory_summary(track),
                        'color': color_summary(track),
                    }
                )

        return active

    def _best_track(self, detection: Detection, available_track_ids: set[int]) -> Track | None:
        candidates: list[tuple[int, float, Track]] = []
        detection_area = max(bbox_area(detection.bbox), 1e-9)

        for track in self.tracks:
            if (
                track.track_id not in available_track_ids
                or label_group(track.label) != label_group(detection.label)
            ):
                continue
            track_area = max(bbox_area(track.bbox), 1e-9)
            area_ratio = detection_area / track_area
            distance = center_distance(track.bbox, detection.bbox)
            overlap = bbox_iou(track.bbox, detection.bbox)
            vehicle = label_group(detection.label) == 'vehicle'
            max_distance = (
                0.18
                if vehicle and track.warmup_anchor
                else 0.45
                if vehicle
                else 0.20
            )
            minimum_area_ratio = 0.30 if vehicle else 0.25
            maximum_area_ratio = 4.0
            if overlap < 0.05 and (
                distance > max_distance
                or area_ratio < minimum_area_ratio
                or area_ratio > maximum_area_ratio
            ):
                continue
            candidates.append((
                0 if track.strong_observations else 1,
                distance - overlap * 0.10,
                track,
            ))

        return min(candidates, key=lambda item: (item[0], item[1]))[2] if candidates else None

    def _update_track(
        self,
        track: Track,
        detection: Detection,
        observed_at_ms: int,
        warmup: bool,
        strong: bool,
    ) -> None:
        previous_bbox = track.bbox
        track.observations += 1
        if strong:
            track.strong_observations += 1
            track.last_strong_at_ms = observed_at_ms
        track.last_seen_at_ms = observed_at_ms
        self._record_trajectory(track, detection.bbox)
        track.bbox = detection.bbox
        if detection.score > track.label_score:
            track.label = detection.label
            track.label_score = detection.score

        if warmup:
            track.baseline = True
            track.stable_bbox = blend_bbox(track.stable_bbox, detection.bbox, 0.20)
            track.movement_hits = 0
            return

        if not track.baseline:
            step_displacement = center_distance(previous_bbox, detection.bbox)
            step_size_change = abs(
                math.log(max(bbox_area(detection.bbox), 1e-9) / max(bbox_area(previous_bbox), 1e-9))
            )
            minimum_new_step = 0.05 if label_group(detection.label) == 'vehicle' else 0.015
            if (
                track.strong_observations >= 1
                and track.observations >= 2
                and observed_at_ms - track.created_at_ms <= self.confirmation_ms
                and (
                    step_displacement >= minimum_new_step
                    or (
                        step_size_change >= self.size_change_threshold
                        and step_displacement >= 0.015
                    )
                )
            ):
                track.qualified = True
                track.active_until_ms = observed_at_ms + self.active_hold_ms
                track.movement_first_at_ms = track.created_at_ms
                track.last_movement_at_ms = observed_at_ms
                track.movement_hits = 2
                track.baseline = True
            return

        displacement = center_distance(track.stable_bbox, detection.bbox)
        size_change = abs(
            math.log(max(bbox_area(detection.bbox), 1e-9) / max(bbox_area(track.stable_bbox), 1e-9))
        )
        step_displacement = center_distance(previous_bbox, detection.bbox)
        step_size_change = abs(
            math.log(max(bbox_area(detection.bbox), 1e-9) / max(bbox_area(previous_bbox), 1e-9))
        )
        moved = (
            (
                displacement >= self.movement_threshold
                and step_displacement >= 0.012
            )
            or (
                size_change >= self.size_change_threshold
                and step_size_change >= 0.08
                and step_displacement >= 0.008
            )
        )

        recently_strong = (
            strong
            or (
                track.last_strong_at_ms is not None
                and observed_at_ms - track.last_strong_at_ms <= self.confirmation_ms
            )
        )
        if moved and recently_strong:
            continuing_motion = (
                track.last_movement_at_ms > 0
                and observed_at_ms - track.last_movement_at_ms <= self.confirmation_ms
            )
            if continuing_motion:
                track.movement_hits += 1
            else:
                reset_motion_trajectory(track, detection.bbox)
                track.movement_hits = 1
                track.movement_first_at_ms = observed_at_ms
            track.last_movement_at_ms = observed_at_ms
            if track.movement_hits >= 2:
                track.qualified = True
                track.active_until_ms = observed_at_ms + self.active_hold_ms
            if track.qualified:
                track.stable_bbox = blend_bbox(track.stable_bbox, detection.bbox, 0.35)
        elif not moved and strong:
            track.movement_hits = 0
            if observed_at_ms > track.active_until_ms:
                track.stable_bbox = blend_bbox(track.stable_bbox, detection.bbox, 0.05)

    def _safe_single_frame_candidate(
        self,
        detection: Detection,
        warmup: bool,
    ) -> bool:
        if warmup or label_group(detection.label) != 'vehicle' or detection.score < 0.92:
            return False
        ymin, xmin, ymax, xmax = detection.bbox
        area = bbox_area(detection.bbox)
        touches_entry_edge = xmin <= 0.08 or xmax >= 0.92
        return (
            area >= 0.008
            and area <= 0.60
            and ymax > ymin
            and touches_entry_edge
        )

    def _record_trajectory(
        self,
        track: Track,
        bbox: tuple[float, float, float, float],
    ) -> None:
        current = bbox_center(bbox)
        previous = track.last_center
        track.start_center = track.start_center or current
        track.last_center = current
        area = bbox_area(bbox)
        track.area_total += area
        track.area_samples += 1
        track.maximum_area = max(track.maximum_area, area)
        if previous is None:
            return

        delta_y = current[0] - previous[0]
        delta_x = current[1] - previous[1]
        distance = math.hypot(delta_y, delta_x)
        if distance < 0.004:
            return
        track.path_length += distance
        track.horizontal_travel += abs(delta_x)
        if abs(delta_x) >= 0.012:
            sign = 1 if delta_x > 0 else -1
            if track.last_horizontal_sign and sign != track.last_horizontal_sign:
                track.horizontal_reversals += 1
            track.last_horizontal_sign = sign

    def _observe_color(
        self,
        track: Track,
        detection: Detection,
        frame: bytes | None,
        frame_width: int,
        frame_height: int,
    ) -> None:
        if (
            frame is None
            or label_group(detection.label) != 'vehicle'
            or len(frame) != frame_width * frame_height * 3
        ):
            return
        estimate = estimate_vehicle_color(
            frame,
            frame_width,
            frame_height,
            detection.bbox,
        )
        if estimate is None:
            return
        color, confidence = estimate
        track.color_scores[color] = track.color_scores.get(color, 0.0) + confidence
        track.color_samples += 1


class LiteRtObjectDetector:
    def __init__(self, model_path: str, labels_path: str, threads: int) -> None:
        import numpy as np
        from ai_edge_litert.interpreter import Interpreter

        self.np = np
        self.labels = [
            line.strip()
            for line in open(labels_path, encoding='utf-8')
            if line.strip()
        ]
        self.interpreter = Interpreter(model_path=model_path, num_threads=threads)
        self.interpreter.allocate_tensors()
        self.input_detail = self.interpreter.get_input_details()[0]
        self.output_details = self.interpreter.get_output_details()
        input_shape = tuple(int(value) for value in self.input_detail['shape'])
        if len(input_shape) != 4 or input_shape[0] != 1 or input_shape[3] != 3:
            raise RuntimeError(f'Formato de entrada inesperado: {input_shape}')
        self.height = input_shape[1]
        self.width = input_shape[2]
        output_shapes = [
            tuple(int(value) for value in detail['shape'])
            for detail in self.output_details
        ]
        raw_boxes = next(
            (
                index
                for index, shape in enumerate(output_shapes)
                if len(shape) == 3 and shape[-1] == 4 and shape[1] > 1_000
            ),
            None,
        )
        raw_classes = next(
            (
                index
                for index, shape in enumerate(output_shapes)
                if len(shape) == 3 and shape[1] > 1_000 and shape[-1] == len(self.labels)
            ),
            None,
        )
        self.raw_output_indices = (
            (raw_boxes, raw_classes)
            if raw_boxes is not None and raw_classes is not None
            else None
        )
        self.anchors = (
            generate_efficientdet_anchors(np, self.width, output_shapes[raw_boxes][1])
            if self.raw_output_indices
            else None
        )

    def detect(self, frame: bytes) -> list[Detection]:
        np = self.np
        image = np.frombuffer(frame, dtype=np.uint8).reshape((self.height, self.width, 3))
        input_dtype = self.input_detail['dtype']
        if input_dtype == np.uint8:
            tensor = image
        elif input_dtype == np.int8:
            scale, zero_point = self.input_detail.get('quantization', (1.0, -128))
            scale = float(scale) or 1.0
            tensor = np.clip(np.rint(image.astype(np.float32) / scale + zero_point), -128, 127).astype(np.int8)
        else:
            tensor = image.astype(input_dtype)

        self.interpreter.set_tensor(self.input_detail['index'], tensor[None, ...])
        self.interpreter.invoke()
        outputs = [
            (str(detail.get('name', '')).lower(), np.squeeze(self.interpreter.get_tensor(detail['index'])))
            for detail in self.output_details
        ]
        if self.raw_output_indices and self.anchors is not None:
            boxes_index, classes_index = self.raw_output_indices
            return self._decode_raw_outputs(
                outputs[boxes_index][1],
                outputs[classes_index][1],
            )

        boxes = next(
            (value for name, value in outputs if 'box' in name),
            next((value for _, value in outputs if value.ndim >= 2 and value.shape[-1] == 4), None),
        )
        count_value = next(
            (value for name, value in outputs if 'count' in name or 'num' in name),
            next((value for _, value in outputs if value.size == 1), None),
        )
        classes = next((value for name, value in outputs if 'class' in name), None)
        scores = next((value for name, value in outputs if 'score' in name), None)

        vectors = [
            value.reshape(-1)
            for _, value in outputs
            if value.size > 1 and not (value.ndim >= 2 and value.shape[-1] == 4)
        ]
        count = int(float(np.ravel(count_value)[0])) if count_value is not None else 0
        if boxes is None:
            raise RuntimeError('Modelo sem tensor de caixas.')
        boxes = boxes.reshape((-1, 4))
        if not count:
            count = len(boxes)

        if classes is None or scores is None:
            if len(vectors) < 2:
                raise RuntimeError('Modelo sem tensores de classes e scores.')
            sample_size = min(count, *(len(value) for value in vectors))
            ranked = sorted(
                vectors,
                key=lambda value: float(np.mean(np.abs(value[:sample_size] - np.rint(value[:sample_size])))),
            )
            classes = ranked[0]
            scores = next(value for value in vectors if value is not classes)

        classes = classes.reshape(-1)
        scores = scores.reshape(-1)
        count = min(count, len(boxes), len(classes), len(scores))
        detections: list[Detection] = []
        for index in range(count):
            class_index = int(round(float(classes[index])))
            if class_index < 0 or class_index >= len(self.labels):
                continue
            ymin, xmin, ymax, xmax = (float(value) for value in boxes[index])
            detections.append(
                Detection(
                    label=self.labels[class_index],
                    score=float(scores[index]),
                    bbox=(
                        clamp01(ymin),
                        clamp01(xmin),
                        clamp01(ymax),
                        clamp01(xmax),
                    ),
                )
            )
        return detections

    def _decode_raw_outputs(self, box_outputs: object, class_outputs: object) -> list[Detection]:
        np = self.np
        boxes = np.asarray(box_outputs, dtype=np.float32).reshape((-1, 4))
        logits = np.asarray(class_outputs, dtype=np.float32).reshape((len(boxes), -1))
        best_classes = np.argmax(logits, axis=1)
        best_logits = logits[np.arange(len(logits)), best_classes]
        candidates = np.flatnonzero(best_logits >= -1.38629436112)
        if len(candidates) > 1_500:
            top = np.argpartition(best_logits[candidates], -1_500)[-1_500:]
            candidates = candidates[top]
        if not len(candidates):
            return []

        selected_boxes = decode_efficientdet_boxes(
            np,
            boxes[candidates],
            self.anchors[candidates],
            self.height,
            self.width,
        )
        selected_classes = best_classes[candidates]
        selected_scores = 1.0 / (1.0 + np.exp(-best_logits[candidates]))
        kept: list[int] = []
        for class_index in np.unique(selected_classes):
            class_positions = np.flatnonzero(selected_classes == class_index)
            kept.extend(
                int(class_positions[index])
                for index in nms_indices(
                    np,
                    selected_boxes[class_positions],
                    selected_scores[class_positions],
                    0.50,
                    20,
                )
            )
        kept.sort(key=lambda index: float(selected_scores[index]), reverse=True)

        detections: list[Detection] = []
        for index in kept[:30]:
            class_index = int(selected_classes[index])
            if class_index < 0 or class_index >= len(self.labels):
                continue
            detections.append(
                Detection(
                    label=self.labels[class_index],
                    score=float(selected_scores[index]),
                    bbox=tuple(
                        clamp01(float(value))
                        for value in selected_boxes[index]
                    ),  # type: ignore[arg-type]
                )
            )
        return detections


def generate_efficientdet_anchors(np: object, image_size: int, expected_count: int) -> object:
    feature_sizes = [image_size]
    for _ in range(7):
        feature_sizes.append((feature_sizes[-1] - 1) // 2 + 1)

    levels: list[object] = []
    aspects = ((1.0, 1.0), (1.4, 0.7), (0.7, 1.4))
    for level in range(3, 8):
        feature_size = feature_sizes[level]
        stride = image_size / float(feature_size)
        centers = np.arange(stride / 2, image_size, stride)  # type: ignore[attr-defined]
        x_centers, y_centers = np.meshgrid(centers, centers)  # type: ignore[attr-defined]
        per_location: list[object] = []
        for scale_octave in range(3):
            for aspect_x, aspect_y in aspects:
                base_size = 4.0 * stride * 2 ** (scale_octave / 3.0)
                half_width = base_size * aspect_x / 2.0
                half_height = base_size * aspect_y / 2.0
                per_location.append(
                    np.stack(  # type: ignore[attr-defined]
                        (
                            y_centers - half_height,
                            x_centers - half_width,
                            y_centers + half_height,
                            x_centers + half_width,
                        ),
                        axis=-1,
                    )
                )
        level_anchors = np.stack(per_location, axis=2).reshape((-1, 4))  # type: ignore[attr-defined]
        levels.append(level_anchors)

    anchors = np.concatenate(levels, axis=0).astype(np.float32)  # type: ignore[attr-defined]
    if len(anchors) != expected_count:
        raise RuntimeError(
            f'Quantidade de anchors inesperada: {len(anchors)} != {expected_count}'
        )
    return anchors


def decode_efficientdet_boxes(
    np: object,
    relative_boxes: object,
    anchors: object,
    image_height: int,
    image_width: int,
) -> object:
    anchor_y = (anchors[:, 0] + anchors[:, 2]) / 2
    anchor_x = (anchors[:, 1] + anchors[:, 3]) / 2
    anchor_height = anchors[:, 2] - anchors[:, 0]
    anchor_width = anchors[:, 3] - anchors[:, 1]
    ty, tx, th, tw = (relative_boxes[:, index] for index in range(4))
    height = np.exp(np.clip(th, -10, 10)) * anchor_height  # type: ignore[attr-defined]
    width = np.exp(np.clip(tw, -10, 10)) * anchor_width  # type: ignore[attr-defined]
    center_y = ty * anchor_height + anchor_y
    center_x = tx * anchor_width + anchor_x
    return np.stack(  # type: ignore[attr-defined]
        (
            (center_y - height / 2) / image_height,
            (center_x - width / 2) / image_width,
            (center_y + height / 2) / image_height,
            (center_x + width / 2) / image_width,
        ),
        axis=1,
    )


def nms_indices(
    np: object,
    boxes: object,
    scores: object,
    threshold: float,
    limit: int,
) -> list[int]:
    order = np.argsort(scores)[::-1]  # type: ignore[attr-defined]
    keep: list[int] = []
    while len(order) and len(keep) < limit:
        current = int(order[0])
        keep.append(current)
        if len(order) == 1:
            break
        remaining = order[1:]
        ymin = np.maximum(boxes[current, 0], boxes[remaining, 0])  # type: ignore[attr-defined]
        xmin = np.maximum(boxes[current, 1], boxes[remaining, 1])  # type: ignore[attr-defined]
        ymax = np.minimum(boxes[current, 2], boxes[remaining, 2])  # type: ignore[attr-defined]
        xmax = np.minimum(boxes[current, 3], boxes[remaining, 3])  # type: ignore[attr-defined]
        intersection = np.maximum(0.0, ymax - ymin) * np.maximum(0.0, xmax - xmin)  # type: ignore[attr-defined]
        current_area = max(
            0.0,
            float(boxes[current, 2] - boxes[current, 0]),
        ) * max(0.0, float(boxes[current, 3] - boxes[current, 1]))
        remaining_area = (
            np.maximum(0.0, boxes[remaining, 2] - boxes[remaining, 0])  # type: ignore[attr-defined]
            * np.maximum(0.0, boxes[remaining, 3] - boxes[remaining, 1])  # type: ignore[attr-defined]
        )
        union = current_area + remaining_area - intersection
        overlap = np.divide(  # type: ignore[attr-defined]
            intersection,
            union,
            out=np.zeros_like(intersection),  # type: ignore[attr-defined]
            where=union > 0,
        )
        order = remaining[overlap <= threshold]
    return keep


def label_group(label: str) -> str:
    return 'vehicle' if label in {'car', 'truck', 'bus'} else label


def deduplicate_detections(detections: list[Detection]) -> list[Detection]:
    kept: list[Detection] = []
    for detection in sorted(detections, key=lambda item: item.score, reverse=True):
        duplicate = any(
            label_group(existing.label) == label_group(detection.label)
            and bbox_iou(existing.bbox, detection.bbox) >= 0.40
            for existing in kept
        )
        if not duplicate:
            kept.append(detection)
    return kept


def bbox_center(
    bbox: tuple[float, float, float, float],
) -> tuple[float, float]:
    return ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)


def reset_motion_trajectory(
    track: Track,
    bbox: tuple[float, float, float, float],
) -> None:
    center = bbox_center(bbox)
    area = bbox_area(bbox)
    track.start_center = center
    track.last_center = center
    track.path_length = 0.0
    track.horizontal_travel = 0.0
    track.horizontal_reversals = 0
    track.last_horizontal_sign = 0
    track.area_total = area
    track.area_samples = 1
    track.maximum_area = area
    track.color_scores.clear()
    track.color_samples = 0


def trajectory_summary(track: Track) -> dict[str, object]:
    start_y, start_x = track.start_center or bbox_center(track.bbox)
    end_y, end_x = track.last_center or bbox_center(track.bbox)
    net_distance = math.hypot(end_y - start_y, end_x - start_x)
    straightness = (
        min(1.0, net_distance / track.path_length)
        if track.path_length > 0
        else 1.0
    )
    mean_area = track.area_total / track.area_samples if track.area_samples else bbox_area(track.bbox)
    net_dx = end_x - start_x
    minimum_net_distance = 0.10 if mean_area >= 0.10 else 0.06
    stationary_jitter = (
        net_distance < minimum_net_distance
        and (
            straightness < 0.45
            or track.horizontal_reversals >= 2
        )
    )
    excessive_jitter = (
        track.horizontal_reversals >= 5
        and straightness < 0.18
        and track.path_length >= max(0.50, net_distance * 6)
    )
    jitter = (
        stationary_jitter
        or excessive_jitter
        or (track.warmup_anchor and net_distance < 0.20)
    )
    maneuvered = (
        not jitter
        and net_distance >= 0.10
        and 1 <= track.horizontal_reversals <= 4
        and track.horizontal_travel >= 0.16
        and track.path_length <= 2.50
        and straightness < 0.55
    )
    passed_by = (
        not maneuvered
        and abs(net_dx) >= 0.16
        and track.horizontal_travel >= 0.18
        and straightness >= 0.55
    )

    if jitter:
        action = 'unknown'
        direction = 'unknown'
        confidence = 0.20
    elif maneuvered:
        action = 'maneuvered'
        direction = 'mixed'
        confidence = min(
            1.0,
            0.55
            + min(0.25, track.horizontal_reversals * 0.12)
            + min(0.20, track.horizontal_travel),
        )
    elif passed_by:
        action = 'passed_by'
        direction = 'left_to_right' if net_dx > 0 else 'right_to_left'
        confidence = min(1.0, 0.45 + abs(net_dx) + straightness * 0.25)
    elif net_distance >= minimum_net_distance and track.path_length <= 3.0:
        action = 'moving'
        if net_dx >= 0.08:
            direction = 'left_to_right'
        elif net_dx <= -0.08:
            direction = 'right_to_left'
        else:
            direction = 'unknown'
        confidence = min(0.75, 0.35 + track.path_length)
    else:
        action = 'unknown'
        direction = 'unknown'
        confidence = 0.25

    if start_x <= 0.35:
        entry_edge = 'left'
    elif start_x >= 0.65:
        entry_edge = 'right'
    else:
        entry_edge = 'center'

    return {
        'entryEdge': entry_edge,
        'direction': direction,
        'action': action,
        'confidence': round(confidence, 4),
        'startCenter': [round(start_x, 5), round(start_y, 5)],
        'endCenter': [round(end_x, 5), round(end_y, 5)],
        'pathLength': round(track.path_length, 5),
        'horizontalTravel': round(track.horizontal_travel, 5),
        'horizontalReversals': track.horizontal_reversals,
        'straightness': round(straightness, 4),
        'meanArea': round(mean_area, 5),
        'maximumArea': round(track.maximum_area, 5),
    }


def color_summary(track: Track) -> dict[str, object]:
    if not track.color_scores:
        return {
            'key': 'unknown',
            'label': 'cor não identificada',
            'confidence': 0.0,
            'samples': 0,
        }
    color, score = max(track.color_scores.items(), key=lambda item: item[1])
    total = sum(track.color_scores.values())
    confidence = (score / total if total else 0.0) * min(1.0, track.color_samples / 2)
    return {
        'key': color,
        'label': {
            'black': 'preto',
            'burgundy': 'bordô',
            'gray': 'cinza',
            'red': 'vermelho',
            'white': 'branco',
            'blue': 'azul',
            'brown': 'marrom',
        }.get(color, 'cor não identificada'),
        'confidence': round(confidence, 4),
        'samples': track.color_samples,
    }


def estimate_vehicle_color(
    frame: bytes,
    width: int,
    height: int,
    bbox: tuple[float, float, float, float],
) -> tuple[str, float] | None:
    ymin, xmin, ymax, xmax = bbox
    box_width = max(0.0, xmax - xmin)
    box_height = max(0.0, ymax - ymin)
    left = max(0, min(width - 1, int((xmin + box_width * 0.12) * width)))
    right = max(left + 1, min(width, int((xmax - box_width * 0.12) * width)))
    top = max(0, min(height - 1, int((ymin + box_height * 0.42) * height)))
    bottom = max(top + 1, min(height, int((ymin + box_height * 0.78) * height)))
    step_x = max(1, (right - left) // 24)
    step_y = max(1, (bottom - top) // 12)
    counts: dict[str, int] = {}
    valid = 0
    chromatic = 0

    for y in range(top, bottom, step_y):
        row = y * width * 3
        for x in range(left, right, step_x):
            offset = row + x * 3
            red = frame[offset]
            green = frame[offset + 1]
            blue = frame[offset + 2]
            maximum = max(red, green, blue)
            minimum = min(red, green, blue)
            if maximum < 38:
                continue
            valid += 1
            delta = maximum - minimum
            saturation = delta / maximum if maximum else 0.0
            color: str | None = None

            if saturation >= 0.18 and delta:
                if maximum == red:
                    hue = (60 * ((green - blue) / delta)) % 360
                elif maximum == green:
                    hue = 60 * ((blue - red) / delta + 2)
                else:
                    hue = 60 * ((red - green) / delta + 4)
                if hue <= 25 or hue >= 335:
                    color = 'burgundy' if maximum < 185 else 'red'
                elif 25 < hue <= 55 and maximum < 190:
                    color = 'brown'
                elif 190 <= hue <= 255:
                    color = 'blue'
                if color:
                    chromatic += 1
            else:
                luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
                if luminance < 72:
                    color = 'black'
                elif luminance < 205:
                    color = 'gray'
                else:
                    color = 'white'

            if color:
                counts[color] = counts.get(color, 0) + 1

    if valid < 20 or not counts:
        return None

    chromatic_counts = {
        color: count
        for color, count in counts.items()
        if color in {'burgundy', 'red', 'blue', 'brown'}
    }
    if chromatic_counts:
        color, count = max(chromatic_counts.items(), key=lambda item: item[1])
        chromatic_share = chromatic / valid
        if count / valid >= 0.05 and chromatic_share >= 0.05:
            return color, min(
                1.0,
                0.50 + count / max(chromatic, 1) * 0.25 + chromatic_share * 2,
            )

    achromatic_counts = {
        color: count
        for color, count in counts.items()
        if color in {'black', 'gray', 'white'}
    }
    if not achromatic_counts:
        return None
    color, count = max(achromatic_counts.items(), key=lambda item: item[1])
    return color, min(1.0, count / valid * 1.5)


def bbox_area(bbox: tuple[float, float, float, float]) -> float:
    ymin, xmin, ymax, xmax = bbox
    return max(0.0, ymax - ymin) * max(0.0, xmax - xmin)


def bbox_iou(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
) -> float:
    intersection = (
        max(0.0, min(first[2], second[2]) - max(first[0], second[0]))
        * max(0.0, min(first[3], second[3]) - max(first[1], second[1]))
    )
    union = bbox_area(first) + bbox_area(second) - intersection
    return intersection / union if union > 0 else 0.0


def center_distance(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
) -> float:
    first_y = (first[0] + first[2]) / 2
    first_x = (first[1] + first[3]) / 2
    second_y = (second[0] + second[2]) / 2
    second_x = (second[1] + second[3]) / 2
    return math.hypot(first_y - second_y, first_x - second_x)


def blend_bbox(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
    weight: float,
) -> tuple[float, float, float, float]:
    return tuple(
        old * (1 - weight) + new * weight
        for old, new in zip(first, second)
    )  # type: ignore[return-value]


def clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def read_exact(stream: BinaryIO, size: int) -> bytes | None:
    buffer = bytearray(size)
    view = memoryview(buffer)
    offset = 0
    while offset < size:
        read = stream.readinto(view[offset:])
        if not read:
            return None
        offset += read
    return bytes(buffer)


def emit(stream: TextIO, payload: dict[str, object]) -> None:
    stream.write(json.dumps(payload, separators=(',', ':')) + '\n')
    stream.flush()


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def run_self_test() -> None:
    car = Detection('car', 0.90, (0.45, 0.15, 0.90, 0.65))
    tracker = MovementTracker({'person', 'car', 'cat', 'dog'})
    assert tracker.update([car], 0) == []
    assert tracker.update([Detection('car', 0.91, (0.451, 0.151, 0.901, 0.651))], 1_000) == []
    assert tracker.update([car], 5_000) == []
    assert tracker.update([], 6_000) == []
    assert tracker.update([car], 7_000) == []

    passing_one = Detection('car', 0.86, (0.20, 0.68, 0.42, 0.90))
    passing_two = Detection('car', 0.88, (0.20, 0.58, 0.42, 0.80))
    assert tracker.update([car, passing_one], 8_000) == []
    result = tracker.update([car, passing_two], 9_000)
    assert [item['label'] for item in result] == ['car']

    passing_tracker = MovementTracker({'car'})
    passing_tracker.update([], 0)
    passing_tracker.update([], 5_000)
    passing_tracker.update([Detection('car', 0.80, (0.30, 0.02, 0.60, 0.18))], 6_000)
    passing_tracker.update([Detection('car', 0.82, (0.30, 0.17, 0.60, 0.33))], 7_000)
    passing_tracker.update([Detection('car', 0.84, (0.30, 0.34, 0.60, 0.50))], 8_000)
    passing_tracker.update([Detection('car', 0.85, (0.30, 0.52, 0.60, 0.68))], 9_000)
    passing_result = passing_tracker.update(
        [Detection('car', 0.86, (0.30, 0.69, 0.60, 0.85))],
        10_000,
    )
    passing_trajectory = passing_result[0]['trajectory']
    assert passing_trajectory['action'] == 'passed_by'
    assert passing_trajectory['direction'] == 'left_to_right'
    assert passing_trajectory['entryEdge'] == 'left'
    settled_result: list[dict[str, object]] = []
    for observed_at_ms in range(11_000, 24_000, 1_000):
        settled_result = passing_tracker.update(
            [Detection('car', 0.86, (0.30, 0.69, 0.60, 0.85))],
            observed_at_ms,
        )
    assert settled_result == []

    maneuver_tracker = MovementTracker({'car'})
    maneuver_tracker.update([], 0)
    maneuver_tracker.update([], 5_000)
    maneuver_tracker.update([Detection('car', 0.80, (0.30, 0.02, 0.60, 0.18))], 6_000)
    maneuver_tracker.update([Detection('car', 0.82, (0.30, 0.18, 0.60, 0.34))], 7_000)
    maneuver_tracker.update([Detection('car', 0.84, (0.30, 0.34, 0.60, 0.50))], 8_000)
    maneuver_tracker.update([Detection('car', 0.85, (0.30, 0.18, 0.60, 0.34))], 9_000)
    maneuver_result = maneuver_tracker.update(
        [Detection('car', 0.86, (0.30, 0.36, 0.60, 0.52))],
        10_000,
    )
    maneuver_trajectory = maneuver_result[0]['trajectory']
    assert maneuver_trajectory['action'] == 'maneuvered'
    assert maneuver_trajectory['direction'] == 'mixed'
    assert maneuver_trajectory['entryEdge'] == 'left'

    burgundy = bytes((120, 25, 40)) * (320 * 320)
    gray = bytes((145, 145, 150)) * (320 * 320)
    full_frame_bbox = (0.0, 0.0, 1.0, 1.0)
    assert estimate_vehicle_color(burgundy, 320, 320, full_frame_bbox)[0] == 'burgundy'
    assert estimate_vehicle_color(gray, 320, 320, full_frame_bbox)[0] == 'gray'

    jitter_tracker = MovementTracker({'car', 'truck'})
    jitter_tracker.update([], 0)
    jitter_tracker.update([], 5_000)
    jitter_tracker.update([Detection('truck', 0.60, (0.30, 0.10, 0.60, 0.30))], 6_000)
    jitter_result = jitter_tracker.update(
        [Detection('car', 0.90, (0.30, 0.14, 0.60, 0.34))],
        7_000,
    )
    assert jitter_result == []
    moving_result = jitter_tracker.update(
        [Detection('car', 0.90, (0.30, 0.22, 0.60, 0.42))],
        8_000,
    )
    assert moving_result[0]['label'] == 'car'

    accumulated_car_jitter = Track(
        track_id=90,
        label='car',
        bbox=(0.20, 0.20, 0.60, 0.75),
        stable_bbox=(0.20, 0.20, 0.60, 0.75),
        created_at_ms=0,
        last_seen_at_ms=60_000,
        baseline=True,
        start_center=(0.40, 0.47),
        last_center=(0.42, 0.50),
        path_length=33.96,
        horizontal_travel=6.83,
        horizontal_reversals=64,
        area_total=22.1,
        area_samples=100,
        maximum_area=0.24,
    )
    assert trajectory_summary(accumulated_car_jitter)['action'] == 'unknown'

    accumulated_person_jitter = Track(
        track_id=91,
        label='person',
        bbox=(0.20, 0.20, 0.50, 0.28),
        stable_bbox=(0.20, 0.20, 0.50, 0.28),
        created_at_ms=0,
        last_seen_at_ms=20_000,
        baseline=True,
        start_center=(0.35, 0.24),
        last_center=(0.38, 0.40),
        path_length=5.85,
        horizontal_travel=1.25,
        horizontal_reversals=8,
        area_total=0.38,
        area_samples=20,
        maximum_area=0.03,
    )
    assert trajectory_summary(accumulated_person_jitter)['action'] == 'unknown'
    reset_motion_trajectory(accumulated_person_jitter, accumulated_person_jitter.bbox)
    assert accumulated_person_jitter.path_length == 0
    assert accumulated_person_jitter.horizontal_reversals == 0

    person_tracker = MovementTracker({'person'})
    person_tracker.update([], 0)
    person_tracker.update([], 5_000)
    assert person_tracker.update([Detection('person', 0.80, (0.20, 0.20, 0.70, 0.40))], 6_000) == []
    assert person_tracker.update([Detection('person', 0.82, (0.20, 0.23, 0.70, 0.43))], 7_000)

    rejected_tracker = MovementTracker({'person'})
    rejected_tracker.update([], 0)
    rejected_tracker.update([], 5_000)
    rejected_tracker.update([Detection('person', 0.20, (0.20, 0.20, 0.70, 0.40))], 6_000)
    assert rejected_tracker.update([Detection('person', 0.20, (0.20, 0.23, 0.70, 0.43))], 7_000) == []
    assert rejected_tracker.update([Detection('umbrella', 0.99, (0.20, 0.20, 0.70, 0.40))], 8_000) == []

    fast_vehicle_tracker = MovementTracker({'car'})
    fast_vehicle_tracker.update([], 0)
    fast_vehicle_tracker.update([], 5_000)
    assert fast_vehicle_tracker.update(
        [Detection('car', 0.82, (0.30, 0.01, 0.60, 0.17))],
        6_000,
    ) == []
    fast_vehicle_result = fast_vehicle_tracker.update(
        [Detection('car', 0.79, (0.30, 0.39, 0.60, 0.55))],
        6_500,
    )
    assert len(fast_vehicle_result) == 1
    assert fast_vehicle_result[0]['trackId'] == 1

    score_dip_tracker = MovementTracker({'car'}, minimum_score=0.40)
    score_dip_tracker.update([], 0)
    score_dip_tracker.update([], 5_000)
    assert score_dip_tracker.update(
        [Detection('car', 0.72, (0.30, 0.10, 0.60, 0.30))],
        6_000,
    ) == []
    score_dip_result = score_dip_tracker.update(
        [Detection('car', 0.36, (0.30, 0.22, 0.60, 0.42))],
        6_500,
    )
    assert len(score_dip_result) == 1

    single_high_tracker = MovementTracker({'car'})
    single_high_tracker.update([], 0)
    single_high_tracker.update([], 5_000)
    single_high_result = single_high_tracker.update(
        [Detection('car', 0.95, (0.30, 0.00, 0.60, 0.20))],
        6_000,
    )
    assert len(single_high_result) == 1
    unsafe_single_tracker = MovementTracker({'car'})
    unsafe_single_tracker.update([], 0)
    unsafe_single_tracker.update([], 5_000)
    assert unsafe_single_tracker.update(
        [Detection('car', 0.95, (0.30, 0.35, 0.60, 0.55))],
        6_000,
    ) == []

    print('camera-object-detector self-test: ok')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model')
    parser.add_argument('--labels')
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--minimum-score', type=float, default=0.40)
    parser.add_argument('--warmup-ms', type=int, default=4_000)
    parser.add_argument('--debug-detections', action='store_true')
    parser.add_argument('--allowed-labels', default='person,bicycle,car,motorcycle,bus,truck,cat,dog')
    parser.add_argument('--socket')
    parser.add_argument('--smoke-test', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    return parser.parse_args()


def process_frames(
    source: BinaryIO,
    destination: TextIO,
    detector: LiteRtObjectDetector,
    detector_lock: threading.Lock,
    tracker: MovementTracker,
    model_sha256: str,
    debug_detections: bool = False,
) -> None:
    emit(
        destination,
        {
            'type': 'ready',
            'model': 'efficientdet-lite0-int8',
            'modelSha256': model_sha256,
            'width': detector.width,
            'height': detector.height,
        },
    )

    frame_size = detector.width * detector.height * 3
    last_heartbeat_at = time.monotonic()
    while True:
        frame = read_exact(source, frame_size)
        if frame is None:
            return
        started = time.monotonic()
        with detector_lock:
            detections = detector.detect(frame)
        observed_at_ms = int(time.time() * 1_000)
        completed_at = time.monotonic()
        inference_ms = round((completed_at - started) * 1_000, 2)
        if completed_at - last_heartbeat_at >= 5:
            emit(
                destination,
                {
                    'type': 'heartbeat',
                    'observedAtMs': observed_at_ms,
                    'inferenceMs': inference_ms,
                },
            )
            last_heartbeat_at = completed_at
        if debug_detections:
            emit(
                destination,
                {
                    'type': 'object_debug',
                    'observedAtMs': observed_at_ms,
                    'objects': [
                        {
                            'label': detection.label,
                            'score': round(detection.score, 4),
                            'bbox': [round(value, 5) for value in detection.bbox],
                            'color': estimate_vehicle_color(
                                frame,
                                detector.width,
                                detector.height,
                                detection.bbox,
                            )
                            if label_group(detection.label) == 'vehicle'
                            else None,
                        }
                        for detection in detections
                        if detection.label in tracker.allowed_labels
                        and detection.score >= 0.20
                    ],
                },
            )
        active = tracker.update(
            detections,
            observed_at_ms,
            frame,
            detector.width,
            detector.height,
        )
        if active:
            emit(
                destination,
                {
                    'type': 'object_motion',
                    'observedAtMs': observed_at_ms,
                    'inferenceMs': inference_ms,
                    'objects': active,
                },
            )


def tracker_from_args(args: argparse.Namespace) -> MovementTracker:
    return MovementTracker(
        {label.strip() for label in args.allowed_labels.split(',') if label.strip()},
        minimum_score=min(1.0, max(0.01, args.minimum_score)),
        warmup_ms=min(60_000, max(0, args.warmup_ms)),
    )


def serve_socket(
    socket_path: str,
    detector: LiteRtObjectDetector,
    args: argparse.Namespace,
    model_sha256: str,
) -> None:
    try:
        os.unlink(socket_path)
    except FileNotFoundError:
        pass
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(socket_path)
    os.chmod(socket_path, 0o660)
    server.listen(4)
    detector_lock = threading.Lock()

    def handle(connection: socket.socket) -> None:
        try:
            with connection:
                source = connection.makefile('rb', buffering=0)
                destination = connection.makefile('w', encoding='utf-8', buffering=1)
                process_frames(
                    source,
                    destination,
                    detector,
                    detector_lock,
                    tracker_from_args(args),
                    model_sha256,
                    args.debug_detections,
                )
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:
            print(f'camera-object-detector client: {error}', file=sys.stderr, flush=True)

    while True:
        connection, _ = server.accept()
        threading.Thread(target=handle, args=(connection,), daemon=True).start()


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_test()
        return
    if not args.model or not args.labels:
        raise RuntimeError('--model e --labels sao obrigatorios.')

    os.environ.setdefault('OMP_NUM_THREADS', str(max(1, args.threads)))
    detector = LiteRtObjectDetector(args.model, args.labels, max(1, args.threads))
    model_sha256 = sha256_file(args.model)
    if args.smoke_test:
        detector.detect(bytes(detector.width * detector.height * 3))
        print('camera-object-detector model smoke-test: ok')
        return
    if args.socket:
        serve_socket(args.socket, detector, args, model_sha256)
        return

    tracker = tracker_from_args(args)
    process_frames(
        sys.stdin.buffer,
        sys.stdout,
        detector,
        threading.Lock(),
        tracker,
        model_sha256,
        args.debug_detections,
    )


if __name__ == '__main__':
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as error:
        print(f'camera-object-detector: {error}', file=sys.stderr, flush=True)
        raise
