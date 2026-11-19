"""Rank Italian lemmas by frequency.

Inputs (download into a folder and pass it as argv[1]):
  it_50k.txt       https://github.com/hermitdave/FrequencyWords (OpenSubtitles 2018, CC BY-SA 4.0)
  lem-it.txt       https://github.com/michmech/lemmatization-lists (ODbL)
Output: lemmas.txt, one lemma per line, most frequent first.
"""
import sys, collections, pathlib
src = pathlib.Path(sys.argv[1])
form2lem = collections.defaultdict(set)
lemmas = set()
for line in (src / 'lem-it.txt').read_text(encoding='utf-8-sig').splitlines():
    if '\t' not in line: continue
    lem, form = line.split('\t')[:2]
    form2lem[form.lower()].add(lem.lower()); lemmas.add(lem.lower())

# articles, articulated prepositions, clitics and contractions: not useful as cards
SKIP = set('''il lo la i gli le l un una uno un' del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle
nel nello nella nei negli nelle sul sullo sulla sui sugli sulle col coi mi ti si ci vi ne gliela glielo me te se ce ve
c' l' d' s' m' t' v' n' po' ok okay oh ah eh uh hey ehi mh hm'''.split())
rows = []
for line in (src / 'it_50k.txt').read_text(encoding='utf-8').splitlines():
    w, n = line.rsplit(' ', 1); w = w.lower(); n = int(n)
    if w in SKIP or not w.isalpha(): continue
    # a form that is itself a lemma (ora, volto, solo) counts for itself
    cands = {w} if w in lemmas else form2lem.get(w, set())
    cands -= SKIP
    # very common words missing from the lemma table (non, che, per...) count as themselves
    if not cands and len(rows) < 3000: cands = {w}
    if cands: rows.append((w, n, cands))
# prior from unambiguous forms, then give each ambiguous form to its most common candidate
prior = collections.Counter()
for w, n, c in rows:
    if len(c) == 1: prior[next(iter(c))] += n
score = collections.Counter()
for w, n, c in rows:
    score[max(c, key=lambda x: (prior[x], x == w))] += n
out = [w for w, _ in score.most_common(9000)]
pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else 'lemmas.txt').write_text('\n'.join(out) + '\n')
print(len(out), 'lemmas')
