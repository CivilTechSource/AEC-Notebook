// data_validation.js
// Shared validation module used when a project's data is created or saved.
// Pure functions, no Node/Electron APIs, so it can run in either process.

/**
 * Validate a single value against a field definition from the schema.
 * @param {object} field - { id, key, label, type, required, options, validation }
 * @param {*} value - the user-entered value
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateField(field, value) {
  const isEmpty = value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);

  if (field.required && isEmpty) {
    return { valid: false, error: `"${field.label}" is required.` };
  }
  if (isEmpty) {
    return { valid: true, error: null }; // optional + empty is fine
  }

  switch (field.type) {
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') {
        return { valid: false, error: `"${field.label}" must be text.` };
      }
      if (field.validation?.maxLength && value.length > field.validation.maxLength) {
        return { valid: false, error: `"${field.label}" exceeds ${field.validation.maxLength} characters.` };
      }
      if (field.validation?.pattern) {
        try {
          if (!new RegExp(field.validation.pattern).test(value)) {
            return { valid: false, error: `"${field.label}" does not match the required format.` };
          }
        } catch { /* invalid regex in schema — skip */ }
      }
      break;

    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return { valid: false, error: `"${field.label}" must be a number.` };
      }
      if (field.validation?.min != null && value < field.validation.min) {
        return { valid: false, error: `"${field.label}" must be ≥ ${field.validation.min}.` };
      }
      if (field.validation?.max != null && value > field.validation.max) {
        return { valid: false, error: `"${field.label}" must be ≤ ${field.validation.max}.` };
      }
      break;

    case 'date': {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        return { valid: false, error: `"${field.label}" must be a valid date.` };
      }
      break;
    }

    case 'checkbox':
      if (typeof value !== 'boolean') {
        return { valid: false, error: `"${field.label}" must be true or false.` };
      }
      break;

    case 'dropdown': {
      const allowed = (field.options || []).map((o) => o.value);
      if (!allowed.includes(value)) {
        return { valid: false, error: `"${field.label}" must be one of: ${allowed.join(', ')}.` };
      }
      // (the "requires attachment" rule is cross-field — enforced in validateRecord)
      break;
    }

    case 'multiselect': {
      if (!Array.isArray(value)) {
        return { valid: false, error: `"${field.label}" must be a list of selections.` };
      }
      const allowedMulti = (field.options || []).map((o) => o.value);
      const bad = value.find((v) => !allowedMulti.includes(v));
      if (bad !== undefined) {
        return { valid: false, error: `"${field.label}" contains an invalid option.` };
      }
      break;
    }

    case 'file':
      if (typeof value !== 'string' || value.trim() === '') {
        return { valid: false, error: `"${field.label}" must reference a file.` };
      }
      break;

    default:
      // Unknown/custom types pass through; plugins may handle them.
      break;
  }

  return { valid: true, error: null };
}

/**
 * Flatten a schema into its list of fields, supporting both the legacy
 * flat `{ fields: [] }` shape and the sectioned `{ sections: [{ fields: [] }] }` shape.
 */
function schemaFields(schema) {
  if (!schema) return [];
  if (Array.isArray(schema.sections)) {
    return schema.sections.flatMap((s) => s.fields || []);
  }
  return schema.fields || [];
}

/**
 * Validate an entire project record against a schema.
 * @returns {{ valid: boolean, errors: Object<string,string> }}
 */
function validateRecord(schema, record) {
  const fields = schemaFields(schema);
  const errors = {};
  for (const field of fields) {
    const result = validateField(field, record[field.key]);
    if (!result.valid) errors[field.key] = result.error;
  }

  // Cross-field rule: a selected dropdown option flagged requiresAttachment needs a file field filled.
  const fileFields = fields.filter((f) => f.type === 'file');
  for (const field of fields) {
    if (field.type !== 'dropdown') continue;
    const opt = (field.options || []).find((o) => o.value === record[field.key]);
    if (!opt?.requiresAttachment) continue;
    // Honour an explicit target file field, else require ANY file field to be filled.
    const targetKey = field.validation?.attachmentField;
    const targets = targetKey ? fileFields.filter((f) => f.key === targetKey) : fileFields;
    const satisfied = targets.length > 0 && targets.some((f) => {
      const v = record[f.key];
      return typeof v === 'string' && v.trim() !== '';
    });
    if (!satisfied) {
      const need = targets[0]?.label || 'a file attachment';
      errors[field.key] = `Selecting "${opt.label}" requires ${need}.`;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Decide whether a field should be visually highlighted (e.g. red) given its value.
 * Driven by schema rules so the UI stays declarative.
 */
function shouldHighlight(field, value) {
  const rule = field.validation?.highlightWhen;
  if (!rule) return false;
  if (rule.equals !== undefined) return value === rule.equals;
  if (rule.in !== undefined) return Array.isArray(rule.in) && rule.in.includes(value);
  return false;
}

const dataValidationApi = { validateField, validateRecord, shouldHighlight, schemaFields };

// Dual export: CommonJS (main process) + global (renderer).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = dataValidationApi;
}
if (typeof window !== 'undefined') {
  window.DataValidation = dataValidationApi;
}
