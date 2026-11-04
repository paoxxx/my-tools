import json, urllib.request, urllib.error, os, sys, datetime, subprocess, re
KEY = os.environ.get("ELEVENLABS_API_KEY"); VID = os.environ.get("ELEVENLABS_VOICE_ID")
MODELS = {"v4": "eleven_v4_eval", "v4o": "eleven_v4", "v3": "eleven_v3", "v2": "eleven_multilingual_v2", "turbo": "eleven_turbo_v2_5"}
model = MODELS.get(sys.argv[1], sys.argv[1]) if len(sys.argv) > 1 else MODELS["v4"]

def req(url, data):
    r = urllib.request.Request(url, data=json.dumps(data).encode(),
        headers={"xi-api-key": KEY, "Content-Type": "application/json"})
    try:
        return urllib.request.urlopen(r, timeout=300).read()
    except urllib.error.HTTPError as e:
        print("出错：", e.code, e.read().decode()[:300]); raise SystemExit

text = subprocess.run(["pbpaste"], capture_output=True, text=True).stdout
text = re.sub(r"\*\*|__", "", text).strip()
text = re.sub(r"\n\s*\n+", "\n\n", text)
if len(text) < 50: print("剪贴板内容太短（", len(text), "字），先复制逐字稿"); raise SystemExit
print("【官方直调实验版】字数：", len(text), "｜模型：", model, "｜生成中……")

audio = req(f"https://api.elevenlabs.io/v1/text-to-speech/{VID}?output_format=mp3_44100_192",
    {"text": text, "model_id": model,
     "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True}})
d = os.path.expanduser("~/Downloads/AI配音"); os.makedirs(d, exist_ok=True)
name = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
mp3, m4a = f"{d}/{name}.mp3", f"{d}/{name}.m4a"
open(mp3, "wb").write(audio)
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", mp3, "-af", "loudnorm=I=-23:TP=-2:LRA=11",
                "-c:a", "aac", "-b:a", "192k", m4a], check=True)
os.remove(mp3)
print("已生成：", name + ".m4a")
subprocess.run(["open", "-R", m4a])
