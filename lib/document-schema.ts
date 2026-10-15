import { z } from 'zod';
const finding = z.object({
  value: z.string().max(500).nullable(),
  confidence: z.enum(['alta', 'media', 'bassa', 'non_rilevato']),
  evidence: z.string().max(400),
  page: z.number().int().positive().nullable(),
});
export const recognitionMetadata = z.object({
  fields: z.object({
    title: finding,
    category: finding,
    documentType: finding,
    issuer: finding,
    holder: finding,
    vat: finding,
    address: finding,
    protocol: finding,
    issued: finding,
    expires: finding,
    publicDescription: finding,
  }),
  warnings: z.array(z.string().max(400)).max(20),
  quality: z.enum(['leggibile', 'parziale', 'illeggibile']),
  model: z.string().max(100),
  analyzedAt: z.string().datetime(),
});

import { categories } from './product';
const str = (max = 4000) => z.string().max(max);
const date = z.union([
  z.literal(''),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(v => !isNaN(Date.parse(v))),
]);
export const documentSchema = z.object({
  title: str(200).min(1),
  category: z.enum(categories as [string, ...string[]]),
  expires: date,
  issued: date,
  vat: str(30),
  address: str(300),
  notes: str(),
  fileId: str(100),
  fileName: str(255),
  reviewed: z.boolean(),
  reviewer: str(200),
  protocol: str(200),
  catalogId: str(100).optional(),
  catalogIds: z.array(str(100).min(1)).max(20).optional(),
  catalogMatchingDismissed: z.boolean().optional(),
  priority: z.enum(['Prioritario', 'Secondario', 'Opzionale']).optional(),
  publicDescription: str(500).optional(),
  /** Searchable by inspectors without per-visit approval when automatic exhibition is on. */
  autoShare: z.boolean().optional(),
  issuer: str(200).optional(),
  holder: str(200).optional(),
  documentType: str(200).optional(),
  recognition: recognitionMetadata.optional(),
});
export const confirmedDocumentSchema = documentSchema.refine(
  v => !v.reviewed || !!v.reviewer.trim(),
  'Indica chi ha effettuato la verifica.',
);
