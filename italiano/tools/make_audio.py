"""Generate offline audio packs with Piper TTS.

  pip install piper-tts        (ffmpeg must be installed)
  node tools/list_speech.mjs > texts.json
  python3 tools/make_audio.py texts.json it_IT-serena-high.onnx audio/

Voice: Piper "it_IT-serena-high" (dataset CC BY 4.0, https://huggingface.co/rhasspy/piper-voices).
Each pack (A1.mp3, ..., verbs.mp3) is a plain concatenation of short standalone MP3 files;
audio/index.json maps each text to [pack, byte offset, byte length], so the app can slice
one clip out and play it. Clips are cached in a work folder, so re-runs only make new ones.
"""
import hashlib, io, json, multiprocessing as mp, pathlib, subprocess, sys, wave

texts_file, model, out_dir = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3])
work = pathlib.Path(sys.argv[4] if len(sys.argv) > 4 else out_dir.parent / 'audio-work')
work.mkdir(parents=True, exist_ok=True); out_dir.mkdir(parents=True, exist_ok=True)
key = lambda t: hashlib.sha1(t.encode()).hexdigest()[:16]
voice = None

def init():
    global voice
    # one thread per worker: four workers each grabbing every core is far slower
    import onnxruntime as ort
    orig = ort.InferenceSession
    def single(path, sess_options=None, **kw):
        so = sess_options or ort.SessionOptions()
        so.intra_op_num_threads = 1; so.inter_op_num_threads = 1
        return orig(path, sess_options=so, **kw)
    ort.InferenceSession = single
    from piper import PiperVoice
    voice = PiperVoice.load(model)

def make(text):
    dst = work / (key(text) + '.mp3')
    if dst.exists(): return
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w: voice.synthesize_wav(text, w)
    # trim leading/trailing silence, keep a short tail so the last consonant isn't clipped
    cmd = ['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-af',
           'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.08',
           '-ac', '1', '-ar', '22050', '-b:a', '32k', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '0', '-f', 'mp3', str(dst)]
    subprocess.run(cmd, input=buf.getvalue(), check=True)

if __name__ == '__main__':
    packs = json.load(open(texts_file))
    todo = sorted({t for ts in packs.values() for t in ts})
    with mp.Pool(4, initializer=init) as pool:
        for i, _ in enumerate(pool.imap_unordered(make, todo, chunksize=16)):
            if i % 500 == 0: print(f'{i}/{len(todo)}', flush=True)
    index = {'packs': [], 't': {}}
    for p, (name, ts) in enumerate(packs.items()):
        index['packs'].append(name + '.mp3')
        with open(out_dir / (name + '.mp3'), 'wb') as f:
            for t in dict.fromkeys(ts):
                if t in index['t']: continue
                data = (work / (key(t) + '.mp3')).read_bytes()
                index['t'][t] = [p, f.tell(), len(data)]
                f.write(data)
    index['bytes'] = sum((out_dir / n).stat().st_size for n in index['packs'])
    (out_dir / 'index.json').write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')))
    for n in index['packs']: print(n, round((out_dir / n).stat().st_size / 1e6, 1), 'MB')
