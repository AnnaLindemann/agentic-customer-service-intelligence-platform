import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOutOfScopeCategory } from '../pipeline/decision';
import { detectLanguage, personalizeGreeting } from '../pipeline/response';

test('language detection is robust on short German inputs (German wins on any German signal)', () => {
  assert.equal(detectLanguage('Ich möchte einen Apfel kaufen'), 'de');
  // An accidental leading English "I" must not flip a clearly German sentence to English.
  assert.equal(detectLanguage('I möchte einen Apfel kaufen'), 'de');
  // Even without the umlaut, the buying/request markers keep it German.
  assert.equal(detectLanguage('I mochte einen Apfel kaufen'), 'de');
  assert.equal(detectLanguage('Bitte stornieren Sie meine Bestellung'), 'de');
  // Genuinely English inputs stay English.
  assert.equal(detectLanguage('I want to buy an apple'), 'en');
  assert.equal(detectLanguage('I want to buy a Vista Backpack'), 'en');
});

test('out-of-scope subtype detection (DE + EN)', () => {
  assert.equal(
    detectOutOfScopeCategory('ich möchte mich auf eine Stelle bewerben'),
    'career',
  );
  assert.equal(detectOutOfScopeCategory('I would like to apply for a job'), 'career');
  assert.equal(
    detectOutOfScopeCategory('wir sind ein Lieferant und suchen eine Partnerschaft'),
    'b2b',
  );
  assert.equal(detectOutOfScopeCategory('we are a supplier interested in wholesale'), 'b2b');
  assert.equal(detectOutOfScopeCategory('bieten Sie Tanzkurse an?'), 'other');
  assert.equal(detectOutOfScopeCategory('do you offer dance lessons?'), 'other');
});

test('greeting personalisation uses the customer name when available, else generic', () => {
  const de = 'Guten Tag,\n\nvielen Dank für Ihre Nachricht.';
  assert.match(personalizeGreeting(de, 'de', 'Sofia Martinez'), /^Guten Tag Sofia Martinez,\n/);
  assert.match(personalizeGreeting(de, 'de', undefined), /^Guten Tag,\n/);

  const en = 'Hello,\n\nthank you for your message.';
  assert.match(personalizeGreeting(en, 'en', 'Sofia Martinez'), /^Hello Sofia Martinez,\n/);
  assert.match(personalizeGreeting(en, 'en'), /^Hello,\n/);

  // A formal LLM greeting on the first line is replaced cleanly.
  const formal = 'Sehr geehrte Kundin, sehr geehrter Kunde,\n\nIhre Rechnung ist bezahlt.';
  const out = personalizeGreeting(formal, 'de', 'Liam Carter');
  assert.match(out, /^Guten Tag Liam Carter,\n/);
  assert.doesNotMatch(out, /Sehr geehrte/);
});
