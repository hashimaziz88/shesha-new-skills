#!/usr/bin/env node
/**
 * pluralize.js — English pluralizer covering the common irregular forms
 * scaffold.js encounters in entity-class names ("Person", "Child", "Category"...).
 *
 * Not a full inflector — just enough to stop emitting "Personss" and "Categorys".
 *
 * Usage:
 *   const pluralize = require('./pluralize.js');
 *   pluralize('Person');   // -> 'People'
 *   pluralize('child');    // -> 'children'
 *   pluralize('Category'); // -> 'Categories'
 *
 * CLI:
 *   node pluralize.js Person Child Category
 */

const IRREGULAR = {
  person: 'people',
  child:  'children',
  man:    'men',
  woman:  'women',
  tooth:  'teeth',
  foot:   'feet',
  mouse:  'mice',
  goose:  'geese',
  ox:     'oxen',
  cactus: 'cacti',
  focus:  'foci',
  fungus: 'fungi',
  nucleus:'nuclei',
  syllabus:'syllabi',
  analysis:'analyses',
  diagnosis:'diagnoses',
  oasis:  'oases',
  thesis: 'theses',
  crisis: 'crises',
  phenomenon:'phenomena',
  criterion: 'criteria',
  datum:  'data',
  medium: 'media',
  status: 'statuses',
  alias:  'aliases',
  bus:    'buses',
  quiz:   'quizzes',
  staff:  'staff',
  sheep:  'sheep',
  fish:   'fish',
  series: 'series',
  species:'species',
  news:   'news',
  information:'information',
  equipment:'equipment',
  software:'software',
  hardware:'hardware'
};

const UNCOUNTABLE = new Set([
  'staff', 'sheep', 'fish', 'series', 'species', 'news', 'information',
  'equipment', 'software', 'hardware', 'feedback', 'progress', 'research'
]);

function pluralize(word) {
  if (!word) return word;
  const lower = word.toLowerCase();

  if (UNCOUNTABLE.has(lower)) return word;
  if (IRREGULAR[lower]) return matchCase(word, IRREGULAR[lower]);

  // Heuristic rules, ordered most-specific first.
  // -is -> -es  (analysis -> analyses)
  if (/sis$/.test(lower)) return word.slice(0, -2) + 'es';
  // -on -> -a   (phenomenon -> phenomena, criterion -> criteria)
  if (/(non|rion)$/.test(lower)) return word.slice(0, -2) + 'a';
  // -us -> -i   (cactus -> cacti)  but NOT -ous/-bus/-pus that already match a stem
  if (/(?:^|[^aeiou])us$/.test(lower) && lower.length > 3) {
    // status->statuses, bus->buses handled by irregulars; default rule below
    return word.slice(0, -2) + 'i';
  }
  // -y after consonant -> -ies (category -> categories)
  if (/[^aeiou]y$/.test(lower)) return word.slice(0, -1) + 'ies';
  // sibilant endings -> -es  (box, bus, gas, buzz, brush, batch)
  if (/(s|x|z|ch|sh)$/.test(lower)) return word + 'es';
  // -fe -> -ves (knife -> knives, life -> lives)
  if (/fe$/.test(lower)) return word.slice(0, -2) + 'ves';
  // -f -> -ves  (leaf -> leaves, wolf -> wolves)  — but NOT roof, proof, chief, brief
  if (/[^aeiou]f$/.test(lower) && !/(oo|ie|ie)f$/.test(lower) && !/(roof|proof|chief|brief|chef)$/.test(lower)) {
    return word.slice(0, -1) + 'ves';
  }

  // Default
  return word + 's';
}

function matchCase(source, plural) {
  if (source === source.toUpperCase()) return plural.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return plural[0].toUpperCase() + plural.slice(1);
  return plural;
}

module.exports = pluralize;
module.exports.pluralize = pluralize;

if (require.main === module) {
  process.argv.slice(2).forEach(w => console.log(`${w} -> ${pluralize(w)}`));
}
