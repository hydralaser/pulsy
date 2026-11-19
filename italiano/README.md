# Ripasso: Italian spaced repetition

A touch-first flashcard app for Italian vocabulary and verb conjugation. No build step and no server: progress is stored in the browser.

## Use it
- **Hosted (offline-capable):** serve this folder over HTTPS (e.g. GitHub Pages) and "Add to Home Screen". `index.html` loads the ES modules and registers `sw.js` for offline use.
- **Single file:** `python3 build.py` writes `dist/ripasso.html`, which has everything inlined and also works when opened straight from disk.

## How it works
- **Cards:** 6,509 words in six levels (A1 548, A2 933, B1 1561, B2 1783, C1 1073, C2 611, matching Linguno's WordBank sizes), each split into parts of ~100, plus 40 verbs × 6 tenses × 6 persons. Turn parts on under Words / Verbs to pull new cards from them.
- **Levels are frequency bands, not an official CEFR list:** words are ranked by how often they appear in film subtitles, so the bands won't match Linguno word-for-word, and subtitle language over-ranks some words (police, crime). Everyday basics (days, numbers, colours, food) are pulled into A1/A2.
- **Questions:** multiple choice. Word cards rotate between Italian→English, English→Italian and listening (hear it, pick the spelling). Wrong options mix random words with sound-alikes (penna/pena, nonno/nono, capelli/cappelli, sette/sete) drawn from the deck and a list of real "confusable" words. Cards you know well get more sound-alikes.
- **Verb distractors:** other persons of the same tense, the same person in other tenses, and for passato prossimo the wrong auxiliary (*ho andato*).
- **Scheduling:** SM-2 style intervals, graded from your answer with no extra taps: wrong = again, slow = hard, quick = good. New cards are introduced first, then need two correct answers in a session before they graduate.
- **After a mistake:** the feedback highlights the letters that differ and says what the option you picked actually means.
- **Bringing progress over:** "Mark A1 as known" on the Words page, mark a single part, or paste words you know (Settings). Check-ups are spread so you get at most ~25–35 a day.
- **Sound:** uses the device's built-in text-to-speech. Settings → Sound shows which voice is in use and has a test button.

## Rebuilding the word bank
1. Download `it_50k.txt` from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 4.0) and `lemmatization-it.txt` from [lemmatization-lists](https://github.com/michmech/lemmatization-lists) (ODbL, saved as `lem-it.txt`) into a folder.
2. `python3 tools/rank_lemmas.py <folder> lemmas.txt` ranks lemmas by frequency.
3. Glosses are hand-written in `tools/gloss/*.txt` in rank order; `python3 tools/build_bank.py` writes `words.js`.

## Files
`words.js` generated word bank · `data.js` confusables, verbs and irregular forms · `engine.js` conjugation rules, distractors, scheduler · `app.js` UI · `styles.css`.
