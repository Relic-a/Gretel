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
  inputRef?: React.Ref<HTMLInputElement>;
};

export function TagEditor(props: TagEditorProps) {
  return (
    <div className="tag-editor">
      <span className="tag-label">{props.label}</span>
      {props.helperText && <small className="tag-help">{props.helperText}</small>}
      <div className="tag-input-container">
        <div className="tag-input">
          {props.values.map((value) => (
            <button type="button" key={value} onClick={() => props.removeValue(value)}>
              {value}
            </button>
          ))}
          <input
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
