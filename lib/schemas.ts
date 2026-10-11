// Record schemas shared by the server (validation) and the client (types).
import { z } from 'zod';
import { confirmedDocumentSchema, documentSchema } from './document-schema';

const str = (max = 4000) => z.string().max(max);
const date = z.union([
  z.literal(''),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(v => !isNaN(Date.parse(v))),
]);

export const inspectionSchema = z.object({
  authority: str(200).min(1),
  scope: str(200).min(1),
  officers: str(1000),
  reference: str(200),
  status: z.enum(['aperto', 'concluso']),
  outcome: str(),
  started: str(40),
  ended: str(40),
});
export const eventSchema = z.object({
  inspectionId: str(100).min(1),
  speaker: str(200),
  text: str().min(1),
  tag: z.enum(['Richiesta', 'Nota', 'Da verificare', 'Documento esibito', 'Registrazione']),
  offset: z.number().min(0).max(864000),
  fileId: str(100).optional(),
  fileName: str(255).optional(),
});
export const requirementSchema = z.object({
  catalogId: str(100),
  status: z.enum(['Da valutare', 'Applicabile', 'Non applicabile']),
  notes: str(),
  reviewer: str(200),
});
export const taskSchema = z.object({
  title: str(200).min(1),
  responsible: str(200),
  due: date,
  notes: str(),
  done: z.boolean(),
});
export const profileSchema = z.object({
  name: str(150).min(1),
  legalName: str(200),
  vat: str(30),
  address: str(300),
  city: str(100),
  region: str(100),
  activity: str(200),
  staff: z.enum(['Sì', 'No', 'Da confermare']),
  dehors: z.enum(['Sì', 'No', 'Da confermare']),
  reviewer: str(200),
  portalNotice: str(12000).optional(),
});

export const recordSchemas = {
  document: confirmedDocumentSchema,
  inspection: inspectionSchema,
  event: eventSchema,
  task: taskSchema,
  requirement: requirementSchema,
};
export type EditableKind = keyof typeof recordSchemas;
/** Kinds the owner can archive and restore. Events stay append-only. */
export const archivableKinds = ['document', 'inspection', 'task'] as const;

/** Set by the server on archive; never accepted from the client payload. */
type Archivable = { archivedAt?: string };
export type DocumentData = z.infer<typeof documentSchema> & Archivable;
export type InspectionData = z.infer<typeof inspectionSchema> & Archivable;
export type EventData = z.infer<typeof eventSchema>;
export type TaskData = z.infer<typeof taskSchema> & Archivable;
export type RequirementData = z.infer<typeof requirementSchema>;
