import { CV_DIRECTION } from "./donnees-banque-cv-direction.js";
import { CV_EQUIPE } from "./donnees-banque-cv-equipe.js";
import type { CvDemo } from "./donnees-banque-cv-types.js";

export type { ContenuCvDemo, CvDemo, MajCv } from "./donnees-banque-cv-types.js";

/* Banque de CV du Tenant démo : 8 profils (personnes FICTIVES), voir les deux fichiers de données. */
export const CV_DEMO: readonly CvDemo[] = [...CV_DIRECTION, ...CV_EQUIPE];
