# Ripasso: Italian spaced repetition

A touch-first flashcard app for Italian vocabulary and verb conjugation. No build step and no server: progress is stored in the browser.

## Use it offline (GitHub Pages)
1. Merge this folder into `main`.
2. Repo **Settings → Pages → Source: GitHub Actions**. The `Ripasso on GitHub Pages` workflow publishes `italiano/` on every push to `main` (or run it by hand from the Actions tab). Free GitHub accounts need the repo to be public for Pages.
3. Open the Pages URL on your phone, **Add to Home Screen**, then in the app go to **Settings → Sound → Download all audio**.

After that the app, the word bank and all recordings work with no connection. Progress stays on the phone (use Settings → Backup to move it).

The single-file build (`python3 build.py` → `dist/`) is used for the claude.ai preview, which needs a connection.

## How it works
- **Cards:** 6,509 words in six levels (A1 548, A2 933, B1 1561, B2 1783, C1 1073, C2 611, matching Linguno's WordBank sizes), each split into parts of ~100, plus 40 verbs × 6 tenses × 6 persons. Turn parts on under Words / Verbs to pull new cards from them.
- **Levels are frequency bands, not an official CEFR list:** words are ranked by how often they appear in film subtitles, so the bands won't match Linguno word-for-word, and subtitle language over-ranks some words (police, crime). Everyday basics (days, numbers, colours, food) are pulled into A1/A2.
- **Questions:** multiple choice. Word cards rotate between Italian→English, English→Italian and listening (hear it, pick the spelling). Wrong options mix random words with sound-alikes (penna/pena, nonno/nono, capelli/cappelli, sette/sete) drawn from the deck and a list of real "confusable" words. Cards you know well get more sound-alikes.
- **Verb distractors:** other persons of the same tense, the same person in other tenses, and for passato prossimo the wrong auxiliary (*ho andato*).
- **Scheduling:** SM-2 style intervals, graded from your answer with no extra taps: wrong = again, slow = hard, quick = good. New cards are introduced first, then need two correct answers in a session before they graduate.
- **After a mistake:** the feedback highlights the letters that differ and says what the option you picked actually means.
- **Bringing progress over:** "Mark A1 as known" on the Words page, mark a single part, or paste words you know (Settings). Check-ups are spread so you get at most ~25–35 a day.
- **Sound:** every word and verb form has a recorded clip (Piper TTS, voice "it_IT-serena-high", dataset CC BY 4.0), packed one file per level in `audio/`. Custom words fall back to the device's voice.

## Rebuilding the word bank
1. Download `it_50k.txt` from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 4.0) and `lemmatization-it.txt` from [lemmatization-lists](https://github.com/michmech/lemmatization-lists) (ODbL, saved as `lem-it.txt`) into a folder.
2. `python3 tools/rank_lemmas.py <folder> lemmas.txt` ranks lemmas by frequency.
3. Glosses are hand-written in `tools/gloss/*.txt` in rank order; `python3 tools/build_bank.py` writes `words.js`.

## Rebuilding the audio
```
pip install piper-tts                                  # plus ffmpeg
# voice files from https://huggingface.co/rhasspy/piper-voices (it/it_IT/serena/high)
node tools/list_speech.mjs > texts.json
python3 tools/make_audio.py texts.json it_IT-serena-high.onnx audio/
```

## Files
`words.js` generated word bank · `data.js` confusables, verbs and irregular forms · `engine.js` conjugation rules, distractors, scheduler · `app.js` UI · `styles.css`.
