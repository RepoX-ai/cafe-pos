import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/form-field";

export function DateRangeForm({ from, to }: { from: string; to: string }) {
  return (
    <form action="/dashboard" className="flex items-end gap-2">
      <div>
        <label htmlFor="from" className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
          From
        </label>
        <input id="from" name="from" type="date" defaultValue={from} className={inputClassName} />
      </div>
      <div>
        <label htmlFor="to" className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
          To
        </label>
        <input id="to" name="to" type="date" defaultValue={to} className={inputClassName} />
      </div>
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}
