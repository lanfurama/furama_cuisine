'use client';

import { createContext, useContext } from 'react';
// Type only: the schemas module pulls zod into the browser bundle, whose eval probe the admin CSP reports.
import type { AiFeatures } from '@/lib/admin/ai-schemas';

const NONE: AiFeatures = { translate: false, assist: false, seo: false, alt: false };
const AiFeaturesContext = createContext<AiFeatures>(NONE);

/** The shell layout gives every page which AI buttons to show. */
export function AiFeaturesProvider({ features, children }: { features: AiFeatures; children: React.ReactNode }) {
  return <AiFeaturesContext value={features}>{children}</AiFeaturesContext>;
}

export const useAiFeatures = (): AiFeatures => useContext(AiFeaturesContext);
