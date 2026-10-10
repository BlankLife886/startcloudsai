import { ASTRAL_SAMPLE } from './astral-design-layers.js';

// The gallery and a user's version start with the same authored composition.
// Image assets are supplied separately so replacing the subject retains the template.
export const ASTRAL_TEMPLATE_SETTINGS = Object.freeze({
  title: ASTRAL_SAMPLE.title,
  subtitle: ASTRAL_SAMPLE.subtitle,
  name: ASTRAL_SAMPLE.name,
  number: ASTRAL_SAMPLE.number,
  collection: ASTRAL_SAMPLE.collection,
  edition: ASTRAL_SAMPLE.edition,
  foil: 'gold', foilStrength: .65, depth: 1,
  paused: false, flipped: false, pattern: 'flow', autoOrbit: false,
  exploded: false, orbitStyle: 'orbit', shineStyle: 'sweep',
  subjectScale: 1, tilt: .55,
});
