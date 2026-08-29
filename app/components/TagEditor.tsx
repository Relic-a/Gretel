type TagEditorProps = {
  label: string;
  helperText?: string;
  values: string[];
  draft: string;
  setDraft: (value: string) => void;
  addValue: (value: string) => void;
  removeValue: (value: string) => void;
  placeholder: string;
  suggestions?: string[];
};

export function TagEditor(props: TagEditorProps) {
  return (
    <label className="tag-editor">
      <span>{props.label}</span>
      {props.helperText && <small className="tag-help">{props.helperText}</small>}
      <div className="tag-input">
        {props.values.map((value) => (
          <button type="button" key={value} onClick={() => props.removeValue(value)}>
            {value}
          </button>
        ))}
        <input
          value={props.draft}
          onChange={(event) => props.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              props.addValue(props.draft);
            }
          }}
          onBlur={() => props.addValue(props.draft)}
          placeholder={props.placeholder}
        />
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
    </label>
  );
}
