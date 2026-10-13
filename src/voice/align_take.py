#!/usr/bin/env python3
"""Recorded takes of KNOWN text, timed word by word (torchaudio MMS_FA forced alignment; local, offline).

footprint-narration's recordedTakes (src/voice/recorded.js) runs it with a voice kit's Python (.venv-voice, which
has torch and torchaudio) after it has cut each take's silences. The aligner is the kit's own
(scripts/voice/tts_chatterbox.py · align: MMS_FA, the same letters per word), so a recorded line is timed as a
cloned line is; the word check is the kit's scripts/voice/check_words.py (a score per word, low under 0.3, and the
letters greedy CTC heard against the text's) — a report, not a gate. A take is one line read in one go, so it is
aligned whole, not sentence by sentence.

  .venv-voice/bin/python align_take.py --scenes work/scenes.json --out work

scenes.json: {"voiceProfile": id, "scenes": [{"id", "text", "audio" (a 16-bit PCM WAV, relative to --out)}]}
Writes, in --out: timings.json (the kit's shape: per scene id, duration, audio, provider, words [{text, start, end}],
alignment) and word-check.json (check_words.py's shape; a take the aligner could not fit to its text has "failed",
saying why, and the other takes are still aligned).

Local only: nothing is uploaded, and nothing is downloaded. The aligner's weights (about 1.2 GB) come through
torch.hub from dl.fbaipublicfiles.com, which HF_HUB_OFFLINE does not stop, so this script looks for them in
torch.hub's cache first and refuses when they are not there: the kit's setup fetches them once.
"""
import argparse, difflib, json, re, sys, wave
from pathlib import Path
from urllib.parse import urlparse
import numpy as np, torch, torchaudio

LOW = 0.3  # check_words.py · LOW
MMS_FA_URL = 'https://dl.fbaipublicfiles.com/mms/torchaudio/ctc_alignment_mling_uroman/model.pt'  # torchaudio's MMS_FA


def weights_on_disk(bundle):
    """Refuses, before the model is built, when the aligner's weights are not where torch.hub keeps them
    (torch.hub.load_state_dict_from_url: <torch.hub.get_dir()>/checkpoints/<the URL's file name>): it would download."""
    url = getattr(bundle, '_path', MMS_FA_URL)  # torchaudio's own field for the weights' URL
    path = Path(torch.hub.get_dir()) / 'checkpoints' / Path(urlparse(url).path).name
    if not path.is_file():
        raise RuntimeError(f"The MMS_FA aligner weights are not at {path}, and this script never downloads: run the kit's setup once "
                           f"(it fetches them from {url}), then align offline.")


def norm(word):
    """The letters the aligner times for a word (tts_chatterbox.py · norm)."""
    return re.sub(r"[^a-z']", '', word.lower().replace('’', "'"))


def read_wav(path):
    """A 16-bit PCM WAV as mono float samples and its rate (check_words.py's reading)."""
    with wave.open(str(path)) as f:
        sr, n = f.getframerate(), f.getnchannels()
        x = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return (x.reshape(-1, n).mean(axis=1) if n > 1 else x), sr


def align(parts, x, sr, tokens):
    """Each token's (start, end, score), seconds, as tts_chatterbox.py · align times it and check_words.py scores it;
    and the letters greedy CTC heard (check_words.py)."""
    model, tokenizer, aligner, labels, sr16 = parts
    if any(not norm(t).strip("'") for t in tokens):
        raise RuntimeError('a word with no letters to align: say it in words')
    wave16 = torchaudio.functional.resample(torch.from_numpy(x).unsqueeze(0), sr, sr16)
    with torch.inference_mode():
        emission, _ = model(wave16)
        spans = aligner(emission[0], tokenizer([norm(t) for t in tokens]))
    ratio = wave16.size(1) / emission.size(1) / sr16
    timed = []
    for s in spans:
        n = sum(t.end - t.start for t in s)
        timed.append((s[0].start * ratio, s[-1].end * ratio, float(sum(t.score * (t.end - t.start) for t in s) / max(1, n))))
    heard, prev = [], None
    for i in emission[0].argmax(-1).tolist():
        if i != prev and labels[i] not in ('-', '*'):
            heard.append(labels[i])
        prev = i
    return timed, ''.join(heard)


def take(parts, out, scene):
    """One take's timings entry (the kit's shape) and its word check (check_words.py's shape)."""
    tokens = scene['text'].split()
    entry = {'id': scene['id'], 'duration': 0, 'audio': scene['audio'], 'provider': 'recorded', 'words': []}
    try:
        x, sr = read_wav(out / scene['audio'])
        entry['duration'] = len(x) / sr
        timed, heard = align(parts, x, sr, tokens)
    except Exception as e:  # this take does not fit its text: said for it alone, the others are still aligned
        why = str(e) or type(e).__name__
        entry['alignment'] = {'status': 'failed', 'reason': why}
        return entry, {'scene': scene['id'], 'words': len(tokens), 'meanScore': None, 'lowWords': [], 'letterMatch': None, 'failed': why}
    entry['words'] = [{'text': t, 'start': round(a, 4), 'end': round(b, 4)} for t, (a, b, _) in zip(tokens, timed)]
    entry['alignment'] = {'status': 'available', 'method': 'forced-alignment-mms', 'precision': 'forced-aligned to the approved text', 'sampleRate': sr,
        'note': 'A recording of the known text, its silences cut (footprint-narration recordedTakes); word boundaries from torchaudio MMS_FA forced alignment. Local only.'}
    said = ''.join(norm(t) for t in tokens)
    check = {'scene': scene['id'], 'words': len(tokens), 'meanScore': round(float(np.mean([s for _, _, s in timed])), 3),
             'lowWords': [[t, round(s, 2)] for t, (_, _, s) in zip(tokens, timed) if s < LOW],
             'letterMatch': round(difflib.SequenceMatcher(None, said, heard, autojunk=False).ratio(), 3)}
    return entry, check


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--scenes', required=True); p.add_argument('--out', required=True)
    a = p.parse_args()
    out = Path(a.out)
    board = json.loads(Path(a.scenes).read_text())
    bundle = torchaudio.pipelines.MMS_FA
    weights_on_disk(bundle)
    parts = (bundle.get_model(with_star=False), bundle.get_tokenizer(), bundle.get_aligner(), bundle.get_labels(star=None), bundle.sample_rate)
    entries, checks = [], []
    for scene in board['scenes']:
        entry, check = take(parts, out, scene)
        entries.append(entry); checks.append(check)
        print(f"Take aligned: {scene['id']} ({entry['duration']:.2f}s)" if 'failed' not in check else f"Take refused: {scene['id']} ({check['failed']})", flush=True)
    (out / 'timings.json').write_text(json.dumps({'schemaVersion': 1, 'provider': 'recorded', 'voiceProfile': board.get('voiceProfile'), 'scenes': entries}, indent=2))
    (out / 'word-check.json').write_text(json.dumps({'schemaVersion': 1, 'method': 'torchaudio MMS_FA forced alignment of the approved text + greedy CTC letter match',
        'lowThreshold': LOW, 'scenes': checks, 'lowWordCount': sum(len(c['lowWords']) for c in checks),
        'note': 'A report, not a gate: a person listens to every low word before approval.'}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr); sys.exit(1)
