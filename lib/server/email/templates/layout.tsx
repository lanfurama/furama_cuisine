import type { ReactNode } from 'react';
import { Body, Container, Head, Hr, Html, Preview, Text } from 'react-email';

const brand = '#7a1f2b';

/** Shared shell for staff emails. Inline styles only: email clients ignore stylesheets. */
export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="vi">
      <Head />
      <Preview>{preview}</Preview>
      <Body lang="vi" style={{ backgroundColor: '#f6f3ee', margin: 0, padding: '24px 0', fontFamily: 'Helvetica, Arial, sans-serif', color: '#2b2622' }}>
        <Container style={{ backgroundColor: '#ffffff', maxWidth: 520, margin: '0 auto', padding: '32px 28px', borderTop: `4px solid ${brand}` }}>
          <Text style={{ margin: '0 0 24px', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: brand }}>
            Furama Cuisine
          </Text>
          {children}
          <Hr style={{ borderColor: '#e6e0d6', margin: '28px 0 12px' }} />
          <Text style={{ margin: 0, fontSize: 12, color: '#7a7268' }}>
            Đây là email tự động từ hệ thống quản trị Furama Cuisine. Vui lòng không trả lời email này.
          </Text>
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
};
