import { cookies, headers } from "next/headers";
import {
  COOKIE_LANGUE,
  creerTraduire,
  resoudreLangue,
  type Langue,
  type Traduire,
} from "@missionpilot/shared";

/**
 * Langue de la requête, côté serveur (Server Components, layouts, `generateMetadata`) : cookie
 * du sélecteur, sinon `Accept-Language`, sinon français. À ne pas importer dans un composant
 * client (dépend de `next/headers`) : côté client, `useLangue` / `useT`.
 */
export async function obtenirLangue(): Promise<Langue> {
  const choix = (await cookies()).get(COOKIE_LANGUE)?.value;
  return resoudreLangue(choix, (await headers()).get("accept-language"));
}

/** `t(fr, en)` dans la langue de la requête. */
export async function obtenirT(): Promise<Traduire> {
  return creerTraduire(await obtenirLangue());
}
