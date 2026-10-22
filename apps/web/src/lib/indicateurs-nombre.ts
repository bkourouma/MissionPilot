/** Garde numérique partagée par les modules de `indicateurs.ts` (non ré-exportée). */
export const estNombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
