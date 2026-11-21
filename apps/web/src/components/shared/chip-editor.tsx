import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Tag-style list editor used for skills, wants, not-wants,
 * and preferred project types — all of which are simple string arrays.
 * Controlled; duplicates are ignored.
 */
export function ChipEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (!value) {
      setDraft("");
      return;
    }
    if (values.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <Button variant="outline" size="icon" aria-label="Add" onClick={add}>
          <Plus />
        </Button>
      </div>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant="outline" className="gap-1 pr-0.5">
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                className="grid size-4 place-items-center rounded-full hover:bg-muted"
                onClick={() => onChange(values.filter((v) => v !== value))}
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing added yet.</p>
      )}
    </div>
  );
}
