import { Button, Heading, Link, Text } from 'react-email';
import { EmailLayout, emailStyles } from './layout';

/*
 * The one layout of every booking email (spec §10.4: staff.new, guest.ack,
 * guest.confirmed, guest.declined, guest.cancelled). It only lays out text it
 * is given: lib/server/email/booking/render.ts picks the registry strings for
 * the event and the language, and the booking's details. It never receives
 * internal notes (reservation_notes); the guest's own request reaches staff only.
 */

export type BookingEmailProps = {
  /** BCP 47 tag of the email's language (Html lang). */
  lang: string;
  preview: string;
  heading: string;
  intro: string;
  /** Label/value rows: reference, restaurant, date, time, guests (staff: guest, phone, email). */
  details: readonly { label: string; value: string }[];
  /** Free text quoted under its label: the decline or cancellation reason, the guest's request. */
  quotes?: readonly { label: string; text: string }[];
  /** Staff: open the booking in the admin. */
  button?: { label: string; href: string } | null;
  /** Guests: "Questions or changes? Please call us on …". */
  contact?: { text: string; tel: string; phone: string } | null;
  footer: string;
};

export function BookingEmail({ lang, preview, heading, intro, details, quotes = [], button = null, contact = null, footer }: BookingEmailProps) {
  return (
    <EmailLayout lang={lang} preview={preview} footer={footer}>
      <Heading as="h1" style={emailStyles.heading}>
        {heading}
      </Heading>
      <Text style={emailStyles.paragraph}>{intro}</Text>
      {/* data-text-format: react-email's plain-text pass keeps the rows as aligned "Label  value" lines. */}
      <table role="presentation" data-text-format="dataTable" style={emailStyles.detailsTable}>
        <tbody>
          {details.map((row) => (
            <tr key={row.label}>
              <td style={emailStyles.detailsLabel}>{row.label}</td>
              <td style={emailStyles.detailsValue}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {quotes.map((q) => (
        <div key={q.label}>
          <Text style={{ ...emailStyles.paragraph, margin: '0 0 4px', fontWeight: 600 }}>{q.label}</Text>
          <Text style={emailStyles.quote}>{q.text}</Text>
        </div>
      ))}
      {button ? (
        <>
          <Button href={button.href} style={emailStyles.button}>
            {button.label}
          </Button>
          {/* For clients that drop the button; the plain-text part already prints the button's link. */}
          <Text style={emailStyles.small} data-skip-in-text="true">
            <Link href={button.href}>{button.href}</Link>
          </Text>
        </>
      ) : null}
      {contact ? (
        <Text style={emailStyles.paragraph}>
          {splitAround(contact.text, contact.phone).map((part, i) =>
            part === null ? (
              <Link key={i} href={`tel:${contact.tel}`}>
                {contact.phone}
              </Link>
            ) : (
              part
            ),
          )}
        </Text>
      ) : null}
    </EmailLayout>
  );
}

/** "Call us on +84 236 …." → ["Call us on ", null, "."]: the number becomes a tel: link where it stands. */
function splitAround(text: string, needle: string): (string | null)[] {
  const at = text.indexOf(needle);
  if (!needle || at < 0) return [text];
  return [text.slice(0, at), null, text.slice(at + needle.length)].filter((p) => p !== '');
}
