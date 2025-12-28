import asyncio
import json
import time
import cv2
import mediapipe as mp

from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision as mp_vision
import websockets

# =========================
# CONFIG (hardcoded)
# =========================
# Put the model file in the SAME folder as this .py, or adjust the path.
MODEL_PATH = "pose_landmarker_full.task"

CAMERA_INDEX = 0

WS_HOST = "127.0.0.1"
WS_PORT = 8765

# Send fewer frames if needed (e.g., 15fps)
TARGET_FPS = 15
MIN_SEND_INTERVAL = 1.0 / TARGET_FPS

# Send full pose landmarks (33) so the browser has everything it needs.
SEND_ALL_LANDMARKS = True

# If you ever want to send only selected joints, set SEND_ALL_LANDMARKS=False
# and edit these ids:
LANDMARK_IDS = list(range(33))

# =========================
# Shared state
# =========================
latest_payload = None
last_sent_ts = 0.0


def _lm_to_dict(lm):
    return {
        "x": float(lm.x),
        "y": float(lm.y),
        "z": float(getattr(lm, "z", 0.0)),
        "v": float(getattr(lm, "visibility", 1.0)),
    }


def build_payload(pose_landmarks):
    """
    pose_landmarks: list of 33 landmarks (normalized).
    Return JSON dict.
    """
    data = {"_ts": time.time(), "landmarks": {}}

    if SEND_ALL_LANDMARKS:
        for idx, lm in enumerate(pose_landmarks):
            data["landmarks"][str(idx)] = _lm_to_dict(lm)
    else:
        for idx in LANDMARK_IDS:
            lm = pose_landmarks[idx]
            data["landmarks"][str(idx)] = _lm_to_dict(lm)

    return data


async def ws_handler(websocket):
    """
    Continuously push latest pose to the browser.
    """
    global last_sent_ts
    await websocket.send(json.dumps({"hello": "connected", "type": "pose_server"}))

    while True:
        await asyncio.sleep(0.001)

        if latest_payload is None:
            continue

        now = time.time()
        if now - last_sent_ts < MIN_SEND_INTERVAL:
            continue

        last_sent_ts = now
        try:
            await websocket.send(json.dumps(latest_payload))
        except websockets.ConnectionClosed:
            break


async def run_pose_loop():
    """
    Runs MediaPipe pose detection and updates latest_payload.
    Also shows a camera window for debugging.
    """
    global latest_payload

    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam. Try changing CAMERA_INDEX = 0/1/2.")

    options = mp_vision.PoseLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=1
    )

    with mp_vision.PoseLandmarker.create_from_options(options) as landmarker:
        print(f"✅ Pose loop started. WebSocket: ws://{WS_HOST}:{WS_PORT}")
        print("Press ESC in the camera window to quit.")

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=rgb
            )

            timestamp_ms = int(time.time() * 1000)
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            if result.pose_landmarks:
                pose_lms = result.pose_landmarks[0]
                latest_payload = build_payload(pose_lms)
                cv2.putText(frame, "Pose: OK (sending)", (20, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            else:
                latest_payload = None
                cv2.putText(frame, "Pose: NOT DETECTED", (20, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

            cv2.imshow("Python Pose (WebSocket Sender)", frame)
            key = cv2.waitKey(1) & 0xFF
            if key == 27:  # ESC
                break

    cap.release()
    cv2.destroyAllWindows()


async def main():
    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT)
    try:
        await run_pose_loop()
    finally:
        server.close()
        await server.wait_closed()


if __name__ == "__main__":
    asyncio.run(main())
