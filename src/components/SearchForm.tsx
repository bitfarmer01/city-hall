// The goal/search input. A plain GET form — navigation IS the
// interaction, so the whole core flow works with zero client JS. The
// visible <label> is pinned by the a11y smoke test.

interface SearchFormProps {
  action: string;
  inputName: string;
  label: string;
  placeholder: string;
  buttonLabel: string;
  defaultValue?: string;
  /** Hidden fields preserved on submit (e.g. the active domain filter). */
  hidden?: Record<string, string>;
  /** Example queries rendered as links under the input. */
  examples?: readonly string[];
  examplesLabel?: string;
}

export function SearchForm({
  action,
  inputName,
  label,
  placeholder,
  buttonLabel,
  defaultValue = "",
  hidden,
  examples,
  examplesLabel,
}: SearchFormProps) {
  return (
    <form action={action} method="GET" role="search" className="w-full">
      <label htmlFor={`${inputName}-input`} className="block text-sm font-medium text-ink-secondary">
        {label}
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id={`${inputName}-input`}
          name={inputName}
          type="search"
          defaultValue={defaultValue}
          placeholder={placeholder}
          required
          className="w-full rounded-lg border border-line bg-surface-card px-4 py-2.5 text-base text-ink shadow-card placeholder:text-ink-faint"
        />
        {hidden !== undefined &&
          Object.entries(hidden).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-card transition-colors hover:bg-accent-hover"
        >
          {buttonLabel}
        </button>
      </div>
      {examples !== undefined && examples.length > 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          {examplesLabel ?? "Try:"}{" "}
          {examples.map((example, index) => (
            <span key={example}>
              {index > 0 && " · "}
              <a href={`${action}?${inputName}=${encodeURIComponent(example)}`} className="text-link underline underline-offset-2">
                {example}
              </a>
            </span>
          ))}
        </p>
      )}
    </form>
  );
}
