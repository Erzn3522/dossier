// A check on the language the model says a posting is written in. Small
// local models answer with the company's country ("Danish" for an English
// posting from a Danish company), and the letter and the email follow that
// answer. Counting each language's most common short words is enough to
// tell which one the text itself is in.

const STOPWORDS: Record<string, readonly string[]> = {
  English: ["the", "and", "you", "with", "for", "our", "are", "will", "your", "have", "this", "that", "to", "of", "in", "is", "we", "be", "an", "as"],
  German: ["und", "der", "die", "das", "mit", "für", "wir", "sie", "ist", "ein", "eine", "nicht", "auf", "bei", "zu", "den", "dem", "ihre", "du", "von"],
  Dutch: ["de", "het", "een", "en", "van", "je", "wij", "met", "voor", "zijn", "op", "niet", "ons", "jouw", "jij", "bij", "naar", "wat", "ook", "dat"],
  Danish: ["og", "af", "til", "at", "er", "en", "et", "det", "vi", "med", "på", "som", "du", "har", "ikke", "vores", "hos", "eller", "kan", "dig"],
  Swedish: ["och", "att", "är", "en", "ett", "det", "vi", "med", "för", "på", "som", "du", "har", "inte", "av", "till", "vår", "hos", "eller", "dig"],
  Norwegian: ["og", "er", "det", "vi", "med", "for", "på", "som", "du", "har", "ikke", "av", "til", "en", "vår", "hos", "eller", "kan", "deg", "å"],
  French: ["le", "la", "les", "et", "des", "une", "un", "vous", "nous", "pour", "avec", "est", "dans", "du", "en", "sur", "votre", "au", "qui", "de"],
  Spanish: ["el", "la", "los", "las", "y", "de", "que", "en", "para", "con", "una", "es", "por", "tu", "del", "un", "como", "nuestro", "se", "al"],
  Italian: ["il", "la", "di", "e", "che", "per", "con", "una", "sono", "del", "della", "gli", "un", "in", "le", "si", "nel", "alla", "è", "dei"],
  Portuguese: ["o", "a", "os", "as", "e", "de", "que", "em", "para", "com", "uma", "é", "você", "do", "da", "um", "no", "na", "por", "nosso"],
  Polish: ["i", "w", "na", "z", "do", "się", "jest", "oraz", "dla", "nie", "jak", "to", "że", "od", "po", "przez", "lub", "będzie", "pracy", "co"],
  Czech: ["a", "v", "na", "se", "je", "s", "pro", "do", "že", "o", "jako", "k", "nebo", "z", "ve", "jsou", "by", "práce", "našeho", "také"],
  Finnish: ["ja", "on", "että", "ei", "se", "me", "olet", "sinun", "kanssa", "tai", "joka", "meidän", "myös", "ovat", "kun", "työ", "sekä", "tämä", "hän", "voit"],
  Turkish: ["ve", "bir", "bu", "için", "ile", "olarak", "da", "de", "çok", "en", "olan", "gibi", "daha", "veya", "sahip", "iş", "deneyim", "bilgi", "ya", "her"],
  Slovenian: ["in", "je", "za", "na", "v", "z", "s", "da", "se", "ki", "ali", "pri", "so", "bo", "tudi", "iz", "kot", "vas", "naše", "po"],
};

const SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([language, words]) => [language, new Set(words)]));

/** Each language's share of the text's words that are its common short words. */
function shares(text: string): [string, number][] {
  const words = text.toLocaleLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 40) return [];
  return Object.entries(SETS)
    .map(([language, set]): [string, number] => [language, words.filter((word) => set.has(word)).length / words.length])
    .sort((a, b) => b[1] - a[1]);
}

/** The language the text is clearly written in, or null when it's too short or too close to call. */
export function detectTextLanguage(text: string): string | null {
  const [best, second] = shares(text);
  if (!best || best[1] < 0.12) return null;
  return second && second[1] > best[1] * 0.75 ? null : best[0];
}

/**
 * The model's answer, unless the text is clearly in another language:
 * then the text's own. Close calls (Danish and Norwegian) keep the model's.
 */
export function checkedLanguage(answer: string | null, text: string): string | null {
  const detected = detectTextLanguage(text);
  if (!detected || !answer) return answer ?? detected;
  const scores = new Map(shares(text));
  const answered = scores.get(answer);
  return answered !== undefined && answered >= (scores.get(detected) ?? 0) * 0.75 ? answer : detected;
}
