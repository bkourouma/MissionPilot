import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSION, ENTETE_CHEMIN, PAGES_PUBLIQUES } from "./lib/connexion";
import { PAGES_PUBLIQUES_PORTAIL } from "./lib/portail-routes";

/**
 * Premier filtre : sans cookie de session, toute page hors des pages publiques (dont
 * l'acceptation d'une invitation au portail client) renvoie vers la connexion. La présence du
 * cookie ne prouve rien : la garde réelle est côté serveur, qui interroge l'API
 * (`obtenirSession` dans le layout du cabinet, `obtenirSessionPortail` dans celui du portail) ;
 * c'est elle qui oriente un utilisateur du portail vers /portail et un utilisateur du cabinet
 * hors de /portail (le cookie seul ne dit pas de quel espace relève la session).
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const connecte = request.cookies.has(COOKIE_SESSION);
  const publique = PAGES_PUBLIQUES.includes(pathname) || PAGES_PUBLIQUES_PORTAIL.includes(pathname);

  if (!connecte && !publique) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = pathname === "/" ? "" : `?suite=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const entetes = new Headers(request.headers);
  entetes.set(ENTETE_CHEMIN, pathname + search);
  return NextResponse.next({ request: { headers: entetes } });
}

export const config = {
  // Exclut l'API relayée, les fichiers de Next et les ressources publiques (PWA, icônes, service
  // worker `/sw.js` : chemin exact, pour pouvoir l'enregistrer et le mettre à jour sans session).
  matcher: [
    "/((?!api/|_next/static|_next/image|manifest\\.webmanifest|icon\\.svg|icones/|favicon\\.ico|robots\\.txt|sw\\.js$).*)",
  ],
};
