"use client";

import { useState } from "react";
import type { ConfigField } from "@/lib/types";

interface McpConfigFormProps {
  fields: ConfigField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}

export function McpConfigForm({ fields, values, onChange }: McpConfigFormProps) {
  if (fields.length === 0) return null;

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            {field.label}
          </label>
          {field.helpText && (
            <p className="text-xs text-gray-500 mb-2">{field.helpText}</p>
          )}

          {field.type === "multiselect" && field.options ? (
            <MultiselectField
              field={field}
              value={values[field.key] ?? field.default ?? ""}
              onChange={(val) => onChange({ ...values, [field.key]: val })}
            />
          ) : field.type === "select" && field.options ? (
            <select
              value={values[field.key] ?? field.default ?? ""}
              onChange={(e) =>
                onChange({ ...values, [field.key]: e.target.value })
              }
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            >
              {field.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={values[field.key] ?? field.default ?? ""}
              onChange={(e) =>
                onChange({ ...values, [field.key]: e.target.value })
              }
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function MultiselectField({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: string;
  onChange: (val: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(value.split(",").filter(Boolean)),
  );

  function toggle(opt: string) {
    const next = new Set(selected);
    if (next.has(opt)) {
      next.delete(opt);
    } else {
      next.add(opt);
    }
    setSelected(next);
    onChange(Array.from(next).join(","));
  }

  return (
    <div className="flex flex-wrap gap-2">
      {field.options?.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => toggle(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            selected.has(opt.value)
              ? "bg-blue-500/15 border-blue-500/40 text-blue-400"
              : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
