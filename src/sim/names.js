// The first matchup is Delion (424 BC): Athenians against the Boeotian league.
export const SIDES = [
  {
    name: 'Athenian hoplites',
    short: 'Athenians',
    adjective: 'Athenian',
    names: ['Aischines', 'Alkimos', 'Antiphon', 'Archias', 'Aristeides', 'Aristokles', 'Charmides', 'Chremes', 'Demeas',
      'Diodotos', 'Euphron', 'Eukleides', 'Glaukon', 'Hagnon', 'Hermon', 'Hippias', 'Kallias', 'Kleitos', 'Kriton',
      'Ktesias', 'Lykon', 'Lysias', 'Menon', 'Mnesikles', 'Nikias', 'Nikomachos', 'Pamphilos', 'Phaidros', 'Philon',
      'Polemarchos', 'Sosias', 'Stratokles', 'Theron', 'Thrasyllos', 'Timon', 'Xanthias', 'Agathon', 'Andokides',
      'Kephalos', 'Leon', 'Melanthios', 'Sostratos', 'Telekles', 'Myron', 'Laches', 'Phormion', 'Euthydemos', 'Kleinias',
      'Hipponikos', 'Kallikrates', 'Demokles', 'Euktemon', 'Isodemos', 'Lysikles', 'Mantitheos', 'Nausikles', 'Pythodoros',
      'Sokles', 'Thoukydides', 'Xenokles', 'Diphilos', 'Euboulos', 'Habron', 'Kritias', 'Lykourgos', 'Mnesiphilos', 'Philokles', 'Teisias'],
    origins: ['Acharnai', 'Marathon', 'Kephisia', 'Eleusis', 'Thorikos', 'Paiania', 'Rhamnous', 'Kydathenaion',
      'Alopeke', 'Sounion', 'Anaphlystos', 'Aphidna', 'Kollytos', 'Melite', 'Piraeus'],
    // Athenian hoplites stood by tribe.
    contingents: ['Erechtheis', 'Aigeis', 'Pandionis', 'Leontis', 'Akamantis', 'Oineis', 'Kekropis', 'Hippothontis', 'Aiantis', 'Antiochis'],
  },
  {
    name: 'Boeotian hoplites',
    short: 'Boeotians',
    adjective: 'Boeotian',
    names: ['Pagondas', 'Ismenias', 'Leontiades', 'Asopodoros', 'Kephisodoros', 'Daiphantos', 'Mnasippos', 'Phaidondas',
      'Kleandros', 'Damokritos', 'Androkleidas', 'Hypatodoros', 'Timolaos', 'Eumaridas', 'Koiratadas', 'Arkesos',
      'Theagenes', 'Pelopidas', 'Gorgidas', 'Charon', 'Phillidas', 'Melon', 'Amphion', 'Kadmos', 'Lasthenes',
      'Hippias', 'Damon', 'Orsilochos', 'Polykrates', 'Xenokrates', 'Antigenes', 'Eupalinos', 'Thrasyleon',
      'Kallon', 'Dioxippos', 'Teisias', 'Peithias', 'Mnason', 'Aristion', 'Simmias', 'Kebes', 'Philolaos',
      'Epameinon', 'Hermaios', 'Kraton', 'Lykinos', 'Nikasias', 'Onasimos',
      'Aristogeiton', 'Boiotos', 'Damophilos', 'Eumelos', 'Hagesias', 'Ismenodoros', 'Kallias', 'Lamios', 'Menekrates',
      'Neon', 'Olympichos', 'Pherenikos', 'Sotion', 'Timokles', 'Xenodokos', 'Zopyros', 'Antikles', 'Dorotheos', 'Euagoras', 'Hippostratos'],
    origins: ['Thebes', 'Thespiai', 'Tanagra', 'Orchomenos', 'Koroneia', 'Haliartos', 'Lebadeia', 'Kopai',
      'Akraiphia', 'Chaironeia', 'Anthedon', 'Hyettos'],
    // Boeotians stood by city; each contingent's men all come from it.
    contingents: ['Thebans', 'Thespians', 'Tanagrans', 'Orchomenians', 'Koroneians', 'Haliartians', 'Lebadeians', 'Kopaians'],
    contingentTowns: { Thebans: 'Thebes', Thespians: 'Thespiai', Tanagrans: 'Tanagra', Orchomenians: 'Orchomenos', Koroneians: 'Koroneia', Haliartians: 'Haliartos', Lebadeians: 'Lebadeia', Kopaians: 'Kopai' },
  },
];
