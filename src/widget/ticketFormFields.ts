import type { TicketField, TicketFieldOption, TicketForm } from "../client/types";

/** Key the ticketing backend expects, including fields without an external id. */
export function fieldKey(field: TicketField): string {
  return field.externalId || field.id;
}

function conditionValues(field: TicketField): string[] {
  return field.conditionalFieldValues?.length
    ? field.conditionalFieldValues
    : (field.conditionalFieldValue?.split(",").map((v) => v.trim()).filter(Boolean) ?? []);
}

export function priorityAllowed(form: TicketForm, typology: string): boolean {
  return !form.priorityTypologies?.length || !typology || form.priorityTypologies.includes(typology);
}

function matchesParent(
  form: TicketForm,
  parentId: string | undefined,
  expected: string[],
  values: Record<string, string>,
  typology: string,
  visiting: Set<string>,
): boolean {
  if (!parentId || !expected.length) return true;
  const parent = form.fields.find((f) => f.id === parentId || f.externalId === parentId);
  // Match the hosted widget's fallback for a reference outside this form.
  if (!parent) return true;
  return fieldEnabled(form, parent, values, typology, visiting) && expected.includes(values[fieldKey(parent)]);
}

/** Eligibility independent of progressive disclosure, shared by validation and submission. */
export function fieldEnabled(
  form: TicketForm,
  field: TicketField,
  values: Record<string, string>,
  typology = "",
  visiting = new Set<string>(),
): boolean {
  if (field.active === false || visiting.has(field.id)) return false;
  if (field.title === "Priority" && !priorityAllowed(form, typology)) return false;
  const path = new Set(visiting).add(field.id);
  return matchesParent(form, field.conditionalFieldId, conditionValues(field), values, typology, path);
}

/** Sorted, available choices. Hidden defaults may be retained without being offered. */
export function availableOptions(
  form: TicketForm,
  field: TicketField,
  values: Record<string, string>,
  typology = "",
): TicketFieldOption[] {
  return field.options.filter((option) => matchesParent(
    form, option.conditionalFieldId, option.conditionalFieldValues ?? [], values, typology, new Set(),
  )).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** Remove values in branches that no longer apply, including cascading option dependencies. */
export function pruneCustomFields(
  form: TicketForm,
  values: Record<string, string>,
  typology = "",
): void {
  let changed: boolean;
  do {
    changed = false;
    for (const field of form.fields) {
      const key = fieldKey(field);
      if (!(key in values)) continue;
      const validOption = !field.options.length || !values[key] || availableOptions(form, field, values, typology)
        .some((option) => (option.value ?? option.name ?? "") === values[key]);
      if (!fieldEnabled(form, field, values, typology) || !validOption) {
        delete values[key];
        changed = true;
      }
    }
  } while (changed);
}

/** Hidden or inapplicable questions never block the next eligible question. */
export function visibleCustomFields(
  form: TicketForm,
  values: Record<string, string>,
  typology = "",
): TicketField[] {
  const eligible = [...form.fields].sort((a, b) => a.position - b.position)
    .filter((field) => !field.hidden && fieldEnabled(form, field, values, typology));
  return eligible.filter((field, index) => {
    if (index === 0 || field.alwaysVisible || (field.conditionalFieldId && conditionValues(field).length)) return true;
    const previous = eligible[index - 1];
    return previous.type === "checkbox" || !!values[fieldKey(previous)]?.trim();
  });
}
