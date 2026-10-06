import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { addableLanguages, deleteImpact, listLocalesAdmin, listSocialLocales } from '@/lib/server/content-admin/locales';
import { requirePagePermission } from '@/lib/server/dal/session';
import { deleteLanguage, moveLanguage, setLanguageEnabled, setLanguageServeMachine } from './actions';
import { AddLanguageForm, LinkLanguagesForm, LocaleButton } from './LocalesForms';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Ngôn ngữ' };

/*
 * Spec §8 and §7.2 /admin/locales (Admin only, §7.1): the languages of the
 * guest site. Add one from the catalogue (off), translate it in the content
 * screens' tabs, preview it (Draft Mode, /api/admin/preview), then turn it on;
 * whether guests see machine translations (serve_machine); the switcher's
 * order; delete a language nothing keeps (R8-2). Also which languages each
 * social link shows in (R39).
 */
export default async function LocalesPage() {
  // Before any query: an Editor gets the 403 view.
  await requirePagePermission({ locales: ['read'] });
  const pool = getPool();
  const [{ locales, token }, addable, links] = await Promise.all([listLocalesAdmin(pool), addableLanguages(pool), listSocialLocales(pool)]);
  const impacts = new Map(
    await Promise.all(locales.filter((l) => !l.isDefault && !l.isEnabled).map(async (l) => [l.code, await deleteImpact(pool, l.code)] as const)),
  );
  const label = (l: { nativeName: string; code: string }) => `${l.nativeName} (${l.code})`;

  return (
    <>
      <h1>Ngôn ngữ</h1>
      <p className="a-lede">
        Thêm ngôn ngữ, dịch nội dung ở tab ngôn ngữ của từng màn, xem trước, rồi bật cho khách. Ngôn ngữ mới thêm luôn ở trạng thái tắt.
      </p>

      <section aria-labelledby="locales-list-title">
        <h2 id="locales-list-title">Các ngôn ngữ</h2>
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">Ngôn ngữ</th>
              <th scope="col">Cho khách</th>
              <th scope="col">Bản máy dịch</th>
              <th scope="col">Thứ tự</th>
              <th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {locales.map((l, i) => {
              const target = { code: l.code, token };
              const impact = impacts.get(l.code);
              return (
                <tr key={l.code}>
                  <th scope="row">
                    {label(l)}
                    {l.isDefault ? <span className="a-tag">Mặc định</span> : null}
                  </th>
                  <td>
                    {l.isDefault ? (
                      'Luôn bật'
                    ) : (
                      <>
                        <span className={l.isEnabled ? 'a-tag' : 'a-tag a-tag--warn'}>{l.isEnabled ? 'Đang bật' : 'Đang tắt'}</span>
                        <LocaleButton
                          action={setLanguageEnabled}
                          fields={{ ...target, enabled: String(!l.isEnabled) }}
                          label={l.isEnabled ? 'Tắt' : 'Bật cho khách'}
                          confirm={l.isEnabled ? `Tắt ${l.nativeName}? Khách sẽ không mở được các trang /${l.code} nữa.` : undefined}
                        />
                      </>
                    )}
                  </td>
                  <td>
                    {l.isDefault ? (
                      '—'
                    ) : (
                      <>
                        <span className="a-muted">{l.serveMachine ? 'Hiện cho khách' : 'Chỉ bản đã duyệt'}</span>
                        <LocaleButton
                          action={setLanguageServeMachine}
                          fields={{ ...target, on: String(!l.serveMachine) }}
                          label={l.serveMachine ? 'Chỉ hiện bản đã duyệt' : 'Hiện cả bản máy dịch'}
                        />
                      </>
                    )}
                  </td>
                  <td>
                    <div className="a-actions">
                      {i > 0 ? <LocaleButton action={moveLanguage} fields={{ ...target, direction: 'up' }} label={`Lên (${l.code})`} /> : null}
                      {i < locales.length - 1 ? <LocaleButton action={moveLanguage} fields={{ ...target, direction: 'down' }} label={`Xuống (${l.code})`} /> : null}
                    </div>
                  </td>
                  <td>
                    <div className="a-actions">
                      {!l.isEnabled ? (
                        <a className="a-btn a-btn--ghost a-btn--small" href={`/api/admin/preview?path=/${l.code}`}>
                          Xem trước
                        </a>
                      ) : (
                        <a className="a-btn a-btn--ghost a-btn--small" href={`/${l.code}`}>
                          Xem trên web
                        </a>
                      )}
                      {impact ? (
                        <LocaleButton
                          action={deleteLanguage}
                          fields={target}
                          label="Xóa"
                          danger
                          confirm={`Xóa ${l.nativeName}? Mất ${impact.translations} bản dịch nội dung và ${impact.strings} chữ giao diện đã dịch. Không khôi phục được.`}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="a-muted">
          “Chỉ bản đã duyệt”: khách chỉ thấy bản dịch do người sửa hoặc đã duyệt; thiếu thì thấy tiếng Anh. Bật một ngôn ngữ cần đủ chữ
          của các email gửi khách bằng ngôn ngữ đó (màn Email).
        </p>
      </section>

      <section aria-labelledby="locales-add-title">
        <h2 id="locales-add-title">Thêm ngôn ngữ</h2>
        <AddLanguageForm options={addable.map((l) => ({ code: l.code, label: `${l.nativeName} (${l.code})` }))} token={token} />
        <p className="a-muted">Ngôn ngữ dùng chữ viết khác (Thái, Kirin, Ả Rập…) cần dev thêm font trước.</p>
      </section>

      <section aria-labelledby="locales-links-title">
        <h2 id="locales-links-title">Link mạng xã hội hiện ở ngôn ngữ nào</h2>
        {links.length === 0 ? <p className="a-muted">Chưa có link nào (màn Liên hệ).</p> : null}
        {links.map((link) => (
          <LinkLanguagesForm key={link.id} link={link} languages={locales.map((l) => ({ code: l.code, label: label(l) }))} />
        ))}
      </section>
    </>
  );
}
