import { describe, expect, it } from 'vitest';
import { formatFormTemplate, mergeToolCallFormLabels } from '../src/widget/toolCallLabels';

describe('mergeToolCallFormLabels', () => {
  it('merges English defaults, localized labels and defined host overrides', () => {
    const labels = mergeToolCallFormLabels(
      { submit: 'Envoyer', subject: 'Sujet', detailedContext: undefined },
      { submit: undefined, subject: 'Host subject' },
    );
    expect(labels).toMatchObject({ submit: 'Envoyer', subject: 'Host subject', detailedContext: 'Detailed context' });
  });

  it('uses English when no labels are supplied', () => {
    expect(mergeToolCallFormLabels(undefined, undefined).submit).toBe('Submit');
  });
});

describe('formatFormTemplate', () => {
  it('substitutes supplied single-brace parameters literally without recursive expansion', () => {
    expect(formatFormTemplate('{fieldTitle} {unknown} {toString} {{fieldTitle}} {fieldTitle}', {
      fieldTitle: '$& {unknown} <script>',
    })).toBe('$& {unknown} <script> {unknown} {toString} {{fieldTitle}} $& {unknown} <script>');
  });
});
