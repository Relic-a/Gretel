import { useId } from "react";

export type TagEditorProps = {
  label: string;
  helperText?: string;
  values: string[];
  draft: string;
  setDraft: (value: string) => void;
  addValue: (value: string) => void;
  removeValue: (value: string) => void;
  placeholder: string;
  suggestions?: string[];
  dropdown?: React.ReactNode;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  containerRef?: React.Ref<HTMLDivElement>;
};

export function TagEditor(props: TagEditorProps) {
  const inputId = useId();
  return (
    <div ref={props.containerRef} className="tag-editor">
      <label className="tag-label" htmlFor={inputId}>{props.label}</label>
      {props.helperText && <small id={`${inputId}-help`} className="tag-help">{props.helperText}</small>}
      <div className="tag-input-container">
        <div className="tag-input">
          {props.values.map((value) => (
            <button type="button" key={value} aria-label={`Remove ${value}`} onClick={() => props.removeValue(value)}>
              {value}
            </button>
          ))}
          <input
            id={inputId}
            aria-describedby={props.helperText ? `${inputId}-help` : undefined}
            ref={props.inputRef}
            maxLength={80}
            value={props.draft}
            onChange={(event) => props.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (props.onKeyDown) {
                props.onKeyDown(event);
                if (event.defaultPrevented) {
                  return;
                }
              }
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                props.addValue(props.draft);
              }
            }}
            onFocus={props.onFocus}
            onBlur={() => {
              if (!props.dropdown) {
                props.addValue(props.draft);
              }
            }}
            placeholder={props.placeholder}
          />
        </div>
        {props.dropdown}
      </div>
      {props.suggestions && props.suggestions.length > 0 && (
        <div className="suggestion-row">
          {props.suggestions.map((suggestion) => (
            <button type="button" key={suggestion} onClick={() => props.addValue(suggestion)}>
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
