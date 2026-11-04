import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotificationTemplateKeySchema } from '@careloop/shared';
import { templateCatalog } from './templateCatalog';

const denylist = /\b(?:diagnos(?:is|ed)|finding|findings|result|results|lab|laboratory|drug|medicine|medication|dose|cancer|tumou?r|positive|negative|abnormal|screening)\b|تشخيص|نتيجة|نتائج|مختبر|دواء|أدوية|سرطان|ورم|إيجابي|سلبي|غير طبيعي/i;

test('every notification template is neutral in EN and AR with no clinical terms or digits', () => {
  const keys = NotificationTemplateKeySchema.options;
  assert.deepEqual(Object.keys(templateCatalog).sort(), [...keys].sort());

  for (const key of keys) {
    const english = templateCatalog[key].EN;
    const arabic = templateCatalog[key].AR;
    assert.ok(english.text.trim(), `${key} EN text is present`);
    assert.ok(arabic.text.trim(), `${key} AR text is present`);
    for (const [language, template] of [['EN', english], ['AR', arabic]] as const) {
      assert.doesNotMatch(template.text, denylist, `${key} ${language} has no clinical content`);
      assert.doesNotMatch(template.text, /\d/, `${key} ${language} has no digits`);
    }
    assert.equal(arabic.clinicallyReviewed, false, `${key} Arabic is marked unreviewed`);
    assert.equal(english.clinicallyReviewed, true, `${key} English is marked reviewed`);
  }
});
