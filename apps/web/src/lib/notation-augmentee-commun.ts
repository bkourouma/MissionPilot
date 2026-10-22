/** Notation augmentée : aides internes partagées par les sous-modules (non ré-exportées). */

export const FORMAT_IDENTIFIANT = /^[a-z0-9][a-z0-9_.-]{0,79}$/;

export const entier = (v: string): number | null => {
  const t = v.trim();
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
};
