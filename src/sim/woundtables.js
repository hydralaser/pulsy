// What a weapon does to a man when it gets past his shield. One table for each way of being
// hurt: the point of a spear or a javelin in hand, the edge of a sword, a thrown javelin, a
// heavy blow that does not cut (a blow taken on the armour, being ridden down, a fall), and a
// wound to a man's horse.
//
// Each entry: [weight, grade, where, text, effects]. The grade is how bad it is:
//   0 slight   a graze, a nick, a bruise: it stings, he fights on
//   1 light    a flesh wound that bleeds for a while
//   2 serious  a deep wound, or a part of him that no longer works properly
//   3 grave    a wound that will soon put him on the ground
//   4 mortal   a wound no man lives through
// {w} is the weapon ("spear", "sword", "javelin"); {side} is left or right.
// Effects: eye (he loses that eye), stun (knocked senseless), down (he cannot stand),
// instant (dead before he hits the ground), gut (a belly wound that may kill him days later),
// vessel (it opens a great vessel), mark (what he carries for the rest of his life).

export const WOUND_AREAS = {
  skull: 'head', face: 'head', eye: 'head', ear: 'head', jaw: 'head', neck: 'head',
  shoulder: 'shoulder', armpit: 'shoulder',
  chest: 'torso', ribs: 'torso', belly: 'torso', groin: 'torso',
  back: 'back', buttock: 'back',
  upperarm: 'arm', forearm: 'arm', hand: 'arm',
  thigh: 'leg', knee: 'leg', shin: 'leg', calf: 'leg', foot: 'leg',
};

export const THRUST = [
  // slight
  [4, 0, 'face', 'a {w}-point scoring his cheek'],
  [3, 0, 'face', 'a gash on the brow from a glancing {w}'],
  [2, 0, 'ear', 'a {w}-point nicking his {side} ear'],
  [2, 0, 'neck', 'a scratch along the side of his neck'],
  [4, 0, 'shoulder', 'a {w}-point skidding across his {side} shoulder'],
  [4, 0, 'upperarm', 'a nick in the {side} upper arm'],
  [6, 0, 'forearm', 'a graze along the {side} forearm'],
  [4, 0, 'hand', 'a cut across the knuckles of his {side} hand'],
  [3, 0, 'ribs', 'a {w}-point raking his {side} side'],
  [2, 0, 'chest', 'a shallow prick in the chest'],
  [6, 0, 'thigh', 'a {w}-point grazing his {side} thigh'],
  [3, 0, 'knee', 'a crack on the {side} knee from a {w}-shaft'],
  [4, 0, 'shin', 'a gash down the {side} shin'],
  [2, 0, 'foot', 'the butt-spike of a {w} crushing the toes of his {side} foot'],
  [1, 0, 'buttock', 'a jab in the buttock'],
  [2, 0, 'back', 'a {w}-point scratching his back'],
  // light
  [2, 1, 'face', 'a {w}-thrust splitting his {side} cheek', { mark: 'a scarred face' }],
  [1, 1, 'face', 'a {w}-point through the nose', { mark: 'a broken nose' }],
  [2, 1, 'skull', 'a {w} tearing his scalp open'],
  [1, 1, 'ear', 'the {side} ear half torn off by a {w}', { mark: 'a torn ear' }],
  [3, 1, 'shoulder', 'a {w}-point in the {side} shoulder'],
  [3, 1, 'upperarm', 'a {w} through the meat of the {side} arm'],
  [3, 1, 'forearm', 'a {w}-point through the {side} forearm'],
  [2, 1, 'hand', 'a {w}-point through the palm of the {side} hand'],
  [1, 1, 'chest', 'a {w}-point lodged against a rib'],
  [2, 1, 'ribs', 'a thrust slicing his {side} flank'],
  [4, 1, 'thigh', 'a {w}-point in the {side} thigh'],
  [2, 1, 'calf', 'a {w}-point through the {side} calf'],
  [1, 1, 'foot', 'a {w}-point through the {side} foot'],
  [1, 1, 'buttock', 'a {w} in the buttock'],
  [1, 1, 'back', 'a {w}-point in the back, glancing off the shoulder blade'],
  // serious
  [1, 2, 'jaw', 'a {w}-point smashing his teeth and jaw', { mark: 'missing teeth' }],
  [1, 2, 'eye', 'a {w}-point in the {side} eye', { eye: true, mark: 'one eye' }],
  [1, 2, 'neck', 'a {w}-point in the side of the neck, missing the great vessels'],
  [2, 2, 'shoulder', 'a {w} driven deep into the {side} shoulder'],
  [1, 2, 'armpit', 'a {w}-point under the {side} arm'],
  [1, 2, 'upperarm', 'a {w} through the {side} upper arm, striking the bone', { mark: 'a crooked arm' }],
  [1, 2, 'hand', 'fingers of the {side} hand cut away by a {w}-blade', { mark: 'missing fingers' }],
  [2, 2, 'chest', 'a {w}-point between the ribs'],
  [1, 2, 'belly', 'a {w}-point in the belly, not deep', { gut: true }],
  [1, 2, 'groin', 'a {w}-point in the groin'],
  [2, 2, 'thigh', 'a {w} driven deep into the {side} thigh'],
  [1, 2, 'knee', 'a {w}-point in the {side} knee', { mark: 'a stiff knee' }],
  [1, 2, 'shin', 'a {w}-point in the {side} shin, chipping the bone'],
  [1, 2, 'back', 'a {w} in the back of the shoulder'],
  // grave
  [1, 3, 'eye', 'a {w}-point through the {side} eye', { eye: true, stun: true, mark: 'one eye' }],
  [1, 3, 'jaw', 'a {w}-thrust shattering his jaw', { stun: true, mark: 'a ruined face' }],
  [1, 3, 'chest', 'a {w} through the chest, into the lung'],
  [1, 3, 'belly', 'a {w}-thrust deep in the belly', { gut: true }],
  [0.5, 3, 'groin', 'a {w} through the groin', { vessel: true }],
  [1, 3, 'thigh', 'a {w} through the {side} thigh, opening a great vessel', { vessel: true }],
  [1, 3, 'knee', 'a {w}-point shattering the {side} kneecap', { down: true, mark: 'a lame leg' }],
  [1, 3, 'armpit', 'a {w} driven into the {side} armpit', { vessel: true }],
  [1, 3, 'shoulder', 'a {w} smashing the {side} collarbone', { mark: 'a crooked shoulder' }],
  [1, 3, 'back', 'a {w} in the small of the back'],
  // mortal
  [1.5, 4, 'neck', 'a {w} through the throat', { instant: true }],
  [0.5, 4, 'face', 'a {w}-point driven in through the mouth', { instant: true }],
  [0.5, 4, 'eye', 'a {w} through the eye and into the brain', { instant: true }],
  [0.5, 4, 'skull', 'a {w}-point driven through the skull', { instant: true }],
  [0.5, 4, 'chest', 'a {w} through the heart', { instant: true }],
  [0.5, 4, 'belly', 'a {w} driven through the belly and out of the back'],
  [0.5, 4, 'groin', 'a {w} in the groin, opening the great vessel', { vessel: true }],
  [0.5, 4, 'back', 'a {w} through the back into the kidneys'],
];

export const CUT = [
  // slight
  [8, 0, 'forearm', 'a cut along the {side} forearm'],
  [2, 0, 'hand', 'a slash across the back of the {side} wrist'],
  [3, 0, 'hand', 'a nick to the fingers of the {side} hand'],
  [4, 0, 'upperarm', 'a shallow slash on the {side} upper arm'],
  [3, 0, 'shoulder', 'a blade glancing off the {side} shoulder'],
  [3, 0, 'face', 'a cut across the brow, the blood running into his eyes'],
  [2, 0, 'skull', 'a blade skinning his scalp'],
  [1, 0, 'ear', 'the top of the {side} ear nicked off'],
  [6, 0, 'thigh', 'a slash across the {side} thigh'],
  [2, 0, 'knee', 'a cut above the {side} knee'],
  [3, 0, 'shin', 'a slash down the {side} shin'],
  [3, 0, 'ribs', 'a cut along his {side} side'],
  [2, 0, 'back', 'a slash across the back'],
  [2, 0, 'chest', 'a cut across the chest'],
  [1, 0, 'neck', 'a scratch on the neck'],
  // light
  [4, 1, 'forearm', 'a deep gash in the {side} forearm'],
  [2, 1, 'upperarm', 'a cut to the bone of the {side} upper arm'],
  [2, 1, 'hand', 'the {side} hand laid open by a {w}'],
  [3, 1, 'shoulder', 'a cut into the {side} shoulder'],
  [2, 1, 'face', 'a slash across the face, laying open the cheek', { mark: 'a scarred face' }],
  [1, 1, 'face', 'the nose cut through', { mark: 'a split nose' }],
  [2, 1, 'skull', 'a {w} cutting into the scalp to the bone'],
  [1, 1, 'ear', 'the {side} ear cut off', { mark: 'one ear' }],
  [4, 1, 'thigh', 'a deep cut in the {side} thigh'],
  [2, 1, 'calf', 'a gash across the {side} calf'],
  [2, 1, 'ribs', 'a slash opening his {side} side'],
  [1, 1, 'back', 'a long cut across the back'],
  [1, 1, 'buttock', 'a cut across the buttock'],
  // serious
  [1.5, 2, 'hand', 'fingers of the {side} hand cut off', { mark: 'missing fingers' }],
  [2, 2, 'forearm', 'the {side} forearm hacked to the bone'],
  [1, 2, 'upperarm', 'the {side} arm cut deep above the elbow'],
  [1.5, 2, 'shoulder', 'a chop into the {side} shoulder'],
  [1, 2, 'skull', 'a {w} biting into the skull', { stun: true, mark: 'a dented skull' }],
  [1, 2, 'face', 'a chop across the face, breaking the nose and cheek', { mark: 'a ruined face' }],
  [0.5, 2, 'neck', 'a cut into the side of the neck'],
  [2, 2, 'thigh', 'a cut deep into the {side} thigh'],
  [1, 2, 'knee', 'the {side} knee hacked open', { mark: 'a lame leg' }],
  [1, 2, 'calf', 'the back of the {side} leg cut, the hamstring nicked'],
  [1, 2, 'belly', 'a slash opening the belly wall', { gut: true }],
  [1, 2, 'ribs', 'a chop cracking the ribs'],
  // grave
  [0.6, 3, 'hand', 'the {side} hand cut off at the wrist', { down: true, vessel: true, mark: 'one hand' }],
  [0.6, 3, 'forearm', 'the {side} forearm half severed', { mark: 'a useless arm' }],
  [0.8, 3, 'shoulder', 'the {side} shoulder hacked through to the joint', { mark: 'a useless arm' }],
  [0.8, 3, 'skull', 'a blow splitting his skull', { stun: true, down: true, mark: 'a dented skull' }],
  [0.3, 3, 'face', 'a {w} cut across both eyes', { eye: 'both', mark: 'blindness' }],
  [0.5, 3, 'eye', 'a cut through the {side} eye', { eye: true, mark: 'one eye' }],
  [0.8, 3, 'thigh', 'a cut through the {side} thigh into the great vessel', { vessel: true }],
  [0.8, 3, 'calf', 'the {side} hamstring cut through', { down: true, mark: 'a lame leg' }],
  [0.6, 3, 'belly', 'a chop laying the belly open', { gut: true }],
  [0.4, 3, 'neck', 'a deep cut in the neck', { vessel: true }],
  // mortal
  [1, 4, 'neck', 'a cut through the throat', { instant: true }],
  [0.8, 4, 'skull', 'a chop cleaving the skull', { instant: true }],
  [0.3, 4, 'neck', 'the head half hewn from the shoulders', { instant: true }],
  [0.6, 4, 'belly', 'a {w} through the belly, the bowels spilling'],
  [0.6, 4, 'thigh', 'a cut opening the great vessel of the {side} thigh', { vessel: true }],
  [0.5, 4, 'armpit', 'a thrust under the {side} arm into the chest'],
  [0.4, 4, 'chest', 'a {w} thrust between the ribs into the heart', { instant: true }],
];

export const MISSILE = [
  // slight
  [5, 0, 'forearm', 'a {w} grazing the {side} forearm'],
  [4, 0, 'upperarm', 'a {w} scoring the {side} upper arm'],
  [2, 0, 'hand', 'a {w} nicking the {side} hand'],
  [4, 0, 'shoulder', 'a {w} glancing off the {side} shoulder'],
  [6, 0, 'thigh', 'a {w} grazing the {side} thigh'],
  [4, 0, 'shin', 'a {w} striking the {side} shin a glancing blow'],
  [2, 0, 'knee', 'a {w} bruising the {side} knee'],
  [2, 0, 'foot', 'a {w} skinning the {side} foot'],
  [2, 0, 'face', 'a {w} grazing the cheek'],
  [2, 0, 'skull', 'a {w} rapping off his head'],
  [3, 0, 'ribs', 'a {w} skidding along his {side} side'],
  [3, 0, 'back', 'a spent {w} striking his back'],
  [2, 0, 'buttock', 'a {w} in the buttock, shallow'],
  [1, 0, 'neck', 'a {w} scratching the neck'],
  [2, 0, 'chest', 'a spent {w} thumping into his chest'],
  // light
  [5, 1, 'thigh', 'a {w} stuck in the {side} thigh'],
  [3, 1, 'calf', 'a {w} through the meat of the {side} calf'],
  [3, 1, 'upperarm', 'a {w} stuck in the {side} upper arm'],
  [2, 1, 'forearm', 'a {w} through the {side} forearm'],
  [3, 1, 'shoulder', 'a {w} in the {side} shoulder'],
  [1.5, 1, 'foot', 'a {w} through the {side} foot'],
  [1, 1, 'face', 'a {w} tearing his cheek', { mark: 'a scarred face' }],
  [2, 1, 'back', 'a {w} in the back, shallow'],
  [1.5, 1, 'buttock', 'a {w} lodged in the buttock'],
  [1.5, 1, 'ribs', 'a {w} lodged against a rib'],
  [1, 1, 'hand', 'a {w} through the {side} hand'],
  // serious
  [2, 2, 'knee', 'a {w} in the {side} knee', { mark: 'a stiff knee' }],
  [2, 2, 'thigh', 'a {w} deep in the {side} thigh'],
  [1.5, 2, 'shoulder', 'a {w} deep in the {side} shoulder'],
  [1, 2, 'chest', 'a {w} between the ribs'],
  [1, 2, 'belly', 'a {w} in the belly', { gut: true }],
  [1.5, 2, 'back', 'a {w} deep in the back'],
  [0.5, 2, 'neck', 'a {w} in the side of the neck'],
  [0.5, 2, 'eye', 'a {w} in the {side} eye', { eye: true, mark: 'one eye' }],
  [0.5, 2, 'jaw', 'a {w} smashing his teeth', { mark: 'missing teeth' }],
  [0.7, 2, 'groin', 'a {w} in the groin'],
  [0.6, 2, 'armpit', 'a {w} under the {side} arm'],
  // grave
  [1, 3, 'knee', 'a {w} through the {side} knee', { down: true, mark: 'a lame leg' }],
  [0.6, 3, 'thigh', 'a {w} through the {side} thigh, cutting the great vessel', { vessel: true }],
  [0.8, 3, 'chest', 'a {w} deep in the chest'],
  [0.7, 3, 'belly', 'a {w} through the belly', { gut: true }],
  [0.7, 3, 'back', 'a {w} between the shoulder blades'],
  [0.4, 3, 'eye', 'a {w} through the {side} eye', { eye: true, stun: true, mark: 'one eye' }],
  [0.3, 3, 'face', 'a {w} through both cheeks', { mark: 'a ruined face' }],
  [0.5, 3, 'foot', 'a {w} through the {side} ankle', { down: true, mark: 'a lame leg' }],
  // mortal
  [1, 4, 'neck', 'a {w} through the throat', { instant: true }],
  [0.4, 4, 'eye', 'a {w} in the eye, into the brain', { instant: true }],
  [0.4, 4, 'chest', 'a {w} through the heart', { instant: true }],
  [0.6, 4, 'back', 'a {w} in the back, through the lung'],
  [0.4, 4, 'belly', 'a {w} driven through the belly'],
];

// Heavy blows that do not cut: a blow stopped by the armour that still hurts, being ridden
// down, a fall from a horse.
export const BLUNT = [
  // slight
  [6, 0, 'skull', 'a blow that rings his head like a bell'],
  [4, 0, 'skull', 'a crack on the head that leaves his ears ringing', { stun: true }],
  [6, 0, 'chest', 'a blow on the breast that drives the wind out of him'],
  [5, 0, 'ribs', 'a bruising blow to the {side} ribs'],
  [4, 0, 'shoulder', 'a heavy knock on the {side} shoulder'],
  [4, 0, 'shin', 'a bruised {side} shin'],
  [2, 0, 'face', 'a split lip'],
  [2, 0, 'face', 'a bloody nose'],
  [3, 0, 'forearm', 'a numbing blow to the {side} arm'],
  [2, 0, 'back', 'a heavy blow across the back'],
  [2, 0, 'thigh', 'a dead leg'],
  // light
  [3, 1, 'skull', 'a blow to the head that leaves him dazed', { stun: true }],
  [2, 1, 'face', 'a broken nose', { mark: 'a broken nose' }],
  [1.5, 1, 'jaw', 'teeth knocked out', { mark: 'missing teeth' }],
  [3, 1, 'ribs', 'a cracked rib on the {side} side'],
  [2, 1, 'chest', 'a crushing blow to the breast'],
  [1.5, 1, 'shoulder', 'a wrenched {side} shoulder'],
  [1, 1, 'forearm', 'the {side} wrist sprained'],
  [1.5, 1, 'knee', 'a wrenched {side} knee'],
  [1, 1, 'foot', 'a crushed {side} foot'],
  // serious
  [2, 2, 'skull', 'a blow to the head that knocks him senseless', { stun: true }],
  [2, 2, 'ribs', 'ribs broken on the {side} side'],
  [1, 2, 'forearm', 'the {side} forearm broken', { mark: 'a crooked arm' }],
  [1, 2, 'shoulder', 'the {side} collarbone broken', { mark: 'a crooked shoulder' }],
  [1, 2, 'shin', 'the {side} leg broken', { down: true, mark: 'a lame leg' }],
  [0.7, 2, 'face', 'the cheekbone broken', { mark: 'a crooked face' }],
  // grave
  [1, 3, 'skull', 'his skull cracked', { stun: true, down: true }],
  [0.6, 3, 'chest', 'his chest stove in'],
  [0.3, 3, 'back', 'his back broken', { down: true, mark: 'no use of his legs' }],
  [0.6, 3, 'thigh', 'the {side} thigh bone broken', { down: true, mark: 'a lame leg' }],
  // mortal
  [0.3, 4, 'neck', 'his neck broken', { instant: true }],
  [0.3, 4, 'skull', 'his skull crushed', { instant: true }],
  [0.2, 4, 'chest', 'his chest crushed'],
];

// Wounds to a horse. A horse that is brought down throws its rider.
export const HORSE_WOUNDS = [
  [8, 0, 'horse', "a graze on the horse's flank"],
  [5, 0, 'horse', "a cut on the horse's neck"],
  [4, 0, 'horse', "a knock to the horse's leg"],
  [5, 0, 'horse', "a scratch on the horse's chest"],
  [4, 0, 'horse', "a {w} glancing off the horse's shoulder"],
  [3, 1, 'horse', "a {w} in the horse's chest"],
  [4, 1, 'horse', "a gash on the horse's flank"],
  [3, 1, 'horse', "a cut on the horse's foreleg"],
  [3, 1, 'horse', "a {w} in the horse's rump"],
  [3, 1, 'horse', "a {w} in the horse's neck"],
  [2, 2, 'horse', "a {w} deep in the horse's chest"],
  [1.5, 2, 'horse', "the horse's hamstring cut"],
  [2, 2, 'horse', "a {w} deep in the horse's belly"],
  [1.5, 2, 'horse', "the horse's foreleg laid open"],
  [2, 3, 'horse', 'the horse speared and brought down'],
  [1.5, 3, 'horse', "the horse's leg broken, and it falls"],
  [1.5, 3, 'horse', 'the horse killed under him'],
];

// What a blow that the armour stops looks like.
export const GLANCES = {
  helmet: ['a {w} turned by his helmet', 'a blow ringing on his helmet', 'a {w} denting his helmet'],
  bronze: ['a {w} skidding off his cuirass', 'a {w}-point stopped by his cuirass', 'a blow on his cuirass'],
  linothorax: ['a {w} caught in the linen of his corslet', 'a {w} stopped by his corslet'],
  greaves: ['a {w} glancing off his greave', 'a blow on his greave'],
};
