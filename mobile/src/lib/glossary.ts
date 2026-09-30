// LRN-07 glossary of birding terms. `part` links a term to a spot on the 3D bird (Bird3D).

export type Part =
  | 'crown'
  | 'forehead'
  | 'nape'
  | 'mantle'
  | 'back'
  | 'rump'
  | 'tail'
  | 'coverts'
  | 'primaries'
  | 'secondaries'
  | 'throat'
  | 'breast'
  | 'belly'
  | 'flanks'
  | 'undertail'
  | 'bill'
  | 'eyering'
  | 'supercilium'
  | 'lores'
  | 'legs';

export type Term = { term: string; group: 'Body' | 'Plumage & markings' | 'Behaviour' | 'Field craft'; text: string; part?: Part };

const RAW: Term[] = [
  // Body (bird topography)
  { term: 'Crown', group: 'Body', part: 'crown', text: 'The top of the head. A contrasting crown or cap is a quick clue, as in many warblers and sunbirds.' },
  { term: 'Forehead', group: 'Body', part: 'forehead', text: 'The front of the head, just above the bill.' },
  { term: 'Nape', group: 'Body', part: 'nape', text: 'The back of the neck, between the crown and the mantle.' },
  { term: 'Mantle', group: 'Body', part: 'mantle', text: 'The upper back, between the nape and the back. Often a different shade from the wings.' },
  { term: 'Back', group: 'Body', part: 'back', text: 'The middle of the upperparts, between the mantle and the rump.' },
  { term: 'Rump', group: 'Body', part: 'rump', text: 'The lower back just above the tail. A pale or bright rump often flashes in flight.' },
  { term: 'Tail', group: 'Body', part: 'tail', text: 'Length, shape (forked, square, rounded, graduated) and white edges are all useful marks.' },
  { term: 'Wing coverts', group: 'Body', part: 'coverts', text: 'The small feathers covering the bases of the flight feathers. Pale tips on them make wing bars.' },
  { term: 'Primaries', group: 'Body', part: 'primaries', text: 'The long outer flight feathers at the wing tip. How far they stick out past the tertials (the primary projection) separates many lookalikes.' },
  { term: 'Secondaries', group: 'Body', part: 'secondaries', text: 'The inner flight feathers along the trailing edge of the wing.' },
  { term: 'Throat', group: 'Body', part: 'throat', text: 'Below the bill and chin. A coloured throat patch marks many sunbirds and bee-eaters.' },
  { term: 'Breast', group: 'Body', part: 'breast', text: 'The upper underparts. Look for bands, streaks or spots.' },
  { term: 'Belly', group: 'Body', part: 'belly', text: 'The lower underparts, between the breast and the undertail.' },
  { term: 'Flanks', group: 'Body', part: 'flanks', text: 'The sides of the body below the wings. Often barred or washed with colour.' },
  { term: 'Undertail coverts', group: 'Body', part: 'undertail', text: 'Feathers under the base of the tail. Yellow or red undertails pick out several bulbuls and waxbills.' },
  { term: 'Bill', group: 'Body', part: 'bill', text: 'Shape tells you how a bird feeds: conical for seeds, thin for insects, hooked for meat, long and curved for nectar.' },
  { term: 'Eye-ring', group: 'Body', part: 'eyering', text: 'A ring of feathers or bare skin around the eye. Pale eye-rings stand out on white-eyes and some flycatchers.' },
  { term: 'Supercilium (eyebrow)', group: 'Body', part: 'supercilium', text: 'A stripe above the eye. Its colour and length separate many warblers and pipits.' },
  { term: 'Lores', group: 'Body', part: 'lores', text: 'The small area between the eye and the bill.' },
  { term: 'Tarsus (leg)', group: 'Body', part: 'legs', text: 'The visible part of the leg. Leg colour is a key mark for waders and egrets.' },
  { term: 'Mandible', group: 'Body', part: 'bill', text: 'Each half of the bill: the upper and the lower mandible. A different-coloured lower mandible is a useful mark.' },
  { term: 'Upperparts / underparts', group: 'Body', text: 'Everything on top of the bird (crown to tail) versus everything underneath (chin to undertail).' },

  // Plumage & markings
  { term: 'Plumage', group: 'Plumage & markings', text: 'All of a bird’s feathers. Many birds have different plumages by age, sex and season.' },
  { term: 'Breeding plumage', group: 'Plumage & markings', text: 'The brighter plumage worn while breeding. In Sierra Leone many weavers and bishops turn bright in the rainy season.' },
  { term: 'Non-breeding plumage', group: 'Plumage & markings', text: 'The duller plumage worn outside the breeding season. Some males then look like females.' },
  { term: 'Eclipse plumage', group: 'Plumage & markings', text: 'A short, drab plumage some males (ducks, some sunbirds) wear after breeding.' },
  { term: 'Juvenile', group: 'Plumage & markings', text: 'A young bird in its first set of true feathers, often plainer or more scaly than adults.' },
  { term: 'Immature', group: 'Plumage & markings', text: 'Any plumage before adult plumage, including juvenile. Large eagles can take years to look adult.' },
  { term: 'Moult', group: 'Plumage & markings', text: 'Replacing old feathers with new ones. Moulting birds can look patchy and confusing.' },
  { term: 'Sexual dimorphism', group: 'Plumage & markings', text: 'When males and females look different, like sunbirds. When they look alike, as in bulbuls, the sexes are “similar”.' },
  { term: 'Wing bar', group: 'Plumage & markings', text: 'A pale line across the folded wing made by pale tips to the coverts.' },
  { term: 'Eye stripe', group: 'Plumage & markings', text: 'A dark line through the eye, often under a pale supercilium.' },
  { term: 'Streaked / barred / spotted', group: 'Plumage & markings', text: 'Streaks run lengthwise down the body, bars run across it, spots are dots.' },
  { term: 'Casque', group: 'Plumage & markings', text: 'The helmet-like growth on top of a hornbill’s bill. Its shape helps tell hornbills apart.' },
  { term: 'Speculum', group: 'Plumage & markings', text: 'A glossy, coloured patch on the secondaries of many ducks.' },

  // Behaviour
  { term: 'Song', group: 'Behaviour', text: 'A longer, patterned sound, mostly by males to hold territory or attract a mate.' },
  { term: 'Call', group: 'Behaviour', text: 'A short sound for contact, alarm or keeping a flock together. Both sexes call all year.' },
  { term: 'Alarm call', group: 'Behaviour', text: 'A harsh or urgent call warning of danger. A mixed chorus of alarms can lead you to an owl or snake.' },
  { term: 'Flight call', group: 'Behaviour', text: 'A call given in flight. Waders and many migrants are identified by it.' },
  { term: 'Hawking', group: 'Behaviour', text: 'Catching insects in the air from a perch, like bee-eaters and flycatchers.' },
  { term: 'Hovering', group: 'Behaviour', text: 'Staying in one spot in the air with fast wingbeats, like the Pied Kingfisher over water.' },
  { term: 'Mixed-species flock', group: 'Behaviour', text: 'Different species foraging together. In forest these “bird waves” pass quickly; stay still and let them come.' },
  { term: 'Resident', group: 'Behaviour', text: 'A species present all year. The month chart on a bird’s page shows it recorded year-round.' },
  { term: 'Migrant', group: 'Behaviour', text: 'A species that moves with the seasons. Palearctic migrants spend the dry season in Sierra Leone.' },

  // Field craft
  { term: 'Jizz (GISS)', group: 'Field craft', text: 'The overall impression of a bird: size, shape, posture and movement. Experienced birders often name a bird by jizz before seeing details.' },
  { term: 'Field mark', group: 'Field craft', text: 'A feature that helps identify a bird in the field: a wing bar, an eye-ring, a call.' },
  { term: 'Lifer', group: 'Field craft', text: 'A species you see for the first time. It goes on your life list.' },
  { term: 'Pishing', group: 'Field craft', text: 'Making a soft “pish” sound to draw curious small birds out. Use sparingly; playback of songs even more so.' },
  { term: 'Endemic', group: 'Field craft', text: 'Found only in one area. Upper Guinea forest endemics are a special reason to bird Sierra Leone.' },
];

export const TERMS: Term[] = [...RAW].sort((a, b) => a.term.localeCompare(b.term));

export const GROUPS = ['Body', 'Plumage & markings', 'Behaviour', 'Field craft'] as const;

/** Case-insensitive search in term and text. */
export const searchTerms = (q: string, group?: Term['group']) =>
  TERMS.filter(
    (t) => (!group || t.group === group) && (!q.trim() || `${t.term} ${t.text}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
