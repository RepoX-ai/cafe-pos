"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { Field, inputClassName, selectClassName } from "@/components/ui/form-field";
import { ROLE_NAMES } from "@/lib/validation/staff";
import { ROLE_LABELS } from "@/lib/permissions/role-labels";
import type { RoleName } from "@/lib/permissions/permissions";
import { changeStaffRoleAction, createStaffAction, setStaffActiveAction } from "./actions";

interface StaffRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roles: RoleName[];
}

export function StaffClient({ staff, currentUserId }: { staff: StaffRow[]; currentUserId: string }) {
  const [creating, setCreating] = useState(false);
  const [tempPasswordBanner, setTempPasswordBanner] = useState<{ email: string; password: string } | null>(null);

  return (
    <div>
      {tempPasswordBanner ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-accent-primary)] bg-[var(--color-selected-surface)] p-4">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            Account created for {tempPasswordBanner.email}. Share this temporary password securely — it won&apos;t be shown again:
          </p>
          <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]">
            {tempPasswordBanner.password}
          </p>
          <button
            onClick={() => setTempPasswordBanner(null)}
            className="mt-2 text-xs font-medium text-[var(--color-accent-primary)] hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="mb-4 flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} />
          New staff account
        </Button>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <StaffRowItem key={s.id} staff={s} isSelf={s.id === currentUserId} />
            ))}
          </tbody>
        </table>
      </div>

      <Drawer open={creating} onClose={() => setCreating(false)} title="New staff account">
        <CreateStaffForm
          onDone={(result) => {
            setCreating(false);
            if (result) setTempPasswordBanner(result);
          }}
        />
      </Drawer>
    </div>
  );
}

function StaffRowItem({ staff, isSelf }: { staff: StaffRow; isSelf: boolean }) {
  const [role, setRole] = useState<RoleName>(staff.roles[0] ?? "cashier");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSuperAdmin = staff.roles.includes("super_admin");

  async function handleRoleChange(newRole: RoleName) {
    setRole(newRole);
    setIsPending(true);
    setError(null);
    const result = await changeStaffRoleAction(staff.id, newRole);
    setIsPending(false);
    if (!result.ok) setError(result.error);
  }

  async function toggleActive() {
    setIsPending(true);
    setError(null);
    const result = await setStaffActiveAction(staff.id, !staff.active);
    setIsPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">
        {staff.name}
        {isSelf ? <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">(you)</span> : null}
      </td>
      <td className="px-4 py-3 text-[var(--color-text-secondary)]">{staff.email}</td>
      <td className="px-4 py-3">
        {isSuperAdmin ? (
          <Badge tone="accent">Super Admin</Badge>
        ) : (
          <select
            value={role}
            disabled={isPending}
            onChange={(e) => handleRoleChange(e.target.value as RoleName)}
            className={selectClassName}
          >
            {ROLE_NAMES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge tone={staff.active ? "success" : "neutral"}>{staff.active ? "Active" : "Deactivated"}</Badge>
      </td>
      <td className="px-4 py-3 text-right">
        {!isSuperAdmin ? (
          <button
            onClick={toggleActive}
            disabled={isPending || isSelf}
            title={isSelf ? "You can't deactivate your own account" : undefined}
            className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          >
            {staff.active ? "Deactivate" : "Reactivate"}
          </button>
        ) : null}
        {error ? <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p> : null}
      </td>
    </tr>
  );
}

function CreateStaffForm({ onDone }: { onDone: (result: { email: string; password: string } | null) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleName>("cashier");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit() {
    setIsPending(true);
    setError(null);
    setFieldErrors({});
    const result = await createStaffAction({ name, email, role });
    setIsPending(false);
    if (result.ok) {
      onDone({ email, password: result.tempPassword });
    } else {
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Name" htmlFor="staff-name" error={fieldErrors.name}>
        <input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
      </Field>
      <Field label="Email" htmlFor="staff-email" error={fieldErrors.email}>
        <input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClassName} />
      </Field>
      <Field label="Role" htmlFor="staff-role" error={fieldErrors.role}>
        <select id="staff-role" value={role} onChange={(e) => setRole(e.target.value as RoleName)} className={selectClassName}>
          {ROLE_NAMES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>

      {error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[#FEF3F2] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={isPending || !name.trim() || !email.trim()}>
          {isPending ? "Creating…" : "Create account"}
        </Button>
      </div>
    </div>
  );
}
