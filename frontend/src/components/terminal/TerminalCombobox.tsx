import { useId } from "react";
import type { ReactNode } from "react";
import { TerminalInput } from "./TerminalInput";

type Props<T> = {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  placeholder?: string;
  open: boolean;
  items: T[];
  selectedIndex?: number;
  onSelect: (item: T) => void;
  renderItem: (item: T, meta: { selected: boolean; index: number }) => ReactNode;
  getItemKey: (item: T, index: number) => string;
  className?: string;
  inputClassName?: string;
  listClassName?: string;
  itemClassName?: string;
  loading?: boolean;
  "data-testid"?: string;
  "aria-label"?: string;
};

export function TerminalCombobox<T>({
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  placeholder,
  open,
  items,
  selectedIndex = -1,
  onSelect,
  renderItem,
  getItemKey,
  className = "",
  inputClassName = "",
  listClassName = "",
  itemClassName = "",
  loading = false,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
}: Props<T>) {
  const generatedId = useId();
  const inputId = `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;
  const activeOptionId = open && selectedIndex >= 0 && items[selectedIndex] ? `${generatedId}-option-${selectedIndex}` : undefined;

  return (
    <div className={className}>
      <TerminalInput
        tone="ui"
        id={inputId}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-busy={loading || undefined}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        className={inputClassName}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        spellCheck={false}
        data-testid={dataTestId}
      />
      {open && items.length > 0 ? (
        <div id={listboxId} role="listbox" aria-labelledby={inputId} className={listClassName}>
          {items.map((item, index) => (
            <div
              key={getItemKey(item, index)}
              id={`${generatedId}-option-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              className={itemClassName}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
            >
              {renderItem(item, { selected: index === selectedIndex, index })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
