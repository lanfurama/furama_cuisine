import type { ReactNode } from 'react';
import { Body, Container, Head, Hr, Html, Preview, Text } from 'react-email';

const brand = '#7a1f2b';

const STAFF_FOOTER = 'Đây là email tự động từ hệ thống quản trị Furama Cuisine. Vui lòng không trả lời email này.';

/**
 * Shared shell for every email. Inline styles only: email clients ignore stylesheets.
 * The staff account emails (invite, reset) take the Vietnamese defaults; booking emails
 * pass the email's language (BCP 47) and their footer from the registry.
 */
export function EmailLayout({ preview, children, lang = 'vi', footer = STAFF_FOOTER }: { preview: string; children: ReactNode; lang?: string; footer?: string }) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body lang={lang} style={{ backgroundColor: '#f6f3ee', margin: 0, padding: '24px 0', fontFamily: 'Helvetica, Arial, sans-serif', color: '#2b2622' }}>
        <Container style={{ backgroundColor: '#ffffff', maxWidth: 520, margin: '0 auto', padding: '32px 28px', borderTop: `4px solid ${brand}` }}>
          <Text style={{ margin: '0 0 24px', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: brand }}>
            Furama Cuisine
          </Text>
          {children}
          <Hr style={{ borderColor: '#e6e0d6', margin: '28px 0 12px' }} />
          <Text style={{ margin: 0, fontSize: 12, color: '#7a7268' }}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export const emailStyles = {
  heading: { fontSize: 22, margin: '0 0 16px', fontWeight: 600 } as const,
  paragraph: { fontSize: 15, lineHeight: '24px', margin: '0 0 16px' } as const,
  button: { backgroundColor: brand, color: '#ffffff', padding: '12px 24px', borderRadius: 4, fontSize: 15, textDecoration: 'none', display: 'inline-block' } as const,
  small: { fontSize: 13, lineHeight: '20px', color: '#7a7268', margin: '16px 0 0', wordBreak: 'break-all' } as const,
  detailsTable: { width: '100%', borderCollapse: 'collapse', margin: '8px 0 20px', fontSize: 15, lineHeight: '22px' } as const,
  detailsLabel: { padding: '6px 16px 6px 0', color: '#7a7268', verticalAlign: 'top', whiteSpace: 'nowrap', width: '1%' } as const,
  detailsValue: { padding: '6px 0', fontWeight: 600, verticalAlign: 'top' } as const,
  quote: { fontSize: 15, lineHeight: '22px', margin: '0 0 16px', padding: '10px 14px', backgroundColor: '#f6f3ee', borderLeft: `3px solid ${brand}`, whiteSpace: 'pre-line' } as const,
};
