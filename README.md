# 🏋️ 3D Coach – AI Fitness App

An **AI-powered fitness coaching web app** that uses **computer vision + a 3D avatar** to:
- Track your body using **MediaPipe Pose**
- Animate a **3D avatar** to mimic your movements in real time
- **Count reps intelligently**
- Give **real-time visual + voice feedback**
- Support **English & Arabic (MSA)**
- Run mostly **locally**

---

## 📁 Project Structure

```
MyAvatarApp/
├─ index.html
├─ pose_ws_server.py
├─ tts_server.py
├─ pose_landmarker_full.task
└─ Avatars/
   ├─ Avatar1/
   ├─ Avatar2/
   └─ Avatar3/
```

---

## ✨ Features

- MediaPipe Pose tracking (33 landmarks)
- Three.js avatar mirroring
- Smart rep counting with smoothing & debounce
- Visual coaching (targets, skeleton, progress bar)
- Voice coaching (EN / AR)
- Modular exercise system

---

## ⚙️ Installation

### Python requirements
```bash
pip install fastapi uvicorn websockets mediapipe opencv-python openai
```

### Optional: create venv
```bash
python -m venv venv
venv\Scripts\activate
```

---

## ▶️ How to Run

### Start TTS server
```bash
set OPENAI_API_KEY=your_key_here
python tts_server.py
```

### Start frontend server
```bash
python -m http.server 8000
```

Open:
```
http://localhost:8000/index.html
```

---

## 🏃 Exercises

- Left Lateral Raise
- Left Front Raise
- Left Bicep Curl

---

## ➕ Add a New Exercise

1. Add to `EXERCISES` array in `index.html`
2. Implement logic in `updateExercise()`
3. Define:
   - progress `t`
   - target box
   - UP/DOWN thresholds

---

## 🎭 Add an Avatar

1. Put `.glb` in `Avatars/AvatarX/`
2. Add entry in `AVATARS` array
3. Ensure standard bone names

---

## 🛠️ Troubleshooting

- Use `localhost`, not `file://`
- Ensure camera permissions
- Stand fully in frame

---

## 👤 Author

Built by Omar
