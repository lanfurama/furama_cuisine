import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { LIMITS, limitWarnings } from '@/lib/admin/content-rules';
import { footerVenueText, SOCIAL_PLATFORMS, type SocialPlatform } from '@/lib/content/footer';
import { roleCan } from '@/lib/server/auth/permissions';
import { listDestinationsAdmin } from '@/lib/server/content-admin/destinations';
import { listDeleted, listHistory } from '@/lib/server/content-admin/history';
import { orderToken, type OrderSnapshot } from '@/lib/server/content-admin/snapshot';
import { listSocialLinksAdmin, SOCIAL_LINK, SOCIAL_NAMES } from '@/lib/server/content-admin/socials';
import { requirePagePermission } from '@/lib/server/dal/session';
import { getSharedInbox } from '@/lib/server/email/recipients';
import { DeletedList } from '../../_kit/DeletedList';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { ItemList } from '../../_kit/ItemList';
import { StringsPanel } from '../_ui/StringsPanel';
import { deleteSocialLinkAction, reorderSocialLinksAction, restoreSocialLinkAction, restoreSocialLinkOrderAction, toggleSocialLinkAction } from './actions';
import { SocialForm } from './SocialForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Liên hệ và chân trang' };

/** The History tab's names for a link's fields (spec §7.5), in form order. */
const LABELS = { platform: 'Mạng xã hội', href: 'Đường dẫn', is_published: 'Hiện/ẩn' };

const PLATFORMS = SOCIAL_PLATFORMS.map((key) => ({ key, label: SOCIAL_NAMES[key] }));

/*
 * Spec §7.2 content/contact: the footer's social links (at most 6 shown) with
 * their forms, History and deleted ones, the footer's words (footer.*,
 * social.*), and two read-only parts: the venue lines, which the
 * destinations screen edits with each venue's phone and map (R24), and the
 * shared email, which only an Admin edits, on "Thông báo email" (R10: it is
 * also where booking mail falls back to).
 */
export default async function ContactPage() {
  const staff = await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [{ items, token }, deleted, orderHistory, destinations, inbox] = await Promise.all([
    listSocialLinksAdmin(pool),
    listDeleted(pool, SOCIAL_LINK),
    listHistory(pool, 'social_links', null, 10),
    listDestinationsAdmin(pool),
    getSharedInbox(pool),
  ]);
  const histories = await Promise.all(items.map((s) => listHistory(pool, 'social_links', s.id, 10)));
  const shown = items.filter((i) => i.isPublished).length;
  const venues = destinations.items.filter((d) => d.values.showInFooter);

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Liên hệ và chân trang</h1>
      <p className="a-lede">Link mạng xã hội và chữ của chân trang, theo thứ tự khách thấy. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử.</p>

      <section className="a-section-card" aria-labelledby="socials-title">
        <h2 id="socials-title">Mạng xã hội</h2>
        <ItemList
          label="Thứ tự mạng xã hội"
          noun="link"
          items={items.map((s) => ({ id: s.id, name: s.name, isPublished: s.isPublished, token: s.token, meta: s.values.href }))}
          listToken={token}
          limit={LIMITS.socials.max}
          warnings={limitWarnings('socials', shown)}
          empty="Chân trang chưa có link nào."
          reorder={reorderSocialLinksAction}
          toggle={toggleSocialLinkAction}
          remove={deleteSocialLinkAction}
          details={Object.fromEntries(
            items.map((s, i) => [
              s.id,
              <div key={s.id}>
                <SocialForm id={s.id} token={s.token} values={s.values} platforms={PLATFORMS} label={`Link ${s.name}`} />
                <HistoryPanel
                  title={`Lịch sử: ${s.name}`}
                  headingId={`social-${s.id}-history`}
                  entries={histories[i]}
                  currentToken={s.token}
                  recordId={s.id}
                  labels={LABELS}
                  restore={restoreSocialLinkAction}
                />
              </div>,
            ]),
          )}
        />
        <h3>Thêm link</h3>
        <SocialForm
          id={null}
          token={token}
          platforms={PLATFORMS}
          label="Thêm link mạng xã hội"
          values={{ platform: 'facebook', href: '', isPublished: shown < LIMITS.socials.max }}
        />
      </section>

      <DeletedList
        headingId="socials-deleted"
        empty="Không có link nào bị xóa."
        deleted={deleted}
        name={(before, id) => {
          const platform = (before.row as { platform?: string } | undefined)?.platform;
          return platform && platform in SOCIAL_NAMES ? SOCIAL_NAMES[platform as SocialPlatform] : `Link ${id}`;
        }}
        restore={restoreSocialLinkAction}
      />

      <HistoryPanel
        title="Lịch sử thứ tự mạng xã hội"
        headingId="socials-order-history"
        entries={orderHistory}
        currentToken={token}
        recordId="social_links"
        labels={{}}
        restore={restoreSocialLinkOrderAction}
        tokenOf={(s: OrderSnapshot) => orderToken(s)}
        describe={(e) => `Thứ tự: ${((e.after as OrderSnapshot | null)?.order ?? []).map((o) => o.id).join(', ')}`}
      />

      <section aria-labelledby="footer-copy">
        <h2 id="footer-copy">Chữ của chân trang</h2>
        <StringsPanel
          screen="contact"
          title="Chữ chân trang"
          groups={[
            { title: 'Khẩu hiệu và dòng thành viên', prefix: 'footer.' },
            { title: 'Tên các mạng xã hội', prefix: 'social.' },
          ]}
        />
      </section>

      <section className="a-section-card" aria-labelledby="footer-venues">
        <h2 id="footer-venues">Địa chỉ ở chân trang</h2>
        <p className="a-muted">
          Mỗi điểm đến bật “Hiện ở chân trang” in một dòng tên · địa chỉ · điện thoại. Sửa ở <Link href="/admin/content/destinations">Điểm đến</Link>, cùng số
          điện thoại và bản đồ của nó.
        </p>
        {venues.length === 0 ? (
          <p className="a-muted">Không điểm đến nào hiện ở chân trang.</p>
        ) : (
          <ul className="a-list" aria-label="Dòng địa chỉ ở chân trang">
            {venues.map((d) => {
              // The footer's own rule (components/site/Footer.tsx): a blank part is left out, and the phone shows only with both its numbers.
              const phone = d.values.phoneE164 && d.values.phoneDisplay ? { tel: d.values.phoneE164, display: d.values.phoneDisplay } : null;
              return (
                <li key={d.id} className="a-list-item a-list-item--stack">
                  <span>{`${footerVenueText({ name: d.values.name.en, address: d.values.address.en, phone })}${phone?.display ?? ''}`}</span>
                  {d.isPublished ? null : <span className="a-muted">Điểm đến đang ẩn: dòng này không hiện.</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="a-section-card" aria-labelledby="shared-email">
        <h2 id="shared-email">Email chung</h2>
        <p>
          <strong>{inbox.email}</strong>
        </p>
        <p className="a-muted">
          Chân trang và trang chính sách in địa chỉ này; email đặt bàn không có người nhận riêng cũng gửi về đây, nên chỉ Admin đổi nó
          {roleCan(staff.role, { settings: ['update'] }) ? (
            <>
              , ở <Link href="/admin/settings/notifications">Thông báo email</Link>
            </>
          ) : (
            ', ở Cài đặt → Thông báo email'
          )}
          .
        </p>
      </section>
    </>
  );
}
