import os
import io
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel

from openai import OpenAI

# =========================
# CONFIG
# =========================
# Put your real key in environment variable OPENAI_API_KEY
# Placeholder requested:
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "<apikey>")

TTS_MODEL = "gpt-4o-mini-tts"
TTS_VOICE = "alloy"

client = OpenAI(api_key=OPENAI_API_KEY)

app = FastAPI(title="Fitness App TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    model: Optional[str] = None

@app.get("/health")
def health():
    return {"ok": True, "model": TTS_MODEL, "voice": TTS_VOICE}

def _audio_response_to_bytes(resp) -> bytes:
    # Works across multiple openai-python versions
    if hasattr(resp, "iter_bytes"):
        buf = io.BytesIO()
        for chunk in resp.iter_bytes():
            buf.write(chunk)
        return buf.getvalue()

    if hasattr(resp, "content") and isinstance(resp.content, (bytes, bytearray)):
        return bytes(resp.content)

    if hasattr(resp, "read"):
        return resp.read()

    return bytes(resp)

@app.post("/tts")
def tts(req: TTSRequest):
    if not req.text or not req.text.strip():
        return JSONResponse({"error": "Empty text"}, status_code=400)

    if OPENAI_API_KEY.strip() == "<apikey>":
        return JSONResponse(
            {"error": "OPENAI_API_KEY is not set. Set it as an environment variable (do not keep <apikey>)."},
            status_code=500,
        )

    model = req.model or TTS_MODEL
    voice = req.voice or TTS_VOICE

    try:
        # Your SDK doesn't support 'format', so we omit it.
        resp = client.audio.speech.create(
            model=model,
            voice=voice,
            input=req.text,
        )
        data = _audio_response_to_bytes(resp)
        return Response(content=data, media_type="audio/mpeg")  # usually mp3
    except Exception as e:
        print("TTS ERROR:", repr(e))
        return JSONResponse({"error": str(e)}, status_code=500)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)
