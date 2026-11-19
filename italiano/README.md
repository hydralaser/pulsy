# Ripasso: Italian spaced repetition

A touch-first flashcard app for Italian vocabulary and verb conjugation. No build step and no server: progress is stored in the browser.

## Use it
- **Hosted (offline-capable):** serve this folder over HTTPS (e.g. GitHub Pages) and "Add to Home Screen". `index.html` loads the ES modules and registers `sw.js` for offline use.
- **Single file:** `python3 build.py` writes `dist/ripasso.html`, which has everything inlined and also works when opened straight from disk.

## How it works
- **Cards:** 14 word sets (~350 words, ordered roughly by frequency) and 40 verbs × 6 tenses × 6 persons. Turn sets on under Words / Verbs to pull new cards from them.
- **Questions:** multiple choice. Word cards rotate between Italian→English, English→Italian and listening (hear it, pick the spelling). Wrong options mix random words with sound-alikes (penna/pena, nonno/nono, capelli/cappelli, sette/sete) drawn from the deck and a list of real "confusable" words. Cards you know well get more sound-alikes.
- **Verb distractors:** other persons of the same tense, the same person in other tenses, and for passato prossimo the wrong auxiliary (*ho andato*).
- **Scheduling:** SM-2 style intervals, graded from your answer with no extra taps: wrong = again, slow = hard, quick = good. New cards are introduced first, then need two correct answers in a session before they graduate.
- **After a mistake:** the feedback highlights the letters that differ and says what the option you picked actually means.
- **Bringing progress over:** paste words you know (Settings), or open a set and "Mark all as known". Known cards are scheduled for a check-up over the next week or so.

## Files
`data.js` word lists, confusables, verbs and irregular forms · `engine.js` conjugation rules, distractors, scheduler · `app.js` UI · `styles.css`.
