"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { ROLE_NAMES } from "@/lib/validation/staff";
import { ROLE_LABELS } from "@/lib/permissions/role-labels";
import type { RoleName } from "@/lib/permissions/permissions";
import {
  createStaffAction,
  deleteStaffAction,
  resetStaffPasswordAction,
  setStaffActiveAction,
  staffDeletionImpactAction,
  updateStaffAction,
} from "./actions";
import { useToast } from "@/components/ui/toast";

interface StaffRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roles: RoleName[];
}

interface StaffFormValues {
  name: string;
  email: string;
  role: RoleName;
}

type FormResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function StaffClient({ staff, currentUserId }: { staff: StaffRow[]; currentUserId: string }) {
  const [creating, setCreating] = useState(false);
  const [tempPasswordBanner, setTempPasswordBanner] = useState<{ email: string; password: string } | null>(null);
  const showToast = useToast();

  async function create(values: StaffFormValues): Promise<FormResult> {
    const result = await createStaffAction(values);
    if (!result.ok) {
      showToast("error", result.error);
      return result;
    }
    showToast("success", "Staff account created.");
    setCreating(false);
    setTempPasswordBanner({ email: values.email, password: result.tempPassword });
    return { ok: true };
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <ArrowLeft size={14} />
            Back to settings
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">Staff</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Create accounts, edit details and roles, and deactivate staff who no longer work here.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} />
          New staff account
        </Button>
      </div>

      {tempPasswordBanner ? (
        <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--color-accent-primary)] bg-[var(--color-selected-surface)] p-4">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            Temporary password for {tempPasswordBanner.email}. Share it securely &mdash; it won&apos;t be shown again:
          </p>
          <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
            {tempPasswordBanner.password}
          </p>
          <button
            onClick={() => setTempPasswordBanner(null)}
            className="mt-2 text-sm font-medium text-[var(--color-accent-primary)] hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="mt-8 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
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
              <StaffRowItem
                key={s.id}
                staff={s}
                isSelf={s.id === currentUserId}
                onShowTempPassword={(password) => setTempPasswordBanner({ email: s.email, password })}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New staff account">
        <StaffForm
          submitLabel="Create account"
          pendingLabel="Creating…"
          onSubmit={create}
          onCancel={() => setCreating(false)}
        />
      </Modal>
    </div>
  );
}

function StaffRowItem({
  staff,
  isSelf,
  onShowTempPassword,
}: {
  staff: StaffRow;
  isSelf: boolean;
  onShowTempPassword: (password: string) => void;
}) {
  const [isPending, setIsPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showToast = useToast();

  const role = staff.roles[0];
  const isSuperAdmin = staff.roles.includes("super_admin");

  async function resetPassword() {
    setIsPending(true);
    setError(null);
    const result = await resetStaffPasswordAction(staff.id);
    setIsPending(false);
    if (result.ok) {
      showToast("success", "Password reset.");
      onShowTempPassword(result.tempPassword);
    } else {
      setError(result.error);
      showToast("error", result.error);
    }
  }

  async function toggleActive() {
    setIsPending(true);
    setError(null);
    const result = await setStaffActiveAction(staff.id, !staff.active);
    setIsPending(false);
    if (result.ok) showToast("success", staff.active ? "Staff deactivated." : "Staff reactivated.");
    else {
      setError(result.error);
      showToast("error", result.error);
    }
  }

  async function save(values: StaffFormValues): Promise<FormResult> {
    setError(null);
    const result = await updateStaffAction(staff.id, values);
    if (!result.ok) {
      showToast("error", result.error);
      return result;
    }
    showToast("success", "Staff details updated.");
    setEditing(false);
    return { ok: true };
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
        ) : role ? (
          <Badge>{ROLE_LABELS[role]}</Badge>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">No role</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge tone={staff.active ? "success" : "neutral"}>{staff.active ? "Active" : "Deactivated"}</Badge>
      </td>
      <td className="px-4 py-3 text-right">
        {!isSuperAdmin ? (
          <div className="flex justify-end">
            <ActionMenu
              label={`Actions for ${staff.name}`}
              items={[
                { label: "Edit details", onSelect: () => setEditing(true), disabled: isPending },
                { label: "Reset password", onSelect: resetPassword, disabled: isPending },
                {
                  label: staff.active ? "Deactivate" : "Reactivate",
                  onSelect: toggleActive,
                  tone: staff.active ? "danger" : "default",
                  disabled: isPending || isSelf,
                  disabledReason: "You can't deactivate your own account",
                },
                {
                  label: "Delete permanently",
                  onSelect: () => setDeleting(true),
                  tone: "danger",
                  disabled: isPending || isSelf,
                  disabledReason: "You can't delete your own account",
                },
              ]}
            />
          </div>
        ) : null}
        {error ? <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p> : null}

        <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${staff.name}`}>
          <StaffForm
            initial={{ name: staff.name, email: staff.email, role: role ?? "cashier" }}
            submitLabel="Save changes"
            pendingLabel="Saving…"
            onSubmit={save}
            onCancel={() => setEditing(false)}
          />
        </Modal>
        {/* Mounted only while open so each visit starts with a fresh
            impact lookup rather than last time's counts. */}
        {deleting ? <DeleteStaffDialog staff={staff} onClose={() => setDeleting(false)} /> : null}
      </td>
    </tr>
  );
}

/**
 * Shared by the create and edit dialogs — the two take exactly the same
 * three fields, and the caller decides what "submit" means by handing the
 * action's result (including per-field errors) back to be rendered here.
 */
function StaffForm({
  initial,
  submitLabel,
  pendingLabel,
  onSubmit,
  onCancel,
}: {
  initial?: StaffFormValues;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (values: StaffFormValues) => Promise<FormResult>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [role, setRole] = useState<RoleName>(initial?.role ?? "cashier");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit() {
    setIsPending(true);
    setError(null);
    setFieldErrors({});
    const result = await onSubmit({ name, email, role });
    setIsPending(false);
    if (!result.ok) {
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
        <input
          id="staff-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClassName}
        />
      </Field>
      <Field label="Role" htmlFor="staff-role" error={fieldErrors.role}>
        <Select id="staff-role" value={role} onChange={(value) => setRole(value as RoleName)}>
          {ROLE_NAMES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={isPending || !name.trim() || !email.trim()}>
          {isPending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Deleting is permanent and lossy in a way deactivating isn't: the
 * account's history rows survive but lose the name attached to them. The
 * dialog loads the exact counts first, so the owner sees what they are
 * giving up before confirming.
 */
function DeleteStaffDialog({ staff, onClose }: { staff: StaffRow; onClose: () => void }) {
  const [impact, setImpact] = useState<{ label: string; count: number }[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showToast = useToast();

  useEffect(() => {
    let cancelled = false;
    staffDeletionImpactAction(staff.id).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) setImpact(result.entries);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [staff.id]);

  async function confirmDelete() {
    setIsPending(true);
    setError(null);
    const result = await deleteStaffAction(staff.id);
    setIsPending(false);
    if (result.ok) {
      showToast("success", `${staff.name} deleted.`);
      onClose();
    } else {
      setError(result.error);
      showToast("error", result.error);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Delete ${staff.name}?`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--color-text-secondary)]">
          This permanently removes the account and signs them out everywhere. It can&apos;t be undone &mdash; to keep
          their history intact and only stop them logging in, deactivate them instead.
        </p>

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Checking what this affects…</p>
        ) : impact && impact.length > 0 ? (
          <div className="rounded-[var(--radius-sm)] bg-[var(--color-warning-bg)] px-3 py-3">
            <p className="text-sm font-medium text-[var(--color-warning)]">
              These records stay, but will no longer show who was responsible:
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]">
              {impact.map((entry) => (
                <li key={entry.label}>
                  {entry.count.toLocaleString("id-ID")} {entry.label.toLowerCase()}
                </li>
              ))}
            </ul>
          </div>
        ) : impact ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            This account has no orders, purchases, or stock activity attached to it &mdash; nothing else is affected.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={isPending || loading}>
            {isPending ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
