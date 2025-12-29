from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
import os
import glob

from openai import OpenAI

# =========================
# CONFIG (hardcoded)
# =========================
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "<apikey>")
TTS_MODEL = "gpt-4o-mini-tts"
TTS_VOICE = "alloy"
TTS_AUDIO_FORMAT = "mp3"   # keep mp3
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AVATARS_DIR = os.path.join(BASE_DIR, "Avatars")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=OPENAI_API_KEY)

class TTSRequest(BaseModel):
    text: str

@app.get("/health")
def health():
    return {"ok": True, "model": TTS_MODEL, "voice": TTS_VOICE, "format": TTS_AUDIO_FORMAT}

@app.get("/avatars")
def list_avatars() -> Dict[str, Any]:
    avatars: List[Dict[str, str]] = []
    if not os.path.isdir(AVATARS_DIR):
        return {"ok": False, "error": f"Avatars directory not found: {AVATARS_DIR}", "avatars": []}

    subdirs = [d for d in os.listdir(AVATARS_DIR) if os.path.isdir(os.path.join(AVATARS_DIR, d))]
    subdirs.sort(key=lambda s: s.lower())

    for folder in subdirs:
        folder_path = os.path.join(AVATARS_DIR, folder)

        # Prefer avatar_glb.glb if present, otherwise first *.glb
        preferred = os.path.join(folder_path, "avatar_glb.glb")
        if os.path.isfile(preferred):
            glb_file = "avatar_glb.glb"
        else:
            glbs = sorted(glob.glob(os.path.join(folder_path, "*.glb")), key=lambda p: os.path.basename(p).lower())
            if not glbs:
                continue
            glb_file = os.path.basename(glbs[0])

        avatars.append({"id": folder, "label": folder, "glb": glb_file})

    return {"ok": True, "avatars": avatars}

@app.post("/tts")
def tts(req: TTSRequest):
    text = (req.text or "").strip()
    if not text:
        return {"error": "text is required"}

    try:
        audio = client.audio.speech.create(
            model=TTS_MODEL,
            voice=TTS_VOICE,
            input=text,
            format=TTS_AUDIO_FORMAT
        )
        # IMPORTANT: return proper audio content type so browser can play it
        return Response(content=audio.content, media_type="audio/mpeg")

    except TypeError:
        # Some SDK versions don't support "format"
        audio = client.audio.speech.create(
            model=TTS_MODEL,
            voice=TTS_VOICE,
            input=text
        )
        return Response(content=audio.content, media_type="audio/mpeg")

    except Exception as e:
        return {"error": str(e)}
