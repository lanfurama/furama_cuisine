'use client';

import { useState, useTransition } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionResult } from '@/lib/server/action-result';
import type { StaffRole } from '@/lib/server/auth/permissions';
import { banStaffMember, changeStaffRole, removeStaffMember, unbanStaffMember } from './actions';

export type StaffItem = { id: string; name: string; email: string; role: StaffRole; banned: boolean; createdLabel: string; isSelf: boolean };

export function StaffTable({ staff }: { staff: StaffItem[] }) {
  return (
    <table className="a-table">
      <thead>
        <tr>
          <th scope="col">Họ tên</th>
          <th scope="col">Email</th>
          <th scope="col">Vai trò</th>
          <th scope="col">Trạng thái</th>
          <th scope="col">Ngày tạo</th>
          <th scope="col">Thao tác</th>
        </tr>
      </thead>
      <tbody>
        {staff.map((member) => (
          <StaffRow key={member.id} member={member} />
        ))}
      </tbody>
    </table>
  );
}

function StaffRow({ member }: { member: StaffItem }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ActionResult<unknown>>, onFail?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) setError(null);
      else {
        onFail?.();
        setError(actionErrorMessage(result.code));
      }
    });

  return (
    <tr data-email={member.email}>
      <td>
        {member.name}
        {member.isSelf ? ' (bạn)' : null}
      </td>
      <td>{member.email}</td>
      <td>
        <select
          aria-label={`Vai trò của ${member.email}`}
          defaultValue={member.role}
          disabled={pending}
          onChange={(event) => {
            const select = event.currentTarget;
            // A closed select also changes on arrow keys (Chrome on Windows), so tabbing
            // through the table could promote or demote someone by accident: ask first.
            const label = select.options[select.selectedIndex]?.text ?? select.value;
            const question =
              member.isSelf && select.value !== 'admin'
                ? `Đổi vai trò của chính bạn (${member.email}) thành ${label}? Bạn sẽ mất quyền quản lý nhân viên ngay, và chỉ một Admin khác mới đổi lại được.`
                : `Đổi vai trò của ${member.email} thành ${label}?`;
            if (!window.confirm(question)) {
              select.value = member.role;
              return;
            }
            run(
              () => changeStaffRole(member.id, select.value),
              () => {
                select.value = member.role;
              },
            );
          }}
        >
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
        </select>
        {error ? (
          <p className="a-field-error" role="alert">
            {error}
          </p>
        ) : null}
      </td>
      <td>{member.banned ? 'Đã khóa' : 'Hoạt động'}</td>
      <td>{member.createdLabel}</td>
      <td className="a-actions">
        {member.isSelf ? null : (
          <>
            {member.banned ? (
              <button className="a-btn a-btn--ghost" type="button" disabled={pending} onClick={() => run(() => unbanStaffMember(member.id))}>
                Mở khóa
              </button>
            ) : (
              <button className="a-btn a-btn--ghost" type="button" disabled={pending} onClick={() => run(() => banStaffMember(member.id))}>
                Khóa
              </button>
            )}
            <button
              className="a-btn a-btn--ghost"
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Xóa tài khoản ${member.email}? Không hoàn tác được.`)) run(() => removeStaffMember(member.id));
              }}
            >
              Xóa
            </button>
          </>
        )}
      </td>
    </tr>
  );
}
