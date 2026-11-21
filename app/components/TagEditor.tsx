import { X } from "lucide-react";
import { useId, useRef } from "react";

type TagEditorProps = {
  label: string;
  values: string[];
  draft: string;
  setDraft: (value: string) => void;
  addValue: (value: string) => void;
  removeValue: (value: string) => void;
  placeholder: string;
  suggestions: string[];
};

export function TagEditor(props: TagEditorProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="tag-editor">
      <label className="tag-label" htmlFor={inputId}>{props.label}</label>
      <div className="tag-input">
        {props.values.map((value) => (
          <button
            type="button"
            key={value}
            aria-label={`Remove ${value}`}
            onClick={() => {
              props.removeValue(value);
              inputRef.current?.focus();
            }}
          >
            {value} <X size={12} aria-hidden="true" />
          </button>
        ))}
        <input
          id={inputId}
          ref={inputRef}
          maxLength={80}
          value={props.draft}
          onChange={(event) => props.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Backspace" && !props.draft && props.values.length > 0) {
              event.preventDefault();
              props.removeValue(props.values[props.values.length - 1]);
            }
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              props.addValue(props.draft);
            }
          }}
          placeholder={props.placeholder}
        />
      </div>
      {props.suggestions.length > 0 && (
        <div className="suggestion-row">
          {props.suggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              onClick={() => {
                props.addValue(suggestion);
                inputRef.current?.focus();
              }}
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
